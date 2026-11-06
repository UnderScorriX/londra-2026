// Tiene l'app e i file cifrati disponibili offline. Versione e lista file sono iniettate da build.mjs.
const VERSION = '7f07b6bfa6';
const PRECACHE = ["./","app.js","fonts/commissioner.woff2","fonts/doto.woff2","icons/apple-touch-icon.png","icons/icon-192.png","icons/icon-512.png","icons/icon-maskable-512.png","manifest.webmanifest","styles.css","vault/04a4fae42cda37b86a.bin","vault/18dfb4ec909ba96e87.bin","vault/21d70ded94d5550f2a.bin","vault/2e98c6ea0b03bd9996.bin","vault/3f9be5809a6a5765a3.bin","vault/40bf6f95ee9802a612.bin","vault/451dbf1d3986ac4668.bin","vault/500d55d8ac7b09da4e.bin","vault/52678ab7445d14072d.bin","vault/58d02caba10a8d3fc7.bin","vault/59d03914082347a8b5.bin","vault/5fcac88a54ac349569.bin","vault/61ae907fe8ab4da081.bin","vault/61de9b6653a396f50d.bin","vault/63ba4f9188586bc25c.bin","vault/63e9042ceaa23c23ad.bin","vault/655f8b7a2d761c2643.bin","vault/664bfd7979074c136e.bin","vault/680f63702870e9b86f.bin","vault/74a6bd930a20927744.bin","vault/7ad23c43823d143cd0.bin","vault/8c9f058d2be1ef1efb.bin","vault/93ea92b31219030aa2.bin","vault/985df50c32db8be01a.bin","vault/9b5cbfdd30873acf3e.bin","vault/a164dbc52d95076adc.bin","vault/b03758364923309001.bin","vault/c090a50c8055b37c9c.bin","vault/c2aaba4f765ff9d3a5.bin","vault/c69d0fad2999cb2932.bin","vault/e056a5cd157cb94858.bin","vault/e17cef8f7e34a9870d.bin","vault/e5779ebdd404681ed2.bin","vault/e864d9cce0a1d00fc7.bin","vault/e98bf0fe59ce903017.bin","vault/eed7d8bec294094cec.bin","vault/fafa0338c0ce8330d2.bin","vault/fc4c83ce1151a9a7a2.bin","vault/meta.json","vault/trip.bin","index.html"];
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
