export const OdaErrorCode = {
  AIP_MISSING: "AIP_MISSING",
  NO_AUTH_METHOD: "NO_AUTH_METHOD",

  SDA_SSAD_MISSING: "SDA_SSAD_MISSING",
  SDA_ISSUER_CERT_MISSING: "SDA_ISSUER_CERT_MISSING",
  SDA_RID_CAPKI_MISSING: "SDA_RID_CAPKI_MISSING",
  SDA_CAPK_NOT_FOUND: "SDA_CAPK_NOT_FOUND",
  SDA_RSA_FAILED: "SDA_RSA_FAILED",
  SDA_EXCEPTION: "SDA_EXCEPTION",

  DDA_ICC_CERT_MISSING: "DDA_ICC_CERT_MISSING",
  DDA_DYNAMIC_SIG_MISSING: "DDA_DYNAMIC_SIG_MISSING",
  DDA_ICC_KEY_UNRECOVERABLE_CAPK_MISSING: "DDA_ICC_KEY_UNRECOVERABLE_CAPK_MISSING",
  DDA_ICC_KEY_UNRECOVERABLE_RID_CAPKI_MISSING: "DDA_ICC_KEY_UNRECOVERABLE_RID_CAPKI_MISSING",
  DDA_RSA_FAILED: "DDA_RSA_FAILED",
  DDA_EXCEPTION: "DDA_EXCEPTION",

  CDA_SIG_MISSING_FALLBACK_DDA: "CDA_SIG_MISSING_FALLBACK_DDA",
  CDA_EXCEPTION: "CDA_EXCEPTION",

  GENERIC_SIGNED_DATA_MISSING: "GENERIC_SIGNED_DATA_MISSING",
  GENERIC_RSA_FAILED: "GENERIC_RSA_FAILED",
} as const;

export type OdaErrorCode = typeof OdaErrorCode[keyof typeof OdaErrorCode];

export function odaErrorReason(code: OdaErrorCode, detail?: string): string {
  switch (code) {
    case OdaErrorCode.AIP_MISSING:
      return "AIP (tag 82) missing – AIP not found";

    case OdaErrorCode.NO_AUTH_METHOD:
      return "No SDA/DDA/CDA support bit set in AIP – no supported authentication method";

    case OdaErrorCode.SDA_SSAD_MISSING:
      return "SDA mode: SSAD (tag 93) missing – SSAD not found";

    case OdaErrorCode.SDA_ISSUER_CERT_MISSING:
      return "SDA mode: Issuer certificate (tag 90) missing – issuer certificate not found";

    case OdaErrorCode.SDA_RID_CAPKI_MISSING:
      return "SDA mode: RID/CAPKI missing – RID or CAPKI not found";

    case OdaErrorCode.SDA_CAPK_NOT_FOUND:
      return "SDA mode: CAPK not in engine – CAPK not found";

    case OdaErrorCode.SDA_RSA_FAILED:
      return `SDA mode: RSA signature fails – ${detail || "<rsa-oda reason>"}`;

    case OdaErrorCode.SDA_EXCEPTION:
      return `SDA mode: exception – SDA failed: ${detail || "<msg>"}`;

    case OdaErrorCode.DDA_ICC_CERT_MISSING:
      return "DDA/CDA mode: ICC certificate (tag 9F46) missing – ICC certificate not found";

    case OdaErrorCode.DDA_DYNAMIC_SIG_MISSING:
      return "DDA mode: dynamic signature (tag 9F4B) missing – dynamic signature not found";

    case OdaErrorCode.CDA_SIG_MISSING_FALLBACK_DDA:
      return "CDA mode: CDA signature (tag 9F4C) missing and DDA fails – falls through DDA reasons";

    case OdaErrorCode.DDA_ICC_KEY_UNRECOVERABLE_CAPK_MISSING:
      return "DDA/CDA: ICC public key unrecoverable and CAPK not found";

    case OdaErrorCode.DDA_ICC_KEY_UNRECOVERABLE_RID_CAPKI_MISSING:
      return "DDA/CDA: ICC public key unrecoverable and RID/CAPKI not found";

    case OdaErrorCode.DDA_RSA_FAILED:
      return `DDA/CDA: RSA verify fails – ${detail || "<rsa-oda reason>"}`;

    case OdaErrorCode.DDA_EXCEPTION:
      return `DDA mode: exception – DDA failed: ${detail || "<msg>"}`;

    case OdaErrorCode.CDA_EXCEPTION:
      return `CDA mode: exception – CDA failed: ${detail || "<msg>"}`;

    case OdaErrorCode.GENERIC_SIGNED_DATA_MISSING:
      return "ODA: No signed data present (9F4B/9F4C/9F4D) – cannot verify authenticity";

    case OdaErrorCode.GENERIC_RSA_FAILED:
      return `ODA: Signed EMV data could not be verified – ${detail || "<verification reason>"}`;

    default:
      return detail || "ODA failed";
  }
}
