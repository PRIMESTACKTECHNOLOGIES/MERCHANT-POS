import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import '../../domain/models/card_data.dart';
import '../../domain/services/payment_service.dart';
import '../../data/repositories/sqlite_card_repository.dart';
import '../../data/repositories/sqlite_transaction_repository.dart';
import '../../data/services/aes_crypto.dart';
import '../utils/card_input_formatters.dart';

class PaymentScreen extends StatefulWidget {
  const PaymentScreen({super.key});

  @override
  State<PaymentScreen> createState() => _PaymentScreenState();
}

class _PaymentScreenState extends State<PaymentScreen> {
  final _panController = TextEditingController();
  final _expiryController = TextEditingController();
  final _cvvController = TextEditingController();
  final _amountController = TextEditingController();
  final _nameController = TextEditingController();

  bool _loading = false;
  String _paymentMode = 'offline';
  late final PaymentService _paymentService;

  @override
  void initState() {
    super.initState();
    _amountController.text = '25.00';
    _paymentService = PaymentService(
      cardRepo: SqliteCardRepository(),
      txnRepo: SqliteTransactionRepository(),
      crypto: AesCryptoService(),
    );
  }

  @override
  void dispose() {
    _panController.dispose();
    _expiryController.dispose();
    _cvvController.dispose();
    _amountController.dispose();
    _nameController.dispose();
    super.dispose();
  }

  Future<void> _processPayment() async {
    setState(() => _loading = true);

    try {
      final pan = _panController.text.replaceAll(' ', '');
      final expiry = _expiryController.text.trim();
      final cvv = _cvvController.text.trim();
      final amount = double.tryParse(_amountController.text) ?? 0;
      final name = _nameController.text.trim();

      final expiryParts = expiry.split('/');
      if (expiryParts.length != 2) {
        throw Exception('Invalid expiry format. Use MM/YY');
      }

      final month = int.tryParse(expiryParts[0]) ?? 0;
      final year = int.tryParse(expiryParts[1]) ?? 0;
      final fullYear = year < 100 ? 2000 + year : year;

      if (month < 1 || month > 12) {
        throw Exception('Expiry month must be between 01 and 12');
      }
      if (fullYear < DateTime.now().year) {
        throw Exception('Card expiry date is invalid');
      }
      if (pan.length < 13 || pan.length > 19) {
        throw Exception('Enter a valid card number');
      }
      if (cvv.length < 3 || cvv.length > 4) {
        throw Exception('CVV must be 3 or 4 digits');
      }
      if (amount <= 0) {
        throw Exception('Amount must be greater than zero');
      }

      final txnId = await _paymentService.createOfflineTransaction(
        card: CardData(
          cardNumber: pan,
          expiryMonth: month,
          expiryYear: fullYear,
          cvv: cvv,
          cardholderName: name.isEmpty ? null : name,
        ),
        amountCents: (amount * 100).round(),
        currency: 'USD',
      );

      if (mounted) {
        final modeText = _paymentMode == 'online' ? 'online' : 'offline';
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Payment saved as $modeText transaction. TXN: $txnId'),
            backgroundColor: Colors.green,
          ),
        );

        _panController.clear();
        _expiryController.clear();
        _cvvController.clear();
        _amountController.clear();
        _nameController.clear();
        _amountController.text = '25.00';
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text('Error: $e'),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final isOffline = _paymentMode == 'offline';

    return Scaffold(
      appBar: AppBar(
        title: const Text('POS Payment'),
        actions: [
          IconButton(
            icon: const Icon(Icons.settings),
            onPressed: () => Navigator.pushNamed(context, '/settings'),
          ),
        ],
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: const LinearGradient(
                  colors: [Colors.blue, Colors.indigo],
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                ),
                borderRadius: BorderRadius.circular(20),
              ),
              child: Column(
                children: [
                  const Icon(Icons.account_balance_wallet_rounded, size: 48, color: Colors.white),
                  const SizedBox(height: 8),
                  const Text(
                    'Offline + Online POS',
                    style: TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  const SizedBox(height: 6),
                  Text(
                    isOffline ? 'Secure offline sale queued for sync' : 'Live online payment mode',
                    style: const TextStyle(color: Colors.white70),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 20),
            SegmentedButton<String>(
              segments: const [
                ButtonSegment(value: 'offline', label: Text('Offline'), icon: Icon(Icons.cloud_off)),
                ButtonSegment(value: 'online', label: Text('Online'), icon: Icon(Icons.cloud_done)),
              ],
              selected: {_paymentMode},
              onSelectionChanged: (Set<String> selection) {
                setState(() => _paymentMode = selection.first);
              },
            ),
            const SizedBox(height: 20),
            Card(
              elevation: 3,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    TextField(
                      controller: _panController,
                      decoration: const InputDecoration(
                        labelText: 'Card Number',
                        hintText: '4111 1111 1111 1111',
                        prefixIcon: Icon(Icons.credit_card),
                        border: OutlineInputBorder(),
                      ),
                      keyboardType: TextInputType.number,
                      inputFormatters: [
                        FilteringTextInputFormatter.digitsOnly,
                        CardNumberInputFormatter(),
                      ],
                    ),
                    const SizedBox(height: 12),
                    Row(
                      children: [
                        Expanded(
                          child: TextField(
                            controller: _expiryController,
                            decoration: const InputDecoration(
                              labelText: 'Expiry (MM/YY)',
                              hintText: '12/28',
                              border: OutlineInputBorder(),
                            ),
                            keyboardType: TextInputType.number,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly,
                              CardMonthInputFormatter(),
                            ],
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: TextField(
                            controller: _cvvController,
                            decoration: const InputDecoration(
                              labelText: 'CVV',
                              hintText: '123',
                              counterText: '',
                              border: OutlineInputBorder(),
                            ),
                            keyboardType: TextInputType.number,
                            maxLength: 4,
                            enableSuggestions: false,
                            autocorrect: false,
                            inputFormatters: [
                              FilteringTextInputFormatter.digitsOnly,
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _nameController,
                      decoration: const InputDecoration(
                        labelText: 'Cardholder Name',
                        hintText: 'John Doe',
                        prefixIcon: Icon(Icons.person),
                        border: OutlineInputBorder(),
                      ),
                      textCapitalization: TextCapitalization.words,
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            Card(
              elevation: 2,
              shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: TextField(
                  controller: _amountController,
                  decoration: const InputDecoration(
                    labelText: 'Amount',
                    hintText: '25.00',
                    prefixText: '\$ ',
                    border: OutlineInputBorder(),
                    prefixIcon: Icon(Icons.attach_money),
                  ),
                  keyboardType: const TextInputType.numberWithOptions(decimal: true),
                ),
              ),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: _loading ? null : _processPayment,
              icon: _loading
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : Icon(isOffline ? Icons.save : Icons.payment),
              label: Text(
                  _loading
                      ? 'Processing...'
                      : isOffline
                          ? 'Save Offline Payment'
                          : 'Process Online Payment',
              ),
              style: ElevatedButton.styleFrom(
                minimumSize: const Size.fromHeight(54),
                backgroundColor: isOffline ? Colors.green : Colors.blue,
                foregroundColor: Colors.white,
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => Navigator.pushNamed(context, '/dashboard'),
              icon: const Icon(Icons.dashboard),
              label: const Text('View Sync Dashboard'),
              style: OutlinedButton.styleFrom(
                minimumSize: const Size.fromHeight(52),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}
