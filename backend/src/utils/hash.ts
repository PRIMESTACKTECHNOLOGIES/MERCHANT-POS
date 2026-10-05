import crypto from "crypto";

export function hashBody(body: any): string {
  const json = JSON.stringify(body);
  return crypto.createHash("sha256").update(json).digest("hex");
}
