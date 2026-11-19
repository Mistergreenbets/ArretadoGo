// ========== SUPER ADMIN (gestão das lojas da plataforma) ==========

const PLANOS_INFO = {
    basico:        { nome: 'Básico',        preco: 'R$ 39,90', resumo: 'até 30 produtos · 1 motoboy · sem cupons' },
    intermediario: { nome: 'Intermediário',  preco: 'R$ 59,90', resumo: 'produtos ilimitados · até 3 motoboys · cupons' },
    premium:       { nome: 'Premium',        preco: 'R$ 79,90', resumo: 'tudo ilimitado · cupons · relatórios' }
};

let todasAsLojas = [];
let bannersHub = [];

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('loginFormSA').addEventListener('submit', fazerLoginSA);
    document.getElementById('logoutSABtn').addEventListener('click', fazerLogoutSA);
    document.getElementById('novaLojaForm').addEventListener('submit', criarNovaLoja);
    document.getElementById('editarLojaForm').addEventListener('submit', salvarEdicaoLoja);
    document.getElementById('cancelarEdicaoBtn').addEventListener('click', fecharModalEdicao);
    document.getElementById('atualizarBtn').addEventListener('click', () => carregarLojas());
    document.getElementById('novoBannerForm').addEventListener('submit', adicionarBannerHub);

    // Busca: o campo da topbar e o campo da lista de lojas ficam sincronizados —
    // digitar em qualquer um dos dois filtra a mesma lista.
    document.getElementById('buscaLojas').addEventListener('input', (e) => {
        document.getElementById('buscaLojasTopo').value = e.target.value;
        renderizarListaLojas(e.target.value);
    });
    document.getElementById('buscaLojasTopo').addEventListener('input', (e) => {
        document.getElementById('buscaLojas').value = e.target.value;
        renderizarListaLojas(e.target.value);
        document.getElementById('secaoLojas').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    // Modal "nova loja" — três gatilhos possíveis (sidebar, botão do topo, e o próprio
    // atalho do menu), todos abrem o mesmo modal.
    ['abrirNovaLojaBtn', 'abrirNovaLojaBtnTopo'].forEach(id => {
        document.getElementById(id).addEventListener('click', abrirModalNovaLoja);
    });
    document.getElementById('cancelarNovaLojaBtn').addEventListener('click', fecharModalNovaLoja);

    // Sidebar em tela pequena: abre/fecha como off-canvas com fundo escurecido
    document.getElementById('hamburgerBtn').addEventListener('click', () => {
        document.getElementById('sidebar').classList.add('aberta');
        document.getElementById('sidebarBackdrop').classList.add('aberta');
    });
    document.getElementById('sidebarBackdrop').addEventListener('click', fecharSidebar);
    document.querySelectorAll('.sa-nav-item[href]').forEach(link => {
        link.addEventListener('click', fecharSidebar);
    });

    await verificarAutenticacaoSA();

    // Recalcula (sem bater no Firestore de novo) o texto de "X dia(s)/h/min
    // restante(s)" a cada minuto, usando o que já está em memória (todasAsLojas).
    // Antes esse texto só era recalculado quando a página recarregava ou alguma
    // ação disparava carregarLojas() — por isso parecia "não atualizar": ficava
    // parado com o valor do momento em que a página abriu, mesmo com o tempo
    // passando de verdade.
    setInterval(() => {
        if (document.getElementById('painelSA').style.display === 'none') return;
        if (todasAsLojas.length === 0) return;
        montarStats(todasAsLojas);
        montarAvisos(todasAsLojas);
        montarTabelaRecentes(todasAsLojas);
        renderizarListaLojas(document.getElementById('buscaLojas').value);
    }, 60000);
});

function fecharSidebar() {
    document.getElementById('sidebar').classList.remove('aberta');
    document.getElementById('sidebarBackdrop').classList.remove('aberta');
}

async function verificarAutenticacaoSA() {
    const { auth, db } = await getFirebase();

    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            mostrarLoginSA();
            return;
        }

        // Essa checagem é a causa mais comum de "loga e sai sozinho em segundos":
        // se o Firestore não responder (App Check bloqueando o domínio atual, ou
        // regra negando por outro motivo), o .get() abaixo REJEITA — sem o
        // try/catch, essa rejeição ficava sem tratamento nenhum e o painel nunca
        // chegava a aparecer, dando a impressão de "login que não pega". Agora
        // diferenciamos os dois casos: "não é super-admin" (esperado, desloga) vs
        // "erro ao checar" (bug/config — NÃO desloga, mostra o motivo real).
        let doc;
        try {
            doc = await comTimeout(
                db.collection('superadmins').doc(user.uid).get(),
                15000,
                'Demorou demais pra confirmar seu acesso de super-admin. Verifique sua conexão ' +
                'e o App Check (Firebase Console → App Check) — veja o console (F12) para mais detalhes.'
            );
        } catch (error) {
            console.error('Erro ao checar permissão de super-admin:', error);
            // NÃO desloga aqui: se deslogarmos toda vez que a checagem falha, quem
            // realmente é super-admin fica preso num loop de "loga → erro → desloga"
            // sem nunca conseguir ver o motivo real do problema.
            mostrarLoginSA(traduzirErroFirebase(error) ||
                'Não foi possível confirmar seu acesso agora. Tente de novo em instantes.');
            return;
        }

        if (!doc.exists) {
            await auth.signOut();
            mostrarLoginSA('Este acesso não é autorizado como super-admin. Peça pra alguém já ' +
                'cadastrado te adicionar em Firebase Console → Firestore → superadmins.');
            return;
        }

        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('painelSA').style.display = 'block';

        const inicial = (user.email || 'S').charAt(0).toUpperCase();
        document.getElementById('sidebarAvatar').textContent = inicial;
        document.getElementById('topbarAvatar').textContent = inicial;
        document.getElementById('sidebarUserEmail').textContent = user.email || 'super-admin';
        document.getElementById('topbarUserEmail').textContent = user.email || 'super-admin';

        await carregarLojas();
        await carregarBannersHub();
    });
}

function mostrarLoginSA(mensagemErro) {
    document.getElementById('painelSA').style.display = 'none';
    document.getElementById('loginScreen').style.display = 'flex';
    const erroBox = document.getElementById('saLoginErro');
    if (mensagemErro) {
        erroBox.textContent = mensagemErro;
        erroBox.style.display = 'block';
    } else {
        erroBox.style.display = 'none';
    }
}

async function fazerLoginSA(e) {
    e.preventDefault();
    const email = document.getElementById('saEmail').value.trim();
    const senha = document.getElementById('saSenha').value;
    const erroBox = document.getElementById('saLoginErro');
    erroBox.style.display = 'none';

    try {
        await loginComEmailSenha(email, senha);
        // onAuthStateChanged cuida do resto
    } catch (error) {
        console.error('Erro no login SA:', error);
        erroBox.textContent = 'E-mail ou senha inválidos. (código: ' + (error?.code || error?.message || 'desconhecido') + ')';
        erroBox.style.display = 'block';
    }
}

async function fazerLogoutSA() {
    const { auth } = await getFirebase();
    await auth.signOut();
}

function abrirModalNovaLoja() {
    fecharSidebar();
    document.getElementById('modalNovaLoja').style.display = 'flex';
    document.getElementById('novaLojaSlug').focus();
}

function fecharModalNovaLoja() {
    document.getElementById('modalNovaLoja').style.display = 'none';
}

// ========== ESTATÍSTICAS ==========

function montarStats(lojas) {
    const ativas = lojas.filter(l => lojaEstaAtiva(l));
    const emTrial = ativas.filter(l => l.statusPagamento === 'trial');
    const vencidas = lojas.filter(l => !lojaEstaAtiva(l));

    const stats = [
        { valor: lojas.length, rotulo: 'Total de lojas', sub: 'desde o início', icone: '🏬', cor: 'gold' },
        { valor: ativas.length, rotulo: 'Ativas', sub: `${lojas.length ? Math.round(ativas.length / lojas.length * 100) : 0}% do total`, icone: '✅', cor: 'green' },
        { valor: emTrial.length, rotulo: 'Em teste grátis', sub: 'ainda não pagaram', icone: '⏳', cor: 'dark' },
        { valor: vencidas.length, rotulo: 'Vencidas / suspensas', sub: 'precisam de atenção', icone: '⚠️', cor: 'red' }
    ];

    document.getElementById('statsGrid').innerHTML = stats.map(s => `
        <div class="sa-kpi ${s.cor}">
            <div class="sa-kpi-icon">${s.icone}</div>
            <div class="sa-kpi-rotulo">${s.rotulo}</div>
            <div class="sa-kpi-valor">${s.valor}</div>
            <div class="sa-kpi-sub">${s.sub}</div>
        </div>
    `).join('');
}

// ========== MINI STATS + GRÁFICO DE NOVAS LOJAS ==========

const PLANOS_PRECO_NUM = { basico: 39.90, intermediario: 59.90, premium: 79.90 };

function montarMiniStats(lojas) {
    const ativas = lojas.filter(l => lojaEstaAtiva(l));
    const receitaMensal = ativas.reduce((soma, l) => soma + (PLANOS_PRECO_NUM[l.plano] || 0), 0);

    const seteDiasAtras = new Date(Date.now() - 7 * 86400000);
    const novasEssaSemana = lojas.filter(l => {
        const data = l.criadoEm ? paraData(l.criadoEm) : null;
        return data && data >= seteDiasAtras;
    }).length;

    const ticketMedio = ativas.length ? receitaMensal / ativas.length : 0;

    const minis = [
        { rotulo: 'Receita mensal (lojas ativas)', valor: `R$ ${receitaMensal.toFixed(2).replace('.', ',')}` },
        { rotulo: 'Novas essa semana', valor: novasEssaSemana },
        { rotulo: 'Ticket médio', valor: `R$ ${ticketMedio.toFixed(2).replace('.', ',')}` }
    ];

    document.getElementById('miniStatsGrid').innerHTML = minis.map(m => `
        <div class="sa-mini">
            <div class="sa-mini-rotulo">${m.rotulo}</div>
            <div class="sa-mini-valor">${m.valor}</div>
        </div>
    `).join('');
}

// Gráfico de área/linha em SVG puro (sem biblioteca externa) mostrando quantas lojas
// novas entraram por dia nos últimos 14 dias — mesma ideia visual do gráfico de
// referência (linha + área), só que alimentado com dado real da plataforma.
function montarGraficoNovasLojas(lojas) {
    const dias = 14;
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const contagem = new Array(dias).fill(0);

    lojas.forEach(l => {
        const data = l.criadoEm ? paraData(l.criadoEm) : null;
        if (!data) return;
        const d = new Date(data); d.setHours(0, 0, 0, 0);
        const diff = Math.round((hoje - d) / 86400000);
        if (diff >= 0 && diff < dias) contagem[dias - 1 - diff]++;
    });

    const largura = 560, altura = 160, pad = 8;
    const max = Math.max(1, ...contagem);
    const passoX = (largura - pad * 2) / (dias - 1);
    const pontos = contagem.map((v, i) => {
        const x = pad + i * passoX;
        const y = altura - pad - (v / max) * (altura - pad * 2 - 20);
        return [x, y];
    });

    const linha = pontos.map((p, i) => (i === 0 ? 'M' : 'L') + p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
    const area = linha + ` L${pontos[pontos.length - 1][0].toFixed(1)},${altura - pad} L${pontos[0][0].toFixed(1)},${altura - pad} Z`;

    const wrap = document.getElementById('graficoNovasLojas');
    if (contagem.every(v => v === 0)) {
        wrap.innerHTML = '<p class="sa-vazio" style="padding:24px 0;">Nenhum cadastro nos últimos 14 dias.</p>';
        return;
    }

    wrap.innerHTML = `
        <svg viewBox="0 0 ${largura} ${altura}" preserveAspectRatio="none">
            <defs>
                <linearGradient id="saAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stop-color="#C20000" stop-opacity="0.25"/>
                    <stop offset="100%" stop-color="#C20000" stop-opacity="0"/>
                </linearGradient>
            </defs>
            <path d="${area}" fill="url(#saAreaGrad)" />
            <path d="${linha}" fill="none" stroke="#E6A800" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
            ${pontos.map(p => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="#E6A800" />`).join('')}
        </svg>
    `;
}

// ========== AVISOS ==========

function montarAvisos(lojas) {
    const avisos = [];

    lojas.filter(l => !lojaEstaAtiva(l)).forEach(l => {
        avisos.push({ tipo: 'critico', icone: '⛔', titulo: l.nome || l.id, texto: 'Vencida ou suspensa — sem acesso liberado.' });
    });

    lojas.forEach(l => {
        if (l.statusPagamento !== 'trial' || !l.trialFim || !lojaEstaAtiva(l)) return;
        const dias = Math.ceil((paraData(l.trialFim) - new Date()) / 86400000);
        if (dias <= 2) {
            const { texto } = situacaoLoja(l);
            avisos.push({ tipo: 'atencao', icone: '⏳', titulo: l.nome || l.id, texto: `${texto} — confirme o pagamento.` });
        }
    });

    const lista = document.getElementById('listaAvisos');
    const badge = document.getElementById('badgeAvisos');

    if (avisos.length === 0) {
        lista.innerHTML = '<p class="sa-vazio" style="padding:12px 0;">Tudo certo por aqui — nenhum aviso no momento.</p>';
        badge.style.display = 'none';
        return;
    }

    badge.textContent = avisos.length > 9 ? '9+' : avisos.length;
    badge.style.display = 'flex';

    lista.innerHTML = avisos.slice(0, 6).map(a => `
        <div class="sa-aviso ${a.tipo}">
            <span class="sa-aviso-icone">${a.icone}</span>
            <div><b>${escaparHtmlSA(a.titulo)}</b>${escaparHtmlSA(a.texto)}</div>
        </div>
    `).join('');
}

// ========== TABELA DE LOJAS RECENTES ==========

function montarTabelaRecentes(lojas) {
    const recentes = [...lojas]
        .filter(l => l.criadoEm)
        .sort((a, b) => paraData(b.criadoEm) - paraData(a.criadoEm))
        .slice(0, 6);

    const tbody = document.querySelector('#tabelaRecentes tbody');
    if (recentes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="sa-vazio">Nenhuma loja cadastrada ainda.</td></tr>';
        return;
    }

    tbody.innerHTML = recentes.map(l => {
        const { texto, vencido } = situacaoLoja(l);
        const info = PLANOS_INFO[l.plano] || { nome: l.plano || '—' };
        const data = paraData(l.criadoEm);
        return `
            <tr>
                <td><b>${escaparHtmlSA(l.nome || l.id)}</b></td>
                <td>${escaparHtmlSA(info.nome)}</td>
                <td><span class="sa-mini-badge" style="background:${vencido ? 'var(--sa-red-bg)' : 'var(--sa-green-bg)'}; color:${vencido ? 'var(--sa-red)' : 'var(--sa-green)'};">${escaparHtmlSA(texto)}</span></td>
                <td>${data ? data.toLocaleDateString('pt-BR') : '—'}</td>
            </tr>
        `;
    }).join('');
}

// ========== LISTAR / CRIAR LOJAS ==========

async function carregarLojas() {
    const lista = document.getElementById('listaLojas');
    lista.innerHTML = '<p class="sa-vazio">Carregando...</p>';

    try {
        todasAsLojas = await listarLojas();
        montarStats(todasAsLojas);
        montarMiniStats(todasAsLojas);
        montarGraficoNovasLojas(todasAsLojas);
        montarAvisos(todasAsLojas);
        montarTabelaRecentes(todasAsLojas);
        renderizarListaLojas(document.getElementById('buscaLojas').value);
    } catch (error) {
        console.error('Erro ao carregar lojas:', error);
        lista.innerHTML = '<p class="sa-vazio">Erro ao carregar lojas. Confira sua conexão e permissões (App Check / superadmins).</p>';
    }
}

// Filtra a lista já carregada em memória — não bate no Firestore de novo a cada letra digitada.
function renderizarListaLojas(termo) {
    const lista = document.getElementById('listaLojas');
    const busca = (termo || '').trim().toLowerCase();
    const filtradas = !busca ? todasAsLojas : todasAsLojas.filter(loja =>
        (loja.nome || '').toLowerCase().includes(busca) ||
        (loja.id || '').toLowerCase().includes(busca) ||
        (loja.emailAdmin || '').toLowerCase().includes(busca)
    );

    if (todasAsLojas.length === 0) {
        lista.innerHTML = '<p class="sa-vazio">Nenhuma loja cadastrada ainda.</p>';
        return;
    }
    if (filtradas.length === 0) {
        lista.innerHTML = '<p class="sa-vazio">Nenhuma loja encontrada pra essa busca.</p>';
        return;
    }

    lista.innerHTML = filtradas.map(loja => montarCardLoja(loja)).join('');

    lista.querySelectorAll('[data-confirmar]').forEach(btn => {
        btn.addEventListener('click', () => confirmarPagamento(btn));
    });
    lista.querySelectorAll('[data-toggle-ativo]').forEach(btn => {
        btn.addEventListener('click', () => alternarStatusLoja(btn));
    });
    lista.querySelectorAll('[data-editar]').forEach(btn => {
        btn.addEventListener('click', () => abrirModalEdicao(btn.dataset.editar));
    });
    lista.querySelectorAll('[data-excluir]').forEach(btn => {
        btn.addEventListener('click', () => excluirLojaComConfirmacao(btn));
    });
    lista.querySelectorAll('[data-copiar-link]').forEach(btn => {
        btn.addEventListener('click', () => copiarLinkLoja(btn));
    });
}

function montarCardLoja(loja) {
    const { texto, vencido } = situacaoLoja(loja);
    const info = PLANOS_INFO[loja.plano] || { nome: loja.plano || '—', preco: '—', resumo: '' };
    const rotuloBtnPagamento = loja.statusPagamento === 'trial' ? '💳 Confirmar pagamento' : '🔄 Renovar (+30 dias)';
    // Monta o link relativo à pasta onde ESTE super-admin.html está sendo servido —
    // window.location.origin sozinho (usado antes) ignora qualquer subpasta (ex: /main/
    // em servidores de preview/teste), o que fazia o link cair sempre na raiz e dar 404.
    const basePath = window.location.pathname.replace(/[^/]*$/, '');
    const linkLoja = `${window.location.origin}${basePath}index.html?loja=${encodeURIComponent(loja.id)}`;
    const dataCadastro = loja.criadoEm ? paraData(loja.criadoEm) : null;
    const inicial = (loja.nome || loja.id || '?').trim().charAt(0).toUpperCase();

    return `
        <div class="sa-loja-card">
            <div class="sa-loja-header">
                <div class="sa-loja-avatar">${escaparHtmlSA(inicial)}</div>
                <div class="sa-loja-nome-wrap">
                    <div class="sa-loja-nome">${escaparHtmlSA(loja.nome || loja.id)}</div>
                    <a class="sa-loja-slug" href="${linkLoja}" target="_blank" rel="noopener">🔗 ${escaparHtmlSA(loja.id)}</a>
                </div>
                <span class="sa-badge ${vencido ? 'alerta' : 'ok'}">${escaparHtmlSA(texto)}</span>
            </div>
            <div class="sa-loja-meta">
                <span>📧 <b>${escaparHtmlSA(loja.emailAdmin || 'sem e-mail')}</b></span>
                <span>💼 <b>${info.nome}</b> (${info.preco})</span>
                <span>📅 ${dataCadastro ? dataCadastro.toLocaleDateString('pt-BR') : '—'}</span>
            </div>
            <div class="sa-loja-acoes">
                <a class="sa-btn" href="${linkLoja}" target="_blank" rel="noopener">🔗 Ver loja</a>
                <button class="sa-btn" data-copiar-link="${escaparHtmlSA(linkLoja)}">📋 Copiar link</button>
                <button class="sa-btn azul" data-editar="${escaparHtmlSA(loja.id)}">✏️ Editar</button>
                <button class="sa-btn positivo" data-confirmar="${escaparHtmlSA(loja.id)}">${rotuloBtnPagamento}</button>
                <button class="sa-btn ambar" data-toggle-ativo="${escaparHtmlSA(loja.id)}" data-ativo="${loja.ativo !== false}">
                    ${loja.ativo === false ? '▶️ Reativar' : '⏸️ Suspender'}
                </button>
                <button class="sa-btn perigo" data-excluir="${escaparHtmlSA(loja.id)}">🗑️ Excluir</button>
            </div>
        </div>
    `;
}

async function copiarLinkLoja(btn) {
    const link = btn.dataset.copiarLink;
    try {
        await navigator.clipboard.writeText(link);
        showToast('Link copiado!', 'success');
    } catch (error) {
        console.error('Erro ao copiar link:', error);
        showToast('Não foi possível copiar automaticamente. Link: ' + link, 'error');
    }
}

// ========== EDITAR LOJA ==========

function abrirModalEdicao(lojaId) {
    const loja = todasAsLojas.find(l => l.id === lojaId);
    if (!loja) return;
    document.getElementById('editarLojaId').value = loja.id;
    document.getElementById('editarLojaNome').value = loja.nome || '';
    document.getElementById('editarLojaPlano').value = loja.plano || 'basico';
    document.getElementById('editarLojaOcultoHub').checked = loja.ocultoNoHub === true;
    document.getElementById('modalEditarLoja').style.display = 'flex';
}

function fecharModalEdicao() {
    document.getElementById('modalEditarLoja').style.display = 'none';
}

async function salvarEdicaoLoja(e) {
    e.preventDefault();
    const lojaId = document.getElementById('editarLojaId').value;
    const nome = document.getElementById('editarLojaNome').value.trim();
    const plano = document.getElementById('editarLojaPlano').value;
    const ocultoNoHub = document.getElementById('editarLojaOcultoHub').checked;
    const btn = document.getElementById('salvarEdicaoBtn');
    btn.disabled = true;
    btn.textContent = 'Salvando...';

    try {
        await editarLojaSuperAdmin(lojaId, { nome, plano, ocultoNoHub });
        showToast(`Loja "${nome}" atualizada`, 'success');
        fecharModalEdicao();
        await carregarLojas();
    } catch (error) {
        console.error('Erro ao editar loja:', error);
        showToast(traduzirErroFirebase(error), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Salvar';
    }
}

// ========== EXCLUIR LOJA ==========

async function excluirLojaComConfirmacao(btn) {
    const lojaId = btn.dataset.excluir;
    // Ação destrutiva e irreversível (apaga produtos, pedidos, cupons e motoboys também)
    // — confirma duas vezes, a segunda pedindo pra digitar o slug, pra evitar clique errado.
    if (!confirm(`Excluir a loja "${lojaId}" e TODOS os seus dados (produtos, pedidos, cupons, motoboys)? Essa ação não pode ser desfeita.`)) {
        return;
    }
    const digitado = prompt(`Pra confirmar, digite o slug da loja: ${lojaId}`);
    if (digitado !== lojaId) {
        showToast('Slug não confere — exclusão cancelada.', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Excluindo...';
    try {
        await deletarLoja(lojaId);
        showToast(`Loja "${lojaId}" excluída`, 'success');
        await carregarLojas();
    } catch (error) {
        console.error('Erro ao excluir loja:', error);
        showToast(traduzirErroFirebase(error), 'error');
        btn.disabled = false;
        btn.textContent = '🗑️ Excluir';
    }
}

async function confirmarPagamento(btn) {
    const lojaId = btn.dataset.confirmar;
    btn.disabled = true;
    try {
        await confirmarPagamentoLoja(lojaId);
        showToast(`"${lojaId}": pagamento confirmado, +30 dias liberados`, 'success');
        await carregarLojas();
    } catch (error) {
        console.error('Erro ao confirmar pagamento:', error);
        showToast('Erro ao confirmar pagamento', 'error');
        btn.disabled = false;
    }
}

async function alternarStatusLoja(btn) {
    const lojaId = btn.dataset.toggleAtivo;
    const ativoAtual = btn.dataset.ativo === 'true';
    btn.disabled = true;
    try {
        await definirStatusLoja(lojaId, !ativoAtual);
        showToast(`Loja "${lojaId}" ${ativoAtual ? 'suspensa' : 'reativada'}`, 'success');
        await carregarLojas();
    } catch (error) {
        console.error('Erro ao mudar status da loja:', error);
        showToast('Erro ao mudar status da loja', 'error');
        btn.disabled = false;
    }
}

async function criarNovaLoja(e) {
    e.preventDefault();
    const slug = document.getElementById('novaLojaSlug').value.trim().toLowerCase();
    const nome = document.getElementById('novaLojaNome').value.trim();
    const plano = document.getElementById('novaLojaPlano').value;
    const emailAdmin = document.getElementById('novaLojaEmailAdmin').value.trim();
    const senhaAdmin = document.getElementById('novaLojaSenhaAdmin').value;

    const btn = document.getElementById('criarLojaBtn');
    btn.disabled = true;
    btn.textContent = 'Criando...';

    try {
        // 15s de prazo pra cada etapa — se travar (ex: App Check esperando um token que
        // nunca chega, num domínio não cadastrado no reCAPTCHA), falha com mensagem clara
        // em vez de deixar o botão girando pra sempre sem explicação nenhuma.
        const MENSAGEM_TIMEOUT = 'Demorou demais e não respondeu. Verifique sua conexão ' +
            'e, se estiver testando fora do domínio de produção, confira o App Check ' +
            '(Firebase Console → App Check) — veja o console (F12) para mais detalhes.';

        // 1. Cria o documento da loja (valida o slug e checa duplicidade)
        await comTimeout(criarLoja(slug, { nome, plano, emailAdmin }), 15000, MENSAGEM_TIMEOUT);

        // 2. Cria o login do admin dessa loja e já vincula (usa app secundário —
        // não desloga o super-admin no processo)
        await comTimeout(criarAdminDaLoja(emailAdmin, senhaAdmin, slug), 15000, MENSAGEM_TIMEOUT);

        showToast(`Loja "${nome}" criada! Admin: ${emailAdmin}`, 'success');
        document.getElementById('novaLojaForm').reset();
        fecharModalNovaLoja();
        await carregarLojas();
    } catch (error) {
        console.error('Erro ao criar loja:', error);
        showToast(traduzirErroFirebase(error), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Criar loja';
    }
}

// Traduz os códigos de erro mais comuns do Firebase pra mensagens que fazem sentido
// pra quem está usando o painel — em vez de "Firebase: Error (auth/email-already-in-use)."
function traduzirErroFirebase(error) {
    const codigo = error?.code || '';
    const mapa = {
        'auth/email-already-in-use': 'Esse e-mail já está em uso por outra conta.',
        'auth/invalid-email': 'E-mail do admin inválido.',
        'auth/weak-password': 'Senha muito fraca (mínimo 6 caracteres).',
        'auth/unauthorized-domain': 'Este domínio não está autorizado no Firebase Authentication ' +
            '(Console → Authentication → Settings → Authorized domains).',
        'permission-denied': 'Sem permissão pro Firestore (confira se seu usuário está em ' +
            '/superadmins no Console, e se o App Check não está bloqueando este domínio).'
    };
    return mapa[codigo] || error?.message || 'Erro ao criar loja';
}

function escaparHtmlSA(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}

// ========== BANNERS DO HUB ==========
// Gerencia /plataforma/home.banners — o carrossel que aparece no topo do hub.html.
// Segue o mesmo padrão de "salva a lista inteira" já usado nas promoções de cada loja
// (ver admin.js/renderizarPromocoes): toda ação (adicionar, remover, reordenar, ativar/
// desativar) já grava na hora, sem precisar de um botão "Salvar" separado.

function gerarIdBannerLocal() {
    return 'bn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function carregarBannersHub() {
    const lista = document.getElementById('listaBanners');
    try {
        bannersHub = await getBannersHub();
        renderizarBannersHub();
    } catch (error) {
        console.error('Erro ao carregar banners do hub:', error);
        lista.innerHTML = '<p class="sa-vazio">Erro ao carregar banners.</p>';
    }
}

function renderizarBannersHub() {
    const lista = document.getElementById('listaBanners');

    if (bannersHub.length === 0) {
        lista.innerHTML = '<p class="sa-vazio">Nenhum banner cadastrado ainda — o hub fica sem carrossel até o primeiro ser adicionado.</p>';
        return;
    }

    lista.innerHTML = bannersHub.map((banner, i) => `
        <div class="sa-banner-item">
            <img src="${escaparHtmlSA(banner.imagem)}" alt="" onerror="this.style.visibility='hidden'">
            <div class="sa-banner-item-info">
                <strong>${escaparHtmlSA(banner.titulo || 'Sem título')}</strong>
                <small>${banner.link ? '🔗 ' + escaparHtmlSA(banner.link) : 'Sem link — clique não faz nada'}</small>
            </div>
            <div class="sa-banner-item-acoes">
                <button type="button" data-mover="${i}" data-direcao="-1" title="Mover pra cima" ${i === 0 ? 'disabled' : ''}>⬆️</button>
                <button type="button" data-mover="${i}" data-direcao="1" title="Mover pra baixo" ${i === bannersHub.length - 1 ? 'disabled' : ''}>⬇️</button>
                <button type="button" class="sa-banner-toggle ${banner.ativo !== false ? 'ativo' : 'inativo'}" data-toggle-banner="${i}">
                    ${banner.ativo !== false ? 'Ativo' : 'Inativo'}
                </button>
                <button type="button" data-remover-banner="${i}" title="Remover">🗑️</button>
            </div>
        </div>
    `).join('');

    lista.querySelectorAll('[data-mover]').forEach(btn => {
        btn.addEventListener('click', () => moverBannerHub(parseInt(btn.dataset.mover), parseInt(btn.dataset.direcao)));
    });
    lista.querySelectorAll('[data-toggle-banner]').forEach(btn => {
        btn.addEventListener('click', () => alternarBannerHub(parseInt(btn.dataset.toggleBanner)));
    });
    lista.querySelectorAll('[data-remover-banner]').forEach(btn => {
        btn.addEventListener('click', () => removerBannerHub(parseInt(btn.dataset.removerBanner)));
    });
}

async function adicionarBannerHub(e) {
    e.preventDefault();
    const imagemInput = document.getElementById('novoBannerImagem');
    const tituloInput = document.getElementById('novoBannerTitulo');
    const linkInput = document.getElementById('novoBannerLink');
    const btn = document.getElementById('adicionarBannerBtn');

    const imagem = imagemInput.value.trim();
    const titulo = tituloInput.value.trim();
    const link = linkInput.value.trim();
    if (!imagem) return;

    bannersHub.push({ id: gerarIdBannerLocal(), imagem, titulo, link, ativo: true });

    btn.disabled = true;
    btn.textContent = 'Adicionando...';
    try {
        await salvarBannersHub(bannersHub);
        imagemInput.value = '';
        tituloInput.value = '';
        linkInput.value = '';
        renderizarBannersHub();
        showToast('Banner adicionado', 'success');
    } catch (error) {
        console.error('Erro ao adicionar banner:', error);
        bannersHub.pop(); // desfaz a mudança local já que não salvou
        showToast(traduzirErroFirebase(error), 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = '➕ Adicionar banner';
    }
}

async function moverBannerHub(indice, direcao) {
    const novoIndice = indice + direcao;
    if (novoIndice < 0 || novoIndice >= bannersHub.length) return;
    [bannersHub[indice], bannersHub[novoIndice]] = [bannersHub[novoIndice], bannersHub[indice]];
    renderizarBannersHub(); // reflete a ordem na hora, mesmo antes do Firestore confirmar
    try {
        await salvarBannersHub(bannersHub);
    } catch (error) {
        console.error('Erro ao reordenar banners:', error);
        showToast(traduzirErroFirebase(error), 'error');
        await carregarBannersHub(); // desfaz, voltando pro que está salvo de verdade
    }
}

async function alternarBannerHub(indice) {
    const banner = bannersHub[indice];
    if (!banner) return;
    banner.ativo = banner.ativo === false ? true : false;
    renderizarBannersHub();
    try {
        await salvarBannersHub(bannersHub);
    } catch (error) {
        console.error('Erro ao mudar status do banner:', error);
        showToast(traduzirErroFirebase(error), 'error');
        await carregarBannersHub();
    }
}

async function removerBannerHub(indice) {
    if (!confirm('Remover este banner do hub?')) return;
    const removido = bannersHub.splice(indice, 1);
    renderizarBannersHub();
    try {
        await salvarBannersHub(bannersHub);
        showToast('Banner removido', 'success');
    } catch (error) {
        console.error('Erro ao remover banner:', error);
        showToast(traduzirErroFirebase(error), 'error');
        if (removido[0]) bannersHub.splice(indice, 0, removido[0]); // desfaz
        renderizarBannersHub();
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}
