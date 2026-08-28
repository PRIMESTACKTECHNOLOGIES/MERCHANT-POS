import '../models/payment_token.dart';

abstract class TokenRepository {
  Future<int> saveToken(PaymentToken token);
  Future<PaymentToken?> getById(int id);
}

abstract class TokenTransactionRepository {
  Future<void> create(TokenizedPaymentTransaction txn);
  Future<void> update(TokenizedPaymentTransaction txn);
  Future<List<TokenizedPaymentTransaction>> getPendingBatch(int limit, DateTime now);
  Future<void> markAsSending(int id);
  Future<void> markAsSuccess(int id, String gatewayTxnId);
  Future<void> markAsFailed(int id, String errorCode, String errorMessage);
  Future<void> markAsRetry(int id, DateTime nextAttemptAt);
  Future<void> recoverStuckSending(DateTime olderThan);
}
