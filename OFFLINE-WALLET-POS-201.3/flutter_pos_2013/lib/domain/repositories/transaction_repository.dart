import '../models/transaction.dart';

abstract class TransactionRepository {
  Future<void> create(PaymentTransaction txn);
  Future<void> update(PaymentTransaction txn);
  Future<List<PaymentTransaction>> getPendingBatch(int limit, DateTime now);
  Future<void> markAsSending(int id);
  Future<void> markAsSuccess(int id, String gatewayTxnId);
  Future<void> markAsFailed(int id, String errorCode, String errorMessage);
  Future<void> markAsRetry(int id, DateTime nextAttemptAt);
  Future<void> recoverStuckSending(DateTime olderThan);
  Future<int> getCountByStatus(TransactionStatus status);
}
