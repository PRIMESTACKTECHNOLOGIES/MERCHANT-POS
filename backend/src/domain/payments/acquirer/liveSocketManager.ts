/**
 * Persistent ("live") scheme socket manager.
 *
 * Card network / sponsor links are long-lived TCP sessions, not one socket per
 * transaction. This manager keeps one connection per route and enforces the
 * rules a real scheme link needs:
 *
 *   - TCP keep-alive every 30s and `setNoDelay(true)`, so the link stays open
 *     and low-latency;
 *   - exactly one in-flight request per connection — ISO 8583 has no request id
 *     in the stream, so interleaving two requests corrupts the framing;
 *   - automatic reconnect with a 5s backoff after a drop;
 *   - per-request timeout that tears the link down rather than reusing a
 *     possibly desynchronised socket;
 *   - per-route framing (LEN2 / LEN4 / TPDU / NONE) instead of one global mode.
 *
 * All timers are cleared on close so nothing keeps the event loop alive.
 */

import net from 'net';
import {
  Iso8583HeaderMode,
  buildIso8583Frame,
  getIso8583HeaderMode,
  isCompleteIso8583Frame,
} from './headerBuilder';

const DEFAULT_KEEP_ALIVE_MS = 30_000;
const DEFAULT_RECONNECT_BACKOFF_MS = 5_000;
const DEFAULT_TIMEOUT_MS = 8_000;

export interface LiveSocketTarget {
  /** Logical route this socket serves (e.g. "VISA"). Part of the cache key. */
  key: string;
  host: string;
  port: number;
  timeoutMs?: number;
  header?: Iso8583HeaderMode;
  keepAliveMs?: number;
  reconnectBackoffMs?: number;
  /**
   * Override for deciding when a response is complete. Defaults to ISO 8583
   * framing. Supply this for transports whose message boundary is not a length
   * prefix (e.g. a delimiter-terminated protocol).
   */
  isComplete?: (received: Buffer) => boolean;
}

interface PendingRequest {
  payload: Buffer;
  resolve: (response: Buffer) => void;
  reject: (error: Error) => void;
}

type ConnectionState = 'idle' | 'connecting' | 'ready';

export interface LiveSocketStatus {
  key: string;
  endpoint: string;
  state: ConnectionState;
  queued: number;
  inFlight: boolean;
}

class LiveConnection {
  private socket: net.Socket | null = null;
  private state: ConnectionState = 'idle';
  private queue: PendingRequest[] = [];
  private inFlight: PendingRequest | null = null;
  private inFlightTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private received = Buffer.alloc(0);
  private destroyed = false;

  constructor(private readonly target: LiveSocketTarget) {}

  get status(): LiveSocketStatus {
    return {
      key: this.target.key,
      endpoint: `${this.target.host}:${this.target.port}`,
      state: this.state,
      queued: this.queue.length,
      inFlight: this.inFlight !== null,
    };
  }

  request(payload: Buffer): Promise<Buffer> {
    if (this.destroyed) {
      return Promise.reject(new Error(`Live socket ${this.target.key} is closed`));
    }
    return new Promise<Buffer>((resolve, reject) => {
      this.queue.push({ payload, resolve, reject });
      this.pump();
    });
  }

  close(): void {
    this.destroyed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const queued = this.queue;
    this.queue = [];
    for (const pending of queued) {
      pending.reject(new Error(`Live socket ${this.target.key} closed before send`));
    }
    this.failInFlight(new Error(`Live socket ${this.target.key} closed`));
    this.teardownSocket();
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private timeoutMs(): number {
    return this.target.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private isComplete(received: Buffer): boolean {
    if (this.target.isComplete) return this.target.isComplete(received);
    return isCompleteIso8583Frame(received, this.target.header || getIso8583HeaderMode());
  }

  private frame(payload: Buffer): Buffer {
    return buildIso8583Frame(payload, this.target.header || getIso8583HeaderMode());
  }

  /** Send the next queued request, connecting first if the link is down. */
  private pump(): void {
    if (this.destroyed || this.inFlight || this.queue.length === 0) return;

    const next = this.queue.shift() as PendingRequest;
    this.inFlight = next;
    this.received = Buffer.alloc(0);
    this.inFlightTimer = setTimeout(() => {
      // A request that timed out may still have a response in flight; the link
      // is presumed desynchronised and is torn down rather than reused.
      this.failInFlight(new Error(`Live socket ${this.target.key} timed out after ${this.timeoutMs()}ms`));
      this.teardownSocket();
      this.scheduleReconnect();
    }, this.timeoutMs());

    if (this.state === 'ready' && this.socket) {
      this.socket.write(this.frame(next.payload));
      return;
    }
    this.connect();
  }

  private connect(): void {
    if (this.destroyed || this.state !== 'idle') return;

    this.state = 'connecting';
    const socket = new net.Socket();
    this.socket = socket;
    socket.setKeepAlive(true, this.target.keepAliveMs ?? DEFAULT_KEEP_ALIVE_MS);
    socket.setNoDelay(true);

    socket.on('connect', () => {
      if (this.socket !== socket) return;
      this.state = 'ready';
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      const pending = this.inFlight;
      if (pending) socket.write(this.frame(pending.payload));
    });

    socket.on('data', (chunk: Buffer) => {
      if (this.socket !== socket) return;
      this.received = Buffer.concat([this.received, chunk]);
      if (!this.isComplete(this.received)) return;
      const response = this.received;
      this.received = Buffer.alloc(0);
      this.settleInFlight(response);
      this.pump();
    });

    socket.on('error', (error: Error) => {
      if (this.socket !== socket) return;
      this.state = 'idle';
      this.socket = null;
      socket.destroy();
      this.failInFlight(error);
      this.scheduleReconnect();
    });

    socket.on('close', () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.state = 'idle';
      if (this.inFlight) {
        if (this.received.length > 0 && this.isComplete(this.received)) {
          this.settleInFlight(this.received);
        } else {
          this.failInFlight(new Error(`Live socket ${this.target.key} closed before response`));
        }
      }
      this.scheduleReconnect();
    });

    socket.connect(this.target.port, this.target.host);
  }

  private settleInFlight(response: Buffer): void {
    const pending = this.inFlight;
    if (!pending) return;
    this.inFlight = null;
    this.clearInFlightTimer();
    pending.resolve(response);
  }

  private failInFlight(error: Error): void {
    const pending = this.inFlight;
    if (!pending) return;
    this.inFlight = null;
    this.clearInFlightTimer();
    pending.reject(error);
  }

  private clearInFlightTimer(): void {
    if (this.inFlightTimer) {
      clearTimeout(this.inFlightTimer);
      this.inFlightTimer = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.destroyed) return;
      this.connect();
      this.pump();
    }, this.target.reconnectBackoffMs ?? DEFAULT_RECONNECT_BACKOFF_MS);
  }

  private teardownSocket(): void {
    const socket = this.socket;
    this.socket = null;
    this.state = 'idle';
    if (socket) {
      socket.removeAllListeners();
      socket.destroy();
    }
  }
}

export class LiveSocketManager {
  private readonly connections = new Map<string, LiveConnection>();

  private cacheKey(target: LiveSocketTarget): string {
    return `${target.key}@${target.host}:${target.port}`;
  }

  private connection(target: LiveSocketTarget): LiveConnection {
    const key = this.cacheKey(target);
    let connection = this.connections.get(key);
    if (!connection) {
      connection = new LiveConnection(target);
      this.connections.set(key, connection);
    }
    return connection;
  }

  /**
   * Send one unframed message over the persistent route connection and resolve
   * with the raw response frame. Requests are serialised per route.
   */
  request(target: LiveSocketTarget, payload: Buffer): Promise<Buffer> {
    return this.connection(target).request(payload);
  }

  /** Inspect every live route connection. */
  status(): LiveSocketStatus[] {
    return [...this.connections.values()].map((connection) => connection.status);
  }

  close(key?: string): void {
    if (!key) {
      this.closeAll();
      return;
    }
    for (const [cacheKey, connection] of this.connections) {
      if (cacheKey === key || cacheKey.startsWith(`${key}@`)) {
        connection.close();
        this.connections.delete(cacheKey);
      }
    }
  }

  closeAll(): void {
    for (const connection of this.connections.values()) connection.close();
    this.connections.clear();
  }
}

export const liveSocketManager = new LiveSocketManager();
