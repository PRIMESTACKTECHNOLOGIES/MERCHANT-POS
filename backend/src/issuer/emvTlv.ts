export interface Tlv {
  tag: string;
  length: number;
  value: Buffer;
}

export function parseTlv(buffer: Buffer): Tlv[] {
  const tlvs: Tlv[] = [];
  let offset = 0;

  while (offset < buffer.length) {
    const tagStart = offset;
    let tag = buffer[offset++].toString(16).padStart(2, "0").toUpperCase();
    if ((parseInt(tag, 16) & 0x1f) === 0x1f) {
      if (offset >= buffer.length) throw new Error("EMV_TLV_TRUNCATED_TAG");
      tag += buffer[offset++].toString(16).padStart(2, "0").toUpperCase();
    }
    if (offset >= buffer.length) throw new Error("EMV_TLV_TRUNCATED_LENGTH");

    const lengthByte = buffer[offset++];
    let length = lengthByte;
    if ((lengthByte & 0x80) !== 0) {
      const byteCount = lengthByte & 0x7f;
      if (byteCount === 0 || byteCount > 4 || offset + byteCount > buffer.length) {
        throw new Error("EMV_TLV_INVALID_LENGTH");
      }
      length = 0;
      for (let i = 0; i < byteCount; i += 1) {
        length = length * 256 + buffer[offset++];
      }
    }
    if (offset + length > buffer.length) {
      throw new Error(`EMV_TLV_VALUE_TRUNCATED_AT_${tag || tagStart}`);
    }

    tlvs.push({ tag, length, value: Buffer.from(buffer.subarray(offset, offset + length)) });
    offset += length;
  }

  return tlvs;
}

export function getTag(tlvs: Tlv[], tag: string): Buffer | null {
  const found = tlvs.find((tlv) => tlv.tag === tag.toUpperCase());
  return found ? found.value : null;
}
