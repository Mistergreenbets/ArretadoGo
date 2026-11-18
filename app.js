// ========== VARIÁVEIS GLOBAIS ==========
let produtos = [];
let carrinho = [];
let allProdutos = [];
const WHATSAPP_NUMBER_PADRAO = '5511999999999'; // Usado só se não houver configuração salva
let configLoja = {
    nome: 'ArretadoGo',
    logoUrl: '',
    saudacao: 'Olá 👋, ArretadoGo',
    telefone: WHATSAPP_NUMBER_PADRAO,
    redesSociais: {
        facebook: '',
        instagram: ''
    },
    taxaEntrega: 5.00,
    tempoEntrega: 30,
    pedidoMinimo: 0,
    saboresPizza: [],
    adicionaisSanduiche: [],
    bairrosEntrega: [],
    // Cálculo automático de frete por distância — convive com bairrosEntrega acima.
    // Quando ativo=true e a loja tem lat/lng configurados, o app tenta calcular a taxa
    // sozinho a partir do endereço digitado; se não conseguir, cai no bairro manual.
    calculoPorKm: {
        ativo: false,
        provedor: 'nominatim', // 'nominatim' (grátis, hoje) ou 'google' (precisa de googleApiKey)
        googleApiKey: '',
        lojaLat: null,
        lojaLng: null,
        cidadeUf: '', // ex: "Fortaleza, CE" — essencial pra não confundir endereço com outra cidade
        valorPorKm: 0, // R$ por km rodado — taxa = distância × valorPorKm, com piso em taxaMinima
        taxaMinima: 6.00 // nunca cobra menos que isso, mesmo pra endereço bem perto da loja
    },
    promocoes: [],
    horarioFuncionamento: null,
    hero: {
        prefixo: 'Aproveite Sua',
        destaque: 'Comida Deliciosa',
        subtitulo: 'Entregamos sua comida em até 30 minutos no seu bairro. Qualidade e agilidade garantidas!',
        botaoTexto: 'Pedir Agora',
        imagem: 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=400&fit=crop',
        stats: [
            { valor: '12k+', label: 'Pedidos' },
            { valor: '4.8★', label: 'Avaliação' },
            { valor: '20+', label: 'Anos' }
        ]
    }
};

// Slide padrão exibido quando a loja ainda não cadastrou nenhuma promoção ativa
const PROMOCAO_PADRAO = {
    titulo: '🎉 Aproveite Nossas Promoções',
    descricao: 'Compre 2 e ganhe 1 de GRAÇA em produtos selecionados',
    imagem: 'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=300&h=200&fit=crop'
};

let promoIndex = 0;
let promoIntervalId = null;
let productsPerPage = 8;
let currentPage = 1;
let filtroAtivo = 'todos';
let termoBusca = '';

// Seleções feitas no modal de produto (sabores de pizza e adicionais de sanduíche)
let saboresSelecionados = [];
// Sabor "de origem" da pizza aberta no modal (ex: abrir "Pizza Calabresa" já preenche este
// campo com o sabor "Calabresa") — null se o nome do produto não bate com nenhum sabor
// cadastrado. Ver encontrarSaborBaseDoProduto().
let saborBaseAtual = null;
let adicionaisSelecionados = [];

// Cupom de desconto aplicado no carrinho atual: { id, codigo, desconto } ou null
let cupomAplicado = null;

// ========== INICIALIZAR APP ==========
document.addEventListener('DOMContentLoaded', async () => {
    console.log('App iniciado...');

    // Multi-tenant: primeiro descobre QUAL loja é essa (pelo slug na URL) antes de
    // qualquer outra coisa — sem isso, nenhuma chamada ao Firestore sabe de onde ler.
    const resultado = await inicializarLoja();
    if (resultado.erro) {
        mostrarErroLoja(resultado.erro);
        return;
    }
    if (resultado.loja?.nome) nomeLojaAtual = resultado.loja.nome; // usado nas mensagens de WhatsApp

    // Produtos e configurações (hero, nome da loja, etc.) são independentes entre si.
    // Antes eram buscados em sequência (produtos primeiro, config só depois), o que
    // fazia a Hero cadastrada no admin demorar mais que o necessário pra aparecer —
    // ficava "presa" atrás do carregamento de todos os produtos. Agora buscam em
    // paralelo, e a Hero é preenchida assim que a própria busca dela terminar.
    await Promise.all([
        carregarProdutos(),
        carregarConfigurações()
    ]);
    inicializarEventos();
    renderizarCategorias();
    renderizarProdutos();
    renderizarHeroCarousel();
    carregarCarrinho();
    preencherDadosClienteSalvos();
});

// Tela simples de erro pra quando a URL não aponta pra nenhuma loja válida/ativa.
// Substitui a página inteira — não faz sentido mostrar carrinho/produtos de loja nenhuma.
function mostrarErroLoja(motivo) {
    const mensagens = {
        'sem-slug': 'Endereço incompleto. Confira o link da loja que você recebeu.',
        'nao-encontrada': 'Loja não encontrada. Confira se o endereço está certo.',
        'inativa': 'Esta loja está temporariamente indisponível.'
    };
    document.body.innerHTML = `
        <div style="max-width:420px;margin:80px auto;padding:32px;text-align:center;font-family:sans-serif;">
            <h2 style="margin-bottom:12px;">😕 ${mensagens[motivo] || 'Não foi possível carregar a loja.'}</h2>
        </div>`;
}

// ========== LEMBRAR NOME/TELEFONE DO CLIENTE (sem precisar de login) ==========
// Guarda só no navegador do próprio cliente (localStorage), pra não precisar
// redigitar nome e telefone toda vez que voltar pra fazer um novo pedido.
// Endereço fica de fora de propósito — muda de pedido pra pedido.
const CHAVE_DADOS_CLIENTE = 'arretadogoDadosCliente';

function preencherDadosClienteSalvos() {
    try {
        const salvos = JSON.parse(localStorage.getItem(CHAVE_DADOS_CLIENTE) || 'null');
        if (!salvos) return;

        const nomeInput = document.getElementById('clientName');
        const telefoneInput = document.getElementById('clientPhone');
        if (salvos.nome && nomeInput) nomeInput.value = salvos.nome;
        if (salvos.telefone && telefoneInput) {
            telefoneInput.value = salvos.telefone;
            // Preenchimento via JS não dispara o evento "blur" do campo, que é o que
            // normalmente checa se esse telefone tem recompensa de fidelidade disponível.
            // Sem isso, o desconto só aparecia se o cliente reeditasse o número manualmente.
            checarRecompensaFidelidade();
        }
    } catch (error) {
        // localStorage pode estar indisponível (modo privado, etc.) — sem problema, só não preenche
        console.error('Erro ao carregar dados salvos do cliente:', error);
    }
}

function salvarDadosClienteLocal(nome, telefone) {
    try {
        localStorage.setItem(CHAVE_DADOS_CLIENTE, JSON.stringify({ nome, telefone }));
    } catch (error) {
        console.error('Erro ao salvar dados do cliente:', error);
    }
}

// ========== CARREGAR DADOS ==========
async function carregarProdutos() {
    try {
        allProdutos = await getAllProducts();
        produtos = [...allProdutos];
        console.log('Produtos carregados:', produtos.length);
    } catch (error) {
        console.error('Erro ao carregar produtos:', error);
        showToast('Erro ao carregar produtos', 'error');
    }
}

async function carregarConfigurações() {
    try {
        const config = await getSettings();
        if (config) {
            configLoja = {
                nome: config.nome || configLoja.nome,
                logoUrl: config.logoUrl || '',
                // Se a loja não definiu uma saudação própria, o padrão usa o NOME DELA (não
                // o nome da plataforma) — antes caía sempre em 'Olá 👋, ArretadoGo' fixo.
                saudacao: config.saudacao || `Olá 👋, ${config.nome || configLoja.nome}`,
                telefone: config.telefone || configLoja.telefone,
                redesSociais: {
                    facebook: config.redesSociais?.facebook || '',
                    instagram: config.redesSociais?.instagram || ''
                },
                taxaEntrega: config.taxaEntrega ?? configLoja.taxaEntrega,
                tempoEntrega: config.tempoEntrega ?? configLoja.tempoEntrega,
                pedidoMinimo: config.pedidoMinimo ?? configLoja.pedidoMinimo,
                saboresPizza: Array.isArray(config.saboresPizza) ? config.saboresPizza : [],
                adicionaisSanduiche: Array.isArray(config.adicionaisSanduiche) ? config.adicionaisSanduiche : [],
                bairrosEntrega: Array.isArray(config.bairrosEntrega) ? config.bairrosEntrega : [],
                calculoPorKm: {
                    ativo: config.calculoPorKm?.ativo === true,
                    provedor: config.calculoPorKm?.provedor || 'nominatim',
                    googleApiKey: config.calculoPorKm?.googleApiKey || '',
                    lojaLat: config.calculoPorKm?.lojaLat ?? null,
                    lojaLng: config.calculoPorKm?.lojaLng ?? null,
                    cidadeUf: config.calculoPorKm?.cidadeUf || '',
                    valorPorKm: Number(config.calculoPorKm?.valorPorKm) || 0,
                    taxaMinima: config.calculoPorKm?.taxaMinima != null ? Number(config.calculoPorKm.taxaMinima) : 6.00
                },
                promocoes: Array.isArray(config.promocoes) ? config.promocoes : [],
                horarioFuncionamento: config.horarioFuncionamento || null,
                hero: {
                    prefixo: config.hero?.prefixo || configLoja.hero.prefixo,
                    destaque: config.hero?.destaque || configLoja.hero.destaque,
                    subtitulo: config.hero?.subtitulo || configLoja.hero.subtitulo,
                    botaoTexto: config.hero?.botaoTexto || configLoja.hero.botaoTexto,
                    imagem: config.hero?.imagem || configLoja.hero.imagem,
                    stats: Array.isArray(config.hero?.stats) && config.hero.stats.length === 3
                        ? config.hero.stats
                        : configLoja.hero.stats
                }
            };
        }

        // Aplicar nome da loja em todo lugar que aparece na página
        document.title = `${configLoja.nome} - Delivery de Comida Premium`;
        document.querySelectorAll('.js-store-name').forEach(el => {
            el.textContent = configLoja.nome;
        });

        const greetingPrefixEl = document.getElementById('headerGreetingPrefix');
        if (greetingPrefixEl) greetingPrefixEl.textContent = configLoja.saudacao;

        // Logo redonda da loja (link de imagem configurado em Configurações). Sem link
        // configurado, ou se o link estiver quebrado, cai num círculo com a inicial do
        // nome — nunca mostra a logo do ArretadoGo pro cliente final.
        const logoImgEl = document.getElementById('storeLogoImg');
        const logoFallbackEl = document.getElementById('storeLogoFallback');
        if (logoImgEl && logoFallbackEl) {
            const inicial = (configLoja.nome || '?').trim().charAt(0).toUpperCase() || '?';
            logoFallbackEl.textContent = inicial;
            if (configLoja.logoUrl) {
                logoImgEl.onerror = () => {
                    logoImgEl.style.display = 'none';
                    logoFallbackEl.style.display = 'flex';
                };
                logoImgEl.onload = () => {
                    logoImgEl.style.display = 'block';
                    logoFallbackEl.style.display = 'none';
                };
                logoImgEl.src = configLoja.logoUrl;
            } else {
                logoImgEl.style.display = 'none';
                logoFallbackEl.style.display = 'flex';
            }
        }

        // Salva a saudação/logo em cache local pra próxima visita aparecer instantaneamente,
        // sem precisar esperar o Firestore de novo (ver script inline no início do <body>).
        // Mesmo padrão já usado pra Hero (chave por loja via obterLojaAtual(), pra não vazar
        // entre lojas diferentes no mesmo navegador).
        try {
            localStorage.setItem(`arretadogoGreetingCache:${obterLojaAtual()}`, JSON.stringify({
                saudacao: configLoja.saudacao,
                logoUrl: configLoja.logoUrl,
                nome: configLoja.nome
            }));
        } catch (e) {
            // localStorage indisponível: sem problema, só não vai ter cache pra próxima visita.
        }

        const facebookEl = document.getElementById('facebookLink');
        if (facebookEl) {
            if (configLoja.redesSociais.facebook) {
                facebookEl.href = configLoja.redesSociais.facebook;
                facebookEl.style.display = '';
            } else {
                facebookEl.style.display = 'none';
            }
        }

        const instagramEl = document.getElementById('instagramLink');
        if (instagramEl) {
            if (configLoja.redesSociais.instagram) {
                instagramEl.href = configLoja.redesSociais.instagram;
                instagramEl.style.display = '';
            } else {
                instagramEl.style.display = 'none';
            }
        }

        const linksWhatsapp = document.querySelectorAll('.js-whatsapp-link');
        if (linksWhatsapp.length) {
            const numeroFormatado = formatarTelefoneExibicao(configLoja.telefone);
            const hrefWhatsapp = `https://wa.me/${apenasNumeros(configLoja.telefone) || WHATSAPP_NUMBER_PADRAO}`;
            linksWhatsapp.forEach(el => {
                el.href = hrefWhatsapp;
                el.title = `WhatsApp: ${numeroFormatado}`;
            });
        }

        renderizarOpcoesBairro();
        configurarUIEntregaPorKm();
        atualizarStatusLoja();

        // Reavalia a cada minuto (pra loja abrir/fechar sozinha sem precisar recarregar a página)
        if (!statusLojaIntervalId) {
            statusLojaIntervalId = setInterval(atualizarStatusLoja, 60 * 1000);
        }
    } catch (error) {
        console.error('Erro ao carregar configurações:', error);
    } finally {
        // Revela a saudação/logo mesmo se algo der errado (ex: sem internet) — nesse caso
        // mostra os valores padrão já preenchidos em configLoja, em vez de ficar escondida.
        revelarSaudacao();
    }
}

// ========== STATUS DA LOJA (ABERTA/FECHADA) ==========
let statusLojaIntervalId = null;
let lojaAbertaAtual = true; // usado pra bloquear o checkout quando a loja estiver fechada

function atualizarStatusLoja() {
    const status = calcularStatusLoja(configLoja);
    lojaAbertaAtual = status.aberta;

    atualizarSeloStatusLoja(status);

    const banner = document.getElementById('storeStatusBanner');
    const heroCarouselSection = document.getElementById('heroCarouselSection');
    if (!banner) return;

    if (!status.controlado || status.aberta) {
        banner.style.display = 'none';
        banner.textContent = '';
        // Banner escondido: o carrossel volta a ser o primeiro elemento da página, então
        // ele mesmo precisa compensar o header fixo.
        heroCarouselSection?.classList.add('hero-topo');
        return;
    }

    const proxima = status.proximaAbertura
        ? ` Abrimos ${status.proximaAbertura.label} às ${status.proximaAbertura.hora}.`
        : '';
    banner.textContent = `🔴 Estamos fechados no momento.${proxima}`;
    banner.style.display = 'block';
    // Banner visível: ele já compensa o header. Se o carrossel também compensasse, o
    // espaço dobraria — por isso tira a margem extra dele enquanto o banner estiver na tela.
    heroCarouselSection?.classList.remove('hero-topo');
}

// Selo "Aberto"/"Fechado" ao lado do nome da loja, no header. Diferente do banner (que só
// aparece quando fechada), o selo fica sempre visível enquanto houver horário de funcionamento
// configurado — dá pra ver o status da loja mesmo quando ela está aberta.
function atualizarSeloStatusLoja(status) {
    const badge = document.getElementById('storeOpenBadge');
    if (!badge) return;

    if (!status.controlado) {
        badge.style.display = 'none';
        badge.textContent = '';
        badge.classList.remove('is-aberta', 'is-fechada');
        return;
    }

    badge.style.display = 'inline-flex';
    if (status.aberta) {
        badge.textContent = 'Aberto';
        badge.classList.add('is-aberta');
        badge.classList.remove('is-fechada');
    } else {
        badge.textContent = 'Fechado';
        badge.classList.add('is-fechada');
        badge.classList.remove('is-aberta');
    }
}

function revelarSaudacao() {
    document.getElementById('headerGreeting')?.classList.remove('greeting-loading');
}

// Preenche o <select> de bairros usado no checkout de delivery
function renderizarOpcoesBairro() {
    const select = document.getElementById('clientBairro');
    if (!select) return;

    select.innerHTML = '<option value="">Selecione seu bairro</option>';

    configLoja.bairrosEntrega.forEach(bairro => {
        const option = document.createElement('option');
        option.value = bairro.nome;
        option.dataset.taxa = bairro.taxa;
        option.textContent = `${bairro.nome} — R$ ${Number(bairro.taxa).toFixed(2)}`;
        select.appendChild(option);
    });

    const outraOpcao = document.createElement('option');
    outraOpcao.value = '__outro__';
    outraOpcao.dataset.taxa = configLoja.taxaEntrega;
    outraOpcao.textContent = `Outro bairro (taxa padrão R$ ${Number(configLoja.taxaEntrega).toFixed(2)})`;
    select.appendChild(outraOpcao);
}

// ========== FRETE AUTOMÁTICO POR KM ==========
// Resultado do último cálculo bem-sucedido: { distanciaKm, taxa, bairro } ou null (nada
// calculado ainda / falhou / desativado). obterTaxaEntregaSelecionada() lê essa variável.
let freteAutoResultado = null;
let freteAutoDebounceTimer = null;

// Mensagens compartilhadas entre o fluxo de texto livre (debounce) e o fluxo de sugestão
// selecionada (confirmação imediata) — mesmo texto pro cliente nos dois casos.
const MENSAGENS_ERRO_FRETE_AUTO = {
    'endereco-nao-encontrado': '⚠️ Não localizamos esse endereço — selecione seu bairro abaixo.',
    'sem-valor-km': '⚠️ Frete automático não configurado — selecione seu bairro abaixo.',
    'erro-geocoding': '⚠️ Não foi possível calcular agora — selecione seu bairro abaixo.'
};

// ---------- PRÉVIA DE ENDEREÇO (estilo Uber) ----------
let sugestoesDebounceTimer = null;
let sugestoesAtuais = []; // cache da última lista renderizada, pra navegação por teclado
let indiceSugestaoAtiva = -1;

// Chamado a cada digitação (debounce curto, 350ms) pra mostrar a prévia de rua/bairro/
// cidade embaixo do campo — igual apps de transporte fazem. Não confunde com o cálculo de
// frete em si (que roda com debounce próprio, mais longo, ver agendarCalculoFreteAutomatico).
function agendarBuscaSugestoesEndereco() {
    clearTimeout(sugestoesDebounceTimer);
    const enderecoInput = document.getElementById('clientAddress');
    const texto = enderecoInput?.value.trim() || '';

    if (texto.length < 3 || !configLoja.calculoPorKm?.ativo) {
        esconderSugestoesEndereco();
        return;
    }

    sugestoesDebounceTimer = setTimeout(async () => {
        // Se o cliente já continuou digitando/apagou enquanto a busca rodava, essa
        // resposta ficou obsoleta — confere de novo antes de renderizar.
        const textoAtual = enderecoInput?.value.trim() || '';
        if (textoAtual !== texto) return;

        const sugestoes = await buscarSugestoesEndereco(texto, configLoja.calculoPorKm);
        if ((enderecoInput?.value.trim() || '') !== texto) return; // resposta obsoleta

        console.debug(`[sugestões de endereço] "${texto}" → ${sugestoes.length} resultado(s)`);
        renderizarSugestoesEndereco(sugestoes);
    }, 350);
}

function renderizarSugestoesEndereco(lista) {
    const box = document.getElementById('enderecoSugestoesBox');
    if (!box) return;

    sugestoesAtuais = lista;
    indiceSugestaoAtiva = -1;

    if (!lista.length) {
        esconderSugestoesEndereco();
        return;
    }

    box.innerHTML = '';
    lista.forEach((sugestao, indice) => {
        const item = document.createElement('div');
        item.className = 'endereco-sugestao-item';
        item.dataset.indice = indice;
        item.innerHTML = `
            <span class="endereco-sugestao-titulo">📍 ${sugestao.titulo}</span>
            ${sugestao.subtitulo ? `<span class="endereco-sugestao-subtitulo">${sugestao.subtitulo}</span>` : ''}
        `;
        item.addEventListener('click', () => selecionarSugestaoEndereco(sugestao));
        box.appendChild(item);
    });
    box.style.display = 'block';
}

function esconderSugestoesEndereco() {
    const box = document.getElementById('enderecoSugestoesBox');
    if (!box) return;
    box.style.display = 'none';
    box.innerHTML = '';
    sugestoesAtuais = [];
    indiceSugestaoAtiva = -1;
}

// Cliente clicou (ou confirmou pelo teclado) numa sugestão do banco local de ruas. O nome
// da rua já vem com a grafia CERTA (direto do OpenStreetMap), então em vez de usar o ponto
// aproximado da rua inteira (que pode estar longe do número certo), rodamos o geocoding de
// verdade agora — com a grafia corrigida, a taxa de acerto do Nominatim/Google sobe muito.
async function selecionarSugestaoEndereco(sugestao) {
    const enderecoInput = document.getElementById('clientAddress');
    if (enderecoInput) enderecoInput.value = sugestao.enderecoCompleto;
    esconderSugestoesEndereco();

    // Cancela qualquer cálculo por texto livre pendente — já vamos calcular agora mesmo.
    clearTimeout(freteAutoDebounceTimer);
    mostrarStatusFreteAuto('📍 Calculando frete...', null);

    const resultado = await calcularFreteAutomatico(enderecoInput.value, configLoja.calculoPorKm);
    if (resultado.ok) {
        freteAutoResultado = { distanciaKm: resultado.distanciaKm, taxa: resultado.taxa, bairro: resultado.bairro || null };
        const sufixoBairro = resultado.bairro ? ` — ${resultado.bairro}` : '';
        mostrarStatusFreteAuto(
            `📍 Frete calculado: R$ ${resultado.taxa.toFixed(2)} (${resultado.distanciaKm.toFixed(1)} km${sufixoBairro})`,
            'ok'
        );
        exibirSelectBairroComoFallback(false);
    } else {
        freteAutoResultado = null;
        mostrarStatusFreteAuto(MENSAGENS_ERRO_FRETE_AUTO[resultado.motivo] || '⚠️ Selecione seu bairro abaixo.', 'erro');
        exibirSelectBairroComoFallback(true);
    }
    atualizarCarrinho();
}

// Setinhas + Enter pra navegar na lista sem precisar do mouse (igual qualquer autocomplete).
function navegarSugestoesEndereco(e) {
    const box = document.getElementById('enderecoSugestoesBox');
    if (!box || box.style.display === 'none' || !sugestoesAtuais.length) return;

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const direcao = e.key === 'ArrowDown' ? 1 : -1;
        indiceSugestaoAtiva = (indiceSugestaoAtiva + direcao + sugestoesAtuais.length) % sugestoesAtuais.length;
        [...box.children].forEach((item, i) => item.classList.toggle('ativa', i === indiceSugestaoAtiva));
        box.children[indiceSugestaoAtiva]?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && indiceSugestaoAtiva >= 0) {
        e.preventDefault();
        selecionarSugestaoEndereco(sugestoesAtuais[indiceSugestaoAtiva]);
    } else if (e.key === 'Escape') {
        esconderSugestoesEndereco();
    }
}

// Decide, uma vez ao carregar a loja, se mostra o campo de endereço como cálculo
// automático (escondendo o select de bairro) ou mantém o fluxo manual de sempre.
// O select de bairro nunca é removido de verdade — ele volta a aparecer sozinho se o
// cálculo automático falhar pra um endereço específico (fallback sem travar o cliente).
function configurarUIEntregaPorKm() {
    const ativo = configLoja.calculoPorKm?.ativo === true
        && configLoja.calculoPorKm.lojaLat != null
        && configLoja.calculoPorKm.lojaLng != null;

    // A visibilidade do chip é controlada por mostrarStatusFreteAuto() (classe is-visible),
    // não por display inline — aqui só decide se o fluxo automático está habilitado ou não.

    const bairroSelect = document.getElementById('clientBairro');
    if (bairroSelect && ativo) {
        // Só some do fluxo enquanto o cálculo automático estiver funcionando; reaparece
        // automaticamente em caso de falha (ver processarFreteAutomatico).
        bairroSelect.dataset.escondidoPeloCalculoKm = 'true';
    }

    // Pré-carrega o banco local de ruas em segundo plano — assim quando o cliente digitar
    // a primeira letra a prévia já está pronta em memória, sem esperar o fetch.
    if (ativo) carregarBaseRuas();
}

function mostrarStatusFreteAuto(texto, tipo) {
    const statusEl = document.getElementById('freteAutoStatus');
    if (!statusEl) return;

    if (!texto) {
        statusEl.classList.remove('is-visible', 'frete-auto-badge--calculando', 'frete-auto-badge--ok', 'frete-auto-badge--erro');
        return;
    }

    statusEl.textContent = texto;
    statusEl.classList.add('is-visible');
    statusEl.classList.remove('frete-auto-badge--calculando', 'frete-auto-badge--ok', 'frete-auto-badge--erro');
    const classePorTipo = { ok: 'frete-auto-badge--ok', erro: 'frete-auto-badge--erro' };
    statusEl.classList.add(classePorTipo[tipo] || 'frete-auto-badge--calculando');
}

// Chamado a cada digitação no campo de endereço (com debounce) quando o cálculo por km
// está ativo. Roda "em silêncio" — o cliente só vê o texto de status atualizar sozinho.
function agendarCalculoFreteAutomatico() {
    if (!(configLoja.calculoPorKm?.ativo && configLoja.calculoPorKm.lojaLat != null && configLoja.calculoPorKm.lojaLng != null)) {
        return;
    }

    clearTimeout(freteAutoDebounceTimer);
    const enderecoInput = document.getElementById('clientAddress');
    const endereco = enderecoInput?.value.trim() || '';

    if (endereco.length < 8) {
        freteAutoResultado = null;
        mostrarStatusFreteAuto('', null);
        exibirSelectBairroComoFallback(false);
        atualizarCarrinho();
        return;
    }

    mostrarStatusFreteAuto('📍 Calculando frete...', null);

    // Espera 800ms sem digitar antes de chamar a API — evita geocodificar a cada letra.
    freteAutoDebounceTimer = setTimeout(async () => {
        const resultado = await calcularFreteAutomatico(endereco, configLoja.calculoPorKm);

        if (resultado.ok) {
            freteAutoResultado = { distanciaKm: resultado.distanciaKm, taxa: resultado.taxa, bairro: resultado.bairro || null };
            const sufixoBairro = resultado.bairro ? ` — ${resultado.bairro}` : '';
            mostrarStatusFreteAuto(
                `📍 Frete calculado: R$ ${resultado.taxa.toFixed(2)} (${resultado.distanciaKm.toFixed(1)} km${sufixoBairro})`,
                'ok'
            );
            exibirSelectBairroComoFallback(false);
        } else {
            // Não travou o cliente: só volta pro fluxo manual de bairro.
            freteAutoResultado = null;
            mostrarStatusFreteAuto(MENSAGENS_ERRO_FRETE_AUTO[resultado.motivo] || '⚠️ Selecione seu bairro abaixo.', 'erro');
            exibirSelectBairroComoFallback(true);
        }
        atualizarCarrinho();
    }, 800);
}

// Mostra/esconde o select de bairro como plano B, sem nunca impedir o checkout.
function exibirSelectBairroComoFallback(mostrar) {
    const bairroSelect = document.getElementById('clientBairro');
    if (!bairroSelect) return;
    if (mostrar) {
        bairroSelect.style.display = 'block';
    } else if (bairroSelect.dataset.escondidoPeloCalculoKm === 'true') {
        bairroSelect.style.display = 'none';
        bairroSelect.value = '';
    }
}

// Deixa só números (usado para montar o link do WhatsApp)
function apenasNumeros(str) {
    return (str || '').replace(/\D/g, '');
}

// Formata "5511999999999" -> "11 99999-9999" pra exibir no rodapé
function formatarTelefoneExibicao(telefone) {
    const numeros = apenasNumeros(telefone);
    if (numeros.length < 10) return telefone;
    const semDDI = numeros.length > 11 ? numeros.slice(-11) : numeros;
    const ddd = semDDI.slice(0, 2);
    const resto = semDDI.slice(2);
    if (resto.length === 9) {
        return `${ddd} ${resto.slice(0, 5)}-${resto.slice(5)}`;
    }
    return `${ddd} ${resto.slice(0, 4)}-${resto.slice(4)}`;
}

// Texto amigável da forma de pagamento (usado na mensagem do WhatsApp)
function formatarFormaPagamento(metodo) {
    const labels = {
        pix: '📱 Pix',
        credito: '💳 Cartão de Crédito',
        debito: '💳 Cartão de Débito',
        dinheiro: '💵 Dinheiro'
    };
    return labels[metodo] || 'Não informado';
}

// ========== CARROSSEL DO TOPO (promoções cadastradas no admin) ==========
// Antes existia uma seção "Hero" fixa no topo e um carrossel de promoções separado,
// mais embaixo. A Hero foi removida: agora o carrossel de promoções é a própria seção
// do topo, sem nenhum slide fixo — só o que estiver cadastrado em "Promoções" no admin.
let heroCarouselIndex = 0;
let heroCarouselIntervalId = null;
const HERO_CAROUSEL_INTERVALO_MS = 5000;

function irParaCardapio() {
    document.getElementById('produtos')?.scrollIntoView({ behavior: 'smooth' });
}

function renderizarHeroCarousel() {
    const section = document.getElementById('heroCarouselSection');
    const track = document.getElementById('heroCarouselTrack');
    const dotsContainer = document.getElementById('heroCarouselDots');
    if (!track || !dotsContainer) return;

    const promoAtivas = (configLoja.promocoes || []).filter(p => p.ativo);
    const slides = promoAtivas.length > 0 ? promoAtivas : [PROMOCAO_PADRAO];

    track.innerHTML = slides.map(promo => `
        <div class="hero-carousel-slide" role="button" tabindex="0" aria-label="Ver cardápio">
            <div class="hero-image">
                <img src="${promo.imagem}" alt="${promo.titulo || ''}" class="showcase-img">
            </div>
        </div>
    `).join('');

    track.querySelectorAll('.hero-carousel-slide').forEach(slide => {
        slide.addEventListener('click', irParaCardapio);
        slide.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); irParaCardapio(); }
        });
    });

    const totalSlides = slides.length;

    // Dots
    dotsContainer.innerHTML = totalSlides > 1
        ? Array.from({ length: totalSlides }, (_, i) =>
            `<button type="button" class="promo-dot${i === 0 ? ' active' : ''}" data-index="${i}" aria-label="Ir para o slide ${i + 1}"></button>`
          ).join('')
        : '';
    dotsContainer.querySelectorAll('.promo-dot').forEach(dot => {
        dot.addEventListener('click', () => irParaSlideHero(parseInt(dot.dataset.index)));
    });

    // Barra de progresso só faz sentido com mais de 1 slide
    const progressWrap = document.getElementById('heroCarouselProgress');
    if (progressWrap) progressWrap.style.display = totalSlides > 1 ? 'block' : 'none';

    heroCarouselIndex = 0;
    atualizarPosicaoHeroCarousel(true);
    iniciarAutoplayHeroCarousel(totalSlides);

    // Revela a seção (evita o "flash" do carrossel vazio enquanto o Firestore responde)
    section?.classList.remove('carousel-loading');
}

function atualizarPosicaoHeroCarousel(semTransicao) {
    const track = document.getElementById('heroCarouselTrack');
    if (!track) return;
    if (semTransicao) {
        track.style.transition = 'none';
        track.style.transform = `translateX(-${heroCarouselIndex * 100}%)`;
        // Força reflow antes de reativar a transição, senão o "sem transição" não pega
        void track.offsetWidth;
        track.style.transition = '';
    } else {
        track.style.transform = `translateX(-${heroCarouselIndex * 100}%)`;
    }

    document.querySelectorAll('#heroCarouselDots .promo-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === heroCarouselIndex);
    });
}

function iniciarAutoplayHeroCarousel(totalSlides) {
    if (heroCarouselIntervalId) { clearInterval(heroCarouselIntervalId); heroCarouselIntervalId = null; }
    const bar = document.getElementById('heroCarouselProgressBar');
    if (totalSlides > 1) {
        if (bar) {
            bar.style.animation = 'none';
            void bar.offsetWidth;
            bar.style.animation = `heroCarouselProgress ${HERO_CAROUSEL_INTERVALO_MS}ms linear`;
        }
        heroCarouselIntervalId = setInterval(() => avancarHeroCarousel(1), HERO_CAROUSEL_INTERVALO_MS);
    } else if (bar) {
        bar.style.animation = 'none';
    }
}

function avancarHeroCarousel(direcao) {
    const totalSlides = document.querySelectorAll('#heroCarouselTrack .hero-carousel-slide').length;
    if (totalSlides === 0) return;
    heroCarouselIndex = (heroCarouselIndex + direcao + totalSlides) % totalSlides;
    atualizarPosicaoHeroCarousel(false);
    iniciarAutoplayHeroCarousel(totalSlides); // reinicia o timer/barra a cada troca (manual ou automática)
}

function irParaSlideHero(index) {
    heroCarouselIndex = index;
    atualizarPosicaoHeroCarousel(false);
    const totalSlides = document.querySelectorAll('#heroCarouselTrack .hero-carousel-slide').length;
    iniciarAutoplayHeroCarousel(totalSlides);
}

// Pausa o autoplay com o mouse em cima (desktop)
document.getElementById('heroCarousel')?.addEventListener('mouseenter', () => {
    if (heroCarouselIntervalId) { clearInterval(heroCarouselIntervalId); heroCarouselIntervalId = null; }
    const bar = document.getElementById('heroCarouselProgressBar');
    if (bar) bar.style.animationPlayState = 'paused';
});
document.getElementById('heroCarousel')?.addEventListener('mouseleave', () => {
    const totalSlides = document.querySelectorAll('#heroCarouselTrack .hero-carousel-slide').length;
    const bar = document.getElementById('heroCarouselProgressBar');
    if (bar) bar.style.animationPlayState = 'running';
    if (totalSlides > 1 && !heroCarouselIntervalId) {
        heroCarouselIntervalId = setInterval(() => avancarHeroCarousel(1), HERO_CAROUSEL_INTERVALO_MS);
    }
});

// Swipe no touch (mobile) — arrasta o dedo pra trocar de slide, igual carrossel de app nativo
(function configurarSwipeHeroCarousel() {
    const track = document.getElementById('heroCarouselTrack');
    if (!track) return;
    let startX = 0;
    let deltaX = 0;
    let arrastando = false;

    track.addEventListener('touchstart', (e) => {
        startX = e.touches[0].clientX;
        deltaX = 0;
        arrastando = true;
        if (heroCarouselIntervalId) { clearInterval(heroCarouselIntervalId); heroCarouselIntervalId = null; }
        track.style.transition = 'none';
    }, { passive: true });

    track.addEventListener('touchmove', (e) => {
        if (!arrastando) return;
        deltaX = e.touches[0].clientX - startX;
        track.style.transform = `translateX(calc(-${heroCarouselIndex * 100}% + ${deltaX}px))`;
    }, { passive: true });

    track.addEventListener('touchend', () => {
        if (!arrastando) return;
        arrastando = false;
        track.style.transition = '';
        const limiar = track.offsetWidth * 0.18; // ~18% da largura já troca de slide
        if (deltaX < -limiar) {
            avancarHeroCarousel(1);
        } else if (deltaX > limiar) {
            avancarHeroCarousel(-1);
        } else {
            atualizarPosicaoHeroCarousel(false);
            const totalSlides = document.querySelectorAll('#heroCarouselTrack .hero-carousel-slide').length;
            iniciarAutoplayHeroCarousel(totalSlides);
        }
    });
})();

// ========== BANNER ROTATIVO DE PROMOÇÕES (legado — mantida sem uso; a seção que ela
// preenchia foi consolidada no carrossel do topo, ver renderizarHeroCarousel() acima) ==========
function renderizarPromocoes() {
    const track = document.getElementById('promoTrack');
    const dotsContainer = document.getElementById('promoDots');
    if (!track || !dotsContainer) return;

    const promoAtivas = configLoja.promocoes.filter(p => p.ativo);
    const slides = promoAtivas.length > 0 ? promoAtivas : [PROMOCAO_PADRAO];

    track.innerHTML = slides.map(promo => `
        <div class="promo-banner">
            <div class="promo-content">
                <h3>${promo.titulo}</h3>
                <p>${promo.descricao || ''}</p>
            </div>
            <div class="promo-image">
                <img src="${promo.imagem}" alt="${promo.titulo}">
            </div>
        </div>
    `).join('');

    dotsContainer.innerHTML = slides.map((_, i) =>
        `<button type="button" class="promo-dot${i === 0 ? ' active' : ''}" data-index="${i}" aria-label="Ir para promoção ${i + 1}"></button>`
    ).join('');

    promoIndex = 0;
    atualizarPosicaoPromo();

    dotsContainer.querySelectorAll('.promo-dot').forEach(dot => {
        dot.addEventListener('click', () => irParaPromocao(parseInt(dot.dataset.index)));
    });

    // Reinicia a rotação automática (a cada carregamento de configurações)
    if (promoIntervalId) { clearInterval(promoIntervalId); promoIntervalId = null; }
    if (slides.length > 1) {
        promoIntervalId = setInterval(() => avancarPromocao(1), 5000);
    }
}

function atualizarPosicaoPromo() {
    const track = document.getElementById('promoTrack');
    if (!track) return;
    track.style.transform = `translateX(-${promoIndex * 100}%)`;

    document.querySelectorAll('#promoDots .promo-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === promoIndex);
    });
}

function avancarPromocao(direcao) {
    const totalSlides = document.querySelectorAll('#promoTrack .promo-banner').length;
    if (totalSlides === 0) return;
    promoIndex = (promoIndex + direcao + totalSlides) % totalSlides;
    atualizarPosicaoPromo();
}

function irParaPromocao(index) {
    promoIndex = index;
    atualizarPosicaoPromo();
    // Reinicia o timer para não trocar de slide logo após um clique manual
    if (promoIntervalId) { clearInterval(promoIntervalId); promoIntervalId = null; }
    const totalSlides = document.querySelectorAll('#promoTrack .promo-banner').length;
    if (totalSlides > 1) {
        promoIntervalId = setInterval(() => avancarPromocao(1), 5000);
    }
}

document.getElementById('promoPrev')?.addEventListener('click', () => {
    avancarPromocao(-1);
    if (promoIntervalId) { clearInterval(promoIntervalId); promoIntervalId = null; }
    const totalSlides = document.querySelectorAll('#promoTrack .promo-banner').length;
    if (totalSlides > 1) {
        promoIntervalId = setInterval(() => avancarPromocao(1), 5000);
    }
});

document.getElementById('promoNext')?.addEventListener('click', () => {
    avancarPromocao(1);
    if (promoIntervalId) { clearInterval(promoIntervalId); promoIntervalId = null; }
    const totalSlides = document.querySelectorAll('#promoTrack .promo-banner').length;
    if (totalSlides > 1) {
        promoIntervalId = setInterval(() => avancarPromocao(1), 5000);
    }
});

// Pausa a rotação automática quando o mouse está sobre o banner
document.getElementById('promoCarousel')?.addEventListener('mouseenter', () => {
    if (promoIntervalId) { clearInterval(promoIntervalId); promoIntervalId = null; }
});
document.getElementById('promoCarousel')?.addEventListener('mouseleave', () => {
    const totalSlides = document.querySelectorAll('#promoTrack .promo-banner').length;
    if (totalSlides > 1 && !promoIntervalId) {
        promoIntervalId = setInterval(() => avancarPromocao(1), 5000);
    }
});

// ========== ÍCONES DE CATEGORIA (SVG de linha, herdam a cor do texto via currentColor) ==========
const ICONES_CATEGORIA = {
    'todos': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>`,
    'burgers': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9c0-3.3 3.6-6 8-6s8 2.7 8 6"/><line x1="3" y1="11" x2="21" y2="11"/><line x1="3" y1="14" x2="21" y2="14"/><path d="M3 17h18c0 2.2-1.8 4-4 4H7c-2.2 0-4-1.8-4-4z"/></svg>`,
    'pizza': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 3 20h18z"/><circle cx="11" cy="10.5" r="1"/><circle cx="14.5" cy="14" r="1"/><circle cx="9.5" cy="14.5" r="1"/></svg>`,
    'bebidas': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 8h14l-1.4 11.2a2 2 0 0 1-2 1.8H8.4a2 2 0 0 1-2-1.8z"/><line x1="5" y1="8" x2="19" y2="8"/><line x1="15" y1="4" x2="13" y2="8"/></svg>`,
    'acompanhamentos': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 10h14l-1.3 10.2a1.8 1.8 0 0 1-1.8 1.8H8.1a1.8 1.8 0 0 1-1.8-1.8z"/><line x1="9" y1="10" x2="8.5" y2="4"/><line x1="12" y1="10" x2="12" y2="3.5"/><line x1="15" y1="10" x2="15.5" y2="4"/></svg>`,
    'sobremesas': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16"/><path d="M4 20 6 10h12l2 10z"/><path d="M6.5 10 9 20"/><path d="M17.5 10 15 20"/><circle cx="12" cy="6.5" r="1.6"/><line x1="12" y1="8" x2="12" y2="10"/></svg>`,
    'outros': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="1.5"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>`
};

function getIconeCategoria(cat) {
    return ICONES_CATEGORIA[cat] || ICONES_CATEGORIA['outros'];
}

// Nomes de exibição das categorias fixas — usado tanto na visão agrupada ("Todos") quanto
// no cabeçalho de categoria única (ver renderizarProdutos/renderizarProdutosAgrupados).
const NOMES_CATEGORIA = {
    'burgers': 'Burgers',
    'pizza': 'Pizzas',
    'bebidas': 'Bebidas',
    'acompanhamentos': 'Acompanhamentos',
    'sobremesas': 'Sobremesas'
};

// ========== RENDERIZAR CATEGORIAS ==========
function renderizarCategorias() {
    const categorias = ['burgers', 'pizza', 'bebidas', 'acompanhamentos', 'sobremesas'];

    const container = document.getElementById('categoriesContainer');
    container.innerHTML = '';

    // Card "Todos" sempre aparece primeiro
    const cardTodos = document.createElement('div');
    cardTodos.className = 'category-card' + (filtroAtivo === 'todos' ? ' active' : '');
    cardTodos.dataset.category = 'todos';
    cardTodos.innerHTML = `
        <div class="category-icon">${getIconeCategoria('todos')}</div>
        <div class="category-name">Todos</div>
        <small>${allProdutos.length} produtos</small>
    `;
    cardTodos.addEventListener('click', () => filtrarPorCategoria('todos'));
    container.appendChild(cardTodos);

    categorias.forEach(cat => {
        const count = allProdutos.filter(p => p.categoria === cat).length;
        if (count > 0) {
            const card = document.createElement('div');
            card.className = 'category-card' + (filtroAtivo === cat ? ' active' : '');
            card.dataset.category = cat;
            card.innerHTML = `
                <div class="category-icon">${getIconeCategoria(cat)}</div>
                <div class="category-name">${capitalize(cat)}</div>
                <small>${count} produtos</small>
            `;
            card.addEventListener('click', () => filtrarPorCategoria(cat));
            container.appendChild(card);
        }
    });
}

// ========== RENDERIZAR PRODUTOS ==========
// ========== ESTOQUE ==========
// Produtos com controlaEstoque = false (pizzas com sabores, sanduíches com adicionais, pastéis, etc.)
// são feitos na hora e não ficam "esgotados" por aqui — só entram na contagem de vendidos no admin.
function estaEsgotado(produto) {
    return produto.controlaEstoque !== false && (produto.estoque || 0) <= 0;
}

// Quantidade do produto que já está no carrinho (soma todas as variações: sabores/adicionais/obs diferentes)
function quantidadeNoCarrinho(produtoId) {
    return carrinho
        .filter(item => item.id === produtoId)
        .reduce((total, item) => total + item.quantidade, 0);
}

// Monta o elemento DOM de um único card de produto (reutilizado tanto na grade
// única quanto nas grades agrupadas por categoria).
function criarCardProdutoEl(produto) {
    const card = document.createElement('div');
    const esgotado = estaEsgotado(produto);
    card.className = 'product-card' + (esgotado ? ' esgotado' : '');
    card.innerHTML = `
        <div style="position: relative;">
            <img src="${produto.imagem}" alt="${produto.nome}" class="product-image">
            ${esgotado
                ? '<div class="product-badge badge-esgotado">Esgotado</div>'
                : (produto.badge ? `<div class="product-badge">${getBadgeText(produto.badge)}</div>` : '')}
        </div>
        <div class="product-body">
            <h3 class="product-title">${produto.nome}</h3>
            <p class="product-description">${produto.descricao || 'Produto premium'}</p>
            <div class="product-rating">
                <span class="product-stars">★★★★★</span>
                <span>(${getAvaliacoesCount(produto)} avaliações)</span>
            </div>
            <div class="product-footer">
                <span class="product-price">R$ ${produto.preco.toFixed(2)}</span>
                ${esgotado
                    ? `<button class="add-btn" disabled>Esgotado</button>`
                    : `<button class="add-btn" onclick="abrirModalProduto('${produto.id}')">Adicionar</button>`}
            </div>
        </div>
    `;
    return card;
}

// Com "Todos" selecionado e sem busca ativa, agrupa os produtos em uma seção por
// categoria (cada uma com seu próprio título e sua própria grade), em vez de
// misturar tudo numa grade só.
function renderizarProdutosAgrupados(container) {
    container.innerHTML = '';

    const categorias = ['burgers', 'pizza', 'bebidas', 'acompanhamentos', 'sobremesas'];

    // Categorias conhecidas primeiro, na ordem fixa acima; qualquer categoria nova
    // que apareça nos produtos (fora dessa lista) entra ordenada por nome, no final.
    const categoriasExtras = [...new Set(produtos.map(p => p.categoria))]
        .filter(cat => !categorias.includes(cat))
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    [...categorias, ...categoriasExtras].forEach(cat => {
        const itensCategoria = produtos.filter(p => p.categoria === cat);
        if (itensCategoria.length === 0) return;

        const secao = document.createElement('div');
        secao.className = 'category-section';

        const titulo = document.createElement('h4');
        titulo.className = 'category-section-title';
        titulo.innerHTML = `<span class="category-section-icon">${getIconeCategoria(cat)}</span> ${NOMES_CATEGORIA[cat] || capitalize(cat)}`;
        secao.appendChild(titulo);

        const grid = document.createElement('div');
        grid.className = 'products-grid';
        itensCategoria.forEach(produto => grid.appendChild(criarCardProdutoEl(produto)));
        secao.appendChild(grid);

        container.appendChild(secao);
    });
}

function renderizarProdutos(acumular = false) {
    const container = document.getElementById('productsContainer');

    // Fica FORA do container, como irmão dele — precisa limpar em toda renderização
    // (agrupada, categoria única ou vazia), senão troca de filtro empilha título repetido.
    if (!acumular) {
        document.getElementById('categoriaUnicaTitulo')?.remove();
    }

    if (produtos.length === 0) {
        container.classList.remove('products-sections');
        container.classList.add('products-grid');
        container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 40px;">Nenhum produto encontrado 😕</p>';
        document.getElementById('loadMoreBtn').style.display = 'none';
        return;
    }

    const agruparPorCategoria = filtroAtivo === 'todos' && normalizarTexto(termoBusca) === '';

    if (agruparPorCategoria) {
        container.classList.remove('products-grid');
        container.classList.add('products-sections');
        renderizarProdutosAgrupados(container);
        document.getElementById('loadMoreBtn').style.display = 'none';
        return;
    }

    container.classList.remove('products-sections');
    container.classList.add('products-grid');

    if (!acumular) {
        container.innerHTML = '';

        // Categoria única selecionada (não "todos", sem busca): mostra o mesmo cabeçalho
        // com ícone + nome que já aparece na visão agrupada — antes só aparecia em "Todos",
        // o que deixava confuso qual categoria estava sendo exibida.
        const semBusca = normalizarTexto(termoBusca) === '';
        if (filtroAtivo !== 'todos' && semBusca) {
            const titulo = document.createElement('h4');
            titulo.id = 'categoriaUnicaTitulo';
            titulo.className = 'category-section-title';
            titulo.innerHTML = `<span class="category-section-icon">${getIconeCategoria(filtroAtivo)}</span> ${NOMES_CATEGORIA[filtroAtivo] || capitalize(filtroAtivo)}`;
            container.parentElement.insertBefore(titulo, container);
        }
    }

    // Quando acumula (clique em "Carregar Mais"), só renderiza os itens NOVOS dessa página
    // e anexa ao grid existente. Quando não acumula (carga inicial, busca, filtro), sempre
    // mostra do início até a página atual — assim o grid nunca "esquece" o que já tinha
    // aparecido antes, só cresce.
    const inicio = acumular ? (currentPage - 1) * productsPerPage : 0;
    const fim = currentPage * productsPerPage;
    const produtosExibir = produtos.slice(inicio, fim);

    produtosExibir.forEach(produto => container.appendChild(criarCardProdutoEl(produto)));

    // Mostrar botão "Carregar Mais"
    if (fim < produtos.length) {
        document.getElementById('loadMoreBtn').style.display = 'block';
    } else {
        document.getElementById('loadMoreBtn').style.display = 'none';
    }
}

// ========== MODAL PRODUTO ==========
let produtoSelecionado = null;

async function abrirModalProduto(produtoId) {
    produtoSelecionado = await getProductById(produtoId);
    
    if (!produtoSelecionado) {
        showToast('Erro ao carregar produto', 'error');
        return;
    }

    // Revalida no momento do clique (o estoque pode ter mudado desde que a lista foi carregada)
    if (estaEsgotado(produtoSelecionado)) {
        showToast('Esse produto acabou de esgotar 😕', 'error');
        renderizarProdutos();
        return;
    }

    document.getElementById('modalImage').src = produtoSelecionado.imagem;
    document.getElementById('modalTitle').textContent = produtoSelecionado.nome;
    document.getElementById('modalDescription').textContent = produtoSelecionado.descricao || 'Produto premium de qualidade';
    document.getElementById('modalPrice').textContent = `R$ ${produtoSelecionado.preco.toFixed(2)}`;
    document.getElementById('modalRating').textContent = '★★★★★';
    document.getElementById('modalReviews').textContent = `(${getAvaliacoesCount(produtoSelecionado)} avaliações)`;
    document.getElementById('quantityInput').value = '1';
    document.getElementById('observacoes').value = '';

    const addBtn = document.getElementById('addToCartBtn');
    addBtn.disabled = false;
    addBtn.textContent = 'Adicionar ao Carrinho';

    const badgeEl = document.getElementById('modalBadge');
    if (produtoSelecionado.badge) {
        badgeEl.textContent = getBadgeText(produtoSelecionado.badge);
        badgeEl.style.display = 'inline-block';
    } else {
        badgeEl.style.display = 'none';
    }

    saboresSelecionados = [];
    saborBaseAtual = null;
    adicionaisSelecionados = [];
    renderizarOpcoesProduto();

    abrirModal('productModal');
}

// Mostra/monta os checkboxes de sabores (pizza) e adicionais (sanduíches) de acordo com a categoria
function renderizarOpcoesProduto() {
    const saboresGroup = document.getElementById('saboresGroup');
    const saboresList = document.getElementById('saboresOptionsList');
    const adicionaisGroup = document.getElementById('adicionaisGroup');
    const adicionaisList = document.getElementById('adicionaisOptionsList');

    saboresList.innerHTML = '';
    adicionaisList.innerHTML = '';

    const ehPizza = produtoSelecionado.categoria === 'pizza' && configLoja.saboresPizza.length > 0;
    const ehSanduiche = produtoSelecionado.categoria === 'burgers' && configLoja.adicionaisSanduiche.length > 0;
    const ehBebida = produtoSelecionado.categoria === 'bebidas';

    saboresGroup.style.display = ehPizza ? 'block' : 'none';
    adicionaisGroup.style.display = ehSanduiche ? 'block' : 'none';

    // Bebida vem pronta de fábrica (lata, garrafa) — não faz sentido pedir "sem cebola,
    // sem molho" pra uma Coca-Cola. Esconde o campo só nesse caso, sem remover do DOM
    // (mantém o resto do fluxo de adicionarAoCarrinho() funcionando igual, só que sempre
    // com observações vazias).
    const observacoesEl = document.getElementById('observacoes');
    if (observacoesEl) {
        observacoesEl.style.display = ehBebida ? 'none' : 'block';
        if (ehBebida) observacoesEl.value = '';
    }

    if (ehPizza) {
        // SEMPRE garante um sabor "de origem" travado, mesmo que o nome do produto não
        // coincida com nenhum sabor cadastrado na lista global (ver obterSaborBaseDoProduto).
        saborBaseAtual = obterSaborBaseDoProduto(produtoSelecionado, configLoja.saboresPizza);
        if (saborBaseAtual && saboresSelecionados.length === 0) {
            saboresSelecionados = [saborBaseAtual.nome];
        }

        // Se o sabor original foi SINTETIZADO (não existe na lista cadastrada — ex: "Bacon"
        // nunca foi cadastrado como sabor separado), ele não vai aparecer no forEach abaixo,
        // então cria essa linha travada manualmente, antes dos sabores de verdade.
        if (saborBaseAtual?.avulso) {
            const linhaBase = document.createElement('label');
            linhaBase.className = 'option-item sabor-base';
            linhaBase.innerHTML = `
                <input type="checkbox" value="${saborBaseAtual.nome}" checked disabled>
                <span>${saborBaseAtual.nome}</span>
                <span class="option-price" style="color:#999; font-size:12px;">sabor original</span>
            `;
            saboresList.appendChild(linhaBase);
        }

        configLoja.saboresPizza.forEach(sabor => {
            const ehSaborBase = saborBaseAtual && !saborBaseAtual.avulso && sabor.nome === saborBaseAtual.nome;
            const jaSelecionado = saboresSelecionados.includes(sabor.nome);

            const label = document.createElement('label');
            label.className = 'option-item' + (ehSaborBase ? ' sabor-base' : '');
            label.innerHTML = `
                <input type="checkbox" value="${sabor.nome}" ${jaSelecionado ? 'checked' : ''} ${ehSaborBase ? 'disabled' : ''}>
                <span>${sabor.nome}</span>
                ${ehSaborBase ? '<span class="option-price" style="color:#999; font-size:12px;">sabor original</span>' : ''}
            `;

            if (!ehSaborBase) {
                const checkbox = label.querySelector('input');
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) {
                        if (saboresSelecionados.length >= 2) {
                            checkbox.checked = false;
                            showToast('Você pode combinar no máximo mais 1 sabor', 'error');
                            return;
                        }
                        saboresSelecionados.push(sabor.nome);
                    } else {
                        saboresSelecionados = saboresSelecionados.filter(s => s !== sabor.nome);
                    }
                    atualizarEstadoCheckboxesSabores();
                    atualizarTotalItemModal();
                });
            }
            saboresList.appendChild(label);
        });
        atualizarEstadoCheckboxesSabores();
    }

    if (ehSanduiche) {
        configLoja.adicionaisSanduiche.forEach(adicional => {
            const label = document.createElement('label');
            label.className = 'option-item';
            label.innerHTML = `
                <input type="checkbox" value="${adicional.nome}" data-preco="${adicional.preco}">
                <span>${adicional.nome}</span>
                <span class="option-price">+ R$ ${Number(adicional.preco).toFixed(2)}</span>
            `;
            const checkbox = label.querySelector('input');
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    adicionaisSelecionados.push({ nome: adicional.nome, preco: adicional.preco });
                } else {
                    adicionaisSelecionados = adicionaisSelecionados.filter(a => a.nome !== adicional.nome);
                }
                atualizarTotalItemModal();
            });
            adicionaisList.appendChild(label);
        });
    }

    atualizarTotalItemModal();
}

// Tenta casar o nome do produto (ex: "Pizza Calabresa") com um sabor cadastrado (ex:
// "Calabresa"), ignorando acento/caixa e o prefixo "Pizza". Se não achar (nome do produto
// não bate com nada da lista de sabores), devolve null — nesse caso o sistema cai no
// comportamento antigo: cliente escolhe livremente até 2 sabores, nenhum vem travado.
// Tenta casar o nome do produto (ex: "Pizza Calabresa") com um sabor JÁ CADASTRADO na
// lista global de sabores (ex: "Calabresa"). Isso é só pra reaproveitar o mesmo texto/
// visual quando existe — NÃO é obrigatório pro sabor original funcionar (ver
// obterSaborBaseDoProduto abaixo, que sempre garante um sabor mesmo sem essa coincidência).
function encontrarSaborBaseDoProduto(produto, saboresPizza) {
    if (!produto || !Array.isArray(saboresPizza)) return null;
    const normalizar = (texto) => (texto || '')
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/^pizza\s+/, '')
        .trim();
    const nomeProdutoNormalizado = normalizar(produto.nome);
    return saboresPizza.find(s => normalizar(s.nome) === nomeProdutoNormalizado) || null;
}

// Tira o prefixo "Pizza " (com essa grafia ou variações de caixa) do nome do produto,
// preservando a caixa do resto — "Pizza Bacon" -> "Bacon", "PIZZA quatro queijos" ->
// "quatro queijos". Usado só quando não existe sabor cadastrado com o mesmo nome.
function nomeSemPrefixoPizza(nome) {
    return (nome || '').replace(/^pizza\s+/i, '').trim();
}

// SEMPRE devolve um sabor original pra travar no modal — nunca null. Prioridade:
// 1) um sabor com esse nome já cadastrado na lista global (reaproveita o mesmo objeto);
// 2) se não existir (ex: "Bacon" não está cadastrado como sabor, só como nome de pizza),
//    sintetiza um sabor "avulso" a partir do próprio nome do produto. Isso garante que
//    TODA pizza trave o sabor original, independente de coincidir com a lista do admin —
//    antes disso, "Pizza Bacon" ficava sem nenhum sabor travado só porque "Bacon" nunca
//    tinha sido cadastrado separadamente como sabor.
function obterSaborBaseDoProduto(produto, saboresPizza) {
    const encontrado = encontrarSaborBaseDoProduto(produto, saboresPizza);
    if (encontrado) return encontrado;

    const nome = nomeSemPrefixoPizza(produto?.nome);
    return nome ? { nome, avulso: true } : null;
}

// Desabilita visualmente os sabores não marcados quando o limite de 2 já foi atingido.
// O sabor original (.sabor-base) nunca passa por aqui — ele fica sempre marcado e
// desabilitado desde que foi criado, então não faz sentido essa função mexer nele.
function atualizarEstadoCheckboxesSabores() {
    const items = document.querySelectorAll('#saboresOptionsList .option-item');
    items.forEach(item => {
        if (item.classList.contains('sabor-base')) return;
        const checkbox = item.querySelector('input');
        const limiteAtingido = saboresSelecionados.length >= 2;
        if (!checkbox.checked && limiteAtingido) {
            item.classList.add('disabled');
            checkbox.disabled = true;
        } else {
            item.classList.remove('disabled');
            checkbox.disabled = false;
        }
    });
}

// Calcula preço unitário do item no modal (produto + adicionais) e mostra o total considerando a quantidade
function calcularPrecoUnitarioSelecionado() {
    if (!produtoSelecionado) return 0;
    const totalAdicionais = adicionaisSelecionados.reduce((soma, a) => soma + Number(a.preco), 0);
    return produtoSelecionado.preco + totalAdicionais;
}

function atualizarTotalItemModal() {
    const linha = document.getElementById('itemTotalLine');
    if (!produtoSelecionado || !linha) return;
    const quantidade = parseInt(document.getElementById('quantityInput').value) || 1;
    const precoUnitario = calcularPrecoUnitarioSelecionado();
    linha.textContent = `Total do item: R$ ${(precoUnitario * quantidade).toFixed(2)}`;
}

// ========== CARRINHO ==========
function adicionarAoCarrinho() {
    const quantidade = parseInt(document.getElementById('quantityInput').value);
    const observacoes = document.getElementById('observacoes').value;

    if (quantidade < 1) {
        showToast('Quantidade inválida', 'error');
        return;
    }

    // Só exige escolha manual de sabor no caso raro em que o nome do produto não bate com
    // nenhum sabor cadastrado (saborBaseAtual null) — normalmente o sabor original já vem
    // incluso automaticamente, e o segundo sabor é sempre opcional.
    if (produtoSelecionado.categoria === 'pizza' && configLoja.saboresPizza.length > 0 && !saborBaseAtual && saboresSelecionados.length === 0) {
        showToast('Escolha pelo menos 1 sabor', 'error');
        return;
    }

    // Checa estoque disponível (considerando o que já está no carrinho) para produtos com controle de estoque
    if (produtoSelecionado.controlaEstoque !== false) {
        const jaNoCarrinho = quantidadeNoCarrinho(produtoSelecionado.id);
        const disponivel = (produtoSelecionado.estoque || 0) - jaNoCarrinho;
        if (quantidade > disponivel) {
            showToast(
                disponivel > 0
                    ? `Só temos mais ${disponivel} unidade(s) disponível(is) desse produto`
                    : 'Esse produto está esgotado',
                'error'
            );
            return;
        }
    }

    const itemCarrinho = {
        id: produtoSelecionado.id,
        nome: produtoSelecionado.nome,
        preco: calcularPrecoUnitarioSelecionado(),
        quantidade: quantidade,
        imagem: produtoSelecionado.imagem,
        observacoes: observacoes,
        sabores: [...saboresSelecionados],
        adicionais: adicionaisSelecionados.map(a => ({ ...a }))
    };

    // Verificar se já existe um item idêntico no carrinho (mesmo produto, obs, sabores e adicionais)
    const itemExistente = carrinho.find(item =>
        item.id === itemCarrinho.id &&
        item.observacoes === itemCarrinho.observacoes &&
        JSON.stringify(item.sabores || []) === JSON.stringify(itemCarrinho.sabores) &&
        JSON.stringify(item.adicionais || []) === JSON.stringify(itemCarrinho.adicionais)
    );

    if (itemExistente) {
        itemExistente.quantidade += quantidade;
    } else {
        carrinho.push(itemCarrinho);
    }

    salvarCarrinho();
    atualizarCarrinho();
    fecharModal('productModal');
    showToast(`${produtoSelecionado.nome} adicionado ao carrinho!`, 'success');
}

function removerDoCarrinho(index) {
    carrinho.splice(index, 1);
    salvarCarrinho();
    atualizarCarrinho();
    showToast('Item removido do carrinho', 'success');
}

// Stepper +/- do item no carrinho. Ao chegar em 0, remove o item (mesmo comportamento
// do botão de lixeira). Respeita o mesmo limite de estoque usado em adicionarAoCarrinho.
function alterarQuantidadeCarrinho(index, delta) {
    const item = carrinho[index];
    if (!item) return;

    const novaQuantidade = item.quantidade + delta;
    if (novaQuantidade < 1) {
        removerDoCarrinho(index);
        return;
    }

    if (delta > 0) {
        const produtoOriginal = allProdutos.find(p => p.id === item.id);
        if (produtoOriginal && produtoOriginal.controlaEstoque !== false) {
            const disponivel = produtoOriginal.estoque || 0;
            if (novaQuantidade > disponivel) {
                showToast(`Só temos mais ${disponivel} unidade(s) disponível(is) desse produto`, 'error');
                return;
            }
        }
    }

    item.quantidade = novaQuantidade;
    salvarCarrinho();
    atualizarCarrinho();
}

// O carrinho é só de memória — não persiste no localStorage de propósito, pra sempre
// começar vazio em cada nova visita/sessão (recarregar a página zera o carrinho).
function salvarCarrinho() {
    // Intencionalmente vazio — sem persistência.
}

function carregarCarrinho() {
    localStorage.removeItem('carrinho'); // limpa resíduo de versões antigas que persistiam o carrinho
    carrinho = [];
    atualizarCarrinho();
}

function atualizarCarrinho() {
    const container = document.getElementById('cartItems');
    const countEl = document.getElementById('cartCount');
    const summaryEl = document.getElementById('cartSummary');
    const checkoutEl = document.getElementById('checkoutSection');
    const clearBtn = document.getElementById('clearCartBtn');
    const footerEl = document.getElementById('cartFooter');

    countEl.textContent = carrinho.length;
    const bottomCountEl = document.getElementById('bottomNavCartCount');
    if (bottomCountEl) bottomCountEl.textContent = carrinho.length;
    clearBtn.style.display = carrinho.length > 0 ? 'inline' : 'none';

    if (carrinho.length === 0) {
        container.innerHTML = `
            <div class="empty-cart-state">
                <img class="empty-cart-illustration" src="carrinho-vazio.png" alt="Seu carrinho está vazio"
                     onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
                <p class="empty-cart-fallback-title" style="display:none;">Seu carrinho está vazio</p>
                <button type="button" class="empty-cart-cta" id="emptyCartVerCardapioBtn">Ver cardápio</button>
            </div>
        `;
        document.getElementById('emptyCartVerCardapioBtn')?.addEventListener('click', () => {
            document.getElementById('cartSidebar').classList.remove('active');
            document.getElementById('overlay').classList.remove('active');
        });
        summaryEl.style.display = 'none';
        checkoutEl.style.display = 'none';
        footerEl.style.display = 'none';
        atualizarCarrinhoFlutuante(0, 0);
        return;
    }

    container.innerHTML = '';
    let subtotal = 0;

    carrinho.forEach((item, index) => {
        const itemTotal = item.preco * item.quantidade;
        subtotal += itemTotal;

        const saboresTexto = item.sabores && item.sabores.length > 0
            ? `<small style="color: #999;">🍕 Sabores: ${item.sabores.join(' + ')}</small>`
            : '';
        const adicionaisTexto = item.adicionais && item.adicionais.length > 0
            ? `<small style="color: #999;">➕ ${item.adicionais.map(a => a.nome).join(', ')}</small>`
            : '';

        const itemEl = document.createElement('div');
        itemEl.className = 'cart-item';
        itemEl.innerHTML = `
            <img src="${item.imagem}" alt="${item.nome}" class="cart-item-image">
            <div class="cart-item-info">
                <div class="cart-item-title">${item.nome}</div>
                <div class="cart-item-qty">${item.quantidade}x R$ ${item.preco.toFixed(2)}</div>
                ${saboresTexto}
                ${adicionaisTexto}
                ${item.observacoes ? `<small style="color: #999;">📝 ${item.observacoes}</small>` : ''}
                <div class="cart-item-price">R$ ${itemTotal.toFixed(2)}</div>
            </div>
            <div class="cart-item-actions">
                <div class="cart-item-stepper">
                    <button type="button" class="stepper-btn stepper-minus" onclick="alterarQuantidadeCarrinho(${index}, -1)" aria-label="Diminuir quantidade">−</button>
                    <span class="stepper-value">${item.quantidade}</span>
                    <button type="button" class="stepper-btn stepper-plus" onclick="alterarQuantidadeCarrinho(${index}, 1)" aria-label="Aumentar quantidade">+</button>
                </div>
                <button class="cart-item-remove" onclick="removerDoCarrinho(${index})" aria-label="Remover item">🗑️</button>
            </div>
        `;
        container.appendChild(itemEl);
    });

    // Atualizar resumo (taxa só se for delivery; retirada é grátis)
    const taxaEntrega = obterTaxaEntregaSelecionada();
    const economiaCupom = calcularEconomiaCupom();
    const total = Math.max(0, subtotal + taxaEntrega - economiaCupom);

    document.getElementById('subtotalPrice').textContent = `R$ ${subtotal.toFixed(2)}`;
    document.getElementById('deliveryPrice').textContent = taxaEntrega > 0 ? `R$ ${taxaEntrega.toFixed(2)}` : 'Grátis';

    const cupomDescontoRow = document.getElementById('cupomDescontoRow');
    if (cupomDescontoRow) {
        if (cupomAplicado && economiaCupom > 0) {
            cupomDescontoRow.style.display = 'flex';
            document.getElementById('cupomDescontoValor').textContent = economiaCupom.toFixed(2);
        } else {
            cupomDescontoRow.style.display = 'none';
        }
    }

    // Mantém o "você economiza R$ X" do card de cupom aplicado em sincronia com o
    // carrinho. Esse card só é preenchido em atualizarExibicaoCupom(), chamada apenas
    // quando o cupom é aplicado/removido — se o carrinho mudar depois disso (item
    // adicionado/removido), o card ficava com o valor antigo (ex: R$ 0.00, calculado
    // quando o cupom de fidelidade foi aplicado com o carrinho ainda vazio no load).
    if (cupomAplicado) {
        const economiaBadgeEl = document.getElementById('cuponAplicadoEconomia');
        if (economiaBadgeEl) economiaBadgeEl.textContent = economiaCupom.toFixed(2);
    }

    document.getElementById('totalPrice').textContent = `R$ ${total.toFixed(2)}`;

    summaryEl.style.display = 'block';
    checkoutEl.style.display = 'block';
    footerEl.style.display = 'block';

    atualizarCarrinhoFlutuante(carrinho.length, total);
}

// Espelha a contagem/total no botão fixo embaixo da tela (mobile). Some quando
// o carrinho está vazio; o CSS também some quando o carrinho lateral está aberto.
function atualizarCarrinhoFlutuante(quantidadeItens, total) {
    const barra = document.getElementById('floatingCartBar');
    if (!barra) return;

    if (quantidadeItens === 0) {
        barra.classList.remove('show');
        return;
    }

    document.getElementById('floatingCartCount').textContent = quantidadeItens;
    document.getElementById('floatingCartTotal').textContent = `R$ ${total.toFixed(2)}`;
    barra.classList.add('show');
}

// Lê o tipo de entrega marcado no momento e retorna a taxa correta (com base no bairro escolhido)
function obterTaxaEntregaSelecionada() {
    const radioSelecionado = document.querySelector('input[name="delivery"]:checked');
    const tipoEntrega = radioSelecionado ? radioSelecionado.value : 'retirada';
    if (tipoEntrega !== 'delivery') return 0;

    // Cálculo automático por km tem prioridade quando está ativo e deu certo pra esse
    // endereço. Se falhou (endereço não encontrado, fora da área, etc.), cai pro bairro
    // manual abaixo normalmente — freteAutoResultado fica null nesses casos.
    if (configLoja.calculoPorKm?.ativo && freteAutoResultado?.taxa != null) {
        return freteAutoResultado.taxa;
    }

    const bairroSelect = document.getElementById('clientBairro');
    const opcaoSelecionada = bairroSelect?.selectedOptions?.[0];

    if (opcaoSelecionada && opcaoSelecionada.value) {
        return parseFloat(opcaoSelecionada.dataset.taxa) || 0;
    }

    return configLoja.taxaEntrega;
}

// ========== FILTROS ==========
function filtrarPorCategoria(categoria) {
    filtroAtivo = categoria;
    currentPage = 1;

    // Atualizar cards de categoria (marca o clicado como ativo)
    document.querySelectorAll('.category-card').forEach(card => {
        card.classList.toggle('active', card.dataset.category === categoria);
    });

    aplicarFiltrosCombinados();
}

// Remove acentos para permitir buscas como "acai" encontrar "açaí"
function normalizarTexto(str) {
    return (str || '')
        .toString()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .trim();
}

// Aplica categoria + busca juntas sobre allProdutos e re-renderiza
function aplicarFiltrosCombinados() {
    let resultado = filtroAtivo !== 'todos'
        ? allProdutos.filter(p => p.categoria === filtroAtivo)
        : [...allProdutos];

    const termo = normalizarTexto(termoBusca);
    if (termo !== '') {
        resultado = resultado.filter(p =>
            normalizarTexto(p.nome).includes(termo) ||
            normalizarTexto(p.descricao).includes(termo) ||
            normalizarTexto(p.categoria).includes(termo)
        );
    }

    produtos = resultado;
    renderizarProdutos();
}

// ========== BUSCA ==========
const searchInputEl = document.getElementById('searchInput');
if (searchInputEl) {
    let debounceBuscaId = null;
    searchInputEl.addEventListener('input', (e) => {
        const valor = e.target.value;
        clearTimeout(debounceBuscaId);
        debounceBuscaId = setTimeout(() => {
            termoBusca = valor;
            currentPage = 1;
            aplicarFiltrosCombinados();
        }, 300);
    });
}

// ========== CARRINHO LATERAL ==========
document.getElementById('cartBtn').addEventListener('click', () => {
    document.getElementById('cartSidebar').classList.add('active');
    document.getElementById('overlay').classList.add('active');
});

document.getElementById('floatingCartBar')?.addEventListener('click', () => {
    document.getElementById('cartSidebar').classList.add('active');
    document.getElementById('overlay').classList.add('active');
});

document.getElementById('bottomNavCartBtn')?.addEventListener('click', () => {
    document.getElementById('cartSidebar').classList.add('active');
    document.getElementById('overlay').classList.add('active');
});

// Marca visualmente qual item da barra inferior está ativo (só estética — cada link já
// navega normalmente pelo href/scroll, isso só resolve o destaque de qual está selecionado).
document.querySelectorAll('.bottom-nav-item[href], .bottom-nav-item[data-scroll-top]').forEach(item => {
    item.addEventListener('click', (e) => {
        if (item.hasAttribute('data-scroll-top')) {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        document.querySelectorAll('.bottom-nav-item').forEach(i => i.classList.remove('active'));
        item.classList.add('active');
    });
});

document.getElementById('closeCart').addEventListener('click', () => {
    document.getElementById('cartSidebar').classList.remove('active');
    document.getElementById('overlay').classList.remove('active');
});

document.getElementById('clearCartBtn').addEventListener('click', () => {
    if (carrinho.length === 0) return;
    if (!confirm('Esvaziar o carrinho? Isso remove todos os itens adicionados.')) return;
    carrinho = [];
    salvarCarrinho();
    atualizarCarrinho();
    showToast('Carrinho esvaziado', 'info');
});

document.getElementById('overlay').addEventListener('click', () => {
    document.getElementById('cartSidebar').classList.remove('active');
    document.getElementById('overlay').classList.remove('active');
    fecharModal('productModal');
});

// ========== CHECKOUT / WhatsApp ==========
document.addEventListener('change', (e) => {
    if (e.target.name === 'delivery') {
        const addressField = document.getElementById('clientAddress');
        const bairroField = document.getElementById('clientBairro');
        if (e.target.value === 'delivery') {
            addressField.style.display = 'block';
            addressField.required = true;
            bairroField.style.display = 'block';
            bairroField.required = true;
        } else {
            addressField.style.display = 'none';
            addressField.required = false;
            bairroField.style.display = 'none';
            bairroField.required = false;
        }
        // Recalcular subtotal/taxa/total do carrinho com o novo tipo de entrega
        atualizarCarrinho();
    }

    if (e.target.id === 'clientBairro') {
        // Recalcular total ao trocar de bairro (taxa muda conforme o bairro)
        atualizarCarrinho();
    }
});

// Campo de endereço: dispara a prévia de sugestões (debounce curto) e o cálculo automático
// de frete por km como fallback (debounce mais longo, caso o cliente não clique em nenhuma
// sugestão e mande o texto puro). Não faz nada se calculoPorKm estiver desativado no admin.
document.getElementById('clientAddress').addEventListener('input', () => {
    freteAutoResultado = null; // texto mudou — invalida qualquer sugestão selecionada antes
    agendarBuscaSugestoesEndereco();
    agendarCalculoFreteAutomatico();
});
document.getElementById('clientAddress').addEventListener('keydown', navegarSugestoesEndereco);
document.getElementById('clientAddress').addEventListener('focus', agendarBuscaSugestoesEndereco);

// Fecha a lista de sugestões ao clicar fora do campo/dropdown.
document.addEventListener('click', (e) => {
    const wrap = document.querySelector('.endereco-sugestoes-wrap');
    if (wrap && !wrap.contains(e.target)) esconderSugestoesEndereco();
});

// ========== FORMA DE PAGAMENTO ==========
document.getElementById('paymentMethodsGrid').addEventListener('change', (e) => {
    if (e.target.name !== 'paymentMethod') return;

    document.querySelectorAll('.payment-method-option').forEach(opt => opt.classList.remove('selected'));
    e.target.closest('.payment-method-option')?.classList.add('selected');
    document.getElementById('paymentMethodsGrid').classList.remove('input-error');

    const trocoWrap = document.getElementById('paymentTrocoWrap');
    if (e.target.value === 'dinheiro') {
        trocoWrap.classList.add('show');
    } else {
        trocoWrap.classList.remove('show');
        document.getElementById('paymentTroco').value = '';
    }
});

document.getElementById('checkoutBtn').addEventListener('click', async () => {
    const statusAgora = calcularStatusLoja(configLoja);
    if (statusAgora.controlado && !statusAgora.aberta) {
        atualizarStatusLoja();
        const proxima = statusAgora.proximaAbertura
            ? ` Voltamos ${statusAgora.proximaAbertura.label} às ${statusAgora.proximaAbertura.hora}.`
            : '';
        showToast(`Estamos fechados no momento.${proxima}`, 'error');
        return;
    }

    const nomeInput = document.getElementById('clientName');
    const telefoneInput = document.getElementById('clientPhone');
    const enderecoInput = document.getElementById('clientAddress');
    const bairroSelect = document.getElementById('clientBairro');

    const nome = nomeInput.value.trim();
    const telefone = telefoneInput.value.trim();
    const tipoEntrega = document.querySelector('input[name="delivery"]:checked').value;
    const endereco = enderecoInput.value.trim();
    const bairro = tipoEntrega === 'delivery' ? bairroSelect.value : '';
    const observacoes = document.getElementById('orderObservations').value.trim();
    const aceitaPromocao = document.getElementById('aceitaPromocaoInput')?.checked === true;

    const metodoPagamentoInput = document.querySelector('input[name="paymentMethod"]:checked');
    const formaPagamento = metodoPagamentoInput ? metodoPagamentoInput.value : '';
    const trocoInput = document.getElementById('paymentTroco');
    const trocoPara = formaPagamento === 'dinheiro' ? trocoInput.value.trim() : '';

    // Limpar destaques de erro anteriores
    [nomeInput, telefoneInput, enderecoInput, bairroSelect].forEach(el => el.classList.remove('input-error'));
    document.getElementById('paymentMethodsGrid').classList.remove('input-error');

    // Validar campos obrigatórios
    if (!nome) {
        nomeInput.classList.add('input-error');
        showToast('Preencha seu nome!', 'error');
        nomeInput.focus();
        return;
    }

    if (!telefone) {
        telefoneInput.classList.add('input-error');
        showToast('Preencha seu telefone!', 'error');
        telefoneInput.focus();
        return;
    }

    // Bairro só é obrigatório quando o cálculo automático por km NÃO resolveu o frete —
    // nesses casos o select de bairro fica visível como fallback. Se o cálculo automático
    // já achou uma taxa válida, o select fica escondido e não deve bloquear o checkout.
    const usandoFreteAutomatico = configLoja.calculoPorKm?.ativo && freteAutoResultado?.taxa != null;

    if (tipoEntrega === 'delivery' && !bairro && !usandoFreteAutomatico) {
        bairroSelect.classList.add('input-error');
        showToast('Selecione o bairro de entrega!', 'error');
        bairroSelect.focus();
        return;
    }

    if (tipoEntrega === 'delivery' && !endereco) {
        enderecoInput.classList.add('input-error');
        showToast('Preencha o endereço para entrega!', 'error');
        enderecoInput.focus();
        return;
    }

    if (!formaPagamento) {
        document.getElementById('paymentMethodsGrid').classList.add('input-error');
        showToast('Escolha a forma de pagamento!', 'error');
        document.getElementById('paymentMethodsGrid').scrollIntoView({ behavior: 'smooth', block: 'center' });
        return;
    }

    if (carrinho.length === 0) {
        showToast('Carrinho vazio!', 'error');
        return;
    }

    // Revalida o estoque na hora de fechar o pedido (pode ter mudado desde que o item foi adicionado)
    const checkoutBtn = document.getElementById('checkoutBtn');
    checkoutBtn.disabled = true;
    checkoutBtn.textContent = 'Verificando estoque...';
    const estoqueOk = await validarEstoqueCarrinho();
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = 'Finalizar Pedido no WhatsApp';
    if (!estoqueOk) return;

    // Gerar código do pedido (mesmo código vai pro cliente no WhatsApp e pro Firestore)
    const codigoPedido = gerarCodigoPedido();
    const taxaEntregaPedido = tipoEntrega === 'delivery' ? obterTaxaEntregaSelecionada() : 0;

    // Loja com cobrança automática ativada + forma de pagamento que passa pelo gateway
    // (dinheiro na entrega nunca usa isso) → o pedido nasce "aguardando_pagamento" e só
    // libera pra cozinha/painel depois que o webhook do PagBank confirmar (ver mais abaixo).
    const usaPagamentoOnline = formaPagamento !== 'dinheiro' && configLoja.configuracoes?.pagamentoOnline?.ativo === true;

    // Salvar pedido no Firebase PRIMEIRO — precisamos do ID gerado pelo Firestore pra
    // montar o link de rastreamento antes de montar a mensagem do WhatsApp.
    const pedidoSalvo = await salvarPedidoFirebase({
        codigoPedido,
        nome,
        telefone,
        tipoEntrega,
        endereco,
        bairro: bairro || freteAutoResultado?.bairro || '',
        observacoes,
        itens: carrinho,
        total: calcularTotal(tipoEntrega),
        taxaEntrega: taxaEntregaPedido,
        formaPagamento,
        trocoPara: trocoPara || null,
        status: usaPagamentoOnline ? 'aguardando_pagamento' : 'pendente',
        cupom: cupomAplicado ? {
            id: cupomAplicado.id,
            codigo: cupomAplicado.codigo,
            desconto: cupomAplicado.desconto,
            economia: calcularEconomiaCupom()
        } : null
    });

    const linkRastreio = pedidoSalvo
        ? `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}rastreio.html?loja=${obterLojaAtual()}&id=${pedidoSalvo.id}`
        : null;

    if (pedidoSalvo) salvarDadosClienteLocal(nome, telefone);

    // Cadastra/atualiza o cliente (nome, telefone, endereço, histórico de compras) —
    // nunca trava o pedido se der erro, é um "extra" em cima da venda que já foi salva.
    if (pedidoSalvo) {
        try {
            await upsertCliente({
                nome, telefone,
                endereco: tipoEntrega === 'delivery' ? endereco : '',
                bairro: tipoEntrega === 'delivery' ? (bairro || freteAutoResultado?.bairro || '') : '',
                total: calcularTotal(tipoEntrega),
                aceitaPromocao
            });
        } catch (error) {
            console.error('Erro ao salvar cadastro do cliente:', error);
        }
    }

    // Cupom usado com sucesso: soma no contador de usos (não trava o pedido se falhar).
    // Se foi desconto de fidelidade (sem id de cupom de verdade), marca a recompensa como
    // usada em vez disso — outro fluxo, mesmo espírito.
    if (pedidoSalvo && cupomAplicado) {
        try {
            if (cupomAplicado.ehFidelidade) {
                await resgatarRecompensaFidelidade(cupomAplicado.telefoneId);
            } else {
                await incrementarUsoCupom(cupomAplicado.id);
            }
        } catch (error) {
            console.error('Erro ao registrar uso do cupom/fidelidade:', error);
        }
    }

    const dadosParaWhatsApp = { nome, telefone, tipoEntrega, endereco, bairro, observacoes, codigoPedido, linkRastreio, formaPagamento, trocoPara };

    // Loja com cobrança automática ativada + forma de pagamento que passa pelo gateway
    // (dinheiro na entrega nunca usa isso, óbvio) → não manda pro WhatsApp ainda. Primeiro
    // o cliente paga numa aba do PagBank, só DEPOIS que o pagamento for confirmado
    // (webhook -> Firestore -> observarPagamentoPedido abaixo) que o pedido é liberado.
    if (usaPagamentoOnline && pedidoSalvo) {
        try {
            const { url } = await iniciarPagamentoOnline(obterLojaAtual(), pedidoSalvo.id, window.location.href);
            window.open(url, '_blank');
            iniciarEsperaPagamento(pedidoSalvo.id, url, dadosParaWhatsApp);
        } catch (error) {
            console.error('Erro ao iniciar pagamento online:', error);
            showToast('Não foi possível abrir o pagamento agora. Tente de novo ou escolha "Dinheiro".', 'error');
        }
        return;
    }

    finalizarEnvioWhatsApp(dadosParaWhatsApp);
});

// Monta a mensagem, abre o WhatsApp e limpa o carrinho — usado tanto pelo fluxo de sempre
// (forma de pagamento sem gateway) quanto pelo fluxo de pagamento online, DEPOIS que o
// pagamento é confirmado (ver iniciarEsperaPagamento).
function finalizarEnvioWhatsApp(dados) {
    const { nome, telefone, tipoEntrega, endereco, bairro, observacoes, codigoPedido, linkRastreio, formaPagamento, trocoPara } = dados;

    const mensagem = gerarMensagemWhatsApp(nome, telefone, tipoEntrega, endereco, bairro, observacoes, codigoPedido, linkRastreio, formaPagamento, trocoPara);

    const numeroWhatsApp = apenasNumeros(configLoja.telefone) || WHATSAPP_NUMBER_PADRAO;
    const urlWhatsApp = `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensagem)}`;
    window.open(urlWhatsApp, '_blank');

    // Limpar carrinho (nome e telefone ficam preenchidos de propósito — foram
    // salvos acima pra não precisar redigitar no próximo pedido)
    carrinho = [];
    salvarCarrinho();
    cupomAplicado = null;
    document.getElementById('fidelidadeBanner').style.display = 'none';
    atualizarExibicaoCupom();
    atualizarCarrinho();
    document.getElementById('clientAddress').value = '';
    document.getElementById('clientBairro').value = '';
    freteAutoResultado = null;
    mostrarStatusFreteAuto('', null);
    exibirSelectBairroComoFallback(false);
    document.getElementById('orderObservations').value = '';
    document.querySelectorAll('input[name="paymentMethod"]').forEach(r => r.checked = false);
    document.querySelectorAll('.payment-method-option').forEach(opt => opt.classList.remove('selected'));
    document.getElementById('paymentTrocoWrap').classList.remove('show');
    document.getElementById('paymentTroco').value = '';

    document.getElementById('cartSidebar').classList.remove('active');
    document.getElementById('overlay').classList.remove('active');

    if (linkRastreio) {
        mostrarConfirmacaoComRastreio(linkRastreio);
    } else {
        showToast('Pedido enviado para WhatsApp!', 'success');
    }
}

// ========== PAGAMENTO ONLINE — TELA DE ESPERA ==========
// Troca o formulário de checkout por uma tela de "aguardando pagamento" e fica ouvindo o
// pedido em tempo real (Firestore onSnapshot) esperando o webhook do PagBank confirmar.
let pararDeObservarPagamento = null;

function iniciarEsperaPagamento(pedidoId, urlPagamento, dadosParaWhatsApp) {
    document.getElementById('checkoutSection').style.display = 'none';
    document.getElementById('cartFooter').style.display = 'none';
    const wait = document.getElementById('pagamentoOnlineWait');
    wait.style.display = 'flex';
    document.getElementById('pagamentoOnlineReabrirLink').href = urlPagamento;

    if (pararDeObservarPagamento) pararDeObservarPagamento();
    pararDeObservarPagamento = observarPagamentoPedido(obterLojaAtual(), pedidoId, (pedido) => {
        const status = pedido.pagamentoOnline?.status;
        if (status === 'pago') {
            encerrarEsperaPagamento();
            finalizarEnvioWhatsApp(dadosParaWhatsApp);
        } else if (status === 'recusado') {
            document.getElementById('pagamentoOnlineTitulo').textContent = 'Pagamento não foi aprovado 😕';
            document.getElementById('pagamentoOnlineSub').textContent = 'Tente novamente com outro cartão/Pix, ou reabra a página de pagamento acima.';
        }
    });

    document.getElementById('pagamentoOnlineCancelarBtn').onclick = () => {
        encerrarEsperaPagamento();
        updatePedidoStatus(pedidoId, 'cancelado').catch(err => console.error('Erro ao cancelar pedido não pago:', err));
    };
}

function encerrarEsperaPagamento() {
    if (pararDeObservarPagamento) { pararDeObservarPagamento(); pararDeObservarPagamento = null; }
    document.getElementById('pagamentoOnlineWait').style.display = 'none';
    document.getElementById('pagamentoOnlineTitulo').textContent = 'Aguardando confirmação do pagamento...';
    document.getElementById('pagamentoOnlineSub').textContent = 'Finalize o pagamento na aba que abrimos. Assim que confirmar, seu pedido segue automaticamente pra loja.';
    document.getElementById('checkoutSection').style.display = '';
    document.getElementById('cartFooter').style.display = '';
}

// Confere no Firestore (dado mais atual que o carrinho local) se ainda há estoque suficiente
// pra cada produto do carrinho antes de fechar o pedido. Evita vender o mesmo último item pra
// duas pessoas ao mesmo tempo.
async function validarEstoqueCarrinho() {
    const idsUnicos = [...new Set(carrinho.map(item => item.id))];

    try {
        const produtosAtuais = await Promise.all(idsUnicos.map(id => getProductById(id)));

        for (const produtoAtual of produtosAtuais) {
            if (!produtoAtual || produtoAtual.controlaEstoque === false) continue;

            const quantidadePedida = quantidadeNoCarrinho(produtoAtual.id);
            if (quantidadePedida > (produtoAtual.estoque || 0)) {
                showToast(`"${produtoAtual.nome}" não tem mais estoque suficiente. Ajuste o carrinho.`, 'error');
                renderizarProdutos();
                return false;
            }
        }
        return true;
    } catch (error) {
        console.error('Erro ao validar estoque do carrinho:', error);
        // Se a checagem falhar (ex: sem internet), deixa seguir — não trava a venda por um erro de rede
        return true;
    }
}

function gerarMensagemWhatsApp(nome, telefone, tipoEntrega, endereco, bairro, observacoes, codigoPedido, linkRastreio, formaPagamento, trocoPara) {
    let mensagem = `*Novo Pedido - ${configLoja.nome}* 🍔\n`;
    mensagem += `━━━━━━━━━━━━━━━━━━━━\n`;
    mensagem += `*Código do Pedido:* #${codigoPedido}\n`;
    mensagem += `*Cliente:* ${nome}\n`;
    mensagem += `*Telefone:* ${telefone}\n\n`;
    
    mensagem += `*🛒 Itens:*\n`;
    carrinho.forEach(item => {
        mensagem += `• ${item.quantidade}x ${item.nome} = R$ ${(item.preco * item.quantidade).toFixed(2)}\n`;
        if (item.sabores && item.sabores.length > 0) {
            mensagem += `  🍕 Sabores: ${item.sabores.join(' + ')}\n`;
        }
        if (item.adicionais && item.adicionais.length > 0) {
            mensagem += `  ➕ Adicionais: ${item.adicionais.map(a => `${a.nome} (+R$ ${Number(a.preco).toFixed(2)})`).join(', ')}\n`;
        }
        if (item.observacoes) {
            mensagem += `  📝 Obs: ${item.observacoes}\n`;
        }
    });

    const taxaEntrega = obterTaxaEntregaSelecionada();
    const subtotal = carrinho.reduce((soma, item) => soma + (item.preco * item.quantidade), 0);
    const economiaCupom = calcularEconomiaCupom();
    const total = calcularTotal(tipoEntrega);
    mensagem += `\n*💰 Resumo:*\n`;
    mensagem += `Subtotal: R$ ${subtotal.toFixed(2)}\n`;
    mensagem += `Entrega: ${taxaEntrega > 0 ? `R$ ${taxaEntrega.toFixed(2)}` : 'Grátis'}\n`;
    if (cupomAplicado && economiaCupom > 0) {
        mensagem += `*🎟️ Cupom Aplicado:* ${cupomAplicado.codigo} (-${cupomAplicado.desconto}%)\n`;
        mensagem += `Desconto: -R$ ${economiaCupom.toFixed(2)}\n`;
    }
    mensagem += `*Total: R$ ${total.toFixed(2)}*\n\n`;

    if (tipoEntrega === 'delivery') {
        // Se o cliente não escolheu bairro no select (fluxo automático), usa o bairro que
        // o geocoding identificou — só omite o rótulo se nem isso existir.
        const bairroExibicao = bairro || freteAutoResultado?.bairro || '';
        mensagem += bairroExibicao
            ? `*📍 Entrega:* Delivery — Bairro: ${bairroExibicao}, ${endereco}\n`
            : `*📍 Entrega:* Delivery — ${endereco}\n`;
    } else {
        mensagem += `*📍 Entrega:* Retirada na loja\n`;
    }

    mensagem += `*💳 Pagamento:* ${formatarFormaPagamento(formaPagamento)}`;
    if (formaPagamento === 'dinheiro' && trocoPara) {
        mensagem += ` (troco para R$ ${Number(trocoPara).toFixed(2)})`;
    }
    mensagem += `\n`;

    if (observacoes) {
        mensagem += `*📝 Observações:* ${observacoes}\n`;
    }

    if (linkRastreio) {
        mensagem += `\n📦 *Acompanhe seu pedido em tempo real:*\n${linkRastreio}\n`;
    }

    return mensagem;
}

async function salvarPedidoFirebase(pedido) {
    try {
        const salvo = await savePedido(pedido);
        console.log('Pedido salvo no Firebase');
        return salvo;
    } catch (error) {
        console.error('Erro ao salvar pedido:', error);
        return null;
    }
}

// Depois de enviar pro WhatsApp, oferece um jeito rápido do cliente já abrir a página de
// rastreamento (além do link que também vai na mensagem, caso ele prefira usar por aqui).
function mostrarConfirmacaoComRastreio(linkRastreio) {
    const toast = document.getElementById('toast');
    toast.innerHTML = `
        Pedido enviado! 🎉
        <a href="${linkRastreio}" target="_blank" style="display:block; margin-top:6px; color:#fff; text-decoration:underline; font-weight:600;">
            📦 Acompanhar meu pedido
        </a>
    `;
    toast.className = 'toast show success';
    setTimeout(() => toast.classList.remove('show'), 8000);
}

// Total do carrinho SEM o desconto de cupom (usado pra validar o cupom e como base pro cálculo do desconto)
function calcularTotalSemCupom(tipoEntrega) {
    const subtotal = carrinho.reduce((total, item) => total + (item.preco * item.quantidade), 0);
    const taxaEntrega = obterTaxaEntregaSelecionada();
    return subtotal + taxaEntrega;
}

// Economia (em R$) do cupom aplicado, recalculada sempre em cima do valor atual do carrinho
function calcularEconomiaCupom() {
    if (!cupomAplicado) return 0;
    const base = calcularTotalSemCupom();
    return (base * cupomAplicado.desconto) / 100;
}

function calcularTotal(tipoEntrega) {
    const base = calcularTotalSemCupom(tipoEntrega);
    const economia = calcularEconomiaCupom();
    return Math.max(0, base - economia); // não deixa o total ficar negativo
}

// ========== MODALS ==========
function abrirModal(modalId) {
    document.getElementById(modalId).classList.add('active');
    document.getElementById('overlay').classList.add('active');
}

function fecharModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
    if (document.querySelectorAll('.modal.active').length === 0) {
        document.getElementById('overlay').classList.remove('active');
    }
}

document.getElementById('closeModal').addEventListener('click', () => {
    fecharModal('productModal');
});

// ========== QUANTIDADE PRODUTO ==========
document.getElementById('decreaseQty').addEventListener('click', () => {
    const input = document.getElementById('quantityInput');
    if (input.value > 1) {
        input.value = parseInt(input.value) - 1;
    }
    atualizarTotalItemModal();
});

document.getElementById('increaseQty').addEventListener('click', () => {
    const input = document.getElementById('quantityInput');
    input.value = parseInt(input.value) + 1;
    atualizarTotalItemModal();
});

document.getElementById('addToCartBtn').addEventListener('click', adicionarAoCarrinho);


document.getElementById('loadMoreBtn').addEventListener('click', () => {
    currentPage++;
    renderizarProdutos(true); // acumula: só adiciona os novos itens ao grid, sem apagar os que já estavam
});

// ========== INICIALIZAR EVENTOS ==========
function inicializarEventos() {
    // Eventos já foram inicializados acima

    document.getElementById('aplicarCuponBtn')?.addEventListener('click', validarEAplicarCupom);
    document.getElementById('removerCuponBtn')?.addEventListener('click', removerCupom);
    document.getElementById('cuponInput')?.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') validarEAplicarCupom();
    });
    document.getElementById('clientPhone')?.addEventListener('blur', checarRecompensaFidelidade);
}

// ========== FIDELIDADE (desconto automático) ==========
// Assim que o cliente termina de digitar o telefone, checa se ele tem uma recompensa de
// fidelidade disponível (10 pedidos, por exemplo) e aplica o desconto sozinho — sem
// precisar digitar cupom nenhum. Reaproveita a mesma variável/exibição do cupom manual
// (cupomAplicado) pra não duplicar toda a lógica de cálculo de total já existente.
async function checarRecompensaFidelidade() {
    const banner = document.getElementById('fidelidadeBanner');
    const telefone = document.getElementById('clientPhone').value.trim();
    if (apenasNumeros(telefone).length < 10) return;

    // Se já tem um cupom digitado manualmente, não sobrescreve — o cliente escolheu esse.
    if (cupomAplicado && !cupomAplicado.ehFidelidade) return;

    try {
        const recompensa = await consultarRecompensaFidelidade(telefone);
        if (recompensa) {
            cupomAplicado = {
                id: null,
                codigo: `FIDELIDADE ${recompensa.desconto}%`,
                desconto: recompensa.desconto,
                ehFidelidade: true,
                telefoneId: recompensa.telefoneId
            };
            banner.style.display = 'flex';
            banner.textContent = `🎉 Você ganhou ${recompensa.desconto}% de desconto de fidelidade — já aplicado no seu pedido!`;
            atualizarExibicaoCupom();
            atualizarCarrinho();
        } else if (cupomAplicado?.ehFidelidade) {
            // Telefone mudou e não bate mais com nenhuma recompensa — desfaz o desconto
            // automático (não mexe se o cliente aplicou cupom manual por cima).
            cupomAplicado = null;
            banner.style.display = 'none';
            atualizarExibicaoCupom();
            atualizarCarrinho();
        }
    } catch (error) {
        console.error('Erro ao checar recompensa de fidelidade:', error);
    }
}

// ========== UTILITÁRIOS ==========
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function getBadgeText(badge) {
    const badges = {
        'novo': '✨ Novo',
        'promo': '🎉 Promoção',
        'bestseller': '⭐ Mais Vendido',
        'limitado': '🔒 Limitado'
    };
    return badges[badge] || badge;
}

// Gera um número de avaliações FIXO por produto (baseado no id), pra nunca mudar entre o
// card da listagem e o modal do mesmo produto.
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash;
}

function getAvaliacoesCount(produto) {
    const chave = String(produto.id || produto.nome || '');
    return 50 + (hashString(chave) % 100);
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}

// ========== CUPONS NO APP ==========

// ========== VALIDAR E APLICAR CUPOM ==========
async function validarEAplicarCupom() {
    const cuponInput = document.getElementById('cuponInput');
    const btn = document.getElementById('aplicarCuponBtn');
    if (!cuponInput) return;

    const codigo = cuponInput.value.trim();

    if (!codigo) {
        showToast('Digite o código do cupom', 'error');
        return;
    }

    // Calcular valor do carrinho ANTES de aplicar cupom
    const tipoEntrega = document.querySelector('input[name="delivery"]:checked')?.value || 'retirada';
    const valorCarrinho = calcularTotalSemCupom(tipoEntrega);

    // Feedback visual enquanto valida (a validação é assíncrona e pode levar um instante) —
    // evita o usuário clicar de novo achando que não funcionou.
    const textoOriginalBtn = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = 'Aplicando...'; }

    try {
        const resultado = await validarCupom(codigo, valorCarrinho);

        if (!resultado.valido) {
            showToast(resultado.erro || 'Cupom inválido', 'error');
            return;
        }

        const cupom = resultado.cupom;

        cupomAplicado = {
            id: cupom.id,
            codigo: cupom.codigo,
            desconto: cupom.desconto
        };

        showToast(`Cupom "${cupom.codigo}" aplicado! Desconto de ${cupom.desconto}%`, 'success');

        // Atualizar exibição
        cuponInput.value = '';
        atualizarExibicaoCupom();
        atualizarCarrinho(); // Atualizar totais

    } catch (error) {
        console.error('Erro ao validar cupom:', error);
        showToast('Erro ao validar cupom', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = textoOriginalBtn; }
    }
}

// ========== REMOVER CUPOM ==========
function removerCupom() {
    cupomAplicado = null;
    document.getElementById('fidelidadeBanner').style.display = 'none';
    atualizarExibicaoCupom();
    atualizarCarrinho(); // Atualizar totais
    showToast('Cupom removido', 'info');
}

// ========== ATUALIZAR EXIBIÇÃO DE CUPOM ==========
function atualizarExibicaoCupom() {
    const cuponWrapper = document.getElementById('cuponAplicadoWrapper');
    const cuponInputWrapper = document.getElementById('cuponInputWrapper');
    if (!cuponWrapper) return;

    if (cupomAplicado) {
        const economia = calcularEconomiaCupom();
        cuponWrapper.style.display = 'block';
        document.getElementById('cuponAplicadoCodigo').textContent = cupomAplicado.codigo;
        document.getElementById('cuponAplicadoDesconto').textContent = `${cupomAplicado.desconto}%`;
        document.getElementById('cuponAplicadoEconomia').textContent = economia.toFixed(2);
        if (cuponInputWrapper) cuponInputWrapper.style.display = 'none';
    } else {
        cuponWrapper.style.display = 'none';
        if (cuponInputWrapper) cuponInputWrapper.style.display = 'block';
    }
}
