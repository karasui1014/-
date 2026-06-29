/* =========================================================================
 * sw.js — おかいものメモ Service Worker
 * アプリシェルをキャッシュして、機内モード/電波が弱くてもコア機能を動かす。
 * バージョンを上げると古いキャッシュを掃除して更新される。
 * ========================================================================= */
var CACHE = 'okaimono-v13';

// アプリの土台になる静的ファイル一式（同一ディレクトリ相対）。
// ※ お店タブの地図(Leaflet/OSMタイル)は外部・オンライン時のみで、ここには含めない。
var APP_SHELL = [
  './',
  './index.html',
  './style.css',
  './categories.js',
  './recipes.js',
  './app.js',
  './stores.js',
  './manifest.json',
  './favicon.svg',
  './favicon-16.png',
  './favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // HTTPキャッシュを避けて常に最新を取り込む（更新の取りこぼし防止）。
      // 一部が失敗してもインストールは続行する。
      return Promise.all(APP_SHELL.map(function (url) {
        return fetch(new Request(url, { cache: 'reload' }))
          .then(function (res) { if (res && res.ok) return cache.put(url, res); })
          .catch(function () { /* ネット不調などは無視 */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// 取得戦略：
//  - 同一オリジンのGETは cache-first（オフライン優先・高速）。
//  - 取れたものはキャッシュを更新（stale-while-revalidate 風）。
//  - Googleフォント等の外部リソースは network-first でフォールバック。
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  var sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    event.respondWith(
      caches.match(req).then(function (cached) {
        var network = fetch(req).then(function (res) {
          if (res && res.status === 200) {
            var copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        }).catch(function () { return cached; });
        return cached || network;
      })
    );
  } else {
    // フォント等：ネット優先、失敗したらキャッシュ。
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return caches.match(req); })
    );
  }
});
