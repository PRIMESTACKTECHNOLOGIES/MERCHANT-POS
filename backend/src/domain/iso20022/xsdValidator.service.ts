import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ISO20022_SCHEMA_DIR, getMessageSchema } from './messageSchemas';

/**
 * Real XSD validation of ISO 20022 documents.
 *
 * The published schemas are validated with the JAXP validator shipped with the
 * JDK (`support.XMLValidator`), executed out of tree so that neither the
 * repository nor `node_modules` needs to be mutated at runtime:
 *
 *   1. locate `java` / `javac` (JAVA_HOME first, then PATH)
 *   2. compile `iso20022-schemas/tools/XMLValidator.java` once into a cache dir
 *   3. stream the document on stdin, read `result=OK|WITH_ERRORS|FATAL_ERROR`
 *
 * When no JDK is present the API stays honest: `available:false` and
 * `valid:false` — a document is never reported as schema-valid without a
 * successful validator run.
 */

export interface XsdValidationResult {
  /** False when this host cannot run the validator at all (no JDK). */
  available: boolean;
  valid: boolean;
  result: 'OK' | 'WITH_ERRORS' | 'FATAL_ERROR' | 'UNAVAILABLE';
  messages: string[];
  /** Populated when the validator itself could not be executed. */
  reason?: string;
  /** Number of JVM invocations spent on this document (0 when never attempted). */
  attempts: number;
  durationMs: number;
}

const TOOLS_DIR = path.join(ISO20022_SCHEMA_DIR, 'tools');
const HELPER_DIR = process.env.ISO20022_VALIDATOR_CACHE
  || path.join(os.tmpdir(), 'primestack-iso20022-validator');
const HELPER_CLASS = path.join(HELPER_DIR, 'support', 'XMLValidator.class');
const HELPER_SOURCE = path.join(TOOLS_DIR, 'XMLValidator.java');
const VALIDATION_TIMEOUT_MS = Number(process.env.ISO20022_VALIDATION_TIMEOUT_MS || 30000);
/**
 * The OpenJDK 8 JVM on this Windows host dies with STATUS_ACCESS_VIOLATION
 * (exit 3221225477) on roughly one invocation in six, yielding no output at
 * all. JVM flags (`-XX:-UsePerfData`, `-Xshare:off`, `-Xint`) do not change it.
 * The validator is side-effect free, so a silent death is retried rather than
 * surfaced as a validation verdict — a document is only ever reported
 * schema-invalid when the JVM actually produced a `result=` report.
 */
const VALIDATION_ATTEMPTS = Math.max(1, Number(process.env.ISO20022_VALIDATOR_ATTEMPTS || 4));

const JAVA_EXE = process.platform === 'win32' ? 'java.exe' : 'java';
const JAVAC_EXE = process.platform === 'win32' ? 'javac.exe' : 'javac';

function resolveTool(exe: string): string | null {
  const candidates: string[] = [];
  const javaHome = (process.env.JAVA_HOME || '').trim();
  if (javaHome) candidates.push(path.join(javaHome, 'bin', exe));
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const trimmed = dir.trim();
    if (trimmed) candidates.push(path.join(trimmed, exe));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* keep looking */
    }
  }
  return null;
}

interface Toolchain {
  java: string;
  javac: string | null;
}

let cachedToolchain: Toolchain | null | undefined;

function toolchain(): Toolchain | null {
  if (cachedToolchain !== undefined) return cachedToolchain;
  const java = resolveTool(JAVA_EXE);
  if (!java) {
    cachedToolchain = null;
    return cachedToolchain;
  }
  // The validator library resolves its runtime through JAVA_HOME; make sure the
  // spawned JVM and any nested lookup agree on the JDK that actually exists.
  process.env.JAVA_HOME = path.dirname(path.dirname(java));
  cachedToolchain = { java, javac: resolveTool(JAVAC_EXE) };
  return cachedToolchain;
}

let helperReady: Promise<{ ok: boolean; reason?: string }> | null = null;

function run(cmd: string, args: string[], options: { input?: string; cwd?: string }): Promise<{ code: number | null; stdout: string; stderr: string; error?: Error }> {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { cwd: options.cwd, windowsHide: true });
    } catch (error: any) {
      return resolve({ code: null, stdout: '', stderr: '', error });
    }

    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (payload: { code: number | null; stdout: string; stderr: string; error?: Error }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(payload);
    };

    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* already gone */ }
      finish({ code: null, stdout, stderr, error: new Error(`Timed out after ${VALIDATION_TIMEOUT_MS}ms`) });
    }, VALIDATION_TIMEOUT_MS);

    child.stdout?.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', (error) => finish({ code: null, stdout, stderr, error }));
    child.on('close', (code) => finish({ code, stdout, stderr }));

    if (options.input !== undefined) {
      child.stdin?.on('error', () => { /* the JVM may exit before reading */ });
      child.stdin?.end(Buffer.from(options.input, 'utf8'));
    } else {
      child.stdin?.end();
    }
  });
}

/** Compiles the JAXP validation helper once into the cache directory. */
function ensureHelper(): Promise<{ ok: boolean; reason?: string }> {
  if (helperReady) return helperReady;

  helperReady = (async () => {
    const tc = toolchain();
    if (!tc) return { ok: false, reason: `No '${JAVA_EXE}' found in JAVA_HOME or PATH` };

    let stale = true;
    try {
      const sourceStat = fs.statSync(HELPER_SOURCE);
      const classStat = fs.statSync(HELPER_CLASS);
      stale = classStat.mtimeMs < sourceStat.mtimeMs;
    } catch {
      stale = true;
    }

    if (!stale) return { ok: true };
    if (!tc.javac) {
      return fs.existsSync(HELPER_CLASS)
        ? { ok: true }
        : { ok: false, reason: `No '${JAVAC_EXE}' found and no compiled validator in ${HELPER_DIR}` };
    }
    if (!fs.existsSync(HELPER_SOURCE)) {
      return { ok: false, reason: `Validator source missing at ${HELPER_SOURCE}` };
    }

    fs.mkdirSync(path.join(HELPER_DIR, 'support'), { recursive: true });
    const compiled = await run(tc.javac, ['-encoding', 'UTF-8', '-d', HELPER_DIR, HELPER_SOURCE], { cwd: TOOLS_DIR });
    if (compiled.error || compiled.code !== 0 || !fs.existsSync(HELPER_CLASS)) {
      return {
        ok: false,
        reason: `Failed to compile the XSD validator helper: ${compiled.error?.message || compiled.stderr.trim() || `exit code ${compiled.code}`}`,
      };
    }
    return { ok: true };
  })();

  return helperReady;
}

function parseMessages(stderr: string): string[] {
  return stderr
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => line.replace(/^\[(warning|error|fatal)\]\s*/i, '$1: '))
    .slice(0, 50);
}

/** Validates a serialised ISO 20022 document against an XSD on disk. */
export async function validateXmlAgainstXsd(xml: string, xsdFile: string): Promise<XsdValidationResult> {
  const startedAt = Date.now();
  const unavailable = (reason: string, attempts = 0): XsdValidationResult => ({
    available: false,
    valid: false,
    result: 'UNAVAILABLE',
    messages: [],
    reason,
    attempts,
    durationMs: Date.now() - startedAt,
  });

  const tc = toolchain();
  if (!tc) return unavailable(`No '${JAVA_EXE}' found in JAVA_HOME or PATH`);

  const helper = await ensureHelper();
  if (!helper.ok) return unavailable(helper.reason || 'XSD validator unavailable');
  if (!fs.existsSync(xsdFile)) return unavailable(`Schema not found at ${xsdFile}`);

  let lastReason = 'Validator produced no result';
  let attempts = 0;

  while (attempts < VALIDATION_ATTEMPTS) {
    attempts += 1;
    const result = await run(
      tc.java,
      ['-Dfile.encoding=UTF-8', '-classpath', HELPER_DIR, 'support.XMLValidator', '-stdin', `-schema=${xsdFile}`],
      { input: xml, cwd: HELPER_DIR }
    );

    const stdout = result.stdout || '';
    const reportMatch = stdout.match(/result=(OK|WITH_ERRORS|FATAL_ERROR)/);
    const report = reportMatch ? reportMatch[1] : null;

    if (report) {
      return {
        available: true,
        valid: report === 'OK',
        result: report as XsdValidationResult['result'],
        messages: parseMessages(result.stderr || ''),
        attempts,
        durationMs: Date.now() - startedAt,
      };
    }

    lastReason = result.error
      ? result.error.message
      : `Validator produced no result (${(result.stderr || '').trim().slice(0, 300) || 'no output'})`;
  }

  return unavailable(`${lastReason} — after ${attempts} attempt(s)`, attempts);
}

/** Validates a document against the XSD registered for its message type. */
export async function validateIso20022Document(xml: string, messageType: string): Promise<XsdValidationResult> {
  let xsdFile: string;
  try {
    xsdFile = getMessageSchema(messageType).xsdFile;
  } catch (error: any) {
    return {
      available: false,
      valid: false,
      result: 'UNAVAILABLE',
      messages: [],
      reason: error?.message || 'Unknown message type',
      attempts: 0,
      durationMs: 0,
    };
  }
  return validateXmlAgainstXsd(xml, xsdFile);
}

/** Readiness probe used by the API surface. */
export async function validationAvailability(): Promise<{ available: boolean; reason?: string; javaHome?: string; helperDir: string }> {
  const tc = toolchain();
  if (!tc) return { available: false, reason: `No '${JAVA_EXE}' found in JAVA_HOME or PATH`, helperDir: HELPER_DIR };
  const helper = await ensureHelper();
  return {
    available: helper.ok,
    reason: helper.reason,
    javaHome: process.env.JAVA_HOME,
    helperDir: HELPER_DIR,
  };
}
