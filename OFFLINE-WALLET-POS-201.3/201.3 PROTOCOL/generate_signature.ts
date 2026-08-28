
import * as crypto from 'crypto';

/**
 * Android Developer Reference for 201.3 Protocol Signature Generation
 * 
 * Logic:
 * 1. Construct the data string: protocolVersion|merchantId|terminalId|batchId|timestamp|nonce
 * 2. Compute HMAC-SHA256 using the Terminal Secret Key
 * 3. Encode result as Base64
 */

// Example Values (Match your final_spec.json)
const protocolVersion = "201.3";
const merchantId = "MRC-1001";
const terminalId = "T2013-0001";
const batchId = "BATCH-20260224-01";
const timestamp = "2026-02-24T18:05:00Z";
const nonce = "f9c2a7b1e3";

// Your Secret Key (Must match what is in the DB/Server for this terminal)
const terminalSecret = "s3cr3t-key-for-T2013-0001";

// 1. Construct Data String
const dataToSign = `${protocolVersion}|${merchantId}|${terminalId}|${batchId}|${timestamp}|${nonce}`;

console.log("\n--- 201.3 Protocol Signature Generator ---");
console.log("Data String:", dataToSign);

// 2. Compute HMAC-SHA256
const hmac = crypto.createHmac("sha256", terminalSecret);
hmac.update(dataToSign);

// 3. Base64 Output
const signature = hmac.digest("base64");

console.log("Secret Key: ", terminalSecret);
console.log("Signature:  ", signature);
console.log("------------------------------------------\n");

/**
 * JAVA / KOTLIN EQUIVALENT (Concept)
 * 
 * String data = protocolVersion + "|" + merchantId + "|" + terminalId + "|" + batchId + "|" + timestamp + "|" + nonce;
 * Mac sha256_HMAC = Mac.getInstance("HmacSHA256");
 * SecretKeySpec secret_key = new SecretKeySpec(terminalSecret.getBytes("UTF-8"), "HmacSHA256");
 * sha256_HMAC.init(secret_key);
 * String signature = Base64.getEncoder().encodeToString(sha256_HMAC.doFinal(data.getBytes("UTF-8")));
 */
