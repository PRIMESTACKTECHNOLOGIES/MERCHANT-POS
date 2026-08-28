import crypto from "crypto"; 
 
 export function decryptCardData(encryptedBase64: string, keyBase64: string, ivBase64: string, tagBase64: string): string { 
   const key = Buffer.from(keyBase64, "base64"); 
   const iv = Buffer.from(ivBase64, "base64"); 
   const encrypted = Buffer.from(encryptedBase64, "base64"); 
   const tag = Buffer.from(tagBase64, "base64"); 
 
   const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv); 
   decipher.setAuthTag(tag); 
 
   const decrypted = Buffer.concat([ 
     decipher.update(encrypted), 
     decipher.final() 
   ]); 
 
   return decrypted.toString("utf8"); 
 } 
