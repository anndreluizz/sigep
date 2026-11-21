// Guarda o app no aparelho para abrir sem internet (só funciona quando hospedado em https).
const CACHE = 'sigep-v29'
const FILES = ['./', 'index.html', 'estilo.css', 'js/config.js', 'js/etapas.js', 'js/app.js', 'manifest.webmanifest', 'manifest-totem.webmanifest', 'icone.svg', 'img/brasao.png', 'totem.html', 'privacidade.html', 'js/totem.js', 'js/jsqr.min.js',
  'fontes.css', 'fontes/Barlow-400.woff2', 'fontes/Barlow-600.woff2', 'fontes/Barlow-700.woff2', 'fontes/BarlowCondensed-700.woff2', 'fontes/IBMPlexSans.woff2',
  'js/vendor/supabase-2.45.4.js', 'js/vendor/qrcode-1.4.4.min.js', 'js/vendor/xlsx-0.20.3.full.min.js']
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())))
self.addEventListener('activate', e => e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())))
// rede primeiro (pega versão nova), cache se estiver sem sinal; nunca guarda respostas do banco
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url), guardar = url.origin === location.origin
  e.respondWith(fetch(e.request).then(r => { if (r.ok && guardar) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)) } return r })
    .catch(() => caches.match(e.request)))
})
