import net from 'net';
import { Iso8583Codec } from './iso8583.codec';
import { uint16LengthFraming } from './iso8583.framing';
import { createIso8583MacEngine } from './iso8583.security';

export interface EmulatorResponseSpec {
  mti: string;
  fields: Record<number, string | Buffer>;
}

export interface EmulatorOptions {
  host?: string;
  port?: number;
  macKey?: string;
  macAlgorithm?: 'HMAC-SHA256' | 'ISO9797-1-Alg3-3DES' | 'X9.19-3DES';
  onRequest?: (request: { mti: string; fields: Record<number, string | Buffer> }) => EmulatorResponseSpec | Promise<EmulatorResponseSpec>;
}

export class Iso8583AcquirerEmulator {
  private server?: net.Server;
  private readonly host: string;
  private readonly port: number;
  private readonly codec: Iso8583Codec;
  private readonly onRequest: NonNullable<EmulatorOptions['onRequest']>;

  constructor(options: EmulatorOptions = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 5000;

    const macEngine = createIso8583MacEngine({
      keyMode: 'STATIC',
      macAlgorithm: options.macAlgorithm || 'HMAC-SHA256',
      macKey: options.macKey || '00112233445566778899aabbccddeeff',
      macField: 64,
      macLength: 8,
    });

    this.codec = new Iso8583Codec(undefined, {
      framing: uint16LengthFraming(),
      mac: {
        field: 64,
        calculate: (messageWithoutMac) => macEngine.calculateMac(messageWithoutMac, macEngine.getKeyProvider().getMacKey()),
        verify: (messageWithoutMac, receivedMac) => macEngine.verifyMac(messageWithoutMac, macEngine.getKeyProvider().getMacKey(), receivedMac),
      },
      macEngine,
      keyProvider: macEngine.getKeyProvider(),
    });

    this.onRequest = options.onRequest || ((request) => ({
      mti: request.mti === '0200' ? '0210' : '0410',
      fields: {
        39: request.mti === '0200' ? '00' : '00',
        37: 'ABC123456789',
        38: 'APP123',
        41: 'TERM0001',
        42: 'MERCHANT0001',
      },
    }));
  }

  async start(): Promise<void> {
    if (this.server) return;

    return new Promise((resolve, reject) => {
      this.server = net.createServer(async (socket) => {
        socket.on('data', async (chunk) => {
          try {
            const request = this.codec.unpack(chunk);
            const responseSpec = await this.onRequest({ mti: request.mti, fields: request.fields });
            const response = this.codec.pack(responseSpec);
            socket.write(response);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            socket.write(this.codec.pack({
              mti: '0410',
              fields: {
                39: '96',
                41: 'TERM0001',
                42: 'MERCHANT0001',
                60: message,
              },
            }));
          }
        });
      });

      this.server.once('error', reject);
      this.server.listen(this.port, this.host, () => {
        this.server?.removeListener('error', reject);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    if (!this.server) return;
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    });
    this.server = undefined;
  }
}

export async function startIso8583Emulator(options: EmulatorOptions = {}): Promise<Iso8583AcquirerEmulator> {
  const emulator = new Iso8583AcquirerEmulator(options);
  await emulator.start();
  return emulator;
}
