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
let tempoEntregaConfig = 30; // minutos — valor padrão até a config da loja carregar
let intervaloPrevisao = null; // recalcula "chega em X min" a cada minuto, sem esperar o Firestore

document.addEventListener('DOMContentLoaded', async () => {
    const params = new URLSearchParams(window.location.search);
    pedidoAtualId = params.get('id');

    if (!pedidoAtualId) {
        mostrarErro('Link inválido — não encontramos o código do pedido na URL.<br>Confira o link que você recebeu no WhatsApp.');
        return;
    }

    // Multi-tenant: o pedido vive dentro da subcoleção da loja, então precisa saber
    // qual loja é essa (pelo slug na URL) antes de conseguir buscar o pedido.
    const resultado = await inicializarLoja();
    if (resultado.erro) {
        mostrarErro('Link inválido — não encontramos a loja desse pedido.<br>Confira o link que você recebeu no WhatsApp.');
        return;
    }

    try {
        const config = await getSettings();
        if (config?.tempoEntrega) tempoEntregaConfig = config.tempoEntrega;
    } catch (error) {
        console.error('Erro ao carregar configurações da loja:', error);
    }

    observarPedido(pedidoAtualId, renderizarPedido);

    // A previsão ("chega em X min") é calculada a partir da hora atual, então precisa
    // recalcular sozinha de tempos em tempos — não dá pra esperar o pedido mudar no Firestore.
    intervaloPrevisao = setInterval(() => {
        if (window.pedidoAtualCache) atualizarTextoPrevisao(window.pedidoAtualCache);
    }, 30000);
});

function mostrarErro(mensagem) {
    document.getElementById('conteudoRastreio').innerHTML = `<div class="erro-box">${mensagem}</div>`;
}

function renderizarPedido(pedido) {
    const container = document.getElementById('conteudoRastreio');
    window.pedidoAtualCache = pedido;

    if (!pedido) {
        mostrarErro('Pedido não encontrado. Ele pode ter sido removido, ou o link está incorreto.');
        return;
    }

    const status = pedido.status || 'pendente';

    if (status === 'cancelado') {
        container.innerHTML = `
            <div class="rastreio-card">
                ${montarCabecalho(pedido)}
                <div class="status-cancelado-box">❌ Esse pedido foi cancelado.<br>Qualquer dúvida, chame a gente no WhatsApp.</div>
                ${montarDetalhesPedido(pedido)}
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
            ${montarCabecalho(pedido)}
            <div class="timeline">
                ${timelineHtml}
            </div>
            <div class="previsao-box" id="previsaoBox"></div>
            ${mostraMapa ? '<div id="mapaMotoboy"></div><p class="mapa-legenda">📍 Localização aproximada do motoboy, atualizada em tempo real.</p>' : ''}
            ${status === 'entregue' ? montarAvaliacao(pedido) : ''}
            ${montarDetalhesPedido(pedido)}
        </div>
    `;

    atualizarTextoPrevisao(pedido);
    if (mostraMapa) atualizarMapa(pedido.localizacaoAtual);
    // Só ativa o widget quando ainda não tem avaliação salva — se já tem, o HTML acima
    // já renderizou o estado "obrigado", sem botões pra ligar nada.
    if (status === 'entregue' && !pedido.avaliacao) ativarWidgetAvaliacao(pedido.id);
}

// ========== AVALIAÇÃO PÓS-ENTREGA ==========
// Só aparece quando o pedido chega em "entregue". Se o cliente já avaliou, mostra a nota
// enviada em vez do formulário de novo (a regra do Firestore também trava isso do lado do
// servidor — ver firestore.rules — então é só reflexo visual, não a única proteção).
function montarAvaliacao(pedido) {
    if (pedido.avaliacao) {
        const nota = pedido.avaliacao.nota || 0;
        const estrelasHtml = [1, 2, 3, 4, 5]
            .map(i => `<span class="avaliacao-estrela-display ${i <= nota ? 'preenchida' : ''}">★</span>`)
            .join('');
        return `
            <div class="rastreio-secao avaliacao-box">
                <div class="rastreio-secao-titulo">⭐ Sua avaliação</div>
                <div class="avaliacao-estrelas-linha">${estrelasHtml}</div>
                ${pedido.avaliacao.comentario ? `<div class="rastreio-obs">“${escaparHtml(pedido.avaliacao.comentario)}”</div>` : ''}
                <div class="avaliacao-obrigado">Obrigado pelo feedback! 💛</div>
            </div>`;
    }

    return `
        <div class="rastreio-secao avaliacao-box" id="avaliacaoBox">
            <div class="rastreio-secao-titulo">⭐ O que achou do seu pedido?</div>
            <div class="avaliacao-estrelas-linha" id="avaliacaoEstrelas">
                ${[1, 2, 3, 4, 5].map(i => `<button type="button" class="avaliacao-estrela-btn" data-nota="${i}" aria-label="${i} estrela${i > 1 ? 's' : ''}">★</button>`).join('')}
            </div>
            <textarea id="avaliacaoComentario" class="avaliacao-comentario" placeholder="Quer contar mais alguma coisa? (opcional)" maxlength="500"></textarea>
            <button type="button" class="btn btn-primary avaliacao-enviar-btn" id="avaliacaoEnviarBtn" disabled>Enviar avaliação</button>
        </div>`;
}

// Liga os cliques nas estrelas + o envio, depois que o HTML acima já está no DOM.
// Precisa ser chamado de novo a cada render (o container inteiro é recriado via
// innerHTML toda vez que o pedido muda no Firestore).
function ativarWidgetAvaliacao(pedidoId) {
    const estrelasContainer = document.getElementById('avaliacaoEstrelas');
    const enviarBtn = document.getElementById('avaliacaoEnviarBtn');
    if (!estrelasContainer || !enviarBtn) return;

    let notaEscolhida = 0;
    const botoes = Array.from(estrelasContainer.querySelectorAll('.avaliacao-estrela-btn'));

    const pintarEstrelas = (nota) => {
        botoes.forEach(btn => btn.classList.toggle('preenchida', Number(btn.dataset.nota) <= nota));
    };

    botoes.forEach(btn => {
        btn.addEventListener('click', () => {
            notaEscolhida = Number(btn.dataset.nota);
            pintarEstrelas(notaEscolhida);
            enviarBtn.disabled = false;
        });
    });

    enviarBtn.addEventListener('click', async () => {
        if (!notaEscolhida) return;
        enviarBtn.disabled = true;
        enviarBtn.textContent = 'Enviando...';
        const comentario = document.getElementById('avaliacaoComentario')?.value || '';
        try {
            await salvarAvaliacaoPedido(pedidoId, notaEscolhida, comentario);
            showToast('Obrigado pela avaliação!', 'success');
            // Não precisa trocar o HTML na mão aqui: observarPedido (onSnapshot) recebe a
            // confirmação do Firestore sozinho e renderizarPedido roda de novo, já mostrando
            // o estado "avaliação enviada".
        } catch (error) {
            console.error('Erro ao enviar avaliação:', error);
            showToast('Não foi possível enviar sua avaliação agora. Tente de novo.', 'error');
            enviarBtn.disabled = false;
            enviarBtn.textContent = 'Enviar avaliação';
        }
    });
}

function montarCabecalho(pedido) {
    return `
        <div class="rastreio-codigo">Pedido #${escaparHtml(pedido.codigoPedido || pedido.id)}</div>
        <div class="rastreio-titulo">Olá, ${escaparHtml(pedido.nome || '')}!</div>
    `;
}

// ========== PREVISÃO DE ENTREGA/RETIRADA ==========
// Baseada no horário em que o pedido foi feito + o tempo médio configurado no admin.
// Se já foi entregue, mostra o horário real de entrega em vez de uma previsão.
function atualizarTextoPrevisao(pedido) {
    const box = document.getElementById('previsaoBox');
    if (!box) return;

    const status = pedido.status || 'pendente';

    if (status === 'entregue' && pedido.entregueEm) {
        box.className = 'previsao-box previsao-concluida';
        box.innerHTML = `✅ Entregue às ${formatarHora(paraData(pedido.entregueEm))}`;
        return;
    }

    const criado = paraData(pedido.criadoEm);
    if (!criado) {
        box.innerHTML = '';
        return;
    }

    const previsao = new Date(criado.getTime() + tempoEntregaConfig * 60000);
    const minutosRestantes = Math.round((previsao - new Date()) / 60000);
    const acao = pedido.tipoEntrega === 'delivery' ? 'Chega' : 'Fica pronto pra retirada';

    let texto;
    if (minutosRestantes > 1) {
        texto = `${acao} em aproximadamente ${minutosRestantes} min`;
    } else if (minutosRestantes >= -10) {
        texto = `${acao} a qualquer momento`;
    } else {
        texto = `Já passou um pouco do previsto — deve estar quase lá!`;
    }

    box.className = 'previsao-box';
    box.innerHTML = `
        <span>⏱️ ${texto}</span>
        <span class="previsao-hora">Previsão: até ${formatarHora(previsao)}</span>
    `;
}

// paraData() agora vem de firebase-config.js (compartilhada com admin.js)

function formatarHora(data) {
    if (!data) return '--:--';
    return data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ========== DETALHES DO PEDIDO ==========
function montarDetalhesPedido(pedido) {
    return `
        <div class="rastreio-secao">
            <div class="rastreio-secao-titulo">📦 Itens do pedido</div>
            ${montarItensDetalhados(pedido)}
        </div>
        ${montarEndereco(pedido)}
        ${pedido.formaPagamento ? `
        <div class="rastreio-secao">
            <div class="rastreio-secao-titulo">💳 Pagamento</div>
            <div class="rastreio-endereco">${escaparHtml(rastreioFormatarPagamento(pedido.formaPagamento))}${pedido.formaPagamento === 'dinheiro' && pedido.trocoPara ? ` — troco para R$ ${Number(pedido.trocoPara).toFixed(2)}` : ''}</div>
        </div>` : ''}
        ${pedido.observacoes ? `
        <div class="rastreio-secao">
            <div class="rastreio-secao-titulo">📝 Observações do pedido</div>
            <div class="rastreio-obs">${escaparHtml(pedido.observacoes)}</div>
        </div>` : ''}
        <div class="rastreio-total-row">
            <span>Total</span>
            <strong>${formatarMoedaLocal(pedido.total)}</strong>
        </div>
    `;
}

function rastreioFormatarPagamento(metodo) {
    const labels = { pix: 'Pix', credito: 'Cartão de Crédito', debito: 'Cartão de Débito', dinheiro: 'Dinheiro' };
    return labels[metodo] || metodo;
}

function montarItensDetalhados(pedido) {
    if (!Array.isArray(pedido.itens) || pedido.itens.length === 0) {
        return '<p class="rastreio-vazio">Sem itens.</p>';
    }

    return `<div class="rastreio-itens-lista">${pedido.itens.map(item => {
        const extras = [];
        if (Array.isArray(item.sabores) && item.sabores.length > 0) {
            extras.push(`🍕 ${item.sabores.map(escaparHtml).join(' + ')}`);
        }
        if (Array.isArray(item.adicionais) && item.adicionais.length > 0) {
            extras.push(`➕ ${item.adicionais.map(a => escaparHtml(a.nome)).join(', ')}`);
        }
        if (item.observacoes) {
            extras.push(`💬 ${escaparHtml(item.observacoes)}`);
        }

        return `
            <div class="rastreio-item">
                <div class="rastreio-item-linha">
                    <span class="rastreio-item-qtd">${item.quantidade}x</span>
                    <span class="rastreio-item-nome">${escaparHtml(item.nome)}</span>
                    <span class="rastreio-item-preco">${formatarMoedaLocal((item.preco || 0) * (item.quantidade || 1))}</span>
                </div>
                ${extras.length ? `<div class="rastreio-item-extras">${extras.join(' · ')}</div>` : ''}
            </div>
        `;
    }).join('')}</div>`;
}

function montarEndereco(pedido) {
    if (pedido.tipoEntrega !== 'delivery') {
        return `
            <div class="rastreio-secao">
                <div class="rastreio-secao-titulo">🏠 Retirada no balcão</div>
                <div class="rastreio-endereco">Retire seu pedido diretamente na loja.</div>
            </div>
        `;
    }

    const partes = [pedido.endereco, pedido.bairro].filter(Boolean).map(escaparHtml).join(' — ');
    return `
        <div class="rastreio-secao">
            <div class="rastreio-secao-titulo">🛵 Endereço de entrega</div>
            <div class="rastreio-endereco">${partes || 'Endereço não informado'}</div>
        </div>
    `;
}

function formatarMoedaLocal(valor) {
    return `R$ ${(Number(valor) || 0).toFixed(2).replace('.', ',')}`;
}

// ========== MAPA DO MOTOBOY ==========
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

// ========== UTILITÁRIOS ==========
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
