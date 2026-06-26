const CACHE_NAME = 'cross-weather-v3';
const ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './radar.js',
  './jma_codes.js',
  './manifest.json',
  './icon.svg'
];

self.addEventListener('install', (e) => {
  // 新しいService Workerを、古いタブが残っていても即座に有効化する
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

// 古いバージョンのキャッシュを削除し、新しいService Workerを即座に有効化する
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => caches.delete(name))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  e.respondWith(
    caches.match(e.request).then((response) => {
      return response || fetch(e.request);
    })
  );
});
