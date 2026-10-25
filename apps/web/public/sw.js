const CACHE = 'beacon-shell-v3';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(['/offline.html','/icon-192.png'])).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('beacon-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
});
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data;
    try { data = event.data?.json(); } catch { return; }
    if (data?.type !== 'message' || !uuid.test(data.subscriptionId) || !uuid.test(data.messageId) || !uuid.test(data.chatId)) return;
    // Recheck access after logout, blocking, removal from a chat or preference changes.
    const query = new URLSearchParams({subscriptionId:data.subscriptionId,messageId:data.messageId});
    const response = await fetch('/api/push/notification?' + query, {credentials:'include',cache:'no-store'});
    if (!response.ok) return;
    const message = await response.json();
    if (!message || !uuid.test(message.chatId)) return;
    await self.registration.showNotification(message.title, {
      body:message.body, icon:'/icon-192.png', badge:'/icon-192.png',
      tag:'beacon-chat-' + message.chatId, renotify:false, data:{chatId:message.chatId},
    });
  })().catch(() => {}));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const chatId = event.notification.data?.chatId;
  if (!uuid.test(chatId)) return;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const client = windows.find(window => {
      const url = new URL(window.url);
      return url.origin === self.location.origin && (['/', '/profile', '/people', '/admin'].includes(url.pathname) || url.pathname.startsWith('/chats/'));
    });
    if (client) {
      await client.focus();
      client.postMessage({type:'beacon:open-chat',chatId});
    } else await self.clients.openWindow('/?chat=' + chatId);
  })());
});
