export type BankReceiptAllocationStatus =
  | 'ALLOCATED'
  | 'HELD_UNMATCHED'
  | 'HELD_AMBIGUOUS_REFERENCE'
  | 'HELD_SETTLEMENT_MISMATCH'
  | 'HELD_ALREADY_CREDITED'
  | 'HELD_RECONCILIATION';

export interface BankReceiptAllocationInput {
  matchCount: number;
  receiptAmount: number;
  receiptCurrency: string;
  settlementAmount?: number;
  settlementCurrency?: string;
  existingWalletCredit: boolean;
  reconciliationDifference: number;
  bankCreditAlreadyRecorded?: boolean;
}

export function decideBankReceiptAllocation(input: BankReceiptAllocationInput): {
  status: BankReceiptAllocationStatus;
  shouldAllocate: boolean;
} {
  if (input.matchCount <= 0) return { status: 'HELD_UNMATCHED', shouldAllocate: false };
  if (input.matchCount !== 1) return { status: 'HELD_AMBIGUOUS_REFERENCE', shouldAllocate: false };

  if (input.settlementAmount === undefined
    || input.settlementCurrency?.toUpperCase() !== input.receiptCurrency.toUpperCase()
    || Math.abs(input.settlementAmount - input.receiptAmount) >= 0.000001) {
    return { status: 'HELD_SETTLEMENT_MISMATCH', shouldAllocate: false };
  }
  if (input.existingWalletCredit) return { status: 'HELD_ALREADY_CREDITED', shouldAllocate: false };
  const projectedDifference = input.reconciliationDifference
    + (input.bankCreditAlreadyRecorded ? 0 : input.receiptAmount);
  if (!Number.isFinite(projectedDifference) || Math.abs(projectedDifference) >= 0.01) {
    return { status: 'HELD_RECONCILIATION', shouldAllocate: false };
  }
  return { status: 'ALLOCATED', shouldAllocate: true };
}
