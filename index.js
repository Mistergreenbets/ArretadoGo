// Nenhuma Cloud Function em uso no momento.
//
// Histórico: esse arquivo já teve duas funções que foram removidas por decisão do dono do
// projeto:
//   - extrairCardapioDeImagem: importava produtos a partir de foto de cardápio usando IA.
//   - notificarMudancaStatusPedido: mandava notificação push quando o status do pedido mudava
//     (exigia o plano pago Blaze pra rodar Cloud Functions, então foi descontinuada).
//
// Como não há nada exportado aqui, "firebase deploy --only functions" não implanta nada — o
// projeto pode inclusive voltar pro plano gratuito (Spark) sem prejudicar o restante do site
// (loja, admin, motoboy e rastreio funcionam 100% sem Cloud Functions).
