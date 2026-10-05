import { db } from '../config/db';
import { v4 as uuidv4 } from 'uuid';
export class IssuerScriptProcessor {
  async process(scripts: string[]): Promise<void> {
    for (const scriptHex of scripts) {
      if (!scriptHex || scriptHex.length < 2) continue;
      const tag = scriptHex.slice(0, 2).toUpperCase();
      const scriptId = tag === '71' ? 71 : tag === '72' ? 72 : 0;
      if (scriptId === 0) continue;
      console.log(`[IssuerScript] Processing script ${scriptId}: ${scriptHex.slice(0, 20)}...`);
      try {
        await db.query(`CREATE TABLE IF NOT EXISTS issuer_scripts_applied (id TEXT PRIMARY KEY, script_id INTEGER NOT NULL, data_hex TEXT NOT NULL, applied_at TEXT NOT NULL)`);
        await db.query('INSERT INTO issuer_scripts_applied (id,script_id,data_hex,applied_at) VALUES (?,?,?,?)',[uuidv4(),scriptId,scriptHex,new Date().toISOString()]);
      } catch { /* non-critical */ }
    }
  }
}
export const issuerScriptProcessor = new IssuerScriptProcessor();