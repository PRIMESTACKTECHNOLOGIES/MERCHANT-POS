import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_pos_2013/main.dart';

void main() {
  testWidgets('App launches and shows splash screen', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const PosApp());

    // Verify that the splash screen is shown
    expect(find.text('POS-201.3'), findsOneWidget);
    expect(find.text('Professional Payment Solution'), findsOneWidget);
  });
}
