import 'package:nfc_manager/nfc_manager.dart';
import 'package:logger/logger.dart';

class NfcService {
  final Logger _logger = Logger();

  /// Checks whether NFC is available on the device.
  Future<bool> isAvailable() async => NfcManager.instance.isAvailable();

  /// Starts an NFC session and listens for a nearby tag.
  Future<void> startSession({
    required Function(Map<String, dynamic>) onDiscovered,
    required Function(String) onError,
  }) async {
    try {
      final available = await isAvailable();
      if (!available) {
        onError('NFC is not available on this device.');
        return;
      }

      await NfcManager.instance.startSession(
        onDiscovered: (NfcTag tag) async {
          try {
            final data = Map<String, dynamic>.from(tag.data);

            _logger.i('NFC tag discovered: $data');
            onDiscovered(data);
          } catch (e) {
            _logger.e('Error processing NFC tag: $e');
            onError('Failed to read NFC tag.');
          } finally {
            await NfcManager.instance.stopSession();
          }
        },
        onError: (NfcError error) async {
          final message = error.message;

          _logger.e('NFC session error: $message');
          onError(message);
          await NfcManager.instance.stopSession();
        },
      );
    } catch (e) {
      _logger.e('Could not start NFC session: $e');
      onError('Unable to start NFC session.');
    }
  }

  /// Stops the current NFC session manually.
  Future<void> stopSession() async {
    await NfcManager.instance.stopSession();
  }
}
