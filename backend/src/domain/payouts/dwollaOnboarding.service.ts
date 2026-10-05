import { db } from '../../config/db';
import {
  createDwollaCustomer,
  createDwollaFundingSource,
} from './dwollaOriginator.client';

export interface MerchantDwollaOnboardingInput {
  firstName: string;
  lastName: string;
  email: string;
  businessName?: string;
  ipAddress?: string;
  routingNumber: string;
  accountNumber: string;
  bankAccountType: 'checking' | 'savings';
  bankAccountName: string;
}

export async function onboardMerchantWithDwolla(
  merchantId: string,
  input: MerchantDwollaOnboardingInput,
) {
  if (!merchantId.trim()) throw new Error('merchantId is required');
  const customerUrl = await createDwollaCustomer({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    businessName: input.businessName,
    ipAddress: input.ipAddress,
  });
  const fundingSourceUrl = await createDwollaFundingSource(customerUrl, {
    routingNumber: input.routingNumber,
    accountNumber: input.accountNumber,
    bankAccountType: input.bankAccountType,
    name: input.bankAccountName,
  });
  const result = await db.query(
    `UPDATE merchant_wallets
        SET dwolla_customer_url = ?, dwolla_funding_source_url = ?
      WHERE merchant_id = ?`,
    [customerUrl, fundingSourceUrl, merchantId],
  );
  if (!result.rowCount) throw new Error(`Merchant wallet not found: ${merchantId}`);
  return { merchantId, dwollaCustomerUrl: customerUrl, dwollaFundingSourceUrl: fundingSourceUrl };
}
