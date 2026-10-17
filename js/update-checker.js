import { CONFIG, APP } from './config.js';

/** "0.1.0-build.001" -> [0,1,0,1]; release (no build) sorts after builds of the same version. */
export function parseVersion(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-build\.(\d+))?$/);
  if (!m) return null;
  return [+m[1], +m[2], +m[3], m[4] === undefined ? Infinity : +m[4]];
}
export function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) return 0;
  for (let i = 0; i < 4; i++) if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  return 0;
}

export class UpdateChecker {
  constructor({ onUpdate, onError } = {}) { this.onUpdate = onUpdate; this.onError = onError; this.timer = null; this.notified = null; }
  start() {
    this.check();
    this.timer = setInterval(() => this.check(), CONFIG.update.intervalMs);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.check(); });
  }
  async check() {
    if (!navigator.onLine) return null;
    try {
      const url = new URL(CONFIG.update.versionUrl, location.href);
      url.searchParams.set('t', Date.now());
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error(`version.json HTTP ${res.status}`);
      const remote = await res.json();
      if (compareVersions(remote.version, APP.version) > 0 && this.notified !== remote.version) {
        this.notified = remote.version;
        this.onUpdate?.(remote, { belowMinimum: compareVersions(APP.version, remote.minimumSupportedVersion || '0.0.0') < 0 });
      }
      return remote;
    } catch (e) { this.onError?.(e); return null; }
  }
  /** Called only after the user confirms. Model cache (Cache Storage 'transformers-cache') is not touched. */
  async apply() {
    try {
      const reg = await navigator.serviceWorker?.getRegistration();
      if (reg) {
        await reg.update();
        const sw = reg.installing || reg.waiting;
        if (sw && sw.state !== 'installed' && sw.state !== 'activated') {
          await new Promise((res) => { const t = setTimeout(res, 5000); sw.addEventListener('statechange', () => { if (sw.state === 'installed') { clearTimeout(t); res(); } }); });
        }
        if (reg.waiting) {
          await new Promise((res) => {
            const t = setTimeout(res, 3000);
            navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); res(); }, { once: true });
            reg.waiting.postMessage('SKIP_WAITING');
          });
        }
      }
    } catch (e) { this.onError?.(e); }
    location.reload();
  }
}
