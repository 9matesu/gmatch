/**
 * gMatch Service Worker
 * Handles push notifications, background SFX, and offline support
 */

const CACHE_NAME = 'goonmatch-v1';
const SOUND_CACHE = 'goonmatch-sounds-v1';

// Pre-cache critical assets
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
];

// Install event - precache critical assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME && name !== SOUND_CACHE)
          .map((name) => caches.delete(name))
      );
    })
  );
  self.clients.claim();
});

// Fetch event - network first, cache fallback
self.addEventListener('fetch', (event) => {
  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // Skip cross-origin requests
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(event.request).then((cachedResponse) =>
      fetch(event.request)
        .then((networkResponse) => {
          // Cache successful responses
          if (networkResponse.ok) {
            const responseClone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone);
            });
          }
          return networkResponse;
        })
        .catch(() => {
          if (cachedResponse) return cachedResponse;
          return new Response('offline', { status: 503, statusText: 'Service Unavailable' });
        }),
    ),
  );
});

// Push notification event
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const { title, body, icon, badge, tag, data: notificationData, sound, actions, requireInteraction } = data;

    const options = {
      body,
      icon: icon || '/icon-192.png',
      badge: badge || '/badge-72.png',
      tag: tag || 'goonmatch-notification',
      data: notificationData || {},
      requireInteraction: requireInteraction !== false,
      actions: actions || [],
      vibrate: [200, 100, 200],
      timestamp: Date.now(),
    };

    event.waitUntil(
      self.registration.showNotification(title, options)
    );

    // Play sound in SW context if requested
    if (sound) {
      playSoundInSW(sound);
    }
  } catch (err) {
  }
});

// Notification click event - focus tab and navigate
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const { url, matchId, type } = event.notification.data || {};

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to find existing gMatch tab
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          // Navigate to match if specified
          if (url && client.url !== url) {
            client.navigate(url);
          }
          return client.focus();
        }
      }

      // No existing tab - open new one
      const targetUrl = url || self.location.origin;
      return clients.openWindow(targetUrl);
    })
  );
});

// Notification close event
self.addEventListener('notificationclose', (event) => {
  // Track dismissed notifications if needed
});

// Message from main thread
self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};

  switch (type) {
    case 'PLAY_SOUND':
      playSoundInSW(payload.sound);
      break;
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
    case 'GET_VERSION':
      event.ports[0].postMessage({ version: CACHE_NAME });
      break;
  }
});

// Background SFX playback via AudioContext in SW
async function playSoundInSW(soundType) {
  try {
    // Use OffscreenCanvas or AudioContext workaround for SW
    // Since SW can't play audio directly, we'll use a BroadcastChannel
    // to tell the main thread to play the sound
    const channel = new BroadcastChannel('goonmatch-sfx');
    channel.postMessage({ type: 'PLAY_SOUND', sound: soundType });
    channel.close();
  } catch (err) {
  }
}

// Periodic sync for offline actions (if needed)
self.addEventListener('sync', (event) => {
  if (event.tag === 'goonmatch-sync') {
    event.waitUntil(syncOfflineActions());
  }
});

async function syncOfflineActions() {
  // Handle any queued offline actions
}

// Periodic background sync (if supported)
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'goonmatch-periodic') {
    event.waitUntil(periodicSync());
  }
});

async function periodicSync() {
  // Periodic background tasks
}