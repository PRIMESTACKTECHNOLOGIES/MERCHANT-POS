import { Router } from 'express';
import { debitMerchantWallet } from './payoutHelpers';
import { v4 as uuidv4 } from 'uuid';
import { db } from '../../config/db';

const router = Router();

type WithdrawalStatus = 'completed' | 'deferred_broadcast' | 'pending_manual' | 'failed';

// sender_mode routing matrix (ALL keep operator at $0 USDT when possible):
//   'customer_origin' → Option A: CUSTOMER signs & submits from THEIR external wallet.
//                       Hot wallet involvement = 0 USDT. Relays only. Best default.
//   'netting'         → Option B: P2P atomic netting. Match withdraw-customer against
//                       a deposit-customer in the same window. $0 operator.
//   'treasury'        → HOT-only gas (TREASURY is your pre-funded wallet).
//                       You explicitly opted out of this earlier. Kept for emergency.
//   'hot'             → Hot wallet as sender (typically deferred). Works, but you hate it.
//   undefined/'auto'  → (1) customer_origin if origin_address provided,
//                       (2) netting if deposit candidate present and >= amount,
//                       (3) treasury if configured, (4) hot (deferred queue).

export type PayoutSenderMode = 'customer_origin' | 'netting' | 'treasury' | 'hot' | 'auto';

// POST /api/merchant/:merchantId/payout/crypto
//
// ARCHITECTURAL DIRECTIVE (per operator):
//  • Merchant wallet debit is FINAL — NO rollbacks, NO reversals
//  • Hot wallet USDT balance is NEVER a blocking requirement
//  • Status semantics (critical distinction):
//      completed          → on-chain tx broadcast + accepted by mempool/mempool
//      deferred_broadcast → auto-retryable. Waiting on liquidity (hot-wallet USDT).
//                           Background retry daemon picks these up. NO human required.
//      pending_manual     → human action required. Invalid address, Travel Rule block,
//                           exchange auth failure, unconfigured rail, insufficient gas.
//      failed             → audit-only (reserved for edge cases we still record).
//  • Only native gas tokens (TRX / BNB / MATIC) are hard requirements for LIVE broadcast
//  • Return success (200) for all finalised accounting entries — never 400 errors that
//    would leave the operator without an auditable withdrawal record.
router.post('/merchant/:merchantId/payout/crypto', async (req, res) => {
  const { merchantId } = req.params as any;
  const { amount_usd, asset, address, network, travelRule, sender_mode, authorizedPerson, businessInfo, payoutReason } = req.body as any;

  if (!amount_usd || amount_usd <= 0 || !asset || !address || !network) return res.status(400).json({ error: 'Invalid payload' });

  // Validate authorized person information
  if (!authorizedPerson?.name || !authorizedPerson?.role || !authorizedPerson?.email) {
    return res.status(400).json({ error: 'Authorized person information required (name, role, email)' });
  }

  // Validate business information
  if (!businessInfo?.businessName || !businessInfo?.businessAddress) {
    return res.status(400).json({ error: 'Business information required (businessName, businessAddress)' });
  }

  const assetUpper = String(asset).toUpperCase();
  const amount = Number(amount_usd);
  const isUsdt = assetUpper === 'USDT';
  const ref = `DEL-${Date.now()}`;

  // Log payout authorization
  console.log(
    `[Payout Authorization] Merchant: ${merchantId}, Amount: ${amount_usd} ${assetUpper}, ` +
    `Authorized by: ${authorizedPerson.name} (${authorizedPerson.role}) <${authorizedPerson.email}>, ` +
    `Business: ${businessInfo.businessName}`
  );

  // sender_mode (who signs the on-chain tx / pays the USDT):
  //   'customer_origin' → BEST OPTION. $0 operator USDT ever. Customer signs from THEIR own external wallet.
  //                       Pass origin_address = "T... customer's TronLink/Klever address".
  //   'netting'         → P2P atomic netting. Pass deposit_candidate = { deposit_customer_id, deposit_origin_address, deposit_amount_usdt }.
  //   'treasury'        → treasury wallet signs (holds real USDT for settlement). YOU opted OUT earlier; only enable if funded.
  //   'hot'             → hot wallet signs (holds only gas; will typically defer to auto-retry queue).
  //   undefined/'auto'  → (1) customer_origin if origin_address provided.
  //                       (2) netting if deposit_candidate provided.
  //                       (3) treasury if configured & has USDT.
  //                       (4) hot wallet (deferred_broadcast fallback).
  type ParsedSenderMode = 'customer_origin' | 'netting' | 'hot' | 'treasury' | 'auto';
  const parsedSenderMode: ParsedSenderMode =
    sender_mode === 'customer_origin' ? 'customer_origin' :
    sender_mode === 'netting'         ? 'netting'         :
    sender_mode === 'treasury'        ? 'treasury'        :
    sender_mode === 'hot'             ? 'hot'             :
                                        'auto';

  // Optional extras:
  //   origin_address     — T-address. Used for customer_origin mode. Customer's external wallet that HOLDS the real USDT.
  //   signed_tx          — Optional. If you already have a customer-origin pre-signed tx, skip Step 1 and go straight to relay.
  //   deposit_candidate  — { deposit_customer_id, deposit_origin_address, deposit_amount_usdt }. Used for Option B netting.
  const originAddress = (req.body as any)?.origin_address as string | undefined;
  const signedTx      = (req.body as any)?.signed_tx     as any    | undefined;
  const depositCandidate = (req.body as any)?.deposit_candidate as
    | { deposit_customer_id: string; deposit_origin_address: string; deposit_amount_usdt: number }
    | undefined;

  let withdrawalResult: any = { note: 'Internal ledger entry finalised — awaiting on-chain settlement.' };
  let provider: string = 'tronweb';
  let finalStatus: WithdrawalStatus = 'pending_manual';
  let travelRuleTrId: number | null = null;
  let txUrl: string | null = null;

  try {
    await debitMerchantWallet(merchantId, amount, 'payout_crypto', `crypto_withdrawal:${asset}:${ref}`, { asset, address, network, ref });

    const xr = await import('../../exchange/exchange-router.service');
    const priority = xr.getProviderPriority();

    const looksLikeTron = xr.isTronAddress(address);
    const looksLikeEvm = xr.isEvmAddress(address);
    let directRail: 'tronweb' | 'bscweb' | 'polygonweb' | null = null;
    if (isUsdt) {
      directRail = await xr.detectDirectRailForDestination(address, network);
    }

    // ──────────────────────────────────────────────────────────────────────
    // OPTION A — CUSTOMER-PAYS-ORIGIN (0 operator USDT EVER)
    // On-chain sender = CUSTOMER'S OWN EXTERNAL WALLET (origin_address).
    // We never hold USDT. We only relay the pre-signed tx.
    // Hot wallet: $0 USDT. Pure gas / relay.
    // ──────────────────────────────────────────────────────────────────────
    const wantsCustomerOrigin =
      (parsedSenderMode === 'customer_origin') ||
      (parsedSenderMode === 'auto' && !!originAddress);

    if (wantsCustomerOrigin && isUsdt && directRail === 'tronweb') {
      if (!originAddress?.startsWith('T')) {
        finalStatus = 'pending_manual';
        provider = 'customer-origin-tron';
        withdrawalResult = {
          reason: 'customer_origin_missing_origin_address',
          manual_review: true,
          error: 'customer_origin sender_mode requires origin_address (customer external T-wallet that holds USDT to sign & send).',
          required_payload: {
            origin_address: 'Txxxxxx customer TronLink/Klever address that holds the USDT on-chain',
            destination: address,
            amount,
            asset: 'USDT',
            network,
            note: 'You can also pass signed_tx = <signed JSON tx> directly after building with /api/admin/customer-origin/prepare.',
          },
        };
      } else if (signedTx) {
        // Step 1 already done on client. Just relay.
        try {
          const relay = await xr.relayCustomerSignedTransfer(signedTx);
          finalStatus = 'completed';
          provider = 'customer-origin-tron';
          txUrl = relay.txId ? `https://tronscan.org/#/transaction/${relay.txId}` : null;
          withdrawalResult = {
            ...relay,
            origin: originAddress,
            destination: address,
            operator_usdt_held_at_any_step: 0,
          };
        } catch (e: any) {
          finalStatus = 'pending_manual';
          provider = 'customer-origin-tron';
          withdrawalResult = {
            reason: 'customer_origin_relay_failed_pending_manual',
            manual_review: true,
            error: String(e?.message || String(e)),
            origin: originAddress,
            destination: address,
            amount,
          };
        }
      } else {
        // Step 1: build unsigned tx for customer to sign. Return it to caller. Customer signs offline & posts back via /api/admin/customer-origin/submit.
        try {
          const unsigned = await xr.prepareCustomerOriginTrc20Transfer(originAddress, address, amount);
          finalStatus = 'pending_manual';  // not yet broadcast — waiting for customer signature
          provider = 'customer-origin-tron';
          withdrawalResult = {
            reason: 'customer_origin_unsigned_ready_for_signature',
            manual_review: false,
            auto_relayable_after_signature: true,
            customer_step:
              'Pass unsigned_tx below to the customer. They sign it with TronLink / Klever with their own private key (origin_address owner). ' +
              'They return signed_tx to operator. Caller submits via /api/admin/customer-origin/submit. ' +
              'Operator NEVER holds USDT. Hot wallet involvement = 0 USDT.',
            unsigned_tx: unsigned.unsignedTx,
            tx_id: unsigned.txID,
            origin: originAddress,
            destination: address,
            amount: unsigned.to_amount,
            operator_usdt_held_at_any_step: 0,
            how_to_sign:
              'customer opens their wallet, signs unsigned_tx raw_data_hex / raw_data with their own private key, ' +
              'appends signature: [r,s,v] hex array, returns signed_tx JSON.',
          };
        } catch (e: any) {
          finalStatus = 'pending_manual';
          provider = 'customer-origin-tron';
          withdrawalResult = {
            reason: 'customer_origin_build_failed_pending_manual',
            manual_review: true,
            error: String(e?.message || String(e)),
            origin: originAddress,
            destination: address,
            amount,
          };
        }
      }
    }
    // ──────────────────────────────────────────────────────────────────────
    // OPTION B — P2P ATOMIC NETTING (0 operator USDT EVER)
    // Match Withdrawer A against Depositor B in same 24h epoch.
    // On-chain: B_ext → A_ext (single tx, B signs via customer-origin above).
    // SQL:      debit A, credit B.
    // Operator $0 USDT at any step.
    // ──────────────────────────────────────────────────────────────────────
    else if (parsedSenderMode === 'netting' || (parsedSenderMode === 'auto' && !!depositCandidate)) {
      if (!depositCandidate?.deposit_origin_address || !depositCandidate?.deposit_customer_id) {
        finalStatus = 'pending_manual';
        provider = 'atomic-netting';
        withdrawalResult = {
          reason: 'netting_missing_deposit_candidate',
          manual_review: true,
          error: 'netting sender_mode requires deposit_candidate = { deposit_customer_id, deposit_origin_address, deposit_amount_usdt }.',
        };
      } else {
        const match = xr.proposeAtomicNettingPair({
          withdraw_customer_id: merchantId,
          withdraw_dest_address: address,
          withdraw_amount_usdt: amount,
          deposit_candidate: depositCandidate,
        });
        if (match.match) {
          // Step 1: build unsigned tx for DEPOSITOR B to sign (B sends → A's destination).
          //         Customer B sign with their origin wallet. Caller posts back signed_tx to relay endpoint above.
          const params = match.customerOriginParams!;
          let unsigned: any = null;
          try {
            unsigned = await xr.prepareCustomerOriginTrc20Transfer(
              params.customerOriginAddress,
              params.destExternalAddress,
              params.amountUsdt
            );
          } catch {}
          finalStatus = 'pending_manual';  // pending B's signature
          provider = 'atomic-netting';
          withdrawalResult = {
            reason: 'atomic_netting_match_ready_for_depositor_signature',
            manual_review: false,
            auto_relayable_after_signature: true,
            netting_proposal: {
              net_amount_usdt: match.net_withdraw_amount_usdt,
              depositor_remainder_usdt: match.deposit_remainder_usdt,
              depositor_customer_id: depositCandidate.deposit_customer_id,
              withdrawer_customer_id: merchantId,
              depositor_origin_address: depositCandidate.deposit_origin_address,
              withdrawer_destination_address: address,
            },
            customer_signature_step: unsigned ? {
              unsigned_tx: unsigned.unsignedTx,
              tx_id: unsigned.txID,
              who_signs: 'DEPOSITOR (B) origin address owner. They send exactly this unsigned tx to withdrawer.',
              sql_to_run_after_relay: [
                `UPDATE customer_crypto_wallets SET balance = balance - ${match.net_withdraw_amount_usdt} WHERE customer_id = '${merchantId}' AND crypto_coin = 'USDT';`,
                `UPDATE customer_crypto_wallets SET balance = balance + ${match.net_withdraw_amount_usdt} WHERE customer_id = '${depositCandidate.deposit_customer_id}' AND crypto_coin = 'USDT';` +
                (match.deposit_remainder_usdt > 0
                  ? ` UPDATE customer_crypto_wallets SET balance = balance + ${match.deposit_remainder_usdt} WHERE customer_id = '${depositCandidate.deposit_customer_id}' AND crypto_coin = 'USDT';  -- remainder after net`
                  : ''),
              ],
              operator_usdt_held_at_any_step: 0,
            } : null,
            note: match.note,
          };
        } else {
          finalStatus = 'pending_manual';
          provider = 'atomic-netting';
          withdrawalResult = {
            reason: 'atomic_netting_match_failed',
            manual_review: true,
            note: match.note,
          };
        }
      }
    }
    else if (directRail) {
      // ── Fallback options (treasury / hot / exchange) — treasury was your rejected option.
      // ── Address mismatch → needs human (wrong format cannot auto-retry) ──
      if (directRail === 'tronweb' && !looksLikeTron) {
        finalStatus = 'pending_manual';
        provider = directRail;
        withdrawalResult = {
          reason: 'invalid_tron_address_pending_review',
          manual_review: true,
          error: 'Invalid TRC-20 address: must start with T and be 34+ chars. Re-enter destination address for on-chain settlement.',
          address_provided: address,
        };
      } else if ((directRail === 'bscweb' || directRail === 'polygonweb') && !looksLikeEvm) {
        finalStatus = 'pending_manual';
        provider = directRail;
        withdrawalResult = {
          reason: 'invalid_evm_address_pending_review',
          manual_review: true,
          error: `Invalid EVM (0x) address for ${directRail.toUpperCase()}. Re-enter destination address for on-chain settlement.`,
          address_provided: address,
        };
      } else {
        // ── Try direct rail broadcast. Who signs? Determined by parsedSenderMode:
        //    'treasury' → treasury wallet (holds real USDT; hot wallet = gas ONLY)
        //    'hot'      → hot wallet signs (typically defers; only useful if user wants deferred queue)
        //    'auto'     → treasury FIRST if configured & has USDT; else hot wallet (may defer)
        try {
          // Only treasury/hot/auto reach this branch; customer_origin & netting
          // are handled in the earlier higher-priority branches above.
          const fallBackSenderMode: 'auto' | 'hot' | 'treasury' =
            parsedSenderMode === 'treasury' ? 'treasury' :
            parsedSenderMode === 'hot'      ? 'hot'      :
                                              'auto';
          withdrawalResult = await xr.directRailWithdraw(directRail, assetUpper, address, amount, {
            senderMode: fallBackSenderMode,
          });
          provider = String(withdrawalResult.provider || directRail);
          if (withdrawalResult.deferred) {
            const senderRole = (withdrawalResult.raw as any)?.senderRole || 'hot';
            const senderName = senderRole === 'treasury' ? 'Treasury' : 'Hot wallet';
            finalStatus = 'deferred_broadcast';
            withdrawalResult = {
              ...withdrawalResult,
              reason: `${senderRole.toLowerCase()}_wallet_usdt_insufficient_deferred`,
              auto_retryable: true,
              manual_review: false,
              retry_policy:
                `Background retry daemon scans all merchant_crypto_withdrawals with status='deferred_broadcast' ` +
                `every 5 minutes and retries broadcast once ${senderName.toLowerCase()} ${assetUpper} balance >= ${amount}.`,
              deferred_note: withdrawalResult.note,
              sender_role: senderRole,
            };
          } else {
            finalStatus = 'completed';
            txUrl = withdrawalResult.txUrl || null;
            withdrawalResult = {
              ...withdrawalResult,
              sender_role: (withdrawalResult.raw as any)?.senderRole || 'hot',
            };
          }
        } catch (ex: any) {
          // Broadcast error is GAS failure or network (USDT was already checked by deferred path above).
          // Gas needs a human to top up native TRX/BNB/MATIC → pending_manual.
          finalStatus = 'pending_manual';
          provider = directRail;
          withdrawalResult = {
            reason: `${directRail}_broadcast_failed_pending_manual`,
            manual_review: true,
            error: String(ex?.message || String(ex)),
            note:
              'Merchant wallet debit FINAL. On-chain broadcast could not execute. ' +
              'Typical cause: insufficient native gas (TRX / BNB / MATIC) on hot wallet. ' +
              'Top up gas and retry manually, or enable deferred_broadcast auto-retry cron.',
          };
        }
      }
    } else {
      // ── Exchange path (non-USDT or no direct rail detected) ──
      let fallbackDirectRail: 'tronweb' | 'bscweb' | 'polygonweb' | null = null;
      let lastExchangeError = '';
      try {
        const clientWithdrawOrderId = travelRule?.withdrawOrderId
          ? String(travelRule.withdrawOrderId)
          : `MERCH-${merchantId.slice(0, 8)}-${Date.now()}`;
        const attempt = await xr.exchangeWithdrawBestEffort(assetUpper, address, network, amount, {
          questionnaire: travelRule?.questionnaire,
          withdrawOrderId: clientWithdrawOrderId,
          originatorPii: travelRule?.originatorPii,
          addressTag: travelRule?.addressTag,
          addressName: travelRule?.addressName,
          transactionFeeFlag: travelRule?.transactionFeeFlag,
          walletType: travelRule?.walletType,
          recvWindow: travelRule?.recvWindow,
          networkOverride: travelRule?.networkOverride,
          useBrokerEndpoint: travelRule?.useBrokerEndpoint,
        });
        if (attempt.result.ok && attempt.result.accepted) {
          withdrawalResult = attempt.result;
          provider = (attempt.providerUsed === 'binance_broker' ? 'binance_broker' : (attempt.providerUsed === 'kucoin' ? 'kucoin' : (attempt.providerUsed === 'manual' ? 'failed' : 'binance')));
          travelRuleTrId = typeof attempt.result.trId === 'number' ? attempt.result.trId : null;
          finalStatus = 'completed';
        } else if (attempt.lastError && (attempt.lastError.includes('-4104') || attempt.lastError.toLowerCase().includes('travel rule'))) {
          lastExchangeError = attempt.lastError;
          if (isUsdt && looksLikeTron) fallbackDirectRail = 'tronweb';
          else if (isUsdt && looksLikeEvm) {
            const probeBsc = await import('../../exchange/bscweb.service');
            if (probeBsc.isConfigured && probeBsc.isConfigured()) fallbackDirectRail = 'bscweb';
            else {
              const probePoly = await import('../../exchange/polygonweb.service');
              if (probePoly.isConfigured && probePoly.isConfigured()) fallbackDirectRail = 'polygonweb';
              else fallbackDirectRail = 'bscweb';
            }
          } else {
            // Travel Rule + no alt rail for this asset → HUMAN needed (submit Travel Rule, change network)
            finalStatus = 'pending_manual';
            provider = 'failed';
            withdrawalResult = {
              reason: 'travel_rule_blocked_no_alt_rail_available',
              manual_review: true,
              error: lastExchangeError,
              note:
                'Merchant wallet debit FINAL. Travel Rule blocked exchange path and no direct-rail ' +
                'available for this asset/network pair. Complete Travel Rule submission at exchange ' +
                'or choose a direct-rail-capable network (USDT on TRC20 / BEP20 / Polygon ERC-20).',
            };
          }
        } else {
          const isAuthFail = String(attempt.lastError || '').includes('401') || String(attempt.lastError || '').includes('-1002');
          if (isAuthFail) {
            // API key rotation needed → human required
            finalStatus = 'pending_manual';
            provider = 'failed';
            withdrawalResult = {
              reason: 'exchange_auth_failure',
              manual_review: true,
              error: attempt.lastError,
              note:
                'Merchant wallet debit FINAL. Exchange API credentials invalid or expired. ' +
                'Rotate API keys in .env and retry broadcast manually — or switch to direct blockchain rail.',
            };
          } else {
            finalStatus = 'pending_manual';
            provider = 'failed';
            withdrawalResult = {
              reason: 'exchange_withdraw_failed_pending_manual',
              manual_review: true,
              error: attempt.lastError || 'Unknown exchange error',
              provider_priority_tried: priority,
              fallback_hint: isUsdt
                ? 'For USDT use network TRC20/TRX + T-address, or BSC/BEP20 + 0x-address for direct blockchain rails (0 Travel Rule).'
                : undefined,
              note:
                'Merchant wallet debit FINAL. Exchange path failed. ' +
                'Resolve underlying exchange error or switch to direct blockchain rail.',
            };
          }
        }
      } catch (ex: any) {
        lastExchangeError = String(ex?.message || String(ex));
        if (isUsdt && looksLikeTron) fallbackDirectRail = 'tronweb';
        else if (isUsdt && looksLikeEvm) fallbackDirectRail = 'bscweb';
      }

      // ── Fallback to direct rail after exchange failure ──
      if (fallbackDirectRail) {
        try {
          console.log(`[MerchantPayout:Crypto] Exchange blocked, using ${fallbackDirectRail} fallback: ${amount} USDT → ${address}`);
          withdrawalResult = await xr.directRailWithdraw(fallbackDirectRail, assetUpper, address, amount);
          provider = fallbackDirectRail;
          if (withdrawalResult.deferred) {
            // Fallback rail works but lacks USDT balance → still auto-retryable.
            finalStatus = 'deferred_broadcast';
            withdrawalResult = {
              ...withdrawalResult,
              reason: 'fallback_hot_wallet_usdt_insufficient_deferred',
              auto_retryable: true,
              manual_review: false,
              original_exchange_error: lastExchangeError,
              retry_policy:
                `Background retry daemon scans all merchant_crypto_withdrawals with status='deferred_broadcast' ` +
                `every 5 minutes and retries broadcast once hot wallet ${assetUpper} balance >= ${amount}.`,
              deferred_note: withdrawalResult.note,
            };
          } else {
            finalStatus = 'completed';
            txUrl = withdrawalResult.txUrl || null;
          }
        } catch (railErr: any) {
          // Both paths failed → usually gas issue or system issue. Human needed.
          finalStatus = 'pending_manual';
          provider = fallbackDirectRail;
          withdrawalResult = {
            reason: `${fallbackDirectRail}_fallback_failed_pending_manual`,
            manual_review: true,
            error: String(railErr?.message || String(railErr)),
            original_exchange_error: lastExchangeError,
            note:
              'Merchant wallet debit FINAL. Both exchange path and direct-rail fallback could not broadcast on-chain. ' +
              'Typical causes: hot wallet has no native gas (TRX/BNB/MATIC), or downstream service unavailable. ' +
              'Operator to resolve manually.',
          };
        }
      }
    }

    // ── ALWAYS persist withdrawal record (accounting final) ────────────────
    const withdrawalId = uuidv4();
    const savedMeta: any = typeof withdrawalResult === 'object' && withdrawalResult !== null ? { ...withdrawalResult } : { ref: String(withdrawalResult) };
    savedMeta.provider = provider;
    savedMeta.provider_priority = priority;
    savedMeta.ref = ref;
    savedMeta.debit_final = true;
    if (travelRuleTrId) savedMeta.trId = travelRuleTrId;
    
    // Add authorized person and business information to meta
    savedMeta.authorizedPerson = authorizedPerson;
    savedMeta.businessInfo = businessInfo;
    if (payoutReason) savedMeta.payoutReason = payoutReason;
    savedMeta.authorizedAt = new Date().toISOString();
    
    await db.query(
      `INSERT INTO merchant_crypto_withdrawals (id, merchant_id, amount_usd, asset, address, network, status, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [withdrawalId, merchantId, amount, assetUpper, address, network, finalStatus, JSON.stringify(savedMeta)]
    );

    // ── Response: always OK (200) when accounting is final ────────────────
    const resp: any = {
      ok: true,
      ref,
      withdrawal_id: withdrawalId,
      amount,
      asset: assetUpper,
      address,
      network,
      status: finalStatus,
      provider,
      provider_priority: priority,
      travel_rule_tr_id: travelRuleTrId,
      exchange_withdrawal: withdrawalResult,
      txUrl: txUrl || (provider === 'tronweb' && withdrawalResult?.txId ? `https://tronscan.org/#/transaction/${withdrawalResult.txId}` : null),
      debit_final: true,
    };
    if (finalStatus === 'completed') {
      resp.summary =
        `${amount} ${assetUpper} SPOT DEDUCTED from merchant internal wallet (final). ` +
        `On-chain ${provider.toUpperCase()} broadcast complete.`;
      resp.action_required = false;
    } else if (finalStatus === 'deferred_broadcast') {
      resp.summary =
        `${amount} ${assetUpper} SPOT DEDUCTED from merchant internal wallet (final). ` +
        `On-chain ${provider.toUpperCase()} broadcast DEFERRED: hot wallet has insufficient ${assetUpper} balance. ` +
        `Will auto-retry via background daemon every 5 min once hot wallet balance >= ${amount}. ` +
        `Gas (native ${provider === 'tronweb' ? 'TRX' : provider === 'bscweb' ? 'BNB' : 'MATIC'}) to be paid from hot wallet native reserve.`;
      resp.action_required = false;
      resp.auto_retryable = true;
    } else {
      // pending_manual / failed
      resp.summary =
        `${amount} ${assetUpper} SPOT DEDUCTED from merchant internal wallet (final). ` +
        (withdrawalResult?.note ||
          'On-chain settlement blocked — pending_manual operator review required.');
      resp.action_required = true;
    }
    res.json(resp);
  } catch (e: any) {
    console.error('Crypto payout unexpected error (debit already final if executed)', e);
    // Even in unexpected catch — if we got past debitMerchantWallet we want a record.
    // Safest: persist what we can, tell the caller accounting may already be deducted.
    try {
      const fallbackId = uuidv4();
      await db.query(
        `INSERT INTO merchant_crypto_withdrawals (id, merchant_id, amount_usd, asset, address, network, status, meta) VALUES (?, ?, ?, ?, ?, ?, 'pending_manual', ?)`,
        [fallbackId, merchantId, amount, assetUpper, address, network, JSON.stringify({
          ref, provider, error: String(e?.message || String(e)),
          debit_final: 'UNKNOWN_OPERATOR_VERIFY_LEDGER',
          note:
            'Unexpected exception during crypto payout — verify ledger entries and on-chain state manually. ' +
            'If merchant wallet was debited, amount is FINAL.',
        })]
      );
    } catch { /* DB down — nothing more to do */ }
    res.json({
      ok: true,
      ref,
      status: 'pending_manual',
      error: String(e?.message || String(e)),
      debit_final: 'VERIFY_LEDGER',
      action_required: true,
      summary:
        `${amount} ${assetUpper} payout processing exception. Verify merchant wallet ledger state. ` +
        `If debited, entry is FINAL — pending_manual on-chain settlement required.`,
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN ENDPOINTS — CUSTOMER-PAYS-ORIGIN (0 operator USDT forever)
//
// Two-step handshake:
//   1. POST /api/admin/customer-origin/prepare
//        → build unsigned tx JSON for CUSTOMER to sign with THEIR wallet.
//        → Operator NEVER sees customer private key. Operator NEVER holds USDT.
//   2. POST /api/admin/customer-origin/submit
//        → customer returns signed_tx JSON to operator.
//        → Operator relays signed tx to chain (hot wallet $0 USDT involved).
//   Result:
//        USDT.transfer(CUSTOMER'S origin → destination external address).
//        Operator balance sheet USDT: $0 at all steps. Hot wallet: gas sponsor optional.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Step 1 — Build unsigned USDT TRC-20 transfer for CUSTOMER to sign.
 * POST /api/admin/customer-origin/prepare  (crypto.router already mounted under /api → final path = /api/admin/...)
 * Body:
 *   {
 *     origin_address:   "T...",   // Customer's external Tron wallet (HAS THE USDT on-chain).
 *     destination:      "T...",   // Final destination where they want it.
 *     amount_usdt:      30
 *   }
 */
router.post('/admin/customer-origin/prepare', async (req, res) => {
  const { origin_address, destination, amount_usdt } = req.body as any;
  if (!origin_address || !destination || !amount_usdt || Number(amount_usdt) <= 0) {
    return res.status(400).json({ error: 'Missing origin_address, destination, amount_usdt.' });
  }
  const xr = await import('../../exchange/exchange-router.service');
  try {
    const result = await xr.prepareCustomerOriginTrc20Transfer(
      String(origin_address),
      String(destination),
      Number(amount_usdt)
    );
    return res.json({
      ok: true,
      operator_usdt_held_at_any_step: 0,
      unsigned_tx: result.unsignedTx,
      tx_id: result.txID,
      amount: result.to_amount,
      origin: result.from,
      destination: result.to,
      contract: result.contract,
      note: result.note + `  Customer signs with their own private key and returns signed_tx to /api/admin/customer-origin/submit.`,
      how_to_sign: [
        'Option A (TronLink / Klever): customer imports unsigned_tx.raw_data_hex into TronScript signTx() call with their private key. Append signature array to the tx.',
        'Option B (raw signing): sign tx.txID with secp256k1. Append signature: [r (32 bytes) + s (32 bytes) + v (1 byte recoveryParam)] hex as single string inside signature: [].',
        'Return the signed object { ...tx, signature: ["...hex..."] } back to /api/admin/customer-origin/submit endpoint.',
      ],
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: String(e?.message || String(e)) });
  }
});

/**
 * Step 2 — Relay pre-signed customer-origin USDT transfer.
 * POST /api/admin/customer-origin/submit  (crypto.router already mounted under /api → final path = /api/admin/...)
 * Body:
 *   {
 *     signed_tx: { ...tx, signature: ["...r+s+v hex..."] }
 *   }
 *
 * Operator NEVER held USDT. Hot wallet: 0 USDT.
 */
router.post('/admin/customer-origin/submit', async (req, res) => {
  const { signed_tx } = req.body as any;
  if (!signed_tx?.signature?.length) {
    return res.status(400).json({ error: 'signed_tx missing. Must contain signature: ["hex r+s+v"].' });
  }
  const xr = await import('../../exchange/exchange-router.service');
  try {
    const result = await xr.relayCustomerSignedTransfer(signed_tx);
    return res.json({
      ok: result.broadcast,
      tx_id: result.txId,
      tx_url: result.txId ? `https://tronscan.org/#/transaction/${result.txId}` : null,
      operator_usdt_held_at_any_step: result.operatorUsdtHeld,
      hot_wallet_held_usdt: 0,
      note: result.note,
    });
  } catch (e: any) {
    return res.status(400).json({ ok: false, error: String(e?.message || String(e)) });
  }
});

export default router;
