// ========== CÁLCULO AUTOMÁTICO DE FRETE POR DISTÂNCIA (KM) ==========
// Fluxo: cliente digita -> PRÉVIA de endereço 100% LOCAL (banco de ruas da própria loja,
// gerado uma vez pelo admin a partir do OpenStreetMap/Overpass e salvo no Firestore da
// loja — ver buscarSugestoesEndereco e processarExportOverpass() em admin.js) -> cliente
// clica numa sugestão -> nome da rua já vem com a grafia certa -> roda o geocoding de
// verdade (Nominatim/Google) com esse texto corrigido, agora com taxa de acerto bem maior
// -> distância até a loja (Haversine) -> taxa = distância (km) × valor por km, com piso
// em taxaMinima.
//
// A prévia não chama NENHUMA API externa a cada tecla digitada — só filtra o banco de
// ruas já carregado em memória (uma leitura no Firestore por sessão). Isso evita custo,
// limite de uso e dependência de terceiro só pra mostrar a lista de sugestões (o geocoding
// final continua usando Nominatim/Google). Cada loja da plataforma tem o SEU PRÓPRIO banco
// de ruas, gerado pelo admin dela — não é um arquivo compartilhado entre lojas.
//
// Se o cliente digitar e mandar sem clicar em nenhuma sugestão (ou colar o texto todo),
// cai no mesmo fluxo de sempre: extrai CEP (se tiver) -> ViaCEP confirma bairro/cidade
// oficiais -> cache (endereço exato, depois CEP) -> geocoding (Nominatim ou Google) -> taxa.
// Ver calcularFreteAutomatico().
//
// Provedor de geocoding é decidido pelo campo configLoja.calculoPorKm.provedor:
//   'nominatim' (padrão, grátis, ativo hoje)
//   'google'    (só funciona se configLoja.calculoPorKm.googleApiKey estiver preenchida)
//
// Pra migrar de Nominatim pra Google no futuro: troca o provedor no admin e cola a chave.
// Nada mais no sistema precisa mudar — a função calcularFreteAutomatico() abaixo é o
// único ponto que decide qual provedor chamar.

// Distância em linha reta entre 2 coordenadas, em km (fórmula de Haversine).
// É uma aproximação (não segue ruas), mas é rápida, grátis e suficiente pra definir
// faixas de taxa de entrega.
function haversineKm(lat1, lng1, lat2, lng2) {
    const R = 6371; // raio da Terra em km
    const toRad = (graus) => (graus * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// ---------- PROVEDORES DE GEOCODING ----------

// Nominatim (OpenStreetMap) — grátis, sem chave. Respeita o limite de uso enviando um
// identificador da aplicação, e usa só 1 requisição por endereço (nunca em loop/lote).
// cidadeUf (ex: "Fortaleza, CE") é essencial: sem isso, o Nominatim busca no Brasil
// inteiro e pode bater numa rua homônima em outra cidade, gerando distância absurda.
async function geocodificarNominatim(enderecoTexto, cidadeUf) {
    const partesLocal = cidadeUf ? cidadeUf.split(/[,/-]/).map(p => p.trim()).filter(Boolean) : [];
    const cidade = partesLocal[0] || '';
    const uf = partesLocal[1] || '';

    // Query estruturada (street/city/state) costuma ter taxa de acerto maior que texto
    // livre pra endereços brasileiros, porque não depende do Nominatim "adivinhar" onde
    // termina o nome da rua e começa a cidade.
    const paramsEstruturados = new URLSearchParams({
        format: 'json',
        addressdetails: '1',
        limit: '1',
        countrycodes: 'br',
        street: enderecoTexto,
        ...(cidade && { city: cidade }),
        ...(uf && { state: uf }),
        country: 'Brazil'
    });

    let dados = await consultarNominatim(paramsEstruturados);

    // Se a busca estruturada não achar nada, tenta de novo em texto livre — mais
    // tolerante a endereços digitados de forma incomum, só perde um pouco de precisão.
    if (!dados || dados.length === 0) {
        const consultaLivre = cidade ? `${enderecoTexto}, ${cidade}, ${uf}, Brasil` : enderecoTexto;
        const paramsLivres = new URLSearchParams({
            format: 'json',
            addressdetails: '1',
            limit: '1',
            countrycodes: 'br',
            q: consultaLivre
        });
        dados = await consultarNominatim(paramsLivres);
    }

    if (!dados || dados.length === 0) return null;

    // Validação de cidade usando o campo estruturado do próprio Nominatim (address.city/
    // town/municipality) em vez de procurar a palavra dentro do texto inteiro do endereço
    // — mais confiável que a comparação anterior, que dependia de a cidade aparecer
    // literalmente no display_name inteiro.
    const endereco = dados[0].address || {};
    if (cidade) {
        const cidadeRetornada = (endereco.city || endereco.town || endereco.municipality || endereco.county || '').toLowerCase();
        if (cidadeRetornada && !cidadeRetornada.includes(cidade.toLowerCase()) && !cidade.toLowerCase().includes(cidadeRetornada)) {
            return null;
        }
    }

    // Bairro pra reportar ao cliente/admin — nem sempre vem preenchido pelo Nominatim,
    // por isso testamos vários campos possíveis antes de desistir.
    const bairro = endereco.suburb || endereco.neighbourhood || endereco.city_district || endereco.quarter || null;

    return { lat: parseFloat(dados[0].lat), lng: parseFloat(dados[0].lon), bairro };
}

async function consultarNominatim(params) {
    const resposta = await fetch(`https://nominatim.openstreetmap.org/search?${params.toString()}`, {
        headers: {
            // Nominatim exige um identificador da aplicação — troque pelo domínio real da loja.
            'Accept-Language': 'pt-BR'
        }
    });
    if (!resposta.ok) throw new Error('Nominatim respondeu com erro: ' + resposta.status);
    return resposta.json();
}

// Google Maps Geocoding — pronto pra usar, só precisa da chave configurada no admin.
// Não é chamado enquanto configLoja.calculoPorKm.provedor !== 'google'.
async function geocodificarGoogle(enderecoTexto, apiKey, cidadeUf) {
    if (!apiKey) throw new Error('Chave do Google Maps não configurada.');
    const cidadeUfLimpa = cidadeUf ? cidadeUf.replace(/[/-]/g, ',') : '';
    const consulta = cidadeUfLimpa ? `${enderecoTexto}, ${cidadeUfLimpa}, Brasil` : enderecoTexto;
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(consulta)}&key=${apiKey}`;
    const resposta = await fetch(url);
    if (!resposta.ok) throw new Error('Google Geocoding respondeu com erro: ' + resposta.status);
    const dados = await resposta.json();

    // Só ZERO_RESULTS significa "endereço não existe". Qualquer outro status
    // (REQUEST_DENIED, OVER_QUERY_LIMIT, INVALID_REQUEST...) é problema de configuração
    // da chave/API, não do endereço digitado — precisa aparecer no console em vez de
    // ficar escondido atrás de uma mensagem genérica de "endereço não encontrado".
    if (dados.status !== 'OK') {
        if (dados.status !== 'ZERO_RESULTS') {
            console.error('Google Geocoding falhou:', dados.status, dados.error_message || '(sem detalhe)');
            throw new Error(`Google Geocoding: ${dados.status}${dados.error_message ? ' — ' + dados.error_message : ''}`);
        }
        return null;
    }
    if (!dados.results?.length) return null;

    const { lat, lng } = dados.results[0].geometry.location;
    // Bairro vem tipado como 'sublocality' (ou 'sublocality_level_1') / 'neighborhood'
    // nos componentes do endereço do Google.
    const componenteBairro = dados.results[0].address_components?.find(
        c => c.types.includes('sublocality') || c.types.includes('sublocality_level_1') || c.types.includes('neighborhood')
    );
    const bairro = componenteBairro?.long_name || null;

    return { lat, lng, bairro };
}

// ViaCEP — grátis, sem chave, super confiável pra CEP brasileiro. Não devolve lat/lng
// (só o geocoding faz isso), mas devolve bairro/cidade/UF OFICIAIS a partir do CEP, o que
// é mais preciso que tentar extrair bairro do resultado do Nominatim/Google (que às vezes
// não vem preenchido). Usado como fonte primária de "bairro reportado" quando o cliente
// digita um CEP junto do endereço.
async function consultarViaCep(cep) {
    try {
        const resposta = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
        if (!resposta.ok) return null;
        const dados = await resposta.json();
        if (dados.erro) return null; // CEP inexistente/inválido
        return {
            bairro: dados.bairro || null,
            cidade: dados.localidade || null,
            uf: dados.uf || null,
            logradouro: dados.logradouro || null
        };
    } catch (error) {
        console.error('Erro ao consultar ViaCEP:', error);
        return null;
    }
}

// Busca as coordenadas do endereço, checando o cache (endereço exato, depois CEP) antes
// de chamar qualquer API. Retorna { lat, lng, bairro, deCache } ou null se não conseguiu
// geocodificar.
async function obterCoordenadasEndereco(enderecoTexto, config) {
    // 1) Cache por endereço exato (a chave já leva em conta a cidade/UF configurada —
    // ver normalizarChaveEndereco em firebase-config.js)
    const cacheEndereco = await buscarCacheEndereco(enderecoTexto, config?.cidadeUf);
    if (cacheEndereco?.lat && cacheEndereco?.lng) {
        return { lat: cacheEndereco.lat, lng: cacheEndereco.lng, bairro: cacheEndereco.bairro || null, deCache: true };
    }

    // 2) Cache por CEP (endereço diferente, mesma região)
    const cep = extrairCep(enderecoTexto);
    let bairroViaCep = null;
    if (cep) {
        const cacheCep = await buscarCacheCep(cep);
        if (cacheCep?.lat && cacheCep?.lng) {
            return { lat: cacheCep.lat, lng: cacheCep.lng, bairro: cacheCep.bairro || null, deCache: true };
        }

        // Nada em cache pra esse CEP ainda — consulta o ViaCEP pra já garantir um bairro
        // oficial, mesmo que o geocoding que vem a seguir não devolva esse campo.
        const viaCep = await consultarViaCep(cep);
        if (viaCep?.bairro) bairroViaCep = viaCep.bairro;
    }

    // 3) Nada em cache — chama o provedor configurado
    const provedor = config?.provedor || 'nominatim';
    const coordenadas = provedor === 'google'
        ? await geocodificarGoogle(enderecoTexto, config?.googleApiKey, config?.cidadeUf)
        : await geocodificarNominatim(enderecoTexto, config?.cidadeUf);

    if (!coordenadas) return null;
    // ViaCEP é a fonte mais confiável de bairro quando disponível; senão usa o que o
    // geocoding conseguiu extrair.
    return { ...coordenadas, bairro: bairroViaCep || coordenadas.bairro || null, deCache: false, cep };
}

// Função principal: recebe o endereço digitado pelo cliente e devolve o resultado do
// cálculo de frete, ou o motivo pelo qual não foi possível calcular (endereço não
// encontrado, loja sem coordenadas cadastradas, etc.) — quem chama decide o fallback.
async function calcularFreteAutomatico(enderecoTexto, config) {
    if (!config?.ativo) {
        return { ok: false, motivo: 'desativado' };
    }
    if (config.lojaLat == null || config.lojaLng == null) {
        return { ok: false, motivo: 'loja-sem-coordenadas' };
    }
    if (!(Number(config.valorPorKm) > 0)) {
        return { ok: false, motivo: 'sem-valor-km' };
    }
    if (!enderecoTexto || enderecoTexto.trim().length < 8) {
        return { ok: false, motivo: 'endereco-curto' };
    }

    try {
        const coordenadasCliente = await obterCoordenadasEndereco(enderecoTexto, config);
        if (!coordenadasCliente) {
            return { ok: false, motivo: 'endereco-nao-encontrado' };
        }

        // Salva no cache pra próxima vez sair sem chamar a API — só grava se não veio do
        // cache. Guarda lat/lng/bairro (a taxa nunca é cacheada, ver calcularTaxaPorDistancia).
        if (!coordenadasCliente.deCache) {
            const dadosCache = { lat: coordenadasCliente.lat, lng: coordenadasCliente.lng, bairro: coordenadasCliente.bairro || null };
            salvarCacheEndereco(enderecoTexto, config?.cidadeUf, dadosCache); // não precisa aguardar (não bloqueia a UI)
            if (coordenadasCliente.cep) salvarCacheCep(coordenadasCliente.cep, dadosCache);
        }

        const { distanciaKm, taxa } = calcularTaxaPorDistancia(coordenadasCliente.lat, coordenadasCliente.lng, config);
        return { ok: true, distanciaKm, taxa, bairro: coordenadasCliente.bairro || null };
    } catch (error) {
        console.error('Erro ao calcular frete automático:', error);
        return { ok: false, motivo: 'erro-geocoding' };
    }
}

// Distância + taxa a partir de coordenadas JÁ CONHECIDAS — usado tanto pelo fluxo de texto
// livre acima (depois de geocodificar) quanto pelo fluxo de sugestão/autocomplete abaixo
// (que já vem com lat/lng exatos, sem precisar geocodificar de novo).
function calcularTaxaPorDistancia(lat, lng, config) {
    const distanciaKm = haversineKm(config.lojaLat, config.lojaLng, lat, lng);
    // Taxa proporcional à distância, com piso em taxaMinima — nunca cobra menos que isso,
    // nem pra endereço colado na loja. Recalculada sempre com o valorPorKm/taxaMinima
    // ATUAIS (nunca cacheados), pra um reajuste de preço no admin valer na hora, sem
    // precisar limpar nada no Firestore.
    const taxaBruta = distanciaKm * Number(config.valorPorKm);
    const taxaMinima = Number(config.taxaMinima) || 0;
    const taxa = Math.round(Math.max(taxaBruta, taxaMinima) * 100) / 100;
    return { distanciaKm, taxa };
}

// ---------- PRÉVIA DE ENDEREÇO ENQUANTO DIGITA (banco local, sem API) ----------

// Banco gerado pelo ADMIN da loja (Overpass export → importado no painel, ver
// processarExportOverpass() em admin.js) e salvo no Firestore da própria loja — cada loja
// tem o seu, escopado por lojaAtual (ver colLoja() em firebase-config.js). Carregado aqui
// em memória, uma vez por sessão — a prévia enquanto o cliente digita não faz NENHUMA
// chamada de rede depois disso, só filtra esse array.
let baseRuasCache = null;
let baseRuasCarregando = null;

async function carregarBaseRuas() {
    if (baseRuasCache) return baseRuasCache;
    if (baseRuasCarregando) return baseRuasCarregando;

    baseRuasCarregando = buscarBancoRuas()
        .then(dados => {
            baseRuasCache = Array.isArray(dados?.ruas) ? dados.ruas : [];
            return baseRuasCache;
        })
        .catch(error => {
            console.error('Erro ao carregar banco local de ruas:', error);
            baseRuasCache = [];
            return baseRuasCache;
        });

    return baseRuasCarregando;
}

// Remove acentos, pontuação e caixa, pra comparar "gerárdo" com "Gerardo," sem diferença.
function normalizarTextoBusca(texto) {
    return texto
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Filtra o banco local de ruas pelo texto digitado. Separa um número no final do texto
// (ex: "Rua Gerardo Freitas 195") pra não atrapalhar o match do nome — o número volta a
// ser anexado no resultado final, só pra exibição.
async function buscarSugestoesEndereco(textoDigitado, config) {
    const texto = (textoDigitado || '').trim();
    if (texto.length < 3) return [];

    const base = await carregarBaseRuas();
    if (!base.length) return [];

    const textoNormalizado = normalizarTextoBusca(texto);
    const partes = textoNormalizado.split(' ').filter(Boolean);
    const numeroDigitado = partes.length > 1 && /^\d+$/.test(partes[partes.length - 1])
        ? partes.pop()
        : null;
    const textoRua = partes.join(' ');
    if (!textoRua) return [];

    return base
        .map(rua => ({ rua, chave: normalizarTextoBusca(rua.nome) }))
        .filter(({ chave }) => chave.includes(textoRua))
        .sort((a, b) => {
            // Prioriza quem COMEÇA com o texto digitado sobre quem só contém no meio,
            // e entre empates, nomes mais curtos (mais específicos) primeiro.
            const aComeca = a.chave.startsWith(textoRua) ? 0 : 1;
            const bComeca = b.chave.startsWith(textoRua) ? 0 : 1;
            if (aComeca !== bComeca) return aComeca - bComeca;
            return a.chave.length - b.chave.length;
        })
        .slice(0, 6)
        .map(({ rua }) => {
            const enderecoCompleto = numeroDigitado ? `${rua.nome}, ${numeroDigitado}` : rua.nome;
            return {
                titulo: enderecoCompleto,
                subtitulo: numeroDigitado ? null : 'Selecione e complete com o número',
                enderecoCompleto,
                lat: rua.lat,
                lng: rua.lng,
                bairro: null,
                cidade: null
            };
        });
}
