const { onDocumentUpdated } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");

admin.initializeApp();

// Mensagens amigáveis por status — ajuste o texto à vontade
const MENSAGENS_STATUS = {
  preparando: { title: "Pedido em preparo 👨‍🍳", body: "Seu pedido já está sendo preparado!" },
  saiu_entrega: { title: "Saiu para entrega 🛵", body: "Seu pedido está a caminho. Acompanhe no mapa!" },
  entregue: { title: "Pedido entregue ✅", body: "Seu pedido foi entregue. Bom apetite!" },
  cancelado: { title: "Pedido cancelado ❌", body: "Seu pedido foi cancelado. Qualquer dúvida, chame no WhatsApp." }
};

// Dispara sempre que um documento em /pedidos/{id} é atualizado. Só envia notificação
// quando o campo "status" realmente mudou (evita disparar em qualquer outra edição, como
// o motoboy atualizando a localização) e quando o pedido tem um token de notificação salvo
// (o cliente precisa ter clicado em "Ativar notificações" na página de rastreamento).
exports.notificarMudancaStatusPedido = onDocumentUpdated("pedidos/{pedidoId}", async (event) => {
  const antes = event.data.before.data();
  const depois = event.data.after.data();

  if (!depois || antes.status === depois.status) return; // nada mudou no status
  if (!depois.tokenNotificacao) return; // cliente não ativou notificações pra esse pedido

  const conteudo = MENSAGENS_STATUS[depois.status];
  if (!conteudo) return; // status sem mensagem definida (ex: "pendente", que é o inicial)

  try {
    await admin.messaging().send({
      token: depois.tokenNotificacao,
      notification: {
        title: conteudo.title,
        body: conteudo.body
      },
      data: {
        link: `rastreio.html?id=${event.params.pedidoId}`
      },
      webpush: {
        fcmOptions: {
          link: `/rastreio.html?id=${event.params.pedidoId}`
        }
      }
    });
  } catch (error) {
    // Token inválido/expirado é comum (ex: cliente limpou o navegador) — só loga, não quebra nada
    console.error("Erro ao enviar notificação push:", error.message);
  }
});
