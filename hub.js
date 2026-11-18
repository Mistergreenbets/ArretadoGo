// ========== HUB (página central que lista todas as lojas da plataforma) ==========
// Página pública, sem login — só leitura. Usa listarLojasParaHub()/getBannersHub(),
// definidas em firebase-config.js (mesmo arquivo compartilhado com index.html/admin.html).
// O carrossel de banners reaproveita as MESMAS classes CSS do carrossel de promoções do
// index.html (.hero-carousel-track/.hero-carousel-slide/.promo-dot), só trocando o que
// alimenta ele — assim o visual fica idêntico entre hub e loja individual.

let todasAsLojasHub = [];

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('buscaHub').addEventListener('input', (e) => {
        renderizarGridLojas(e.target.value);
    });

    await Promise.all([
        carregarBannerCarousel(),
        carregarLojasHub()
    ]);

    esconderSkeletonHub();
});

// Some com o skeleton de tela cheia (fade) e o remove do DOM depois — se algo travar
// e o Promise.all acima nunca terminar (ex: sem internet), o skeleton simplesmente fica
// visível pra sempre em vez de mostrar uma página com dados faltando pela metade.
function esconderSkeletonHub() {
    const overlay = document.getElementById('hubLoadingOverlay');
    if (!overlay) return;
    overlay.classList.add('hub-loading-escondido');
    overlay.addEventListener('transitionend', () => overlay.remove(), { once: true });
}

// ========== CARROSSEL DE BANNERS ==========

let bannerIndex = 0;
let bannerIntervalId = null;
const BANNER_INTERVALO_MS = 5000;

async function carregarBannerCarousel() {
    const section = document.getElementById('hubBannerSection');
    try {
        const banners = (await getBannersHub()).filter(b => b.ativo !== false && b.imagem);
        montarBannerCarousel(banners);
    } catch (error) {
        console.error('Erro ao carregar banners do hub:', error);
        montarBannerCarousel([]);
    } finally {
        // Revela a seção mesmo sem banner nenhum cadastrado (fica só sem carrossel) —
        // evita a página parecer travada/quebrada esperando algo que não existe.
        section?.classList.remove('carousel-loading');
    }
}

function montarBannerCarousel(banners) {
    const track = document.getElementById('hubBannerTrack');
    const dotsContainer = document.getElementById('hubBannerDots');
    const section = document.getElementById('hubBannerSection');

    if (banners.length === 0) {
        section.style.display = 'none';
        return;
    }
    section.style.display = '';

    track.innerHTML = banners.map(b => `
        <div class="hero-carousel-slide" role="button" tabindex="0" aria-label="${escaparHtmlHub(b.titulo || 'Banner')}">
            <div class="hero-image">
                <img src="${escaparHtmlHub(b.imagem)}" alt="${escaparHtmlHub(b.titulo || '')}" class="showcase-img">
            </div>
        </div>
    `).join('');

    track.querySelectorAll('.hero-carousel-slide').forEach((slide, i) => {
        const link = banners[i].link;
        if (!link) return;
        const abrir = () => window.open(link, '_blank', 'noopener');
        slide.addEventListener('click', abrir);
        slide.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); abrir(); }
        });
    });

    dotsContainer.innerHTML = banners.length > 1
        ? banners.map((_, i) => `<button type="button" class="promo-dot${i === 0 ? ' active' : ''}" data-index="${i}" aria-label="Ir para o banner ${i + 1}"></button>`).join('')
        : '';
    dotsContainer.querySelectorAll('.promo-dot').forEach(dot => {
        dot.addEventListener('click', () => irParaBannerSlide(parseInt(dot.dataset.index)));
    });

    bannerIndex = 0;
    atualizarPosicaoBanner(true);
    iniciarAutoplayBanner(banners.length);
}

function atualizarPosicaoBanner(semTransicao) {
    const track = document.getElementById('hubBannerTrack');
    if (!track) return;
    if (semTransicao) {
        track.style.transition = 'none';
        track.style.transform = `translateX(-${bannerIndex * 100}%)`;
        void track.offsetWidth;
        track.style.transition = '';
    } else {
        track.style.transform = `translateX(-${bannerIndex * 100}%)`;
    }
    document.querySelectorAll('#hubBannerDots .promo-dot').forEach((dot, i) => {
        dot.classList.toggle('active', i === bannerIndex);
    });
}

function iniciarAutoplayBanner(total) {
    if (bannerIntervalId) { clearInterval(bannerIntervalId); bannerIntervalId = null; }
    if (total > 1) {
        bannerIntervalId = setInterval(() => {
            bannerIndex = (bannerIndex + 1) % total;
            atualizarPosicaoBanner(false);
        }, BANNER_INTERVALO_MS);
    }
}

function irParaBannerSlide(index) {
    const total = document.querySelectorAll('#hubBannerTrack .hero-carousel-slide').length;
    bannerIndex = index;
    atualizarPosicaoBanner(false);
    iniciarAutoplayBanner(total);
}

document.getElementById('hubBanner')?.addEventListener('mouseenter', () => {
    if (bannerIntervalId) { clearInterval(bannerIntervalId); bannerIntervalId = null; }
});
document.getElementById('hubBanner')?.addEventListener('mouseleave', () => {
    const total = document.querySelectorAll('#hubBannerTrack .hero-carousel-slide').length;
    if (total > 1 && !bannerIntervalId) iniciarAutoplayBanner(total);
});

// ========== GRID DE LOJAS ==========

async function carregarLojasHub() {
    const grid = document.getElementById('hubGrid');
    try {
        todasAsLojasHub = await listarLojasParaHub();
        renderizarGridLojas('');
    } catch (error) {
        console.error('Erro ao carregar lojas do hub:', error);
        grid.innerHTML = '<div class="hub-vazio"><div class="hub-vazio-icon">⚠️</div>Não foi possível carregar as lojas agora. Verifique sua conexão e tente atualizar a página.</div>';
    }
}

function renderizarGridLojas(termoBusca) {
    const grid = document.getElementById('hubGrid');
    const contagem = document.getElementById('hubContagem');
    const busca = (termoBusca || '').trim().toLowerCase();

    if (todasAsLojasHub.length === 0) {
        grid.innerHTML = '<div class="hub-vazio"><div class="hub-vazio-icon">🏬</div>Nenhuma loja disponível no momento.</div>';
        contagem.textContent = '';
        return;
    }

    const filtradas = !busca
        ? todasAsLojasHub
        : todasAsLojasHub.filter(l => (l.nome || l.id || '').toLowerCase().includes(busca));

    contagem.textContent = `${filtradas.length} loja${filtradas.length === 1 ? '' : 's'}`;

    if (filtradas.length === 0) {
        grid.innerHTML = '<div class="hub-vazio"><div class="hub-vazio-icon">🔎</div>Nenhuma loja encontrada pra essa busca.</div>';
        return;
    }

    // Abertas primeiro, depois por nome — ajuda quem está navegando a bater logo
    // numa loja que realmente vai aceitar o pedido agora.
    const ordenadas = [...filtradas].sort((a, b) => {
        const statusA = calcularStatusLoja({ horarioFuncionamento: a.configuracoes?.horarioFuncionamento });
        const statusB = calcularStatusLoja({ horarioFuncionamento: b.configuracoes?.horarioFuncionamento });
        const abertaA = !statusA.controlado || statusA.aberta;
        const abertaB = !statusB.controlado || statusB.aberta;
        if (abertaA !== abertaB) return abertaA ? -1 : 1;
        return (a.nome || a.id || '').localeCompare(b.nome || b.id || '', 'pt-BR');
    });

    grid.innerHTML = ordenadas.map(montarCardLojaHub).join('');

    // onerror inline (ver montarCardLojaHub) já cuida do fallback da logo — não precisa
    // de listener adicional aqui.
}

function montarCardLojaHub(loja) {
    const config = loja.configuracoes || {};
    const status = calcularStatusLoja({ horarioFuncionamento: config.horarioFuncionamento });
    const aberta = !status.controlado || status.aberta;
    const inicial = (loja.nome || loja.id || '?').trim().charAt(0).toUpperCase();
    const link = `index.html?loja=${encodeURIComponent(loja.id)}`;

    const tempoEntrega = config.tempoEntrega != null ? `⏱️ ${escaparHtmlHub(String(config.tempoEntrega))} min` : '';
    const taxaEntrega = config.taxaEntrega != null
        ? (Number(config.taxaEntrega) === 0 ? '🛵 Grátis' : `🛵 R$ ${Number(config.taxaEntrega).toFixed(2).replace('.', ',')}`)
        : '';

    const logoHtml = config.logoUrl
        ? `<img class="hub-store-logo" src="${escaparHtmlHub(config.logoUrl)}" alt=""
               onerror="this.replaceWith(Object.assign(document.createElement('div'), {className:'hub-store-logo-fallback', textContent:'${inicial}'}));">`
        : `<div class="hub-store-logo-fallback">${inicial}</div>`;

    return `
        <a class="hub-store-card" href="${link}">
            ${logoHtml}
            <div class="hub-store-nome">${escaparHtmlHub(loja.nome || loja.id)}</div>
            ${status.controlado ? `<span class="hub-store-status ${aberta ? 'aberta' : 'fechada'}">${aberta ? 'Aberto' : 'Fechado'}</span>` : ''}
            <div class="hub-store-meta">
                ${tempoEntrega ? `<span>${tempoEntrega}</span>` : ''}
                ${taxaEntrega ? `<span>${taxaEntrega}</span>` : ''}
            </div>
            <span class="hub-store-card-btn">Ver cardápio</span>
        </a>
    `;
}

function escaparHtmlHub(str) {
    const div = document.createElement('div');
    div.textContent = str ?? '';
    return div.innerHTML;
}
