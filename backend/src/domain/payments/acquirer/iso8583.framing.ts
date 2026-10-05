export interface IsoFraming {
  addHeader(payload: Buffer): Buffer;
  removeHeader(message: Buffer): Buffer;
}

export const defaultUnframed: IsoFraming = {
  addHeader: (payload) => payload,
  removeHeader: (message) => message,
};

export function uint16LengthFraming(header: Buffer = Buffer.alloc(0)): IsoFraming {
  return {
    addHeader(payload) {
      const body = Buffer.concat([header, payload]);
      if (body.length > 0xffff) throw new Error('ISO8583 frame exceeds uint16 length');
      const length = Buffer.alloc(2);
      length.writeUInt16BE(body.length, 0);
      return Buffer.concat([length, body]);
    },
    removeHeader(message) {
      if (message.length < 2) throw new Error('Incomplete ISO8583 binary length prefix');
      const length = message.readUInt16BE(0);
      if (message.length < length + 2) throw new Error('Incomplete ISO8583 framed message');
      return message.subarray(2, length + 2);
    },
  };
}

export function ascii4LengthFraming(header: Buffer = Buffer.alloc(0)): IsoFraming {
  return {
    addHeader(payload) {
      const body = Buffer.concat([header, payload]);
      if (body.length > 9999) throw new Error('ISO8583 frame exceeds ASCII length prefix');
      return Buffer.concat([Buffer.from(String(body.length).padStart(4, '0'), 'ascii'), body]);
    },
    removeHeader(message) {
      if (message.length < 4) throw new Error('Incomplete ISO8583 ASCII length prefix');
      const length = Number(message.subarray(0, 4).toString('ascii'));
      if (!Number.isInteger(length) || message.length < length + 4) throw new Error('Invalid ISO8583 ASCII length prefix');
      return message.subarray(4, length + 4);
    },
  };
}
