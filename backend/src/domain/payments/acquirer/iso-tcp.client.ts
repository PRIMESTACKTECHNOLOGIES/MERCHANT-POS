import { removeIso8583Frame, sendIso8583 } from './headerBuilder';

export class IsoTcpClient {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
  ) {}

  send(rawMessage: Buffer): Promise<Buffer> {
    return sendIso8583(this.host, this.port, removeIso8583Frame(rawMessage), this.timeoutMs);
  }
}
