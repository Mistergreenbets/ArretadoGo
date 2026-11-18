// ========== CADASTRO PÚBLICO (página de vendas) ==========

let planoSelecionado = 'intermediario';
let timeoutCheckSlug = null;

const PLANOS_RESUMO = {
    basico: 'Básico — R$ 39,90/mês',
    intermediario: 'Intermediário — R$ 59,90/mês',
    premium: 'Premium — R$ 79,90/mês'
};

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.plano-card').forEach(card => {
        card.addEventListener('click', () => selecionarPlano(card));
    });

    document.getElementById('cadSlug').addEventListener('input', (e) => {
        e.target.value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
        clearTimeout(timeoutCheckSlug);
        timeoutCheckSlug = setTimeout(() => checarSlug(e.target.value), 400);
    });

    document.getElementById('cadastroForm').addEventListener('submit', enviarCadastro);
});

function selecionarPlano(card) {
    document.querySelectorAll('.plano-card').forEach(c => c.classList.remove('selecionado'));
    card.classList.add('selecionado');
    planoSelecionado = card.dataset.plano;
    const resumo = document.getElementById('resumoPlanoNome');
    if (resumo) resumo.textContent = PLANOS_RESUMO[planoSelecionado] || planoSelecionado;
}

async function checarSlug(slug) {
    const preview = document.getElementById('slugPreview');
    preview.classList.remove('ok', 'erro');
    if (!slug) {
        preview.textContent = '';
        return;
    }
    preview.textContent = 'Verificando...';

    try {
        const disponivel = await slugDisponivel(slug);
        preview.textContent = disponivel
            ? `✓ arretadogo.com/${slug} disponível`
            : `✗ Esse endereço já está em uso`;
        preview.classList.add(disponivel ? 'ok' : 'erro');
    } catch (error) {
        console.error('Erro ao checar slug:', error);
        preview.textContent = '';
    }
}

async function enviarCadastro(e) {
    e.preventDefault();

    const nomeLoja = document.getElementById('cadNomeLoja').value.trim();
    const slug = document.getElementById('cadSlug').value.trim();
    const whatsappDigitos = document.getElementById('cadWhatsapp').value.replace(/\D/g, '');
    const email = document.getElementById('cadEmail').value.trim();
    const emailConfirma = document.getElementById('cadEmailConfirma').value.trim();
    const senha = document.getElementById('cadSenha').value;
    const senhaConfirma = document.getElementById('cadSenhaConfirma').value;

    if (!/^[a-z0-9-]+$/.test(slug)) {
        showToast('Endereço da loja inválido — use só letras minúsculas, números e hífen', 'error');
        return;
    }
    if (whatsappDigitos.length < 10 || whatsappDigitos.length > 11) {
        showToast('WhatsApp inválido — digite DDD + número (10 ou 11 dígitos)', 'error');
        return;
    }
    if (email.toLowerCase() !== emailConfirma.toLowerCase()) {
        showToast('Os e-mails digitados não são iguais', 'error');
        return;
    }
    if (senha !== senhaConfirma) {
        showToast('As senhas digitadas não são iguais', 'error');
        return;
    }
    if (!document.getElementById('cadTermos').checked) {
        showToast('Você precisa aceitar os Termos de Uso para continuar', 'error');
        return;
    }

    const btn = document.getElementById('cadastroBtn');
    btn.disabled = true;
    btn.textContent = 'Criando sua loja...';

    try {
        const whatsapp = `55${whatsappDigitos}`;
        await cadastrarNovaLojaPublico({ slug, nomeLoja, email, senha, plano: planoSelecionado, whatsapp });
        // Pai do form: '.cad-form-card' em cadastro.html, '.form-side' em vendas.html —
        // usar o parentElement em vez de uma classe fixa faz essa tela de sucesso
        // funcionar nas duas páginas sem precisar duplicar essa lógica.
        document.getElementById('cadastroForm').parentElement.innerHTML = `
            <h2>🎉 Loja criada!</h2>
            <p style="color:#444; font-size:14px; line-height:1.6;">
                Sua loja <strong>${nomeLoja}</strong> já está no ar, com <strong>7 dias de teste grátis</strong>.
                Antes do teste acabar, entraremos em contato pra confirmar o pagamento do plano
                <strong>${planoSelecionado}</strong> e manter sua loja ativa por mais 30 dias.
            </p>
            <p style="color:#888; font-size:13px; margin-top:14px;">Te levando pro painel da sua loja...</p>`;
        // A conta já fica autenticada automaticamente (createUserWithEmailAndPassword loga
        // o usuário), então o admin.html reconhece a sessão sozinho — não precisa logar de novo.
        setTimeout(() => { window.location.href = 'admin.html'; }, 2200);
    } catch (error) {
        console.error('Erro no cadastro:', error);
        const mensagem = error.code === 'auth/email-already-in-use'
            ? 'Esse e-mail já está cadastrado.'
            : error.code === 'permission-denied'
                ? 'Esse endereço de loja já está em uso — escolha outro.'
                : 'Erro ao criar a loja. Tente novamente.';
        showToast(mensagem, 'error');
        btn.disabled = false;
        btn.textContent = 'Criar minha loja';
    }
}

function showToast(message, type = 'info') {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = `toast show ${type}`;
    setTimeout(() => toast.classList.remove('show'), 3000);
}
