/* App-shell service worker. The LLM model is NOT cached here (Transformers.js uses Cache Storage 'transformers-cache'). */
importScripts('./js/version.js');
const VERSION = self.APP_VERSION.version;
const SHELL = `lnpc-shell-${VERSION}`;
const ASSETS = [
  './', 'index.html', 'manifest.json', 'version.json',
  'css/layout.css', 'css/chat.css', 'css/npc-selection.css', 'css/status.css', 'css/responsive.css',
  'js/version.js', 'js/app.js', 'js/config.js', 'js/npcs.js', 'js/llm.js', 'js/llm-prompts.js', 'js/chat.js',
  'js/world.js', 'js/memory.js', 'js/player.js', 'js/customize.js', 'js/speech.js', 'js/storage.js', 'js/ui.js', 'js/update-checker.js',
  'vendor/transformers.web.min.js', 'vendor/ort.webgpu.bundle.min.mjs', 'vendor/onnxruntime-common-shim.mjs', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS.map((u) => new Request(u, { cache: 'reload' })))));
  // No automatic skipWaiting: the page asks for it after the user confirms the update.
});
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('lnpc-shell-') && k !== SHELL) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // model/CDN traffic is never touched
  if (url.pathname.endsWith('/version.json')) return; // always straight to network (update checker uses no-store)
  e.respondWith((async () => {
    try {
      const res = await fetch(req, { cache: 'no-cache' }); // network-first: never trapped on an old shell
      if (res.ok) { const c = await caches.open(SHELL); c.put(req, res.clone()); }
      return res;
    } catch {
      const hit = await caches.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === 'navigate') return (await caches.match('index.html')) || Response.error();
      return Response.error();
    }
  })());
});
