import '../models/card_data.dart';

abstract class CryptoService {
  EncryptedCardData encryptCard(CardData card);
  CardData decryptCard(EncryptedCardData enc);
}
