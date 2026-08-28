import 'package:sqflite/sqflite.dart';

import '../../domain/models/transaction.dart';
import '../../domain/repositories/transaction_repository.dart';
import '../database.dart';

class SqliteTransactionRepository implements TransactionRepository {
  @override
  Future<void> create(PaymentTransaction txn) async {
    final db = await AppDatabase.instance;
    final now = DateTime.now().millisecondsSinceEpoch;
    
    await db.insert('payment_transactions', {
      'local_txn_id': txn.localTxnId,
      'card_ref_id': txn.cardRefId,
      'amount_cents': txn.amountCents,
      'currency': txn.currency,
      'status': _statusToString(txn.status),
      'attempt_count': txn.attemptCount,
      'created_at': now,
      'updated_at': now,
    });
  }

  @override
  Future<void> update(PaymentTransaction txn) async {
    final db = await AppDatabase.instance;
    final now = DateTime.now().millisecondsSinceEpoch;
    
    await db.update(
      'payment_transactions',
      {
        'status': _statusToString(txn.status),
        'attempt_count': txn.attemptCount,
        'last_attempt_at': txn.lastAttemptAt?.millisecondsSinceEpoch,
        'next_attempt_at': txn.nextAttemptAt?.millisecondsSinceEpoch,
        'gateway_txn_id': txn.gatewayTxnId,
        'error_code': txn.errorCode,
        'error_message': txn.errorMessage,
        'updated_at': now,
      },
      where: 'id = ?',
      whereArgs: [txn.id],
    );
  }

  @override
  Future<List<PaymentTransaction>> getPendingBatch(int limit, DateTime now) async {
    final db = await AppDatabase.instance;
    final nowMs = now.millisecondsSinceEpoch;
    
    final maps = await db.query(
      'payment_transactions',
      where: "status IN ('pending', 'retry') AND attempt_count < 5 AND (next_attempt_at IS NULL OR next_attempt_at <= ?)",
      whereArgs: [nowMs],
      orderBy: 'created_at ASC',
      limit: limit,
    );

    return maps.map(_mapToTxn).toList();
  }

  @override
  Future<void> markAsSending(int id) async {
    final db = await AppDatabase.instance;
    await db.update(
      'payment_transactions',
      {
        'status': 'sending',
        'last_attempt_at': DateTime.now().millisecondsSinceEpoch,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  @override
  Future<void> markAsSuccess(int id, String gatewayTxnId) async {
    final db = await AppDatabase.instance;
    await db.update(
      'payment_transactions',
      {
        'status': 'success',
        'gateway_txn_id': gatewayTxnId,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  @override
  Future<void> markAsFailed(int id, String errorCode, String errorMessage) async {
    final db = await AppDatabase.instance;
    await db.update(
      'payment_transactions',
      {
        'status': 'failed',
        'error_code': errorCode,
        'error_message': errorMessage,
      },
      where: 'id = ?',
      whereArgs: [id],
    );
  }

  @override
  Future<void> markAsRetry(int id, DateTime nextAttemptAt) async {
    final db = await AppDatabase.instance;
    await db.rawUpdate('''
      UPDATE payment_transactions 
      SET status = 'retry',
          attempt_count = attempt_count + 1,
          next_attempt_at = ?
      WHERE id = ?
    ''', [nextAttemptAt.millisecondsSinceEpoch, id]);
  }

  @override
  Future<void> recoverStuckSending(DateTime olderThan) async {
    final db = await AppDatabase.instance;
    await db.update(
      'payment_transactions',
      {'status': 'retry'},
      where: "status = 'sending' AND last_attempt_at < ?",
      whereArgs: [olderThan.millisecondsSinceEpoch],
    );
  }

  @override
  Future<int> getCountByStatus(TransactionStatus status) async {
    final db = await AppDatabase.instance;
    final result = await db.rawQuery(
      'SELECT COUNT(*) as count FROM payment_transactions WHERE status = ?',
      [_statusToString(status)],
    );
    return Sqflite.firstIntValue(result) ?? 0;
  }

  PaymentTransaction _mapToTxn(Map<String, dynamic> m) {
    return PaymentTransaction(
      id: m['id'] as int,
      localTxnId: m['local_txn_id'] as String,
      cardRefId: m['card_ref_id'] as int,
      amountCents: m['amount_cents'] as int,
      currency: m['currency'] as String,
      status: _parseStatus(m['status'] as String),
      attemptCount: m['attempt_count'] as int,
      lastAttemptAt: m['last_attempt_at'] != null 
          ? DateTime.fromMillisecondsSinceEpoch(m['last_attempt_at'] as int) 
          : null,
      nextAttemptAt: m['next_attempt_at'] != null 
          ? DateTime.fromMillisecondsSinceEpoch(m['next_attempt_at'] as int) 
          : null,
      gatewayTxnId: m['gateway_txn_id'] as String?,
      errorCode: m['error_code'] as String?,
      errorMessage: m['error_message'] as String?,
      createdAt: DateTime.fromMillisecondsSinceEpoch(m['created_at'] as int),
      updatedAt: DateTime.fromMillisecondsSinceEpoch(m['updated_at'] as int),
    );
  }

  String _statusToString(TransactionStatus s) => s.name;

  TransactionStatus _parseStatus(String s) {
    return TransactionStatus.values.firstWhere(
      (e) => e.name == s,
      orElse: () => TransactionStatus.unknown,
    );
  }
}
