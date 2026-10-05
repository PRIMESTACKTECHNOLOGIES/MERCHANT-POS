import 'package:flutter/material.dart';

class WisePaymentScreen extends StatefulWidget {
  const WisePaymentScreen({super.key});

  @override
  State<WisePaymentScreen> createState() => _WisePaymentScreenState();
}

class _WisePaymentScreenState extends State<WisePaymentScreen> {
  final _formKey = GlobalKey<FormState>();
  final _amountController = TextEditingController();
  final _ibanController = TextEditingController();
  final _recipientNameController = TextEditingController();
  final _purposeController = TextEditingController();

  String _selectedCurrency = 'EUR';
  final double _exchangeRate = 1.0;
  double _estimatedAmount = 0.0;
  bool _isLoading = false;

  final List<String> _currencies = ['EUR', 'GBP', 'USD', 'CHF', 'SEK', 'NOK'];

  @override
  void initState() {
    super.initState();
    _amountController.addListener(_updateExchangeRate);
  }

  void _updateExchangeRate() {
    setState(() {
      final double amount = double.tryParse(_amountController.text) ?? 0;
      _estimatedAmount = amount * _exchangeRate;
    });
  }

  String _formatIBAN(String value) {
    value = value.replaceAll(' ', '').toUpperCase();
    if (value.length > 34) return value.substring(0, 34);

    final buffer = StringBuffer();
    for (int i = 0; i < value.length; i++) {
      if (i > 0 && i % 4 == 0) buffer.write(' ');
      buffer.write(value[i]);
    }
    return buffer.toString();
  }

  bool _isValidIBAN(String iban) {
    iban = iban.replaceAll(' ', '');
    return iban.length >= 15 && iban.length <= 34;
  }

  Future<void> _submitPayment() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _isLoading = true);

    try {
      // TODO: Integrate with backend /wise/initiate-payment endpoint
      final payload = {
        'customerId': 'customer_id_placeholder',
        'amount': double.parse(_amountController.text),
        'currency': _selectedCurrency,
        'targetAccountId': 'target_account_id_placeholder',
        'recipientIban': _ibanController.text.replaceAll(' ', ''),
        'recipientName': _recipientNameController.text,
        'purpose': _purposeController.text.isEmpty
            ? 'Payment'
            : _purposeController.text,
      };

      // Example: Call backend API
      // final response = await apiClient.post('/wise/initiate-payment', data: payload);

      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Payment initiated successfully!'),
          backgroundColor: Colors.green,
        ),
      );

      // Clear form on success
      _formKey.currentState!.reset();
      _amountController.clear();
      _ibanController.clear();
      _recipientNameController.clear();
      _purposeController.clear();
    } catch (error) {
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text('Payment failed: $error'),
          backgroundColor: Colors.red,
        ),
      );
    } finally {
      setState(() => _isLoading = false);
    }
  }

  @override
  void dispose() {
    _amountController.dispose();
    _ibanController.dispose();
    _recipientNameController.dispose();
    _purposeController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('SEPA Payment via Wise'),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              // Amount input
              TextFormField(
                controller: _amountController,
                decoration: const InputDecoration(
                  labelText: 'Amount',
                  hintText: '0.00',
                  prefixIcon: Icon(Icons.attach_money),
                  border: OutlineInputBorder(),
                ),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Amount is required';
                  }
                  final amount = double.tryParse(value);
                  if (amount == null || amount <= 0) {
                    return 'Enter a valid amount';
                  }
                  if (amount > 1000000) {
                    return 'Amount exceeds limit';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),

              // Currency selection
              Row(
                children: [
                  Expanded(
                    child: DropdownButtonFormField<String>(
                      initialValue: _selectedCurrency,
                      decoration: const InputDecoration(
                        labelText: 'Target Currency',
                        border: OutlineInputBorder(),
                      ),
                      items: _currencies
                          .map((c) =>
                              DropdownMenuItem(value: c, child: Text(c)))
                          .toList(),
                      onChanged: (value) {
                        setState(() {
                          _selectedCurrency = value ?? 'EUR';
                          _updateExchangeRate();
                        });
                      },
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        border: Border.all(color: Colors.grey),
                        borderRadius: BorderRadius.circular(4),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text('Exchange Rate',
                              style: TextStyle(
                                  fontSize: 12, color: Colors.grey)),
                          Text(
                            '1 EUR = $_exchangeRate $_selectedCurrency',
                            style: Theme.of(context).textTheme.bodyMedium,
                          ),
                        ],
                      ),
                    ),
                  ),
                ],
              ),
              const SizedBox(height: 16),

              // Estimated amount display
              if (_estimatedAmount > 0)
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: Colors.blue.shade50,
                    borderRadius: BorderRadius.circular(4),
                  ),
                  child: Text(
                    'Estimated: ${_estimatedAmount.toStringAsFixed(2)} $_selectedCurrency',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
              const SizedBox(height: 24),

              // Recipient IBAN
              TextFormField(
                controller: _ibanController,
                decoration: const InputDecoration(
                  labelText: 'Recipient IBAN',
                  hintText: 'DE89370400440532013000',
                  prefixIcon: Icon(Icons.account_balance),
                  border: OutlineInputBorder(),
                ),
                onChanged: (value) {
                  setState(() {
                    _ibanController.text = _formatIBAN(value);
                    _ibanController.selection = TextSelection.fromPosition(
                      TextPosition(offset: _ibanController.text.length),
                    );
                  });
                },
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'IBAN is required';
                  }
                  if (!_isValidIBAN(value)) {
                    return 'Invalid IBAN format (15-34 characters)';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),

              // Recipient name
              TextFormField(
                controller: _recipientNameController,
                decoration: const InputDecoration(
                  labelText: 'Recipient Name',
                  prefixIcon: Icon(Icons.person),
                  border: OutlineInputBorder(),
                ),
                validator: (value) {
                  if (value == null || value.isEmpty) {
                    return 'Recipient name is required';
                  }
                  return null;
                },
              ),
              const SizedBox(height: 16),

              // Purpose (optional)
              TextFormField(
                controller: _purposeController,
                decoration: const InputDecoration(
                  labelText: 'Purpose (Optional)',
                  hintText: 'Payment reason',
                  border: OutlineInputBorder(),
                ),
                maxLines: 2,
              ),
              const SizedBox(height: 32),

              // Submit button
              SizedBox(
                width: double.infinity,
                child: ElevatedButton(
                  onPressed: _isLoading ? null : _submitPayment,
                  style: ElevatedButton.styleFrom(
                    padding: const EdgeInsets.symmetric(vertical: 14),
                    backgroundColor: Colors.blue,
                    disabledBackgroundColor: Colors.grey,
                  ),
                  child: _isLoading
                      ? const SizedBox(
                          height: 20,
                          width: 20,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            valueColor:
                                AlwaysStoppedAnimation<Color>(Colors.white),
                          ),
                        )
                      : const Text(
                          'Initiate Payment',
                          style: TextStyle(fontSize: 16, color: Colors.white),
                        ),
                ),
              ),
              const SizedBox(height: 16),

              // Info text
              Container(
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Colors.amber.shade50,
                  border: Border.all(color: Colors.amber),
                  borderRadius: BorderRadius.circular(4),
                ),
                child: Text(
                  'SEPA payments typically complete within 1-2 business days. You will receive a confirmation email.',
                  style: TextStyle(
                      fontSize: 12, color: Colors.amber.shade900),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
