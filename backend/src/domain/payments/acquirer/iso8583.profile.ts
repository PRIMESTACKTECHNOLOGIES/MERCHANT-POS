export type IsoFieldType = 'N' | 'AN' | 'ANS' | 'B';
export type IsoFieldVariable = 'FIXED' | 'LLVAR' | 'LLLVAR';

export interface IsoFieldDefinition {
  type: IsoFieldType;
  length: number;
  variable?: IsoFieldVariable;
  encoding?: 'ascii' | 'bcd' | 'binary';
}

export const isoProfile: Record<number, IsoFieldDefinition> = {
  // The application carries an opaque network-token reference here. A PCI
  // processor adapter may translate it to the network's numeric DE2 format.
  2: { type: 'AN', length: 512, variable: 'LLVAR', encoding: 'ascii' },
  3: { type: 'N', length: 6, variable: 'FIXED', encoding: 'bcd' },
  4: { type: 'N', length: 12, variable: 'FIXED', encoding: 'bcd' },
  7: { type: 'N', length: 10, variable: 'FIXED' },
  11: { type: 'N', length: 6, variable: 'FIXED' },
  14: { type: 'N', length: 4, variable: 'FIXED', encoding: 'bcd' },
  22: { type: 'N', length: 3, variable: 'FIXED', encoding: 'bcd' },
  23: { type: 'N', length: 3, variable: 'FIXED', encoding: 'bcd' },
  25: { type: 'N', length: 2, variable: 'FIXED', encoding: 'bcd' },
  35: { type: 'ANS', length: 37, variable: 'LLVAR' },
  37: { type: 'AN', length: 12, variable: 'FIXED' },
  38: { type: 'AN', length: 6, variable: 'FIXED' },
  39: { type: 'AN', length: 2, variable: 'FIXED' },
  41: { type: 'ANS', length: 8, variable: 'FIXED' },
  42: { type: 'ANS', length: 15, variable: 'FIXED' },
  49: { type: 'AN', length: 3, variable: 'FIXED' },
  52: { type: 'B', length: 8, variable: 'FIXED', encoding: 'binary' },
  55: { type: 'B', length: 999, variable: 'LLLVAR', encoding: 'binary' },
  70: { type: 'N', length: 3, variable: 'FIXED', encoding: 'ascii' },
  64: { type: 'B', length: 8, variable: 'FIXED', encoding: 'binary' },
};
