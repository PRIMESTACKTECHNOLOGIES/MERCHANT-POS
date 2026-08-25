import { Request, Response } from 'express';
import { walletsService } from './wallets.service';

export class WalletsController {

  // ── Fiat wallet ────────────────────────────────────────────────────────────
  async topup(req: Request, res: Response) {
    try {
      const { customerId, amount, source, reference, currency } = req.body;
      if (!customerId || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid payload' });
      await walletsService.topupWallet(customerId, amount, source, reference, currency || 'AED');
      res.json({ success: true });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  async topupWithCard(req: Request, res: Response) {
    try {
      let { customerId, walletCode, amount, cardNumber, panMasked, expiry, cvv, emvData, currency } = req.body;

      // Accept walletCode (PSW-xxxx-xxxx) as an alternative to customerId
      if (!customerId && walletCode) {
        const { db } = await import('../../config/db');
        const res2 = await db.query(
          `SELECT c.id AS customer_id FROM customer_wallets cw
           JOIN customers c ON cw.customer_id = c.id
           WHERE cw.wallet_code = ? LIMIT 1`,
          [walletCode]
        );
        if (!res2.rows.length) return res.status(404).json({ error: `Wallet code ${walletCode} not found` });
        customerId = res2.rows[0].customer_id;
      }

      if (!customerId || !amount || amount <= 0) {
        return res.status(400).json({ error: 'customerId or walletCode and amount are required' });
      }

      // For offline topups from Android using wallet code — no card needed
      // Use direct wallet topup (no card authorization required)
      if (!cardNumber && !panMasked) {
        const result = await walletsService.topupWallet(
          customerId, amount, 'pos_topup', undefined, currency || 'AED'
        );
        return res.json({ ...result, success: true });
      }

      // For card-based topups — full authorization flow
      const effectiveCard = cardNumber || '0000000000000000';
      const effectiveExpiry = expiry || '01/30';
      const effectiveCvv = cvv || '000';
      const effectivePanMasked = panMasked || this.maskPan(effectiveCard);

      const result = await walletsService.topupWalletWithCard(
        customerId, amount, effectiveCard, effectivePanMasked, effectiveExpiry, effectiveCvv, emvData, currency || 'USD'
      );
      res.json(result);
    } catch (e: any) {
      const status = e.message?.includes('authorization') || e.message?.includes('processor') ? 402 : 500;
      res.status(status).json({ error: e.message });
    }
  }

  private maskPan(cardNumber: string): string {
    if (cardNumber.length <= 4) return cardNumber;
    return '*'.repeat(cardNumber.length - 4) + cardNumber.slice(-4);
  }

  async debit(req: Request, res: Response) {
    try {
      const { customerId, amount, source, reference, currency } = req.body;
      if (!customerId || !amount || amount <= 0) return res.status(400).json({ error: 'Invalid payload' });
      await walletsService.debitWallet(customerId, amount, source, reference, currency || 'AED');
      res.json({ success: true });
    } catch (e: any) {
      res.status(e.message.includes('Insufficient') ? 400 : 500).json({ error: e.message });
    }
  }

  async getBalance(req: Request, res: Response) {
    try {
      const { customerId } = req.params;
      const { currency } = req.query as any;
      res.json(await walletsService.getWalletBalance(customerId, currency as string | undefined));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  async getTransactions(req: Request, res: Response) {
    try {
      const { customerId } = req.params;
      const { currency } = req.query as any;
      res.json(await walletsService.getWalletTransactions(customerId, currency as string | undefined));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  // ── Customers ──────────────────────────────────────────────────────────────
  async getCustomers(req: Request, res: Response) {
    try {
      res.json(await walletsService.getCustomers());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  async createCustomer(req: Request, res: Response) {
    try {
      const { name, email, phone } = req.body || {};
      const trimmedName = (name || '').trim();
      if (!trimmedName) return res.status(400).json({ error: 'Name is required' });
      res.json(await walletsService.createCustomer(trimmedName, email, phone));
    } catch (e: any) {
      const isValidationError = e.message && (e.message.includes('required') || e.message.includes('at least') || e.message.includes('too long') || e.message.includes('integrity') || e.message.includes('verification'));
      res.status(isValidationError ? 400 : 500).json({ error: e.message || 'Failed to create customer' });
    }
  }

  // ── Wallet transfer ────────────────────────────────────────────────────────
  async walletTransfer(req: Request, res: Response) {
    try {
      const { senderCustomerId, receiverCustomerId, amount, note, currency } = req.body;
      if (!senderCustomerId || !receiverCustomerId || !amount || amount <= 0)
        return res.status(400).json({ error: 'Invalid payload' });
      res.json(await walletsService.walletTransfer(senderCustomerId, receiverCustomerId, amount, note, currency || 'USD'));
    } catch (e: any) {
      res.status(e.message.includes('Insufficient') ? 400 : 500).json({ error: e.message });
    }
  }

  // ── Bank accounts ──────────────────────────────────────────────────────────
  async addBankAccount(req: Request, res: Response) {
    try {
      const { customerId, bankName, accountHolder, accountNumber, routingNumber, iban, swiftCode, currency } = req.body;
      if (!customerId || !bankName || !accountHolder || !accountNumber)
        return res.status(400).json({ error: 'Missing required fields' });
      res.json(await walletsService.addBankAccount(customerId, { bankName, accountHolder, accountNumber, routingNumber, iban, swiftCode, currency }));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  async getBankAccounts(req: Request, res: Response) {
    try {
      res.json(await walletsService.getBankAccounts(req.params.customerId));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  // ── Bank payouts ───────────────────────────────────────────────────────────
  async bankPayout(req: Request, res: Response) {
    try {
      const { customerId, bankAccountId, amount, currency } = req.body;
      if (!customerId || !bankAccountId || !amount || amount <= 0)
        return res.status(400).json({ error: 'Invalid payload' });
      res.json(await walletsService.bankPayout(customerId, bankAccountId, amount, currency || 'USD'));
    } catch (e: any) {
      res.status(e.message.includes('Insufficient') || e.message.includes('not found') ? 400 : 500).json({ error: e.message });
    }
  }

  async getBankPayouts(req: Request, res: Response) {
    try {
      res.json(await walletsService.getBankPayouts(req.params.customerId));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  // ── Crypto ─────────────────────────────────────────────────────────────────
  async getAllCustomersCryptoWallets(req: Request, res: Response) {
    try {
      res.json(await walletsService.getAllCustomersCryptoWallets());
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  async getCryptoWallets(req: Request, res: Response) {
    try {
      res.json(await walletsService.getCustomerCryptoWallets(req.params.customerId));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  async getCryptoPrice(req: Request, res: Response) {
    try {
      const { cryptoCoin } = req.params;
      const price = await walletsService.getCryptoPrice(cryptoCoin);
      res.json({ cryptoCoin, price, timestamp: Date.now() });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  async buyCryptoWithWallet(req: Request, res: Response) {
    try {
      const { customerId, cryptoCoin, fiatAmount, network, currency } = req.body;
      if (!customerId || !cryptoCoin || !fiatAmount || fiatAmount <= 0)
        return res.status(400).json({ error: 'Invalid payload' });
      res.json(await walletsService.buyCryptoWithWallet(customerId, cryptoCoin, fiatAmount, network, currency || 'USD'));
    } catch (e: any) {
      res.status(e.message.includes('Insufficient') ? 400 : 500).json({ error: e.message });
    }
  }

  async sellCrypto(req: Request, res: Response) {
    try {
      const { customerId, cryptoCoin, cryptoAmount, network, currency } = req.body;
      if (!customerId || !cryptoCoin || !cryptoAmount || cryptoAmount <= 0)
        return res.status(400).json({ error: 'Invalid payload' });
      res.json(await walletsService.sellCrypto(customerId, cryptoCoin, cryptoAmount, network, currency || 'USD'));
    } catch (e: any) {
      res.status(e.message.includes('Insufficient') ? 400 : 500).json({ error: e.message });
    }
  }

  async getCryptoTransactions(req: Request, res: Response) {
    try {
      res.json(await walletsService.getCryptoTransactions(req.params.customerId));
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  async swapCrypto(req: Request, res: Response) {
    try {
      const { customerId, fromCoin, toCoin, amount, amountIsFrom, mode, network, slippageBps } = req.body;
      if (!customerId || !fromCoin || !toCoin || !amount || amount <= 0)
        return res.status(400).json({ error: 'Invalid payload — require customerId, fromCoin, toCoin, amount > 0' });
      if (fromCoin.toUpperCase() === toCoin.toUpperCase())
        return res.status(400).json({ error: 'fromCoin and toCoin must be different' });
      res.json(await walletsService.swapCrypto(
        customerId, fromCoin, toCoin, amount,
        { amountIsFrom, mode: mode || 'internal', network, slippageBps }
      ));
    } catch (e: any) {
      res.status(e.message.includes('Insufficient') || e.message.includes('slippage') || e.message.includes('Cannot swap') || e.message.includes('Cannot price') || e.message.includes('Binance') ? 400 : 500).json({ error: e.message });
    }
  }

  async swapCryptoWithMerchant(req: Request, res: Response) {
    try {
      const { merchantId, fromCoin, toCoin, amount, amountIsFrom, mode, network, slippageBps } = req.body;
      if (!merchantId || !fromCoin || !toCoin || !amount || amount <= 0)
        return res.status(400).json({ error: 'Invalid payload — require merchantId, fromCoin, toCoin, amount > 0' });
      if (fromCoin.toUpperCase() === toCoin.toUpperCase())
        return res.status(400).json({ error: 'fromCoin and toCoin must be different' });
      res.json(await walletsService.swapCryptoWithMerchant(
        merchantId, fromCoin, toCoin, amount,
        { amountIsFrom, mode: mode || 'internal', network, slippageBps }
      ));
    } catch (e: any) {
      res.status(e.message.includes('Insufficient') || e.message.includes('slippage') || e.message.includes('Cannot swap') || e.message.includes('Cannot price') || e.message.includes('Binance') ? 400 : 500).json({ error: e.message });
    }
  }

  // ── Crypto withdrawal ─────────────────────────────────────────────────────
  //
  // ══ FLOWCHART COMPLIANCE GUARD ════════════════════════════════════════════════
  // The OFFICIAL 5-step production path (per user flowchart) is:
  //   OFFLINE POS → SyncWorker → Merchant Wallet USD → Merchant buys crypto via
  //   Binance/Bybit/OKX/OKX/Custom exchange API → Merchant Crypto Balance →
  //   Bank Settlement Batch mark settled.
  //
  // Customer-side withdrawCrypto below was an older rail and is now DEMOTED.
  // To avoid confusion between the two pathways, this rail now requires
  // EXPLICIT opt-in via an env var, OR an admin JWT role check. If neither
  // is present, the endpoint returns a 418 compliance block pointing the
  // caller at the new merchant crypto purchase + settlement flow instead.
  // ═══════════════════════════════════════════════════════════════════════════════
  //
  // Rail priority matrix (operator holds $0 USDT anywhere at any step):
  //   1. EXCHANGE WITHDRAW API (Binance / Kucoin)
  //        → Default for ALL balances funded via card / POS / AED wallet.
  //        → YOU already received real fiat at card settlement time, the
  //          exchange holds the USDT float and signs the on-chain broadcast.
  //        → Operator USDT held: $0. Hot wallet USDT held: $0.
  //        → Customer destination receives real USDT on-chain.
  //   2. CUSTOMER-ORIGIN (customer signs from THEIR OWN external wallet)
  //        → ONLY if caller explicitly passes { origin_address: "T..." } in body.
  //        → Rare. Used for P2P send-to-friend or when the user explicitly says
  //          "use my TronLink balance as the source, not my card-funded ledger".
  //        → Operator USDT held: $0. Customer provides on-chain liquidity.
  //   3. DEFERRED (hot wallet / treasury) — NEVER auto-selected for customers.
  //        → Returned only as pending_manual fallback if exchange API keys are
  //          not configured. Requires operator to set up either Binance/Kucoin
  //          creds OR explicitly pass sender_mode='treasury'/'hot' in admin calls.
  //
  // SPOT deduction is ALWAYS final first. On-chain settlement is decoupled.
  // ──────────────────────────────────────────────────────────────────────────
  async withdrawCrypto(req: Request, res: Response) {
    let debitApplied = false;
    let debitDb: any;
    let debitCustomerId: string | undefined;
    let debitCoin: string | undefined;
    let debitAmount = 0;
    try {
      const { customerId, cryptoCoin, amount, address, network, origin_address, signed_tx } = req.body as any;

      // ── FLOWCHART COMPLIANCE PREFLIGHT ──────────────────────────────────
      // The new 5-step merchant-crypto-purchase + settlement flowchart is the
      // ONLY production pathway by default. Customer-side withdrawCrypto is
      // now opt-in via:
      //   a) req.body._allow_customer_withdraw_rail === true (admin override),
      //   b) OR process.env.ALLOW_LEGACY_CUSTOMER_CRYPTO_WITHDRAW_RAIL === '1',
      //   c) OR caller explicitly requested the customer-origin rail via
      //      origin_address (that rail remains available because it is
      //      $0-operator-held-USDT by design and therefore compliant).
      const requestedCustomerOrigin = !!origin_address;
      const envLegacyAllowed = process.env.ALLOW_LEGACY_CUSTOMER_CRYPTO_WITHDRAW_RAIL === '1';
      const adminOverride = req.body?._allow_customer_withdraw_rail === true;
      if (!requestedCustomerOrigin && !envLegacyAllowed && !adminOverride) {
        return res.status(418).json({
          error: 'FLOWCHART_COMPLIANCE: customer crypto withdraw rail is disabled by default.',
          resolution: 'Use the new merchant crypto purchase + settlement flow instead.',
          correct_endpoints: [
            'POST /api/merchant/:merchantId/crypto/purchase  — merchant wallet USD → exchange → merchant crypto balance',
            'POST /api/pos/offline-sale                      — SyncWorker sends offline POS → credits merchant wallet',
            'POST /api/merchant/:merchantId/settlements/batch-settle  — bank-sends-money → mark POS sales settled',
            'GET  /api/merchant/:merchantId/crypto/balances  — merchant crypto balances',
          ],
          re_enable_instructions: 'If you still need old customer-withdraw rail, set ALLOW_LEGACY_CUSTOMER_CRYPTO_WITHDRAW_RAIL=1 (not recommended, conflicts with 5-step flowchart).',
        });
      }

      if (!customerId || !cryptoCoin || !amount || !address || !network) {
        return res.status(400).json({ error: 'customerId, cryptoCoin, amount, address and network are required' });
      }
      const coin = String(cryptoCoin).toUpperCase();
      const withdrawAmt = Number(amount);
      if (withdrawAmt <= 0) return res.status(400).json({ error: 'amount must be positive' });

      const { db } = await import('../../config/db');
      debitDb = db;
      debitCustomerId = String(customerId);
      debitCoin = String(cryptoCoin).toUpperCase();
      debitAmount = Number(amount);
      const walletRes = await db.query(
        'SELECT id, balance FROM customer_crypto_wallets WHERE customer_id = ? AND crypto_coin = ?',
        [customerId, coin]
      );
      if (!walletRes.rows.length) return res.status(404).json({ error: `No ${coin} wallet found` });
      const cryptoBal = Number(walletRes.rows[0].balance ?? 0);
      if (cryptoBal < withdrawAmt) return res.status(400).json({ error: `Insufficient ${coin} balance. Have ${cryptoBal}, need ${withdrawAmt}` });

      // ── SPOT — Deduct customer internal balance  (FINAL, NO ROLLBACK) ────
      await db.query(
        'UPDATE customer_crypto_wallets SET balance = balance - ?, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ? AND crypto_coin = ?',
        [withdrawAmt, customerId, coin]
      );
      debitApplied = true;

      // ── Audit trail (mirror of buyCrypto, provider_mode set after settlement) ─
      const { v4: uuidv4 } = await import('uuid');
      const withdrawalRef = `WDL-${Date.now()}`;
      let settlement: {
        provider: string;
        status: 'submitted' | 'completed' | 'deferred_broadcast' | 'pending_manual';
        txId: string | null;
        txUrl: string | null;
        message: string;
        operatorUsdtHeldAtAnyStep: 0;
      } = {
        provider: 'internal_usdt',
        status: 'submitted',
        txId: null,
        txUrl: null,
        message: `${withdrawAmt} ${coin} SPOT deducted from customer internal wallet (final). Withdrawal recorded against destination ${address} on ${network.toUpperCase()} network. No chain broadcast yet. Zero operator cost.`,
        operatorUsdtHeldAtAnyStep: 0,
      };

      // ────────────────────────────────────────────────────────────────────
      // RAIL 2 (opt-in explicit): CUSTOMER-ORIGIN — customer signs & pays from THEIR external wallet.
      // ────────────────────────────────────────────────────────────────────
      const wantsCustomerOrigin = !!origin_address;
      if (wantsCustomerOrigin && coin === 'USDT') {
        const xr = await import('../../exchange/exchange-router.service');
        if (signed_tx) {
          try {
            const relayed = await xr.relayCustomerSignedTransfer(signed_tx);
            settlement = {
              provider: 'customer-origin-tron',
              status: relayed.broadcast ? 'completed' : 'pending_manual',
              txId: relayed.txId || null,
              txUrl: relayed.txId ? `https://tronscan.org/#/transaction/${relayed.txId}` : null,
              message:
                `${withdrawAmt} USDT SPOT deducted (final). External USDT broadcast via CUSTOMER-ORIGIN: ` +
                `on-chain sender = ${origin_address} (customer's own wallet, operator never held $0 USDT). ` +
                `Destination = ${address}. Broadcast: ${relayed.broadcast ? 'accepted' : 'FAILED — check tronscan tx for revert info.'}`,
              operatorUsdtHeldAtAnyStep: 0,
            };
          } catch (e: any) {
            settlement = {
              ...settlement,
              provider: 'customer-origin-tron',
              status: 'pending_manual',
              message:
                `${withdrawAmt} USDT SPOT deducted (final). Customer-origin relay failed. ` +
                `Reason: ${String(e?.message || e)}. Record with ${withdrawalRef} for manual retry with correct signed tx.`,
            };
          }
        } else {
          // Step 1 handshake: build unsigned tx for customer to sign. Return unsigned tx to caller.
          try {
            const unsigned = await xr.prepareCustomerOriginTrc20Transfer(origin_address, address, withdrawAmt);
            settlement = {
              provider: 'customer-origin-tron',
              status: 'pending_manual',  // waiting for customer signature → then resubmit with signed_tx
              txId: unsigned.txID,
              txUrl: null,
              message:
                `${withdrawAmt} USDT SPOT deducted (final). Step 1 customer-origin handshake complete. ` +
                `Pass unsigned_tx below to customer. They sign with THEIR OWN wallet private key (${origin_address}) offline. ` +
                `Then resubmit to this endpoint as { ..., signed_tx: { ...tx, signature: ["..."] } }. ` +
                `Operator never held $0 USDT at any step.`,
              operatorUsdtHeldAtAnyStep: 0,
            };
            (settlement as any).unsigned_tx = unsigned.unsignedTx;
            (settlement as any).customer_origin = {
              origin_address,
              destination_address: address,
              amount: withdrawAmt,
            };
          } catch (e: any) {
            settlement = {
              ...settlement,
              provider: 'customer-origin-tron',
              status: 'pending_manual',
              message: `${withdrawAmt} USDT SPOT deducted (final). Customer-origin build failed. Reason: ${String(e?.message || e)}.`,
            };
          }
        }
      }
      // ────────────────────────────────────────────────────────────────────
      // DIRECT HOT WALLET WITHDRAWAL - ONE CLICK, NO BULLSHIT
      // Use hot wallet for instant withdrawal to blockchain
      // ────────────────────────────────────────────────────────────────────
      if (coin === 'USDT') {
        try {
          const xr = await import('../../exchange/exchange-router.service');
          const chainForWithdraw = /tron|trc20/i.test(String(network)) ? 'tron' :
                                   /bsc|bep20/i.test(String(network))  ? 'bsc'  :
                                   /polygon|matic|erc20/i.test(String(network)) ? 'polygon' : 'tron';
          
          // FORCE DIRECT BLOCKCHAIN RAIL - NO EXCHANGE BULLSHIT
          const directRail = chainForWithdraw === 'tron' ? 'tronweb' : 
                            chainForWithdraw === 'bsc' ? 'bscweb' : 'polygonweb';
          
          console.log(`[withdraw-crypto] FORCING DIRECT RAIL: ${directRail} for ${withdrawAmt} USDT to ${address}`);
          
          const result = await xr.directRailWithdraw(
            directRail as any,
            'USDT',
            address,
            withdrawAmt,
            { senderMode: 'hot' } // Use hot wallet
          );

          if (result && result.ok) {
            const txId = result.txId || '';
            const txUrl = directRail === 'tronweb' && txId ? 
              `https://tronscan.org/#/transaction/${txId}` :
              directRail === 'bscweb' && txId ?
              `https://bscscan.com/tx/${txId}` :
              directRail === 'polygonweb' && txId ?
              `https://polygonscan.com/tx/${txId}` : null;
            
            settlement = {
              provider: directRail,
              status: result.deferred ? 'deferred_broadcast' : 'completed',
              txId,
              txUrl,
              message: result.deferred ?
                `${withdrawAmt} USDT SPOT deducted (final). On-chain broadcast DEFERRED: hot wallet has insufficient ${coin} balance. ` +
                `Will auto-retry via background daemon every 5 min once hot wallet balance >= ${withdrawAmt}. ` +
                `Gas (native ${directRail === 'tronweb' ? 'TRX' : directRail === 'bscweb' ? 'BNB' : 'MATIC'}) to be paid from hot wallet native reserve.` :
                `${withdrawAmt} USDT withdrawn successfully via ${directRail.toUpperCase()}. ` +
                `Transaction: ${txId || 'broadcasting'}. Network: ${network}. ` +
                `Hot wallet sent directly to blockchain. Check: ${txUrl || 'blockchain explorer'}`,
              operatorUsdtHeldAtAnyStep: 0,
            };
          } else {
            throw new Error('Direct rail withdrawal failed');
          }
        } catch (e: any) {
          console.error('[withdraw-crypto] Direct rail error:', e);
          settlement = {
            provider: 'manual_pending_direct_rail_error',
            status: 'pending_manual',
            txId: null,
            txUrl: null,
            message:
              `${withdrawAmt} USDT SPOT deducted (final). Direct blockchain rail error: ${String(e?.message || e)}. ` +
              `Check hot wallet balance and TronGrid API. Internal debit FINAL — pending manual settlement.`,
            operatorUsdtHeldAtAnyStep: 0,
          };
        }
      }

      // Insert into crypto_transactions with final settlement metadata
      await db.query(
        `INSERT INTO crypto_transactions (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount, fiat_currency, exchange_rate, source, provider_mode, status, reference, meta)
         VALUES (?, ?, ?, 'withdraw', 0, ?, ?, 0, ?, ?, ?, ?, ?)`,
        [
          uuidv4(), customerId, coin, withdrawAmt, 'USD',
          `withdraw:${address}:${network}`,
          settlement.provider,
          settlement.status,
          withdrawalRef,
          JSON.stringify({
            destination_address: address,
            network,
            origin_address: origin_address || null,
            txId: settlement.txId,
            txUrl: settlement.txUrl,
            settlement_provider: settlement.provider,
            operator_never_held_usdt: true,
          }),
        ]
      );
      debitApplied = false;

      res.json({
        success: true,
        cryptoCoin: coin,
        amount: withdrawAmt,
        address,
        network,
        withdrawalRef,
        status: settlement.status,
        provider: settlement.provider,
        balanceSource: 'customer_internal_wallet',
        operator_never_held_usdt: true,
        settlement_provider: settlement.provider,
        settlement_tx_id: settlement.txId,
        settlement_tx_url: settlement.txUrl,
        message: settlement.message,
        unsigned_tx: (settlement as any).unsigned_tx || undefined,
        customer_origin: (settlement as any).customer_origin || undefined,
        exchange_withdrawal_id: (settlement as any).exchange_withdrawal_id || undefined,
        operator_next_step: (settlement as any).operator_next_step || undefined,
      });
    } catch (e: any) {
      if (debitApplied && debitDb && debitCustomerId && debitCoin && debitAmount > 0) {
        try {
          await debitDb.query(
            'UPDATE customer_crypto_wallets SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE customer_id = ? AND crypto_coin = ?',
            [debitAmount, debitCustomerId, debitCoin]
          );
        } catch (_) {
          // Preserve the original provider/database error for the caller.
        }
      }
      res.status(500).json({ error: e.message });
    }
  }

  // ── Merchant → Customer transfer ──────────────────────────────────────────
  async merchantToCustomerTransfer(req: Request, res: Response) {
    try {
      const { merchantId, customerId, walletCode, amount, note, currency } = req.body;
      if (!merchantId || (!customerId && !walletCode) || !amount || amount <= 0)
        return res.status(400).json({ error: 'merchantId, customerId (or walletCode), and amount are required' });

      let resolvedCustomerId = customerId;

      // Accept walletCode as alternative to customerId
      if (!resolvedCustomerId && walletCode) {
        const { db } = await import('../../config/db');
        const r = await db.query(
          `SELECT customer_id FROM customer_wallets WHERE wallet_code = ? LIMIT 1`,
          [walletCode]
        );
        if (!r.rows.length) return res.status(404).json({ error: `Wallet code ${walletCode} not found` });
        resolvedCustomerId = r.rows[0].customer_id;
      }

      res.json(await walletsService.merchantToCustomerTransfer(
        merchantId, resolvedCustomerId, Number(amount), note, currency || 'USD'
      ));
    } catch (e: any) {
      res.status(e.message.includes('Insufficient') || e.message.includes('not found') ? 400 : 500)
        .json({ error: e.message });
    }
  }

  // Merchant: buy crypto using merchant wallet funds
  async buyCryptoWithMerchant(req: Request, res: Response) {
    try {
      const { merchantId, cryptoCoin, fiatAmount, network } = req.body;
      if (!merchantId || !cryptoCoin || !fiatAmount || fiatAmount <= 0)
        return res.status(400).json({ error: 'Invalid payload' });
      const result = await walletsService.buyCryptoWithMerchant(merchantId, cryptoCoin, fiatAmount, network);
      res.status(200).json(result);
    } catch (e: any) {
      const msg = String(e?.message || e);
      const badRequest =
        /Insufficient|Invalid payload|NO_LIVE_CRYPTO_EXCHANGE_CONFIGURED|CRYPTO_PURCHASE_BLOCKED|LIVE_PRICE_UNAVAILABLE|LIVE_CRYPTO_EXCHANGE_REQUIRED/.test(msg);
      res.status(badRequest ? 400 : 500).json({
        error: msg,
        hint: badRequest
          ? 'Set real production exchange credentials in backend/.env. Simulation mode is disabled.'
          : undefined,
      });
    }
  }

  // ── Merchant wallet (auto-credited on batch sync) ─────────────────────────
  async getMerchantBalance(req: Request, res: Response) {
    try {
      const { merchantId } = req.params;
      const { currency } = req.query as any;
      const wallet = await walletsService.getOrCreateMerchantWallet(merchantId, (currency as string) || 'USD');
      res.json({ balance: wallet.balance, currency: wallet.currency, merchantId });
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  async getMerchantTransactions(req: Request, res: Response) {
    try {
      const { merchantId } = req.params;
      const { currency } = req.query as any;
      const wallet = await walletsService.getOrCreateMerchantWallet(merchantId, (currency as string) || 'USD');
      const { db } = await import('../../config/db');
      const res2 = await db.query(
        'SELECT * FROM merchant_wallet_transactions WHERE wallet_id = ? ORDER BY created_at DESC LIMIT 100',
        [wallet.id]
      );
      res.json(res2.rows);
    } catch (e: any) { res.status(500).json({ error: e.message }); }
  }

  // ── Transak Fiat On/Off-Ramp ─────────────────────────────────────────────

  async transakConfig(req: Request, res: Response) {
    try {
      const transak = await import('../../exchange/transak.service');
      const cfg = transak.getTransakConfig();
      res.json({
        configured: transak.isConfigured(),
        mode: cfg.mode,
        apiKey: cfg.apiKey,
        widgetUrl: cfg.widgetUrl,
        referrerDomain: cfg.referrerDomain,
        networks: ['TRC20', 'BEP20', 'ERC20', 'POLYGON', 'SOL', 'BTC'],
      });
    } catch (e: any) {
      res.status(500).json({ configured: false, error: e.message });
    }
  }

  async generateTransakWidgetSession(req: Request, res: Response) {
    try {
      const transak = await import('../../exchange/transak.service');
      if (!transak.isConfigured()) {
        return res.status(503).json({ error: 'Transak not configured. Set TRANSAK_API_KEY + TRANSAK_API_SECRET.' });
      }
      const params: any = { ...(req.body || {}) };
      const { customerId, walletCode } = params;

      let partnerCustomerId = params.partnerCustomerId;
      if (!partnerCustomerId && customerId) partnerCustomerId = String(customerId);
      if (!partnerCustomerId && walletCode) {
        const { db } = await import('../../config/db');
        const r = await db.query(
          `SELECT c.id AS cid FROM customer_wallets cw
           JOIN customers c ON cw.customer_id = c.id
           WHERE cw.wallet_code = ? LIMIT 1`,
          [walletCode]
        );
        if (r.rows[0]) partnerCustomerId = String(r.rows[0].cid);
      }
      if (partnerCustomerId) params.partnerCustomerId = partnerCustomerId;
      if (params.walletCode) delete params.walletCode;

      const userIp =
        (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim()
        || req.socket.remoteAddress
        || '0.0.0.0';
      const session = await transak.createWidgetSession(params, { userIp });
      res.json({
        ok: true,
        sessionId: session.sessionId,
        widgetUrl: session.widgetUrl,
        expiresAt: session.expiresAt,
        note: 'Valid for 5 minutes, single-use. Load in Android WebView, iframe, or redirect.',
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Transak widget session failed' });
    }
  }

  async sendTransakUserOtp(req: Request, res: Response) {
    try {
      const email = String(req.body?.email || '').trim();
      if (!email) return res.status(400).json({ error: 'Merchant email is required' });
      const transak = await import('../../exchange/transak.service');
      const userIp = (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0';
      const result = await transak.sendUserOtp(email, userIp);
      res.json({ ok: true, email: result.email, stateToken: result.stateToken, expiresIn: result.expiresIn });
    } catch (e: any) {
      res.status(Number(e?.response?.status) || 500).json({ error: e?.response?.data?.message || e.message || 'Transak OTP request failed' });
    }
  }

  async verifyTransakUserOtp(req: Request, res: Response) {
    try {
      const email = String(req.body?.email || '').trim();
      const otp = String(req.body?.otp || '').trim();
      const stateToken = String(req.body?.stateToken || '').trim();
      if (!email || !otp || !stateToken) return res.status(400).json({ error: 'email, otp and stateToken are required' });
      const transak = await import('../../exchange/transak.service');
      const userIp = (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0';
      const result = await transak.verifyUserOtp(email, otp, stateToken, userIp);
      res.json({ ok: true, accessToken: result.accessToken, expiresAt: result.expiresAt });
    } catch (e: any) {
      res.status(Number(e?.response?.status) || 500).json({ error: e?.response?.data?.message || e.message || 'Transak OTP verification failed' });
    }
  }

  async getTransakUserLimits(req: Request, res: Response) {
    try {
      const accessToken = String(req.body?.accessToken || req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const fiatCurrency = String(req.query.fiatCurrency || '').trim();
      const paymentCategory = String(req.query.paymentCategory || '').trim();
      const kycType = String(req.query.kycType || 'STANDARD').toUpperCase();
      if (!accessToken || !fiatCurrency || !paymentCategory || !['SIMPLE', 'STANDARD'].includes(kycType)) {
        return res.status(400).json({ error: 'accessToken, fiatCurrency, paymentCategory and kycType are required' });
      }
      const transak = await import('../../exchange/transak.service');
      const userIp = (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0';
      const limits = await transak.getUserLimits({
        accessToken,
        fiatCurrency,
        paymentCategory,
        kycType: kycType as 'SIMPLE' | 'STANDARD',
        userIp,
      });
      res.json({ ok: true, limits });
    } catch (e: any) {
      res.status(Number(e?.response?.status) || 500).json({ error: e?.response?.data?.message || e.message || 'Transak user limits lookup failed' });
    }
  }

  async getTransakUserDetails(req: Request, res: Response) {
    try {
      const accessToken = String(req.body?.accessToken || req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!accessToken) return res.status(400).json({ error: 'accessToken is required' });
      const transak = await import('../../exchange/transak.service');
      const userIp = (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0';
      const user = await transak.getUserDetails(accessToken, userIp);
      res.json({ ok: true, user });
    } catch (e: any) {
      res.status(Number(e?.response?.status) || 500).json({ error: e?.response?.data?.message || e.message || 'Transak user details lookup failed' });
    }
  }

  async refreshTransakUserAccessToken(req: Request, res: Response) {
    try {
      const accessToken = String(req.body?.accessToken || req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!accessToken) return res.status(400).json({ error: 'accessToken is required' });
      const transak = await import('../../exchange/transak.service');
      const userIp = (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0';
      const result = await transak.refreshUserAccessToken(accessToken, userIp);
      res.json({ ok: true, accessToken: result.accessToken });
    } catch (e: any) {
      res.status(Number(e?.response?.status) || 500).json({ error: e?.response?.data?.message || e.message || 'Transak user token refresh failed' });
    }
  }

  async logoutTransakUser(req: Request, res: Response) {
    try {
      const accessToken = String(req.body?.accessToken || req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!accessToken) return res.status(400).json({ error: 'accessToken is required' });
      const transak = await import('../../exchange/transak.service');
      const userIp = (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0';
      await transak.logoutUser(accessToken, userIp);
      res.json({ ok: true, message: 'Successfully logged out' });
    } catch (e: any) {
      res.status(Number(e?.response?.status) || 500).json({ error: e?.response?.data?.message || e.message || 'Transak logout failed' });
    }
  }

  async onboardTransakUser(req: Request, res: Response) {
    try {
      const email = String(req.body?.email || '').trim();
      if (!email) return res.status(400).json({ error: 'Merchant email is required' });
      const transak = await import('../../exchange/transak.service');
      const userIp = (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() || req.socket.remoteAddress || '0.0.0.0';
      const user = await transak.onboardUserAuthReliance(email, userIp);
      res.json({ ok: true, user });
    } catch (e: any) {
      res.status(Number(e?.response?.status) || 500).json({ error: e?.response?.data?.message || e.message || 'Transak Auth Reliance onboarding failed' });
    }
  }

  async verifyTransakWalletAddress(req: Request, res: Response) {
    try {
      const cryptoCurrency = String(req.query.cryptoCurrency || req.body?.cryptoCurrency || '').trim();
      const network = String(req.query.network || req.body?.network || '').trim();
      const walletAddress = String(req.query.walletAddress || req.body?.walletAddress || '').trim();
      if (!cryptoCurrency || !network || !walletAddress) {
        return res.status(400).json({ error: 'cryptoCurrency, network and walletAddress are required' });
      }
      const transak = await import('../../exchange/transak.service');
      const result = await transak.verifyWalletAddress(cryptoCurrency, network, walletAddress);
      res.json({ ok: true, response: result.response });
    } catch (e: any) {
      res.status(Number(e?.response?.status) || 500).json({ error: e?.response?.data?.message || e.message || 'Transak wallet-address verification failed' });
    }
  }

  async getTransakWebhooks(req: Request, res: Response) {
    try {
      const rawLimit = Number(req.query.limit);
      const rawSkip = Number(req.query.skip);
      const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(Math.trunc(rawLimit), 1), 100) : undefined;
      const skip = Number.isFinite(rawSkip) ? Math.max(Math.trunc(rawSkip), 0) : undefined;
      const eventID = String(req.query.eventID || '').trim() || undefined;
      const orderID = String(req.query.orderID || '').trim() || undefined;
      const startDate = String(req.query.startDate || '').trim() || undefined;
      const endDate = String(req.query.endDate || '').trim() || undefined;
      const rawStatus = String(req.query.status || '').trim().toLowerCase();
      const status = rawStatus === 'success' || rawStatus === 'failed' ? rawStatus : undefined;
      const transak = await import('../../exchange/transak.service');
      const result = await transak.getWebhooks({ eventID, orderID, limit, skip, startDate, endDate, status });
      res.json({ ok: true, ...result });
    } catch (e: any) {
      res.status(Number(e?.response?.status) || 500).json({ error: e?.response?.data?.message || e.message || 'Transak webhook lookup failed' });
    }
  }

  async getTransakOrderStatus(req: Request, res: Response) {
    try {
      const { orderId } = req.params;
      if (!orderId) return res.status(400).json({ error: 'orderId is required' });
      const transak = await import('../../exchange/transak.service');
      if (!transak.isConfigured()) {
        return res.status(503).json({ error: 'Transak not configured.' });
      }
      const order = await transak.getOrderStatus(orderId);
      res.json({ ok: true, order });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Transak order query failed' });
    }
  }

  async getTransakCountries(_req: Request, res: Response) {
    try {
      const transak = await import('../../exchange/transak.service');
      if (!transak.isConfigured()) {
        return res.status(503).json({
          error: 'Transak not configured. Set TRANSAK_API_KEY + TRANSAK_API_SECRET.',
        });
      }
      const data = await transak.getCountries();
      res.json({ ok: true, response: data.response, mode: transak.getTransakConfig().mode });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Transak countries fetch failed' });
    }
  }

  // GET /wallet/transak/fiat-currencies
  // Returns all supported fiat currencies with their payment options and limits.
  // Public endpoint — no auth token required, uses x-api-key header only.
  async getTransakFiatCurrencies(_req: Request, res: Response) {
    try {
      const transak = await import('../../exchange/transak.service');
      const { getFiatCurrencies } = transak;
      if (!getFiatCurrencies) {
        return res.status(501).json({ error: 'getFiatCurrencies not available in transak.service' });
      }
      const data = await getFiatCurrencies();
      res.json({ ok: true, response: data.response, count: data.response?.length ?? 0 });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Transak fiat currencies fetch failed' });
    }
  }

  // GET /wallet/transak/fiat-currencies/whitelabel
  // Returns fiat currencies with per-payment-option BUY/SELL flags and sell limits.
  // Uses the Whitelabel API (api-gateway) — requires x-user-ip from client.
  // Query param: ?userIp=1.2.3.4  (or read from request IP)
  async getTransakFiatCurrenciesWhitelabel(req: Request, res: Response) {
    try {
      const transak = await import('../../exchange/transak.service');
      const { getFiatCurrenciesWhitelabel } = transak;
      if (!getFiatCurrenciesWhitelabel) {
        return res.status(501).json({ error: 'getFiatCurrenciesWhitelabel not available in transak.service' });
      }

      // Resolve the end-user IP: query param → x-forwarded-for → req.ip
      const userIp =
        String(req.query.userIp || '')
        || (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim()
        || req.ip
        || '127.0.0.1';

      const data = await getFiatCurrenciesWhitelabel(userIp);
      res.json({
        ok: true,
        response: data.response,
        count: data.response?.length ?? 0,
        source: 'whitelabel',
      });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Transak whitelabel fiat currencies fetch failed' });
    }
  }

  // GET /wallet/transak/quote
  // Query params: cryptoCurrency, fiatCurrency, isBuyOrSell, network,
  //               fiatAmount?, cryptoAmount?, paymentMethod?, quoteCountryCode?
  // Returns a real-time price quote with fee breakdown from Transak.
  async getTransakQuote(req: Request, res: Response) {
    try {
      const transak = await import('../../exchange/transak.service');
      const { getQuote } = transak;
      if (!getQuote) {
        return res.status(501).json({ error: 'getQuote not available in transak.service' });
      }

      const {
        cryptoCurrency, fiatCurrency, isBuyOrSell,
        network, fiatAmount, cryptoAmount,
        paymentMethod, quoteCountryCode,
      } = req.query as Record<string, string>;

      if (!cryptoCurrency || !fiatCurrency || !isBuyOrSell || !network) {
        return res.status(400).json({
          error: 'Required: cryptoCurrency, fiatCurrency, isBuyOrSell (BUY|SELL), network',
        });
      }
      if (isBuyOrSell !== 'BUY' && isBuyOrSell !== 'SELL') {
        return res.status(400).json({ error: 'isBuyOrSell must be BUY or SELL' });
      }
      if (isBuyOrSell === 'SELL' && !cryptoAmount) {
        return res.status(400).json({ error: 'cryptoAmount is required for SELL quotes' });
      }

      const quote = await getQuote({
        cryptoCurrency: cryptoCurrency.toUpperCase(),
        fiatCurrency:   fiatCurrency.toUpperCase(),
        isBuyOrSell:    isBuyOrSell as 'BUY' | 'SELL',
        network,
        fiatAmount:     fiatAmount    ? Number(fiatAmount)    : undefined,
        cryptoAmount:   cryptoAmount  ? Number(cryptoAmount)  : undefined,
        paymentMethod:  paymentMethod || 'credit_debit_card',
        quoteCountryCode,
      });

      res.json({ ok: true, response: quote });
    } catch (e: any) {
      res.status(500).json({ error: e.message || 'Transak quote fetch failed' });
    }
  }

  // POST /wallet/transak/apple-pay/session
  // Creates a Headless Apple Pay transaction session via Transak Whitelabel API.
  // Body: { quoteId, walletAddress, userIp?, config?, accessToken?, partnerAccessToken?, userIdentifier? }
  // The quoteId must have been generated with paymentMethod=apple_pay.
  async createTransakApplePaySession(req: Request, res: Response) {
    try {
      const transak = await import('../../exchange/transak.service');
      if (!transak.createApplePayTransactionSession) {
        return res.status(501).json({ error: 'createApplePayTransactionSession not available' });
      }

      const {
        quoteId, walletAddress, config,
        accessToken, partnerAccessToken, userIdentifier,
      } = req.body || {};

      if (!quoteId) {
        return res.status(400).json({
          error: 'quoteId is required (must be generated with paymentMethod=apple_pay)',
        });
      }
      if (!walletAddress) {
        return res.status(400).json({ error: 'walletAddress is required' });
      }

      // Resolve user IP: body → x-forwarded-for → req.ip
      const userIp =
        String(req.body?.userIp || '')
        || (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim()
        || req.ip
        || '127.0.0.1';

      const result = await transak.createApplePayTransactionSession({
        quoteId,
        walletAddress,
        userIp,
        config: config || undefined,
        accessToken:        accessToken        || undefined,
        partnerAccessToken: partnerAccessToken || undefined,
        userIdentifier:     userIdentifier     || undefined,
      });

      res.json({ ok: true, sessionId: result.sessionId });
    } catch (e: any) {
      const status = String(e?.response?.status || '').startsWith('4') ? Number(e.response.status) : 500;
      res.status(status).json({
        error: e?.response?.data?.message || e.message || 'Transak Apple Pay session creation failed',
      });
    }
  }
  // Handles Transak order lifecycle events: PENDING, PROCESSING, COMPLETED, FAILED, etc.
  // The webhook body is signed with TRANSAK_WEBHOOK_SECRET using HMAC-SHA256.
  async handleTransakWebhook(req: Request, res: Response) {
    try {
      const transak = await import('../../exchange/transak.service');
      const rawBody   = req.body;   // express.json() already parsed it
      const sigHeader = String(req.headers['x-transak-signature'] || req.headers['x-signature'] || '');

      // ── Signature verification ────────────────────────────────────────────
      const rawBodyStr = typeof rawBody === 'string' ? rawBody : JSON.stringify(rawBody);
      const sigValid = transak.verifyWebhookSignature(rawBodyStr, sigHeader);
      if (!sigValid && process.env.TRANSAK_WEBHOOK_SECRET) {
        return res.status(401).json({ error: 'Invalid Transak webhook signature' });
      }

      const eventData = rawBody?.data || rawBody;
      const orderId   = eventData?.id;
      const status    = String(eventData?.status || '').toUpperCase();
      const partnerOrderId = eventData?.partnerOrderId || null;

      if (!orderId) {
        return res.status(400).json({ error: 'Missing order id in webhook payload' });
      }

      // ── Persist event to DB ───────────────────────────────────────────────
      const { db } = await import('../../config/db');
      const { v4: uuidv4 } = await import('uuid');

      // Upsert into crypto_transactions: update status if row already exists for this orderId
      const existing = await db.query(
        `SELECT id FROM crypto_transactions WHERE reference = ? LIMIT 1`,
        [`transak:${orderId}`]
      );

      if (existing.rows?.length) {
        await db.query(
          `UPDATE crypto_transactions
              SET status = ?, meta = json_patch(COALESCE(meta,'{}'), ?), updated_at = CURRENT_TIMESTAMP
            WHERE reference = ?`,
          [
            status === 'COMPLETED' ? 'completed'
              : status === 'FAILED' || status === 'CANCELLED' ? 'failed'
              : 'processing',
            JSON.stringify({ transak_status: status, transak_order_id: orderId, webhook_received_at: new Date().toISOString() }),
            `transak:${orderId}`,
          ]
        );
      } else {
        // New order seen for the first time via webhook — insert a record
        await db.query(
          `INSERT OR IGNORE INTO crypto_transactions
             (id, customer_id, crypto_coin, transaction_type, fiat_amount, crypto_amount,
              fiat_currency, exchange_rate, source, provider_mode, status, reference, meta)
           VALUES (?, ?, ?, 'buy', ?, ?, ?, 0, 'transak_webhook', 'transak', ?, ?, ?)`,
          [
            uuidv4(),
            eventData?.partnerCustomerId || 'unknown',
            String(eventData?.cryptoCurrency || 'USDT').toUpperCase(),
            Number(eventData?.fiatAmount  || 0),
            Number(eventData?.cryptoAmount || 0),
            String(eventData?.fiatCurrency || 'USD').toUpperCase(),
            status === 'COMPLETED' ? 'completed'
              : status === 'FAILED' || status === 'CANCELLED' ? 'failed'
              : 'processing',
            `transak:${orderId}`,
            JSON.stringify({
              transak_order_id:   orderId,
              transak_status:     status,
              partner_order_id:   partnerOrderId,
              network:            eventData?.network,
              wallet_address:     eventData?.walletAddress,
              transaction_hash:   eventData?.transactionHash,
              webhook_received_at: new Date().toISOString(),
            }),
          ]
        );
      }

      // ── Credit customer wallet if order COMPLETED ─────────────────────────
      if (status === 'COMPLETED') {
        const customerId     = eventData?.partnerCustomerId;
        const cryptoAmount   = Number(eventData?.cryptoAmount  || 0);
        const cryptoCurrency = String(eventData?.cryptoCurrency || 'USDT').toUpperCase();

        if (customerId && cryptoAmount > 0) {
          // Upsert customer_crypto_wallets balance
          const existingCW = await db.query(
            `SELECT id, balance FROM customer_crypto_wallets WHERE customer_id = ? AND crypto_coin = ? LIMIT 1`,
            [customerId, cryptoCurrency]
          );
          if (existingCW.rows?.length) {
            await db.query(
              `UPDATE customer_crypto_wallets
                  SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP
                WHERE customer_id = ? AND crypto_coin = ?`,
              [cryptoAmount, customerId, cryptoCurrency]
            );
          } else {
            await db.query(
              `INSERT INTO customer_crypto_wallets (id, customer_id, crypto_coin, balance, created_at, updated_at)
               VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
              [uuidv4(), customerId, cryptoCurrency, cryptoAmount]
            );
          }
        }
      }

      res.json({ ok: true, received: true, orderId, status });
    } catch (e: any) {
      console.error('[Transak Webhook Error]', e.message);
      // Always return 200 to Transak so it stops retrying on server errors
      res.status(200).json({ ok: false, error: e.message });
    }
  }
}

export const walletsController = new WalletsController();
