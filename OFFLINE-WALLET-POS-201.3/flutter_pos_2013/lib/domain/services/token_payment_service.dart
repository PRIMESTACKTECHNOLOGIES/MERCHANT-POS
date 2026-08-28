import 'dart:math';
import '../models/card_data.dart';
import '../models/payment_token.dart';
import '../repositories/token_repository.dart';
import 'tokenization_client.dart';

class TokenPaymentService {
  final TokenizationClient _tokenizationClient;
  final TokenRepository _tokenRepo;
  final TokenTransactionRepository _txnRepo;

  TokenPaymentService({
    required TokenizationClient tokenizationClient,
    required TokenRepository tokenRepo,
    required TokenTransactionRepository txnRepo,
  })  : _tokenizationClient = tokenizationClient,
        _tokenRepo = tokenRepo,
        _txnRepo = txnRepo;

  Future<({String localTxnId, int? tokenId, String? error})> createTransactionWithCard({
    required CardData card,
    required int amountCents,
    required String currency,
  }) async {
    // 1. Tokenize card (requires online)
    final tokenResult = await _tokenizationClient.createToken(card);

    if (!tokenResult.success) {
      return (localTxnId: '', tokenId: null, error: tokenResult.errorMessage ?? 'Tokenization failed');
    }

    // 2. Store token locally
    final now = DateTime.now();
    final token = PaymentToken(
      token: tokenResult.token!,
      last4: tokenResult.last4!,
      brand: tokenResult.brand!,
      expiryMonth: tokenResult.expiryMonth!,
      expiryYear: tokenResult.expiryYear!,
      createdAt: now,
      updatedAt: now,
    );

    final tokenId = await _tokenRepo.saveToken(token);

    // 3. Create transaction with token reference
    final txn = TokenizedPaymentTransaction(
      localTxnId: _generateUuid(),
      tokenRefId: tokenId,
      amountCents: amountCents,
      currency: currency,
      status: TransactionStatus.pending,
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    );

    await _txnRepo.create(txn);

    return (localTxnId: txn.localTxnId, tokenId: tokenId, error: null);
  }

  String _generateUuid() {
    final now = DateTime.now().millisecondsSinceEpoch;
    final random = Random().nextInt(9999);
    return 'TXN-$now-$random';
  }
}
