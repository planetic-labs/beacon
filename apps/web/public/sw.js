// Replaced only in a production build. The dev worker never caches source modules.
const SHELL = /* BEACON_SHELL */ null;
const CACHE = SHELL ? 'beacon-shell-' + SHELL.version : 'beacon-shell-dev-v4';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const clientVersions = new Map();
const shellPaths = new Set(SHELL ? SHELL.urls : ['/offline.html', '/icon-192.png']);
const isAppPage = path => ['/', '/index.html', '/profile', '/settings', '/settings/profile', '/settings/security', '/settings/notifications', '/settings/data', '/settings/about', '/settings/stickers', '/people', '/admin', '/admin/stickers', '/admin/users', '/admin/groups', '/admin/chats', '/consent'].includes(path)
  || (path.startsWith('/chats/') && uuid.test(path.slice(7)));
async function cleanOldCaches() {
  const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
  // Keep old assets while any tab still runs that release (or has not answered).
  if (SHELL && windows.some(client => clientVersions.get(client.id) !== SHELL.version)) return;
  const keys = await caches.keys();
  await Promise.all(keys.filter(key => key.startsWith('beacon-shell-') && key !== CACHE).map(key => caches.delete(key)));
}
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      await cache.addAll([...shellPaths].map(path => new Request(path, {cache:'reload', credentials:'omit'})));
      if (!SHELL) await self.skipWaiting();
    } catch (error) {
      await caches.delete(CACHE);
      throw error;
    }
  })());
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    await self.clients.claim();
    const windows = await self.clients.matchAll({type:'window', includeUncontrolled:true});
    for (const client of windows) client.postMessage({type:'beacon:version-query', version:SHELL?.version});
    await cleanOldCaches();
  })());
});
self.addEventListener('message', event => {
  if (event.origin !== self.location.origin) return;
  if (event.data?.type === 'beacon:activate-update') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'beacon:client-version' && event.source?.id) {
    clientVersions.set(event.source.id, event.data.version);
    event.source.postMessage({type:'beacon:active-version', version:SHELL?.version});
    event.waitUntil(cleanOldCaches());
  }
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (event.request.mode === 'navigate' && isAppPage(url.pathname)) {
    event.respondWith((async () => {
      if (SHELL) {
        const cached = await (await caches.open(CACHE)).match('/index.html');
        if (cached) return cached;
      }
      try { return await fetch(event.request); }
      catch { return (await (await caches.open(CACHE)).match('/offline.html')) || Response.error(); }
    })());
  } else if (SHELL && (shellPaths.has(url.pathname) || url.pathname.startsWith('/assets/'))) {
    event.respondWith((async () => {
      const cached = await (await caches.open(CACHE)).match(url.pathname);
      if (cached) return cached;
      // Older open tabs may still request their release's hashed assets.
      if (url.pathname.startsWith('/assets/')) {
        for (const key of await caches.keys()) {
          if (!key.startsWith('beacon-shell-')) continue;
          const previous = await (await caches.open(key)).match(url.pathname);
          if (previous) return previous;
        }
      }
      return fetch(event.request);
    })());
  }
  // API, authentication, user media and other documents always use the network.
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
      return url.origin === self.location.origin && (['/', '/profile', '/settings', '/settings/profile', '/settings/security', '/settings/notifications', '/settings/data', '/settings/about', '/settings/stickers', '/people', '/admin', '/admin/stickers', '/admin/users', '/admin/groups', '/admin/chats'].includes(url.pathname) || url.pathname.startsWith('/chats/'));
    });
    if (client) {
      await client.focus();
      client.postMessage({type:'beacon:open-chat',chatId});
    } else await self.clients.openWindow('/?chat=' + chatId);
  })());
});
