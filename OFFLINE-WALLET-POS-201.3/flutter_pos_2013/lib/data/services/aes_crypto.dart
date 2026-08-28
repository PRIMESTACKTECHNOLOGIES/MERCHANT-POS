import 'dart:convert';
import 'package:encrypt/encrypt.dart' as encrypt;
import '../../domain/models/card_data.dart';
import '../../domain/services/crypto_service.dart';

class AesCryptoService implements CryptoService {

  @override
  EncryptedCardData encryptCard(CardData card) {
    // Generate a 256-bit key per transaction
    final aesKey = encrypt.Key.fromSecureRandom(32);
    
    // GCM setup
    final encrypter = encrypt.Encrypter(
      encrypt.AES(aesKey, mode: encrypt.AESMode.gcm),
    );

    EncryptedResult encryptField(String plainText) {
      final iv = encrypt.IV.fromSecureRandom(12); // GCM standard 12-byte IV
      final encrypted = encrypter.encrypt(plainText, iv: iv);
      
      // The 'encrypt' package appends the 16-byte GCM tag to the ciphertext
      final fullBytes = encrypted.bytes;
      const tagLength = 16;
      final ciphertextBytes = fullBytes.sublist(0, fullBytes.length - tagLength);
      final tagBytes = fullBytes.sublist(fullBytes.length - tagLength);

      return EncryptedResult(
        ciphertext: base64Encode(ciphertextBytes),
        iv: iv.base64,
        tag: base64Encode(tagBytes),
      );
    }

    final now = DateTime.now();
    return EncryptedCardData(
      pan: encryptField(card.cardNumber),
      month: encryptField(card.expiryMonth.toString().padLeft(2, '0')),
      year: encryptField(card.expiryYear.toString()),
      cvv: encryptField(card.cvv),
      aesKey: aesKey.base64,
      cardBrand: _detectBrand(card.cardNumber),
      cardholderName: card.cardholderName,
      createdAt: now,
      updatedAt: now,
    );
  }

  String _detectBrand(String pan) {
    final cleanPan = pan.replaceAll(RegExp(r'\s+'), '');
    if (cleanPan.startsWith('4')) return 'VISA';
    if (RegExp(r'^5[1-5]').hasMatch(cleanPan)) return 'MASTERCARD';
    if (RegExp(r'^3[47]').hasMatch(cleanPan)) return 'AMEX';
    return 'UNKNOWN';
  }

  @override
  CardData decryptCard(EncryptedCardData enc) {
    // This is for local view ONLY if needed
    // Decryption would require the stored aesKey and IVs/Tags
    return CardData(
      cardNumber: 'XXXX XXXX XXXX ${enc.pan.ciphertext.length > 4 ? '...' : ''}',
      expiryMonth: int.parse('01'),
      expiryYear: 2026,
      cvv: '***',
      cardholderName: enc.cardholderName,
    );
  }
}
