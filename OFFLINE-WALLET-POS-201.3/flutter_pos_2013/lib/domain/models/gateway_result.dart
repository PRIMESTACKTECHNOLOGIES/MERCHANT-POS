enum GatewayResultType {
  success,
  hardFail,
  softFail,
}

class GatewayChargeResult {
  final GatewayResultType type;
  final String? gatewayTxnId;
  final String? errorCode;
  final String? errorMessage;

  GatewayChargeResult({
    required this.type,
    this.gatewayTxnId,
    this.errorCode,
    this.errorMessage,
  });
}
