import { parseTlv } from './emv-tlv-parser';

interface ReaderLike {
  reader: { name: string };
  on(event: string, handler: (...args: any[]) => void): void;
  once(event: string, handler: (...args: any[]) => void): void;
}

export interface ACR122UCardData {
  uid: string;
  atr: string;
  type: string;
  emvReady?: boolean;
  error?: string;
  aid?: string;
  gpo?: string;
  raw?: Buffer;
}

interface TlvEntry {
  tag: string;
  length: number;
  value: Buffer;
}

export class ACR122UReaderService {
  private nfc: any = null;
  private reader: any = null;
  private connected = false;
  private enabled = true;
  private latestCard: any = null;

  private static readonly FALLBACK_AIDS = [
    'A0000000031010', // Visa
    'A0000000041010', // MasterCard
    'A0000000050000', // Maestro
    'A00000002501',   // American Express
    'A0000000032010', // Visa Electron
  ];

  async connect(): Promise<void> {
    if (!this.enabled) {
      throw new Error('ACR122U reader is disabled');
    }

    if (this.connected) {
      return;
    }

    try {
      const nfcModule = require('nfc-pcsc') as { NFC: new () => any };
      this.nfc = new nfcModule.NFC();

      this.nfc.on('reader', (reader: ReaderLike) => {
        console.log(`[ACR122U] Reader connected: ${reader.reader.name}`);
        this.reader = reader;

        // nfc-pcsc otherwise tries to process ISO 14443-4 cards immediately
        // and raises "AID was not set" before our EMV AID-selection logic runs.
        // Manual mode emits the card event and lets readEmvCard() select PPSE/AIDs.
        (reader as any).autoProcessing = false;

        reader.on('card', (card: any) => {
          console.log(`[ACR122U] Card detected: ${card.uid}`);
          this.latestCard = card;
        });

        reader.on('error', (err: any) => {
          console.warn('[ACR122U] Reader error:', err);
        });

        reader.on('end', () => {
          console.log('[ACR122U] Reader disconnected');
          this.reader = null;
          this.latestCard = null;
        });
      });

      this.nfc.on('error', (err: any) => {
        console.warn('[ACR122U] NFC error:', err);
      });

      this.connected = true;
    } catch (error) {
      console.warn('[ACR122U] Unable to initialize NFC reader. Native module may be missing or node-gyp build tools may not be installed.', error);
      this.enabled = false;
      this.nfc = null;
      this.connected = false;
      throw error;
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async getStatus(): Promise<{ enabled: boolean; connected: boolean; readerName?: string }> {
    if (!this.enabled) {
      return { enabled: false, connected: false };
    }

    try {
      await this.connect();

      // If reader already detected, return immediately
      if (this.reader) {
        return { enabled: true, connected: true, readerName: (this.reader as any)?.reader?.name };
      }

      // Give PC/SC up to 1.5s to enumerate the reader after connect()
      await new Promise<void>(resolve => {
        const timeout = setTimeout(resolve, 1500);
        if (this.nfc) {
          this.nfc.once('reader', () => { clearTimeout(timeout); resolve(); });
        }
      });

      return {
        enabled: this.enabled,
        connected: Boolean(this.reader),
        readerName: (this.reader as any)?.reader?.name
      };
    } catch {
      return { enabled: false, connected: false };
    }
  }

  private async ensureReader(): Promise<any> {
    if (this.reader) {
      return this.reader;
    }

    await this.connect();

    return new Promise((resolve, reject) => {
      if (!this.nfc) {
        return reject(new Error('NFC subsystem unavailable'));
      }

      const timeout = setTimeout(() => {
        reject(new Error('No NFC reader found'));
      }, 5000);

      this.nfc.once('reader', (reader: any) => {
        clearTimeout(timeout);
        resolve(reader);
      });
    });
  }

  private async transmitApdu(reader: any, apdu: Buffer, responseMaxLength = 512, operation = 'APDU'): Promise<Buffer> {
    const response = await reader.transmit(apdu, responseMaxLength);

    if (!response || response.length < 2) {
      throw new Error('Invalid APDU response from reader');
    }

    const sw1 = response[response.length - 2];
    const sw2 = response[response.length - 1];
    const payload = response.slice(0, -2);

    if (sw1 === 0x6c) {
      return this.transmitApdu(reader, Buffer.concat([apdu.slice(0, -1), Buffer.from([sw2])]), responseMaxLength, operation);
    }

    if (sw1 === 0x61) {
      return this.transmitApdu(reader, Buffer.from([0x00, 0xc0, 0x00, 0x00, sw2]), responseMaxLength, operation);
    }

    if (sw1 === 0x90 && sw2 === 0x00) {
      return payload;
    }

    const sw = `${sw1.toString(16).padStart(2, '0')}${sw2.toString(16).padStart(2, '0')}`.toUpperCase();
    const detail = sw === '6985'
      ? 'conditions of use not satisfied (card rejected the command or terminal data)'
      : 'card rejected the command';
    throw new Error(`APDU failed during ${operation}: SW=${sw} — ${detail}`);
  }

  private buildPdolData(pdol: Buffer, amountMinor = 0, currency = 'USD'): Buffer {
    const values: Buffer[] = [];
    let offset = 0;

    const bcd = (value: number, bytes: number) => {
      const digits = Math.max(0, Math.round(value)).toString().padStart(bytes * 2, '0').slice(-(bytes * 2));
      const out = Buffer.alloc(bytes);
      for (let i = 0; i < bytes; i += 1) {
        out[i] = (Number(digits[i * 2]) << 4) | Number(digits[i * 2 + 1]);
      }
      return out;
    };
    const currencyCodes: Record<string, number> = { USD: 840, AED: 784, EUR: 978, GBP: 826, SAR: 682, INR: 356, CAD: 124, AUD: 36 };
    const currencyCode = currencyCodes[String(currency || 'USD').toUpperCase()] || 840;
    const now = new Date();
    const terminalData: Record<string, Buffer> = {
      '9F02': bcd(amountMinor, 6),
      '9F03': Buffer.alloc(6, 0),
      '9F1A': Buffer.from([0x08, 0x40]),
      '95': Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00]),
      '5F2A': Buffer.from([(currencyCode >> 8) & 0xff, currencyCode & 0xff]),
      '9A': Buffer.from([
        ...bcd(now.getUTCFullYear() % 100, 1),
        ...bcd(now.getUTCMonth() + 1, 1),
        ...bcd(now.getUTCDate(), 1),
      ]),
      '9C': Buffer.from([0x00]),
      '9F37': require('crypto').randomBytes(4),
      '9F35': Buffer.from([0x22]),
      '9F33': Buffer.from([0xe0, 0xf8, 0xc8]),
      '9F40': Buffer.from([0xf0, 0x00, 0xf0, 0x01, 0x00]),
      '9F66': Buffer.from([0x26, 0x00, 0x40, 0x00]),
    };

    while (offset < pdol.length) {
      let tag = pdol[offset].toString(16).padStart(2, '0').toUpperCase();
      offset += 1;

      if ((parseInt(tag, 16) & 0x1f) === 0x1f) {
        while (offset < pdol.length && (pdol[offset] & 0x80) === 0x80) {
          tag += pdol[offset].toString(16).padStart(2, '0').toUpperCase();
          offset += 1;
        }
        if (offset < pdol.length) {
          tag += pdol[offset].toString(16).padStart(2, '0').toUpperCase();
          offset += 1;
        }
      }

      if (offset >= pdol.length) {
        break;
      }

      const length = pdol[offset];
      offset += 1;
      values.push(terminalData[tag] && terminalData[tag].length === length
        ? terminalData[tag]
        : Buffer.alloc(length, 0x00));
    }

    return Buffer.concat(values);
  }

  private async selectAID(reader: any, aid: Buffer): Promise<Buffer> {
    const apdu = Buffer.concat([
      Buffer.from([0x00, 0xa4, 0x04, 0x00, aid.length]),
      aid,
      Buffer.from([0x00]),
    ]);

    return this.transmitApdu(reader, apdu);
  }

  private async getProcessingOptions(reader: any, pdol: Buffer | null, amountMinor = 0, currency = 'USD'): Promise<Buffer> {
    if (!pdol || pdol.length === 0) {
      return this.transmitApdu(reader, Buffer.from([0x80, 0xa8, 0x00, 0x00, 0x02, 0x83, 0x00, 0x00]), 512, 'GET PROCESSING OPTIONS');
    }

    const pdolValues = this.buildPdolData(pdol, amountMinor, currency);
    const data = Buffer.concat([Buffer.from([0x83, pdolValues.length]), pdolValues]);
    const apdu = Buffer.concat([Buffer.from([0x80, 0xa8, 0x00, 0x00, data.length]), data, Buffer.from([0x00])]);

    return this.transmitApdu(reader, apdu, 512, 'GET PROCESSING OPTIONS');
  }

  private parseAfl(afl: Buffer): Array<{ sfi: number; firstRecord: number; lastRecord: number }> {
    const records: Array<{ sfi: number; firstRecord: number; lastRecord: number }> = [];

    if (!afl || afl.length % 4 !== 0) {
      return records;
    }

    for (let offset = 0; offset < afl.length; offset += 4) {
      const sfi = afl[offset] >> 3;
      const firstRecord = afl[offset + 1];
      const lastRecord = afl[offset + 2];
      records.push({ sfi, firstRecord, lastRecord });
    }

    return records;
  }

  private async readRecords(reader: any, aflEntries: Array<{ sfi: number; firstRecord: number; lastRecord: number }>): Promise<Buffer[]> {
    const records: Buffer[] = [];

    for (const entry of aflEntries) {
      for (let record = entry.firstRecord; record <= entry.lastRecord; record += 1) {
        const p2 = (entry.sfi << 3) | 0x04;
        const apdu = Buffer.from([0x00, 0xb2, record, p2, 0x00]);
        try {
          const response = await this.transmitApdu(reader, apdu);
          records.push(response);
        } catch (error) {
          console.warn(`[ACR122U] Failed to read record ${record} SFI ${entry.sfi}:`, error);
        }
      }
    }

    return records;
  }

  private collectNestedTagValues(buffer: Buffer, targetTag: string): Buffer[] {
    const found: Buffer[] = [];
    let offset = 0;

    while (offset < buffer.length) {
      const initialOffset = offset;
      let tag = buffer[offset].toString(16).padStart(2, '0').toUpperCase();
      offset += 1;

      while ((parseInt(tag.slice(-2), 16) & 0x1f) === 0x1f && offset < buffer.length) {
        const next = buffer[offset].toString(16).padStart(2, '0').toUpperCase();
        tag += next;
        offset += 1;
      }

      if (offset >= buffer.length) {
        break;
      }

      let length = buffer[offset];
      offset += 1;

      if (length & 0x80) {
        const lengthBytes = length & 0x7f;
        length = 0;
        for (let i = 0; i < lengthBytes && offset < buffer.length; i += 1) {
          length = (length << 8) | buffer[offset];
          offset += 1;
        }
      }

      if (offset + length > buffer.length) {
        break;
      }

      const value = buffer.slice(offset, offset + length);
      offset += length;

      if (tag === targetTag) {
        found.push(value);
      }

      if ((buffer[initialOffset] & 0x20) === 0x20 && value.length > 0) {
        found.push(...this.collectNestedTagValues(value, targetTag));
      }
    }

    return found;
  }

  private async selectPpse(reader: any): Promise<Buffer> {
    return this.selectAID(reader, Buffer.from('325041592E5359532E4444463031', 'hex'));
  }

  private async readEmvCard(reader: any, card: any, amountMinor = 0, currency = 'USD'): Promise<ACR122UCardData> {
    const result: ACR122UCardData = {
      uid: card.uid,
      atr: card.atr || '',
      type: card.type || 'unknown',
      emvReady: false,
    };

    try {
      const ppseResponse = await this.selectPpse(reader);
      const aidCandidates = this.collectNestedTagValues(ppseResponse, '4F');

      let selectedAid: Buffer | null = null;
      let selectAIDResponse: Buffer | null = null;

      for (const candidate of aidCandidates) {
        try {
          selectAIDResponse = await this.selectAID(reader, candidate);
          selectedAid = candidate;
          break;
        } catch (error) {
          continue;
        }
      }

      if (!selectedAid) {
        for (const aidString of ACR122UReaderService.FALLBACK_AIDS) {
          try {
            const candidate = Buffer.from(aidString, 'hex');
            selectAIDResponse = await this.selectAID(reader, candidate);
            selectedAid = candidate;
            break;
          } catch (error) {
            continue;
          }
        }
      }

      if (!selectedAid || !selectAIDResponse) {
        throw new Error('Unable to select a valid EMV application');
      }

      result.aid = selectedAid.toString('hex').toUpperCase();

      const selectedTlv = parseTlv(selectAIDResponse);
      const pdol = selectedTlv['9F38'] || Buffer.alloc(0);
      const gpoResponse = await this.getProcessingOptions(reader, pdol.length ? pdol : null, amountMinor, currency);
      result.gpo = gpoResponse.toString('hex').toUpperCase();

      const gpoTlv = parseTlv(gpoResponse);
      const afl = gpoTlv['94'];

      if (!afl || afl.length === 0) {
        throw new Error('AFL data missing from GPO response');
      }

      const recordResponses = await this.readRecords(reader, this.parseAfl(afl));
      const combinedRaw = Buffer.concat([ppseResponse, selectAIDResponse, gpoResponse, ...recordResponses]);
      result.raw = combinedRaw;
      result.emvReady = true;

      return result;
    } catch (error: any) {
      console.warn('[ACR122U] EMV read failed:', error?.message || error);
      result.error = error?.message || 'NFC device is not a readable EMV payment card';
      if (this.latestCard) {
        return result;
      }
      throw error;
    }
  }

  async readCard(amountMinor = 0, currency = 'USD'): Promise<ACR122UCardData | null> {
    if (!this.enabled) {
      return null;
    }

    try {
      const reader = await this.ensureReader();

      if (this.latestCard) {
        return this.readEmvCard(reader, this.latestCard, amountMinor, currency);
      }

      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve(null);
        }, 10000);

        const onCard = async (card: any) => {
          clearTimeout(timeout);
          reader.removeListener('card', onCard);
          try {
            const emvCard = await this.readEmvCard(reader, card, amountMinor, currency);
            resolve(emvCard);
          } catch (error: unknown) {
            const message = error instanceof Error ? error.message : String(error);
            console.warn('[ACR122U] readCard failed:', message);
            resolve(null);
          }
        };

        reader.once('card', onCard);
      });
    } catch {
      return null;
    }
  }
}

export const acr122uReaderService = new ACR122UReaderService();
