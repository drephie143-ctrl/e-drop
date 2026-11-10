// Offline cache for the app shell. Network first, so a new version shows up as soon as
// the phone is online; the cache is the fallback when it's offline.
// Bump VERSION when files change.
const VERSION = 'e-drop-v3';
const SHELL = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'css/sound.css', 'css/mix.css', 'css/coach.css', 'css/desktop.css',
  'js/main.js', 'js/store.js', 'js/undo.js',
  'js/audio/engine.js', 'js/audio/render.js', 'js/audio/synth.js', 'js/audio/presets.js', 'js/audio/drums.js', 'js/audio/fx.js',
  'js/music/theory.js', 'js/music/project.js', 'js/music/demo.js',
  'js/ui/dom.js', 'js/ui/roll.js', 'js/ui/song.js', 'js/ui/screens.js', 'js/ui/sound.js', 'js/ui/mix.js', 'js/ui/desktop.js',
  'js/ui/graph-base.js', 'js/ui/graphs-sound.js', 'js/ui/graphs-mix.js',
  'js/coach/coach.js', 'js/coach/lessons.js', 'js/coach/doctor.js', 'js/coach/facts.js', 'js/coach/glossary.js', 'js/coach/spotlight.js',
  'js/dsp/master.js', 'js/dsp/worker.js', 'js/dsp/client.js',
  'icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const res = await fetch(req, { cache: 'no-cache' });
      if (res.ok) cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match(req, { ignoreSearch: true })) || Response.error();
    }
  })());
});
