/**
 * CLIENT-SIDE INTRUSION DETERRENT + REPORTER
 *
 * HONEST SCOPE — read this before trusting it:
 * Everything the browser runs has already been downloaded to the visitor's machine.
 * NOTHING here can stop a determined attacker from reading your JS bundle.
 * What this module actually does:
 *   1. Blocks the *casual* paths — right-click menu, F12 / Ctrl-U / Ctrl-S,
 *      drag-an-image-to-desktop — so screenshots-of-source and asset rips take effort.
 *   2. RECORDS every attempt to POST /api/security/client-event so you can see
 *      who is probing and from which IP.
 * Real protection lives server-side (JWT auth, HMAC, rate limits) plus
 * `sourcemap: false` in vite.config.ts, which keeps your original TypeScript
 * source out of the shipped build.
 *
 * To disable locally for debugging: open any URL with  ?guard=off
 * To re-enable:                              open any URL with  ?guard=on
 */

const ENDPOINT = '/api/security/client-event';
const FLAG = 'pos_guard_off';
const THROTTLE_MS = 1500;

const lastSent = new Map<string, number>();

function isDisabled(): boolean {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.get('guard') === 'off') { localStorage.setItem(FLAG, '1'); return true; }
    if (q.get('guard') === 'on') { localStorage.removeItem(FLAG); return false; }
    return localStorage.getItem(FLAG) === '1';
  } catch {
    return false;
  }
}

/** Fire-and-forget report. Must never throw into the app. */
function report(event: string, detail: string): void {
  const now = Date.now();
  const prev = lastSent.get(event) ?? 0;
  if (now - prev < THROTTLE_MS) return;
  lastSent.set(event, now);

  console.warn(`%c[SECURITY] ${event} — ${detail} (attempt recorded)`, 'color:#f43;font-weight:bold');

  try {
    const payload = JSON.stringify({
      event,
      detail,
      path: window.location.pathname,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      ts: new Date().toISOString(),
    });
    // sendBeacon survives page unload and cannot be blocked by the navigation.
    if (navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
    } else {
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    }
  } catch {
    // Telemetry failure must never affect the POS flow.
  }
}

export function installClientSecurityGuard(): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;

  if (isDisabled()) {
    console.info('[SECURITY] client guard disabled — re-enable with ?guard=on');
    return;
  }

  // 1. Right-click menu → kills "Save image as…", "View page source", "Inspect".
  document.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
      report('CLIENT_RIGHT_CLICK', 'context menu blocked');
    },
    true
  );

  // 2. DevTools / source / save shortcuts.
  document.addEventListener(
    'keydown',
    (e) => {
      const key = (e.key || '').toUpperCase();
      const mod = e.ctrlKey || e.metaKey;

      let event: string | null = null;
      if (key === 'F12') event = 'CLIENT_DEVTOOLS_ATTEMPT';
      else if (mod && e.shiftKey && (key === 'I' || key === 'J' || key === 'C')) event = 'CLIENT_DEVTOOLS_ATTEMPT';
      else if (mod && key === 'U') event = 'CLIENT_SOURCE_VIEW_ATTEMPT';
      else if (mod && key === 'S') event = 'CLIENT_SAVE_PAGE_ATTEMPT';

      if (event) {
        e.preventDefault();
        e.stopPropagation();
        const combo = `${mod ? (e.ctrlKey ? 'Ctrl+' : 'Cmd+') : ''}${e.shiftKey ? 'Shift+' : ''}${e.key}`;
        report(event, `shortcut ${combo}`);
      }
    },
    true
  );

  // 3. Drag an image out of the page = instant file save.
  document.addEventListener(
    'dragstart',
    (e) => {
      const target = e.target as HTMLElement | null;
      if (target && target.tagName === 'IMG') {
        e.preventDefault();
        report('CLIENT_IMAGE_DRAG', 'image drag blocked');
      }
    },
    true
  );

  // 4. Detect an opened DevTools pane (outer/inner size delta) and record it once.
  let devtoolsOpen = false;
  window.setInterval(() => {
    const widthGap = window.outerWidth - window.innerWidth;
    const heightGap = window.outerHeight - window.innerHeight;
    const open = widthGap > 160 || heightGap > 160;
    if (open && !devtoolsOpen) {
      devtoolsOpen = true;
      report('CLIENT_DEVTOOLS_OPEN', `viewport ${window.innerWidth}x${window.innerHeight}`);
    } else if (!open && devtoolsOpen) {
      devtoolsOpen = false;
    }
  }, 1000);
}
