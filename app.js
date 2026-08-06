// ========== VARIÁVEIS GLOBAIS ==========
let produtos = [];
let carrinho = [];
let allProdutos = [];
const WHATSAPP_NUMBER_PADRAO = '5511999999999'; // Usado só se não houver configuração salva
let configLoja = {
    nome: 'ArretadoGo',
    telefone: WHATSAPP_NUMBER_PADRAO,
    taxaEntrega: 5.00,
    tempoEntrega: 30,
    pedidoMinimo: 0,
    saboresPizza: [],
    adicionaisSanduiche: [],
    bairrosEntrega: [],
    promocoes: [],
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
let adicionaisSelecionados = [];

// ========== INICIALIZAR APP ==========
document.addEventListener('DOMContentLoaded', async () => {
    console.log('App iniciado...');
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
    renderizarFiltros();
    renderizarProdutos();
    renderizarPromocoes();
    carregarCarrinho();
});

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
                telefone: config.telefone || configLoja.telefone,
                taxaEntrega: config.taxaEntrega ?? configLoja.taxaEntrega,
                tempoEntrega: config.tempoEntrega ?? configLoja.tempoEntrega,
                pedidoMinimo: config.pedidoMinimo ?? configLoja.pedidoMinimo,
                saboresPizza: Array.isArray(config.saboresPizza) ? config.saboresPizza : [],
                adicionaisSanduiche: Array.isArray(config.adicionaisSanduiche) ? config.adicionaisSanduiche : [],
                bairrosEntrega: Array.isArray(config.bairrosEntrega) ? config.bairrosEntrega : [],
                promocoes: Array.isArray(config.promocoes) ? config.promocoes : [],
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

        const whatsappEl = document.getElementById('whatsappNumber');
        if (whatsappEl) whatsappEl.textContent = formatarTelefoneExibicao(configLoja.telefone);

        renderizarHero();
        renderizarOpcoesBairro();

        // Salva a Hero em cache local pra próxima visita aparecer instantaneamente,
        // sem precisar esperar o Firestore de novo (ver script inline no início do <body>).
        try {
            localStorage.setItem('arretadogoHeroCache', JSON.stringify(configLoja.hero));
        } catch (e) {
            // localStorage pode estar indisponível (modo privado, etc.) — sem problema,
            // só não vai ter cache pra próxima visita.
        }
    } catch (error) {
        console.error('Erro ao carregar configurações:', error);
    } finally {
        // Revela a Hero mesmo se algo der errado (ex: sem internet) — nesse caso mostra os
        // valores padrão já preenchidos em configLoja, em vez de ficar escondida pra sempre.
        revelarHero();
    }
}

function revelarHero() {
    document.getElementById('heroSection')?.classList.remove('hero-loading');
}

// Preenche o título, subtítulo, botão, imagem e selos da seção Hero com o que foi configurado no admin
function renderizarHero() {
    const hero = configLoja.hero;
    if (!hero) return;

    // Fade rápido no texto/imagem da Hero ao trocar pelo conteúdo real — evita a sensação
    // de "pulo" caso o texto de fábrica do HTML fique visível por uma fração de segundo
    // enquanto a configuração ainda está carregando.
    const heroTextEl = document.querySelector('.hero-text');
    const heroImgWrapperEl = document.querySelector('.hero-image');
    [heroTextEl, heroImgWrapperEl].forEach(el => {
        if (el) el.style.transition = 'opacity 0.2s ease';
    });

    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    setText('heroPrefixoTexto', hero.prefixo);
    setText('heroDestaqueTexto', hero.destaque);
    setText('heroSubtituloTexto', hero.subtitulo);
    setText('heroBotaoTextoEl', hero.botaoTexto);

    const imgEl = document.getElementById('heroImagemEl');
    if (imgEl && hero.imagem) imgEl.src = hero.imagem;

    const stats = Array.isArray(hero.stats) ? hero.stats : [];
    stats.slice(0, 3).forEach((stat, i) => {
        setText(`heroStat${i + 1}ValorEl`, stat.valor || '');
        setText(`heroStat${i + 1}LabelEl`, stat.label || '');
    });

    // Garante opacidade normal após preencher (só entra em ação se algo tiver escondido antes)
    requestAnimationFrame(() => {
        [heroTextEl, heroImgWrapperEl].forEach(el => {
            if (el) el.style.opacity = '1';
        });
    });
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

// ========== BANNER ROTATIVO DE PROMOÇÕES ==========
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

// ========== RENDERIZAR CATEGORIAS ==========
function renderizarCategorias() {
    const categorias = ['burgers', 'pizza', 'bebidas', 'acompanhamentos', 'sobremesas'];
    const icones = {
        'burgers': '🍔',
        'pizza': '🍕',
        'bebidas': '🥤',
        'acompanhamentos': '🍟',
        'sobremesas': '🍰'
    };

    const container = document.getElementById('categoriesContainer');
    container.innerHTML = '';

    // Card "Todos" sempre aparece primeiro
    const cardTodos = document.createElement('div');
    cardTodos.className = 'category-card' + (filtroAtivo === 'todos' ? ' active' : '');
    cardTodos.dataset.category = 'todos';
    cardTodos.innerHTML = `
        <div class="category-icon">🍽️</div>
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
                <div class="category-icon">${icones[cat] || '📦'}</div>
                <div class="category-name">${capitalize(cat)}</div>
                <small>${count} produtos</small>
            `;
            card.addEventListener('click', () => filtrarPorCategoria(cat));
            container.appendChild(card);
        }
    });
}

// ========== RENDERIZAR FILTROS (barra acima da grade de produtos) ==========
function renderizarFiltros() {
    const categorias = ['burgers', 'pizza', 'bebidas', 'acompanhamentos', 'sobremesas'];
    const nomesFiltro = {
        'burgers': 'Burgers',
        'pizza': 'Pizzas',
        'bebidas': 'Bebidas',
        'acompanhamentos': 'Acompanhamentos',
        'sobremesas': 'Sobremesas'
    };

    const btnTodos = document.querySelector('.filter-btn[data-filter="todos"]');
    if (btnTodos) {
        btnTodos.addEventListener('click', () => aplicarFiltroBotao('todos'));
    }

    const container = document.getElementById('filterButtons');
    container.innerHTML = '';

    categorias.forEach(cat => {
        const count = allProdutos.filter(p => p.categoria === cat).length;
        if (count > 0) {
            const btn = document.createElement('button');
            btn.className = 'filter-btn';
            btn.dataset.filter = cat;
            btn.textContent = nomesFiltro[cat] || capitalize(cat);
            btn.addEventListener('click', () => aplicarFiltroBotao(cat));
            container.appendChild(btn);
        }
    });
}

// Aplica o filtro e atualiza qual botão/card fica marcado como ativo
function aplicarFiltroBotao(categoria) {
    filtrarPorCategoria(categoria);

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === categoria);
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

function renderizarProdutos(acumular = false) {
    const container = document.getElementById('productsContainer');

    if (!acumular) {
        container.innerHTML = '';
    }

    if (produtos.length === 0) {
        container.innerHTML = '<p style="grid-column: 1/-1; text-align: center; padding: 40px;">Nenhum produto encontrado 😕</p>';
        document.getElementById('loadMoreBtn').style.display = 'none';
        return;
    }

    // Quando acumula (clique em "Carregar Mais"), só renderiza os itens NOVOS dessa página
    // e anexa ao grid existente. Quando não acumula (carga inicial, busca, filtro), sempre
    // mostra do início até a página atual — assim o grid nunca "esquece" o que já tinha
    // aparecido antes, só cresce.
    const inicio = acumular ? (currentPage - 1) * productsPerPage : 0;
    const fim = currentPage * productsPerPage;
    const produtosExibir = produtos.slice(inicio, fim);

    produtosExibir.forEach(produto => {
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
        container.appendChild(card);
    });

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

    saboresGroup.style.display = ehPizza ? 'block' : 'none';
    adicionaisGroup.style.display = ehSanduiche ? 'block' : 'none';

    if (ehPizza) {
        configLoja.saboresPizza.forEach(sabor => {
            const label = document.createElement('label');
            label.className = 'option-item';
            label.innerHTML = `
                <input type="checkbox" value="${sabor.nome}">
                <span>${sabor.nome}</span>
            `;
            const checkbox = label.querySelector('input');
            checkbox.addEventListener('change', () => {
                if (checkbox.checked) {
                    if (saboresSelecionados.length >= 2) {
                        checkbox.checked = false;
                        showToast('Você pode escolher no máximo 2 sabores', 'error');
                        return;
                    }
                    saboresSelecionados.push(sabor.nome);
                } else {
                    saboresSelecionados = saboresSelecionados.filter(s => s !== sabor.nome);
                }
                atualizarEstadoCheckboxesSabores();
                atualizarTotalItemModal();
            });
            saboresList.appendChild(label);
        });
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

// Desabilita visualmente os sabores não marcados quando o limite de 2 já foi atingido
function atualizarEstadoCheckboxesSabores() {
    const items = document.querySelectorAll('#saboresOptionsList .option-item');
    items.forEach(item => {
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

    if (produtoSelecionado.categoria === 'pizza' && configLoja.saboresPizza.length > 0 && saboresSelecionados.length === 0) {
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

function salvarCarrinho() {
    localStorage.setItem('carrinho', JSON.stringify(carrinho));
}

function carregarCarrinho() {
    const carrinhoSalvo = localStorage.getItem('carrinho');
    carrinho = carrinhoSalvo ? JSON.parse(carrinhoSalvo) : [];
    atualizarCarrinho();
}

function atualizarCarrinho() {
    const container = document.getElementById('cartItems');
    const countEl = document.getElementById('cartCount');
    const summaryEl = document.getElementById('cartSummary');
    const checkoutEl = document.getElementById('checkoutSection');

    countEl.textContent = carrinho.length;

    if (carrinho.length === 0) {
        container.innerHTML = '<p class="empty-cart">Seu carrinho está vazio</p>';
        summaryEl.style.display = 'none';
        checkoutEl.style.display = 'none';
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
            <button class="cart-item-remove" onclick="removerDoCarrinho(${index})">🗑️</button>
        `;
        container.appendChild(itemEl);
    });

    // Atualizar resumo (taxa só se for delivery; retirada é grátis)
    const taxaEntrega = obterTaxaEntregaSelecionada();
    const total = subtotal + taxaEntrega;

    document.getElementById('subtotalPrice').textContent = `R$ ${subtotal.toFixed(2)}`;
    document.getElementById('deliveryPrice').textContent = taxaEntrega > 0 ? `R$ ${taxaEntrega.toFixed(2)}` : 'Grátis';
    document.getElementById('totalPrice').textContent = `R$ ${total.toFixed(2)}`;

    summaryEl.style.display = 'block';
    checkoutEl.style.display = 'block';
}

// Lê o tipo de entrega marcado no momento e retorna a taxa correta (com base no bairro escolhido)
function obterTaxaEntregaSelecionada() {
    const radioSelecionado = document.querySelector('input[name="delivery"]:checked');
    const tipoEntrega = radioSelecionado ? radioSelecionado.value : 'retirada';
    if (tipoEntrega !== 'delivery') return 0;

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

    // Atualizar botões de filtro
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === categoria);
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

document.getElementById('closeCart').addEventListener('click', () => {
    document.getElementById('cartSidebar').classList.remove('active');
    document.getElementById('overlay').classList.remove('active');
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

document.getElementById('checkoutBtn').addEventListener('click', async () => {
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

    // Limpar destaques de erro anteriores
    [nomeInput, telefoneInput, enderecoInput, bairroSelect].forEach(el => el.classList.remove('input-error'));

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

    if (tipoEntrega === 'delivery' && !bairro) {
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

    // Salvar pedido no Firebase PRIMEIRO — precisamos do ID gerado pelo Firestore pra
    // montar o link de rastreamento antes de montar a mensagem do WhatsApp.
    const pedidoSalvo = await salvarPedidoFirebase({
        codigoPedido,
        nome,
        telefone,
        tipoEntrega,
        endereco,
        bairro,
        observacoes,
        itens: carrinho,
        total: calcularTotal(tipoEntrega)
    });

    const linkRastreio = pedidoSalvo
        ? `${window.location.origin}${window.location.pathname.replace(/index\.html$/, '')}rastreio.html?id=${pedidoSalvo.id}`
        : null;

    // Gerar mensagem WhatsApp
    const mensagem = gerarMensagemWhatsApp(nome, telefone, tipoEntrega, endereco, bairro, observacoes, codigoPedido, linkRastreio);

    // Enviar para WhatsApp (usa o número configurado no painel admin)
    const numeroWhatsApp = apenasNumeros(configLoja.telefone) || WHATSAPP_NUMBER_PADRAO;
    const urlWhatsApp = `https://wa.me/${numeroWhatsApp}?text=${encodeURIComponent(mensagem)}`;
    window.open(urlWhatsApp, '_blank');

    // Limpar carrinho
    carrinho = [];
    salvarCarrinho();
    atualizarCarrinho();
    document.getElementById('clientName').value = '';
    document.getElementById('clientPhone').value = '';
    document.getElementById('clientAddress').value = '';
    document.getElementById('clientBairro').value = '';
    document.getElementById('orderObservations').value = '';

    document.getElementById('cartSidebar').classList.remove('active');
    document.getElementById('overlay').classList.remove('active');

    if (linkRastreio) {
        mostrarConfirmacaoComRastreio(linkRastreio);
    } else {
        showToast('Pedido enviado para WhatsApp!', 'success');
    }
});

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

function gerarMensagemWhatsApp(nome, telefone, tipoEntrega, endereco, bairro, observacoes, codigoPedido, linkRastreio) {
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
    const total = calcularTotal(tipoEntrega);
    const subtotal = total - taxaEntrega;
    mensagem += `\n*💰 Resumo:*\n`;
    mensagem += `Subtotal: R$ ${subtotal.toFixed(2)}\n`;
    mensagem += `Entrega: ${taxaEntrega > 0 ? `R$ ${taxaEntrega.toFixed(2)}` : 'Grátis'}\n`;
    mensagem += `*Total: R$ ${total.toFixed(2)}*\n\n`;

    if (tipoEntrega === 'delivery') {
        mensagem += `*📍 Entrega:* Delivery — Bairro: ${bairro}, ${endereco}\n`;
    } else {
        mensagem += `*📍 Entrega:* Retirada na loja\n`;
    }
    
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

function calcularTotal(tipoEntrega) {
    const subtotal = carrinho.reduce((total, item) => total + (item.preco * item.quantidade), 0);
    const taxaEntrega = obterTaxaEntregaSelecionada();
    return subtotal + taxaEntrega;
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

// ========== BOTÕES ==========
document.getElementById('scrollMenuBtn').addEventListener('click', () => {
    document.getElementById('produtos').scrollIntoView({ behavior: 'smooth' });
});

document.getElementById('loadMoreBtn').addEventListener('click', () => {
    currentPage++;
    renderizarProdutos(true); // acumula: só adiciona os novos itens ao grid, sem apagar os que já estavam
});

// ========== INICIALIZAR EVENTOS ==========
function inicializarEventos() {
    // Eventos já foram inicializados acima
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
