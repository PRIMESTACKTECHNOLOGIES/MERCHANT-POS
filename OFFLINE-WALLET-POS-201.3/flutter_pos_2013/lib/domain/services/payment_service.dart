import 'dart:math';
import '../models/card_data.dart';
import '../models/transaction.dart';
import '../repositories/card_repository.dart';
import '../repositories/transaction_repository.dart';
import 'crypto_service.dart';

class PaymentService {
  final CardRepository _cardRepo;
  final TransactionRepository _txnRepo;
  final CryptoService _crypto;

  PaymentService({
    required CardRepository cardRepo,
    required TransactionRepository txnRepo,
    required CryptoService crypto,
  })  : _cardRepo = cardRepo,
        _txnRepo = txnRepo,
        _crypto = crypto;

  Future<String> createOfflineTransaction({
    required CardData card,
    required int amountCents,
    required String currency,
  }) async {
    final encCard = _crypto.encryptCard(card);
    final cardId = await _cardRepo.saveEncrypted(encCard);

    final now = DateTime.now();
    final txn = PaymentTransaction(
      localTxnId: generateUuid(),
      cardRefId: cardId,
      amountCents: amountCents,
      currency: currency,
      status: TransactionStatus.pending,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    );

    await _txnRepo.create(txn);

    return txn.localTxnId;
  }

  String generateUuid() {
    final now = DateTime.now().millisecondsSinceEpoch;
    final random = Random().nextInt(9999);
    return 'TXN-$now-$random';
  }
}
