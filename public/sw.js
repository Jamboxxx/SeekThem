// Service Worker for background processing and offline capabilities
const CACHE_NAME = 'seekThem-v1';
const urlsToCache = [
  '/',
  '/style.css',
  '/app.js',
  '/manifest.json',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Install event - cache resources
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

// Fetch event - serve cached content when offline
self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request)
      .then((response) => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      }
    )
  );
});

// Background sync for location updates
self.addEventListener('sync', (event) => {
  if (event.tag === 'location-update') {
    event.waitUntil(syncLocationData());
  }
});

// Handle background sync
async function syncLocationData() {
  try {
    // Get stored location data
    const data = await getStoredLocationData();
    if (data) {
      // Send to server when back online
      await sendLocationToServer(data);
    }
  } catch (error) {
    console.log('Background sync failed:', error);
  }
}

// Store location data for background sync
async function getStoredLocationData() {
  try {
    const cache = await caches.open('location-data');
    const response = await cache.match('/location-data');
    if (response) {
      return await response.json();
    }
  } catch (error) {
    console.log('Error getting stored location:', error);
  }
  return null;
}

// Send location to server
async function sendLocationToServer(locationData) {
  try {
    await fetch('/api/location', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(locationData)
    });
  } catch (error) {
    console.log('Failed to send location:', error);
  }
}

// Handle messages from main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'STORE_LOCATION') {
    storeLocationData(event.data.location);
  }
});

// Store location data for offline sync
async function storeLocationData(location) {
  try {
    const cache = await caches.open('location-data');
    await cache.put('/location-data', new Response(JSON.stringify(location)));
  } catch (error) {
    console.log('Error storing location:', error);
  }
}

// Keep service worker alive
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});