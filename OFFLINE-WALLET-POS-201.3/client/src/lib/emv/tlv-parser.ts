export interface EMVTag {
  tag: string;
  length: number;
  value: string;
  raw: string;
}

export class TLVParser {
  private static readonly TAG_CLASSES = {
    '00': 'Universal',
    '01': 'Application',
    '10': 'Context-specific',
    '11': 'Private'
  };

  private static readonly CONSTRUCTED_TAGS = [
    '6F', '70', 'A5', 'BF0C', 'BF20', 'DF01', 'DF20', 'DF21'
  ];

  static parseTLV(data: string): EMVTag[] {
    const tags: EMVTag[] = [];
    let offset = 0;

    while (offset < data.length) {
      const tagResult = this.parseTag(data, offset);
      if (!tagResult) break;

      const { tag, tagLength } = tagResult;
      offset += tagLength;

      const lengthResult = this.parseLength(data, offset);
      if (!lengthResult) break;

      const { length, lengthBytes } = lengthResult;
      offset += lengthBytes;

      if (offset + length * 2 > data.length) break;

      const value = data.substr(offset, length * 2);
      const raw = data.substr(offset - tagLength - lengthBytes, tagLength + lengthBytes + length * 2);

      tags.push({
        tag,
        length,
        value,
        raw
      });

      offset += length * 2;
    }

    return tags;
  }

  private static parseTag(data: string, offset: number): { tag: string; tagLength: number } | null {
    if (offset >= data.length - 1) return null;

    const firstByte = data.substr(offset, 2);
    let tag = firstByte;
    let tagLength = 2;

    // Check if it's a multi-byte tag
    if ((parseInt(firstByte, 16) & 0x1F) === 0x1F) {
      if (offset + 3 >= data.length) return null;
      
      const secondByte = data.substr(offset + 2, 2);
      tag += secondByte;
      tagLength = 4;

      // Check for third byte if bit 8 is set
      if ((parseInt(secondByte, 16) & 0x80) === 0x80) {
        if (offset + 5 >= data.length) return null;
        tag += data.substr(offset + 4, 2);
        tagLength = 6;
      }
    }

    return { tag, tagLength };
  }

  private static parseLength(data: string, offset: number): { length: number; lengthBytes: number } | null {
    if (offset >= data.length - 1) return null;

    const firstByte = parseInt(data.substr(offset, 2), 16);
    
    if (firstByte < 0x80) {
      // Short form
      return { length: firstByte, lengthBytes: 2 };
    } else {
      // Long form
      const lengthBytes = firstByte & 0x7F;
      if (lengthBytes === 0 || offset + lengthBytes * 2 > data.length) return null;

      let length = 0;
      for (let i = 0; i < lengthBytes; i++) {
        length = (length << 8) | parseInt(data.substr(offset + 2 + i * 2, 2), 16);
      }

      return { length, lengthBytes: (lengthBytes + 1) * 2 };
    }
  }

  static buildTLV(tag: string, value: string): string {
    const tagHex = tag.padStart(2, '0').toUpperCase();
    const valueLength = value.length / 2;
    
    let lengthHex: string;
    if (valueLength < 0x80) {
      lengthHex = valueLength.toString(16).padStart(2, '0');
    } else {
      const lengthBytes = Math.ceil(Math.log2(valueLength) / 8);
      lengthHex = (0x80 | lengthBytes).toString(16).padStart(2, '0');
      
      let tempLength = valueLength;
      for (let i = lengthBytes - 1; i >= 0; i--) {
        lengthHex += ((tempLength >> (i * 8)) & 0xFF).toString(16).padStart(2, '0');
      }
    }

    return tagHex + lengthHex + value;
  }

  static getTagValue(tags: EMVTag[], tag: string): string | null {
    const found = tags.find(t => t.tag.toUpperCase() === tag.toUpperCase());
    return found ? found.value : null;
  }

  static isConstructed(tag: string): boolean {
    return this.CONSTRUCTED_TAGS.includes(tag.toUpperCase());
  }

  static getTagClass(tag: string): string {
    const firstByte = parseInt(tag.substr(0, 2), 16);
    const classBits = (firstByte >> 6) & 0x03;
    return this.TAG_CLASSES[classBits.toString(2).padStart(2, '0')];
  }

  static getTagNumber(tag: string): number {
    const firstByte = parseInt(tag.substr(0, 2), 16);
    return firstByte & 0x1F;
  }
}