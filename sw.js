// A simple service worker to allow installation
self.addEventListener('install', (e) => {
    console.log('[Service Worker] Installed');
});

self.addEventListener('fetch', (e) => {
    // Required to pass PWA checks, but we just let the network handle everything normally
});
