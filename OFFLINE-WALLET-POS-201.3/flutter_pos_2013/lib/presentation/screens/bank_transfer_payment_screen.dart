import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

class BankTransferPaymentScreen extends StatefulWidget {
  const BankTransferPaymentScreen({Key? key}) : super(key: key);

  @override
  State<BankTransferPaymentScreen> createState() =>
      _BankTransferPaymentScreenState();
}

class _BankTransferPaymentScreenState extends State<BankTransferPaymentScreen> {
  bool _showDetails = false;
  bool _copiedToClipboard = false;

  // Wise USD Account Details
  final Map<String, String> bankDetails = {
    'Payee Name': 'Wise US Inc',
    'Wire Routing Number': '021000021',
    'Account Number': '205756130',
    'Account Type': 'Checking / Business Checking',
    'Reference Code': 'P201006522',
    'Bank Name': 'JPMORGAN CHASE BANK',
    'Bank Address': '270 Park Avenue, New York, NY 10017',
    'Bank Phone': '+1 212 270 6000',
    'Amount to Send': '117,123.08 USD',
  };

  void _copyToClipboard(String text, String label) {
    Clipboard.setData(ClipboardData(text: text));
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(
        content: Text('$label copied to clipboard'),
        duration: Duration(seconds: 2),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Wire Transfer Payment'),
        elevation: 0,
      ),
      body: SingleChildScrollView(
        child: Column(
          children: [
            // Hero section
            Container(
              width: double.infinity,
              padding: EdgeInsets.all(20),
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: [Colors.blue.shade600, Colors.blue.shade800],
                ),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.account_balance, size: 40, color: Colors.white),
                  SizedBox(height: 12),
                  Text(
                    'Bank Wire Transfer',
                    style: TextStyle(
                      fontSize: 24,
                      fontWeight: FontWeight.bold,
                      color: Colors.white,
                    ),
                  ),
                  SizedBox(height: 8),
                  Text(
                    'Send USD directly to our Wise account',
                    style: TextStyle(color: Colors.white70, fontSize: 14),
                  ),
                ],
              ),
            ),

            // Main content
            Padding(
              padding: EdgeInsets.all(16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  // Instructions
                  Card(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'How to Send Payment',
                            style: Theme.of(context).textTheme.titleLarge,
                          ),
                          SizedBox(height: 12),
                          ...[
                            '1. Log into your bank account',
                            '2. Select "Send Wire Transfer" or "International Transfer"',
                            '3. Choose "Domestic USD Transfer" (not international)',
                            '4. Enter the bank details below',
                            '5. In the "Reference" field, enter: P201006522',
                            '6. Enter amount: 117,123.08 USD (or partial)',
                            '7. Review and confirm transfer',
                            '8. You\'ll receive confirmation in 1-2 business days',
                          ]
                              .map((step) => Padding(
                                    padding: EdgeInsets.symmetric(vertical: 6),
                                    child: Text(
                                      step,
                                      style: TextStyle(fontSize: 14),
                                    ),
                                  ))
                              .toList(),
                        ],
                      ),
                    ),
                  ),
                  SizedBox(height: 20),

                  // Bank Details
                  Card(
                    child: Column(
                      children: [
                        Container(
                          width: double.infinity,
                          padding: EdgeInsets.all(16),
                          decoration: BoxDecoration(
                            color: Colors.blue.shade50,
                            border: Border(
                              bottom: BorderSide(color: Colors.blue.shade200),
                            ),
                          ),
                          child: Row(
                            mainAxisAlignment:
                                MainAxisAlignment.spaceBetween,
                            children: [
                              Text(
                                'Bank Account Details',
                                style: Theme.of(context).textTheme.titleMedium,
                              ),
                              IconButton(
                                icon: Icon(_showDetails
                                    ? Icons.expand_less
                                    : Icons.expand_more),
                                onPressed: () {
                                  setState(() => _showDetails = !_showDetails);
                                },
                              ),
                            ],
                          ),
                        ),
                        if (_showDetails)
                          Padding(
                            padding: EdgeInsets.all(16),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                // Payee
                                _buildDetailRow(
                                  'Payee Name',
                                  bankDetails['Payee Name']!,
                                ),
                                Divider(),

                                // Bank
                                _buildDetailRow(
                                  'Bank Name',
                                  bankDetails['Bank Name']!,
                                ),
                                Divider(),

                                // Routing Number
                                _buildDetailRow(
                                  'Wire Routing Number',
                                  bankDetails['Wire Routing Number']!,
                                ),
                                Divider(),

                                // Account Number
                                _buildDetailRow(
                                  'Account Number',
                                  bankDetails['Account Number']!,
                                ),
                                Divider(),

                                // Account Type
                                _buildDetailRow(
                                  'Account Type',
                                  bankDetails['Account Type']!,
                                ),
                                Divider(),

                                // Reference Code (IMPORTANT)
                                Container(
                                  padding: EdgeInsets.all(12),
                                  decoration: BoxDecoration(
                                    color: Colors.orange.shade50,
                                    border: Border.all(
                                        color: Colors.orange.shade300),
                                    borderRadius: BorderRadius.circular(4),
                                  ),
                                  child: Column(
                                    crossAxisAlignment:
                                        CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        '⚠️ IMPORTANT: Reference Code',
                                        style: TextStyle(
                                          fontWeight: FontWeight.bold,
                                          color: Colors.orange.shade900,
                                        ),
                                      ),
                                      SizedBox(height: 8),
                                      Row(
                                        children: [
                                          Expanded(
                                            child: Text(
                                              bankDetails['Reference Code']!,
                                              style: TextStyle(
                                                fontSize: 16,
                                                fontFamily: 'monospace',
                                                fontWeight: FontWeight.bold,
                                              ),
                                            ),
                                          ),
                                          IconButton(
                                            icon: Icon(Icons.copy, size: 18),
                                            onPressed: () =>
                                                _copyToClipboard(
                                              bankDetails['Reference Code']!,
                                              'Reference Code',
                                            ),
                                          ),
                                        ],
                                      ),
                                      SizedBox(height: 8),
                                      Text(
                                        'Must be entered in "Reference" or "Reason" field for transfer matching',
                                        style: TextStyle(
                                          fontSize: 12,
                                          color: Colors.orange.shade900,
                                        ),
                                      ),
                                    ],
                                  ),
                                ),
                                SizedBox(height: 16),
                                Divider(),

                                // Bank Address
                                _buildDetailRow(
                                  'Bank Address',
                                  bankDetails['Bank Address']!,
                                ),
                                Divider(),

                                // Bank Phone
                                _buildDetailRow(
                                  'Bank Phone',
                                  bankDetails['Bank Phone']!,
                                ),
                              ],
                            ),
                          ),
                      ],
                    ),
                  ),
                  SizedBox(height: 20),

                  // Important Notes
                  Card(
                    color: Colors.red.shade50,
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '⚠️ Important Notes',
                            style: TextStyle(
                              fontWeight: FontWeight.bold,
                              color: Colors.red.shade900,
                              fontSize: 16,
                            ),
                          ),
                          SizedBox(height: 12),
                          ...[
                            '✓ This is a LOCAL USD transfer (not international)',
                            '✓ Partial payments accepted - send in multiple stages if needed',
                            '✓ Processing time: 1-2 business days',
                            '✓ Reference code P201006522 MUST be included',
                            '✓ You\'ll receive confirmation email automatically',
                            '✓ No international fees - local USD transfer only',
                          ]
                              .map((note) => Padding(
                                    padding: EdgeInsets.symmetric(vertical: 6),
                                    child: Text(
                                      note,
                                      style: TextStyle(
                                        fontSize: 13,
                                        color: Colors.red.shade900,
                                      ),
                                    ),
                                  ))
                              .toList(),
                        ],
                      ),
                    ),
                  ),
                  SizedBox(height: 20),

                  // Support
                  Card(
                    child: Padding(
                      padding: EdgeInsets.all(16),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Need Help?',
                            style: Theme.of(context).textTheme.titleMedium,
                          ),
                          SizedBox(height: 12),
                          Text(
                            'Contact Wise Support:',
                            style: TextStyle(fontWeight: FontWeight.bold),
                          ),
                          SizedBox(height: 4),
                          Text('30 W 26th Street, Floor 6, New York, NY 10010'),
                          SizedBox(height: 12),
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton.icon(
                              onPressed: () {
                                // Open contact support
                              },
                              icon: Icon(Icons.email),
                              label: Text('Contact Support'),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  SizedBox(height: 20),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildDetailRow(String label, String value) {
    return Padding(
      padding: EdgeInsets.symmetric(vertical: 8),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            label,
            style: TextStyle(fontWeight: FontWeight.bold, fontSize: 13),
          ),
          Expanded(
            child: Row(
              mainAxisAlignment: MainAxisAlignment.end,
              children: [
                Flexible(
                  child: Text(
                    value,
                    textAlign: TextAlign.right,
                    style: TextStyle(
                      fontFamily: 'monospace',
                      fontSize: 13,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                SizedBox(width: 8),
                InkWell(
                  onTap: () => _copyToClipboard(value, label),
                  child: Icon(Icons.copy, size: 16, color: Colors.blue),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
