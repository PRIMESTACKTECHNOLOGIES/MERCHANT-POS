import {
  buildIso8583Frame,
  removeIso8583Frame,
} from './headerBuilder';
import type { IsoFraming } from './iso8583.framing';

export const iso8583HeaderFraming: IsoFraming = {
  addHeader: buildIso8583Frame,
  removeHeader: removeIso8583Frame,
};
