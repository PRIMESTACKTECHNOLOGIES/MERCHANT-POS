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
  2:  { type: 'AN',  length: 512, variable: 'LLVAR',   encoding: 'ascii'  },  // PAN / token
  3:  { type: 'N',   length: 6,   variable: 'FIXED',   encoding: 'bcd'    },  // Processing code
  4:  { type: 'N',   length: 12,  variable: 'FIXED',   encoding: 'bcd'    },  // Amount, transaction
  7:  { type: 'N',   length: 10,  variable: 'FIXED'                       },  // Transmission date & time (MMDDHHmmss)
  11: { type: 'N',   length: 6,   variable: 'FIXED'                       },  // STAN
  12: { type: 'N',   length: 6,   variable: 'FIXED'                       },  // Time, local (HHmmss)
  13: { type: 'N',   length: 4,   variable: 'FIXED'                       },  // Date, local (MMDD)
  14: { type: 'N',   length: 4,   variable: 'FIXED',   encoding: 'bcd'    },  // Expiry date (YYMM)
  18: { type: 'N',   length: 4,   variable: 'FIXED'                       },  // Merchant category code (MCC)
  22: { type: 'N',   length: 3,   variable: 'FIXED',   encoding: 'bcd'    },  // POS entry mode
  23: { type: 'N',   length: 3,   variable: 'FIXED',   encoding: 'bcd'    },  // PAN sequence number
  25: { type: 'N',   length: 2,   variable: 'FIXED',   encoding: 'bcd'    },  // POS condition code
  32: { type: 'N',   length: 11,  variable: 'LLVAR'                       },  // Acquiring institution ID
  35: { type: 'ANS', length: 37,  variable: 'LLVAR'                       },  // Track 2 data
  37: { type: 'AN',  length: 12,  variable: 'FIXED'                       },  // Retrieval reference number
  38: { type: 'AN',  length: 6,   variable: 'FIXED'                       },  // Authorization ID response (approval code)
  39: { type: 'AN',  length: 2,   variable: 'FIXED'                       },  // Response code
  41: { type: 'ANS', length: 8,   variable: 'FIXED'                       },  // Card acceptor terminal ID
  42: { type: 'ANS', length: 15,  variable: 'FIXED'                       },  // Card acceptor ID code (merchant ID)
  43: { type: 'ANS', length: 40,  variable: 'FIXED'                       },  // Card acceptor name/location
  45: { type: 'ANS', length: 76,  variable: 'LLVAR'                       },  // Track 1 data
  49: { type: 'AN',  length: 3,   variable: 'FIXED'                       },  // Currency code, transaction
  52: { type: 'B',   length: 8,   variable: 'FIXED',   encoding: 'binary' },  // PIN data block (encrypted)
  55: { type: 'B',   length: 999, variable: 'LLLVAR',  encoding: 'binary' },  // ICC data — EMV / DE55
  60: { type: 'ANS', length: 999, variable: 'LLLVAR'                      },  // Reserved private (advice/reason code)
  62: { type: 'ANS', length: 999, variable: 'LLLVAR'                      },  // Reserved private (invoice/ref)
  64: { type: 'B',   length: 8,   variable: 'FIXED',   encoding: 'binary' },  // MAC — message authentication code (primary)
  70: { type: 'N',   length: 3,   variable: 'FIXED',   encoding: 'ascii'  },  // Network management information code
  90: { type: 'N',   length: 42,  variable: 'FIXED'                       },  // Original data elements
  128:{ type: 'B',   length: 8,   variable: 'FIXED',   encoding: 'binary' },  // MAC — secondary bitmap message authentication code
};
