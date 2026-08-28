import 'package:path/path.dart';
import 'package:sqflite/sqflite.dart';

class AppDatabase {
  static Database? _db;
  
  static Future<Database> get instance async {
    _db ??= await _init();
    return _db!;
  }

  static Future<Database> _init() async {
    final path = join(await getDatabasesPath(), 'pos_v2.db');
    
    return await openDatabase(
      path,
      version: 2,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE payment_cards (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pan_encrypted TEXT NOT NULL,
            month_encrypted TEXT NOT NULL,
            year_encrypted TEXT NOT NULL,
            cvv_encrypted TEXT NOT NULL,
            aes_key TEXT NOT NULL,
            card_brand TEXT,
            cardholder_name TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        ''');

        await db.execute('''
          CREATE TABLE payment_transactions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            local_txn_id TEXT NOT NULL UNIQUE,
            card_ref_id INTEGER NOT NULL,
            amount_cents INTEGER NOT NULL,
            currency TEXT NOT NULL,
            status TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0,
            last_attempt_at INTEGER,
            next_attempt_at INTEGER,
            gateway_txn_id TEXT,
            error_code TEXT,
            error_message TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          )
        ''');

        await db.execute('CREATE INDEX idx_status ON payment_transactions(status)');
        await db.execute('CREATE INDEX idx_next_attempt ON payment_transactions(next_attempt_at)');
      },
    );
  }
}
