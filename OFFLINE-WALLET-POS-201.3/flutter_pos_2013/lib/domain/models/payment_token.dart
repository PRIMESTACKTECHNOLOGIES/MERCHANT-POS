// Token-based models
import 'transaction.dart';

export 'transaction.dart' show TransactionStatus;

class PaymentToken {
  final int? id;
  final String token;
  final String last4;
  final String brand;
  final int expiryMonth;
  final int expiryYear;
  final DateTime createdAt;
  final DateTime updatedAt;

  PaymentToken({
    this.id,
    required this.token,
    required this.last4,
    required this.brand,
    required this.expiryMonth,
    required this.expiryYear,
    required this.createdAt,
    required this.updatedAt,
  });
}

class TokenizedPaymentTransaction {
  final int? id;
  final String localTxnId;
  final int tokenRefId;
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

  TokenizedPaymentTransaction({
    this.id,
    required this.localTxnId,
    required this.tokenRefId,
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

class TokenizationResult {
  final bool success;
  final String? token;
  final String? last4;
  final String? brand;
  final int? expiryMonth;
  final int? expiryYear;
  final String? errorCode;
  final String? errorMessage;

  TokenizationResult({
    required this.success,
    this.token,
    this.last4,
    this.brand,
    this.expiryMonth,
    this.expiryYear,
    this.errorCode,
    this.errorMessage,
  });
}
