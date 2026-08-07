// ========== VARIÁVEIS GLOBAIS ADMIN ==========
let produtosAdmin = [];
let pedidosAdmin = [];
let unsubscribePedidosAdmin = null;
let produtoEmEdicao = null;
let produtoParaDeletar = null;

// Listas de configuração (sabores de pizza, adicionais e bairros de entrega)
let saboresPizza = [];
let adicionaisSanduiche = [];
let bairrosEntrega = [];
let promocoes = [];
let horarioFuncionamento = horarioFuncionamentoPadrao(); // vem de firebase-config.js
// nomeLojaAtual e apenasNumeros() vêm de pedido-status-utils.js

// Limite padrão de estoque baixo usado quando o produto não tem "estoqueMinimo" próprio definido
const ESTOQUE_MINIMO_PADRAO = 5;

// Labels amigáveis das categorias (mesmos valores do <select id="productCategory">), usados na prévia do modal
const CATEGORIA_LABELS = {
    burgers: 'Burgadores',
    pizza: 'Pizzas',
    bebidas: 'Bebidas',
    acompanhamentos: 'Acompanhamentos',
    sobremesas: 'Sobremesas'
};

function gerarIdLocal() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

// ========== INICIALIZAR ADMIN ==========
document.addEventListener('DOMContentLoaded', async () => {
    console.log('Admin inicializado...');

    inicializarLoginForm();
    await verificarAutenticacao();
});

// ========== AUTENTICAÇÃO ==========
let eventosAdminInicializados = false;

async function verificarAutenticacao() {
    const { auth } = await getFirebase();

    auth.onAuthStateChanged(async (user) => {
        if (!user) {
            // Não autenticado: mostrar tela de login, esconder painel
            if (unsubscribePedidosAdmin) {
                unsubscribePedidosAdmin();
                unsubscribePedidosAdmin = null;
            }
            document.getElementById('adminContainer').style.display = 'none';
            document.getElementById('loginScreen').style.display = 'flex';
            return;
        }

        // Autenticado não é o suficiente: precisa estar na allowlist de admins.
        // Sem isso, qualquer conta válida (inclusive motoboy) entraria no painel.
        const admin = await getAdminByUid(user.uid);
        if (!admin) {
            await auth.signOut();
            if (unsubscribePedidosAdmin) {
                unsubscribePedidosAdmin();
                unsubscribePedidosAdmin = null;
            }
            document.getElementById('adminContainer').style.display = 'none';
            document.getElementById('loginScreen').style.display = 'flex';
            const errorBox = document.getElementById('loginError');
            if (errorBox) {
                errorBox.textContent = 'Este acesso não está autorizado como administrador.';
                errorBox.style.display = 'block';
            }
            return;
        }

        // Usuário autenticado e autorizado: mostrar painel e carregar dados
        document.getElementById('loginScreen').style.display = 'none';
        document.getElementById('adminContainer').style.display = '';
        const userInfo = document.getElementById('userInfo');
        if (userInfo) userInfo.textContent = user.email;

        if (!eventosAdminInicializados) {
            inicializarEventosAdmin();
            eventosAdminInicializados = true;
        }
        await carregarProdutosAdmin();
        await carregarPedidosAdmin();
        await carregarConfiguracoes();
        await carregarMotoboys();
        renderizarTabelaProdutos();
    });
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
            await loginAdmin(email, senha);
            // onAuthStateChanged cuida de exibir o painel
        } catch (error) {
            errorBox.textContent = 'E-mail ou senha inválidos.';
            errorBox.style.display = 'block';
        } finally {
            submitBtn.disabled = false;
            submitBtn.textContent = 'Entrar';
        }
    });
}

// ========== CARREGAR DADOS ==========
async function carregarProdutosAdmin() {
    try {
        produtosAdmin = await getAllProductsAdmin();
        console.log('Produtos admin carregados:', produtosAdmin.length);
        renderizarDashboard();
    } catch (error) {
        console.error('Erro ao carregar produtos:', error);
        showToast('Erro ao carregar produtos', 'error');
    }
}

async function carregarPedidosAdmin() {
    if (unsubscribePedidosAdmin) return; // já está escutando em tempo real

    try {
        unsubscribePedidosAdmin = await observarTodosPedidos((pedidos) => {
            pedidosAdmin = pedidos;
            renderizarPedidos();
            renderizarDashboard();
        });
    } catch (error) {
        console.error('Erro ao carregar pedidos:', error);
    }
}

// ========== INICIALIZAR EVENTOS ==========
function inicializarEventosAdmin() {
    // Navigation
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            if (!item.classList.contains('logout')) {
                e.preventDefault();
                mudarSecao(item.dataset.section);
                fecharSidebar();
            }
        });
    });

    // Dashboard - ações rápidas
    document.getElementById('qaVerPedidos')?.addEventListener('click', () => mudarSecao('pedidos'));
    document.getElementById('qaVerProdutos')?.addEventListener('click', () => mudarSecao('produtos'));
    document.getElementById('qaRelatorios')?.addEventListener('click', () => abrirModal('relatoriosModal'));
    document.getElementById('closeRelatoriosModal')?.addEventListener('click', () => fecharModal('relatoriosModal'));
    document.querySelectorAll('.relatorio-periodo-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            exportarRelatorio(btn.dataset.periodo);
            fecharModal('relatoriosModal');
        });
    });

    // Produtos
    document.getElementById('newProductBtn').addEventListener('click', () => {
        produtoEmEdicao = null;
        limparFormProduto();
        document.getElementById('modalTitle').textContent = 'Novo Produto';
        limparErrosFormProduto();
        atualizarPreviewProduto();
        abrirModal('productFormModal');
    });

    document.getElementById('productForm').addEventListener('submit', (e) => {
        e.preventDefault();
        salvarProduto();
    });

    // Prévia ao vivo: qualquer mudança nesses campos atualiza o card de prévia na hora
    [
        'productName', 'productCategory', 'productPrice', 'productImage',
        'productBadge', 'productStock', 'productEstoqueMinimo',
        'productControlaEstoque', 'productActive'
    ].forEach((id) => {
        const el = document.getElementById(id);
        el?.addEventListener('input', atualizarPreviewProduto);
        el?.addEventListener('change', atualizarPreviewProduto);
    });

    document.getElementById('cancelProductBtn').addEventListener('click', () => {
        fecharModal('productFormModal');
    });

    document.getElementById('closeProductModal').addEventListener('click', () => {
        fecharModal('productFormModal');
    });

    // Busca de produtos
    document.getElementById('searchProducts').addEventListener('input', (e) => {
        filtrarProdutosAdmin(e.target.value);
    });

    // Configurações
    document.getElementById('settingsForm').addEventListener('submit', (e) => {
        e.preventDefault();
        salvarConfiguracoes();
    });

    document.getElementById('addSaborBtn')?.addEventListener('click', adicionarSabor);
    document.getElementById('novoSaborInput')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); adicionarSabor(); }
    });

    document.getElementById('addAdicionalBtn')?.addEventListener('click', adicionarAdicional);
    document.getElementById('novoAdicionalPreco')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); adicionarAdicional(); }
    });

    document.getElementById('addBairroBtn')?.addEventListener('click', adicionarBairro);
    document.getElementById('novoBairroTaxa')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); adicionarBairro(); }
    });

    document.getElementById('addPromocaoBtn')?.addEventListener('click', adicionarPromocao);
    document.getElementById('novaPromocaoTitulo')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); adicionarPromocao(); }
    });

    // Motoboys
    document.getElementById('novoMotoboyForm')?.addEventListener('submit', cadastrarMotoboy);

    // Delete confirmação
    document.getElementById('confirmDeleteBtn').addEventListener('click', () => {
        deletarProdutoConfirmado();
    });

    document.getElementById('cancelDeleteBtn').addEventListener('click', () => {
        fecharModal('confirmDeleteModal');
        produtoParaDeletar = null;
    });

    document.getElementById('closeProductModal').addEventListener('click', () => {
        fecharModal('productFormModal');
    });

    // Sidebar responsivo
    document.getElementById('toggleSidebar')?.addEventListener('click', () => {
        document.querySelector('.sidebar').classList.toggle('active');
        document.getElementById('overlay').classList.toggle('active');
    });

    // Overlay
    document.getElementById('overlay').addEventListener('click', () => {
        fecharModal('productFormModal');
        fecharModal('confirmDeleteModal');
        fecharSidebar();
    });
}

function fecharSidebar() {
    const sidebar = document.querySelector('.sidebar');
    if (sidebar.classList.contains('active')) {
        sidebar.classList.remove('active');
        if (document.querySelectorAll('.modal.active').length === 0) {
            document.getElementById('overlay').classList.remove('active');
        }
    }
}

// ========== NAVEGAÇÃO ==========
function mudarSecao(secao) {
    // Esconder todas as seções
    document.querySelectorAll('.section').forEach(s => s.style.display = 'none');
    
    // Remover active de nav items
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });

    // Mostrar seção ativa
    document.getElementById(secao + 'Section').style.display = 'block';
    document.querySelector(`[data-section="${secao}"]`)?.classList.add('active');
}

// ========== PRODUTOS - RENDERIZAR TABELA ==========
// Monta o HTML de uma linha da tabela de produtos (usado tanto na listagem completa quanto na busca)
function montarLinhaProdutoAdmin(produto) {
    const controla = produto.controlaEstoque !== false;
    const semEstoque = controla && (produto.estoque || 0) <= 0;
    const minimo = produto.estoqueMinimo ?? ESTOQUE_MINIMO_PADRAO;
    const estoqueBaixo = controla && !semEstoque && (produto.estoque || 0) <= minimo;
    let selo = '';
    if (semEstoque) selo = ' <span class="status-inactive" style="margin-left:6px;">Esgotado</span>';
    else if (estoqueBaixo) selo = ' <span class="status-low-stock" style="margin-left:6px;">⚠️ Baixo</span>';
    const estoqueTexto = controla
        ? `${produto.estoque || 0}${selo}`
        : '<span title="Feito na hora — não desconta estoque">—</span>';

    return `
        <td data-label="Imagem" class="cell-image">
            <img src="${produto.imagem}" alt="${produto.nome}" class="product-image-thumb" onerror="this.src='https://via.placeholder.com/40'">
        </td>
        <td data-label="Nome"><strong>${produto.nome}</strong></td>
        <td data-label="Categoria">${capitalize(produto.categoria)}</td>
        <td data-label="Preço">R$ ${produto.preco.toFixed(2)}</td>
        <td data-label="Estoque">${estoqueTexto}</td>
        <td data-label="Vendidos">${produto.quantidadeVendida || 0}</td>
        <td data-label="Ativo">
            <span class="status-${produto.ativo ? 'active' : 'inactive'}">
                ${produto.ativo ? 'Ativo' : 'Inativo'}
            </span>
        </td>
        <td data-label="Ações" class="cell-actions">
            <div class="action-buttons">
                <button class="action-btn edit-btn" onclick="editarProduto('${produto.id}')" title="Editar">✏️ Editar</button>
                <button class="action-btn delete-btn" onclick="confirmarDelete('${produto.id}')" title="Deletar">🗑️ Deletar</button>
            </div>
        </td>
    `;
}

function renderizarTabelaProdutos() {
    const tbody = document.getElementById('productsTableBody');
    
    if (produtosAdmin.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 20px;">
                    Nenhum produto cadastrado. <a href="#" onclick="document.getElementById('newProductBtn').click()">Adicione um novo</a>
                </td>
            </tr>
        `;
        return;
    }

    tbody.innerHTML = '';

    produtosAdmin.forEach(produto => {
        // Calcular quantidadeVendida dinamicamente baseado em pedidos reais (ENTREGUES)
        const vendidosReais = pedidosAdmin
            .filter(pedido => pedido.status === 'entregue')
            .reduce((total, pedido) => {
                if (Array.isArray(pedido.itens)) {
                    const item = pedido.itens.find(i => i.id === produto.id);
                    return total + (item?.quantidade || 0);
                }
                return total;
            }, 0);

        const row = document.createElement('tr');
        // Adiciona o valor calculado ao objeto para renderizar
        row.innerHTML = montarLinhaProdutoAdmin({ ...produto, quantidadeVendida: vendidosReais });
        tbody.appendChild(row);
    });
}

// ========== PRODUTOS - EDITAR ==========
function editarProduto(produtoId) {
    produtoEmEdicao = produtosAdmin.find(p => p.id === produtoId);
    
    if (!produtoEmEdicao) {
        showToast('Produto não encontrado', 'error');
        return;
    }

    // Preencher formulário
    document.getElementById('productName').value = produtoEmEdicao.nome;
    document.getElementById('productCategory').value = produtoEmEdicao.categoria;
    document.getElementById('productPrice').value = produtoEmEdicao.preco;
    document.getElementById('productCost').value = produtoEmEdicao.custo ?? '';
    document.getElementById('productStock').value = produtoEmEdicao.estoque || 0;
    document.getElementById('productEstoqueMinimo').value = produtoEmEdicao.estoqueMinimo ?? ESTOQUE_MINIMO_PADRAO;
    document.getElementById('productControlaEstoque').checked = produtoEmEdicao.controlaEstoque !== false;
    document.getElementById('productDescription').value = produtoEmEdicao.descricao || '';
    document.getElementById('productImage').value = produtoEmEdicao.imagem;
    document.getElementById('productBadge').value = produtoEmEdicao.badge || '';
    document.getElementById('productActive').checked = produtoEmEdicao.ativo !== false;

    document.getElementById('modalTitle').textContent = 'Editar Produto';
    limparErrosFormProduto();
    atualizarPreviewProduto();
    abrirModal('productFormModal');
}

// ========== PRODUTOS - SALVAR ==========
async function salvarProduto() {
    const nome = document.getElementById('productName').value.trim();
    const categoria = document.getElementById('productCategory').value;
    const preco = parseFloat(document.getElementById('productPrice').value);
    const custoInput = parseFloat(document.getElementById('productCost').value);
    const custo = isNaN(custoInput) ? null : custoInput;
    const estoque = parseInt(document.getElementById('productStock').value);
    const estoqueMinimoInput = parseInt(document.getElementById('productEstoqueMinimo').value);
    const estoqueMinimo = isNaN(estoqueMinimoInput) ? ESTOQUE_MINIMO_PADRAO : estoqueMinimoInput;
    const controlaEstoque = document.getElementById('productControlaEstoque').checked;
    const descricao = document.getElementById('productDescription').value.trim();
    const imagem = document.getElementById('productImage').value.trim();
    const badge = document.getElementById('productBadge').value;
    const ativo = document.getElementById('productActive').checked;

    // Validar campo a campo, com mensagem específica em cada um (em vez de só um toast genérico)
    limparErrosFormProduto();
    let primeiroCampoInvalido = null;
    const marcarErro = (id, mensagem) => {
        document.getElementById(id).classList.add('input-error');
        const erroEl = document.getElementById(`err${id.charAt(0).toUpperCase()}${id.slice(1)}`);
        if (erroEl) {
            erroEl.textContent = mensagem;
            erroEl.classList.add('show');
        }
        if (!primeiroCampoInvalido) primeiroCampoInvalido = id;
    };

    if (!nome) marcarErro('productName', 'Informe o nome do produto.');
    if (!categoria) marcarErro('productCategory', 'Selecione uma categoria.');
    if (isNaN(preco) || preco <= 0) marcarErro('productPrice', 'Informe um preço maior que zero.');
    if (isNaN(estoque) || estoque < 0) marcarErro('productStock', 'Informe um estoque válido (0 ou mais).');
    if (!imagem) marcarErro('productImage', 'Informe a URL da imagem do produto.');

    if (primeiroCampoInvalido) {
        showToast('Corrija os campos destacados', 'error');
        document.getElementById(primeiroCampoInvalido).focus();
        return;
    }

    const produtoData = {
        nome,
        categoria,
        preco,
        custo,
        estoque,
        estoqueMinimo,
        controlaEstoque,
        descricao,
        imagem,
        badge: badge || null,
        ativo
    };

    // quantidadeVendida só é inicializada na criação; em edições não mexemos nesse contador
    // (ele é atualizado automaticamente pela baixa de estoque quando pedidos são confirmados)
    if (!produtoEmEdicao) {
        produtoData.quantidadeVendida = 0;
    }

    const saveBtn = document.getElementById('saveProductBtn');
    const textoOriginalBtn = saveBtn.textContent;

    try {
        saveBtn.disabled = true;
        saveBtn.textContent = 'Salvando...';
        showToast('Salvando...', 'info');

        if (produtoEmEdicao) {
            // Atualizar
            await updateProduct(produtoEmEdicao.id, produtoData);
            showToast('Produto atualizado com sucesso!', 'success');
        } else {
            // Criar novo
            await addProduct(produtoData);
            showToast('Produto criado com sucesso!', 'success');
        }

        fecharModal('productFormModal');
        await carregarProdutosAdmin();
        renderizarTabelaProdutos();
    } catch (error) {
        console.error('Erro ao salvar produto:', error);
        showToast('Erro ao salvar produto', 'error');
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = textoOriginalBtn;
    }
}

// Limpa os estados de erro visual do formulário de produto (chamado ao abrir o modal ou reenviar)
function limparErrosFormProduto() {
    document.querySelectorAll('#productForm .input-error').forEach(el => el.classList.remove('input-error'));
    document.querySelectorAll('#productForm .field-error').forEach(el => {
        el.textContent = '';
        el.classList.remove('show');
    });
}

// ========== PRODUTOS - PRÉVIA AO VIVO ==========
// Atualiza o card de prévia no modal conforme o admin digita, pra mostrar como o produto vai
// aparecer na loja antes mesmo de salvar.
function atualizarPreviewProduto() {
    const nome = document.getElementById('productName').value.trim();
    const categoria = document.getElementById('productCategory').value;
    const preco = parseFloat(document.getElementById('productPrice').value);
    const imagem = document.getElementById('productImage').value.trim();
    const badge = document.getElementById('productBadge').value;
    const estoque = parseInt(document.getElementById('productStock').value);
    const estoqueMinimoInput = parseInt(document.getElementById('productEstoqueMinimo').value);
    const estoqueMinimo = isNaN(estoqueMinimoInput) ? ESTOQUE_MINIMO_PADRAO : estoqueMinimoInput;
    const controlaEstoque = document.getElementById('productControlaEstoque').checked;
    const ativo = document.getElementById('productActive').checked;

    document.getElementById('previewName').textContent = nome || 'Nome do produto';
    document.getElementById('previewCategory').textContent = CATEGORIA_LABELS[categoria] || 'Categoria';
    document.getElementById('previewPrice').textContent = formatarMoeda(isNaN(preco) ? 0 : preco);

    // Imagem: mostra a foto se a URL carregar, senão volta pro placeholder
    const imgEl = document.getElementById('previewImage');
    const placeholderEl = document.getElementById('previewImagePlaceholder');
    if (imagem) {
        imgEl.src = imagem;
        imgEl.style.display = 'block';
        placeholderEl.style.display = 'none';
        imgEl.onerror = () => {
            imgEl.style.display = 'none';
            placeholderEl.textContent = '⚠️ imagem não carregou';
            placeholderEl.style.display = 'flex';
        };
        imgEl.onload = () => {
            placeholderEl.style.display = 'none';
        };
    } else {
        imgEl.style.display = 'none';
        imgEl.src = '';
        placeholderEl.innerHTML = '🖼️<br>Sem imagem';
        placeholderEl.style.display = 'flex';
    }

    // Badge
    const badgeEl = document.getElementById('previewBadge');
    const BADGE_LABELS = { novo: 'Novo', promo: 'Promoção', bestseller: 'Mais Vendido', limitado: 'Limitado' };
    if (badge && BADGE_LABELS[badge]) {
        badgeEl.textContent = BADGE_LABELS[badge];
        badgeEl.style.display = 'inline-block';
    } else {
        badgeEl.style.display = 'none';
    }

    // Estoque
    const stockEl = document.getElementById('previewStock');
    if (!controlaEstoque) {
        stockEl.textContent = '👨‍🍳 Feito na hora';
        stockEl.className = 'product-preview-stock ok';
    } else if (isNaN(estoque) || estoque <= 0) {
        stockEl.textContent = '❌ Esgotado';
        stockEl.className = 'product-preview-stock esgotado';
    } else if (estoque <= estoqueMinimo) {
        stockEl.textContent = `⚠️ Estoque baixo (${estoque})`;
        stockEl.className = 'product-preview-stock baixo';
    } else {
        stockEl.textContent = `✅ ${estoque} em estoque`;
        stockEl.className = 'product-preview-stock ok';
    }

    // Status ativo/inativo
    const statusEl = document.getElementById('previewStatusAtivo');
    statusEl.textContent = ativo ? '🟢 Visível na loja' : '⚪ Oculto (inativo)';
    statusEl.className = `product-preview-status ${ativo ? 'ativo' : 'inativo'}`;
}

// ========== PRODUTOS - DELETAR ==========
function confirmarDelete(produtoId) {
    produtoParaDeletar = produtoParaDeletar = produtosAdmin.find(p => p.id === produtoId);
    
    if (!produtoParaDeletar) {
        showToast('Produto não encontrado', 'error');
        return;
    }

    document.getElementById('deleteMessage').textContent = 
        `Tem certeza que deseja deletar "${produtoParaDeletar.nome}"? Esta ação não pode ser desfeita.`;
    abrirModal('confirmDeleteModal');
}

async function deletarProdutoConfirmado() {
    if (!produtoParaDeletar) return;

    try {
        showToast('Deletando...', 'info');
        await deleteProduct(produtoParaDeletar.id);
        showToast('Produto deletado com sucesso!', 'success');
        fecharModal('confirmDeleteModal');
        await carregarProdutosAdmin();
        renderizarTabelaProdutos();
    } catch (error) {
        console.error('Erro ao deletar produto:', error);
        showToast('Erro ao deletar produto', 'error');
    }
}

// ========== PRODUTOS - FILTRAR ==========
function filtrarProdutosAdmin(searchText) {
    const search = searchText.toLowerCase();
    
    const produtosFiltrados = produtosAdmin.filter(p =>
        p.nome.toLowerCase().includes(search) ||
        p.categoria.toLowerCase().includes(search)
    );

    const tbody = document.getElementById('productsTableBody');
    tbody.innerHTML = '';

    if (produtosFiltrados.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align: center; padding: 20px;">
                    Nenhum produto encontrado
                </td>
            </tr>
        `;
        return;
    }

    produtosFiltrados.forEach(produto => {
        // Calcular quantidadeVendida dinamicamente baseado em pedidos reais (ENTREGUES)
        const vendidosReais = pedidosAdmin
            .filter(pedido => pedido.status === 'entregue')
            .reduce((total, pedido) => {
                if (Array.isArray(pedido.itens)) {
                    const item = pedido.itens.find(i => i.id === produto.id);
                    return total + (item?.quantidade || 0);
                }
                return total;
            }, 0);

        const row = document.createElement('tr');
        // Adiciona o valor calculado ao objeto para renderizar
        row.innerHTML = montarLinhaProdutoAdmin({ ...produto, quantidadeVendida: vendidosReais });
        tbody.appendChild(row);
    });
}

// ========== FORMULÁRIO PRODUTO ==========
function limparFormProduto() {
    document.getElementById('productForm').reset();
    document.getElementById('productActive').checked = true;
    document.getElementById('productControlaEstoque').checked = true;
    document.getElementById('productEstoqueMinimo').value = ESTOQUE_MINIMO_PADRAO;
    produtoEmEdicao = null;
    limparErrosFormProduto();
    atualizarPreviewProduto();
}

// ========== PEDIDOS ==========
// STATUS_PEDIDO, MENSAGENS_STATUS, apenasNumeros, montarLinkWhatsAppStatus e
// enviarAtualizacaoWhatsApp agora vêm de pedido-status-utils.js (compartilhado com motoboy.js)

function renderizarPedidos() {
    const container = document.getElementById('ordersList');

    if (pedidosAdmin.length === 0) {
        container.innerHTML = '<p style="text-align: center; padding: 20px;">Nenhum pedido ainda 📭</p>';
        return;
    }

    container.innerHTML = '';

    pedidosAdmin.forEach(pedido => {
        const card = document.createElement('div');
        card.className = 'order-card';
        
        let itensHtml = '';
        if (Array.isArray(pedido.itens)) {
            itensHtml = pedido.itens.map(item => 
                `${item.quantidade}x ${item.nome}`
            ).join(', ');
        }

        const dataFormatada = new Date(pedido.criadoEm.toDate?.() || pedido.criadoEm).toLocaleDateString('pt-BR', {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        const statusAtual = pedido.status || 'pendente';
        const opcoesStatus = STATUS_PEDIDO.map(s =>
            `<option value="${s.valor}" ${s.valor === statusAtual ? 'selected' : ''}>${s.label}</option>`
        ).join('');

        card.innerHTML = `
            <div class="order-header">
                <span class="order-id">#${pedido.codigoPedido || pedido.id.substring(0, 8).toUpperCase()}</span>
                <span class="order-date">${dataFormatada}</span>
            </div>
            <div class="order-details">
                <strong>Cliente:</strong> ${pedido.nome}<br>
                <strong>Telefone:</strong> ${pedido.telefone}<br>
                <strong>Itens:</strong> ${itensHtml}<br>
                <strong>Total:</strong> R$ ${pedido.total?.toFixed(2) || '0.00'}<br>
                <strong>Tipo:</strong> ${pedido.tipoEntrega === 'delivery' ? '🚗 Delivery' : '🏪 Retirada'}
                ${pedido.endereco ? `<br><strong>Endereço:</strong> ${pedido.endereco}` : ''}
            </div>
            <div class="order-status-row">
                <label><strong>Status:</strong></label>
                <select class="filter-select order-status-select" data-pedido-id="${pedido.id}">
                    ${opcoesStatus}
                </select>
                <button type="button" class="btn btn-secondary btn-send-whatsapp" title="Reenviar mensagem de status pro cliente">📲 Enviar WhatsApp</button>
            </div>
        `;

        card.querySelector('.order-status-select').addEventListener('change', (e) => {
            // Abre a aba já no clique/troca (evento do usuário) pra não ser bloqueada pelo navegador
            const abaWhatsApp = window.open('', '_blank');
            atualizarStatusPedido(pedido.id, e.target.value, abaWhatsApp);
        });

        card.querySelector('.btn-send-whatsapp').addEventListener('click', () => {
            const pedidoAtual = pedidosAdmin.find(p => p.id === pedido.id) || pedido;
            enviarAtualizacaoWhatsApp(pedidoAtual, pedidoAtual.status || 'pendente');
        });

        container.appendChild(card);
    });
}

async function atualizarStatusPedido(pedidoId, novoStatus, abaWhatsApp) {
    try {
        await updatePedidoStatus(pedidoId, novoStatus);

        // Baixa/estorno de estoque: assim que o pedido sai de "pendente" (confirmado), os itens saem
        // do estoque (produtos com controlaEstoque = true) e entram na contagem de vendidos (todos os
        // itens). Se o pedido for cancelado depois de já confirmado, o estoque volta (estorno).
        // Tudo isso é idempotente (a flag estoqueProcessado no pedido evita descontar 2x).
        try {
            const statusNormalizado = (novoStatus || '').toLowerCase();
            if (statusNormalizado.includes('cancel')) {
                await estornarBaixaEstoquePedido(pedidoId);
            } else if (statusNormalizado !== 'pendente') {
                const resultado = await processarBaixaEstoquePedido(pedidoId);
                if (resultado?.itensComEstoqueInsuficiente?.length > 0) {
                    const lista = resultado.itensComEstoqueInsuficiente
                        .map(i => `${i.nome} (faltaram ${i.faltavam})`)
                        .join(', ');
                    showToast(`⚠️ Estoque insuficiente pra: ${lista}. Provavelmente houve venda duplicada — confira com o cliente!`, 'error');
                }
            }
            await carregarProdutosAdmin();
            renderizarTabelaProdutos();
        } catch (erroEstoque) {
            console.error('Erro ao atualizar estoque do pedido:', erroEstoque);
            showToast('Status do pedido atualizado, mas houve um erro ao ajustar o estoque', 'error');
        }

        const pedido = pedidosAdmin.find(p => p.id === pedidoId);
        if (pedido) {
            pedido.status = novoStatus;
            enviarAtualizacaoWhatsApp(pedido, novoStatus, abaWhatsApp);
        }
        showToast('Status atualizado! Mensagem pronta no WhatsApp — é só clicar em enviar 📲', 'success');
    } catch (error) {
        console.error('Erro ao atualizar status:', error);
        showToast('Erro ao atualizar status do pedido', 'error');
        abaWhatsApp?.close?.();
    }
}

// ========== MOTOBOYS ==========
let motoboysAdmin = [];

async function carregarMotoboys() {
    try {
        motoboysAdmin = await getAllMotoboys();
        renderizarMotoboys();
    } catch (error) {
        console.error('Erro ao carregar motoboys:', error);
    }
}

function renderizarMotoboys() {
    const container = document.getElementById('motoboysList');
    if (!container) return;

    if (motoboysAdmin.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding: 16px; color:#888;">Nenhum motoboy cadastrado ainda.</p>';
        return;
    }

    container.innerHTML = '';

    motoboysAdmin.forEach(motoboy => {
        const ativo = motoboy.ativo !== false;
        const item = document.createElement('div');
        item.className = 'motoboy-item';
        item.innerHTML = `
            <div class="motoboy-info">
                <strong>${motoboy.nome}</strong>
                <small>${motoboy.email}</small>
            </div>
            <span class="motoboy-status-badge ${ativo ? 'ativo' : 'inativo'}">${ativo ? 'Ativo' : 'Inativo'}</span>
            <button type="button" class="btn btn-secondary toggle-motoboy-btn">${ativo ? 'Desativar' : 'Reativar'}</button>
        `;
        item.querySelector('.toggle-motoboy-btn').addEventListener('click', () => {
            alternarStatusMotoboy(motoboy.uid, !ativo);
        });
        container.appendChild(item);
    });
}

async function cadastrarMotoboy(e) {
    e.preventDefault();

    const nome = document.getElementById('motoboyNome').value.trim();
    const email = document.getElementById('motoboyEmail').value.trim();
    const senha = document.getElementById('motoboySenha').value;
    const btn = document.getElementById('addMotoboyBtn');

    if (!nome || !email || senha.length < 6) {
        showToast('Preencha nome, e-mail e uma senha com pelo menos 6 caracteres', 'error');
        return;
    }

    btn.disabled = true;
    btn.textContent = 'Cadastrando...';

    try {
        await criarMotoboy(nome, email, senha);
        showToast('Motoboy cadastrado com sucesso!', 'success');
        document.getElementById('novoMotoboyForm').reset();
        await carregarMotoboys();
    } catch (error) {
        console.error('Erro ao cadastrar motoboy:', error);
        if (error.code === 'auth/email-already-in-use') {
            showToast('Esse e-mail já está cadastrado', 'error');
        } else {
            showToast('Erro ao cadastrar motoboy', 'error');
        }
    } finally {
        btn.disabled = false;
        btn.textContent = '+ Cadastrar Motoboy';
    }
}

async function alternarStatusMotoboy(uid, novoValorAtivo) {
    try {
        await definirStatusMotoboy(uid, novoValorAtivo);
        showToast(novoValorAtivo ? 'Motoboy reativado' : 'Motoboy desativado', 'success');
        await carregarMotoboys();
    } catch (error) {
        console.error('Erro ao atualizar motoboy:', error);
        showToast('Erro ao atualizar motoboy', 'error');
    }
}

// ========== CONFIGURAÇÕES ==========
async function carregarConfiguracoes() {
    try {
        const config = await getSettings();
        
        if (config) {
            nomeLojaAtual = config.nome || 'ArretadoGo';
            document.getElementById('storeName').value = config.nome || 'ArretadoGo';
            document.getElementById('storePhone').value = config.telefone || '';
            document.getElementById('deliveryFee').value = config.taxaEntrega || '5.00';
            document.getElementById('deliveryTime').value = config.tempoEntrega || '30';
            document.getElementById('minimumOrder').value = config.pedidoMinimo || '20.00';

            saboresPizza = Array.isArray(config.saboresPizza) ? config.saboresPizza : [];
            adicionaisSanduiche = Array.isArray(config.adicionaisSanduiche) ? config.adicionaisSanduiche : [];
            bairrosEntrega = Array.isArray(config.bairrosEntrega) ? config.bairrosEntrega : [];
            promocoes = Array.isArray(config.promocoes) ? config.promocoes : [];

            const horarioSalvo = config.horarioFuncionamento;
            const horarioBase = horarioFuncionamentoPadrao();
            horarioFuncionamento = {
                ativo: horarioSalvo?.ativo || false,
                dias: DIAS_SEMANA_ORDEM.reduce((acc, dia) => {
                    acc[dia] = { ...horarioBase.dias[dia], ...(horarioSalvo?.dias?.[dia] || {}) };
                    return acc;
                }, {})
            };
            document.getElementById('horarioAtivo').checked = horarioFuncionamento.ativo;

            const hero = config.hero || {};
            const stats = Array.isArray(hero.stats) && hero.stats.length === 3
                ? hero.stats
                : [{ valor: '12k+', label: 'Pedidos' }, { valor: '4.8★', label: 'Avaliação' }, { valor: '20+', label: 'Anos' }];

            document.getElementById('heroPrefixo').value = hero.prefixo || 'Aproveite Sua';
            document.getElementById('heroDestaque').value = hero.destaque || 'Comida Deliciosa';
            document.getElementById('heroSubtitulo').value = hero.subtitulo || 'Entregamos sua comida em até 30 minutos no seu bairro. Qualidade e agilidade garantidas!';
            document.getElementById('heroBotaoTexto').value = hero.botaoTexto || 'Pedir Agora';
            document.getElementById('heroImagem').value = hero.imagem || 'https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=400&h=400&fit=crop';
            document.getElementById('heroStat1Valor').value = stats[0].valor || '';
            document.getElementById('heroStat1Label').value = stats[0].label || '';
            document.getElementById('heroStat2Valor').value = stats[1].valor || '';
            document.getElementById('heroStat2Label').value = stats[1].label || '';
            document.getElementById('heroStat3Valor').value = stats[2].valor || '';
            document.getElementById('heroStat3Label').value = stats[2].label || '';
        }

        renderizarSaboresPizza();
        renderizarAdicionais();
        renderizarBairros();
        renderizarPromocoes();
        renderizarHorarioDias();
        renderizarDashboard();
    } catch (error) {
        console.error('Erro ao carregar configurações:', error);
    }
}

// ========== HORÁRIO DE FUNCIONAMENTO ==========
function renderizarHorarioDias() {
    const container = document.getElementById('horarioDiasList');
    if (!container) return;
    container.innerHTML = '';

    DIAS_SEMANA_ORDEM.forEach(dia => {
        const info = horarioFuncionamento.dias[dia];
        const row = document.createElement('div');
        row.className = 'horario-dia-row';
        row.innerHTML = `
            <span class="horario-dia-label">${DIAS_SEMANA_LABEL[dia]}</span>
            <label class="horario-fechado-toggle">
                <input type="checkbox" data-dia="${dia}" class="horario-fechado-input" ${info.fechado ? 'checked' : ''}>
                Fechado
            </label>
            <input type="time" class="input-field horario-time-input" data-dia="${dia}" data-campo="abre" value="${info.abre}" ${info.fechado ? 'disabled' : ''}>
            <span class="horario-ate">até</span>
            <input type="time" class="input-field horario-time-input" data-dia="${dia}" data-campo="fecha" value="${info.fecha}" ${info.fechado ? 'disabled' : ''}>
        `;

        row.querySelector('.horario-fechado-input').addEventListener('change', (e) => {
            const fechado = e.target.checked;
            horarioFuncionamento.dias[dia].fechado = fechado;
            row.querySelectorAll('.horario-time-input').forEach(input => {
                input.disabled = fechado;
            });
        });

        row.querySelectorAll('.horario-time-input').forEach(input => {
            input.addEventListener('input', (e) => {
                horarioFuncionamento.dias[dia][e.target.dataset.campo] = e.target.value;
            });
        });

        container.appendChild(row);
    });
}

document.getElementById('horarioAtivo')?.addEventListener('change', (e) => {
    horarioFuncionamento.ativo = e.target.checked;
});

// ========== SABORES DE PIZZA ==========
function renderizarSaboresPizza() {
    const container = document.getElementById('saboresPizzaList');
    if (!container) return;
    container.innerHTML = '';

    saboresPizza.forEach(sabor => {
        const row = document.createElement('div');
        row.className = 'dynamic-list-item';
        row.innerHTML = `
            <span>${sabor.nome}</span>
            <button type="button" class="remove-item-btn" title="Remover">🗑️</button>
        `;
        row.querySelector('.remove-item-btn').addEventListener('click', () => {
            saboresPizza = saboresPizza.filter(s => s.id !== sabor.id);
            renderizarSaboresPizza();
        });
        container.appendChild(row);
    });
}

function adicionarSabor() {
    const input = document.getElementById('novoSaborInput');
    const nome = input.value.trim();
    if (!nome) {
        showToast('Digite o nome do sabor', 'error');
        return;
    }
    saboresPizza.push({ id: gerarIdLocal(), nome });
    input.value = '';
    renderizarSaboresPizza();
}

// ========== ADICIONAIS PARA SANDUÍCHES ==========
function renderizarAdicionais() {
    const container = document.getElementById('adicionaisList');
    if (!container) return;
    container.innerHTML = '';

    adicionaisSanduiche.forEach(adicional => {
        const row = document.createElement('div');
        row.className = 'dynamic-list-item';
        row.innerHTML = `
            <span>${adicional.nome} — R$ ${Number(adicional.preco).toFixed(2)}</span>
            <button type="button" class="remove-item-btn" title="Remover">🗑️</button>
        `;
        row.querySelector('.remove-item-btn').addEventListener('click', () => {
            adicionaisSanduiche = adicionaisSanduiche.filter(a => a.id !== adicional.id);
            renderizarAdicionais();
        });
        container.appendChild(row);
    });
}

function adicionarAdicional() {
    const nomeInput = document.getElementById('novoAdicionalNome');
    const precoInput = document.getElementById('novoAdicionalPreco');
    const nome = nomeInput.value.trim();
    const preco = parseFloat(precoInput.value);

    if (!nome || isNaN(preco) || preco < 0) {
        showToast('Preencha nome e preço válidos para o adicional', 'error');
        return;
    }

    adicionaisSanduiche.push({ id: gerarIdLocal(), nome, preco });
    nomeInput.value = '';
    precoInput.value = '';
    renderizarAdicionais();
}

// ========== BAIRROS DE ENTREGA ==========
function renderizarBairros() {
    const container = document.getElementById('bairrosList');
    if (!container) return;
    container.innerHTML = '';

    bairrosEntrega.forEach(bairro => {
        const row = document.createElement('div');
        row.className = 'dynamic-list-item';
        row.innerHTML = `
            <span>${bairro.nome} — R$ ${Number(bairro.taxa).toFixed(2)}</span>
            <button type="button" class="remove-item-btn" title="Remover">🗑️</button>
        `;
        row.querySelector('.remove-item-btn').addEventListener('click', () => {
            bairrosEntrega = bairrosEntrega.filter(b => b.id !== bairro.id);
            renderizarBairros();
        });
        container.appendChild(row);
    });
}

function adicionarBairro() {
    const nomeInput = document.getElementById('novoBairroNome');
    const taxaInput = document.getElementById('novoBairroTaxa');
    const nome = nomeInput.value.trim();
    const taxa = parseFloat(taxaInput.value);

    if (!nome || isNaN(taxa) || taxa < 0) {
        showToast('Preencha nome e taxa válidos para o bairro', 'error');
        return;
    }

    bairrosEntrega.push({ id: gerarIdLocal(), nome, taxa });
    nomeInput.value = '';
    taxaInput.value = '';
    renderizarBairros();
}

// ========== BANNER ROTATIVO DE PROMOÇÕES ==========
function renderizarPromocoes() {
    const container = document.getElementById('promocoesList');
    if (!container) return;
    container.innerHTML = '';

    promocoes.forEach(promo => {
        const row = document.createElement('div');
        row.className = 'promo-item';
        row.innerHTML = `
            <img src="${promo.imagem || ''}" alt="${promo.titulo}" onerror="this.style.visibility='hidden'">
            <div class="promo-info">
                <strong>${promo.titulo}</strong>
                <small>${promo.descricao || ''}</small>
            </div>
            <div class="promo-actions">
                <button type="button" class="promo-toggle-btn ${promo.ativo ? 'ativo' : 'inativo'}">${promo.ativo ? 'Ativa' : 'Inativa'}</button>
                <button type="button" class="remove-item-btn" title="Remover">🗑️</button>
            </div>
        `;
        row.querySelector('.promo-toggle-btn').addEventListener('click', () => {
            promo.ativo = !promo.ativo;
            renderizarPromocoes();
        });
        row.querySelector('.remove-item-btn').addEventListener('click', () => {
            promocoes = promocoes.filter(p => p.id !== promo.id);
            renderizarPromocoes();
        });
        container.appendChild(row);
    });
}

function adicionarPromocao() {
    const tituloInput = document.getElementById('novaPromocaoTitulo');
    const imagemInput = document.getElementById('novaPromocaoImagem');
    const descricaoInput = document.getElementById('novaPromocaoDescricao');

    const titulo = tituloInput.value.trim();
    const imagem = imagemInput.value.trim();
    const descricao = descricaoInput.value.trim();

    if (!titulo || !imagem) {
        showToast('Preencha título e URL da imagem da promoção', 'error');
        return;
    }

    promocoes.push({ id: gerarIdLocal(), titulo, descricao, imagem, ativo: true });
    tituloInput.value = '';
    imagemInput.value = '';
    descricaoInput.value = '';
    renderizarPromocoes();
}

async function salvarConfiguracoes() {
    const settings = {
        nome: document.getElementById('storeName').value,
        telefone: document.getElementById('storePhone').value,
        taxaEntrega: parseFloat(document.getElementById('deliveryFee').value),
        tempoEntrega: parseInt(document.getElementById('deliveryTime').value),
        pedidoMinimo: parseFloat(document.getElementById('minimumOrder').value),
        saboresPizza,
        adicionaisSanduiche,
        bairrosEntrega,
        promocoes,
        horarioFuncionamento,
        hero: {
            prefixo: document.getElementById('heroPrefixo').value.trim(),
            destaque: document.getElementById('heroDestaque').value.trim(),
            subtitulo: document.getElementById('heroSubtitulo').value.trim(),
            botaoTexto: document.getElementById('heroBotaoTexto').value.trim(),
            imagem: document.getElementById('heroImagem').value.trim(),
            stats: [
                { valor: document.getElementById('heroStat1Valor').value.trim(), label: document.getElementById('heroStat1Label').value.trim() },
                { valor: document.getElementById('heroStat2Valor').value.trim(), label: document.getElementById('heroStat2Label').value.trim() },
                { valor: document.getElementById('heroStat3Valor').value.trim(), label: document.getElementById('heroStat3Label').value.trim() }
            ]
        }
    };

    try {
        showToast('Salvando configurações...', 'info');
        await updateSettings(settings);
        showToast('Configurações salvas com sucesso!', 'success');
        renderizarDashboard();
    } catch (error) {
        console.error('Erro ao salvar configurações:', error);
        showToast('Erro ao salvar configurações', 'error');
    }
}

// ========== DASHBOARD ==========
// formatarMoeda agora mora em pedido-status-utils.js (compartilhado com motoboy.js)

function renderizarDashboard() {
    const cardsEl = document.getElementById('dashboardCards');
    if (!cardsEl) return; // dashboard ainda não está no DOM (ex: chamado cedo demais)

    // ---- Status da loja (aberta/fechada) ----
    const statusBadge = document.getElementById('dashboardStoreStatus');
    if (statusBadge) {
        const status = calcularStatusLoja({ horarioFuncionamento });
        if (!status.controlado) {
            statusBadge.style.display = 'none';
        } else {
            statusBadge.style.display = 'inline-block';
            statusBadge.className = `store-status-badge ${status.aberta ? 'aberta' : 'fechada'}`;
            statusBadge.textContent = status.aberta
                ? '🟢 Loja Aberta'
                : `🔴 Loja Fechada${status.proximaAbertura ? ` — abre ${status.proximaAbertura.label} às ${status.proximaAbertura.hora}` : ''}`;
        }
    }

    const paraData = (timestamp) => {
        if (!timestamp) return null;
        return typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
    };

    const agora = new Date();
    const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
    const inicioOntem = new Date(inicioHoje);
    inicioOntem.setDate(inicioOntem.getDate() - 1);
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);

    // ================= KPIs PRINCIPAIS =================
    const pedidosRecebidosHoje = pedidosAdmin.filter(p => {
        if (p.status === 'cancelado') return false;
        const d = paraData(p.criadoEm);
        return d && d >= inicioHoje;
    });
    // Mesma contagem de ontem, mas só até o mesmo horário de agora — pra comparar "maçã com maçã"
    // (senão o dia de ontem, que já terminou, sempre pareceria "maior" só por estar completo).
    const horaEquivalenteOntem = new Date(inicioOntem.getTime() + (agora - inicioHoje));
    const pedidosRecebidosOntemMesmaHora = pedidosAdmin.filter(p => {
        if (p.status === 'cancelado') return false;
        const d = paraData(p.criadoEm);
        return d && d >= inicioOntem && d < horaEquivalenteOntem;
    });

    const pedidosEntregues = pedidosAdmin.filter(p => p.status === 'entregue');
    const dataDaVenda = (p) => paraData(p.entregueEm) || paraData(p.criadoEm);

    const vendasHoje = pedidosEntregues.filter(p => { const d = dataDaVenda(p); return d && d >= inicioHoje; });
    const vendasOntemMesmaHora = pedidosEntregues.filter(p => { const d = dataDaVenda(p); return d && d >= inicioOntem && d < horaEquivalenteOntem; });
    const vendasMes = pedidosEntregues.filter(p => { const d = dataDaVenda(p); return d && d >= inicioMes; });

    const pedidosAbertos = pedidosAdmin.filter(p => ['pendente', 'preparando', 'saiu_entrega'].includes(p.status || 'pendente'));

    const faturamentoHoje = vendasHoje.reduce((soma, p) => soma + (p.total || 0), 0);
    const faturamentoOntemMesmaHora = vendasOntemMesmaHora.reduce((soma, p) => soma + (p.total || 0), 0);
    const faturamentoMes = vendasMes.reduce((soma, p) => soma + (p.total || 0), 0);
    const ticketMedio = vendasMes.length > 0 ? faturamentoMes / vendasMes.length : 0;

    document.getElementById('dashPedidosHoje').textContent = pedidosRecebidosHoje.length;
    document.getElementById('dashFaturamentoHoje').textContent = formatarMoeda(faturamentoHoje);
    document.getElementById('dashFaturamentoMes').textContent = formatarMoeda(faturamentoMes);
    document.getElementById('dashPedidosAbertos').textContent = pedidosAbertos.length;
    document.getElementById('dashTicketMedio').textContent = formatarMoeda(ticketMedio);

    exibirTendencia('trendPedidosHoje', pedidosRecebidosHoje.length, pedidosRecebidosOntemMesmaHora.length, 'pedido(s)');
    exibirTendencia('trendFaturamentoHoje', faturamentoHoje, faturamentoOntemMesmaHora, null, formatarMoeda);

    // ---- Tempo médio de entrega (últimos 7 dias) ----
    const inicio7dias = new Date(inicioHoje);
    inicio7dias.setDate(inicio7dias.getDate() - 6);
    const entreguesUltimos7Dias = pedidosEntregues.filter(p => {
        const d = paraData(p.entregueEm);
        return d && d >= inicio7dias && paraData(p.criadoEm);
    });
    const tempoMedioEl = document.getElementById('dashTempoMedio');
    if (tempoMedioEl) {
        if (entreguesUltimos7Dias.length === 0) {
            tempoMedioEl.textContent = '—';
        } else {
            const somaMinutos = entreguesUltimos7Dias.reduce((soma, p) => {
                const criado = paraData(p.criadoEm);
                const entregue = paraData(p.entregueEm);
                return soma + Math.max(0, (entregue - criado) / 60000);
            }, 0);
            const media = Math.round(somaMinutos / entreguesUltimos7Dias.length);
            tempoMedioEl.textContent = `${media} min`;
        }
    }

    // ================= STATUS OPERACIONAL =================
    document.getElementById('statusPreparando').textContent = pedidosAdmin.filter(p => p.status === 'preparando').length;
    document.getElementById('statusSaiuEntrega').textContent = pedidosAdmin.filter(p => p.status === 'saiu_entrega').length;
    document.getElementById('statusFinalizados').textContent = vendasHoje.length;
    document.getElementById('statusCancelados').textContent = pedidosAdmin.filter(p => {
        if (p.status !== 'cancelado') return false;
        const d = paraData(p.criadoEm);
        return d && d >= inicioHoje;
    }).length;

    // ================= FINANCEIRO (HOJE) =================
    const produtoPorId = new Map(produtosAdmin.map(p => [p.id, p]));
    const algumProdutoTemCusto = produtosAdmin.some(p => typeof p.custo === 'number');

    let custoHoje = 0;
    let custoConhecido = true;
    vendasHoje.forEach(pedido => {
        (pedido.itens || []).forEach(item => {
            const produto = produtoPorId.get(item.id);
            if (produto && typeof produto.custo === 'number') {
                custoHoje += produto.custo * (item.quantidade || 0);
            } else {
                custoConhecido = false;
            }
        });
    });

    const lucroHoje = faturamentoHoje - custoHoje;
    const margemHoje = faturamentoHoje > 0 ? (lucroHoje / faturamentoHoje) * 100 : 0;

    document.getElementById('finFaturamento').textContent = formatarMoeda(faturamentoHoje);
    document.getElementById('finCusto').textContent = algumProdutoTemCusto ? formatarMoeda(custoHoje) : '—';
    document.getElementById('finLucro').textContent = algumProdutoTemCusto ? formatarMoeda(lucroHoje) : '—';
    document.getElementById('finMargem').textContent = algumProdutoTemCusto ? `${margemHoje.toFixed(1)}%` : '—';
    document.getElementById('financeiroAviso').style.display = algumProdutoTemCusto ? 'none' : 'block';
    if (algumProdutoTemCusto && !custoConhecido) {
        document.getElementById('financeiroAviso').style.display = 'block';
        document.getElementById('financeiroAviso').textContent = 'ℹ️ Alguns produtos vendidos hoje não têm custo cadastrado — o custo/lucro acima pode estar subestimado.';
    }

    // ================= ALERTAS AUTOMÁTICOS =================
    const alertasEl = document.getElementById('dashboardAlertas');
    if (alertasEl) {
        const alertas = [];

        // Atraso: pedidos abertos há mais tempo que o previsto (tempo de entrega configurado + 15 min de folga)
        const tempoEntregaConfigurado = parseInt(document.getElementById('deliveryTime')?.value) || 30;
        const tempoToleranciaMin = tempoEntregaConfigurado + 15;
        const pedidosAtrasados = pedidosAbertos.filter(p => {
            const d = paraData(p.criadoEm);
            if (!d) return false;
            return (agora - d) / 60000 > tempoToleranciaMin;
        });
        if (pedidosAtrasados.length > 0) {
            alertas.push(`<div class="alerta-item alerta-danger">⏰ ${pedidosAtrasados.length} pedido(s) em aberto há mais de ${tempoToleranciaMin} min — confira!</div>`);
        }

        // Queda de vendas: compara pedidos de hoje x ontem no mesmo horário
        if (pedidosRecebidosOntemMesmaHora.length >= 3) {
            const quedaPercentual = ((pedidosRecebidosOntemMesmaHora.length - pedidosRecebidosHoje.length) / pedidosRecebidosOntemMesmaHora.length) * 100;
            if (quedaPercentual >= 40) {
                alertas.push(`<div class="alerta-item alerta-warning">📉 Pedidos ${quedaPercentual.toFixed(0)}% abaixo de ontem neste mesmo horário.</div>`);
            }
        }

        // Estoque baixo (contagem rápida, detalhe completo no painel abaixo)
        const qtdEstoqueBaixo = produtosAdmin.filter(p => {
            if (p.controlaEstoque === false) return false;
            const minimo = p.estoqueMinimo ?? ESTOQUE_MINIMO_PADRAO;
            return (p.estoque || 0) <= minimo;
        }).length;
        if (qtdEstoqueBaixo > 0) {
            alertas.push(`<div class="alerta-item alerta-warning">📦 ${qtdEstoqueBaixo} produto(s) com estoque baixo.</div>`);
        }

        alertasEl.innerHTML = alertas.join('');
    }

    // ================= PRODUTOS: recalcular vendas reais =================
    const produtosComVendas = [...produtosAdmin].map(p => {
        const vendidosReais = pedidosAdmin
            .filter(pedido => pedido.status === 'entregue')
            .reduce((total, pedido) => {
                if (Array.isArray(pedido.itens)) {
                    const item = pedido.itens.find(i => i.id === p.id);
                    return total + (item?.quantidade || 0);
                }
                return total;
            }, 0);
        return { ...p, quantidadeVendidaReal: vendidosReais };
    });

    // ---- Mais vendidos (gráfico) ----
    const topProdutos = produtosComVendas
        .filter(p => p.quantidadeVendidaReal > 0)
        .sort((a, b) => b.quantidadeVendidaReal - a.quantidadeVendidaReal)
        .slice(0, 6);
    renderizarChartTopProdutos(topProdutos);

    // ---- Mais lucrativos (só produtos com custo cadastrado) ----
    const lucrativosEl = document.getElementById('dashboardLucrativos');
    if (lucrativosEl) {
        const comCusto = produtosComVendas.filter(p => typeof p.custo === 'number' && p.quantidadeVendidaReal > 0);
        if (comCusto.length === 0) {
            lucrativosEl.innerHTML = '<p style="color:#999; font-size:13px;">Cadastre o custo dos produtos pra ver esse ranking.</p>';
        } else {
            const rankLucro = comCusto
                .map(p => ({ ...p, lucroTotal: (p.preco - p.custo) * p.quantidadeVendidaReal }))
                .sort((a, b) => b.lucroTotal - a.lucroTotal)
                .slice(0, 5);
            const maiorLucro = rankLucro[0]?.lucroTotal || 1;
            lucrativosEl.innerHTML = rankLucro.map(p => `
                <div class="dashboard-top-item">
                    <div class="dashboard-top-item-header">
                        <span>${p.nome}</span>
                        <strong>${formatarMoeda(p.lucroTotal)}</strong>
                    </div>
                    <div class="dashboard-top-bar-track">
                        <div class="dashboard-top-bar-fill" style="width:${Math.max(8, Math.round((p.lucroTotal / maiorLucro) * 100))}%; background:var(--success-color);"></div>
                    </div>
                </div>
            `).join('');
        }
    }

    // ---- Produtos parados (ativos, sem venda nos últimos 30 dias) ----
    const paradosEl = document.getElementById('dashboardParados');
    if (paradosEl) {
        const inicio30dias = new Date(inicioHoje);
        inicio30dias.setDate(inicio30dias.getDate() - 30);
        const vendidoNosUltimos30Dias = new Set();
        pedidosAdmin
            .filter(p => p.status === 'entregue' && paraData(p.entregueEm) >= inicio30dias)
            .forEach(p => (p.itens || []).forEach(item => vendidoNosUltimos30Dias.add(item.id)));

        const parados = produtosAdmin.filter(p => p.ativo !== false && !vendidoNosUltimos30Dias.has(p.id));

        if (parados.length === 0) {
            paradosEl.innerHTML = '<p style="color:#999; font-size:13px;">Todo produto ativo vendeu pelo menos uma vez nos últimos 30 dias 🎉</p>';
        } else {
            paradosEl.innerHTML = parados.slice(0, 8).map(p => `
                <div class="dashboard-estoque-item">
                    <img src="${p.imagem}" alt="${p.nome}" onerror="this.style.visibility='hidden'">
                    <div class="dashboard-estoque-info">
                        <strong>${p.nome}</strong>
                        <small>Sem vendas há 30+ dias</small>
                    </div>
                    <button type="button" class="btn btn-secondary btn-sm" onclick="editarProduto('${p.id}')">Ver</button>
                </div>
            `).join('');
        }
    }

    // ---- Alerta de estoque baixo (painel detalhado) ----
    const estoqueEl = document.getElementById('dashboardEstoqueBaixo');
    if (estoqueEl) {
        const produtosBaixos = produtosAdmin.filter(p => {
            if (p.controlaEstoque === false) return false;
            const minimo = p.estoqueMinimo ?? ESTOQUE_MINIMO_PADRAO;
            return (p.estoque || 0) <= minimo;
        }).sort((a, b) => (a.estoque || 0) - (b.estoque || 0));

        if (produtosBaixos.length === 0) {
            estoqueEl.innerHTML = '<p style="color:#999; font-size:13px;">Nenhum produto com estoque baixo no momento 🎉</p>';
        } else {
            estoqueEl.innerHTML = produtosBaixos.map(p => {
                const esgotado = (p.estoque || 0) <= 0;
                return `
                    <div class="dashboard-estoque-item">
                        <img src="${p.imagem}" alt="${p.nome}" onerror="this.style.visibility='hidden'">
                        <div class="dashboard-estoque-info">
                            <strong>${p.nome}</strong>
                            <small>${esgotado ? 'Esgotado' : `${p.estoque || 0} em estoque`}</small>
                        </div>
                        <button type="button" class="btn btn-secondary btn-sm" onclick="editarProduto('${p.id}')">Repor</button>
                    </div>
                `;
            }).join('');
        }
    }

    // ================= GRÁFICOS DE 7 DIAS =================
    renderizarChartsUltimos7Dias(pedidosEntregues, pedidosAdmin, paraData, inicioHoje);
}

// Mostra "▲ 12% vs ontem" / "▼ 8% vs ontem" / "▬ igual a ontem" ao lado de um KPI.
// formatador opcional (ex: formatarMoeda) só usado no texto de log — a comparação em si é sempre numérica.
function exibirTendencia(elementId, valorHoje, valorOntem, sufixo, formatador) {
    const el = document.getElementById(elementId);
    if (!el) return;

    if (!valorOntem || valorOntem === 0) {
        el.className = 'dashboard-card-trend trend-flat';
        el.textContent = valorHoje > 0 ? '🆕 sem comparativo de ontem' : '';
        return;
    }

    const variacao = ((valorHoje - valorOntem) / valorOntem) * 100;
    const arredondado = Math.round(Math.abs(variacao));

    if (Math.abs(variacao) < 1) {
        el.className = 'dashboard-card-trend trend-flat';
        el.textContent = '▬ igual a ontem (mesmo horário)';
    } else if (variacao > 0) {
        el.className = 'dashboard-card-trend trend-up';
        el.textContent = `▲ ${arredondado}% vs ontem`;
    } else {
        el.className = 'dashboard-card-trend trend-down';
        el.textContent = `▼ ${arredondado}% vs ontem`;
    }
}

// ================= GRÁFICOS (Chart.js) =================
let chartFaturamentoInstance = null;
let chartPedidosInstance = null;
let chartTopProdutosInstance = null;

function obterUltimosNDias(n, inicioHoje) {
    const dias = [];
    for (let i = n - 1; i >= 0; i--) {
        const d = new Date(inicioHoje);
        d.setDate(d.getDate() - i);
        dias.push(d);
    }
    return dias;
}

function renderizarChartsUltimos7Dias(pedidosEntregues, todosPedidos, paraData, inicioHoje) {
    if (typeof Chart === 'undefined') return; // CDN não carregou (ex: sem internet) — dashboard segue funcionando sem os gráficos

    const dias = obterUltimosNDias(7, inicioHoje);
    const labels = dias.map(d => d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit' }));

    const faturamentoPorDia = dias.map(dia => {
        const fimDia = new Date(dia); fimDia.setDate(fimDia.getDate() + 1);
        return pedidosEntregues
            .filter(p => { const d = paraData(p.entregueEm) || paraData(p.criadoEm); return d && d >= dia && d < fimDia; })
            .reduce((soma, p) => soma + (p.total || 0), 0);
    });

    const pedidosPorDia = dias.map(dia => {
        const fimDia = new Date(dia); fimDia.setDate(fimDia.getDate() + 1);
        return todosPedidos.filter(p => {
            if (p.status === 'cancelado') return false;
            const d = paraData(p.criadoEm);
            return d && d >= dia && d < fimDia;
        }).length;
    });

    const ctxFat = document.getElementById('chartFaturamento7d');
    if (ctxFat) {
        if (chartFaturamentoInstance) chartFaturamentoInstance.destroy();
        chartFaturamentoInstance = new Chart(ctxFat, {
            type: 'bar',
            data: {
                labels,
                datasets: [{ label: 'Faturamento', data: faturamentoPorDia, backgroundColor: '#C20000', borderRadius: 6 }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { callback: (v) => `R$ ${v}` } } }
            }
        });
    }

    const ctxPed = document.getElementById('chartPedidos7d');
    if (ctxPed) {
        if (chartPedidosInstance) chartPedidosInstance.destroy();
        chartPedidosInstance = new Chart(ctxPed, {
            type: 'line',
            data: {
                labels,
                datasets: [{ label: 'Pedidos', data: pedidosPorDia, borderColor: '#3498DB', backgroundColor: 'rgba(52,152,219,0.15)', fill: true, tension: 0.3 }]
            },
            options: {
                responsive: true,
                plugins: { legend: { display: false } },
                scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
            }
        });
    }
}

function renderizarChartTopProdutos(topProdutos) {
    const ctx = document.getElementById('chartTopProdutos');
    if (!ctx || typeof Chart === 'undefined') return;

    if (chartTopProdutosInstance) chartTopProdutosInstance.destroy();

    if (topProdutos.length === 0) {
        return; // canvas fica vazio, sem gráfico — evita erro do Chart.js com dataset vazio
    }

    chartTopProdutosInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: topProdutos.map(p => p.nome),
            datasets: [{ label: 'Vendidos', data: topProdutos.map(p => p.quantidadeVendidaReal), backgroundColor: '#F39C12', borderRadius: 6 }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            plugins: { legend: { display: false } },
            scales: { x: { beginAtZero: true, ticks: { stepSize: 1 } } }
        }
    });
}

// ================= EXPORTAR RELATÓRIO (EXCEL) =================
function intervaloRelatorio(periodo, inicioHoje) {
    if (periodo === 'diario') {
        const fim = new Date(inicioHoje); fim.setDate(fim.getDate() + 1);
        return { inicio: inicioHoje, fim, label: 'Diário' };
    }
    if (periodo === 'semanal') {
        const inicio = new Date(inicioHoje); inicio.setDate(inicio.getDate() - 6);
        const fim = new Date(inicioHoje); fim.setDate(fim.getDate() + 1);
        return { inicio, fim, label: 'Últimos 7 dias' };
    }
    // mensal
    const agora = new Date();
    const inicio = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const fim = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);
    return { inicio, fim, label: 'Mês atual' };
}

// ========== RELATÓRIO EM XLSX (visual profissional via ExcelJS) ==========
// Paleta da marca, reaproveitada em toda a planilha
const RELATORIO_COR = {
    primaria: 'FFC20000',
    primariaEscura: 'FF970000',
    secundaria: 'FF2B0000',
    sucesso: 'FF27AE60',
    perigo: 'FFE74C3C',
    alerta: 'FFF39C12',
    fundoClaro: 'FFF7F7F7',
    fundoZebra: 'FFFAFAFA',
    branco: 'FFFFFFFF',
    textoEscuro: 'FF1A1A1A',
    textoClaro: 'FF888888',
    borda: 'FFE0E0E0'
};

const RELATORIO_STATUS_LABELS = {
    pendente: 'Pendente', preparando: 'Preparando', saiu_entrega: 'Saiu para Entrega',
    entregue: 'Entregue', cancelado: 'Cancelado'
};

function relatorioFormatarIntervalo(inicio, fimExclusivo) {
    const fimInclusive = new Date(fimExclusivo.getTime() - 1);
    const opts = { day: '2-digit', month: '2-digit', year: 'numeric' };
    const i = inicio.toLocaleDateString('pt-BR', opts);
    const f = fimInclusive.toLocaleDateString('pt-BR', opts);
    return i === f ? i : `${i} a ${f}`;
}

function relatorioFormatarTelefone(tel) {
    const n = (tel || '').toString().replace(/\D/g, '');
    if (n.length === 11) return `(${n.slice(0, 2)}) ${n.slice(2, 7)}-${n.slice(7)}`;
    if (n.length === 10) return `(${n.slice(0, 2)}) ${n.slice(2, 6)}-${n.slice(6)}`;
    return tel || '';
}

// Título de seção na aba Resumo (barra escura, texto branco) — retorna a próxima linha livre
function relatorioTituloSecao(ws, linha, texto) {
    ws.mergeCells(`B${linha}:C${linha}`);
    const cell = ws.getCell(`B${linha}`);
    cell.value = texto;
    cell.font = { bold: true, size: 11, color: { argb: RELATORIO_COR.branco } };
    cell.alignment = { vertical: 'middle', indent: 1 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RELATORIO_COR.secundaria } };
    ws.getRow(linha).height = 22;
    return linha + 1;
}

// Lista de [label, valor, corDoValor?, formato?, destaque?] como tabela label/valor com zebra
function relatorioTabelaKV(ws, linhaInicial, itens) {
    let linha = linhaInicial;
    itens.forEach(([label, valor, cor, formato, destaque], i) => {
        const rowLabel = ws.getCell(`B${linha}`);
        const rowValor = ws.getCell(`C${linha}`);

        rowLabel.value = label;
        rowLabel.font = { size: 10, bold: !!destaque, color: { argb: RELATORIO_COR.textoEscuro } };
        rowValor.value = valor;
        rowValor.font = { size: destaque ? 12 : 10, bold: true, color: { argb: cor || RELATORIO_COR.textoEscuro } };
        rowValor.alignment = { horizontal: 'right' };

        if (formato === 'moeda') rowValor.numFmt = '"R$" #,##0.00';
        else if (formato) rowValor.numFmt = formato;

        const fundo = i % 2 === 0 ? RELATORIO_COR.fundoClaro : RELATORIO_COR.branco;
        [rowLabel, rowValor].forEach(c => {
            c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fundo } };
            c.border = { bottom: { style: 'hair', color: { argb: RELATORIO_COR.borda } } };
        });

        linha += 1;
    });
    return linha;
}

// Cabeçalho de tabela (abas Pedidos/Produtos): fundo vermelho, texto branco, linha congelada
function relatorioCabecalhoTabela(ws, colunas) {
    ws.columns = colunas;
    const headerRow = ws.getRow(1);
    headerRow.height = 24;
    colunas.forEach((c, i) => {
        const cell = headerRow.getCell(i + 1);
        cell.value = c.header;
        cell.font = { bold: true, color: { argb: RELATORIO_COR.branco }, size: 10 };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RELATORIO_COR.primaria } };
        cell.alignment = { vertical: 'middle', horizontal: i === 0 ? 'center' : 'left' };
        cell.border = { bottom: { style: 'thin', color: { argb: RELATORIO_COR.primariaEscura } } };
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.pageSetup = { fitToPage: true, fitToWidth: 1, fitToHeight: 0, orientation: 'landscape' };
}

// Zebra + bordas finas pra cada linha de dado
function relatorioEstilizarLinha(row, indice) {
    const fundo = indice % 2 === 0 ? RELATORIO_COR.fundoZebra : RELATORIO_COR.branco;
    row.eachCell({ includeEmpty: true }, cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fundo } };
        cell.font = { size: 10, color: { argb: RELATORIO_COR.textoEscuro } };
        cell.border = { bottom: { style: 'hair', color: { argb: RELATORIO_COR.borda } } };
        cell.alignment = { vertical: 'middle' };
    });
}

function relatorioColorirStatus(cell, status) {
    const cores = {
        entregue: RELATORIO_COR.sucesso, cancelado: RELATORIO_COR.perigo,
        pendente: RELATORIO_COR.alerta, preparando: RELATORIO_COR.alerta, saiu_entrega: 'FF3498DB'
    };
    cell.font = Object.assign({}, cell.font, { bold: true, color: { argb: cores[status] || RELATORIO_COR.textoEscuro } });
}

// Autofiltro (ou aviso de "sem registros")
function relatorioFinalizarTabela(ws, numColunas, numLinhas) {
    if (numLinhas === 0) {
        ws.mergeCells(2, 1, 2, numColunas);
        const cell = ws.getCell(2, 1);
        cell.value = 'Nenhum registro nesse período.';
        cell.font = { italic: true, color: { argb: RELATORIO_COR.textoClaro } };
        cell.alignment = { horizontal: 'center' };
        return;
    }
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: numLinhas + 1, column: numColunas } };
}

async function exportarRelatorio(periodo) {
    if (typeof ExcelJS === 'undefined') {
        showToast('Biblioteca de planilha não carregou — confira sua conexão e tente de novo', 'error');
        return;
    }

    const btn = document.querySelector(`.relatorio-periodo-btn[data-periodo="${periodo}"]`);
    const textoOriginalBtn = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = 'Gerando...'; }

    try {
        const paraData = (timestamp) => {
            if (!timestamp) return null;
            return typeof timestamp.toDate === 'function' ? timestamp.toDate() : new Date(timestamp);
        };

        const agora = new Date();
        const inicioHoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
        const { inicio, fim, label } = intervaloRelatorio(periodo, inicioHoje);

        const pedidosNoPeriodo = pedidosAdmin
            .filter(p => {
                const d = paraData(p.criadoEm);
                return d && d >= inicio && d < fim;
            })
            .sort((a, b) => (paraData(b.criadoEm) || 0) - (paraData(a.criadoEm) || 0));

        const entreguesNoPeriodo = pedidosNoPeriodo.filter(p => p.status === 'entregue');
        const canceladosNoPeriodo = pedidosNoPeriodo.filter(p => p.status === 'cancelado');

        const produtoPorId = new Map(produtosAdmin.map(p => [p.id, p]));
        let faturamento = 0, custo = 0;
        entreguesNoPeriodo.forEach(p => {
            faturamento += (p.total || 0);
            (p.itens || []).forEach(item => {
                const produto = produtoPorId.get(item.id);
                if (produto && typeof produto.custo === 'number') custo += produto.custo * (item.quantidade || 0);
            });
        });
        const lucro = faturamento - custo;
        const margem = faturamento > 0 ? lucro / faturamento : 0;
        const ticketMedio = entreguesNoPeriodo.length ? faturamento / entreguesNoPeriodo.length : 0;
        const taxaConclusao = pedidosNoPeriodo.length ? entreguesNoPeriodo.length / pedidosNoPeriodo.length : 0;

        const workbook = new ExcelJS.Workbook();
        workbook.creator = nomeLojaAtual || 'ArretadoGo';
        workbook.created = agora;

        // ===================== ABA RESUMO =====================
        const wsResumo = workbook.addWorksheet('Resumo', {
            properties: { tabColor: { argb: RELATORIO_COR.primaria } },
            views: [{ showGridLines: false }]
        });
        wsResumo.columns = [{ width: 4 }, { width: 34 }, { width: 20 }, { width: 4 }];

        wsResumo.mergeCells('B2:C2');
        const bannerLoja = wsResumo.getCell('B2');
        bannerLoja.value = nomeLojaAtual || 'ArretadoGo';
        bannerLoja.font = { name: 'Calibri', size: 22, bold: true, color: { argb: RELATORIO_COR.branco } };
        bannerLoja.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        wsResumo.getRow(2).height = 40;
        ['A', 'B', 'C', 'D'].forEach(col => {
            wsResumo.getCell(`${col}2`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RELATORIO_COR.secundaria } };
        });

        wsResumo.mergeCells('B3:C3');
        const bannerSub = wsResumo.getCell('B3');
        bannerSub.value = `Relatório ${label}  ·  ${relatorioFormatarIntervalo(inicio, fim)}`;
        bannerSub.font = { size: 11, italic: true, color: { argb: RELATORIO_COR.branco } };
        bannerSub.alignment = { vertical: 'middle', horizontal: 'left', indent: 1 };
        wsResumo.getRow(3).height = 22;
        ['A', 'B', 'C', 'D'].forEach(col => {
            wsResumo.getCell(`${col}3`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: RELATORIO_COR.primaria } };
        });

        wsResumo.getCell('B5').value = `Gerado em ${agora.toLocaleString('pt-BR')}`;
        wsResumo.getCell('B5').font = { size: 9, italic: true, color: { argb: RELATORIO_COR.textoClaro } };

        let linha = 7;
        linha = relatorioTituloSecao(wsResumo, linha, '📊  INDICADORES DO PERÍODO');
        linha = relatorioTabelaKV(wsResumo, linha, [
            ['Pedidos recebidos', pedidosNoPeriodo.length, null],
            ['Pedidos entregues', entreguesNoPeriodo.length, RELATORIO_COR.sucesso],
            ['Pedidos cancelados', canceladosNoPeriodo.length, canceladosNoPeriodo.length > 0 ? RELATORIO_COR.perigo : null],
            ['Taxa de conclusão', taxaConclusao, null, '0.0%']
        ]);

        linha += 1;
        linha = relatorioTituloSecao(wsResumo, linha, '💰  FINANCEIRO');
        linha = relatorioTabelaKV(wsResumo, linha, [
            ['Faturamento', faturamento, RELATORIO_COR.sucesso, 'moeda'],
            ['Custo (produtos c/ custo cadastrado)', custo, RELATORIO_COR.textoClaro, 'moeda'],
            ['Lucro líquido (estimado)', lucro, lucro >= 0 ? RELATORIO_COR.sucesso : RELATORIO_COR.perigo, 'moeda', true],
            ['Margem de lucro', margem, null, '0.0%'],
            ['Ticket médio', ticketMedio, null, 'moeda']
        ]);

        wsResumo.mergeCells(`B${linha + 1}:C${linha + 1}`);
        const notaCusto = wsResumo.getCell(`B${linha + 1}`);
        notaCusto.value = 'Custo considera só produtos com "custo" cadastrado no admin — os demais entram como R$ 0,00.';
        notaCusto.font = { size: 8, italic: true, color: { argb: RELATORIO_COR.textoClaro } };

        // ===================== ABA PEDIDOS =====================
        const wsPedidos = workbook.addWorksheet('Pedidos', { properties: { tabColor: { argb: RELATORIO_COR.primaria } } });
        const colunasPedidos = [
            { header: 'Código', key: 'codigo', width: 14 },
            { header: 'Cliente', key: 'cliente', width: 24 },
            { header: 'Telefone', key: 'telefone', width: 17 },
            { header: 'Tipo', key: 'tipo', width: 12 },
            { header: 'Status', key: 'status', width: 16 },
            { header: 'Total', key: 'total', width: 14 },
            { header: 'Criado em', key: 'criadoEm', width: 19 },
            { header: 'Entregue em', key: 'entregueEm', width: 19 }
        ];
        relatorioCabecalhoTabela(wsPedidos, colunasPedidos);

        pedidosNoPeriodo.forEach((p, i) => {
            const row = wsPedidos.addRow({
                codigo: p.codigoPedido || p.id,
                cliente: p.nome || '',
                telefone: relatorioFormatarTelefone(p.telefone),
                tipo: p.tipoEntrega === 'delivery' ? 'Delivery' : 'Retirada',
                status: RELATORIO_STATUS_LABELS[p.status] || 'Pendente',
                total: p.total || 0,
                criadoEm: paraData(p.criadoEm),
                entregueEm: paraData(p.entregueEm)
            });
            relatorioEstilizarLinha(row, i);
            row.getCell('total').numFmt = '"R$" #,##0.00';
            row.getCell('criadoEm').numFmt = 'dd/mm/yyyy hh:mm';
            row.getCell('entregueEm').numFmt = 'dd/mm/yyyy hh:mm';
            relatorioColorirStatus(row.getCell('status'), p.status);
        });
        relatorioFinalizarTabela(wsPedidos, colunasPedidos.length, pedidosNoPeriodo.length);

        // ===================== ABA PRODUTOS =====================
        const vendasPorProduto = new Map();
        entreguesNoPeriodo.forEach(p => {
            (p.itens || []).forEach(item => {
                const atual = vendasPorProduto.get(item.id) || { nome: item.nome, quantidade: 0, total: 0 };
                atual.quantidade += item.quantidade || 0;
                atual.total += (item.preco || 0) * (item.quantidade || 0);
                vendasPorProduto.set(item.id, atual);
            });
        });
        const rankingProdutos = [...vendasPorProduto.values()].sort((a, b) => b.total - a.total);
        const faturamentoProdutos = rankingProdutos.reduce((s, v) => s + v.total, 0);

        const wsProdutos = workbook.addWorksheet('Produtos', { properties: { tabColor: { argb: RELATORIO_COR.primaria } } });
        const colunasProdutos = [
            { header: '#', key: 'pos', width: 6 },
            { header: 'Produto', key: 'nome', width: 30 },
            { header: 'Qtd. Vendida', key: 'quantidade', width: 14 },
            { header: 'Faturamento', key: 'faturamento', width: 16 },
            { header: '% do Total', key: 'percentual', width: 12 }
        ];
        relatorioCabecalhoTabela(wsProdutos, colunasProdutos);

        rankingProdutos.forEach((v, i) => {
            const medalha = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : String(i + 1);
            const row = wsProdutos.addRow({
                pos: medalha,
                nome: v.nome,
                quantidade: v.quantidade,
                faturamento: v.total,
                percentual: faturamentoProdutos > 0 ? v.total / faturamentoProdutos : 0
            });
            relatorioEstilizarLinha(row, i);
            row.getCell('faturamento').numFmt = '"R$" #,##0.00';
            row.getCell('percentual').numFmt = '0.0%';
            row.getCell('pos').alignment = { horizontal: 'center' };
        });
        relatorioFinalizarTabela(wsProdutos, colunasProdutos.length, rankingProdutos.length);

        if (rankingProdutos.length > 0) {
            wsProdutos.addConditionalFormatting({
                ref: `C2:C${rankingProdutos.length + 1}`,
                rules: [{
                    type: 'dataBar',
                    cfvo: [{ type: 'min' }, { type: 'max' }],
                    color: { argb: RELATORIO_COR.primaria },
                    priority: 1
                }]
            });
        }

        // ===== GERAR E BAIXAR =====
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `relatorio-${periodo}-${inicioHoje.toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        showToast('Relatório baixado!', 'success');
    } catch (error) {
        console.error('Erro ao gerar relatório:', error);
        showToast('Erro ao gerar relatório', 'error');
    } finally {
        if (btn) { btn.disabled = false; btn.textContent = textoOriginalBtn; }
    }
}


// ========== LOGOUT ==========
document.getElementById('logoutBtn')?.addEventListener('click', async () => {
    try {
        await logoutAdmin();
        window.location.href = 'index.html';
    } catch (error) {
        console.error('Erro ao fazer logout:', error);
        showToast('Erro ao fazer logout', 'error');
    }
});

// ========== IMPORTAR PRODUTOS EM LOTE (via planilha) ==========
const CATEGORIAS_CARDAPIO = ['burgers', 'pizza', 'bebidas', 'acompanhamentos', 'sobremesas'];
const BADGES_CARDAPIO = ['', 'novo', 'promo', 'bestseller', 'limitado'];
let produtosExtraidosCardapio = [];

document.getElementById('importarPlanilhaBtn')?.addEventListener('click', () => {
    resetImportModal();
    abrirModal('importCardapioModal');
});

document.getElementById('closeImportModal')?.addEventListener('click', () => {
    fecharModal('importCardapioModal');
});

document.getElementById('cancelImportBtn')?.addEventListener('click', () => {
    fecharModal('importCardapioModal');
});

function resetImportModal() {
    produtosExtraidosCardapio = [];
    document.getElementById('planilhaImportInput').value = '';
    document.getElementById('cardapioPreviewWrapper').style.display = 'none';
    document.getElementById('cardapioPreviewList').innerHTML = '';
    document.getElementById('importarTodosBtn').style.display = 'none';
}

document.getElementById('processarPlanilhaBtn')?.addEventListener('click', async () => {
    const fileInput = document.getElementById('planilhaImportInput');
    const file = fileInput.files[0];
    if (!file) {
        showToast('Selecione o arquivo da planilha primeiro', 'error');
        return;
    }

    const btn = document.getElementById('processarPlanilhaBtn');
    const textoOriginal = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Lendo planilha...';

    try {
        const buffer = await file.arrayBuffer();
        const workbook = XLSX.read(buffer, { type: 'array' });

        // Usa a aba "Produtos" se existir (nome do template), senão a primeira aba
        const nomeAba = workbook.SheetNames.includes('Produtos') ? 'Produtos' : workbook.SheetNames[0];
        const planilha = workbook.Sheets[nomeAba];
        const linhas = XLSX.utils.sheet_to_json(planilha, { defval: '' });

        if (linhas.length === 0) {
            showToast('A planilha está vazia', 'error');
            return;
        }

        produtosExtraidosCardapio = linhas.map(linha => normalizarLinhaPlanilha(linha)).filter(p => p.nome && p.preco > 0);

        if (produtosExtraidosCardapio.length === 0) {
            showToast('Nenhuma linha válida encontrada (verifique nome e preço)', 'error');
            return;
        }

        renderizarPreviewCardapio();
        document.getElementById('cardapioPreviewWrapper').style.display = 'block';
        document.getElementById('importarTodosBtn').style.display = 'inline-block';
        showToast(`${produtosExtraidosCardapio.length} itens lidos da planilha. Revise antes de importar.`, 'success');
    } catch (error) {
        console.error('Erro ao ler planilha:', error);
        showToast('Erro ao ler a planilha. Confira se o arquivo segue o modelo.', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = textoOriginal;
    }
});

function normalizarLinhaPlanilha(linha) {
    const paraBooleano = (valor) => {
        if (typeof valor === 'boolean') return valor;
        const v = String(valor).trim().toUpperCase();
        return v === 'TRUE' || v === 'VERDADEIRO' || v === '1' || v === 'SIM';
    };

    const categoria = CATEGORIAS_CARDAPIO.includes(String(linha.categoria || '').trim()) ? String(linha.categoria).trim() : 'burgers';
    const badge = BADGES_CARDAPIO.includes(String(linha.badge || '').trim()) ? String(linha.badge).trim() : '';
    const controlaEstoque = paraBooleano(linha.controlaEstoque);

    return {
        nome: String(linha.nome || '').trim(),
        categoria,
        preco: parseFloat(String(linha.preco).replace(',', '.')) || 0,
        descricao: String(linha.descricao || '').trim(),
        controlaEstoque,
        estoque: parseInt(linha.estoque) || 0,
        badge,
        ativo: paraBooleano(linha.ativo),
        // Planilha não tem imagem — placeholder editável no preview antes de importar
        imagem: `https://placehold.co/400x400/EFEFEF/666666?text=${encodeURIComponent(String(linha.nome || 'Produto').slice(0, 20))}`,
        incluir: true
    };
}

function renderizarPreviewCardapio() {
    const container = document.getElementById('cardapioPreviewList');

    container.innerHTML = produtosExtraidosCardapio.map((p, i) => `
        <div class="order-card" style="border-left-color: ${p.incluir ? 'var(--primary-color)' : 'var(--text-light)'};" data-idx="${i}">
            <div class="form-row">
                <div class="form-group">
                    <label>Nome</label>
                    <input class="input-field campo-cardapio" data-idx="${i}" data-field="nome" value="${escapeAttr(p.nome)}">
                </div>
                <div class="form-group">
                    <label>Categoria</label>
                    <select class="input-field campo-cardapio" data-idx="${i}" data-field="categoria">
                        ${CATEGORIAS_CARDAPIO.map(c => `<option value="${c}" ${c === p.categoria ? 'selected' : ''}>${capitalize(c)}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-row">
                <div class="form-group">
                    <label>Preço (R$)</label>
                    <input class="input-field campo-cardapio" type="number" step="0.01" data-idx="${i}" data-field="preco" value="${p.preco}">
                </div>
                <div class="form-group">
                    <label>Badge</label>
                    <select class="input-field campo-cardapio" data-idx="${i}" data-field="badge">
                        ${BADGES_CARDAPIO.map(b => `<option value="${b}" ${b === (p.badge || '') ? 'selected' : ''}>${b ? capitalize(b) : 'Nenhuma'}</option>`).join('')}
                    </select>
                </div>
            </div>
            <div class="form-group">
                <label>Descrição</label>
                <input class="input-field campo-cardapio" data-idx="${i}" data-field="descricao" value="${escapeAttr(p.descricao)}">
            </div>
            <div class="form-group">
                <label>URL da Imagem <small>(placeholder gerado — troque pela foto real)</small></label>
                <input class="input-field campo-cardapio" data-idx="${i}" data-field="imagem" value="${escapeAttr(p.imagem)}">
            </div>
            <div class="form-row">
                <div class="form-group checkbox">
                    <input type="checkbox" class="campo-cardapio" data-idx="${i}" data-field="controlaEstoque" ${p.controlaEstoque ? 'checked' : ''}>
                    <label>Descontar do estoque automaticamente</label>
                </div>
                <div class="form-group checkbox">
                    <input type="checkbox" class="campo-cardapio" data-idx="${i}" data-field="ativo" ${p.ativo ? 'checked' : ''}>
                    <label>Ativo (visível na loja)</label>
                </div>
            </div>
            <div class="form-group checkbox">
                <input type="checkbox" class="campo-cardapio" data-idx="${i}" data-field="incluir" ${p.incluir ? 'checked' : ''}>
                <label><strong>Incluir este item na importação</strong></label>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.campo-cardapio').forEach(el => {
        const evento = (el.type === 'checkbox') ? 'change' : 'input';
        el.addEventListener(evento, (e) => {
            const idx = e.target.dataset.idx;
            const field = e.target.dataset.field;
            let valor;
            if (e.target.type === 'checkbox') {
                valor = e.target.checked;
            } else if (field === 'preco') {
                valor = parseFloat(e.target.value) || 0;
            } else {
                valor = e.target.value;
            }
            produtosExtraidosCardapio[idx][field] = valor;

            if (field === 'incluir') {
                const card = container.querySelector(`.order-card[data-idx="${idx}"]`);
                if (card) card.style.borderLeftColor = valor ? 'var(--primary-color)' : 'var(--text-light)';
            }
        });
    });
}

function escapeAttr(str) {
    return String(str || '').replace(/"/g, '&quot;');
}

document.getElementById('importarTodosBtn')?.addEventListener('click', async () => {
    const selecionados = produtosExtraidosCardapio.filter(p => p.incluir);

    if (selecionados.length === 0) {
        showToast('Nenhum item selecionado para importar', 'error');
        return;
    }

    const semNomeOuPreco = selecionados.some(p => !p.nome.trim() || !p.preco || !p.categoria || !p.imagem.trim());
    if (semNomeOuPreco) {
        showToast('Existem itens com nome, categoria, preço ou imagem faltando', 'error');
        return;
    }

    const btn = document.getElementById('importarTodosBtn');
    btn.disabled = true;
    btn.textContent = 'Importando...';

    let sucesso = 0;
    let falhas = 0;

    for (const p of selecionados) {
        try {
            await addProduct({
                nome: p.nome.trim(),
                categoria: p.categoria,
                preco: p.preco,
                estoque: p.controlaEstoque ? (p.estoque || 0) : 0,
                controlaEstoque: p.controlaEstoque,
                descricao: p.descricao.trim(),
                imagem: p.imagem.trim(),
                badge: p.badge || null,
                ativo: p.ativo,
                quantidadeVendida: 0
            });
            sucesso++;
        } catch (error) {
            console.error('Erro ao importar produto', p.nome, error);
            falhas++;
        }
    }

    btn.disabled = false;
    btn.textContent = 'Importar Todos';

    if (sucesso > 0) {
        showToast(`${sucesso} produto(s) importado(s)${falhas ? `, ${falhas} falharam` : ''}!`, falhas ? 'info' : 'success');
        fecharModal('importCardapioModal');
        await carregarProdutosAdmin();
        renderizarTabelaProdutos();
    } else {
        showToast('Nenhum produto foi importado. Veja o console para detalhes.', 'error');
    }
});

// ========== MODALS ==========
function abrirModal(modalId) {
    document.getElementById(modalId).classList.add('active');
    document.getElementById('overlay').classList.add('active');
}

function fecharModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
    const sidebarAberta = document.querySelector('.sidebar')?.classList.contains('active');
    if (document.querySelectorAll('.modal.active').length === 0 && !sidebarAberta) {
        document.getElementById('overlay').classList.remove('active');
    }
}

// ========== UTILITÁRIOS ==========
function capitalize(str) {
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    
    setTimeout(() => {
        toast.classList.remove('show');
    }, 3000);
}