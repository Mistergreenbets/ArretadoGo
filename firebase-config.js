// ========== CONFIGURAÇÃO FIREBASE ==========
// Substitua as chaves abaixo pelas suas do Firebase Console

const firebaseConfig = {
  apiKey: "AIzaSyBcjz6lJ2S3Cex3hheDsIbFf6fz3K1-8mE",
  authDomain: "arretadogo.firebaseapp.com",
  projectId: "arretadogo",
  storageBucket: "arretadogo.firebasestorage.app",
  messagingSenderId: "907455433951",
  appId: "1:907455433951:web:1fd1298c7fd730aec32d6a"
};

// Importar Firebase SDK
const firebaseScript = document.createElement('script');
firebaseScript.src = 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js';
firebaseScript.onload = function() {
    // Firebase está carregado, agora carregar os módulos específicos
    let scriptsCarregados = 0;
    const totalScripts = 3;
    const checarPronto = () => {
        scriptsCarregados++;
        // (sinaliza via evento quando os módulos terminarem, opcional)
    };

    const firestoreScript = document.createElement('script');
    firestoreScript.src = 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore-compat.js';
    firestoreScript.onload = checarPronto;
    document.head.appendChild(firestoreScript);

    const authScript = document.createElement('script');
    authScript.src = 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth-compat.js';
    authScript.onload = checarPronto;
    document.head.appendChild(authScript);

    const appCheckScript = document.createElement('script');
    appCheckScript.src = 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app-check-compat.js';
    appCheckScript.onload = checarPronto;
    document.head.appendChild(appCheckScript);
};
document.head.appendChild(firebaseScript);

// ========== APP CHECK ==========
// Proteção contra bots/scripts que tentam escrever direto na API do Firestore, por fora do
// seu site (ex: alguém criando milhares de pedidos falsos pra estourar sua cota gratuita
// diária). NÃO precisa do plano pago Blaze — funciona no plano gratuito (Spark) também.
//
// Como ativar (uma vez só):
//   1. Firebase Console → Project Settings (⚙️) → App Check → "Apps" → registre o app Web,
//      escolhendo o provedor reCAPTCHA v3. O Console gera uma "Site Key".
//   2. Cole essa chave na constante RECAPTCHA_SITE_KEY abaixo.
//   3. Publique o site com essa mudança e espere alguns dias olhando as métricas no painel
//      do App Check (ele funciona em modo "monitorar" primeiro, sem bloquear ninguém).
//   4. Só DEPOIS de confirmar que o tráfego normal do site está passando OK, vá em
//      App Check → Firestore → "Aplicar" (Enforce). Só a partir daí ele passa a bloquear
//      de verdade quem não tiver o token válido.
//
// Enquanto RECAPTCHA_SITE_KEY estiver vazia, isso é ignorado e o site funciona exatamente
// como antes — é seguro fazer esse deploy mesmo antes de configurar a chave.
const RECAPTCHA_SITE_KEY = '6LeVKYAtAAAAAGv1mBETl7gUFxniH2MAMfQmZds1';
function ativarAppCheck() {
    if (!RECAPTCHA_SITE_KEY || typeof firebase === 'undefined' || !firebase.appCheck) return;
    try {
        // activate() é "fire and forget" por baixo dos panos: se o domínio atual não
        // estiver cadastrado nos domínios permitidos do reCAPTCHA (comum em localhost,
        // 127.0.0.1 ou URLs de preview/sandbox), a obtenção do token nunca conclui — e,
        // com "Aplicar/Enforce" ligado no Firestore, TODA leitura/escrita fica esperando
        // esse token pra sempre, travando botões sem erro nenhum no console. Isso não
        // desativa o App Check; só evita ficarmos "no escuro" quando ele falha.
        firebase.appCheck().activate(RECAPTCHA_SITE_KEY, true);
        setTimeout(() => {
            firebase.appCheck().getToken(false).catch((error) => {
                console.warn(
                    'App Check: não foi possível obter token neste domínio ' +
                    `(${window.location.hostname}). Se o Firestore estiver com "Aplicar" ` +
                    'ligado, escritas podem travar sem erro visível. Cadastre este domínio ' +
                    'nos domínios permitidos do reCAPTCHA (Firebase Console → App Check) ' +
                    'ou deixe o App Check em modo "Monitorar" durante testes.', error
                );
            });
        }, 4000);
    } catch (error) {
        console.error('Erro ao ativar App Check:', error);
    }
}

// Função para inicializar Firebase quando os scripts estiverem prontos
let firebaseReady = false;

async function initializeFirebase() {
    // Aguardar até que firebase esteja disponível globalmente
    while (typeof firebase === 'undefined' || !firebase.firestore || !firebase.auth) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    firebase.initializeApp(firebaseConfig);
    ativarAppCheck(); // precisa rodar logo depois do initializeApp, antes de qualquer leitura/escrita
    firebaseReady = true;
    return {
        db: firebase.firestore(),
        auth: firebase.auth()
    };
}

let fbInstance = null;

// Funciona como singleton
async function getFirebase() {
    if (!fbInstance) {
        fbInstance = await initializeFirebase();
    }
    return fbInstance;
}

// ========== MULTI-TENANT (SaaS) ==========
// lojaId == slug da loja (ex: "pizzariax"), é o próprio ID do doc em /lojas.
// Quem carrega a página (app.js, admin.js, motoboy.js, rastreio.js) precisa chamar
// definirLojaAtual(lojaId) UMA VEZ, assim que descobrir qual loja está sendo acessada,
// antes de qualquer outra função deste arquivo que leia/grave produtos, pedidos, cupons,
// motoboys ou configurações. Sem isso, colLoja() abaixo lança erro de propósito —
// é melhor falhar alto e claro do que silenciosamente ler a loja errada.
let lojaAtual = null;

function definirLojaAtual(lojaId) {
    lojaAtual = lojaId;
}

function obterLojaAtual() {
    return lojaAtual;
}

// Referência da subcoleção da loja atual (produtos, pedidos, cupons, motoboys)
function colLoja(db, nome) {
    if (!lojaAtual) {
        throw new Error(`lojaAtual não definida — chame definirLojaAtual(lojaId) antes de acessar "${nome}".`);
    }
    return db.collection('lojas').doc(lojaAtual).collection(nome);
}

// Referência do próprio documento da loja atual (nome, configurações, ativo, plano)
function docLojaAtual(db) {
    if (!lojaAtual) {
        throw new Error('lojaAtual não definida — chame definirLojaAtual(lojaId) antes de acessar a loja.');
    }
    return db.collection('lojas').doc(lojaAtual);
}

// Roda uma promise com prazo máximo — se ela não resolver nem rejeitar dentro do tempo
// (ex: App Check travado esperando token num domínio não cadastrado), rejeita com uma
// mensagem clara em vez de deixar o botão girando pra sempre sem explicação nenhuma.
function comTimeout(promise, ms, mensagemTimeout) {
    let idTimeout;
    const timeout = new Promise((_, reject) => {
        idTimeout = setTimeout(() => reject(new Error(mensagemTimeout)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(idTimeout));
}

// Traduz os erros mais comuns do Firebase (Auth + Firestore) pra mensagens que fazem
// sentido pra quem está usando o painel, em vez de "permission-denied" cru — usada por
// admin.js (cadastro de motoboy/cozinha) e outros pontos que criam contas/gravam dados.
function traduzirErroFirebaseComum(error) {
    const codigo = error?.code || '';
    const mapa = {
        'auth/email-already-in-use': 'Esse e-mail já está em uso por outra conta.',
        'auth/invalid-email': 'E-mail inválido.',
        'auth/weak-password': 'Senha muito fraca (mínimo 6 caracteres).',
        'auth/unauthorized-domain': 'Este domínio não está autorizado no Firebase Authentication ' +
            '(Console → Authentication → Settings → Authorized domains).',
        'permission-denied': 'Sem permissão pro Firestore. Confira as regras (firestore.rules) e ' +
            'se o App Check não está bloqueando este domínio (Console → App Check).'
    };
    return mapa[codigo] || error?.message || 'Erro inesperado';
}

// ========== SUPER-ADMIN (gestão das lojas da plataforma) ==========

// Cria uma loja nova. lojaId é o slug escolhido — vira o ID do documento, então precisa
// ser único (checa antes) e não muda depois (é o endereço público da loja).
async function criarLoja(lojaId, dados) {
    const { db } = await getFirebase();
    const slugRegex = /^[a-z0-9-]+$/;
    if (!slugRegex.test(lojaId)) {
        throw new Error('Slug inválido: use só letras minúsculas, números e hífen.');
    }
    const planosValidos = ['basico', 'intermediario', 'premium'];
    const plano = planosValidos.includes(dados.plano) ? dados.plano : 'basico';
    const ref = db.collection('lojas').doc(lojaId);
    const existente = await ref.get();
    if (existente.exists) {
        throw new Error('Já existe uma loja com esse slug.');
    }
    await ref.set({
        nome: dados.nome,
        emailAdmin: dados.emailAdmin || null,
        ativo: true,
        plano,
        statusPagamento: 'pago', // criada manualmente pelo super-admin, já entra paga
        pagoAte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        configuracoes: dados.configuracoes || {},
        criadoEm: new Date()
    });
    return { id: lojaId, ...dados, plano };
}

async function listarLojas() {
    const { db } = await getFirebase();
    const snapshot = await db.collection('lojas').get();
    const lojas = [];
    snapshot.forEach(doc => lojas.push({ id: doc.id, ...doc.data() }));
    return lojas;
}

async function definirStatusLoja(lojaId, ativo) {
    const { db } = await getFirebase();
    await db.collection('lojas').doc(lojaId).update({ ativo });
}

// Edita nome/plano de uma loja existente (super-admin only — regra do Firestore permite
// isSuperAdmin() mexer em qualquer campo, diferente do admin da própria loja que só pode
// mexer em "nome" e "configuracoes").
async function editarLojaSuperAdmin(lojaId, dados) {
    const { db } = await getFirebase();
    const planosValidos = ['basico', 'intermediario', 'premium'];
    const atualizacoes = {};
    if (typeof dados.nome === 'string' && dados.nome.trim()) atualizacoes.nome = dados.nome.trim();
    if (planosValidos.includes(dados.plano)) atualizacoes.plano = dados.plano;
    if (Object.keys(atualizacoes).length === 0) return;
    await db.collection('lojas').doc(lojaId).update(atualizacoes);
}

// Exclui a loja e suas subcoleções principais (produtos, pedidos, cupons, motoboys).
// Ação destrutiva e irreversível — o painel deve confirmar com o usuário antes de chamar.
async function deletarLoja(lojaId) {
    const { db } = await getFirebase();
    const subcolecoes = ['produtos', 'pedidos', 'cupons', 'motoboys'];
    for (const nome of subcolecoes) {
        const snapshot = await db.collection('lojas').doc(lojaId).collection(nome).get();
        if (snapshot.empty) continue;
        const docs = snapshot.docs;
        for (let i = 0; i < docs.length; i += 400) {
            const batch = db.batch();
            docs.slice(i, i + 400).forEach(doc => batch.delete(doc.ref));
            await batch.commit();
        }
    }
    await db.collection('lojas').doc(lojaId).delete();
}

// Confirma pagamento manual (Pix etc) e libera mais 30 dias de acesso — usado tanto pra
// ativar depois do trial quanto pra renovar um plano já pago. Sempre conta 30 dias a
// partir de AGORA (não empilha em cima do prazo anterior, mesmo que o super-admin
// confirme adiantado ou atrasado).
async function confirmarPagamentoLoja(lojaId) {
    const { db } = await getFirebase();
    const pagoAte = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await db.collection('lojas').doc(lojaId).update({ ativo: true, statusPagamento: 'pago', pagoAte });
}

async function getLojaPorSlug(lojaId) {
    const { db } = await getFirebase();
    const doc = await db.collection('lojas').doc(lojaId).get();
    if (!doc.exists) return null;
    return { id: doc.id, ...doc.data() };
}

// Vincula um admin (uid do Firebase Auth) a uma loja específica — chamado pelo super-admin
// ao dar acesso a um novo cliente. Precisa existir ANTES do cliente logar pela primeira vez.
async function vincularAdminALoja(uid, lojaId) {
    const { db } = await getFirebase();
    await db.collection('admins').doc(uid).set({ lojaId }, { merge: true });
}

// Slug ainda livre? Usado pelo formulário de cadastro público antes de criar a conta,
// pra não gastar um cadastro do Firebase Auth com um slug que já é de outra loja.
async function slugDisponivel(slug) {
    return !(await getLojaPorSlug(slug));
}

// ========== CADASTRO PÚBLICO (self-service) ==========
// Cliente cria a própria loja pela página de vendas, sem passar pelo super-admin.
// A loja já nasce ATIVA com 7 dias de teste grátis — sem precisar de pagamento pra
// começar a usar. Depois do trial, o acesso é bloqueado (lojaEstaAtiva() calcula isso
// sozinho, comparando com trialFim) até o super-admin confirmar o pagamento, que libera
// mais 30 dias (pagoAte). A regra do Firestore trava o prazo do trial em no máximo 8 dias
// a partir de agora — mesmo adulterando esse código no navegador, não dá pra estender.
async function cadastrarNovaLojaPublico({ slug, nomeLoja, email, senha, plano, whatsapp }) {
    const { auth } = await getFirebase();
    const planosValidos = ['basico', 'intermediario', 'premium'];
    if (!planosValidos.includes(plano)) throw new Error('Plano inválido.');

    const credencial = await auth.createUserWithEmailAndPassword(email, senha);
    const uid = credencial.user.uid;

    try {
        const { db } = await getFirebase();
        const trialFim = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.collection('lojas').doc(slug).set({
            nome: nomeLoja,
            donoUid: uid,
            emailAdmin: email,
            whatsapp: whatsapp || null,
            ativo: true,
            plano,
            statusPagamento: 'trial',
            trialFim,
            // "telefone" aqui (não "whatsapp") é de propósito — é o nome do campo que o
            // checkout (app.js/carregarConfigurações) já lê pra montar o link wa.me. Sem
            // isso, uma loja recém-criada mandaria pedidos pro número placeholder até o
            // dono lembrar de configurar o WhatsApp manualmente na aba Configurações.
            configuracoes: { telefone: whatsapp || null },
            criadoEm: new Date()
        });
        await db.collection('admins').doc(uid).set({ lojaId: slug });
        return { uid, slug, trialFim };
    } catch (error) {
        // Slug já existia (ou outra falha): não deixa um usuário Auth órfão, sem loja
        try { await credencial.user.delete(); } catch (_) { /* ignora */ }
        try { await auth.signOut(); } catch (_) { /* ignora */ }
        throw error;
    }
}

// Cria o login do admin de uma loja nova (super-admin only, na prática — a regra de
// /admins só libera escrita pra quem já é superadmin). Mesmo truque do criarMotoboy:
// um app Firebase secundário evita deslogar o super-admin que está criando o cliente.
async function criarAdminDaLoja(email, senha, lojaId) {
    const nomeAppSecundario = 'admin-creator-' + Date.now();
    const appSecundario = firebase.initializeApp(firebaseConfig, nomeAppSecundario);
    const authSecundario = appSecundario.auth();

    try {
        const credencial = await authSecundario.createUserWithEmailAndPassword(email, senha);
        const uid = credencial.user.uid;
        await authSecundario.signOut();
        await vincularAdminALoja(uid, lojaId);
        return { uid, email, lojaId };
    } catch (error) {
        console.error('Erro ao criar admin da loja:', error);
        throw error;
    } finally {
        await appSecundario.delete();
    }
}

// Lê o slug da loja a partir da URL. Aceita duas formas, nessa ordem de prioridade:
//   1. Caminho: arretadogo.com/pizzariax/... (primeiro pedaço do path, se não for um
//      dos arquivos .html conhecidos — cobre o caso de rewrites do Firebase Hosting)
//   2. Query string: arretadogo.com/index.html?loja=pizzariax (funciona em QUALQUER
//      hospedagem, sem precisar configurar rewrite nenhum — é o fallback seguro)
function resolverSlugDaLoja() {
    // Query string primeiro (?loja=slug) — é explícita e não depende de em qual pasta
    // o servidor está servindo os arquivos (localhost, preview de editor, subpasta de
    // hospedagem etc.), diferente do caminho da URL, que muda de ambiente pra ambiente.
    const params = new URLSearchParams(window.location.search);
    const doQuery = params.get('loja');
    if (doQuery) return doQuery.toLowerCase();

    // Sem query string: tenta o caminho bonito (arretadogo.com/pizzariax) — só funciona
    // quando o site está na raiz do domínio (precisa de rewrite do Firebase Hosting).
    const arquivosConhecidos = ['index.html', 'admin.html', 'motoboy.html', 'rastreio.html', 'super-admin.html', 'cadastro.html', ''];
    const partes = window.location.pathname.split('/').filter(Boolean);
    if (partes.length > 0 && !arquivosConhecidos.includes(partes[0].toLowerCase())) {
        return partes[0].toLowerCase();
    }
    return null;
}

// Usado por app.js (loja) e rastreio.js (cliente sem login): resolve o slug da URL,
// define lojaAtual e já traz os dados da loja — ou um motivo de erro pra página mostrar
// uma tela amigável ("loja não encontrada" / "loja temporariamente indisponível").
async function inicializarLoja() {
    const slug = resolverSlugDaLoja();
    if (!slug) return { erro: 'sem-slug' };
    definirLojaAtual(slug);
    const loja = await getLojaPorSlug(slug);
    if (!loja) return { erro: 'nao-encontrada', slug };
    if (!lojaEstaAtiva(loja)) return { erro: 'inativa', slug, loja };
    return { loja };
}

// Converte Timestamp do Firestore (ou string/Date) em Date do JS. Compartilhado entre
// motoboy.js, rastreio.js e admin.js — antes cada um tinha sua própria cópia dessa função.
function paraData(timestamp) {
    if (!timestamp) return null;
    return typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
}

// "ativo:true" sozinho não basta mais: toda loja tem um prazo (7 dias de teste grátis,
// depois 30 dias por pagamento confirmado) e ninguém apaga isso automaticamente no banco
// (sem Cloud Functions rodando nesse projeto) — então o prazo é calculado toda vez que
// alguém abre a loja, comparando com a data salva. Um admin desativado manualmente pelo
// super-admin (ativo:false) sempre vence, não importa o prazo.
function lojaEstaAtiva(loja) {
    if (!loja || loja.ativo === false) return false;
    const agora = new Date();
    if (loja.statusPagamento === 'trial') return !!loja.trialFim && agora < paraData(loja.trialFim);
    if (loja.statusPagamento === 'pago') return !!loja.pagoAte && agora < paraData(loja.pagoAte);
    return false; // 'pendente' ou qualquer outro valor: sem acesso liberado
}

// Texto amigável do prazo da loja, pro banner do admin e a tabela do super-admin.
function situacaoLoja(loja) {
    if (!loja) return { texto: '—', vencido: true };
    if (loja.ativo === false) return { texto: 'Desativada manualmente', vencido: true };

    const agora = new Date();
    if (loja.statusPagamento === 'trial' && loja.trialFim) {
        const fim = paraData(loja.trialFim);
        const msRestante = fim - agora;
        if (msRestante <= 0) return { texto: 'Teste grátis vencido', vencido: true };

        // Mostra a data e hora exatas de término, não só uma contagem de dias — assim o
        // prazo fica sempre claro e batendo com o que está salvo, em vez de arredondar.
        const dataFim = fim.toLocaleDateString('pt-BR');
        const horaFim = fim.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        const dias = Math.floor(msRestante / 86400000);
        const restante = dias >= 1
            ? `${dias} dia(s) restante(s)`
            : `${Math.floor(msRestante / 3600000)}h restantes`;
        return { texto: `Teste grátis termina em ${dataFim} às ${horaFim} (${restante})`, vencido: false };
    }
    if (loja.statusPagamento === 'pago' && loja.pagoAte) {
        const fim = paraData(loja.pagoAte);
        const dias = Math.ceil((fim - agora) / 86400000);
        return dias > 0
            ? { texto: `Pago até ${fim.toLocaleDateString('pt-BR')} (${dias}d)`, vencido: false }
            : { texto: `Vencido desde ${fim.toLocaleDateString('pt-BR')}`, vencido: true };
    }
    return { texto: 'Pagamento pendente', vencido: true };
}

// ========== HUB (página central que lista todas as lojas — ver hub.js) ==========
// Lista só as lojas ATIVAS (mesma regra de acesso usada em qualquer loja individual,
// lojaEstaAtiva() acima) — o hub não pode indicar uma loja vencida/desativada, senão o
// cliente entra, monta o pedido e trava porque a loja não aceita mais nada.
async function listarLojasParaHub() {
    const { db } = await getFirebase();
    const snapshot = await db.collection('lojas').get();
    const lojas = [];
    snapshot.forEach(doc => {
        const loja = { id: doc.id, ...doc.data() };
        if (lojaEstaAtiva(loja)) lojas.push(loja);
    });
    return lojas;
}

// Banners rotativos do hub: um único doc /plataforma/banners com campo "lista" (array de
// {titulo, imagem, link, ativo}) — editável só pelo super-admin (ver firestore.rules,
// match /plataforma/{docId}). O doc pode ainda não existir (plataforma nova, nenhum
// banner cadastrado) — trata como lista vazia nesse caso, sem gerar erro no hub.
async function getBannersHub() {
    const { db } = await getFirebase();
    const doc = await db.collection('plataforma').doc('banners').get();
    if (!doc.exists) return [];
    const dados = doc.data();
    return Array.isArray(dados.lista) ? dados.lista : [];
}

// Grava a lista inteira de banners de uma vez (usada por super-admin.js em
// adicionarBannerHub/moverBannerHub/alternarBannerHub/removerBannerHub — essa função
// estava sendo chamada mas nunca tinha sido definida, o que gerava
// "salvarBannersHub is not defined" em qualquer ação na área de banners do super-admin).
// set() com merge:false sobrescreve o doc inteiro — coerente com o padrão "lista
// completa" já usado aqui: quem decide a ordem/conteúdo final é sempre o array local.
async function salvarBannersHub(lista) {
    const { db } = await getFirebase();
    await db.collection('plataforma').doc('banners').set({ lista });
}

// ========== PAGAMENTO ONLINE (cobrança automática — Pix/Crédito/Débito) ==========
// Cada loja usa a PRÓPRIA conta de gateway (hoje: PagBank) — o dinheiro cai direto pra
// ela, a plataforma nunca fica com o dinheiro no meio do caminho. Por isso o token fica
// numa subcoleção PRIVADA (lojas/{id}/privado/pagamento), nunca no doc público da loja
// (que qualquer visitante lê — ver firestore.rules "match /lojas/{lojaId}").
//
// Desenhado pra caber outros gateways depois (Mercado Pago, Stripe etc.) sem reescrever
// nada: o campo "gateway" na config pública diz QUAL adaptador usar, e cada gateway tem
// sua própria função de Cloud Function por trás. Hoje só "pagbank" está implementado.

// URL base das Cloud Functions — troque pelo domínio do SEU projeto depois do deploy
// (Firebase Console → Functions → copia a URL de qualquer função, o começo até ".net/"
// é igual pras duas). Ver functions/README.md pro passo a passo de deploy.
const CLOUD_FUNCTIONS_BASE_URL = 'https://us-central1-arretadogo.cloudfunctions.net';

// Salva o TOKEN do gateway (dado sensível) na subcoleção privada — só o admin da própria
// loja ou o super-admin conseguem gravar aqui (ver firestore.rules). Fica separado do
// updateSettings() de propósito: assim o botão "Salvar configurações" nunca sobrescreve
// (ou apaga) o token sem querer.
async function salvarTokenGatewayPagamento(lojaId, { gateway, token, ambiente }) {
    const { db } = await getFirebase();
    await db.collection('lojas').doc(lojaId).collection('privado').doc('pagamento').set({
        gateway,
        token,
        ambiente: ambiente || 'producao', // 'sandbox' pra testar sem mexer com dinheiro de verdade
        atualizadoEm: new Date()
    }, { merge: true });
}

// Só pra saber SE já existe um token salvo (mostrar "•••• token salvo" no admin) — nunca
// devolve o token em si pro client re-exibir na tela.
async function existeTokenGatewayPagamento(lojaId) {
    const { db } = await getFirebase();
    const doc = await db.collection('lojas').doc(lojaId).collection('privado').doc('pagamento').get();
    return doc.exists && !!doc.data().token;
}

// Liga/desliga a cobrança automática — isso SIM é público (o app.js da loja precisa saber
// se mostra o fluxo de pagamento online ou o fluxo antigo de sempre).
async function definirPagamentoOnlineAtivo(ativo, gateway) {
    await updateSettings({ pagamentoOnline: { ativo, gateway: gateway || 'pagbank' } });
}

// Chama a Cloud Function que cria a cobrança no gateway e devolve a URL de pagamento
// hospedada (Pix, Crédito, Débito e Boleto ficam todos disponíveis nessa página do
// PagBank — não precisamos montar QR code nem formulário de cartão aqui, ele cuida disso).
async function iniciarPagamentoOnline(lojaId, pedidoId, redirectUrl) {
    const resposta = await fetch(`${CLOUD_FUNCTIONS_BASE_URL}/criarCheckoutPagamento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lojaId, pedidoId, redirectUrl })
    });
    const dados = await resposta.json();
    if (!resposta.ok || !dados.url) {
        throw new Error(dados.erro || 'Não foi possível iniciar o pagamento');
    }
    return dados; // { url, checkoutId }
}

// Observa o pedido em tempo real esperando o webhook confirmar o pagamento (ver
// functions/index.js/webhookPagamentoPagBank). Retorna a função de "parar de observar".
function observarPagamentoPedido(lojaId, pedidoId, callback) {
    let unsubscribe = () => {};
    getFirebase().then(({ db }) => {
        unsubscribe = db.collection('lojas').doc(lojaId).collection('pedidos').doc(pedidoId)
            .onSnapshot(doc => {
                if (doc.exists) callback(doc.data());
            });
    });
    return () => unsubscribe();
}

// ========== UTILIDADES FIRESTORE ==========

// Função para obter todos os produtos (loja pública - só ativos)
async function getAllProducts() {
    const { db } = await getFirebase();
    const snapshot = await colLoja(db, 'produtos').where('ativo', '==', true).get();
    const produtos = [];
    snapshot.forEach(doc => {
        produtos.push({ id: doc.id, ...doc.data() });
    });
    return produtos;
}

// Função para obter TODOS os produtos (admin - inclui ativos e inativos)
async function getAllProductsAdmin() {
    try {
        const { db } = await getFirebase();
        const snapshot = await colLoja(db, 'produtos').get();
        const produtos = [];
        snapshot.forEach(doc => {
            produtos.push({ id: doc.id, ...doc.data() });
        });
        return produtos;
    } catch (error) {
        console.error('Erro ao buscar produtos (admin):', error);
        return [];
    }
}

// Função para obter produto por ID
async function getProductById(id) {
    try {
        const { db } = await getFirebase();
        const doc = await colLoja(db, 'produtos').doc(id).get();
        if (doc.exists) {
            return { id: doc.id, ...doc.data() };
        }
        return null;
    } catch (error) {
        console.error('Erro ao buscar produto:', error);
        return null;
    }
}

// Função para adicionar produto
async function addProduct(product) {
    try {
        const { db } = await getFirebase();
        const docRef = await colLoja(db, 'produtos').add({
            ...product,
            criadoEm: new Date(),
            atualizadoEm: new Date()
        });
        return { id: docRef.id, ...product };
    } catch (error) {
        console.error('Erro ao adicionar produto:', error);
        throw error;
    }
}

// Função para atualizar produto
async function updateProduct(id, product) {
    try {
        const { db } = await getFirebase();
        await colLoja(db, 'produtos').doc(id).update({
            ...product,
            atualizadoEm: new Date()
        });
        return { id, ...product };
    } catch (error) {
        console.error('Erro ao atualizar produto:', error);
        throw error;
    }
}

// Função para deletar produto
async function deleteProduct(id) {
    try {
        const { db } = await getFirebase();
        await colLoja(db, 'produtos').doc(id).delete();
        return true;
    } catch (error) {
        console.error('Erro ao deletar produto:', error);
        throw error;
    }
}

// Função para buscar produtos por categoria
async function getProductsByCategory(category) {
    try {
        const { db } = await getFirebase();
        const snapshot = await colLoja(db, 'produtos')
            .where('categoria', '==', category)
            .where('ativo', '==', true)
            .get();
        const produtos = [];
        snapshot.forEach(doc => {
            produtos.push({ id: doc.id, ...doc.data() });
        });
        return produtos;
    } catch (error) {
        console.error('Erro ao buscar produtos por categoria:', error);
        return [];
    }
}

// Função para buscar produtos por texto
async function searchProducts(searchText) {
    try {
        const { db } = await getFirebase();
        const snapshot = await colLoja(db, 'produtos')
            .where('ativo', '==', true)
            .get();
        const produtos = [];
        const lowerSearch = searchText.toLowerCase();
        
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.nome.toLowerCase().includes(lowerSearch) ||
                data.descricao?.toLowerCase().includes(lowerSearch)) {
                produtos.push({ id: doc.id, ...data });
            }
        });
        return produtos;
    } catch (error) {
        console.error('Erro ao buscar produtos:', error);
        return [];
    }
}

// ========== CÓDIGO DO PEDIDO ==========
// Gera um código curto e legível pro pedido (ex: "AG-7F3M9K"), usado tanto na
// mensagem que o cliente recebe no WhatsApp quanto no painel admin/motoboy.
// É gerado no cliente ANTES de salvar no Firestore (não depende do ID do
// documento, que só existe depois do .add() terminar).
function gerarCodigoPedido() {
    // Sem caracteres ambíguos (0/O, 1/I) pra facilitar leitura e digitação
    const caracteres = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let sufixo = '';
    for (let i = 0; i < 6; i++) {
        sufixo += caracteres.charAt(Math.floor(Math.random() * caracteres.length));
    }
    return `AG-${sufixo}`;
}

// Função para salvar pedido
// status pode ser sobrescrito pelo chamador (ex: 'aguardando_pagamento' quando a loja tem
// cobrança automática ativada — ver iniciarPagamentoOnline) — por padrão continua 'pendente',
// que é o comportamento de sempre (pedido cai direto pro WhatsApp/painel, sem gateway).
async function savePedido(pedido) {
    try {
        const { db } = await getFirebase();
        const docRef = await colLoja(db, 'pedidos').add({
            ...pedido,
            criadoEm: new Date(),
            status: pedido.status || 'pendente'
        });
        return { id: docRef.id, ...pedido };
    } catch (error) {
        console.error('Erro ao salvar pedido:', error);
        throw error;
    }
}

// ========== CLIENTES (cadastro automático + reenvio de promoção) ==========
// Um documento por CLIENTE (não por pedido) — o ID do doc é o telefone só com dígitos,
// então pedir de novo com o mesmo número atualiza o cadastro existente em vez de duplicar.
// Alimentado automaticamente pelo checkout (app.js chama upsertCliente logo depois de
// salvar cada pedido) — o dono da loja não precisa cadastrar nada na mão.

function normalizarTelefoneId(telefone) {
    return (telefone || '').replace(/\D/g, '');
}

// Chamado pelo checkout depois de cada pedido. Nunca derruba o pedido se falhar (por
// isso quem chama envolve isso num try/catch próprio) — o cadastro de cliente é um
// "extra", não pode travar a venda.
async function upsertCliente({ nome, telefone, endereco, bairro, total, aceitaPromocao }) {
    const { db } = await getFirebase();
    const id = normalizarTelefoneId(telefone);
    if (!id) return; // sem telefone não dá pra identificar o cliente entre pedidos

    const ref = colLoja(db, 'clientes').doc(id);
    const dados = {
        nome: nome || '',
        telefone: telefone || '',
        ultimoPedidoEm: new Date(),
        totalPedidos: firebase.firestore.FieldValue.increment(1),
        totalGasto: firebase.firestore.FieldValue.increment(Number(total) || 0)
    };
    // Só sobrescreve endereço/bairro se vieram preenchidos (retirada não tem endereço,
    // não queremos apagar o endereço salvo de uma compra anterior por causa disso).
    if (endereco) dados.endereco = endereco;
    if (bairro) dados.bairro = bairro;
    // Opt-in de promoção: se o cliente desmarcar num pedido novo, respeita (queremos o
    // valor mais recente, não "OU lógico" com o que já existia).
    if (typeof aceitaPromocao === 'boolean') dados.aceitaPromocao = aceitaPromocao;

    const existe = (await ref.get()).exists;
    if (!existe) dados.criadoEm = new Date();

    await ref.set(dados, { merge: true });
}

async function listarClientes() {
    const { db } = await getFirebase();
    const snap = await colLoja(db, 'clientes').orderBy('ultimoPedidoEm', 'desc').get();
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

// Histórico de pedidos de UM cliente — base pro que vier depois (gráfico de compras,
// cupom personalizado, fidelidade). Filtra pelo telefone salvo no pedido (mesmo campo
// usado como ID do cliente, só que aqui comparamos como veio digitado no checkout).
async function listarPedidosDoCliente(telefone) {
    const { db } = await getFirebase();
    const snap = await colLoja(db, 'pedidos').where('telefone', '==', telefone).get();
    const pedidos = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
    // Ordena no JS (não no Firestore) pra não depender de criar um índice composto só
    // pra isso — a lista de pedidos de UM cliente nunca é grande o bastante pra pesar.
    pedidos.sort((a, b) => paraDataOrdenavel(b.criadoEm) - paraDataOrdenavel(a.criadoEm));
    return pedidos;
}

function paraDataOrdenavel(valor) {
    if (!valor) return 0;
    if (typeof valor.toDate === 'function') return valor.toDate().getTime();
    return new Date(valor).getTime() || 0;
}

// Apagar um cliente do cadastro (pedido de exclusão do titular dos dados, LGPD) — isso
// NÃO apaga os pedidos já feitos (ficam no histórico da loja normalmente), só o registro
// consolidado usado pra reenvio de promoção.
async function excluirCliente(clienteId) {
    const { db } = await getFirebase();
    await colLoja(db, 'clientes').doc(clienteId).delete();
}

// ========== FIDELIDADE (recompensa automática a cada N pedidos) ==========
// Guardada separada do cadastro do cliente, num doc mínimo (lojas/{id}/recompensas/{tel}
// com só telefone/contador/desconto — nada de nome/endereço) porque essa coleção precisa
// ser lida pelo CHECKOUT sem login (pra auto-aplicar o desconto), e um doc enxuto assim
// vaza bem menos dado pessoal do que abrir a leitura pública do cadastro de clientes
// inteiro (ver firestore.rules pra entender por que "get" é liberado mas "list" não).

// Chamada de dentro de updatePedidoStatus quando o pedido vira "entregue" — nunca no
// create do pedido, pra não contar cancelado/nem confirmado ainda.
async function processarFidelidadePedido(pedidoId) {
    const { db } = await getFirebase();
    const pedidoRef = colLoja(db, 'pedidos').doc(pedidoId);
    const pedidoSnap = await pedidoRef.get();
    if (!pedidoSnap.exists) return;
    const pedido = pedidoSnap.data();

    if (pedido.fidelidadeProcessada) return; // idempotente — nunca conta o mesmo pedido 2x

    const lojaSnap = await docLojaAtual(db).get();
    const fidelidade = lojaSnap.data()?.configuracoes?.fidelidade;

    if (!fidelidade?.ativo) {
        await pedidoRef.update({ fidelidadeProcessada: true });
        return;
    }
    const valorMinimo = Number(fidelidade.valorMinimo) || 0;
    if ((pedido.total || 0) < valorMinimo) {
        await pedidoRef.update({ fidelidadeProcessada: true });
        return;
    }

    const telefoneId = normalizarTelefoneId(pedido.telefone);
    if (!telefoneId) {
        await pedidoRef.update({ fidelidadeProcessada: true });
        return;
    }

    const necessarios = Number(fidelidade.pedidosNecessarios) || 10;
    const recompensaRef = colLoja(db, 'recompensas').doc(telefoneId);

    await db.runTransaction(async (transaction) => {
        const recSnap = await transaction.get(recompensaRef);
        const atual = recSnap.exists ? (recSnap.data().pedidosQualificados || 0) : 0;
        const novoContador = atual + 1;

        if (novoContador >= necessarios) {
            transaction.set(recompensaRef, {
                pedidosQualificados: 0, // zera — recomeça a contagem pra próxima recompensa
                disponivel: true,
                desconto: Number(fidelidade.desconto) || 10,
                atualizadoEm: new Date()
            });
        } else {
            transaction.set(recompensaRef, {
                pedidosQualificados: novoContador,
                atualizadoEm: new Date()
            }, { merge: true });
        }

        transaction.update(pedidoRef, { fidelidadeProcessada: true });
    });
}

// Usada pelo checkout (sem login) assim que o cliente digita o telefone — pra saber se
// mostra o banner de desconto automático. "get" de um doc específico é liberado por
// regra, mas listar todos NÃO é — só dá pra consultar quem já sabe o próprio telefone.
async function consultarRecompensaFidelidade(telefone) {
    const { db } = await getFirebase();
    const telefoneId = normalizarTelefoneId(telefone);
    if (!telefoneId) return null;
    const snap = await colLoja(db, 'recompensas').doc(telefoneId).get();
    if (!snap.exists || snap.data().disponivel !== true) return null;
    return { telefoneId, desconto: snap.data().desconto };
}

// Marca a recompensa como usada DEPOIS que o pedido com o desconto aplicado foi salvo.
// A regra do Firestore só deixa essa escrita pública mudar "disponivel" pra false —
// nunca reativar nem mudar o valor do desconto (isso só a loja consegue, via
// processarFidelidadePedido, que roda autenticado).
async function resgatarRecompensaFidelidade(telefoneId) {
    const { db } = await getFirebase();
    await colLoja(db, 'recompensas').doc(telefoneId).update({ disponivel: false });
}

// Pro modal de histórico no admin — mostra a barrinha de progresso "7/10 pedidos".
async function obterProgressoFidelidade(telefone) {
    const { db } = await getFirebase();
    const telefoneId = normalizarTelefoneId(telefone);
    if (!telefoneId) return null;
    const snap = await colLoja(db, 'recompensas').doc(telefoneId).get();
    return snap.exists ? snap.data() : { pedidosQualificados: 0, disponivel: false };
}

// Função para atualizar status do pedido.
// "extra" permite gravar campos adicionais junto (ex: motoboy.js manda motoboyId/motoboyNome
// ao marcar "saiu_entrega", pra saber depois quem entregou cada pedido no histórico).
//
// Centraliza a baixa/estorno de estoque aqui dentro (em vez de cada chamador ter que lembrar
// de fazer isso na mão) — assim funciona igual não importa se quem mudou o status foi o admin
// (aba Pedidos) ou o motoboy (painel dele). Antes só o admin.js chamava a baixa de estoque
// manualmente, então pedidos concluídos direto pelo motoboy nunca descontavam estoque nem
// contavam em "mais vendidos".
async function updatePedidoStatus(id, status, extra) {
    try {
        const { db } = await getFirebase();
        const dadosAtualizacao = { status, ...(extra || {}) };

        // Registra o momento exato em que a entrega foi confirmada — usado pelo dashboard
        // pra calcular "vendas de hoje/mês" pela data real da venda, não pela data em que o
        // pedido foi criado (um pedido criado ontem e entregue hoje deve contar como venda de hoje).
        if (status === 'entregue') {
            dadosAtualizacao.entregueEm = new Date();
        }

        await colLoja(db, 'pedidos').doc(id).update(dadosAtualizacao);

        // Fidelidade: só processa quando o pedido É ENTREGUE de verdade (não em "pendente"
        // nem "preparando") — assim ninguém acumula pedido cancelado ou nem confirmado.
        if (status === 'entregue') {
            try {
                await processarFidelidadePedido(id);
            } catch (erroFidelidade) {
                console.error('Erro ao processar fidelidade do pedido', id, erroFidelidade);
            }
        }

        let resultadoEstoque = null;
        const statusNormalizado = (status || '').toLowerCase();
        try {
            if (statusNormalizado.includes('cancel')) {
                await estornarBaixaEstoquePedido(id);
            } else if (statusNormalizado !== 'pendente') {
                resultadoEstoque = await processarBaixaEstoquePedido(id);
            }
        } catch (erroEstoque) {
            // Não deixa um erro no ajuste de estoque esconder que o status FOI atualizado
            // com sucesso — só avisa no console e segue. Quem chamou pode conferir o estoque
            // manualmente se precisar.
            console.error('Erro ao ajustar estoque para o pedido', id, erroEstoque);
        }

        return { ok: true, resultadoEstoque };
    } catch (error) {
        console.error('Erro ao atualizar status do pedido:', error);
        throw error;
    }
}

// ========== BAIXA DE ESTOQUE ==========
// Quando um pedido é confirmado (sai de "pendente"), cada item deveria "sair" do estoque.
// Produtos feitos na hora (pizzas com sabores, sanduíches com adicionais, pastéis, etc.)
// costumam ter estoque infinito na prática, então em vez de zerar um número artificial,
// o admin pode marcar controlaEstoque = false pra esses produtos: nesse caso a gente só
// contabiliza quantidadeVendida (quantos foram vendidos/entregues), sem mexer no campo estoque.
//
// Idempotente: usa a flag estoqueProcessado no próprio pedido pra nunca descontar duas vezes,
// mesmo que o status passe por várias etapas (confirmado -> preparando -> entregue).
async function processarBaixaEstoquePedido(pedidoId) {
    try {
        const { db } = await getFirebase();
        const pedidoRef = colLoja(db, 'pedidos').doc(pedidoId);
        let itensComEstoqueInsuficiente = [];

        await db.runTransaction(async (transaction) => {
            const pedidoSnap = await transaction.get(pedidoRef);
            if (!pedidoSnap.exists) return;

            const pedidoData = pedidoSnap.data();
            if (pedidoData.estoqueProcessado) return; // já processado, não desconta de novo

            const itens = Array.isArray(pedidoData.itens) ? pedidoData.itens : [];

            // Primeiro lê todos os produtos (transactions do Firestore exigem todas as leituras antes das escritas)
            const leituras = await Promise.all(
                itens.map(item => transaction.get(colLoja(db, 'produtos').doc(item.id)))
            );

            itens.forEach((item, i) => {
                const produtoSnap = leituras[i];
                if (!produtoSnap.exists) return;

                const produtoData = produtoSnap.data();
                const atualizacao = {
                    quantidadeVendida: (produtoData.quantidadeVendida || 0) + (item.quantidade || 0)
                };

                if (produtoData.controlaEstoque !== false) {
                    const estoqueAtual = produtoData.estoque || 0;
                    const quantidadePedida = item.quantidade || 0;

                    // Detecta o caso de dois pedidos "batendo" no mesmo último item: o estoque
                    // já não é suficiente pra cobrir esse pedido. Não bloqueia a confirmação
                    // (a decisão de como resolver com o cliente é do admin), só sinaliza pra
                    // quem chamou essa função poder avisar.
                    if (estoqueAtual < quantidadePedida) {
                        itensComEstoqueInsuficiente.push({
                            nome: produtoData.nome || item.nome || 'Produto',
                            faltavam: quantidadePedida - estoqueAtual
                        });
                    }

                    atualizacao.estoque = Math.max(0, estoqueAtual - quantidadePedida);
                }

                transaction.update(produtoSnap.ref, atualizacao);
            });

            transaction.update(pedidoRef, { estoqueProcessado: true });
        });

        return { itensComEstoqueInsuficiente };
    } catch (error) {
        console.error('Erro ao processar baixa de estoque:', error);
        throw error;
    }
}

// Estorna a baixa de estoque (usado quando um pedido já confirmado é cancelado depois)
async function estornarBaixaEstoquePedido(pedidoId) {
    try {
        const { db } = await getFirebase();
        const pedidoRef = colLoja(db, 'pedidos').doc(pedidoId);

        await db.runTransaction(async (transaction) => {
            const pedidoSnap = await transaction.get(pedidoRef);
            if (!pedidoSnap.exists) return;

            const pedidoData = pedidoSnap.data();
            if (!pedidoData.estoqueProcessado) return; // nunca foi descontado, nada a estornar

            const itens = Array.isArray(pedidoData.itens) ? pedidoData.itens : [];

            const leituras = await Promise.all(
                itens.map(item => transaction.get(colLoja(db, 'produtos').doc(item.id)))
            );

            itens.forEach((item, i) => {
                const produtoSnap = leituras[i];
                if (!produtoSnap.exists) return;

                const produtoData = produtoSnap.data();
                const atualizacao = {
                    quantidadeVendida: Math.max(0, (produtoData.quantidadeVendida || 0) - (item.quantidade || 0))
                };

                if (produtoData.controlaEstoque !== false) {
                    atualizacao.estoque = (produtoData.estoque || 0) + (item.quantidade || 0);
                }

                transaction.update(produtoSnap.ref, atualizacao);
            });

            transaction.update(pedidoRef, { estoqueProcessado: false });
        });

        return true;
    } catch (error) {
        console.error('Erro ao estornar baixa de estoque:', error);
        throw error;
    }
}

// Função para obter todos os pedidos (admin)
async function getAllPedidos() {
    try {
        const { db } = await getFirebase();
        const snapshot = await colLoja(db, 'pedidos').orderBy('criadoEm', 'desc').get();
        const pedidos = [];
        snapshot.forEach(doc => {
            pedidos.push({ id: doc.id, ...doc.data() });
        });
        return pedidos;
    } catch (error) {
        console.error('Erro ao buscar pedidos:', error);
        return [];
    }
}

// Função para atualizar configurações (agora vivem dentro do campo "configuracoes"
// do próprio doc /lojas/{lojaId}, não mais num singleton /configuracoes/loja separado)
async function updateSettings(settings) {
    try {
        const { db } = await getFirebase();
        await docLojaAtual(db).set({ configuracoes: settings }, { merge: true });
        return true;
    } catch (error) {
        console.error('Erro ao atualizar configurações:', error);
        throw error;
    }
}

// Função para obter configurações
async function getSettings() {
    try {
        const { db } = await getFirebase();
        const doc = await docLojaAtual(db).get();
        return doc.exists ? (doc.data().configuracoes || {}) : null;
    } catch (error) {
        console.error('Erro ao buscar configurações:', error);
        return null;
    }
}

// ========== HORÁRIO DE FUNCIONAMENTO ==========
// Compartilhado entre app.js (loja) e admin.js (dashboard), por isso mora aqui
// (firebase-config.js é o único script carregado nas 3 páginas: loja, admin e motoboy).
//
// Schema salvo em configuracoes/loja.horarioFuncionamento:
// {
//   ativo: boolean,               // se false, ignora os horários e a loja fica sempre "aberta"
//   dias: {
//     dom: { fechado: boolean, abre: "18:00", fecha: "23:00" },
//     seg: { ... }, ter: { ... }, qua: { ... }, qui: { ... }, sex: { ... }, sab: { ... }
//   }
// }
const DIAS_SEMANA_ORDEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const DIAS_SEMANA_LABEL = {
    dom: 'Domingo', seg: 'Segunda', ter: 'Terça', qua: 'Quarta',
    qui: 'Quinta', sex: 'Sexta', sab: 'Sábado'
};

function horarioFuncionamentoPadrao() {
    const dias = {};
    DIAS_SEMANA_ORDEM.forEach(dia => {
        dias[dia] = { fechado: false, abre: '18:00', fecha: '23:00' };
    });
    return { ativo: false, dias };
}

// Converte "HH:mm" pra minutos desde 00:00, pra comparar horários facilmente
function horaParaMinutos(horaStr) {
    const [h, m] = (horaStr || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

// Calcula se a loja está aberta agora, com base no horário configurado e no relógio do dispositivo.
// Lida com horários que passam da meia-noite (ex: abre 18:00, fecha 02:00).
// Retorna: { aberta, controlado, diaAtual, horarioHoje, proximaAbertura }
function calcularStatusLoja(config) {
    const horario = config?.horarioFuncionamento;

    // Sem configuração ou controle desligado: loja sempre "aberta" (comportamento antigo)
    if (!horario || !horario.ativo) {
        return { aberta: true, controlado: false };
    }

    const agora = new Date();
    const diaHojeKey = DIAS_SEMANA_ORDEM[agora.getDay()];
    const minutosAgora = agora.getHours() * 60 + agora.getMinutes();
    const diaOntemKey = DIAS_SEMANA_ORDEM[(agora.getDay() + 6) % 7];

    const horarioHoje = horario.dias?.[diaHojeKey] || { fechado: true };
    const horarioOntem = horario.dias?.[diaOntemKey] || { fechado: true };

    let aberta = false;

    // Caso 1: turno de hoje ainda não fechou (cobre também horários dentro do mesmo dia)
    if (!horarioHoje.fechado) {
        const abre = horaParaMinutos(horarioHoje.abre);
        const fecha = horaParaMinutos(horarioHoje.fecha);
        if (fecha > abre) {
            // Turno normal dentro do mesmo dia (ex: 11:00 às 23:00)
            if (minutosAgora >= abre && minutosAgora < fecha) aberta = true;
        } else {
            // Turno vira a noite (ex: 18:00 às 02:00): a partir da hora de abrir já conta como aberto hoje
            if (minutosAgora >= abre) aberta = true;
        }
    }

    // Caso 2: turno que começou ONTEM e vira a madrugada de hoje (ex: ontem 18:00 - hoje 02:00)
    if (!aberta && !horarioOntem.fechado) {
        const abreOntem = horaParaMinutos(horarioOntem.abre);
        const fechaOntem = horaParaMinutos(horarioOntem.fecha);
        if (fechaOntem <= abreOntem && minutosAgora < fechaOntem) {
            aberta = true;
        }
    }

    // Monta uma dica de "próxima abertura" pra exibir quando estiver fechada
    let proximaAbertura = null;
    if (!aberta) {
        for (let i = 0; i < 8; i++) {
            const diaKey = DIAS_SEMANA_ORDEM[(agora.getDay() + i) % 7];
            const diaInfo = horario.dias?.[diaKey];
            if (diaInfo && !diaInfo.fechado) {
                // No próprio dia de hoje, só sugere o horário de abertura se ele ainda não passou
                if (i === 0 && horaParaMinutos(diaInfo.abre) <= minutosAgora) continue;
                proximaAbertura = { dia: diaKey, label: i === 0 ? 'hoje' : (i === 1 ? 'amanhã' : DIAS_SEMANA_LABEL[diaKey]), hora: diaInfo.abre };
                break;
            }
        }
    }

    return { aberta, controlado: true, diaAtual: diaHojeKey, horarioHoje, proximaAbertura };
}

// ========== AUTENTICAÇÃO SIMPLES (opcional) ==========

// Função para login do admin
async function loginAdmin(email, password) {
    try {
        const { auth } = await getFirebase();
        const result = await auth.signInWithEmailAndPassword(email, password);
        return result.user;
    } catch (error) {
        console.error('Erro ao fazer login:', error);
        throw error;
    }
}

// Alias genérico: mesmo mecanismo de login, usado pela área do motoboy
async function loginComEmailSenha(email, password) {
    return loginAdmin(email, password);
}

// Função para logout
async function logoutAdmin() {
    try {
        const { auth } = await getFirebase();
        await auth.signOut();
        return true;
    } catch (error) {
        console.error('Erro ao fazer logout:', error);
        throw error;
    }
}

// ========== MOTOBOYS ==========
// Cria uma conta de motoboy (Firebase Auth + documento em /motoboys) sem
// derrubar a sessão do admin que está logado, usando um app Firebase secundário.
async function criarMotoboy(nome, email, senha) {
    const { db } = await getFirebase();

    const nomeAppSecundario = 'motoboy-creator-' + Date.now();
    const appSecundario = firebase.initializeApp(firebaseConfig, nomeAppSecundario);
    const authSecundario = appSecundario.auth();

    try {
        const credencial = await comTimeout(
            authSecundario.createUserWithEmailAndPassword(email, senha),
            15000,
            'Demorou demais pra criar o login. Se estiver testando fora do domínio de produção, ' +
            'confira o App Check (Firebase Console → App Check) — veja o console (F12) para mais detalhes.'
        );
        const uid = credencial.user.uid;
        const MENSAGEM_TIMEOUT_FIRESTORE = 'A conta de login foi criada, mas gravar o cadastro ' +
            'do motoboy demorou demais e não respondeu (provável App Check bloqueando este domínio ' +
            '— Firebase Console → App Check). Veja o console (F12) para mais detalhes.';

        try {
            await comTimeout(
                colLoja(db, 'motoboys').doc(uid).set({
                    nome,
                    email,
                    ativo: true,
                    criadoEm: new Date()
                }),
                15000,
                MENSAGEM_TIMEOUT_FIRESTORE
            );

            // Índice global uid -> lojaId. Motoboys ficam dentro da subcoleção da loja
            // (colLoja), então sem esse índice não daria pra saber a loja de um motoboy
            // só pelo uid dele — precisa dessa ponte pra resolver isso ANTES de definir
            // lojaAtual, no login do motoboy.js.
            await comTimeout(
                db.collection('motoboy_index').doc(uid).set({ lojaId: obterLojaAtual() }),
                15000,
                MENSAGEM_TIMEOUT_FIRESTORE
            );
        } catch (erroFirestore) {
            // Se a gravação no Firestore falhar, desfaz a conta recém-criada no
            // Authentication — sem isso ela fica "órfã" (existe o login, mas não o
            // cadastro), e todo re-cadastro com esse e-mail passa a falhar com
            // "e-mail já em uso" pra sempre.
            try { await credencial.user.delete(); } catch (_) { /* ignora */ }
            throw erroFirestore;
        }

        // Desloga o app secundário só depois de garantir que tudo foi gravado
        await authSecundario.signOut();

        return { uid, nome, email, ativo: true };
    } catch (error) {
        console.error('Erro ao criar motoboy:', error);
        throw error;
    } finally {
        // Sempre remove o app secundário, mesmo se der erro
        await appSecundario.delete();
    }
}

// Descobre a loja de um motoboy pelo uid, SEM precisar de lojaAtual já definida
// (usado no login do motoboy.js, antes de sabermos qual loja é essa)
async function getMotoboyLojaId(uid) {
    try {
        const { db } = await getFirebase();
        const doc = await db.collection('motoboy_index').doc(uid).get();
        return doc.exists ? doc.data().lojaId : null;
    } catch (error) {
        console.error('Erro ao verificar loja do motoboy:', error);
        return null;
    }
}

// Lista todos os motoboys cadastrados (admin)
async function getAllMotoboys() {
    try {
        const { db } = await getFirebase();
        const snapshot = await colLoja(db, 'motoboys').orderBy('criadoEm', 'desc').get();
        const motoboys = [];
        snapshot.forEach(doc => {
            motoboys.push({ uid: doc.id, ...doc.data() });
        });
        return motoboys;
    } catch (error) {
        console.error('Erro ao buscar motoboys:', error);
        return [];
    }
}

// Ativa/desativa o acesso de um motoboy (a conta de login continua existindo no
// Firebase Auth, mas o acesso ao painel é bloqueado quando ativo = false)
async function definirStatusMotoboy(uid, ativo) {
    try {
        const { db } = await getFirebase();
        await colLoja(db, 'motoboys').doc(uid).update({ ativo });
        return true;
    } catch (error) {
        console.error('Erro ao atualizar motoboy:', error);
        throw error;
    }
}

// Busca o cadastro de motoboy pelo uid autenticado (usado para checar se o
// login atual tem permissão de motoboy, e se está ativo)
async function getMotoboyByUid(uid) {
    try {
        const { db } = await getFirebase();
        const doc = await colLoja(db, 'motoboys').doc(uid).get();
        return doc.exists ? { uid: doc.id, ...doc.data() } : null;
    } catch (error) {
        console.error('Erro ao verificar motoboy:', error);
        return null;
    }
}

// Motoboy liga/desliga o próprio status "disponível pra entregas" (toggle no dashboard).
// É só uma informação visual por enquanto — não bloqueia nada no fluxo de pedidos.
async function atualizarStatusOnlineMotoboy(uid, online) {
    try {
        const { db } = await getFirebase();
        await colLoja(db, 'motoboys').doc(uid).update({ online });
    } catch (error) {
        console.error('Erro ao atualizar status online:', error);
        throw error;
    }
}

// ========== COZINHA ==========
// Cria uma conta de funcionário da cozinha (Firebase Auth + documento em /cozinha),
// mesmo esquema do criarMotoboy — app secundário pra não derrubar a sessão do admin.
async function criarCozinha(nome, email, senha) {
    const { db } = await getFirebase();

    const nomeAppSecundario = 'cozinha-creator-' + Date.now();
    const appSecundario = firebase.initializeApp(firebaseConfig, nomeAppSecundario);
    const authSecundario = appSecundario.auth();

    try {
        const credencial = await comTimeout(
            authSecundario.createUserWithEmailAndPassword(email, senha),
            15000,
            'Demorou demais pra criar o login. Se estiver testando fora do domínio de produção, ' +
            'confira o App Check (Firebase Console → App Check) — veja o console (F12) para mais detalhes.'
        );
        const uid = credencial.user.uid;
        const MENSAGEM_TIMEOUT_FIRESTORE = 'A conta de login foi criada, mas gravar o cadastro ' +
            'da cozinha demorou demais e não respondeu (provável App Check bloqueando este domínio ' +
            '— Firebase Console → App Check). Veja o console (F12) para mais detalhes.';

        try {
            await comTimeout(
                colLoja(db, 'cozinha').doc(uid).set({
                    nome,
                    email,
                    ativo: true,
                    criadoEm: new Date()
                }),
                15000,
                MENSAGEM_TIMEOUT_FIRESTORE
            );

            // Mesma ideia do motoboy_index: índice global uid -> lojaId, necessário pra
            // resolver a loja do funcionário no login ANTES de lojaAtual estar definida
            // (cozinha também fica dentro de uma subcoleção por loja).
            await comTimeout(
                db.collection('cozinha_index').doc(uid).set({ lojaId: obterLojaAtual() }),
                15000,
                MENSAGEM_TIMEOUT_FIRESTORE
            );
        } catch (erroFirestore) {
            // Se a gravação no Firestore falhar (ex: sem permissão, offline), desfaz a
            // conta recém-criada no Authentication — sem isso ela fica "órfã": existe
            // no login mas não tem cadastro de cozinha, e todo re-cadastro com esse
            // e-mail passa a falhar com "e-mail já em uso" pra sempre.
            try { await credencial.user.delete(); } catch (_) { /* ignora */ }
            throw erroFirestore;
        }

        await authSecundario.signOut();
        return { uid, nome, email, ativo: true };
    } catch (error) {
        console.error('Erro ao criar funcionário da cozinha:', error);
        throw error;
    } finally {
        await appSecundario.delete();
    }
}

// Descobre a loja de um funcionário da cozinha pelo uid, sem precisar de lojaAtual
// já definida (usado no login do cozinha.html, antes de sabermos qual loja é essa)
async function getCozinhaLojaId(uid) {
    try {
        const { db } = await getFirebase();
        const doc = await db.collection('cozinha_index').doc(uid).get();
        return doc.exists ? doc.data().lojaId : null;
    } catch (error) {
        console.error('Erro ao verificar loja da cozinha:', error);
        return null;
    }
}

// Lista os funcionários da cozinha cadastrados (admin)
async function getAllCozinha() {
    try {
        const { db } = await getFirebase();
        const snapshot = await colLoja(db, 'cozinha').orderBy('criadoEm', 'desc').get();
        const equipe = [];
        snapshot.forEach(doc => equipe.push({ uid: doc.id, ...doc.data() }));
        return equipe;
    } catch (error) {
        console.error('Erro ao buscar equipe da cozinha:', error);
        return [];
    }
}

// Ativa/desativa o acesso de um funcionário da cozinha (mesma lógica do motoboy:
// a conta de login continua existindo, só o acesso ao painel é bloqueado)
async function definirStatusCozinha(uid, ativo) {
    try {
        const { db } = await getFirebase();
        await colLoja(db, 'cozinha').doc(uid).update({ ativo });
        return true;
    } catch (error) {
        console.error('Erro ao atualizar funcionário da cozinha:', error);
        throw error;
    }
}

// Busca o cadastro de cozinha pelo uid autenticado (checa se o login atual tem
// permissão de cozinha, e se está ativo)
async function getCozinhaByUid(uid) {
    try {
        const { db } = await getFirebase();
        const doc = await colLoja(db, 'cozinha').doc(uid).get();
        return doc.exists ? { uid: doc.id, ...doc.data() } : null;
    } catch (error) {
        console.error('Erro ao verificar funcionário da cozinha:', error);
        return null;
    }
}

// ========== ADMINS ==========
// Verifica se o uid autenticado está na allowlist de admins (coleção /admins).
// Essa coleção só deve ser populada manualmente pelo Console do Firebase,
// nunca criada a partir do client — por isso não existe "criarAdmin()" aqui.
async function getAdminByUid(uid) {
    try {
        const { db } = await getFirebase();
        const doc = await db.collection('admins').doc(uid).get();
        return doc.exists ? { uid: doc.id, ...doc.data() } : null;
    } catch (error) {
        console.error('Erro ao verificar admin:', error);
        return null;
    }
}

// Observa em tempo real todos os pedidos (usado na área do motoboy pra atualizar a lista sozinha)
// Escuta em tempo real os pedidos dos últimos N dias (60 por padrão) — usado pelo painel do
// admin e do motoboy pra mostrar a operação do dia a dia.
//
// IMPORTANTE: antes essa função carregava a coleção "pedidos" INTEIRA, sem limite nenhum.
// Isso significa que, com meses de histórico acumulado, toda vez que alguém abria o painel
// (admin ou motoboy) o app baixava — e ficava ouvindo em tempo real — cada pedido já feito
// desde o primeiro dia da loja. Isso ia ficando mais lento e mais caro (em leituras do
// Firestore) a cada mês que passava, mesmo em dias de pouco movimento. Limitar a uma janela
// rolante resolve isso: o painel ao vivo só carrega o que é operacionalmente relevante.
//
// Pra relatórios de períodos mais antigos (fora dessa janela), use buscarPedidosPorPeriodo()
// abaixo, que faz uma busca avulsa (sem ficar "ouvindo" pra sempre) exatamente no intervalo
// pedido, em vez de depender do que já está carregado na tela.
async function observarTodosPedidos(callback, diasAtras) {
    const { db } = await getFirebase();
    const janela = diasAtras || 60;
    const dataLimite = new Date();
    dataLimite.setDate(dataLimite.getDate() - janela);

    return colLoja(db, 'pedidos')
        .where('criadoEm', '>=', dataLimite)
        .orderBy('criadoEm', 'desc')
        .onSnapshot((snapshot) => {
            const pedidos = [];
            snapshot.forEach(doc => {
                pedidos.push({ id: doc.id, ...doc.data() });
            });
            callback(pedidos);
        }, (error) => {
            console.error('Erro ao observar pedidos:', error);
        });
}

// Busca (uma vez só, sem ficar escutando) os pedidos criados num intervalo específico —
// usado pelo relatório em Excel, que pode pedir períodos mais antigos que a janela rolante
// de cima (ex: "mês passado"). Faz a busca direto no Firestore só do que precisa, em vez de
// depender de já estar tudo carregado na memória.
async function buscarPedidosPorPeriodo(inicio, fim) {
    const { db } = await getFirebase();
    const snapshot = await colLoja(db, 'pedidos')
        .where('criadoEm', '>=', inicio)
        .where('criadoEm', '<', fim)
        .orderBy('criadoEm', 'desc')
        .get();

    const pedidos = [];
    snapshot.forEach(doc => pedidos.push({ id: doc.id, ...doc.data() }));
    return pedidos;
}

// ========== RASTREAMENTO DE PEDIDO (CLIENTE) ==========

// Salva a avaliação pós-entrega (estrelas 1-5 + comentário opcional) — chamada pelo
// cliente na própria página de rastreio, depois que o pedido chega em "entregue".
// A regra do Firestore (ver firestore.rules) já garante que isso só funciona uma vez
// por pedido e só depois de entregue, então aqui é só montar o dado e gravar.
async function salvarAvaliacaoPedido(pedidoId, nota, comentario) {
    const notaNumero = Number(nota);
    if (!Number.isInteger(notaNumero) || notaNumero < 1 || notaNumero > 5) {
        throw new Error('Nota inválida — escolha de 1 a 5 estrelas.');
    }

    const { db } = await getFirebase();
    await colLoja(db, 'pedidos').doc(pedidoId).update({
        avaliacao: {
            nota: notaNumero,
            comentario: (comentario || '').trim().slice(0, 500),
            criadoEm: new Date()
        }
    });
}

// Escuta em tempo real UM pedido específico — usado na página de rastreamento (rastreio.html).
// callback(null) quando o pedido não existe (ID inválido/apagado/deletado).
async function observarPedido(pedidoId, callback) {
    const { db } = await getFirebase();
    return colLoja(db, 'pedidos').doc(pedidoId).onSnapshot(
        (doc) => callback(doc.exists ? { id: doc.id, ...doc.data() } : null),
        (error) => {
            console.error('Erro ao observar pedido:', error);
            callback(null);
        }
    );
}

// Motoboy grava a localização atual (lat/lng) no pedido em entrega. Chamado periodicamente
// pelo motoboy.js enquanto o status for "saiu_entrega".
async function atualizarLocalizacaoPedido(pedidoId, lat, lng) {
    try {
        const { db } = await getFirebase();
        await colLoja(db, 'pedidos').doc(pedidoId).update({
            localizacaoAtual: { lat, lng, atualizadoEm: new Date() }
        });
    } catch (error) {
        console.error('Erro ao atualizar localização:', error);
        throw error;
    }
}

// ========== NOTIFICAÇÕES PUSH: REMOVIDO ==========
// (Exigia o plano pago Blaze pra rodar o Cloud Function que dispara o envio. Removido a
// pedido — as funções antigas eram: carregarFirebaseMessaging, solicitarPermissaoNotificacao,
// salvarTokenNotificacaoPedido. O firebase-messaging-sw.js também não é mais necessário —
// pode apagar esse arquivo do servidor.)

// Função para verificar usuário autenticado
async function checkAuthStatus() {
    return new Promise((resolve) => {
        const checkInterval = setInterval(async () => {
            if (firebaseReady && typeof firebase !== 'undefined' && firebase.auth) {
                clearInterval(checkInterval);
                firebase.auth().onAuthStateChanged((user) => {
                    resolve(user);
                });
            }
        }, 100);
    });
}

// ========== CUPONS (adicionar ao firebase-config.js) ==========
// Adicione as funções abaixo ao final de firebase-config.js, antes da seção EXPORT

// ========== CRUD CUPONS ==========

// Criar novo cupom
async function criarCupom(cupom) {
    try {
        const { db } = await getFirebase();
        const docRef = await colLoja(db, 'cupons').add({
            codigo: cupom.codigo.toUpperCase().trim(),
            nome: cupom.nome,
            desconto: Number(cupom.desconto), // percentual (ex: 10 = 10%)
            ativo: cupom.ativo !== false,
            usosMaximos: cupom.usosMaximos ? Number(cupom.usosMaximos) : null, // null = ilimitado
            usosAtuais: 0,
            dataCriacao: new Date(),
            dataExpiracao: cupom.dataExpiracao || null, // null = sem expiração
            descricao: cupom.descricao || '',
            minimoCarrinho: cupom.minimoCarrinho ? Number(cupom.minimoCarrinho) : 0 // valor mínimo do carrinho
        });
        return { id: docRef.id, ...cupom };
    } catch (error) {
        console.error('Erro ao criar cupom:', error);
        throw error;
    }
}

// Obter todos os cupons (admin)
async function getAllCupons() {
    try {
        const { db } = await getFirebase();
        const snapshot = await colLoja(db, 'cupons').orderBy('dataCriacao', 'desc').get();
        const cupons = [];
        snapshot.forEach(doc => {
            cupons.push({ id: doc.id, ...doc.data() });
        });
        return cupons;
    } catch (error) {
        console.error('Erro ao buscar cupons:', error);
        return [];
    }
}

// Obter cupom por ID
async function getCupomById(id) {
    try {
        const { db } = await getFirebase();
        const doc = await colLoja(db, 'cupons').doc(id).get();
        if (doc.exists) {
            return { id: doc.id, ...doc.data() };
        }
        return null;
    } catch (error) {
        console.error('Erro ao buscar cupom:', error);
        return null;
    }
}

// Atualizar cupom
async function updateCupom(id, cupom) {
    try {
        const { db } = await getFirebase();
        await colLoja(db, 'cupons').doc(id).update({
            codigo: cupom.codigo.toUpperCase().trim(),
            nome: cupom.nome,
            desconto: Number(cupom.desconto),
            ativo: cupom.ativo !== false,
            usosMaximos: cupom.usosMaximos ? Number(cupom.usosMaximos) : null,
            dataExpiracao: cupom.dataExpiracao || null,
            descricao: cupom.descricao || '',
            minimoCarrinho: cupom.minimoCarrinho ? Number(cupom.minimoCarrinho) : 0,
            dataAtualizacao: new Date()
        });
        return true;
    } catch (error) {
        console.error('Erro ao atualizar cupom:', error);
        throw error;
    }
}

// Deletar cupom
async function deletarCupom(id) {
    try {
        const { db } = await getFirebase();
        await colLoja(db, 'cupons').doc(id).delete();
        return true;
    } catch (error) {
        console.error('Erro ao deletar cupom:', error);
        throw error;
    }
}

// Validar cupom (cliente tentando usar)
// Retorna { valido: true, cupom: {...}, erro: null } ou { valido: false, cupom: null, erro: 'mensagem' }
async function validarCupom(codigo, valorCarrinho) {
    try {
        const { db } = await getFirebase();
        const codigoUpper = codigo.toUpperCase().trim();
        
        const snapshot = await colLoja(db, 'cupons')
            .where('codigo', '==', codigoUpper)
            .get();
        
        if (snapshot.empty) {
            return { valido: false, cupom: null, erro: 'Cupom não encontrado' };
        }
        
        const cupom = { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
        
        // Verificar se está ativo
        if (!cupom.ativo) {
            return { valido: false, cupom: null, erro: 'Cupom desativado' };
        }
        
        // Verificar expiração
        if (cupom.dataExpiracao) {
            const dataExp = cupom.dataExpiracao instanceof Date 
                ? cupom.dataExpiracao 
                : new Date(cupom.dataExpiracao);
            if (new Date() > dataExp) {
                return { valido: false, cupom: null, erro: 'Cupom expirado' };
            }
        }
        
        // Verificar usos máximos
        if (cupom.usosMaximos && cupom.usosAtuais >= cupom.usosMaximos) {
            return { valido: false, cupom: null, erro: 'Cupom atingiu limite de usos' };
        }
        
        // Verificar valor mínimo do carrinho
        if (cupom.minimoCarrinho && valorCarrinho < cupom.minimoCarrinho) {
            return { 
                valido: false, 
                cupom: null, 
                erro: `Valor mínimo de R$ ${cupom.minimoCarrinho.toFixed(2)} não atingido` 
            };
        }
        
        return { valido: true, cupom: cupom, erro: null };
    } catch (error) {
        console.error('Erro ao validar cupom:', error);
        return { valido: false, cupom: null, erro: 'Erro ao validar cupom' };
    }
}

// Incrementar usos do cupom (chamado quando pedido é salvo com cupom)
async function incrementarUsoCupom(cupomId) {
    try {
        const { db } = await getFirebase();
        await colLoja(db, 'cupons').doc(cupomId).update({
            usosAtuais: firebase.firestore.FieldValue.increment(1)
        });
        return true;
    } catch (error) {
        console.error('Erro ao incrementar usos do cupom:', error);
        throw error;
    }
}

// Decrementar usos do cupom (caso pedido seja cancelado)
async function decrementarUsoCupom(cupomId) {
    try {
        const { db } = await getFirebase();
        await colLoja(db, 'cupons').doc(cupomId).update({
            usosAtuais: firebase.firestore.FieldValue.increment(-1)
        });
        return true;
    } catch (error) {
        console.error('Erro ao decrementar usos do cupom:', error);
        throw error;
    }
}

// Obter estatísticas de cupons (para dashboard)
async function obterEstatisticasCupons() {
    try {
        const { db } = await getFirebase();
        const snapshot = await colLoja(db, 'cupons').get();
        
        let totalCupons = 0;
        let cuponsAtivos = 0;
        let totalUsos = 0;
        const cupomsMaisUsados = [];
        
        const cuponsData = [];
        snapshot.forEach(doc => {
            const cupom = { id: doc.id, ...doc.data() };
            cuponsData.push(cupom);
            totalCupons++;
            if (cupom.ativo) cuponsAtivos++;
            totalUsos += cupom.usosAtuais || 0;
        });
        
        // Ordenar por usos decrescentes
        cuponsData.sort((a, b) => (b.usosAtuais || 0) - (a.usosAtuais || 0));
        const cupomsMaisUsados_top5 = cuponsData.slice(0, 5);
        
        return {
            totalCupons,
            cuponsAtivos,
            cuponsInativos: totalCupons - cuponsAtivos,
            totalUsos,
            cupomsMaisUsados: cupomsMaisUsados_top5
        };
    } catch (error) {
        console.error('Erro ao obter estatísticas de cupons:', error);
        return {
            totalCupons: 0,
            cuponsAtivos: 0,
            cuponsInativos: 0,
            totalUsos: 0,
            cupomsMaisUsados: []
        };
    }
}

// ========== CACHE DE GEOCODING (frete automático por km) ==========
// Guarda o resultado de "endereço -> lat/lng/distância/taxa" no Firestore da própria loja,
// pra nunca chamar a API de geocoding duas vezes pro mesmo endereço (ou mesmo CEP). Isso é
// o que mantém o custo em R$0 mesmo com várias lojas rodando ao mesmo tempo — sem esse
// cache, cada pedido (mesmo de cliente recorrente) geraria uma chamada nova.
//
// Dois níveis de cache, do mais específico pro mais genérico:
//   1. enderecosCache/{chaveNormalizada} -> match exato do texto digitado
//   2. cepsCache/{cep}                   -> qualquer endereço com o mesmo CEP reaproveita

// Normaliza o texto do endereço + cidade/UF pra virar uma chave de documento estável
// (sem acento, sem pontuação, minúsculo) — "Rua das Flores, 123" e "rua das flores 123"
// caem na mesma chave, mas endereços calculados com cidade/UF diferentes (ou sem cidade
// nenhuma configurada, como antes de preencher o campo no admin) NÃO se misturam: incluir
// a cidade na chave garante que, se você preencher/mudar a "Cidade / UF da loja" depois,
// o cache antigo (calculado sem esse contexto) fica automaticamente órfão e ignorado —
// não precisa apagar nada manualmente no Firestore.
function normalizarChaveEndereco(texto, cidadeUf) {
    const base = `${texto || ''}|${cidadeUf || ''}`;
    return base
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]/g, '')
        .slice(0, 190);
}

// Extrai um CEP (00000-000 ou 00000000) de dentro do texto do endereço, se tiver.
function extrairCep(texto) {
    const match = (texto || '').match(/\d{5}-?\d{3}/);
    return match ? match[0].replace('-', '') : null;
}

async function buscarCacheEndereco(enderecoTexto, cidadeUf) {
    try {
        const chave = normalizarChaveEndereco(enderecoTexto, cidadeUf);
        if (!chave) return null;
        const { db } = await getFirebase();
        const doc = await colLoja(db, 'enderecosCache').doc(chave).get();
        return doc.exists ? doc.data() : null;
    } catch (error) {
        console.error('Erro ao buscar cache de endereço:', error);
        return null;
    }
}

async function buscarCacheCep(cep) {
    if (!cep) return null;
    try {
        const { db } = await getFirebase();
        const doc = await colLoja(db, 'cepsCache').doc(cep).get();
        return doc.exists ? doc.data() : null;
    } catch (error) {
        console.error('Erro ao buscar cache de CEP:', error);
        return null;
    }
}

// dados esperado: { lat, lng, distanciaKm, taxa }
async function salvarCacheEndereco(enderecoTexto, cidadeUf, dados) {
    try {
        const chave = normalizarChaveEndereco(enderecoTexto, cidadeUf);
        if (!chave) return;
        const { db } = await getFirebase();
        await colLoja(db, 'enderecosCache').doc(chave).set({
            ...dados,
            enderecoOriginal: enderecoTexto,
            calculadoEm: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Erro ao salvar cache de endereço:', error);
    }
}

async function salvarCacheCep(cep, dados) {
    if (!cep) return;
    try {
        const { db } = await getFirebase();
        await colLoja(db, 'cepsCache').doc(cep).set({
            ...dados,
            calculadoEm: firebase.firestore.FieldValue.serverTimestamp()
        });
    } catch (error) {
        console.error('Erro ao salvar cache de CEP:', error);
    }
}

// ---------- BANCO LOCAL DE RUAS (prévia de endereço, cálculo por km) ----------
// Cada loja tem o SEU PRÓPRIO banco de ruas (documento à parte, fora de "configuracoes" —
// esse array pode chegar a algumas centenas de KB, e não faz sentido carregar isso toda
// vez que o admin ou o storefront lê as configurações gerais da loja).
// dados esperado: array de { nome, lat, lng }, gerado a partir do export do Overpass —
// ver processarExportOverpass() em admin.js.
async function salvarBancoRuas(ruas, raioKm) {
    const { db } = await getFirebase();
    await colLoja(db, 'bancoRuas').doc('atual').set({
        ruas,
        raioKm: raioKm || null,
        totalRuas: ruas.length,
        geradoEm: firebase.firestore.FieldValue.serverTimestamp()
    });
}

// Retorna { ruas, totalRuas, raioKm, geradoEm } ou null se a loja nunca gerou um banco.
async function buscarBancoRuas() {
    try {
        const { db } = await getFirebase();
        const doc = await colLoja(db, 'bancoRuas').doc('atual').get();
        return doc.exists ? doc.data() : null;
    } catch (error) {
        console.error('Erro ao buscar banco de ruas:', error);
        return null;
    }
}

// Buscar cupom por código (para validação rápida no cliente)
async function buscarCupomPorCodigo(codigo) {
    try {
        const { db } = await getFirebase();
        const codigoUpper = codigo.toUpperCase().trim();
        const snapshot = await colLoja(db, 'cupons')
            .where('codigo', '==', codigoUpper)
            .get();
        
        if (snapshot.empty) return null;
        return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
    } catch (error) {
        console.error('Erro ao buscar cupom:', error);
        return null;
    }
}

// ========== EXPORT (se usar módulos) ==========
// Se estiver usando módulos ES6, comente a seção acima e use:
/*
export {
    getFirebase,
    getAllProducts,
    getProductById,
    addProduct,
    updateProduct,
    deleteProduct,
    getProductsByCategory,
    searchProducts,
    savePedido,
    getAllPedidos,
    updatePedidoStatus,
    processarBaixaEstoquePedido,
    estornarBaixaEstoquePedido,
    updateSettings,
    getSettings,
    loginAdmin,
    loginComEmailSenha,
    logoutAdmin,
    checkAuthStatus,
    criarMotoboy,
    getAllMotoboys,
    definirStatusMotoboy,
    getMotoboyByUid,
    getAdminByUid,
    observarTodosPedidos,
    buscarPedidosPorPeriodo,
    horarioFuncionamentoPadrao,
    calcularStatusLoja
};
*/