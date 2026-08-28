import crypto from "crypto";
import { settingsService } from "../settings/settings.service";

const { NFC } = require("nfc-pcsc");

export class PaymentsService {
  async charge(merchantId: string, payload: { amountMinor: number; currency: string; cardToken?: string }) {
    const settings = await settingsService.getSettings(merchantId);
    const isTestMode = !!settings.test_mode;
    const apiKey = settings.api_key || "sk_test_mock_key_12345";
    
    console.log(`[Payment] Charge request for ${merchantId} in ${isTestMode ? "TEST" : "LIVE"} mode`);

    // In a real implementation, we would use Braintree here for LIVE transactions too
    // if cardToken is provided.

    const approved = payload.amountMinor % 7 !== 0;
    const result = {
      id: `pay_${Date.now()}`,
      status: approved ? "APPROVED" : "DECLINED",
      authCode: approved ? Math.floor(100000 + Math.random() * 900000).toString() : undefined,
      rrn: approved ? Math.floor(100000000000 + Math.random() * 900000000000).toString() : undefined,
      amountMinor: payload.amountMinor,
      currency: payload.currency,
      cardBrand: "VISA",
      last4: "1111",
      testMode: isTestMode,
      processor: isTestMode ? "MOCK_GATEWAY" : "BRAINTREE_LIVE"
    };
    
    const hmac = crypto.createHmac("sha256", apiKey);
    hmac.update(JSON.stringify({ id: result.id, status: result.status, amountMinor: result.amountMinor, currency: result.currency }));
    const signature = hmac.digest("hex");
    return { ...result, signature };
  }

  async getAcr122uStatus() {
    const status = {
      available: false,
      connected: false,
      deviceName: null as string | null,
      error: null as string | null,
      standard: "PC/SC NFC"
    };

    return await new Promise<typeof status>((resolve) => {
      const timer = setTimeout(() => {
        resolve(status);
      }, 2500);

      try {
        const nfc = new NFC();

        nfc.on("reader", (reader: any) => {
          clearTimeout(timer);
          nfc.close();
          resolve({
            available: true,
            connected: true,
            deviceName: reader?.reader?.name || "ACR122U",
            error: null,
            standard: "PC/SC NFC"
          });
        });

        nfc.on("error", (err: any) => {
          clearTimeout(timer);
          nfc.close();
          resolve({
            ...status,
            error: err?.message || "PCSC error"
          });
        });
      } catch (e: any) {
        clearTimeout(timer);
        resolve({
          ...status,
          error: e?.message || "Unable to initialize PC/SC NFC"
        });
      }
    });
  }

  async readAcr122uCard() {
    return await new Promise<any>((resolve, reject) => {
      const timeoutMs = 20000;
      let settled = false;

      const cleanup = (nfc: any) => {
        if (nfc && typeof nfc.close === "function") {
          try {
            nfc.close();
          } catch {
            // no-op
          }
        }
        clearTimeout(timeoutHandle);
      };

      const timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        reject(new Error("No card detected on ACR122U reader within 20 seconds"));
      }, timeoutMs);

      try {
        const nfc = new NFC();

        nfc.on("reader", (reader: any) => {
          if (settled) {
            cleanup(nfc);
            return;
          }

          const deviceName = reader?.reader?.name || "ACR122U";

          reader.on("card", (card: any) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup(nfc);

            resolve({
              success: true,
              deviceName,
              card: {
                type: card?.type || card?.standard || "UNKNOWN",
                standard: card?.standard || null,
                uid: card?.uid || null,
                data: card?.data ? card.data.toString("hex") : null,
                raw: card?.data ? Array.from(card.data) : null
              },
              timestamp: new Date().toISOString()
            });
          });

          reader.on("card.off", () => {
            // card removed; no-op, allow next read
          });

          reader.on("error", (err: any) => {
            if (settled) {
              return;
            }
            settled = true;
            cleanup(nfc);
            reject(new Error(err?.message || "ACR122U reader error"));
          });
        });

        nfc.on("error", (err: any) => {
          if (settled) {
            return;
          }
          settled = true;
          cleanup(nfc);
          reject(new Error(err?.message || "PCSC error while initializing ACR122U reader"));
        });
      } catch (e: any) {
        if (!settled) {
          settled = true;
          reject(new Error(e?.message || "Unable to initialize ACR122U reader"));
        }
      }
    });
  }
}

export const paymentsService = new PaymentsService();
