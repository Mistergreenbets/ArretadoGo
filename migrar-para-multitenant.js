// ========== MIGRAÇÃO PARA MULTI-TENANT ==========
// Roda UMA VEZ, fora do navegador (Node.js), pra copiar os dados do ArretadoGo das
// coleções antigas (produtos, pedidos, cupons, motoboys, configuracoes/loja, admins)
// pra dentro de /lojas/arretadogo/... — a nova estrutura multi-tenant.
//
// NÃO apaga nada do banco antigo. Só copia. Depois de rodar e conferir no Console do
// Firebase que tudo chegou certinho, você decide se quer apagar as coleções antigas.
//
// COMO RODAR:
//   1. npm install firebase-admin
//   2. Firebase Console → Configurações do projeto → Contas de serviço → "Gerar nova
//      chave privada" — baixa um .json. Salve como serviceAccountKey.json nesta pasta
//      (NÃO suba esse arquivo pro GitHub — ele dá acesso total ao seu banco).
//   3. node migrar-para-multitenant.js
//
// Se você já tiver mais de uma conta de admin (mais de um dono logando no painel hoje),
// edite a lista ADMIN_UIDS_EXISTENTES abaixo com os UIDs de todos (Firebase Console →
// Authentication → aba Users, coluna "User UID").

const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const LOJA_ID = 'arretadogo'; // vira o slug/ID da loja — o endereço público dela
const NOME_LOJA = 'ArretadoGo';

// Plano da loja migrada — precisa ser um destes 3 (bate com os limites do admin.js).
// Como ela já usa cupons de desconto, o mínimo pra não perder funcionalidade é 'intermediario'.
const PLANO_LOJA = 'premium';

// UID do Firebase Auth de quem vai virar SUPER-ADMIN da plataforma (você). Pegue em
// Firebase Console → Authentication → Users. Deixe null pra pular essa parte e fazer
// manualmente depois.
const SEU_UID_SUPERADMIN = null;

// UIDs dos admins que já existem hoje em /admins e que gerenciam o ArretadoGo — todos
// vão ganhar o campo lojaId: 'arretadogo'. Se não souber, deixe [] e rode
// vincularAdminALoja(uid, 'arretadogo') manualmente depois pra cada um.
const ADMIN_UIDS_EXISTENTES = [];

async function copiarColecao(nomeAntigo, nomeNovo) {
    const snapshot = await db.collection(nomeAntigo).get();
    if (snapshot.empty) {
        console.log(`  ${nomeAntigo}: vazio, nada a copiar.`);
        return 0;
    }

    const batchSize = 400; // limite do Firestore é 500 por batch; margem de segurança
    let docs = snapshot.docs;
    let copiados = 0;

    for (let i = 0; i < docs.length; i += batchSize) {
        const lote = docs.slice(i, i + batchSize);
        const batch = db.batch();
        lote.forEach(doc => {
            const destino = db.collection('lojas').doc(LOJA_ID).collection(nomeNovo).doc(doc.id);
            batch.set(destino, doc.data());
        });
        await batch.commit();
        copiados += lote.length;
    }

    console.log(`  ${nomeAntigo} -> lojas/${LOJA_ID}/${nomeNovo}: ${copiados} documento(s) copiado(s).`);
    return copiados;
}

async function migrar() {
    console.log(`Migrando dados para /lojas/${LOJA_ID}/...\n`);

    // 1. Cria o documento da loja com nome + configurações (config antiga era um
    // singleton em /configuracoes/loja — agora vira o campo "configuracoes" aqui dentro)
    const configAntiga = await db.collection('configuracoes').doc('loja').get();
    await db.collection('lojas').doc(LOJA_ID).set({
        nome: NOME_LOJA,
        ativo: true,
        plano: PLANO_LOJA,
        statusPagamento: 'pago', // já é loja de produção, não passa pelo trial de 7 dias
        pagoAte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 dias a partir de hoje — renove pelo super-admin.html quando vencer
        configuracoes: configAntiga.exists ? configAntiga.data() : {},
        criadoEm: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
    console.log(`Documento /lojas/${LOJA_ID} criado/atualizado.`);

    // 2. Copia as subcoleções
    console.log('\nCopiando subcoleções:');
    await copiarColecao('produtos', 'produtos');
    await copiarColecao('pedidos', 'pedidos');
    await copiarColecao('cupons', 'cupons');
    await copiarColecao('motoboys', 'motoboys');

    // 3. Índice motoboy_index (uid -> lojaId), necessário pro login do motoboy.js achar
    // a loja antes de saber qual é — sem isso os motoboys migrados não conseguem logar.
    const motoboysSnapshot = await db.collection('motoboys').get();
    if (!motoboysSnapshot.empty) {
        const batch = db.batch();
        motoboysSnapshot.forEach(doc => {
            batch.set(db.collection('motoboy_index').doc(doc.id), { lojaId: LOJA_ID });
        });
        await batch.commit();
        console.log(`  motoboy_index: ${motoboysSnapshot.size} entrada(s) criada(s).`);
    }

    // 4. Vincula os admins existentes à loja
    for (const uid of ADMIN_UIDS_EXISTENTES) {
        await db.collection('admins').doc(uid).set({ lojaId: LOJA_ID }, { merge: true });
        console.log(`  admins/${uid} vinculado a lojaId: ${LOJA_ID}`);
    }
    if (ADMIN_UIDS_EXISTENTES.length === 0) {
        console.log('  Nenhum ADMIN_UIDS_EXISTENTES informado — vincule manualmente depois.');
    }

    // 5. Cria o super-admin (você), se informado
    if (SEU_UID_SUPERADMIN) {
        await db.collection('superadmins').doc(SEU_UID_SUPERADMIN).set({ criadoEm: admin.firestore.FieldValue.serverTimestamp() });
        console.log(`  superadmins/${SEU_UID_SUPERADMIN} criado.`);
    } else {
        console.log('  SEU_UID_SUPERADMIN não informado — crie manualmente depois (ver README abaixo).');
    }

    console.log('\nMigração concluída. Confira em /lojas/' + LOJA_ID + ' no Console do Firebase antes de:');
    console.log('  - publicar o novo firestore.rules');
    console.log('  - trocar os arquivos .js do site (firebase-config.js, app.js, admin.js, motoboy.js, rastreio.js)');
    console.log('  - só DEPOIS de confirmar que tudo funciona, apagar as coleções antigas (produtos, pedidos, cupons, motoboys, configuracoes)');
}

migrar().catch(err => {
    console.error('Erro na migração:', err);
    process.exit(1);
});
