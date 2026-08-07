// ========== VARIÁVEIS GLOBAIS ==========
let pedidosTodos = [];
let unsubscribePedidos = null;
let motoboyLogado = null;
let abaAtiva = 'aberto'; // 'aberto' | 'rota' | 'concluidas'
let idsAbertoAnteriores = new Set(); // pra detectar pedido novo e dar o "pulse"
let minhaPosicaoAtual = null; // { lat, lng } — última posição conhecida do motoboy
let watchIdPosicao = null;
let mapaMini = null, marcadorMini = null;
let mapaFull = null, marcadorFull = null;

// Só pedidos delivery, que ainda não terminaram, aparecem pro motoboy
const STATUS_ABERTO = ['pendente', 'preparando'];

// ========== INICIALIZAR ==========
document.addEventListener('DOMContentLoaded', async () => {
    inicializarLoginForm();
    inicializarAbas();
    inicializarMapaExpandir();
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

        montarHeaderMotoboy(motoboy);
        inicializarStatusOnline(motoboy);
        iniciarGeolocalizacaoPropria();
        iniciarEscutaPedidos();
    });
}

function mostrarTelaLogin(mensagemErro) {
    if (unsubscribePedidos) {
        unsubscribePedidos();
        unsubscribePedidos = null;
    }
    if (watchIdPosicao !== null) {
        navigator.geolocation.clearWatch(watchIdPosicao);
        watchIdPosicao = null;
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

// ========== HEADER: AVATAR, NOME, STATUS ONLINE ==========
function montarHeaderMotoboy(motoboy) {
    const nome = motoboy.nome || 'Motoboy';
    document.getElementById('mbNome').textContent = nome;

    const iniciais = nome.trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase();
    document.getElementById('mbAvatar').textContent = iniciais || 'MB';
}

function inicializarStatusOnline(motoboy) {
    const btn = document.getElementById('mbStatusToggle');
    let online = motoboy.online !== false; // default: online

    const aplicarVisual = () => {
        btn.classList.toggle('online', online);
        document.getElementById('mbStatusTexto').textContent = online ? 'Online' : 'Offline';
    };
    aplicarVisual();

    btn.addEventListener('click', async () => {
        online = !online;
        aplicarVisual();
        try {
            await atualizarStatusOnlineMotoboy(motoboyLogado.uid, online);
        } catch (error) {
            console.error('Erro ao mudar status online:', error);
            online = !online; // desfaz visualmente se der erro
            aplicarVisual();
            showToast('Não foi possível atualizar seu status agora', 'error');
        }
    });
}

// ========== ABAS ==========
function inicializarAbas() {
    document.getElementById('tabAberto').addEventListener('click', () => mudarAba('aberto'));
    document.getElementById('tabRota').addEventListener('click', () => mudarAba('rota'));
    document.getElementById('tabConcluidas').addEventListener('click', () => mudarAba('concluidas'));
}

function mudarAba(aba) {
    abaAtiva = aba;
    document.getElementById('tabAberto').classList.toggle('active', aba === 'aberto');
    document.getElementById('tabRota').classList.toggle('active', aba === 'rota');
    document.getElementById('tabConcluidas').classList.toggle('active', aba === 'concluidas');

    document.getElementById('entregasList').style.display = aba === 'aberto' ? 'block' : 'none';
    document.getElementById('rotaList').style.display = aba === 'rota' ? 'block' : 'none';
    document.getElementById('historicoList').style.display = aba === 'concluidas' ? 'block' : 'none';

    if (aba === 'concluidas') renderizarHistorico();
}

// ========== ENTREGAS EM TEMPO REAL ==========
async function iniciarEscutaPedidos() {
    if (unsubscribePedidos) return; // já está escutando

    unsubscribePedidos = await observarTodosPedidos((pedidos) => {
        pedidosTodos = pedidos;
        renderizarResumo();
        renderizarEntregasAbertas();
        renderizarEntregasEmRota();
        if (abaAtiva === 'concluidas') renderizarHistorico();
    });
}

function paraData(timestamp) {
    if (!timestamp) return null;
    return typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
}

// ========== RESUMO / KPIs / GANHOS / RANKING ==========
function renderizarResumo() {
    if (!motoboyLogado) return;

    const minhas = pedidosTodos.filter(p => p.motoboyId === motoboyLogado.uid);
    const minhasEntregues = minhas.filter(p => p.status === 'entregue');

    const agora = new Date();
    const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const inicioSemana = new Date(inicioHoje);
    inicioSemana.setDate(inicioSemana.getDate() - inicioSemana.getDay()); // domingo desta semana

    const entreguesHoje = minhasEntregues.filter(p => {
        const d = paraData(p.entregueEm);
        return d && d >= inicioHoje;
    });
    const entreguesSemana = minhasEntregues.filter(p => {
        const d = paraData(p.entregueEm);
        return d && d >= inicioSemana;
    });

    const ganho = (p) => Number(p.taxaEntrega) || 0;
    const ganhoHoje = entreguesHoje.reduce((soma, p) => soma + ganho(p), 0);
    const ganhoSemana = entreguesSemana.reduce((soma, p) => soma + ganho(p), 0);
    const media = entreguesSemana.length > 0 ? ganhoSemana / entreguesSemana.length : 0;
    const emRota = minhas.filter(p => p.status === 'saiu_entrega').length;

    document.getElementById('kpiEmRota').textContent = emRota;
    document.getElementById('kpiHoje').textContent = entreguesHoje.length;
    document.getElementById('kpiGanhoSemana').textContent = formatarMoeda(ganhoSemana);
    document.getElementById('kpiMedia').textContent = formatarMoeda(media);
    document.getElementById('mbGanhoHojeHeader').textContent = formatarMoeda(ganhoHoje);

    document.getElementById('perfGanhoSemana').textContent = formatarMoeda(ganhoSemana);
    document.getElementById('perfMedia').textContent = formatarMoeda(media);
    document.getElementById('perfEntregasSemana').textContent = entreguesSemana.length;

    renderizarRanking(inicioSemana);
    renderizarGraficoSemanal(minhasEntregues, inicioHoje);
}

// Ranking simples: quem mais entregou (concluiu) essa semana, comparado com os outros
// motoboys — calculado a partir dos próprios pedidos (que o motoboy já pode listar),
// sem precisar de permissão extra pra ler o cadastro de outros motoboys.
function renderizarRanking(inicioSemana) {
    const porMotoboy = new Map(); // motoboyId -> { nome, total }

    pedidosTodos.forEach(p => {
        if (p.status !== 'entregue' || !p.motoboyId) return;
        const d = paraData(p.entregueEm);
        if (!d || d < inicioSemana) return;

        const atual = porMotoboy.get(p.motoboyId) || { nome: p.motoboyNome, total: 0 };
        atual.total += 1;
        porMotoboy.set(p.motoboyId, atual);
    });

    const ranking = [...porMotoboy.entries()]
        .sort((a, b) => b[1].total - a[1].total)
        .map(([uid], i) => ({ uid, posicao: i + 1 }));

    const minhaPosicao = ranking.find(r => r.uid === motoboyLogado.uid);
    document.getElementById('kpiRanking').textContent = minhaPosicao ? `#${minhaPosicao.posicao}` : '—';
}

// Gráfico de barras simples: ganho por dia nos últimos 7 dias
function renderizarGraficoSemanal(minhasEntregues, inicioHoje) {
    const dias = [];
    for (let i = 6; i >= 0; i--) {
        const dia = new Date(inicioHoje);
        dia.setDate(dia.getDate() - i);
        dias.push(dia);
    }

    const ganhosPorDia = dias.map(dia => {
        const fimDia = new Date(dia);
        fimDia.setDate(fimDia.getDate() + 1);
        const total = minhasEntregues
            .filter(p => {
                const d = paraData(p.entregueEm);
                return d && d >= dia && d < fimDia;
            })
            .reduce((soma, p) => soma + (Number(p.taxaEntrega) || 0), 0);
        return { dia, total };
    });

    const maior = Math.max(1, ...ganhosPorDia.map(g => g.total));
    const labelsDia = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

    document.getElementById('perfGrafico').innerHTML = ganhosPorDia.map(g => {
        const alturaPct = Math.max(4, Math.round((g.total / maior) * 100));
        return `
            <div class="mb-perf-bar-wrap" title="${formatarMoeda(g.total)}">
                <div class="mb-perf-bar" style="height:${alturaPct}%"></div>
                <span class="mb-perf-bar-dia">${labelsDia[g.dia.getDay()]}</span>
            </div>
        `;
    }).join('');
}

// ========== LISTA "EM ABERTO" (pendente/preparando) ==========
function renderizarEntregasAbertas() {
    const container = document.getElementById('entregasList');

    const abertas = pedidosTodos.filter(p =>
        p.tipoEntrega === 'delivery' && STATUS_ABERTO.includes(p.status || 'pendente')
    );

    document.getElementById('badgeAberto').textContent = abertas.length;

    const idsAtuais = new Set(abertas.map(p => p.id));
    const idsNovos = [...idsAtuais].filter(id => !idsAbertoAnteriores.has(id));
    if (idsAbertoAnteriores.size > 0 && idsNovos.length > 0) {
        showToast(idsNovos.length === 1 ? '📦 Nova entrega disponível!' : `📦 ${idsNovos.length} novas entregas disponíveis!`, 'info');
    }
    idsAbertoAnteriores = idsAtuais;

    if (abertas.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🎉</span>Nenhuma entrega em aberto no momento</div>';
        return;
    }

    container.innerHTML = abertas.map(pedido => montarCardEntrega(pedido, idsNovos.includes(pedido.id))).join('');
    ligarAcoesCards(container, abertas);
}

// ========== LISTA "EM ROTA" (saiu_entrega) ==========
function renderizarEntregasEmRota() {
    const container = document.getElementById('rotaList');

    const emRota = pedidosTodos.filter(p => p.tipoEntrega === 'delivery' && p.status === 'saiu_entrega');
    document.getElementById('badgeRota').textContent = emRota.length;

    if (emRota.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-state-icon">🛵</span>Nenhuma entrega em rota agora</div>';
        return;
    }

    container.innerHTML = emRota.map(pedido => montarCardEntrega(pedido, false)).join('');
    ligarAcoesCards(container, emRota);
}

// ========== LISTA "CONCLUÍDAS" (histórico deste motoboy) ==========
function renderizarHistorico() {
    const container = document.getElementById('historicoList');
    if (!motoboyLogado) return;

    const entregues = pedidosTodos
        .filter(p => p.status === 'entregue' && p.motoboyId === motoboyLogado.uid)
        .sort((a, b) => (paraData(b.entregueEm) || 0) - (paraData(a.entregueEm) || 0));

    if (entregues.length === 0) {
        container.innerHTML = '<div class="empty-state"><span class="empty-state-icon">📭</span>Você ainda não concluiu nenhuma entrega.</div>';
        return;
    }

    const grupos = new Map();
    entregues.forEach(pedido => {
        const data = paraData(pedido.entregueEm);
        const chave = data ? data.toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' }) : 'Data desconhecida';
        if (!grupos.has(chave)) grupos.set(chave, []);
        grupos.get(chave).push(pedido);
    });

    let html = '';
    grupos.forEach((pedidosDoDia, chaveData) => {
        const totalGanho = pedidosDoDia.reduce((soma, p) => soma + (Number(p.taxaEntrega) || 0), 0);
        html += `
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin: 18px 4px 8px;">
                <span style="font-size:12px; font-weight:800; color:#888; text-transform:uppercase;">${chaveData}</span>
                <span style="font-size:12px; color:#27AE60; font-weight:700;">+${formatarMoeda(totalGanho)}</span>
            </div>
        `;

        pedidosDoDia.forEach(pedido => {
            const hora = paraData(pedido.entregueEm);
            const horaTexto = hora ? hora.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '--:--';

            html += `
                <div class="entrega-card status-entregue">
                    <div class="entrega-header">
                        <span class="entrega-id">#${pedido.codigoPedido || pedido.id.substring(0, 8).toUpperCase()}</span>
                        <span class="entrega-status-badge">✅ ${horaTexto}</span>
                    </div>
                    <div class="entrega-cliente">${pedido.nome}</div>
                    <div class="entrega-endereco">${pedido.bairro ? `<strong>${pedido.bairro}</strong>` : ''} ${pedido.endereco || ''}</div>
                    <div class="entrega-meta-row" style="border-bottom:none; margin-bottom:0;">
                        <span class="entrega-itens-resumo">Total do pedido: ${formatarMoeda(pedido.total)}</span>
                        <span class="entrega-taxa-motoboy" style="font-size:15px;">+${formatarMoeda(pedido.taxaEntrega)}</span>
                    </div>
                </div>
            `;
        });
    });

    container.innerHTML = html;
}

// ========== CARD DE ENTREGA (usado nas abas Aberto e Em Rota) ==========
function montarCardEntrega(pedido, ehNovo) {
    const status = pedido.status || 'pendente';

    let itensResumo = '';
    if (Array.isArray(pedido.itens)) {
        itensResumo = pedido.itens.map(item => `${item.quantidade}x ${item.nome}`).join(', ');
    }

    const enderecoCompleto = [pedido.endereco, pedido.bairro].filter(Boolean).join(' — ') || 'Endereço não informado';

    let acoesHtml = '';
    if (status === 'pendente' || status === 'preparando') {
        acoesHtml = `
            <button type="button" class="btn btn-primary btn-iniciar" data-id="${pedido.id}">🚗 Iniciar Entrega</button>
            <button type="button" class="btn btn-rota" data-rota="${pedido.id}" title="Ver rota no mapa">🧭</button>
        `;
    } else if (status === 'saiu_entrega') {
        acoesHtml = `
            <button type="button" class="btn btn-primary btn-finalizar" data-id="${pedido.id}">✅ Finalizar Entrega</button>
            <button type="button" class="btn btn-rota" data-rota="${pedido.id}" title="Ver rota no mapa">🧭</button>
        `;
    }

    return `
        <div class="entrega-card status-${status} ${ehNovo ? 'nova-entrega' : ''}" id="card-${pedido.id}" data-endereco="${escaparAtributo(enderecoCompleto)}">
            <div class="entrega-header">
                <span class="entrega-id">#${pedido.codigoPedido || pedido.id.substring(0, 8).toUpperCase()}</span>
                <span class="entrega-status-badge">${getLabelStatus(status)}</span>
            </div>
            <div class="entrega-cliente">${pedido.nome}</div>
            <div class="entrega-endereco">🛵 ${enderecoCompleto}${pedido.telefone ? ` · 📞 ${pedido.telefone}` : ''}</div>
            <div class="entrega-meta-row">
                <span class="entrega-itens-resumo">${itensResumo}${pedido.observacoes ? ` · 💬 ${pedido.observacoes}` : ''}</span>
                <div>
                    <span class="entrega-valor-destaque">${formatarMoeda(pedido.total)}</span>
                    <span class="entrega-taxa-motoboy">+${formatarMoeda(pedido.taxaEntrega)} pra você</span>
                </div>
            </div>
            <div class="entrega-actions">${acoesHtml}</div>
        </div>
    `;
}

function escaparAtributo(str) {
    return String(str).replace(/"/g, '&quot;');
}

function ligarAcoesCards(container, pedidos) {
    container.querySelectorAll('.btn-iniciar').forEach(btn => {
        btn.addEventListener('click', () => {
            const pedido = pedidos.find(p => p.id === btn.dataset.id);
            if (pedido) marcarStatus(pedido, 'saiu_entrega');
        });
    });

    container.querySelectorAll('.btn-finalizar').forEach(btn => {
        btn.addEventListener('click', () => {
            const pedido = pedidos.find(p => p.id === btn.dataset.id);
            if (pedido) marcarStatus(pedido, 'entregue');
        });
    });

    container.querySelectorAll('[data-rota]').forEach(btn => {
        btn.addEventListener('click', () => {
            const card = document.getElementById(`card-${btn.dataset.rota}`);
            const endereco = card?.dataset.endereco;
            if (!endereco) {
                showToast('Endereço não informado pra esse pedido', 'error');
                return;
            }
            const url = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(endereco)}`;
            window.open(url, '_blank');
        });
    });
}

// Motoboy só pode mover pra 'saiu_entrega' ou 'entregue' — reforçado aqui e nas regras do Firestore
async function marcarStatus(pedido, novoStatus) {
    if (!['saiu_entrega', 'entregue'].includes(novoStatus)) return;

    // Abre a aba do WhatsApp já no clique (evento do usuário), pra não ser bloqueada
    const abaWhatsApp = window.open('', '_blank');

    try {
        const extra = novoStatus === 'saiu_entrega'
            ? { motoboyId: motoboyLogado.uid, motoboyNome: motoboyLogado.nome }
            : undefined;

        await updatePedidoStatus(pedido.id, novoStatus, extra);
        enviarAtualizacaoWhatsApp({ ...pedido, status: novoStatus }, novoStatus, abaWhatsApp);
        showToast(novoStatus === 'entregue' ? '🎉 Entrega concluída!' : 'Status atualizado!', 'success');
        // A lista se atualiza sozinha via onSnapshot
    } catch (error) {
        console.error('Erro ao atualizar status:', error);
        showToast('Erro ao atualizar status', 'error');
        abaWhatsApp?.close?.();
    }
}

// ========== GEOLOCALIZAÇÃO DO PRÓPRIO MOTOBOY ==========
// Um único watchPosition pro motoboy (não um por pedido) — atualiza o mini mapa sempre,
// e também envia a posição pros pedidos que ele está entregando agora.
function iniciarGeolocalizacaoPropria() {
    if (!('geolocation' in navigator)) return;

    watchIdPosicao = navigator.geolocation.watchPosition(
        (posicao) => {
            minhaPosicaoAtual = { lat: posicao.coords.latitude, lng: posicao.coords.longitude };
            atualizarMiniMapa(minhaPosicaoAtual);

            const minhasEmRota = pedidosTodos.filter(p => p.status === 'saiu_entrega' && p.motoboyId === motoboyLogado?.uid);
            minhasEmRota.forEach(pedido => {
                atualizarLocalizacaoPedido(pedido.id, minhaPosicaoAtual.lat, minhaPosicaoAtual.lng)
                    .catch(err => console.error('Erro ao enviar localização:', err));
            });
        },
        (erro) => {
            console.warn('GPS indisponível:', erro.message);
            if (erro.code === erro.PERMISSION_DENIED) {
                showToast('Ative a localização do navegador pra aparecer no mapa das entregas', 'error');
            }
        },
        { enableHighAccuracy: true, maximumAge: 15000, timeout: 20000 }
    );
}

function atualizarMiniMapa(posicao) {
    const card = document.getElementById('mbMapaCard');
    const div = document.getElementById('mbMiniMapa');
    if (!div) return;
    card.style.display = 'block';

    const pos = [posicao.lat, posicao.lng];
    if (!mapaMini) {
        mapaMini = L.map(div, { zoomControl: false, attributionControl: false, dragging: false, scrollWheelZoom: false }).setView(pos, 15);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(mapaMini);
        marcadorMini = L.marker(pos).addTo(mapaMini);
    } else {
        marcadorMini.setLatLng(pos);
        mapaMini.setView(pos);
    }

    if (mapaFull) {
        marcadorFull.setLatLng(pos);
    }
}

function inicializarMapaExpandir() {
    document.getElementById('mbMapaExpandirBtn')?.addEventListener('click', () => {
        document.getElementById('mbMapaModal').style.display = 'block';
        setTimeout(() => {
            if (!mapaFull && minhaPosicaoAtual) {
                const pos = [minhaPosicaoAtual.lat, minhaPosicaoAtual.lng];
                mapaFull = L.map('mbMapaFull').setView(pos, 16);
                L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                    attribution: '&copy; OpenStreetMap'
                }).addTo(mapaFull);
                marcadorFull = L.marker(pos).addTo(mapaFull);
            } else if (mapaFull) {
                mapaFull.invalidateSize();
            }
        }, 50);
    });

    document.getElementById('mbMapaFecharBtn')?.addEventListener('click', () => {
        document.getElementById('mbMapaModal').style.display = 'none';
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
