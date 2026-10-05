export interface BuiltIsoBitmap {
  bitmap: Buffer;
  fieldIds: number[];
}

export interface ParsedIsoBitmap {
  fieldIds: number[];
  consumed: number;
}

const BITMAP_BYTES = 8;
const MAX_FIELD = 128;

export function buildIsoBitmap(fieldIdsInput: number[]): BuiltIsoBitmap {
  const fieldIds = [...new Set(fieldIdsInput)]
    .filter((field) => field !== 1)
    .sort((a, b) => a - b);

  for (const field of fieldIds) {
    if (!Number.isInteger(field) || field < 2 || field > MAX_FIELD) {
      throw new Error(`Field ${field} is outside bitmap range 2-128`);
    }
  }

  const hasSecondary = fieldIds.some((field) => field > 64);
  const bitmap = Buffer.alloc(hasSecondary ? BITMAP_BYTES * 2 : BITMAP_BYTES);

  if (hasSecondary) bitmap[0] |= 0x80;
  for (const field of fieldIds) {
    const index = field - 1;
    bitmap[Math.floor(index / 8)] |= 1 << (7 - (index % 8));
  }

  return { bitmap, fieldIds };
}

export function parseIsoBitmap(buffer: Buffer): ParsedIsoBitmap {
  if (buffer.length < BITMAP_BYTES) {
    throw new Error('Insufficient bytes for primary bitmap');
  }

  const hasSecondary = (buffer[0] & 0x80) !== 0;
  const consumed = hasSecondary ? BITMAP_BYTES * 2 : BITMAP_BYTES;
  if (buffer.length < consumed) {
    throw new Error('Secondary bitmap indicated but not enough bytes');
  }

  const fieldIds: number[] = [];
  for (let index = 1; index < consumed * 8; index += 1) {
    if ((buffer[Math.floor(index / 8)] & (1 << (7 - (index % 8)))) !== 0) {
      fieldIds.push(index + 1);
    }
  }

  return { fieldIds, consumed };
}
