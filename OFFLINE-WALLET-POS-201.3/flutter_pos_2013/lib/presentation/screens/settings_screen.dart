import 'package:flutter/material.dart';
import 'package:shared_preferences/shared_preferences.dart';
import '../../domain/services/sync_service.dart';
import '../../data/repositories/sqlite_card_repository.dart';
import '../../data/repositories/sqlite_transaction_repository.dart';
import '../../data/services/aes_crypto.dart';
import '../../data/services/http_gateway.dart';

class SettingsScreen extends StatefulWidget {
  const SettingsScreen({super.key});

  @override
  State<SettingsScreen> createState() => _SettingsScreenState();
}

class _SettingsScreenState extends State<SettingsScreen> {
  bool _forceOffline = false;
  bool _syncing = false;
  final _backendUrlController = TextEditingController(
    text: 'https://pos-offline-sftwr.onrender.com',
  );
  late final SyncService _syncService;

  @override
  void initState() {
    super.initState();
    _syncService = SyncService(
      txnRepo: SqliteTransactionRepository(),
      cardRepo: SqliteCardRepository(),
      crypto: AesCryptoService(),
      gateway: HttpGatewayClient(),
    );
    _loadSettings();
  }

  Future<void> _loadSettings() async {
    final prefs = await SharedPreferences.getInstance();
    setState(() {
      _forceOffline = prefs.getBool('force_offline') ?? false;
    });
  }

  Future<void> _setForceOffline(bool value) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool('force_offline', value);
    setState(() => _forceOffline = value);
  }

  Future<void> _triggerSync() async {
    if (_syncing) return;
    setState(() => _syncing = true);

    try {
      await _syncService.syncPendingTransactions(20);
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Sync completed successfully'),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Sync failed: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _syncing = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Settings'),
      ),
      body: ListView(
        children: [
          const ListTile(
            title: Text('Network'),
            subtitle: Text('Connection settings'),
          ),
          SwitchListTile(
            title: const Text('Force Offline Mode'),
            subtitle: const Text('Store all payments locally without syncing'),
            value: _forceOffline,
            onChanged: _setForceOffline,
          ),
          const Divider(),
          const ListTile(
            title: Text('Backend'),
            subtitle: Text('Server configuration'),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: TextField(
              controller: _backendUrlController,
              decoration: const InputDecoration(
                labelText: 'Backend URL',
                hintText: 'https://your-backend.com',
              ),
            ),
          ),
          const Divider(),
          ListTile(
            title: const Text('Sync Now'),
            leading: _syncing 
              ? const SizedBox(width: 24, height: 24, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.sync),
            onTap: _syncing ? null : _triggerSync,
          ),
          const Divider(),
          const ListTile(
            title: Text('About'),
          ),
          const ListTile(
            leading: Icon(Icons.info),
            title: Text('App Version'),
            subtitle: Text('2.0.0 - Protocol 201.3'),
          ),
        ],
      ),
    );
  }
}
