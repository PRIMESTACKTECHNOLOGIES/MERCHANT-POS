import { Iso8583HeaderMode, getIso8583HeaderMode, removeIso8583Frame } from './headerBuilder';
import { liveSocketManager } from './liveSocketManager';

export class IsoTcpClient {
  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly timeoutMs: number,
    /** Live-socket cache key — the scheme route this link serves (e.g. "VISA"). */
    private readonly key: string = `${host}:${port}`,
    private readonly header: Iso8583HeaderMode = getIso8583HeaderMode(),
  ) {}

  send(rawMessage: Buffer): Promise<Buffer> {
    // `rawMessage` arrives already framed by the codec; strip the frame so the
    // persistent connection can re-apply this route's framing mode.
    const payload = removeIso8583Frame(rawMessage);
    return liveSocketManager.request(
      {
        key: this.key,
        host: this.host,
        port: this.port,
        timeoutMs: this.timeoutMs,
        header: this.header,
      },
      payload,
    );
  }
}
