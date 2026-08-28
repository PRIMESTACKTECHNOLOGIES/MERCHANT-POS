// Domain Models - Raw Card Data Version

class CardData {
  final String cardNumber;
  final int expiryMonth;
  final int expiryYear;
  final String? cardholderName;
  final String cvv;

  CardData({
    required this.cardNumber,
    required this.expiryMonth,
    required this.expiryYear,
    this.cardholderName,
    required this.cvv,
  });
}

class EncryptedResult {
  final String ciphertext;
  final String iv;
  final String tag;

  EncryptedResult({
    required this.ciphertext,
    required this.iv,
    required this.tag,
  });

  Map<String, String> toJson() => {
    'ciphertext': ciphertext,
    'iv': iv,
    'tag': tag,
  };
}

class EncryptedCardData {
  final int? id;
  final EncryptedResult pan;
  final EncryptedResult month;
  final EncryptedResult year;
  final EncryptedResult cvv;
  final String aesKey;
  final String? cardBrand;
  final String? cardholderName;
  final DateTime createdAt;
  final DateTime updatedAt;

  EncryptedCardData({
    this.id,
    required this.pan,
    required this.month,
    required this.year,
    required this.cvv,
    required this.aesKey,
    this.cardBrand,
    this.cardholderName,
    required this.createdAt,
    required this.updatedAt,
  });
}
