import { PosProtocol } from '../core/PosProtocol';

export type PosCard = {
  panToken: string;
  holderName?: string;
  scheme: 'VISA';
  program?: string;
};

export type PosTerminal = {
  id: string;
  provider: 'PAX';
  online: boolean;
  protocol: PosProtocol;
};

export type PosProcessor = {
  id: string;
  name: string;
  supportsProtocol: PosProtocol[];
};
