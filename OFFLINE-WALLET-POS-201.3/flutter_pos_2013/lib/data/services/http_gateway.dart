import 'package:dio/dio.dart';
import '../../domain/models/card_data.dart';
import '../../domain/models/gateway_result.dart';
import '../../domain/services/payment_gateway_client.dart';

class HttpGatewayClient implements PaymentGatewayClient {
  final Dio _dio;

  HttpGatewayClient({Dio? dio}) : _dio = dio ?? Dio(BaseOptions(
    baseUrl: 'https://pos-offline-sftwr.onrender.com',
    connectTimeout: const Duration(seconds: 30),
    receiveTimeout: const Duration(seconds: 30),
  ));

  @override
  Future<GatewayChargeResult> chargeCard(
    String localTxnId,
    int amountCents,
    String currency,
    CardData card,
  ) async {
    // This is typically not used for offline sync, but kept for interface compatibility
    // In a real app, you'd encrypt here or throw an error
    throw UnimplementedError('Direct charge not supported. Use chargeEncryptedCard for offline sync.');
  }

  @override
  Future<GatewayChargeResult> chargeEncryptedCard(
    String localTxnId,
    int amountCents,
    String currency,
    EncryptedCardData encryptedCard,
  ) async {
    try {
      // NEW SECURE AES-GCM FLOW WITH BRAND DETECTION
      final response = await _dio.post('/api/myfatoorah/settle', data: {
        'localTxnId': localTxnId,
        'amount': amountCents / 100.0,
        'encryptedPan': encryptedCard.pan.toJson(),
        'encryptedExpMonth': encryptedCard.month.toJson(),
        'encryptedExpYear': encryptedCard.year.toJson(),
        'encryptedCvv': encryptedCard.cvv.toJson(),
        'aesKey': encryptedCard.aesKey,
        'paymentMethodId': _getPaymentMethodId(encryptedCard.cardBrand),
      });

      final data = response.data;
      
      // Backend returns { success: true, status: "...", authCode: "...", ... }
      if (data['success'] == true) {
        return GatewayChargeResult(
          type: GatewayResultType.success,
          gatewayTxnId: data['paymentId']?.toString() ?? data['invoiceId']?.toString(),
        );
      } else {
        return GatewayChargeResult(
          type: GatewayResultType.hardFail,
          errorCode: data['status'] ?? 'DECLINED',
          errorMessage: data['error'] ?? 'Payment declined by gateway',
        );
      }

    } on DioException catch (e) {
      if (e.type == DioExceptionType.connectionTimeout ||
          e.type == DioExceptionType.sendTimeout ||
          e.type == DioExceptionType.receiveTimeout ||
          e.response == null) {
        return GatewayChargeResult(
          type: GatewayResultType.softFail,
          errorCode: 'NETWORK_ERROR',
          errorMessage: e.message ?? 'Network error',
        );
      }
      
      final errorData = e.response?.data;
      return GatewayChargeResult(
        type: GatewayResultType.hardFail,
        errorCode: 'HTTP_${e.response?.statusCode}',
        errorMessage: errorData is Map ? (errorData['error'] ?? e.message) : e.message,
      );
    } catch (e) {
      return GatewayChargeResult(
        type: GatewayResultType.hardFail,
        errorCode: 'INTERNAL_ERROR',
        errorMessage: e.toString(),
      );
    }
  }

  int _getPaymentMethodId(String? brand) {
    switch (brand) {
      case 'VISA':
      case 'MASTERCARD':
        return 20; // Default MF ID for Visa/Mastercard
      case 'AMEX':
        return 11; // MF ID for Amex
      default:
        return 20; // Fallback to Visa/Mastercard
    }
  }
}
