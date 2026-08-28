import '../models/gateway_result.dart';
import '../models/payment_token.dart';
import '../repositories/token_repository.dart';

abstract class TokenPaymentGatewayClient {
  Future<GatewayChargeResult> chargeToken(
    String localTxnId,
    int amountCents,
    String currency,
    String token,
  );
}

class TokenSyncService {
  final TokenTransactionRepository _txnRepo;
  final TokenRepository _tokenRepo;
  final TokenPaymentGatewayClient _gateway;
  final DateTime Function() _clock;

  TokenSyncService({
    required TokenTransactionRepository txnRepo,
    required TokenRepository tokenRepo,
    required TokenPaymentGatewayClient gateway,
    DateTime Function()? clock,
  })  : _txnRepo = txnRepo,
        _tokenRepo = tokenRepo,
        _gateway = gateway,
        _clock = clock ?? DateTime.now;

  Future<void> syncPendingTransactions(int maxBatchSize) async {
    final now = _clock();
    final txns = await _txnRepo.getPendingBatch(maxBatchSize, now);

    for (final txn in txns) {
      await _processSingleTransaction(txn);
    }
  }

  Future<void> _processSingleTransaction(TokenizedPaymentTransaction txn) async {
    try {
      await _txnRepo.markAsSending(txn.id!);

      final token = await _tokenRepo.getById(txn.tokenRefId);
      if (token == null) {
        await _txnRepo.markAsFailed(txn.id!, 'TOKEN_NOT_FOUND', 'Token reference missing');
        return;
      }

      final result = await _gateway.chargeToken(
        txn.localTxnId,
        txn.amountCents,
        txn.currency,
        token.token,
      );

      if (result.type == GatewayResultType.success) {
        await _txnRepo.markAsSuccess(txn.id!, result.gatewayTxnId!);
      } else if (result.type == GatewayResultType.hardFail) {
        await _txnRepo.markAsFailed(txn.id!, result.errorCode!, result.errorMessage!);
      } else {
        final nextAttemptAt = _computeNextAttempt(txn);
        await _txnRepo.markAsRetry(txn.id!, nextAttemptAt);
      }
    } catch (e) {
      final nextAttemptAt = _computeNextAttempt(txn);
      await _txnRepo.markAsRetry(txn.id!, nextAttemptAt);
    }
  }

  DateTime _computeNextAttempt(TokenizedPaymentTransaction txn) {
    const baseMinutes = [1, 5, 30, 120, 1440];
    final idx = txn.attemptCount < baseMinutes.length ? txn.attemptCount : baseMinutes.length - 1;
    final minutes = baseMinutes[idx];
    return _clock().add(Duration(minutes: minutes));
  }

  Future<void> recoverStuckTransactions() async {
    final threshold = _clock().subtract(const Duration(minutes: 10));
    await _txnRepo.recoverStuckSending(threshold);
  }
}
