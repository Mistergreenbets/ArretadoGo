// Service Worker do Firebase Cloud Messaging.
// Esse arquivo precisa ficar na RAIZ do site (mesma pasta do index.html), com esse nome exato.
// Ele roda em segundo plano e é o responsável por mostrar a notificação quando o navegador
// do cliente está minimizado ou a aba de rastreamento está fechada.

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

// Mesma configuração do firebase-config.js (esses valores não são secretos — já ficam
// visíveis em qualquer app Firebase rodando no navegador do cliente).
firebase.initializeApp({
  apiKey: "AIzaSyBcjz6lJ2S3Cex3hheDsIbFf6fz3K1-8mE",
  authDomain: "arretadogo.firebaseapp.com",
  projectId: "arretadogo",
  storageBucket: "arretadogo.firebasestorage.app",
  messagingSenderId: "907455433951",
  appId: "1:907455433951:web:1fd1298c7fd730aec32d6a"
});

const messaging = firebase.messaging();

// Mostra a notificação quando a mensagem chega com o app em segundo plano
messaging.onBackgroundMessage((payload) => {
    const titulo = payload.notification?.title || 'Atualização do seu pedido';
    const opcoes = {
        body: payload.notification?.body || '',
        icon: 'logo.png',
        data: payload.data || {}
    };
    self.registration.showNotification(titulo, opcoes);
});

// Ao clicar na notificação, abre (ou foca) a página de rastreamento do pedido
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const link = event.notification.data?.link || '/rastreio.html';
    event.waitUntil(
        clients.matchAll({ type: 'window' }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.includes('rastreio.html') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(link);
        })
    );
});
