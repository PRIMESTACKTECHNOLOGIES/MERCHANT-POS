import { db } from '../../config/db';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';

export interface InboundTransactionRegistrationInput {
  protocol?: '101.1' | '101.6' | '201.3';
  authorizationCode: string;
  amount: number;
  currency?: string;
  beneficiaryName?: string;
  beneficiaryAccount?: string;
  senderBic?: string;
  receiverBic?: string;
  uetr?: string;
  depositCode?: string;
  cusip?: string;
  fedWireCode?: string;
  swiftMtType?: string;
  iso20022Type?: string;
  merchantId?: string;
  customerId?: string;
  rawDocument?: string;
  meta?: Record<string, any>;
}

export interface FundVerificationInput {
  registrationId: string;
  provider: 'SWIFT_GATEWAY' | 'VISA_NETWORK' | 'BANK_API' | 'MANUAL_CONFIRM' | string;
  method: 'API_CALL' | 'UETR_LOOKUP' | 'ACCOUNT_BALANCE_CHECK' | 'MANUAL';
  config?: Record<string, any>;
  operatorId?: string;
}

export interface FundVerificationResult {
  success: boolean;
  verified: boolean;
  amountVerified?: number;
  currencyVerified?: string;
  provider: string;
  externalReference?: string;
  reason?: string;
  auditId?: string;
}

export class InboundTransactionService {

  async registerInboundTransaction(
    input: InboundTransactionRegistrationInput,
  ): Promise<{
    id: string;
    authorizationCode: string;
    settlementStatus: string;
    fundVerificationStatus: string;
  }> {
    const id = uuidv4();
    const now = new Date().toISOString();
    const protocol = input.protocol || '101.1';
    const currency = (input.currency || 'USD').toUpperCase();
    const authCode = String(input.authorizationCode).trim().toUpperCase();

    await db.query(
      `INSERT INTO inbound_transaction_registrations
        (id, protocol, authorization_code, amount, currency, beneficiary_name, beneficiary_account,
         sender_bic, receiver_bic, uetr, deposit_code, cusip, fed_wire_code, swift_mt_type, iso20022_type,
         settlement_status, fund_verification_status, merchant_id, customer_id, raw_document, meta_json,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING_VERIFICATION', 'UNVERIFIED', ?, ?, ?, ?, ?, ?)`,
      [
        id,
        protocol,
        authCode,
        Number(input.amount),
        currency,
        input.beneficiaryName || null,
        input.beneficiaryAccount || null,
        input.senderBic || null,
        input.receiverBic || null,
        input.uetr || null,
        input.depositCode || null,
        input.cusip || null,
        input.fedWireCode || null,
        input.swiftMtType || null,
        input.iso20022Type || null,
        input.merchantId || null,
        input.customerId || null,
        input.rawDocument || null,
        input.meta ? JSON.stringify(input.meta) : null,
        now,
        now,
      ],
    );

    return {
      id,
      authorizationCode: authCode,
      settlementStatus: 'PENDING_VERIFICATION',
      fundVerificationStatus: 'UNVERIFIED',
    };
  }

  async findByAuthorizationCode(
    authorizationCode: string,
    protocol: string = '101.1',
  ): Promise<any | null> {
    const code = String(authorizationCode).trim().toUpperCase();
    const res = await db.query(
      `SELECT * FROM inbound_transaction_registrations
       WHERE authorization_code = ? AND protocol = ?
       ORDER BY created_at DESC LIMIT 1`,
      [code, protocol],
    );
    if (!res.rows.length) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      protocol: row.protocol,
      authorizationCode: row.authorization_code,
      amount: Number(row.amount),
      currency: row.currency,
      beneficiaryName: row.beneficiary_name,
      beneficiaryAccount: row.beneficiary_account,
      senderBic: row.sender_bic,
      receiverBic: row.receiver_bic,
      uetr: row.uetr,
      depositCode: row.deposit_code,
      cusip: row.cusip,
      fedWireCode: row.fed_wire_code,
      swiftMtType: row.swift_mt_type,
      iso20022Type: row.iso20022_type,
      settlementStatus: row.settlement_status,
      fundVerificationStatus: row.fund_verification_status,
      verificationProvider: row.verification_provider,
      verificationReference: row.verification_reference,
      verifiedAt: row.verified_at,
      merchantId: row.merchant_id,
      customerId: row.customer_id,
      panMasked: row.pan_masked,
      cardRegistered: row.card_registered === 1,
      meta: row.meta_json ? JSON.parse(row.meta_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async getById(id: string): Promise<any | null> {
    const res = await db.query(
      `SELECT * FROM inbound_transaction_registrations WHERE id = ?`,
      [id],
    );
    if (!res.rows.length) return null;
    const row = res.rows[0];
    return {
      id: row.id,
      protocol: row.protocol,
      authorizationCode: row.authorization_code,
      amount: Number(row.amount),
      currency: row.currency,
      beneficiaryName: row.beneficiary_name,
      beneficiaryAccount: row.beneficiary_account,
      senderBic: row.sender_bic,
      receiverBic: row.receiver_bic,
      uetr: row.uetr,
      depositCode: row.deposit_code,
      cusip: row.cusip,
      fedWireCode: row.fed_wire_code,
      swiftMtType: row.swift_mt_type,
      iso20022Type: row.iso20022_type,
      settlementStatus: row.settlement_status,
      fundVerificationStatus: row.fund_verification_status,
      verificationProvider: row.verification_provider,
      verificationReference: row.verification_reference,
      verifiedAt: row.verified_at,
      merchantId: row.merchant_id,
      customerId: row.customer_id,
      panMasked: row.pan_masked,
      cardRegistered: row.card_registered === 1,
      meta: row.meta_json ? JSON.parse(row.meta_json) : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  async linkCardDetails(
    registrationId: string,
    cardData: {
      panMasked?: string;
      cardNumber?: string;
      customerId?: string;
      merchantId?: string;
    },
  ): Promise<void> {
    const now = new Date().toISOString();
    let panMasked = cardData.panMasked;
    if (!panMasked && cardData.cardNumber) {
      const clean = String(cardData.cardNumber).replace(/\s/g, '');
      const last4 = clean.slice(-4);
      panMasked = `****${last4}`;
    }
    await db.query(
      `UPDATE inbound_transaction_registrations
         SET pan_masked = COALESCE(?, pan_masked),
             customer_id = COALESCE(?, customer_id),
             merchant_id = COALESCE(?, merchant_id),
             card_registered = 1,
             updated_at = ?
       WHERE id = ?`,
      [
        panMasked || null,
        cardData.customerId || null,
        cardData.merchantId || null,
        now,
        registrationId,
      ],
    );
  }

  async verifyFundsWithExternalProvider(
    input: FundVerificationInput,
  ): Promise<FundVerificationResult> {
    const auditId = uuidv4();
    const registration = await this.getById(input.registrationId);
    if (!registration) {
      return {
        success: false,
        verified: false,
        provider: input.provider,
        reason: 'Registration not found',
      };
    }

    const now = new Date().toISOString();
    let requestPayload: any = {
      registrationId: input.registrationId,
      provider: input.provider,
      method: input.method,
      authorizationCode: registration.authorizationCode,
      uetr: registration.uetr,
      amount: registration.amount,
      currency: registration.currency,
      senderBic: registration.senderBic,
      receiverBic: registration.receiverBic,
      depositCode: registration.depositCode,
      operatorId: input.operatorId || null,
      timestamp: now,
    };
    if (input.config) requestPayload.config = input.config;

    let responsePayload: any = null;
    let resultStatus: 'VERIFIED' | 'FAILED' | 'PENDING' = 'FAILED' as const;
    let resultReason = 'Unknown verification error';
    let verifiedAmount: number | undefined = undefined;
    let verifiedCurrency: string | undefined = undefined;
    let externalReference: string | undefined = undefined;

    try {
      switch (String(input.provider).toUpperCase()) {
        case 'SWIFT_GATEWAY': {
          const swiftUrl = process.env.SWIFT_GATEWAY_URL?.trim();
          const swiftKey = process.env.SWIFT_GATEWAY_API_KEY?.trim();
          if (!swiftUrl || !swiftKey) {
            resultReason = 'SWIFT_GATEWAY_URL or SWIFT_GATEWAY_API_KEY not configured';
            break;
          }
          try {
            const res = await axios.post(
              `${swiftUrl}/api/v1/swift/verify-uetr`,
              {
                uetr: registration.uetr,
                amount: registration.amount,
                currency: registration.currency,
                senderBic: registration.senderBic,
                receiverBic: registration.receiverBic,
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  'X-API-Key': swiftKey,
                },
                timeout: 15000,
              },
            );
            responsePayload = res.data;
            const verified = res.data?.verified === true
              || res.data?.status === 'VERIFIED'
              || res.data?.settlement_status === 'SETTLED';
            if (verified) {
              resultStatus = 'VERIFIED';
              resultReason = res.data?.message || 'SWIFT UETR verification passed';
              verifiedAmount = Number(res.data?.amount || registration.amount);
              verifiedCurrency = (res.data?.currency || registration.currency).toUpperCase();
              externalReference = res.data?.transaction_ref || res.data?.uetr || registration.uetr;
            } else {
              resultStatus = 'FAILED';
              resultReason = res.data?.message || res.data?.reason || 'SWIFT verification returned negative';
            }
          } catch (swiftErr: any) {
            responsePayload = { error: swiftErr.message, code: swiftErr.code };
            resultReason = `SWIFT gateway call failed: ${swiftErr.message}`;
          }
          break;
        }
        case 'VISA_NETWORK': {
          const visaUrl = process.env.VISA_VERIFY_URL?.trim();
          const visaKey = process.env.VISA_API_KEY?.trim();
          if (!visaUrl || !visaKey) {
            resultReason = 'VISA_VERIFY_URL or VISA_API_KEY not configured';
            break;
          }
          try {
            const res = await axios.post(
              visaUrl,
              {
                depositCode: registration.depositCode,
                authorizationCode: registration.authorizationCode,
                amount: registration.amount,
                currency: registration.currency,
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${visaKey}`,
                },
                timeout: 15000,
              },
            );
            responsePayload = res.data;
            const settled = res.data?.settled === true
              || res.data?.funds_status === 'GOOD'
              || res.data?.verified === true;
            if (settled) {
              resultStatus = 'VERIFIED';
              resultReason = res.data?.message || 'Visa network fund verification passed';
              verifiedAmount = Number(res.data?.amount || registration.amount);
              verifiedCurrency = (res.data?.currency || registration.currency).toUpperCase();
              externalReference = res.data?.trace_id || res.data?.reference_id || registration.depositCode;
            } else {
              resultStatus = 'FAILED';
              resultReason = res.data?.message || res.data?.reason || 'Visa verification returned negative';
            }
          } catch (visaErr: any) {
            responsePayload = { error: visaErr.message, code: visaErr.code };
            resultReason = `Visa network call failed: ${visaErr.message}`;
          }
          break;
        }
        case 'BANK_API': {
          const bankUrl = process.env.BANK_VERIFY_URL?.trim();
          const bankSecret = process.env.BANK_API_SECRET?.trim();
          if (!bankUrl || !bankSecret) {
            resultReason = 'BANK_VERIFY_URL or BANK_API_SECRET not configured';
            break;
          }
          try {
            const res = await axios.post(
              `${bankUrl}/verify-funds`,
              {
                accountReference: registration.beneficiaryAccount || registration.depositCode,
                expectedAmount: registration.amount,
                expectedCurrency: registration.currency,
              },
              {
                headers: {
                  'Content-Type': 'application/json',
                  'X-Bank-Secret': bankSecret,
                },
                timeout: 15000,
              },
            );
            responsePayload = res.data;
            const funded = res.data?.funds_available === true
              || res.data?.status === 'FUNDED'
              || res.data?.balance_confirmed === true;
            if (funded) {
              resultStatus = 'VERIFIED';
              resultReason = res.data?.message || 'Bank API balance check passed';
              verifiedAmount = Number(res.data?.available_amount || registration.amount);
              verifiedCurrency = (res.data?.currency || registration.currency).toUpperCase();
              externalReference = res.data?.confirmation_id || registration.depositCode;
            } else {
              resultStatus = 'FAILED';
              resultReason = res.data?.message || res.data?.reason || 'Bank API reported insufficient or unconfirmed funds';
            }
          } catch (bankErr: any) {
            responsePayload = { error: bankErr.message, code: bankErr.code };
            resultReason = `Bank API call failed: ${bankErr.message}`;
          }
          break;
        }
        case 'MANUAL_CONFIRM':
        default: {
          if (input.method === 'MANUAL' && input.config?.confirmed === true) {
            resultStatus = 'VERIFIED';
            resultReason = input.config?.reason || 'Funds manually confirmed by operator';
            verifiedAmount = registration.amount;
            verifiedCurrency = registration.currency;
            externalReference = input.config?.reference || `MANUAL-${auditId.slice(0, 12).toUpperCase()}`;
          } else {
            resultStatus = 'FAILED';
            resultReason = input.config?.reason || 'Manual confirmation not provided';
          }
          responsePayload = {
            manual: true,
            operator: input.operatorId || 'unknown',
            confirmed: input.config?.confirmed === true,
          };
          break;
        }
      }
    } catch (outerErr: any) {
      resultReason = `Verification pipeline error: ${outerErr.message}`;
    }

    await db.query(
      `INSERT INTO fund_verification_audits
        (id, registration_id, provider, verification_method, request_payload, response_payload,
         result_status, result_reason, verified_amount, verified_currency, external_reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        auditId,
        input.registrationId,
        String(input.provider).toUpperCase(),
        input.method,
        JSON.stringify(requestPayload),
        responsePayload ? JSON.stringify(responsePayload) : null,
        resultStatus,
        resultReason,
        verifiedAmount,
        verifiedCurrency,
        externalReference,
        now,
      ],
    );

    const statusOut: string = resultStatus;
    if (resultStatus === 'VERIFIED') {
      const amountMatches =
        verifiedAmount !== undefined &&
        Math.abs(Number(verifiedAmount) - Number(registration.amount)) < 0.01;
      const currencyMatches =
        verifiedCurrency !== undefined &&
        String(verifiedCurrency).toUpperCase() === String(registration.currency).toUpperCase();

      if (!amountMatches || !currencyMatches) {
        (resultStatus as any) = 'FAILED';
        resultReason = `Verification mismatch: expected ${registration.currency} ${registration.amount.toFixed(2)}, got ${verifiedCurrency} ${verifiedAmount?.toFixed(2)}`;
      } else {
        await db.query(
          `UPDATE inbound_transaction_registrations
             SET fund_verification_status = 'VERIFIED',
                 settlement_status = 'VERIFIED_READY_FOR_CAPTURE',
                 verification_provider = ?,
                 verification_reference = ?,
                 verified_at = ?,
                 updated_at = ?
           WHERE id = ?`,
          [
            String(input.provider).toUpperCase(),
            externalReference || null,
            now,
            now,
            input.registrationId,
          ],
        );
      }
    } else if (statusOut === 'PENDING') {
      await db.query(
        `UPDATE inbound_transaction_registrations
           SET fund_verification_status = 'PENDING_EXTERNAL',
               verification_provider = ?,
               updated_at = ?
         WHERE id = ?`,
        [String(input.provider).toUpperCase(), now, input.registrationId],
      );
    } else {
      await db.query(
        `UPDATE inbound_transaction_registrations
           SET fund_verification_status = 'VERIFICATION_FAILED',
               settlement_status = 'VERIFICATION_FAILED',
               updated_at = ?
         WHERE id = ?`,
        [now, input.registrationId],
      );
    }

    return {
      success: resultStatus === 'VERIFIED',
      verified: resultStatus === 'VERIFIED',
      amountVerified: verifiedAmount,
      currencyVerified: verifiedCurrency,
      provider: String(input.provider).toUpperCase(),
      externalReference,
      reason: resultReason,
      auditId,
    };
  }

  async markSettlementCaptured(
    registrationId: string,
    captureRef: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    await db.query(
      `UPDATE inbound_transaction_registrations
         SET settlement_status = 'CAPTURED',
             updated_at = ?
       WHERE id = ?`,
      [now, registrationId],
    );
    await db.query(
      `INSERT INTO fund_verification_audits
        (id, registration_id, provider, verification_method, request_payload, response_payload,
         result_status, result_reason, external_reference, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        registrationId,
        'INTERNAL',
        'SETTLEMENT_CAPTURE',
        JSON.stringify({ captureRef }),
        JSON.stringify({ captureRef, registered: true }),
        'VERIFIED',
        `Settlement captured via ${captureRef}`,
        captureRef,
        now,
      ],
    );
  }

  async listRegistrations(
    filters: {
      settlementStatus?: string;
      fundVerificationStatus?: string;
      authorizationCode?: string;
    } = {},
    limit = 100,
  ): Promise<any[]> {
    const where: string[] = [];
    const params: any[] = [];
    if (filters.settlementStatus) {
      where.push('settlement_status = ?');
      params.push(filters.settlementStatus);
    }
    if (filters.fundVerificationStatus) {
      where.push('fund_verification_status = ?');
      params.push(filters.fundVerificationStatus);
    }
    if (filters.authorizationCode) {
      where.push('UPPER(authorization_code) = ?');
      params.push(String(filters.authorizationCode).trim().toUpperCase());
    }
    const sql = `SELECT * FROM inbound_transaction_registrations
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY created_at DESC LIMIT ?`;
    params.push(limit);
    const res = await db.query(sql, params);
    return res.rows.map((row: any) => ({
      id: row.id,
      protocol: row.protocol,
      authorizationCode: row.authorization_code,
      amount: Number(row.amount),
      currency: row.currency,
      beneficiaryName: row.beneficiary_name,
      settlementStatus: row.settlement_status,
      fundVerificationStatus: row.fund_verification_status,
      merchantId: row.merchant_id,
      customerId: row.customer_id,
      cardRegistered: row.card_registered === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  async getVerificationAudits(registrationId: string): Promise<any[]> {
    const res = await db.query(
      `SELECT * FROM fund_verification_audits
       WHERE registration_id = ? ORDER BY created_at DESC`,
      [registrationId],
    );
    return res.rows.map((row: any) => ({
      id: row.id,
      provider: row.provider,
      verificationMethod: row.verification_method,
      resultStatus: row.result_status,
      resultReason: row.result_reason,
      verifiedAmount: row.verified_amount ? Number(row.verified_amount) : null,
      verifiedCurrency: row.verified_currency,
      externalReference: row.external_reference,
      request: row.request_payload ? JSON.parse(row.request_payload) : null,
      response: row.response_payload ? JSON.parse(row.response_payload) : null,
      createdAt: row.created_at,
    }));
  }
}

export const inboundTransactionService = new InboundTransactionService();
