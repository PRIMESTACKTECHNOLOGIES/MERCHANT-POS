import '../models/card_data.dart';

abstract class CardRepository {
  Future<int> saveEncrypted(EncryptedCardData card);
  Future<EncryptedCardData?> getById(int id);
}
