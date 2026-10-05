/**
 * PRISMA / LaPos POS — Transport Client
 * ─────────────────────────────────────────────────────────────────────────────
 * Handles the link-layer handshake and sends/receives framed packets over
 * either a TCP socket (network-connected Ingenico POS) or a serial/COM port
 * (RS232 direct connection).
 *
 * Link-layer sequence per spec:
 *   1. Box  → ENQ (0x05)
 *   2. POS  → ACK (0x06)
 *   3. Box  → STX + CMD + LEN + FIELDS + ETX + XOR_CRC
 *   4. POS  → ACK (0x06)   [confirms packet received]
 *   5. POS  → STX + CMD + LEN + FIELDS + ETX + XOR_CRC  [actual response]
 *   6. Box  → ACK (0x06)   [confirms response received]
 *
 * Transport selection (via PRISMA_POS_TRANSPORT env var):
 *   'tcp'    — TCP socket to PRISMA_POS_HOST:PRISMA_POS_PORT  (default)
 *   'serial' — serial port at PRISMA_POS_SERIAL_PATH (e.g. COM3 / /dev/ttyUSB0)
 *
 * Both transports share the same packet framing from prisma-lapos.protocol.ts.
 */

import net from 'net';
import { EventEmitter } from 'events';
import {
  ENQ, ACK, STX, ETX,
  buildPacket,
  buildEmptyPacket,
  parseResponsePacket,
  type CommandName,
  type ParsedResponse,
} from './prisma-lapos.protocol';

// ── Configuration ─────────────────────────────────────────────────────────────
export interface PrismaClientConfig {
  /** Transport: 'tcp' (default) or 'serial' */
  transport:    'tcp' | 'serial';
  /** TCP host (PRISMA_POS_HOST) */
  host?:        string;
  /** TCP port (PRISMA_POS_PORT, default 5000) */
  port?:        number;
  /** Serial device path (PRISMA_POS_SERIAL_PATH, e.g. 'COM3' or '/dev/ttyUSB0') */
  serialPath?:  string;
  /** Serial baud rate (PRISMA_POS_BAUD, default 19200 per spec) */
  baudRate?:    number;
  /** Total timeout per transaction in ms (default 30 000) */
  timeoutMs?:   number;
  /** Max retry attempts on NAK / timeout (default 2) */
  maxRetries?:  number;
}

export function configFromEnv(): PrismaClientConfig {
  return {
    transport:  (process.env.PRISMA_POS_TRANSPORT || 'tcp') as 'tcp' | 'serial',
    host:       process.env.PRISMA_POS_HOST || '127.0.0.1',
    port:       Number(process.env.PRISMA_POS_PORT  || 5000),
    serialPath: process.env.PRISMA_POS_SERIAL_PATH  || 'COM3',
    baudRate:   Number(process.env.PRISMA_POS_BAUD  || 19200),
    timeoutMs:  Number(process.env.PRISMA_POS_TIMEOUT_MS || 30000),
    maxRetries: Number(process.env.PRISMA_POS_MAX_RETRIES || 2),
  };
}

// ── Internal transport abstraction ────────────────────────────────────────────
interface Transport {
  write(data: Buffer): void;
  read(timeoutMs: number): Promise<Buffer>;
  close(): void;
  isOpen(): boolean;
}

// ── TCP transport ─────────────────────────────────────────────────────────────
class TcpTransport implements Transport {
  private socket: net.Socket;
  private receivedChunks: Buffer[] = [];
  private emitter = new EventEmitter();
  private _open = false;

  constructor(private host: string, private port: number) {
    this.socket = new net.Socket();
    this.socket.on('data', (chunk: Buffer) => {
      this.receivedChunks.push(chunk);
      this.emitter.emit('data');
    });
    this.socket.on('error', (err) => {
      this.emitter.emit('error', err);
    });
    this.socket.on('close', () => {
      this._open = false;
      this.emitter.emit('close');
    });
  }

  async connect(timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.socket.destroy();
        reject(new Error(`PRISMA TCP connect timeout to ${this.host}:${this.port}`));
      }, timeoutMs);
      this.socket.connect(this.port, this.host, () => {
        clearTimeout(timer);
        this._open = true;
        resolve();
      });
      this.socket.once('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  write(data: Buffer): void {
    if (!this._open) throw new Error('PRISMA TCP socket is not connected');
    this.socket.write(data);
  }

  read(timeoutMs: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      // If data already buffered, return immediately
      if (this.receivedChunks.length > 0) {
        const buf = Buffer.concat(this.receivedChunks);
        this.receivedChunks = [];
        return resolve(buf);
      }
      const timer = setTimeout(() => {
        this.emitter.removeAllListeners('data');
        reject(new Error(`PRISMA TCP read timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.emitter.once('data', () => {
        clearTimeout(timer);
        const buf = Buffer.concat(this.receivedChunks);
        this.receivedChunks = [];
        resolve(buf);
      });
    });
  }

  close(): void {
    this._open = false;
    try { this.socket.destroy(); } catch { /* ignore */ }
  }

  isOpen(): boolean { return this._open; }
}

// ── Serial transport (optional — requires 'serialport' package) ───────────────
class SerialTransport implements Transport {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private port: any = null;
  private receivedChunks: Buffer[] = [];
  private emitter = new EventEmitter();

  constructor(private path: string, private baudRate: number) {}

  async connect(): Promise<void> {
    let SerialPort: any;
    try {
      // Dynamic import — only required when transport='serial'
      // Install with: npm install serialport
      const sp = await import('serialport' as any);
      SerialPort = sp.SerialPort || sp.default?.SerialPort || sp.default;
    } catch {
      throw new Error(
        'PRISMA serial transport requires the "serialport" npm package. ' +
        'Install it with: npm install serialport --save'
      );
    }

    this.port = new SerialPort({
      path: this.path,
      baudRate: this.baudRate,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false,
    });

    this.port.on('data', (chunk: Buffer) => {
      this.receivedChunks.push(chunk);
      this.emitter.emit('data');
    });
    this.port.on('error', (err: Error) => {
      this.emitter.emit('error', err);
    });

    return new Promise((resolve, reject) => {
      this.port.open((err: Error | null) => {
        if (err) reject(new Error(`Cannot open serial port ${this.path}: ${err.message}`));
        else resolve();
      });
    });
  }

  write(data: Buffer): void {
    if (!this.port?.isOpen) throw new Error('PRISMA serial port is not open');
    this.port.write(data);
  }

  read(timeoutMs: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      if (this.receivedChunks.length > 0) {
        const buf = Buffer.concat(this.receivedChunks);
        this.receivedChunks = [];
        return resolve(buf);
      }
      const timer = setTimeout(() => {
        this.emitter.removeAllListeners('data');
        reject(new Error(`PRISMA serial read timeout after ${timeoutMs}ms`));
      }, timeoutMs);
      this.emitter.once('data', () => {
        clearTimeout(timer);
        const buf = Buffer.concat(this.receivedChunks);
        this.receivedChunks = [];
        resolve(buf);
      });
    });
  }

  close(): void {
    try { if (this.port?.isOpen) this.port.close(); } catch { /* ignore */ }
  }

  isOpen(): boolean { return !!this.port?.isOpen; }
}

// ── Main PRISMA client ─────────────────────────────────────────────────────────
export class PrismaLaposClient {
  private cfg: Required<PrismaClientConfig>;

  constructor(config?: Partial<PrismaClientConfig>) {
    const env = configFromEnv();
    this.cfg = {
      transport:  config?.transport  ?? env.transport,
      host:       config?.host       ?? env.host       ?? '127.0.0.1',
      port:       config?.port       ?? env.port       ?? 5000,
      serialPath: config?.serialPath ?? env.serialPath ?? 'COM3',
      baudRate:   config?.baudRate   ?? env.baudRate   ?? 19200,
      timeoutMs:  config?.timeoutMs  ?? env.timeoutMs  ?? 30000,
      maxRetries: config?.maxRetries ?? env.maxRetries ?? 2,
    };
  }

  // ── Public: send a command and get parsed response ────────────────────────
  async send(command: CommandName, fields: string): Promise<ParsedResponse>;
  async send(command: CommandName): Promise<ParsedResponse>;
  async send(command: CommandName, fields = ''): Promise<ParsedResponse> {
    const packet = fields.length > 0
      ? buildPacket(command, fields)
      : buildEmptyPacket(command);

    let lastError: Error = new Error('PRISMA send failed');

    for (let attempt = 0; attempt <= this.cfg.maxRetries; attempt++) {
      let transport: Transport | null = null;
      try {
        transport = await this.openTransport();

        // Step 1: Send ENQ, wait for ACK
        transport.write(Buffer.from([ENQ]));
        const enqAck = await transport.read(this.cfg.timeoutMs);
        if (!enqAck.includes(ACK)) {
          throw new Error(`PRISMA ENQ not acknowledged (got: ${enqAck.toString('hex')})`);
        }

        // Step 2: Send packet, wait for ACK
        transport.write(packet);
        const pktAck = await transport.read(this.cfg.timeoutMs);
        if (!pktAck.includes(ACK)) {
          throw new Error(`PRISMA packet not acknowledged (got: ${pktAck.toString('hex')})`);
        }

        // Step 3: Collect full response (may arrive in multiple TCP chunks)
        const rawResponse = await this.readFullResponse(transport);

        // Step 4: Send ACK to POS
        transport.write(Buffer.from([ACK]));

        // Step 5: Parse
        const parsed = parseResponsePacket(rawResponse);

        if (!parsed.crcValid) {
          console.warn('[PRISMA] CRC mismatch on response — continuing with parsed data');
        }

        console.log(
          `[PRISMA] ${command} → RC=${parsed.responseCode} (${parsed.message})` +
          (!parsed.crcValid ? ' ⚠ CRC MISMATCH' : '')
        );

        return parsed;
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err));
        console.error(`[PRISMA] ${command} attempt ${attempt + 1} failed: ${lastError.message}`);
        await sleep(300 * (attempt + 1)); // back-off before retry
      } finally {
        if (transport) {
          transport.close();
        }
      }
    }

    throw lastError;
  }

  // ── Open transport connection ─────────────────────────────────────────────
  private async openTransport(): Promise<Transport> {
    if (this.cfg.transport === 'serial') {
      const t = new SerialTransport(this.cfg.serialPath, this.cfg.baudRate);
      await t.connect();
      return t;
    }
    // TCP
    const t = new TcpTransport(this.cfg.host, this.cfg.port);
    await t.connect(this.cfg.timeoutMs);
    return t;
  }

  // ── Collect full response (waits for STX…ETX+CRC) ─────────────────────────
  private async readFullResponse(transport: Transport): Promise<Buffer> {
    // Response format: [ACK(s)] STX CMD(3) LEN(2) FIELDS ETX CRC
    // We accumulate chunks until we have a complete packet
    let accumulated = Buffer.alloc(0);
    const deadline = Date.now() + this.cfg.timeoutMs;

    while (Date.now() < deadline) {
      const chunk = await transport.read(Math.max(500, deadline - Date.now()));
      accumulated = Buffer.concat([accumulated, chunk]);

      // Strip leading ACK bytes
      let start = 0;
      while (start < accumulated.length && accumulated[start] === ACK) start++;

      if (start >= accumulated.length) continue; // nothing yet except ACKs

      const inner = accumulated.slice(start);

      // Need at least STX + CMD(3) + LEN(2) + ETX + CRC = 8 bytes
      if (inner.length < 8) continue;
      if (inner[0] !== STX) {
        throw new Error(`PRISMA unexpected byte 0x${inner[0].toString(16)} (expected STX)`);
      }

      const lenLo   = inner[4];
      const lenHi   = inner[5];
      const fieldLen = lenLo | (lenHi << 8);
      const needed  = 1 + 3 + 2 + fieldLen + 1 + 1; // STX+CMD+LEN+FIELDS+ETX+CRC

      if (inner.length >= needed) {
        // Verify ETX is where we expect
        if (inner[needed - 2] === ETX) {
          return accumulated; // return raw (including leading ACKs for parser)
        }
      }
      // Still waiting for more data
    }

    throw new Error(`PRISMA response collection timed out after ${this.cfg.timeoutMs}ms`);
  }

  // ── Connection test ───────────────────────────────────────────────────────
  async test(): Promise<boolean> {
    try {
      const resp = await this.send('TES');
      return resp.approved || resp.responseCode === '000';
    } catch {
      return false;
    }
  }
}

// ── Singleton factory ─────────────────────────────────────────────────────────
let _instance: PrismaLaposClient | null = null;

export function getPrismaClient(config?: Partial<PrismaClientConfig>): PrismaLaposClient {
  if (!_instance || config) {
    _instance = new PrismaLaposClient(config);
  }
  return _instance;
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
