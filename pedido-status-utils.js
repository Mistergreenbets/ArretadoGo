// ========== UTILITÁRIOS DE STATUS DE PEDIDO ==========
// Compartilhado entre admin.js e motoboy.js

const STATUS_PEDIDO = [
    { valor: 'pendente', label: '⏳ Pendente' },
    { valor: 'preparando', label: '👨‍🍳 Preparando' },
    { valor: 'saiu_entrega', label: '🚗 Saiu para Entrega' },
    { valor: 'entregue', label: '✅ Entregue' },
    { valor: 'cancelado', label: '❌ Cancelado' }
];

// Nome da loja usado nas mensagens de WhatsApp — quem carregar as configurações
// (admin.js ou motoboy.js) deve atualizar essa variável.
let nomeLojaAtual = 'Kitechiyo';

// Deixa só números (usado para montar o link do WhatsApp)
function apenasNumeros(str) {
    return (str || '').toString().replace(/\D/g, '');
}

// Cliente digita só DDD + número (ex: "(85)9.9999-9999" -> 85999999999, 11 dígitos).
// O link wa.me exige o código do país na frente (55). Aqui completa quando faltar,
// sem mexer em números que já vierem completos (com 55 e 12/13 dígitos).
function formatarNumeroWhatsApp(telefone) {
    const numero = apenasNumeros(telefone);
    if (numero.length === 10 || numero.length === 11) {
        return '55' + numero;
    }
    return numero;
}

function getLabelStatus(status) {
    return STATUS_PEDIDO.find(s => s.valor === status)?.label || status;
}

// Retorna o código do pedido pra exibir nas mensagens (usa o código gerado no
// checkout; pedidos antigos sem esse campo caem no pedaço do ID do Firestore)
function formatarCodigoPedido(pedido) {
    return pedido.codigoPedido || pedido.id?.substring(0, 8).toUpperCase() || '';
}

// Mensagem enviada ao cliente para cada status (edite os textos à vontade)
const MENSAGENS_STATUS = {
    pendente: (pedido) => `Olá, ${pedido.nome}! Recebemos seu pedido *#${formatarCodigoPedido(pedido)}* na *${nomeLojaAtual}* e ele está sendo confirmado. 🙌`,
    preparando: (pedido) => `Olá, ${pedido.nome}! Seu pedido *#${formatarCodigoPedido(pedido)}* na *${nomeLojaAtual}* já está sendo preparado. 👨‍🍳🔥`,
    saiu_entrega: (pedido) => `Olá, ${pedido.nome}! Seu pedido *#${formatarCodigoPedido(pedido)}* saiu para entrega e chega em breve. 🚗💨`,
    entregue: (pedido) => `Olá, ${pedido.nome}! Seu pedido *#${formatarCodigoPedido(pedido)}* foi entregue. Obrigado por pedir na *${nomeLojaAtual}*! Bom apetite 😋`,
    cancelado: (pedido) => `Olá, ${pedido.nome}. Infelizmente seu pedido *#${formatarCodigoPedido(pedido)}* na *${nomeLojaAtual}* foi cancelado. Qualquer dúvida, é só chamar por aqui.`
};

// Monta o link wa.me com a mensagem certa para o status e telefone do pedido
function montarLinkWhatsAppStatus(pedido, status) {
    const numero = formatarNumeroWhatsApp(pedido.telefone);
    if (!numero) return null;

    const gerarMensagem = MENSAGENS_STATUS[status];
    const mensagem = gerarMensagem ? gerarMensagem(pedido) : `Atualização do seu pedido na ${nomeLojaAtual}: ${status}`;

    return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}

// Abre uma aba em branco de imediato (dentro do clique do usuário, pra não ser bloqueada)
// e só depois preenche o endereço, já que a atualização no banco é assíncrona.
function enviarAtualizacaoWhatsApp(pedido, status, abaJaAberta) {
    const link = montarLinkWhatsAppStatus(pedido, status);

    if (!link) {
        showToast('Pedido sem telefone válido para enviar WhatsApp', 'error');
        abaJaAberta?.close?.();
        return;
    }

    if (abaJaAberta && !abaJaAberta.closed) {
        abaJaAberta.location.href = link;
    } else {
        window.open(link, '_blank');
    }
}
