/* eslint-disable no-undef */
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'AIzaSyAtWpuPhjYbsnEewnfAmhghBRBli1Icyyw',
  authDomain: 'gen-lang-client-0158814606.firebaseapp.com',
  projectId: 'gen-lang-client-0158814606',
  storageBucket: 'gen-lang-client-0158814606.firebasestorage.app',
  messagingSenderId: '647297706271',
  appId: '1:647297706271:web:b186bb42e26b3847bfe82a',
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'VerdeChat';
  const options = {
    body: (payload.notification && payload.notification.body) || 'You have a new message',
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
      return undefined;
    })
  );
});
