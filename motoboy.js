// ========== VARIÁVEIS GLOBAIS ==========
let pedidosTodos = [];
let unsubscribePedidos = null;
let motoboyLogado = null;
let abaAtiva = 'aberto'; // 'aberto' | 'historico'

// Só pedidos delivery, que ainda não terminaram, aparecem pro motoboy
const STATUS_VISIVEIS_MOTOBOY = ['pendente', 'preparando', 'saiu_entrega'];

// Controla os watchers de GPS ativos (um por pedido "saiu_entrega" em aberto)
const watchersLocalizacao = new Map(); // pedidoId -> watchId do navigator.geolocation

// ========== INICIALIZAR ==========
document.addEventListener('DOMContentLoaded', async () => {
    inicializarLoginForm();
    inicializarAbas();
    await carregarNomeLoja();
    await verificarAutenticacaoMotoboy();
});

async function carregarNomeLoja() {
    try {
        const config = await getSettings();
        if (config?.nome) nomeLojaAtual = config.nome;
    } catch (error) {
        console.error('Erro ao carregar nome da loja:', error);
    }
}

// ========== AUTENTICAÇÃO ==========
async function verificarAutenticacaoMotoboy() {
    const { auth } = await getFirebase();

    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            mostrarTelaLogin();
            return;
        }

        const motoboy = await getMotoboyByUid(user.uid);

        if (!motoboy || motoboy.ativo === false) {
            // Não é motoboy cadastrado, ou foi desativado: desloga e barra o acesso
            await auth.signOut();
            mostrarTelaLogin('Este acesso não está autorizado como motoboy, ou foi desativado.');
            return;
        }

        motoboyLogado = motoboy;
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('motoboyPage').style.display = 'block';
        document.getElementById('userInfo').textContent = `${motoboy.nome} (${motoboy.email})`;

        iniciarEscutaPedidos();
    });
}

function mostrarTelaLogin(mensagemErro) {
    if (unsubscribePedidos) {
        unsubscribePedidos();
        unsubscribePedidos = null;
    }
    document.getElementById('motoboyPage').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';

    const errorBox = document.getElementById('loginError');
    if (mensagemErro) {
        errorBox.textContent = mensagemErro;
        errorBox.style.display = 'block';
    }
}

function inicializarLoginForm() {
    const loginForm = document.getElementById('loginForm');
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('loginEmail').value.trim();
        const senha = document.getElementById('loginPassword').value;
        const errorBox = document.getElementById('loginError');
        const submitBtn = document.getElementById('loginSubmitBtn');

        errorBox.style.display = 'none';
        submitBtn.disabled = true;
        submitBtn.textContent = 'Entrando...';

        try {
            await loginComEmailSenha(email, senha);
            // onAuthStateChanged cuida do resto (inclusive checar se é motoboy autorizado)
        } catch (error) {
            errorBox.textContent = 'E-mail ou senha inválidos.';
            errorBox.style.display = 'block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Entrar';
        }
    });
}

document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try {
        await logoutAdmin(); // mesmo signOut() usado no admin, serve pra qualquer conta
    } catch (error) {
        console.error('Erro ao sair:', error);
    }
});

// ========== ABAS (Em Aberto / Histórico) ==========
function inicializarAbas() {
    document.getElementById('tabAberto').addEventListener('click', () => mudarAba('aberto'));
    document.getElementById('tabHistorico').addEventListener('click', () => mudarAba('historico'));
}

function mudarAba(aba) {
    abaAtiva = aba;
    document.getElementById('tabAberto').classList.toggle('active', aba === 'aberto');
    document.getElementById('tabHistorico').classList.toggle('active', aba === 'historico');
    document.getElementById('entregasList').style.display = aba === 'aberto' ? 'block' : 'none';
    document.getElementById('historicoList').style.display = aba === 'historico' ? 'block' : 'none';
    if (aba === 'historico') renderizarHistorico();
}

// ========== ENTREGAS EM TEMPO REAL ==========
async function iniciarEscutaPedidos() {
    if (unsubscribePedidos) return; // já está escutando

    unsubscribePedidos = await observarTodosPedidos((pedidos) => {
        pedidosTodos = pedidos;
        renderizarResumo();
        renderizarEntregas();
        if (abaAtiva === 'historico') renderizarHistorico();
    });
}

// ========== RESUMO NO TOPO ==========
function renderizarResumo() {
    if (!motoboyLogado) return;

    const minhas = pedidosTodos.filter(p => p.motoboyId === motoboyLogado.uid);

    const emRota = minhas.filter(p => p.status === 'saiu_entrega').length;

    const hoje = new Date();
    const inicioHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const entreguesHoje = minhas.filter(p => {
        if (p.status !== 'entregue') return false;
        const data = paraData(p.entregueEm);
        return data && data >= inicioHoje;
    }).length;

    const totalEntregues = minhas.filter(p => p.status === 'entregue').length;

    document.getElementById('resumoEmRota').textContent = emRota;
    document.getElementById('resumoHoje').textContent = entreguesHoje;
    document.getElementById('resumoTotal').textContent = totalEntregues;
}

function paraData(timestamp) {
    if (!timestamp) return null;
    return typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
}

// ========== LISTA "EM ABERTO" ==========
function renderizarEntregas() {
    const container = document.getElementById('entregasList');

    const entregas = pedidosTodos.filter(p =>
        p.tipoEntrega === 'delivery' &&
        STATUS_VISIVEIS_MOTOBOY.includes(p.status || 'pendente')
    );

    document.getElementById('badgeAberto').textContent = entregas.length;

    // Liga/desliga o GPS conforme cada pedido entra ou sai do status "saiu_entrega"
    sincronizarWatchersLocalizacao(entregas);

    if (entregas.length === 0) {
        container.innerHTML = '<div class="empty-state">Nenhuma entrega em aberto no momento 🎉</div>';
        return;
    }

    container.innerHTML = '';

    entregas.forEach(pedido => {
        const status = pedido.status || 'pendente';

        let itensHtml = '';
        if (Array.isArray(pedido.itens)) {
            itensHtml = pedido.itens.map(item => `${item.quantidade}x ${item.nome}`).join(', ');
        }

        const card = document.createElement('div');
        card.className = `entrega-card status-${status}`;
        card.innerHTML = `
            <div class="entrega-header">
                <span class="entrega-id">#${pedido.codigoPedido || pedido.id.substring(0, 8).toUpperCase()}</span>
                <span class="entrega-status">${getLabelStatus(status)}</span>
            </div>
            <div class="entrega-detalhes">
                <strong>Cliente:</strong> ${pedido.nome}<br>
                <strong>Telefone:</strong> ${pedido.telefone}<br>
                ${pedido.bairro ? `<strong>Bairro:</strong> ${pedido.bairro}<br>` : ''}
                ${pedido.endereco ? `<strong>Endereço:</strong> ${pedido.endereco}<br>` : ''}
                <strong>Itens:</strong> ${itensHtml}<br>
                <strong>Total:</strong> <span class="entrega-valor">${formatarMoeda(pedido.total)}</span>
                ${pedido.observacoes ? `<br><strong>Obs:</strong> ${pedido.observacoes}` : ''}
                ${pedido.motoboyNome && status === 'saiu_entrega' ? `<br><strong>Com:</strong> ${pedido.motoboyNome}` : ''}
            </div>
            <div class="entrega-actions" id="acoes-${pedido.id}"></div>
        `;

        const acoesContainer = card.querySelector(`#acoes-${pedido.id}`);

        if (status === 'pendente' || status === 'preparando') {
            const btnSaiu = document.createElement('button');
            btnSaiu.className = 'btn btn-primary';
            btnSaiu.textContent = '🚗 Saiu para Entrega';
            btnSaiu.addEventListener('click', () => marcarStatus(pedido, 'saiu_entrega'));
            acoesContainer.appendChild(btnSaiu);
        }

        if (status === 'saiu_entrega') {
            const btnEntregue = document.createElement('button');
            btnEntregue.className = 'btn btn-primary';
            btnEntregue.textContent = '✅ Entregue';
            btnEntregue.addEventListener('click', () => marcarStatus(pedido, 'entregue'));
            acoesContainer.appendChild(btnEntregue);
        }

        container.appendChild(card);
    });
}

// ========== LISTA "HISTÓRICO" ==========
// Mostra as entregas que ESTE motoboy já concluiu, agrupadas por dia (mais recente primeiro).
function renderizarHistorico() {
    const container = document.getElementById('historicoList');
    if (!motoboyLogado) return;

    const entregues = pedidosTodos
        .filter(p => p.status === 'entregue' && p.motoboyId === motoboyLogado.uid)
        .sort((a, b) => (paraData(b.entregueEm) || 0) - (paraData(a.entregueEm) || 0));

    if (entregues.length === 0) {
        container.innerHTML = '<div class="empty-state">Você ainda não concluiu nenhuma entrega.</div>';
        return;
    }

    // Agrupa por dia (formato "6 de agosto de 2026") pra ficar mais fácil de ler
    const grupos = new Map();
    entregues.forEach(pedido => {
        const data = paraData(pedido.entregueEm);
        const chave = data ? data.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Data desconhecida';
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push(pedido);
    });

    let html = '';
    grupos.forEach((pedidosDoDia, chaveData) => {
        const totalDoDia = pedidosDoDia.reduce((soma, p) => soma + (p.total || 0), 0);
        html += `
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin: 18px 0 8px;">
                <span style="font-size:13px; font-weight:700; color:#888; text-transform:uppercase;">${chaveData}</span>
                <span style="font-size:12px; color:#888;">${pedidosDoDia.length} entrega(s) · ${formatarMoeda(totalDoDia)}</span>
            </div>
        `;

        pedidosDoDia.forEach(pedido => {
            const hora = paraData(pedido.entregueEm);
            const horaTexto = hora ? hora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';

            html += `
                <div class="entrega-card status-entregue">
                    <div class="entrega-header">
                        <span class="entrega-id">#${pedido.codigoPedido || pedido.id.substring(0, 8).toUpperCase()}</span>
                        <span class="entrega-status">✅ Entregue às ${horaTexto}</span>
                    </div>
                    <div class="entrega-detalhes">
                        <strong>Cliente:</strong> ${pedido.nome}<br>
                        ${pedido.bairro ? `<strong>Bairro:</strong> ${pedido.bairro}<br>` : ''}
                        <strong>Total:</strong> <span class="entrega-valor">${formatarMoeda(pedido.total)}</span>
                    </div>
                </div>
            `;
        });
    });

    container.innerHTML = html;
}

// Motoboy só pode mover pra 'saiu_entrega' ou 'entregue' — reforçado aqui e nas regras do Firestore
async function marcarStatus(pedido, novoStatus) {
    if (!['saiu_entrega', 'entregue'].includes(novoStatus)) return;

    // Abre a aba do WhatsApp já no clique (evento do usuário), pra não ser bloqueada
    const abaWhatsApp = window.open('', '_blank');

    try {
        // Ao pegar a entrega, registra qual motoboy é — usado no resumo e no histórico
        const extra = novoStatus === 'saiu_entrega'
            ? { motoboyId: motoboyLogado.uid, motoboyNome: motoboyLogado.nome }
            : undefined;

        await updatePedidoStatus(pedido.id, novoStatus, extra);
        enviarAtualizacaoWhatsApp({ ...pedido, status: novoStatus }, novoStatus, abaWhatsApp);
        showToast('Status atualizado!', 'success');
        // A lista se atualiza sozinha via onSnapshot
    } catch (error) {
        console.error('Erro ao atualizar status:', error);
        showToast('Erro ao atualizar status', 'error');
        abaWhatsApp?.close?.();
    }
}

// ========== GPS EM TEMPO REAL ==========
// Liga o watchPosition pra todo pedido que está "saiu_entrega" e ainda não tem um watcher
// ativo, e desliga o watcher de qualquer pedido que não está mais nesse status (entregue,
// cancelado, ou voltou pra lista de pendentes por algum motivo).
function sincronizarWatchersLocalizacao(entregas) {
    if (!('geolocation' in navigator)) return;

    const idsEmRota = new Set(entregas.filter(p => (p.status || 'pendente') === 'saiu_entrega').map(p => p.id));

    // Desliga watchers de pedidos que não estão mais em rota
    for (const [pedidoId, watchId] of watchersLocalizacao.entries()) {
        if (!idsEmRota.has(pedidoId)) {
            navigator.geolocation.clearWatch(watchId);
            watchersLocalizacao.delete(pedidoId);
        }
    }

    // Liga watchers novos
    idsEmRota.forEach(pedidoId => {
        if (watchersLocalizacao.has(pedidoId)) return; // já está rastreando esse

        const watchId = navigator.geolocation.watchPosition(
            (posicao) => {
                atualizarLocalizacaoPedido(pedidoId, posicao.coords.latitude, posicao.coords.longitude)
                    .catch(err => console.error('Erro ao enviar localização:', err));
            },
            (erro) => {
                console.warn('GPS indisponível para o pedido', pedidoId, erro.message);
                if (erro.code === erro.PERMISSION_DENIED) {
                    showToast('Ative a localização do navegador pra que o cliente veja você no mapa', 'error');
                }
            },
            { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
        );

        watchersLocalizacao.set(pedidoId, watchId);
    });
}

// ========== UTILITÁRIOS ==========
function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;

    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}
