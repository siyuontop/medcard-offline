/**
 * =========================================================
 *  SERVICE WORKER — MedCard Offline
 * =========================================================
 * Inilah yang membuat app bisa dibuka tanpa internet sama sekali.
 *
 * Cara kerja singkat:
 * 1. Saat pertama kali dibuka (WAJIB online sekali ini saja), semua file
 *    app (HTML/CSS/JS/ikon) disalin ke "Cache Storage" di HP/browser.
 * 2. Setiap kunjungan berikutnya, file-file itu diambil dari cache lokal
 *    duluan — bukan dari internet — jadi app tetap kebuka walau pesawat mode.
 * 3. Font Google (Inter, Plus Jakarta Sans, Material Symbols) dicache
 *    terpisah begitu berhasil dimuat pertama kali, jadi ikon & huruf custom
 *    tetap muncul walau offline.
 *
 * PENTING KALAU SAYA KASIH UPDATE FILE DI KEMUDIAN HARI:
 * Naikkan angka di CACHE_VERSION di bawah (misal 'v1' -> 'v2') setiap kali
 * Anda upload file baru ke GitHub. Ini memberi tahu browser "ada versi baru,
 * buang cache lama, pakai yang baru" — kalau tidak dinaikkan, pengguna bisa
 * terus melihat versi lama yang ter-cache sampai mereka hapus cache manual.
 * =========================================================
 */

var CACHE_VERSION = 'v1';
var APP_SHELL_CACHE = 'medcard-shell-' + CACHE_VERSION;
var FONT_CACHE = 'medcard-fonts-' + CACHE_VERSION;

var APP_SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './tailwind-generated.css',
  './dexie.min.js',
  './db.js',
  './gs-shim.js',
  './sounds.js',
  './app.js',
  './offline-extras.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-maskable-512.png'
];

// ---------- INSTALL: simpan app shell ke cache ----------
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then(function (cache) {
      return cache.addAll(APP_SHELL_FILES);
    }).then(function () {
      return self.skipWaiting(); // langsung aktif, tidak perlu tunggu tab lama ditutup
    })
  );
});

// ---------- ACTIVATE: buang cache versi lama ----------
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(
        keys.filter(function (key) {
          return key !== APP_SHELL_CACHE && key !== FONT_CACHE;
        }).map(function (key) { return caches.delete(key); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

// ---------- FETCH: strategi beda untuk tiap jenis request ----------
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return; // biarkan POST (mis. ke Gemini API) lewat apa adanya

  var url = new URL(req.url);

  // Font Google: cache-first, tapi selalu coba perbarui di latar belakang kalau online
  // (stale-while-revalidate) — supaya tetap tampil walau offline, tapi tidak "beku" selamanya.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.open(FONT_CACHE).then(function (cache) {
        return cache.match(req).then(function (cached) {
          var networkFetch = fetch(req).then(function (resp) {
            if (resp && resp.status === 200) cache.put(req, resp.clone());
            return resp;
          }).catch(function () { return cached; });
          return cached || networkFetch;
        });
      })
    );
    return;
  }

  // File app sendiri (asal sama dengan app ini): cache-first, fallback ke network.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        return cached || fetch(req).catch(function () {
          // Kalau request halaman (navigasi) gagal & tidak ada di cache, jatuhkan ke index.html.
          if (req.mode === 'navigate') return caches.match('./index.html');
        });
      })
    );
    return;
  }

  // Selain itu (mis. panggilan ke Gemini API saat Import AI dipakai): biarkan apa adanya,
  // tidak di-cache, karena memang butuh online saat dipanggil.
});
