export class MockDataGenerator {
  static generateMockTLV(amount: number, pan: string, currencyCode: string = "0840"): string {
    // Helper to pad length
    const toHex = (num: number, pad: number = 2) => num.toString(16).toUpperCase().padStart(pad, '0');
    const toHexStr = (str: string) => str.split('').map(c => c.charCodeAt(0).toString(16).toUpperCase()).join('');

    // Tag 9F02: Amount Authorized (Numeric, 6 bytes)
    // Amount is in cents (e.g. 1000 for $10.00)
    const amountHex = toHex(amount, 12); 

    // Tag 5F2A: Transaction Currency Code (2 bytes)
    const currencyHex = currencyCode;

    // Tag 5A: Application Primary Account Number (PAN) (Variable up to 10 bytes)
    // PAN is usually packed BCD, but for simplicity here using hex representation of digits if parser supports it, 
    // or just ASCII hex if parser expects string. 
    // Let's assume our TLVParser handles standard hex strings.
    // PAN "4111..." -> if BCD: 41 11 ... 
    // If PAN length is odd, pad with 'F'.
    let panClean = pan.replace(/\D/g, '');
    if (panClean.length % 2 !== 0) panClean += 'F';
    const panHex = panClean;

    // Tag 5F24: Application Expiration Date (3 bytes, YYMMDD)
    const expiryHex = "251231"; // Dec 31, 2025

    // Tag 9F1A: Terminal Country Code (2 bytes)
    const countryHex = "0840"; // US

    // Tag 9C: Transaction Type (1 byte)
    const txnTypeHex = "00"; // Purchase

    // Tag 9F37: Unpredictable Number (4 bytes)
    const unpredNumHex = toHex(Math.floor(Math.random() * 0xFFFFFFFF), 8);

    // Tag 82: Application Interchange Profile (2 bytes)
    const aipHex = "5800"; // Mock AIP

    // Tag 9F36: Application Transaction Counter (2 bytes)
    const atcHex = "0001"; 

    // Construct TLV String
    // Format: Tag (1-2 bytes) + Length (1 byte usually) + Value
    // We assume simple 1-byte length for now (since values are short)
    
    const tlv = [
      `9F0206${amountHex}`,
      `5F2A02${currencyHex}`,
      `5A${toHex(panHex.length / 2, 2)}${panHex}`,
      `5F2403${expiryHex}`,
      `9F1A02${countryHex}`,
      `9C01${txnTypeHex}`,
      `9F3704${unpredNumHex}`,
      `8202${aipHex}`,
      `9F3602${atcHex}`
    ].join('');

    return tlv;
  }
}
