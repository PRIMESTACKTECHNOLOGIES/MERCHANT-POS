import net from 'net';

export type Iso8583HeaderMode = 'LEN2' | 'LEN4' | 'TPDU' | 'NONE';

const TPDU = Buffer.from([0x60, 0x00, 0x00, 0x00, 0x00]);

export function getIso8583HeaderMode(): Iso8583HeaderMode {
  const configured = (process.env.ISO8583_HEADER || 'NONE').trim().toUpperCase();
  if (configured === 'LEN2' || configured === 'LEN4' || configured === 'TPDU' || configured === 'NONE') {
    return configured;
  }
  throw new Error(`Unsupported ISO8583_HEADER mode: ${configured}`);
}

export function buildIso8583Frame(isoMessage: Buffer | string): Buffer {
  const mode = getIso8583HeaderMode();
  const message = Buffer.isBuffer(isoMessage) ? isoMessage : Buffer.from(isoMessage, 'utf8');

  switch (mode) {
    case 'LEN2':
      if (message.length > 99) throw new Error('ISO8583 LEN2 frame payload exceeds 99 bytes');
      return Buffer.concat([Buffer.from(String(message.length).padStart(2, '0'), 'ascii'), message]);
    case 'LEN4':
      if (message.length > 9999) throw new Error('ISO8583 LEN4 frame payload exceeds 9999 bytes');
      return Buffer.concat([Buffer.from(String(message.length).padStart(4, '0'), 'ascii'), message]);
    case 'TPDU':
      return Buffer.concat([TPDU, message]);
    case 'NONE':
      return message;
  }
}

export function removeIso8583Frame(frame: Buffer): Buffer {
  const mode = getIso8583HeaderMode();
  if (mode === 'NONE') return frame;
  if (mode === 'TPDU') {
    if (frame.length < TPDU.length || !frame.subarray(0, TPDU.length).equals(TPDU)) {
      throw new Error('Unexpected ISO8583 TPDU header');
    }
    return frame.subarray(TPDU.length);
  }

  const prefixLength = mode === 'LEN2' ? 2 : 4;
  if (frame.length < prefixLength) throw new Error('Incomplete ISO8583 ASCII length prefix');
  const lengthText = frame.subarray(0, prefixLength).toString('ascii');
  if (!/^\d+$/.test(lengthText)) throw new Error('Invalid ISO8583 ASCII length prefix');
  const length = Number(lengthText);
  if (frame.length < prefixLength + length) throw new Error('Incomplete ISO8583 framed message');
  return frame.subarray(prefixLength, prefixLength + length);
}

export function isCompleteIso8583Frame(frame: Buffer): boolean {
  const mode = getIso8583HeaderMode();
  if (mode === 'NONE' || mode === 'TPDU') return frame.length > 0;
  const prefixLength = mode === 'LEN2' ? 2 : 4;
  if (frame.length < prefixLength) return false;
  const lengthText = frame.subarray(0, prefixLength).toString('ascii');
  return /^\d+$/.test(lengthText) && frame.length >= prefixLength + Number(lengthText);
}

export function sendIso8583(
  host: string,
  port: number,
  isoMessage: Buffer | string,
  timeoutMs = 8000,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    const framed = buildIso8583Frame(isoMessage);
    let received = Buffer.alloc(0);
    let settled = false;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      callback();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('ISO8583 TCP timeout'))), timeoutMs);

    socket.on('connect', () => socket.write(framed));
    socket.on('data', (chunk) => {
      received = Buffer.concat([received, chunk]);
      if (isCompleteIso8583Frame(received)) {
        finish(() => resolve(received));
      }
    });
    socket.on('error', (error) => finish(() => reject(error)));
    socket.on('close', () => {
      if (!settled) {
        if (received.length > 0) finish(() => resolve(received));
        else finish(() => reject(new Error('ISO8583 TCP connection closed before response')));
      }
    });
    socket.connect(port, host);
  });
}
