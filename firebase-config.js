// ========== CONFIGURAÇÃO FIREBASE ==========
// Substitua as chaves abaixo pelas suas do Firebase Console

const firebaseConfig = {
  apiKey: "AIzaSyClhkIOZGJWP6m5mH1sjK2k2_QXBMornC0",
  authDomain: "projeto-delivery-b37e7.firebaseapp.com",
  projectId: "projeto-delivery-b37e7",
  storageBucket: "projeto-delivery-b37e7.firebasestorage.app",
  messagingSenderId: "80008327269",
  appId: "1:80008327269:web:d3539309584adf0d70568c"
};

// Importar Firebase SDK
const firebaseScript = document.createElement('script');
firebaseScript.src = 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app-compat.js';
firebaseScript.onload = function() {
    // Firebase está carregado, agora carregar os módulos específicos
    let scriptsCarregados = 0;
    const totalScripts = 2;
    const checarPronto = () => {
        scriptsCarregados++;
        // (sinaliza via evento quando os dois módulos terminarem, opcional)
    };

    const firestoreScript = document.createElement('script');
    firestoreScript.src = 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore-compat.js';
    firestoreScript.onload = checarPronto;
    document.head.appendChild(firestoreScript);

    const authScript = document.createElement('script');
    authScript.src = 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth-compat.js';
    authScript.onload = checarPronto;
    document.head.appendChild(authScript);
};
document.head.appendChild(firebaseScript);

// Função para inicializar Firebase quando os scripts estiverem prontos
let firebaseReady = false;

async function initializeFirebase() {
    // Aguardar até que firebase esteja disponível globalmente
    while (typeof firebase === 'undefined' || !firebase.firestore || !firebase.auth) {
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    firebase.initializeApp(firebaseConfig);
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

// ========== UTILIDADES FIRESTORE ==========

// Função para obter todos os produtos (loja pública - só ativos)
async function getAllProducts() {
    try {
        const { db } = await getFirebase();
        const snapshot = await db.collection('produtos').where('ativo', '==', true).get();
        const produtos = [];
        snapshot.forEach(doc => {
            produtos.push({ id: doc.id, ...doc.data() });
        });
        return produtos;
    } catch (error) {
        console.error('Erro ao buscar produtos:', error);
        return [];
    }
}

// Função para obter TODOS os produtos (admin - inclui ativos e inativos)
async function getAllProductsAdmin() {
    try {
        const { db } = await getFirebase();
        const snapshot = await db.collection('produtos').get();
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
        const doc = await db.collection('produtos').doc(id).get();
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
        const docRef = await db.collection('produtos').add({
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
        await db.collection('produtos').doc(id).update({
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
        await db.collection('produtos').doc(id).delete();
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
        const snapshot = await db.collection('produtos')
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
        const snapshot = await db.collection('produtos')
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
async function savePedido(pedido) {
    try {
        const { db } = await getFirebase();
        const docRef = await db.collection('pedidos').add({
            ...pedido,
            criadoEm: new Date(),
            status: 'pendente'
        });
        return { id: docRef.id, ...pedido };
    } catch (error) {
        console.error('Erro ao salvar pedido:', error);
        throw error;
    }
}

// Escuta em tempo real UM pedido específico (usado na página de rastreamento do cliente
// e também poderia ser usado em qualquer outro lugar que precise seguir um pedido só).
// callback(null) quando o pedido não existe (ID inválido/apagado).
async function observarPedido(pedidoId, callback) {
    const { db } = await getFirebase();
    return db.collection('pedidos').doc(pedidoId).onSnapshot(
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
        await db.collection('pedidos').doc(pedidoId).update({
            localizacaoAtual: { lat, lng, atualizadoEm: new Date() }
        });
    } catch (error) {
        console.error('Erro ao atualizar localização:', error);
        throw error;
    }
}

// Função para atualizar status do pedido.
// "extra" permite gravar campos adicionais junto (ex: motoboy.js manda motoboyId/motoboyNome
// ao marcar "saiu_entrega", pra saber depois quem entregou cada pedido no histórico).
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

        await db.collection('pedidos').doc(id).update(dadosAtualizacao);
        return true;
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
        const pedidoRef = db.collection('pedidos').doc(pedidoId);
        let itensComEstoqueInsuficiente = [];

        await db.runTransaction(async (transaction) => {
            const pedidoSnap = await transaction.get(pedidoRef);
            if (!pedidoSnap.exists) return;

            const pedidoData = pedidoSnap.data();
            if (pedidoData.estoqueProcessado) return; // já processado, não desconta de novo

            const itens = Array.isArray(pedidoData.itens) ? pedidoData.itens : [];

            // Primeiro lê todos os produtos (transactions do Firestore exigem todas as leituras antes das escritas)
            const leituras = await Promise.all(
                itens.map(item => transaction.get(db.collection('produtos').doc(item.id)))
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
        const pedidoRef = db.collection('pedidos').doc(pedidoId);

        await db.runTransaction(async (transaction) => {
            const pedidoSnap = await transaction.get(pedidoRef);
            if (!pedidoSnap.exists) return;

            const pedidoData = pedidoSnap.data();
            if (!pedidoData.estoqueProcessado) return; // nunca foi descontado, nada a estornar

            const itens = Array.isArray(pedidoData.itens) ? pedidoData.itens : [];

            const leituras = await Promise.all(
                itens.map(item => transaction.get(db.collection('produtos').doc(item.id)))
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
        const snapshot = await db.collection('pedidos').orderBy('criadoEm', 'desc').get();
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

// Função para atualizar configurações
async function updateSettings(settings) {
    try {
        const { db } = await getFirebase();
        await db.collection('configuracoes').doc('loja').set(settings, { merge: true });
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
        const doc = await db.collection('configuracoes').doc('loja').get();
        return doc.exists ? doc.data() : null;
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
        const credencial = await authSecundario.createUserWithEmailAndPassword(email, senha);
        const uid = credencial.user.uid;

        // Desloga o app secundário antes de gravar no Firestore (usa a auth principal/admin pra escrever)
        await authSecundario.signOut();

        await db.collection('motoboys').doc(uid).set({
            nome,
            email,
            ativo: true,
            criadoEm: new Date()
        });

        return { uid, nome, email, ativo: true };
    } catch (error) {
        console.error('Erro ao criar motoboy:', error);
        throw error;
    } finally {
        // Sempre remove o app secundário, mesmo se der erro
        await appSecundario.delete();
    }
}

// Lista todos os motoboys cadastrados (admin)
async function getAllMotoboys() {
    try {
        const { db } = await getFirebase();
        const snapshot = await db.collection('motoboys').orderBy('criadoEm', 'desc').get();
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
        await db.collection('motoboys').doc(uid).update({ ativo });
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
        const doc = await db.collection('motoboys').doc(uid).get();
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
        await db.collection('motoboys').doc(uid).update({ online });
    } catch (error) {
        console.error('Erro ao atualizar status online:', error);
        throw error;
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
async function observarTodosPedidos(callback) {
    const { db } = await getFirebase();
    return db.collection('pedidos')
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

// ========== RASTREAMENTO DE PEDIDO (CLIENTE) ==========

// Escuta em tempo real UM pedido específico — usado na página de rastreamento (rastreio.html).
// callback(null) quando o pedido não existe (ID inválido/apagado/deletado).
async function observarPedido(pedidoId, callback) {
    const { db } = await getFirebase();
    return db.collection('pedidos').doc(pedidoId).onSnapshot(
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
        await db.collection('pedidos').doc(pedidoId).update({
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
    horarioFuncionamentoPadrao,
    calcularStatusLoja
};
*/