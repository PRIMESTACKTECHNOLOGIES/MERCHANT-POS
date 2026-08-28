enum TransactionStatus {
  pending,
  sending,
  retry,
  success,
  failed,
  unknown,
}

class PaymentTransaction {
  final int? id;
  final String localTxnId;
  final int cardRefId;
  final int amountCents;
  final String currency;
  TransactionStatus status;
  int attemptCount;
  DateTime? lastAttemptAt;
  DateTime? nextAttemptAt;
  String? gatewayTxnId;
  String? errorCode;
  String? errorMessage;
  final DateTime createdAt;
  DateTime updatedAt;

  PaymentTransaction({
    this.id,
    required this.localTxnId,
    required this.cardRefId,
    required this.amountCents,
    required this.currency,
    this.status = TransactionStatus.pending,
    this.attemptCount = 0,
    this.lastAttemptAt,
    this.nextAttemptAt,
    this.gatewayTxnId,
    this.errorCode,
    this.errorMessage,
    required this.createdAt,
    required this.updatedAt,
  });
}
