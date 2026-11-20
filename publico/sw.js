self.addEventListener('push', evento => {
  const body = evento.data?.text() || 'Abra o painel para conferir seus vencimentos.';
  evento.waitUntil(self.registration.showNotification('Finanças em Dia', {
    body, icon: '/icone-192.png', badge: '/icone-192.png'
  }));
});

self.addEventListener('notificationclick', evento => {
  evento.notification.close();
  const destino = new URL('/#compromissos', self.location.origin).href;
  evento.waitUntil((async () => {
    const janelas = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const janela = janelas.find(item => new URL(item.url).origin === self.location.origin);
    if (janela) {
      await janela.navigate(destino);
      await janela.focus();
    } else {
      await self.clients.openWindow(destino);
    }
  })());
});
self.addEventListener('install', evento => {
  evento.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', evento => {
  evento.waitUntil(self.clients.claim());
});

