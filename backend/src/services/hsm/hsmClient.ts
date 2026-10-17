/**
 * HSM Client Abstraction
 * Plug in Thales, Utimaco, Atalla or any vendor by implementing HsmClient.
 */

export interface ArqcValidationRequest {
  pan:                 string;   // 5A — PAN
  expiry:              string;   // YYMM
  serviceCode?:        string;   // 2-digit, optional
  amountMinor:         number;   // DE4
  currencyCode:        string;   // numeric ISO 4217, e.g. "840"
  atc:                 number;   // 9F36
  unpredictableNumber: Buffer;   // 9F37
  arqc:                Buffer;   // 9F26
  iad:                 Buffer;   // 9F10
  /** The exact CDOL1 byte string the card MAC'd. ARQC validation recomputes the
   *  retail MAC over this data, so it is required by any conforming HSM adapter
   *  (Thales EA/Utimaco equivalent). An HSM that derives the session key itself
   *  still needs the data; omitting it makes the comparison meaningless. */
  cdol1Hex?:           string;
}

export interface ArqcValidationResponse {
  valid:    boolean;
  arc:      string;       // Authorization Response Code e.g. "00","05"
  scripts?: Buffer[];     // Issuer scripts (71/72) if any
}

export interface HsmClient {
  validateArqc(req: ArqcValidationRequest): Promise<ArqcValidationResponse>;
}
