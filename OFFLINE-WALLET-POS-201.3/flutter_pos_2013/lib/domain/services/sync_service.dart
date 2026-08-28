import '../models/gateway_result.dart';
import '../models/transaction.dart';
import '../repositories/card_repository.dart';
import '../repositories/transaction_repository.dart';
import 'crypto_service.dart';
import 'payment_gateway_client.dart';

class SyncService {
  final TransactionRepository _txnRepo;
  final CardRepository _cardRepo;
  final CryptoService _crypto;
  final PaymentGatewayClient _gateway;
  final DateTime Function() _clock;

  SyncService({
    required TransactionRepository txnRepo,
    required CardRepository cardRepo,
    required CryptoService crypto,
    required PaymentGatewayClient gateway,
    DateTime Function()? clock,
  })  : _txnRepo = txnRepo,
        _cardRepo = cardRepo,
        _crypto = crypto,
        _gateway = gateway,
        _clock = clock ?? DateTime.now;

  Future<void> syncPendingTransactions(int maxBatchSize) async {
    final now = _clock();
    final txns = await _txnRepo.getPendingBatch(maxBatchSize, now);

    for (final txn in txns) {
      await _processSingleTransaction(txn);
    }
  }

  Future<void> _processSingleTransaction(PaymentTransaction txn) async {
    try {
      await _txnRepo.markAsSending(txn.id!);

      final encCard = await _cardRepo.getById(txn.cardRefId);
      if (encCard == null) {
        await _txnRepo.markAsFailed(
          txn.id!,
          'CARD_NOT_FOUND',
          'Card reference missing',
        );
        return;
      }

      // Validate the encrypted card payload can still be decrypted for a real gateway attempt.
      final _ = _crypto.decryptCard(encCard);

      final result = await _gateway.chargeEncryptedCard(
        txn.localTxnId,
        txn.amountCents,
        txn.currency,
        encCard,
      );

      if (result.type == GatewayResultType.success) {
        await _txnRepo.markAsSuccess(txn.id!, result.gatewayTxnId!);
      } else if (result.type == GatewayResultType.hardFail) {
        await _txnRepo.markAsFailed(
          txn.id!,
          result.errorCode!,
          result.errorMessage!,
        );
      } else {
        final nextAttemptAt = _computeNextAttempt(txn);
        await _txnRepo.markAsRetry(txn.id!, nextAttemptAt);
      }
    } catch (e) {
      final nextAttemptAt = _computeNextAttempt(txn);
      await _txnRepo.markAsRetry(txn.id!, nextAttemptAt);
    }
  }

  DateTime _computeNextAttempt(PaymentTransaction txn) {
    const baseMinutes = [1, 5, 30, 120, 1440];
    final idx = txn.attemptCount < baseMinutes.length ? txn.attemptCount : baseMinutes.length - 1;
    final minutes = baseMinutes[idx];
    final d = _clock();
    return d.add(Duration(minutes: minutes));
  }

  Future<void> recoverStuckTransactions() async {
    final threshold = _clock().subtract(const Duration(minutes: 10));
    await _txnRepo.recoverStuckSending(threshold);
  }
}
