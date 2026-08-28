import 'dart:convert';
import '../../domain/models/card_data.dart';
import '../../domain/repositories/card_repository.dart';
import '../database.dart';

class SqliteCardRepository implements CardRepository {
  @override
  Future<int> saveEncrypted(EncryptedCardData card) async {
    final db = await AppDatabase.instance;
    final now = DateTime.now().millisecondsSinceEpoch;
    
    return await db.insert('payment_cards', {
      'pan_encrypted': jsonEncode(card.pan.toJson()),
      'month_encrypted': jsonEncode(card.month.toJson()),
      'year_encrypted': jsonEncode(card.year.toJson()),
      'cvv_encrypted': jsonEncode(card.cvv.toJson()),
      'aes_key': card.aesKey,
      'card_brand': card.cardBrand,
      'cardholder_name': card.cardholderName,
      'created_at': now,
      'updated_at': now,
    });
  }

  @override
  Future<EncryptedCardData?> getById(int id) async {
    final db = await AppDatabase.instance;
    final maps = await db.query(
      'payment_cards',
      where: 'id = ?',
      whereArgs: [id],
    );

    if (maps.isEmpty) return null;

    final m = maps.first;
    
    EncryptedResult parseEnc(String json) {
      final data = jsonDecode(json);
      return EncryptedResult(
        ciphertext: data['ciphertext'],
        iv: data['iv'],
        tag: data['tag'],
      );
    }

    return EncryptedCardData(
      id: m['id'] as int,
      pan: parseEnc(m['pan_encrypted'] as String),
      month: parseEnc(m['month_encrypted'] as String),
      year: parseEnc(m['year_encrypted'] as String),
      cvv: parseEnc(m['cvv_encrypted'] as String),
      aesKey: m['aes_key'] as String,
      cardBrand: m['card_brand'] as String?,
      cardholderName: m['cardholder_name'] as String?,
      createdAt: DateTime.fromMillisecondsSinceEpoch(m['created_at'] as int),
      updatedAt: DateTime.fromMillisecondsSinceEpoch(m['updated_at'] as int),
    );
  }
}
