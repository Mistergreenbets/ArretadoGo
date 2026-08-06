// Service Worker do Firebase Cloud Messaging.
// Esse arquivo precisa ficar na RAIZ do site (mesma pasta do index.html), com esse nome exato.
// Ele roda em segundo plano e é o responsável por mostrar a notificação quando o navegador
// do cliente está minimizado ou a aba de rastreamento está fechada.

importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.0/firebase-messaging-compat.js');

// Mesma configuração do firebase-config.js (esses valores não são secretos — já ficam
// visíveis em qualquer app Firebase rodando no navegador do cliente).
firebase.initializeApp({
  apiKey: "AIzaSyClhkIOZGJWP6m5mH1sjK2k2_QXBMornC0",
  authDomain: "projeto-delivery-b37e7.firebaseapp.com",
  projectId: "projeto-delivery-b37e7",
  storageBucket: "projeto-delivery-b37e7.firebasestorage.app",
  messagingSenderId: "80008327269",
  appId: "1:80008327269:web:d3539309584adf0d70568c"
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
