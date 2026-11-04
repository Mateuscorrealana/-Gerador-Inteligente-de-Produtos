import { GoogleGenAI } from '@google/genai';
import conhecimento
    from '../data/conhecimento.json'
    with { type: 'json' };
import produtos
    from '../data/produtos.json'
    with { type: 'json' };
// O SDK é inicializado apenas quando a API Key está configurada.
let clienteGemini;
function obterGemini() {
    if (!clienteGemini) clienteGemini = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    return clienteGemini;
}
const MODEL =
    process.env.GEMINI_MODEL ||
    'gemini-3.8-flash';
const MAX_HTML_CHARS = 2_000_000;
const MAX_PAGE_TEXT_CHARS = 18_000;
const MAX_KB_CHARS = 28_000;
const RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
        dados: {
            type: 'object',
            properties: {
                nome: {
                    type: 'string'
                },
                sku: {
                    type: 'string'
                },
                categoria: {
                    type: 'string'
                },
                linha: {
                    type: 'string'
                },
                especie: {
                    type: 'string'
                },
                material: {
                    type: 'string'
                },
                fatos_confirmados: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                }
            },
            required: [
                'nome',
                'sku',
                'categoria',
                'linha',
                'especie',
                'material',
                'fatos_confirmados'
            ]
        },
        conteudo: {
            type: 'object',
            properties: {
                palavrasChave: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },
                beneficios: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },
                titulo: {
                    type: 'string'
                },
                subtitulo: {
                    type: 'string'
                },
                descricao: {
                    type: 'string'
                },
                resumida: {
                    type: 'string'
                },
                marketplace: {
                    type: 'string'
                },
                imagens: {
                    type: 'array',
                    items: {
                        type: 'string'
                    }
                },
                slug: {
                    type: 'string'
                },
                tituloSeo: {
                    type: 'string'
                },
                meta: {
                    type: 'string'
                }
            },
            required: [
                'palavrasChave',
                'beneficios',
                'titulo',
                'subtitulo',
                'descricao',
                'resumida',
                'marketplace',
                'imagens',
                'slug',
                'tituloSeo',
                'meta'
            ]
        },
        dados_a_confirmar: {
            type: 'array',
            items: {
                type: 'string'
            }
        }
    },
    required: [
        'dados',
        'conteudo',
        'dados_a_confirmar'
    ]
};
const SISTEMA_BLIVE = `
Você é o redator sênior de e-commerce da B.live In Pets,
especialista em SEO, GEO (Generative Engine Optimization),
marketplaces, copywriting e mercado pet.
Seu trabalho é transformar dados reais de produtos em
conteúdo comercial completo, natural, persuasivo e
tecnicamente responsável.
REGRAS ABSOLUTAS:
1. Nunca invente material, composição, tecnologia, UV50+,
impermeabilidade, tamanho, SKU, certificação ou indicação clínica.
2. Um fato técnico só pode ser afirmado quando estiver sustentado
pela página, pelos dados manuais ou pela base B.live.
Se houver conflito ou dúvida, coloque a informação em
dados_a_confirmar.
3. Informações marcadas como "informacao_comercial" podem ser
usadas como comunicação da marca, mas não devem ser transformadas
em confirmação laboratorial ou técnica.
4. Em produtos clínicos, nunca prometa cura ou resultado médico.
Use linguagem de apoio à recuperação e recomende seguir orientação
veterinária quando pertinente.
5. Escreva em português brasileiro natural, próximo e profissional.
Evite linguagem robótica, clichês vazios e keyword stuffing.
6. O conteúdo deve ser específico para o produto.
Não repita o mesmo texto institucional em todos os produtos.
7. Não explique seu raciocínio.
Retorne apenas o JSON exigido.
`;
/**
 * Uma única chamada POST transmite as duas etapas sem gerar chamadas extras
 * ao Gemini. Quem não solicitar streaming continua recebendo JSON normal.
 */
export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ sucesso: false, erro: 'Use uma requisição POST.' });
    }
    const streaming = String(req.headers?.accept || '').includes('application/x-ndjson');
    let streamAberto = false;
    try {
        if (!process.env.GEMINI_API_KEY) {
            return res.status(500).json({ sucesso: false, erro: 'GEMINI_API_KEY não está configurada no servidor.' });
        }
        const entrada = normalizarEntrada(req.body || {});
        if (!entrada.url && !entrada.nome && !entrada.info) {
            return res.status(400).json({ sucesso: false, erro: 'Informe a URL do produto ou dados manuais de um produto novo.' });
        }
        const pagina = entrada.url ? await buscarPaginaProduto(entrada.url) : null;

        if (streaming) {
            res.status(200);
            res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
            res.setHeader('Cache-Control', 'no-cache, no-transform');
            res.setHeader('X-Accel-Buffering', 'no');
            res.flushHeaders?.();
            streamAberto = true;
            res.write(JSON.stringify({ etapa: 'pagina_lida' }) + '\n');
        }

        const contexto = montarContexto({
            entrada, pagina, base: { conhecimento, produtos }
        });
        console.log('1. Página lida. Enviando para o Gemini...');
        console.time('gemini');
        const resultado = normalizarResultado(await gerarCadastro(contexto));
        console.timeEnd('gemini');
        aplicarLimitesSEO(resultado);

        if (streamAberto) {
            res.write(JSON.stringify({ etapa: 'pronto', resultado }) + '\n');
            return res.end();
        }
        return res.status(200).json(resultado);
    } catch (erro) {
        console.error('Erro no gerador:', resumoErro(erro));
        const status = erro?.statusHttp || 500;
        const mensagem = mensagemDeErro(erro);
        if (erro?.retryAfterSegundos && !streamAberto) {
            res.setHeader('Retry-After', String(erro.retryAfterSegundos));
        }
        if (streamAberto) {
            res.write(JSON.stringify({ etapa: 'erro', erro: mensagem, status }) + '\n');
            return res.end();
        }
        return res.status(status).json({ sucesso: false, erro: mensagem });
    }
}
function normalizarEntrada(
    body
) {
    return {
        url: String(
            body.url || ''
        ).trim(),
        nome: String(
            body.nome || ''
        ).trim(),
        sku: String(
            body.sku || ''
        ).trim(),
        info: String(
            body.info || ''
        ).trim()
    };
}
async function buscarPaginaProduto(
    urlRecebida
) {
    const url =
        validarURL(
            urlRecebida
        );
    const resposta =
        await fetch(url, {
            redirect: 'follow',
            signal:
                AbortSignal.timeout(
                    15000
                ),
            headers: {
                'User-Agent':
                    'Mozilla/5.0 (compatible; BliveProductAssistant/1.0; +https://www.bliveinpets.com.br)',
                Accept:
                    'text/html,application/xhtml+xml',
                'Accept-Language':
                    'pt-BR,pt;q=0.9,en;q=0.7'
            }
        });
    if (!resposta.ok) {
        throw new Error(
            `Não foi possível acessar a página do produto. HTTP ${resposta.status}.`
        );
    }
    const urlFinal =
        validarURL(
            resposta.url ||
            url.toString()
        );
    const contentType =
        resposta.headers.get(
            'content-type'
        ) || '';
    if (
        !contentType
            .toLowerCase()
            .includes('text/html')
    ) {
        throw new Error(
            'A URL informada não retornou uma página HTML de produto.'
        );
    }
    let html =
        await resposta.text();
    if (
        html.length >
        MAX_HTML_CHARS
    ) {
        html =
            html.slice(
                0,
                MAX_HTML_CHARS
            );
    }
    const jsonLd =
        extrairJsonLd(html);
    const produtoJsonLd =
        encontrarProdutoJsonLd(
            jsonLd
        );
    return {
        url:
            urlFinal.toString(),
        tituloPagina:
            extrairTagTitle(
                html
            ),
        metaDescription:
            extrairMetaDescription(
                html
            ),
        produtoEstruturado:
            produtoJsonLd,
        textoVisivel:
            extrairTextoVisivel(
                html
            ).slice(
                0,
                MAX_PAGE_TEXT_CHARS
            )
    };
}
function validarURL(
    valor
) {
    let url;
    try {
        url =
            new URL(valor);
    } catch {
        throw new Error(
            'A URL informada é inválida.'
        );
    }
    if (
        ![
            'http:',
            'https:'
        ].includes(
            url.protocol
        )
    ) {
        throw new Error(
            'A URL precisa começar com http:// ou https://.'
        );
    }
    const hostsPermitidos =
        (
            process.env.ALLOWED_PRODUCT_HOSTS ||
            'bliveinpets.com.br,www.bliveinpets.com.br'
        )
            .split(',')
            .map(
                (host) =>
                    host
                        .trim()
                        .toLowerCase()
            )
            .filter(Boolean);
    const hostname =
        url.hostname.toLowerCase();
    const permitido =
        hostsPermitidos.some(
            (host) =>
                hostname === host ||
                hostname.endsWith(
                    '.' + host
                )
        );
    if (!permitido) {
        throw new Error(
            `Por segurança, este gerador aceita URLs apenas dos domínios autorizados: ${hostsPermitidos.join(', ')}.`
        );
    }
    return url;
}
function montarContexto({
    entrada,
    pagina,
    base
}) {
    const baseTexto =
        JSON.stringify(base);
    return {
        entrada,
        pagina,
        baseConhecimento:
            baseTexto.length <=
                MAX_KB_CHARS
                ? base
                : selecionarBaseRelevante(
                    base,
                    entrada,
                    pagina
                )
    };
}
function selecionarBaseRelevante(
    base,
    entrada,
    pagina
) {
    const kb =
        base.conhecimento || {};
    const produtosObjeto =
        base.produtos?.produtos ||
        {};
    const alvo =
        normalizarTexto(
            [
                entrada.nome,
                entrada.sku,
                entrada.info,
                pagina?.tituloPagina,
                pagina?.produtoEstruturado
                    ?.name,
                pagina?.produtoEstruturado
                    ?.sku
            ]
                .filter(Boolean)
                .join(' ')
        );
    const encontrados = {};
    const familias =
        new Set();
    for (
        const [
            chave,
            produto
        ] of Object.entries(
            produtosObjeto
        )
    ) {
        const nome =
            normalizarTexto(
                valorFato(
                    produto?.nome
                ) || ''
            );
        const sku =
            normalizarTexto(
                chave
            );
        if (
            (
                sku &&
                alvo.includes(sku)
            ) ||
            (
                nome &&
                alvo.includes(nome)
            )
        ) {
            encontrados[chave] =
                produto;
            if (
                produto?.familia
            ) {
                familias.add(
                    produto.familia
                );
            }
        }
    }
    const familiasRelevantes =
        {};
    for (
        const familia
        of familias
    ) {
        if (
            kb?.familias?.[
            familia
            ]
        ) {
            familiasRelevantes[
                familia
            ] =
                kb.familias[
                familia
                ];
        }
    }
    return {
        conhecimento: {
            _meta:
                kb._meta || {},
            linhas:
                kb.linhas || {},
            categorias:
                kb.categorias || {},
            materiais:
                kb.materiais || {},
            tecnologias:
                kb.tecnologias || {},
            familias:
                Object.keys(
                    familiasRelevantes
                ).length
                    ? familiasRelevantes
                    : kb.familias || {}
        },
        produtos: {
            _meta:
                base.produtos?._meta ||
                {},
            produtos:
                encontrados
        }
    };
}
// Prioridade: modelo principal escolhido na Vercel, depois alternativa econômica.
// Não usamos aliases como gemini-flash-latest, que podem consumir a mesma cota.
const MODELOS = [...new Set([
    MODEL,
    ...(process.env.GEMINI_FALLBACK_MODELS || 'gemini-3.5-flash-lite')
        .split(',').map((m) => m.trim()).filter(Boolean)
])];
const ORCAMENTO_TOTAL_MS = 120_000;
const TIMEOUT_TENTATIVA_MS = 70_000;
const modelosBloqueados = new Map();
const INSTRUCAO_JSON = `
FORMATO DE SAÍDA: retorne apenas um objeto JSON válido conforme este esquema:
${JSON.stringify(RESPONSE_SCHEMA)}
`;
function dormir(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function dadosErro(error) {
    const raw = String(error?.message || error || '');
    let api = error?.error || null;
    if (!api) {
        try { api = JSON.parse(raw)?.error; } catch { /* mensagem não JSON */ }
    }
    const code = Number(error?.status || error?.code || api?.code || 0);
    const detalhes = api?.details || error?.details || [];
    const segundos = detalhes.find(d => d?.retryDelay)?.retryDelay;
    const retryInfo = typeof segundos === 'string' ? Number(segundos.replace('s', '')) : 0;
    const prazoTexto = raw.match(/Please retry in\s+(\d+)h(\d+)m([\d.]+)s/i);
    const retryAfter = Number.isFinite(retryInfo) && retryInfo > 0
        ? Math.ceil(retryInfo)
        : prazoTexto
            ? Math.ceil(Number(prazoTexto[1]) * 3600 + Number(prazoTexto[2]) * 60 + Number(prazoTexto[3]))
            : 0;
    const texto = [raw, api?.message, JSON.stringify(detalhes)].filter(Boolean).join(' ');
    return {
        code: code || (/(?:^|\W)429(?:\W|$)/.test(texto) ? 429 : (/(?:^|\W)503(?:\W|$)/.test(texto) ? 503 : 0)),
        diario: /generate_content_free_tier_requests|GenerateRequestsPerDay|requests per day|daily quota|per day limit|daily limit/i.test(texto),
        sobrecarga: /503|UNAVAILABLE|high demand/i.test(texto),
        esquema: /INVALID_ARGUMENT|responseJsonSchema|thinkingLevel|schema|unsupported parameter/i.test(texto),
        retryAfter
    };
}
function resumoErro(error) {
    const e = dadosErro(error);
    return { status: e.code, quotaDiaria: e.diario, retryAfter: e.retryAfter, mensagem: String(error?.message || '').slice(0, 140) };
}
function erroControlado(mensagem, statusHttp, retryAfterSegundos = 0) {
    const erro = new Error(mensagem);
    erro.statusHttp = statusHttp;
    erro.retryAfterSegundos = retryAfterSegundos;
    return erro;
}
function esperaDaCota(info) {
    if (info.retryAfter > 0) return info.retryAfter;
    // Se a API não fornecer um prazo, voltamos a tentar em 15 min.
    return info.diario ? 900 : 60;
}
async function chamarGemini(modelo, prompt, modoCompleto, limiteMs) {
    const config = {
        systemInstruction: SISTEMA_BLIVE + INSTRUCAO_JSON,
        responseMimeType: 'application/json',
        maxOutputTokens: 7000,
        automaticContinuation: false, // uma geração, sem chamadas de continuação automática
        // Timeout real da solicitação, sem deixar uma geração órfã rodando.
        httpOptions: { timeout: limiteMs }
    };
    if (modoCompleto) {
        config.responseJsonSchema = RESPONSE_SCHEMA;
        config.thinkingConfig = { thinkingLevel: 'LOW' };
    }
    const resposta = await obterGemini().models.generateContent({ model: modelo, contents: prompt, config });
    const respostaTexto = resposta?.text || '';
    if (!respostaTexto.trim()) throw erroControlado('O Gemini não devolveu texto para o produto.', 502);
    try {
        return JSON.parse(respostaTexto);
    } catch {
        throw erroControlado('O Gemini devolveu um JSON inválido.', 502);
    }
}
async function gerarCadastro(contexto) {
    const prompt = criarPromptPrincipal(contexto);
    console.log(`Prompt: ${prompt.length} caracteres`);
    const inicio = Date.now();
    let ultimoErro = null;
    let menorEsperaCota = Infinity;
    let quantidadeBloqueada = 0;
    for (const modelo of MODELOS) {
        const pausa = modelosBloqueados.get(modelo) || 0;
        if (pausa > Date.now()) {
            quantidadeBloqueada++;
            menorEsperaCota = Math.min(menorEsperaCota, Math.ceil((pausa - Date.now()) / 1000));
            console.log(`Pulando ${modelo}: cota pausada.`);
            continue;
        }
        modelosBloqueados.delete(modelo);
        let usarModoCompleto = true;
        let repeticoes503 = 0;
        for (;;) {
            const restante = ORCAMENTO_TOTAL_MS - (Date.now() - inicio);
            if (restante < 10_000) break;
            try {
                console.log(`Tentando ${modelo} (${usarModoCompleto ? 'JSON estruturado' : 'JSON simples'})`);
                const resultado = await chamarGemini(
                    modelo, prompt, usarModoCompleto, Math.min(restante - 2000, TIMEOUT_TENTATIVA_MS)
                );
                console.log(`OK com ${modelo}`);
                return resultado;
            } catch (erro) {
                ultimoErro = erro;
                const info = dadosErro(erro);
                console.warn(`Falha com ${modelo}:`, resumoErro(erro));
                if (info.code === 429) {
                    const seg = esperaDaCota(info);
                    modelosBloqueados.set(modelo, Date.now() + seg * 1000);
                    menorEsperaCota = Math.min(menorEsperaCota, seg);
                    quantidadeBloqueada++;
                    // Cota esgotada: não repete o modelo com outros parâmetros.
                    break;
                }
                if ((info.code === 503 || info.sobrecarga) && repeticoes503 < 1) {
                    repeticoes503++;
                    await dormir(900);
                    continue;
                }
                if (info.esquema && usarModoCompleto) {
                    // Esquema não suportado: tenta formato simples somente uma vez.
                    usarModoCompleto = false;
                    continue;
                }
                break;
            }
        }
    }
    if (quantidadeBloqueada === MODELOS.length && Number.isFinite(menorEsperaCota)) {
        throw erroControlado('A cota gratuita do Gemini está esgotada. Tente novamente após a liberação informada no Google AI Studio.', 429, menorEsperaCota);
    }
    const info = dadosErro(ultimoErro);
    if (info.code === 429) {
        throw erroControlado('O Gemini atingiu o limite de uso. Tente novamente mais tarde ou confira sua cota no Google AI Studio.', 429, esperaDaCota(info));
    }
    if (info.code === 503 || info.sobrecarga) {
        throw erroControlado('O Gemini está sobrecarregado no momento. Tente novamente mais tarde.', 503);
    }
    throw erroControlado('Não foi possível gerar o produto agora. Confira os registros do servidor.', 502);
}
function criarPromptPrincipal(
    contexto
) {
    return `
Crie o cadastro completo deste produto B.live In Pets usando SOMENTE as fontes fornecidas abaixo.
\===== ENTRADA DO USUÁRIO =====
${JSON.stringify(contexto.entrada)}
\===== CONTEÚDO EXTRAÍDO DA PÁGINA =====
${JSON.stringify(contexto.pagina)}
\===== BANCO DE CONHECIMENTO B.LIVE =====
${JSON.stringify(contexto.baseConhecimento)}
\===== PADRÃO DE ENTREGA =====
DADOS
Identifique:
- nome;
- SKU;
- categoria;
- linha;
- espécie;
- material.
Somente identifique quando realmente houver informação suficiente.
Se algum campo não estiver confirmado:
- use string vazia;
- registre o ponto em dados_a_confirmar.
fatos_confirmados deve conter somente informações que as fontes realmente sustentam.
1. PALAVRAS-CHAVE PARA BUSCA INTERNA
Gere entre 40 e 60 termos curtos e realmente úteis.
Inclua quando aplicável:
- palavra-chave principal;
- categoria;
- espécie;
- finalidade;
- características;
- cores;
- intenção de busca;
- sinônimos;
- termos utilizados por consumidores;
- alguns erros de digitação úteis.
Evite dezenas de combinações quase idênticas.
2. BENEFÍCIOS ESPECÍFICOS
Gere entre 8 e 12 benefícios.
Cada benefício deve ter de 12 a 25 palavras.
Não quero apenas:
"Confortável"
"Qualidade"
"Bonito"
Explique:
CARACTERÍSTICA
\+
IMPACTO PRÁTICO
\+
BENEFÍCIO PARA O PET OU TUTOR.
Exemplo de estilo:
"Mais conforto durante o uso: a estrutura macia e acolchoada ajuda a reduzir a rigidez encontrada em alternativas tradicionais, permitindo que o pet encontre posições mais confortáveis para descansar durante a recuperação."
Somente utilize benefícios sustentados pelas fontes.
3. TÍTULO DA DESCRIÇÃO
O título deve COMEÇAR SEMPRE com a expressão "Roupa para Cachorro e Gato", seguida de hífen e do título comercial do produto.
Se o produto for exclusivo para cachorro ou exclusivo para gato, use "Roupa para Cachorro" ou "Roupa para Gato".
Estrutura: "Roupa para Cachorro e Gato - [título comercial do produto]".
4. SUBTÍTULO DO PRODUTO
Crie um subtítulo longo e descritivo, de 150 a 250 caracteres.
O subtítulo deve:
- explicar rapidamente o produto;
- apresentar o principal benefício;
- trazer algum diferencial real.
Não devolva apenas sequência de palavras-chave.
5. DESCRIÇÃO COMPLETA PARA O SITE
ESTA É UMA DAS PARTES MAIS IMPORTANTES.
Quando houver informação suficiente:
ESCREVA ENTRE 220 E 350 PALAVRAS.
Organize em 4 a 6 blocos. Cada bloco tem um título curto em uma linha, seguido de um parágrafo de 2 a 4 frases.
O primeiro bloco apresenta o produto com um título criativo. O último bloco é o institucional.
O conteúdo deve ser rico, natural e realmente útil.
Explore somente quando houver suporte nas fontes:
- apresentação do produto;
- estética;
- design;
- conforto;
- funcionalidade;
- modelagem;
- material;
- construção;
- acabamentos;
- ocasião de uso;
- indicação;
- diferenciais;
- experiência para o pet;
- praticidade para o tutor.
NÃO invente informações para alcançar o número de palavras.
NÃO fique repetindo a mesma característica.
NÃO escreva frases genéricas apenas para aumentar o texto.
SEO e GEO devem aparecer de maneira natural.
Utilize termos relacionados ao produto dentro de uma escrita humana.
NO FINAL DA DESCRIÇÃO:
Crie um bloco institucional específico para aquele produto.
O bloco deve possuir um título contextual.
Não use sempre:
"Confeccionada com carinho"
Exemplos de lógica:
Produto clínico:
"Cuidado pensado para acompanhar a recuperação"
Produto de verão:
"Conforto para aproveitar os dias mais quentes"
Fantasia:
"Detalhes que transformam cada momento"
O bloco deve reforçar naturalmente:
- cuidado na produção;
- qualidade;
- conforto;
- funcionalidade;
- identidade B.live In Pets.
Não copie sempre o mesmo parágrafo institucional.
6. DESCRIÇÃO RESUMIDA
Escreva de 40 a 70 palavras, em um único parágrafo.
Explique:
- o que é o produto;
- para quem é;
- principais benefícios;
- diferenciais mais importantes.
A descrição resumida deve funcionar sozinha.
7. DESCRIÇÃO PARA MARKETPLACES
Crie UM ÚNICO texto reutilizável em:
- Shopee;
- Mercado Livre;
- TikTok Shop.
Não crie versões separadas.
Quando houver dados suficientes:
ESCREVA ENTRE 100 E 170 PALAVRAS, em 3 parágrafos curtos de texto corrido (sem listas).
A descrição deve ser:
- comercial;
- clara;
- natural;
- persuasiva;
- fácil de ler;
- orientada à conversão.
Inclua naturalmente:
- nome;
- finalidade;
- benefícios;
- características;
- diferenciais;
- espécie;
- material somente quando confirmado;
- tamanhos somente quando confirmados;
- orientações relevantes.
Não transforme o texto em uma ficha técnica seca.
8. E 9. IMAGENS E URL
Retorne "imagens" como array vazio e "slug" como string vazia. Esses campos não são utilizados.
10. TÍTULO SEO PARA GOOGLE
Máximo absoluto:
60 caracteres contando espaços.
O título deve chegar pronto dentro do limite.
Não gere um título enorme para depois ser cortado.
11. META DESCRIPTION
Máximo absoluto:
160 caracteres contando espaços.
Ela deve ser:
- persuasiva;
- natural;
- clara;
- relevante;
- diferente do título;
- orientada para clique.
Deve explicar o produto e seu principal diferencial.
IMPORTANTE SOBRE TAMANHO
Respeite as faixas de palavras. Textos maiores deixam a resposta lenta e não são desejados.
Se a página trouxer poucas informações:
- produza apenas o que as fontes sustentam;
- não invente fatos;
- registre o que estiver faltando em dados_a_confirmar.
`;
}
function normalizarResultado(
    resultado
) {
    const r =
        resultado &&
            typeof resultado ===
            'object'
            ? resultado
            : {};
    r.dados =
        r.dados &&
            typeof r.dados ===
            'object'
            ? r.dados
            : {};
    r.conteudo =
        r.conteudo &&
            typeof r.conteudo ===
            'object'
            ? r.conteudo
            : {};
    r.dados_a_confirmar =
        Array.isArray(
            r.dados_a_confirmar
        )
            ? r.dados_a_confirmar
            : [];
    for (
        const chave
        of [
            'palavrasChave',
            'beneficios',
            'imagens'
        ]
    ) {
        if (
            !Array.isArray(
                r.conteudo[
                chave
                ]
            )
        ) {
            r.conteudo[chave] =
                r.conteudo[chave]
                    ? [
                        String(
                            r.conteudo[
                            chave
                            ]
                        )
                    ]
                    : [];
        }
    }
    for (
        const chave
        of [
            'titulo',
            'subtitulo',
            'descricao',
            'resumida',
            'marketplace',
            'slug',
            'tituloSeo',
            'meta'
        ]
    ) {
        r.conteudo[chave] =
            String(
                r.conteudo[
                chave
                ] || ''
            ).trim();
    }
    return r;
}
function aplicarLimitesSEO(
    resultado
) {
    const c =
        resultado.conteudo;
    c.tituloSeo =
        cortarNoLimite(
            c.tituloSeo,
            60
        );
    c.meta =
        cortarNoLimite(
            c.meta,
            160
        );
    if (
        c.slug &&
        !c.slug.startsWith('/')
    ) {
        c.slug =
            '/' + c.slug;
    }
}
function cortarNoLimite(
    texto,
    limite
) {
    texto =
        String(
            texto || ''
        ).trim();
    if (
        texto.length <= limite
    ) {
        return texto;
    }
    const cortado =
        texto.slice(
            0,
            limite + 1
        );
    const ultimoEspaco =
        cortado.lastIndexOf(
            ' '
        );
    return (
        ultimoEspaco >
            limite * 0.65
            ? cortado.slice(
                0,
                ultimoEspaco
            )
            : texto.slice(
                0,
                limite
            )
    )
        .trim()
        .replace(
            /[,:;\-–—]+$/,
            ''
        );
}
function contarPalavras(
    texto
) {
    const limpo =
        String(
            texto || ''
        ).trim();
    return limpo
        ? limpo.split(/\s+/)
            .length
        : 0;
}
function extrairTagTitle(
    html
) {
    const match =
        html.match(
            /<title[^>]*>([\s\S]*?)<\/title>/i
        );
    return match
        ? limparTextoHtml(
            match[1]
        )
        : '';
}
function extrairMetaDescription(
    html
) {
    const tags =
        html.match(
            /<meta\b[^>]*>/gi
        ) || [];
    for (
        const tag of tags
    ) {
        const nome =
            atributoHtml(
                tag,
                'name'
            ).toLowerCase();
        const prop =
            atributoHtml(
                tag,
                'property'
            ).toLowerCase();
        if (
            nome ===
            'description' ||
            prop ===
            'og:description'
        ) {
            const conteudo =
                atributoHtml(
                    tag,
                    'content'
                );
            if (conteudo) {
                return decodificarEntidades(
                    conteudo
                ).trim();
            }
        }
    }
    return '';
}
function extrairJsonLd(
    html
) {
    const blocos = [];
    const regex =
        /<script\b[^>]*type=["']application\/ld\\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while (
        (
            match =
            regex.exec(html)
        )
    ) {
        const bruto =
            match[1].trim();
        if (!bruto) {
            continue;
        }
        try {
            blocos.push(
                JSON.parse(
                    bruto
                )
            );
        } catch {
            // Ignora JSON-LD inválido.
        }
    }
    return blocos;
}
function encontrarProdutoJsonLd(
    blocos
) {
    const fila =
        [...blocos];
    while (
        fila.length
    ) {
        const atual =
            fila.shift();
        if (
            Array.isArray(
                atual
            )
        ) {
            fila.push(
                ...atual
            );
            continue;
        }
        if (
            !atual ||
            typeof atual !==
            'object'
        ) {
            continue;
        }
        if (
            tipoIncluiProduto(
                atual['@type']
            )
        ) {
            return reduzirProdutoJsonLd(
                atual
            );
        }
        if (
            Array.isArray(
                atual[
                '@graph'
                ]
            )
        ) {
            fila.push(
                ...atual[
                '@graph'
                ]
            );
        }
    }
    return null;
}
function tipoIncluiProduto(
    tipo
) {
    if (
        Array.isArray(tipo)
    ) {
        return tipo.some(
            tipoIncluiProduto
        );
    }
    return (
        String(
            tipo || ''
        ).toLowerCase() ===
        'product'
    );
}
function reduzirProdutoJsonLd(
    produto
) {
    return {
        name:
            produto.name || '',
        sku:
            produto.sku ||
            produto.mpn ||
            '',
        description:
            limparTextoHtml(
                produto.description ||
                ''
            ),
        category:
            produto.category ||
            '',
        color:
            produto.color ||
            '',
        material:
            produto.material ||
            '',
        brand:
            typeof produto.brand ===
                'object'
                ? produto.brand
                    ?.name || ''
                : produto.brand ||
                '',
        additionalProperty:
            produto.additionalProperty ||
            []
    };
}
function extrairTextoVisivel(
    html
) {
    let texto =
        html
            .replace(
                /<!--[\s\S]*?-->/g,
                ' '
            )
            .replace(
                /<script\b[\s\S]*?<\/script>/gi,
                ' '
            )
            .replace(
                /<style\b[\s\S]*?<\/style>/gi,
                ' '
            )
            .replace(
                /<noscript\b[\s\S]*?<\/noscript>/gi,
                ' '
            )
            .replace(
                /<svg\b[\s\S]*?<\/svg>/gi,
                ' '
            )
            .replace(
                /<header\b[\s\S]*?<\/header>/gi,
                ' '
            )
            .replace(
                /<nav\b[\s\S]*?<\/nav>/gi,
                ' '
            )
            .replace(
                /<footer\b[\s\S]*?<\/footer>/gi,
                ' '
            )
            .replace(
                /<br\s*\/?>/gi,
                '\n'
            )
            .replace(
                /<\/(p|div|section|article|li|h1|h2|h3|h4|tr)>/gi,
                '\n'
            )
            .replace(
                /<[^>]+>/g,
                ' '
            );
    texto =
        decodificarEntidades(
            texto
        )
            .replace(
                /\r/g,
                ''
            )
            .replace(
                /[ \t]+/g,
                ' '
            )
            .replace(
                /\n[ \t]+/g,
                '\n'
            )
            .replace(
                /\n{3,}/g,
                '\n\n'
            )
            .trim();
    return texto;
}
function limparTextoHtml(
    valor
) {
    return decodificarEntidades(
        String(
            valor || ''
        ).replace(
            /<[^>]+>/g,
            ' '
        )
    )
        .replace(
            /\s+/g,
            ' '
        )
        .trim();
}
function atributoHtml(tag, atributo) {
    const regex = new RegExp(`${atributo}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, 'i');
    const match = tag.match(regex);
    return match ? match[2] : '';
}
function decodificarEntidades(
    texto
) {
    const entidades = {
        '&nbsp;': ' ',
        '&amp;': '&',
        '&quot;': '"',
        '&#39;': "'",
        '&apos;': "'",
        '&lt;': '<',
        '&gt;': '>'
    };
    return String(
        texto || ''
    )
        .replace(
            /&(nbsp|amp|quot|apos|lt|gt);|&#39;/gi,
            (match) =>
                entidades[
                match.toLowerCase()
                ] ||
                match
        )
        .replace(
            /&#(\d+);/g,
            (_, numero) =>
                String.fromCodePoint(
                    Number(numero)
                )
        )
        .replace(
            /&#x([0-9a-f]+);/gi,
            (_, numero) =>
                String.fromCodePoint(
                    parseInt(
                        numero,
                        16
                    )
                )
        );
}
function valorFato(
    fato
) {
    if (
        fato &&
        typeof fato ===
        'object' &&
        'valor' in fato
    ) {
        return fato.valor;
    }
    return fato;
}
function normalizarTexto(
    valor
) {
    return String(
        valor || ''
    )
        .normalize('NFD')
        .replace(
            /[\u0300-\u036f]/g,
            ''
        )
        .toLowerCase()
        .replace(
            /[^a-z0-9]+/g,
            ' '
        )
        .replace(
            /\s+/g,
            ' '
        )
        .trim();
}
function mensagemDeErro(erro) {
    if (erro?.statusHttp) return erro.message;
    const info = dadosErro(erro);
    if (info.code === 429) return 'O Gemini atingiu a cota de uso. Verifique os limites no Google AI Studio.';
    if (info.code === 503) return 'O Gemini está com alta demanda no momento. Tente novamente mais tarde.';
    const msg = String(erro?.message || erro || 'Erro desconhecido.');
    if (/fetch failed|HTTP 403|HTTP 404/i.test(msg)) return 'Não foi possível acessar a página do produto. Verifique a URL.';
    if (/aborted|timeout/i.test(msg)) return 'A página ou o Gemini demorou demais para responder.';
    if (/URL|domínios autorizados|página HTML|página do produto/i.test(msg)) return msg;
    return 'Não foi possível gerar o produto. Verifique a URL e tente novamente.';
}