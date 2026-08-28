import '../models/card_data.dart';
import '../models/gateway_result.dart';
import '../models/payment_token.dart';

abstract class TokenizationClient {
  Future<TokenizationResult> createToken(CardData card);
}

abstract class TokenPaymentGatewayClient {
  Future<GatewayChargeResult> chargeToken(
    String localTxnId,
    int amountCents,
    String currency,
    String token,
  );
}
