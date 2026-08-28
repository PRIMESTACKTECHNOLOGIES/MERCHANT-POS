import '../models/card_data.dart';
import '../models/gateway_result.dart';

abstract class PaymentGatewayClient {
  Future<GatewayChargeResult> chargeCard(
    String localTxnId,
    int amountCents,
    String currency,
    CardData card,
  );

  Future<GatewayChargeResult> chargeEncryptedCard(
    String localTxnId,
    int amountCents,
    String currency,
    EncryptedCardData encryptedCard,
  );
}
