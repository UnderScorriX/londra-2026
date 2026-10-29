// Tiene l'app e i file cifrati disponibili offline. Versione e lista file sono iniettate da build.mjs.
const VERSION = 'f76807318e';
const PRECACHE = ["./","app.js","fonts/commissioner.woff2","fonts/doto.woff2","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","manifest.webmanifest","styles.css","vault/0944dd4e614eaa0bfb.bin","vault/09e8bbdca2bf90a66d.bin","vault/0b6c78fb8d04e019fa.bin","vault/22f26cb786146ce10d.bin","vault/2474dbaf7b074f7086.bin","vault/25c9f81f6221a2fbad.bin","vault/2819f379fb3259974b.bin","vault/2c67be58bc8ebe881d.bin","vault/2f537619e9649f0eb4.bin","vault/36859f176d8f38c3a2.bin","vault/3ae7249cc1ad614ffc.bin","vault/3bb57da039f1879471.bin","vault/423a144a22fe3404ac.bin","vault/4690c6f3206e694cc2.bin","vault/47fb34a19191e20040.bin","vault/4a73eec241eef0a281.bin","vault/4c791c8abf7aaaafdb.bin","vault/5b40152f9013246433.bin","vault/5ddb4c29b55a48b327.bin","vault/6b59935b1e278a697d.bin","vault/772a83caa0b0f6fc7c.bin","vault/78a2d75f71da4f3122.bin","vault/8fd2239b4af4745994.bin","vault/900db56de68be60f00.bin","vault/9134cf70a8ec6698f1.bin","vault/96f03132d484c4c4ed.bin","vault/a21ee47cba9c298e81.bin","vault/a85a80afb1af684985.bin","vault/a95d5002a0ceebf23f.bin","vault/b71e8bdb99e11c1fa0.bin","vault/bc8a9cb1a3972bc18b.bin","vault/cf17f8b1d034917f7d.bin","vault/cf34412acfa01ace4f.bin","vault/d3447005efe802f016.bin","vault/e09170bbdd07125479.bin","vault/f5bf9716a2eaedbe3b.bin","vault/f6164ed710e07f8729.bin","vault/f6d533400c17b51de9.bin","vault/meta.json","vault/trip.bin","index.html"];
const CACHE = 'londra-' + VERSION;

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('londra-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then(r => r || fetch(e.request)));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request)));
});
