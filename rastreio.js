// ========== RASTREAMENTO DE PEDIDO (CLIENTE) ==========

const ETAPAS_PEDIDO = [
    { status: 'pendente', label: 'Recebido', icone: '📝' },
    { status: 'preparando', label: 'Preparando', icone: '👨‍🍳' },
    { status: 'saiu_entrega', label: 'Saiu p/ Entrega', icone: '🛵', apenasDelivery: true },
    { status: 'entregue', label: 'Entregue', icone: '✅' }
];

let mapaMotoboy = null;
let marcadorMotoboy = null;
let pedidoAtualId = null;

document.addEventListener('DOMContentLoaded', () => {
    const params = new URLSearchParams(window.location.search);
    pedidoAtualId = params.get('id');

    if (!pedidoAtualId) {
        document.getElementById('conteudoRastreio').innerHTML = `
            <div class="erro-box">
                Link inválido — não encontramos o código do pedido na URL.<br>
                Confira o link que você recebeu no WhatsApp.
            </div>`;
        return;
    }

    observarPedido(pedidoAtualId, renderizarPedido);
});

function renderizarPedido(pedido) {
    const container = document.getElementById('conteudoRastreio');

    if (!pedido) {
        container.innerHTML = `
            <div class="erro-box">
                Pedido não encontrado. Ele pode ter sido removido, ou o link está incorreto.
            </div>`;
        return;
    }

    const status = pedido.status || 'pendente';

    if (status === 'cancelado') {
        container.innerHTML = `
            <div class="rastreio-card">
                <div class="rastreio-codigo">Pedido #${pedido.codigoPedido || pedido.id}</div>
                <div class="rastreio-titulo">Olá, ${escaparHtml(pedido.nome || '')}!</div>
                <div class="status-cancelado-box">❌ Esse pedido foi cancelado.</div>
                ${montarResumoItens(pedido)}
            </div>`;
        return;
    }

    const etapas = ETAPAS_PEDIDO.filter(e => !e.apenasDelivery || pedido.tipoEntrega === 'delivery');
    const indiceAtual = etapas.findIndex(e => e.status === status);

    const timelineHtml = etapas.map((etapa, i) => {
        let classe = '';
        if (i < indiceAtual) classe = 'concluido';
        else if (i === indiceAtual) classe = 'atual';
        return `
            <div class="timeline-step ${classe}">
                <div class="timeline-dot">${etapa.icone}</div>
                <div class="timeline-label">${etapa.label}</div>
            </div>`;
    }).join('');

    const mostraMapa = pedido.tipoEntrega === 'delivery' && status === 'saiu_entrega' && pedido.localizacaoAtual;

    container.innerHTML = `
        <div class="rastreio-card">
            <div class="rastreio-codigo">Pedido #${pedido.codigoPedido || pedido.id}</div>
            <div class="rastreio-titulo">Olá, ${escaparHtml(pedido.nome || '')}!</div>
            <div class="timeline">${timelineHtml}</div>
            ${mostraMapa ? '<div id="mapaMotoboy"></div><p style="font-size:12px; color:#999; margin-top:6px;">📍 Localização aproximada do motoboy, atualizada em tempo real.</p>' : ''}
            <button class="btn btn-primary notif-btn" id="ativarNotificacoesBtn">🔔 Ativar notificações desse pedido</button>
            ${montarResumoItens(pedido)}
        </div>
    `;

    if (mostraMapa) atualizarMapa(pedido.localizacaoAtual);

    const btnNotif = document.getElementById('ativarNotificacoesBtn');
    if (btnNotif) {
        if (pedido.tokenNotificacao) {
            btnNotif.textContent = '🔔 Notificações ativadas';
            btnNotif.disabled = true;
        } else {
            btnNotif.addEventListener('click', ativarNotificacoes);
        }
    }
}

function montarResumoItens(pedido) {
    if (!Array.isArray(pedido.itens)) return '';
    const linhas = pedido.itens.map(item => `${item.quantidade}x ${escaparHtml(item.nome)}`).join('<br>');
    return `
        <div class="rastreio-itens">${linhas}</div>
        <div class="rastreio-total">Total: R$ ${(Number(pedido.total) || 0).toFixed(2)}</div>
    `;
}

function atualizarMapa(localizacao) {
    const posicao = [localizacao.lat, localizacao.lng];
    const mapaDiv = document.getElementById('mapaMotoboy');
    if (!mapaDiv) return;

    // A cada atualização de status/localização, o card inteiro é reconstruído (innerHTML),
    // então o <div id="mapaMotoboy"> de antes deixa de existir. Se a instância do Leaflet
    // ainda aponta pro container antigo, precisa destruir e recriar no container novo.
    if (mapaMotoboy && mapaMotoboy._container !== mapaDiv) {
        mapaMotoboy.remove();
        mapaMotoboy = null;
        marcadorMotoboy = null;
    }

    if (!mapaMotoboy) {
        mapaMotoboy = L.map(mapaDiv).setView(posicao, 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; OpenStreetMap'
        }).addTo(mapaMotoboy);
        marcadorMotoboy = L.marker(posicao).addTo(mapaMotoboy).bindPopup('🛵 Motoboy');
    } else {
        marcadorMotoboy.setLatLng(posicao);
        mapaMotoboy.setView(posicao);
    }
}

async function ativarNotificacoes() {
    const btn = document.getElementById('ativarNotificacoesBtn');
    btn.disabled = true;
    btn.textContent = 'Ativando...';

    try {
        const token = await solicitarPermissaoNotificacao();
        if (!token) {
            showToast('Não foi possível ativar — verifique a permissão de notificações do navegador', 'error');
            btn.disabled = false;
            btn.textContent = '🔔 Ativar notificações desse pedido';
            return;
        }

        await salvarTokenNotificacaoPedido(pedidoAtualId, token);
        btn.textContent = '🔔 Notificações ativadas';
        showToast('Notificações ativadas! Você será avisado quando o status mudar.', 'success');
    } catch (error) {
        console.error('Erro ao ativar notificações:', error);
        showToast('Erro ao ativar notificações', 'error');
        btn.disabled = false;
        btn.textContent = '🔔 Ativar notificações desse pedido';
    }
}

function escaparHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}
