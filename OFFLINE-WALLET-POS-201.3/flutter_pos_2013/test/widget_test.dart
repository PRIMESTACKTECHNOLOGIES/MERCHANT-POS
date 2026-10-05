import 'package:flutter_test/flutter_test.dart';
import 'package:flutter_pos_2013/main.dart';

void main() {
  testWidgets('App launches and shows the payment screen', (WidgetTester tester) async {
    // Build our app and trigger a frame.
    await tester.pumpWidget(const PosApp());

    expect(find.text('POS Payment'), findsOneWidget);
    expect(find.text('Offline + Online POS'), findsOneWidget);
  });
}
