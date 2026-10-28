import { GoogleGenAI } from '@google/genai';

import conhecimento
    from '../data/conhecimento.json'
    with { type: 'json' };

import produtos
    from '../data/produtos.json'
    with { type: 'json' };

const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY
});

const MODEL =
    process.env.GEMINI_MODEL ||
    'gemini-3.8-flash';

const MAX_HTML_CHARS = 2_000_000;

const MAX_PAGE_TEXT_CHARS = 45_000;

const MAX_KB_CHARS = 70_000;

function comTimeout(promessa, ms) {
    let timer;

    const limite = new Promise((_, rejeitar) => {
        timer = setTimeout(
            () => rejeitar(new Error(
                `O Gemini não respondeu em ${ms / 1000}s. Tente novamente ou reduza o tamanho do conteúdo pedido.`
            )),
            ms
        );
    });

    return Promise.race([promessa, limite]).finally(() => clearTimeout(timer));
}

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

export default async function handler(
    req,
    res
) {
    if (req.method !== 'POST') {
        return res.status(405).json({
            sucesso: false,
            erro:
                'Use uma requisição POST.'
        });
    }

    try {
        if (
            !process.env.GEMINI_API_KEY
        ) {
            return res.status(500).json({
                sucesso: false,

                erro:
                    'GEMINI_API_KEY não está configurada no servidor.'
            });
        }

        const entrada =
            normalizarEntrada(
                req.body || {}
            );

        if (
            !entrada.url &&
            !entrada.nome &&
            !entrada.info
        ) {
            return res.status(400).json({
                sucesso: false,

                erro:
                    'Informe a URL do produto ou dados manuais de um produto novo.'
            });
        }

        const pagina =
            entrada.url
                ? await buscarPaginaProduto(
                    entrada.url
                )
                : null;

        const base = {
            conhecimento,
            produtos
        };

        const contexto =
            montarContexto({
                entrada,
                pagina,
                base
            });

        console.log('1. Página lida. Enviando para o Gemini...');

        console.time('gemini');

        const resultado =
            normalizarResultado(
                await gerarCadastro(contexto)
            );

        console.timeEnd('gemini');

        console.log('2. Gemini respondeu. Preparando resultado...');

        aplicarLimitesSEO(
            resultado
        );

        return res
            .status(200)
            .json(resultado);
    } catch (erro) {
        console.error(
            'Erro ao gerar produto:',
            erro
        );

        return res
            .status(500)
            .json({
                sucesso: false,

                erro:
                    mensagemDeErro(
                        erro
                    )
            });
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

const MODELOS = [...new Set([
    MODEL,
    'gemini-3.7-flash',
    'gemini-3.5-flash',
    'gemini-flash-latest'
])];

const ORCAMENTO_TOTAL_MS = 140_000;

const TIMEOUT_TENTATIVA_MS = 60_000;

const INSTRUCAO_JSON = `

FORMATO DE SAÍDA:

Responda somente com um objeto JSON válido que siga exatamente este esquema:

${JSON.stringify(RESPONSE_SCHEMA)}
`;

/*
 * Usa a API estável generateContent (a chamada "interactions"
 * ficava sem responder). O modo completo envia o esquema JSON e
 * pensamento baixo; o modo simples só pede JSON e descreve o
 * esquema no texto, para funcionar mesmo se o modelo recusar algum parâmetro.
 */
async function chamarGemini(
    modelo,
    prompt,
    modoCompleto,
    limiteMs
) {
    const config = {
        systemInstruction:
            SISTEMA_BLIVE + INSTRUCAO_JSON,

        responseMimeType:
            'application/json',

        maxOutputTokens:
            5000
    };

    if (modoCompleto) {
        config.responseJsonSchema =
            RESPONSE_SCHEMA;

        config.thinkingConfig = {
            thinkingLevel: 'LOW'
        };
    }

    const resposta = await comTimeout(
        ai.models.generateContent({
            model: modelo,

            contents: prompt,

            config
        }),

        limiteMs
    );

    return JSON.parse(
        resposta.text
    );
}

async function gerarCadastro(
    contexto
) {
    const prompt = criarPromptPrincipal(contexto);

    console.log(`Prompt: ${prompt.length} caracteres`);

    const inicio = Date.now();

    let ultimoErro;

    for (const modelo of MODELOS) {
        for (const modoCompleto of [true, false]) {
            const restante =
                ORCAMENTO_TOTAL_MS - (Date.now() - inicio);

            if (restante < 15_000) {
                throw ultimoErro || new Error('Tempo esgotado ao chamar o Gemini.');
            }

            try {
                console.log(
                    `Tentando ${modelo} (${modoCompleto ? 'com esquema e pensamento baixo' : 'modo simples'})...`
                );

                const resultado = await chamarGemini(
                    modelo,
                    prompt,
                    modoCompleto,
                    Math.min(TIMEOUT_TENTATIVA_MS, restante)
                );

                console.log(
                    `OK com ${modelo} em ${((Date.now() - inicio) / 1000).toFixed(1)}s`
                );

                return resultado;
            } catch (erro) {
                ultimoErro = erro;

                const msg = String(erro?.message || erro);

                console.warn(
                    `Falha com ${modelo}: ${msg.slice(0, 200)}`
                );

                // Travou ou o modelo está sobrecarregado: vai para o próximo modelo.
                if (/não respondeu|503|UNAVAILABLE|high demand|429|RESOURCE_EXHAUSTED/i.test(msg)) {
                    break;
                }
            }
        }
    }

    throw ultimoErro || new Error('Nenhum modelo respondeu.');
}

async function aprofundarCadastro(
    contexto,
    atual
) {
    const prompt = `
Reescreva o cadastro abaixo para aumentar a profundidade e a qualidade, preservando todos os fatos e sem inventar informações técnicas.

O resultado anterior ficou curto em pelo menos uma seção.

Cumpra rigorosamente estas faixas quando houver informação suficiente:

- descrição completa: 450 a 700 palavras;
- descrição resumida: 120 a 200 palavras;
- marketplace: 250 a 400 palavras;
- benefícios: 5 a 8 itens, cada um desenvolvido com benefício + explicação prática.

Não repita frases apenas para alcançar tamanho.

Acrescente contexto útil, intenção de compra, conforto, funcionalidade, design, uso, modelagem e diferenciais SOMENTE quando sustentados pelas fontes.

CONTEXTO ORIGINAL:

${JSON.stringify(
        contexto
    )}

RESULTADO A APROFUNDAR:

${JSON.stringify(
        atual
    )}
`;

    const interaction =
        await ai.interactions.create({
            model: MODEL,

            store: false,

            system_instruction:
                SISTEMA_BLIVE,

            input: prompt,

            generation_config: {
                max_output_tokens:
                    7500,

                thinking_level:
                    'low'
            },

            response_format: [
                {
                    type: 'text',

                    mime_type:
                        'application/json',

                    schema:
                        RESPONSE_SCHEMA
                }
            ]
        });

    return JSON.parse(
        interaction.output_text
    );
}

function criarPromptPrincipal(
    contexto
) {
    return `
Crie o cadastro completo deste produto B.live In Pets usando SOMENTE as fontes fornecidas abaixo.

===== ENTRADA DO USUÁRIO =====

${JSON.stringify(
        contexto.entrada,
        null,
        2
    )}

===== CONTEÚDO EXTRAÍDO DA PÁGINA =====

${JSON.stringify(
        contexto.pagina,
        null,
        2
    )}

===== BANCO DE CONHECIMENTO B.LIVE =====

${JSON.stringify(
        contexto.baseConhecimento,
        null,
        2
    )}

===== PADRÃO DE ENTREGA =====


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
+
IMPACTO PRÁTICO
+
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

function precisaAprofundar(
    resultado
) {
    const c =
        resultado?.conteudo ||
        {};

    return (
        contarPalavras(
            c.descricao
        ) < 380 ||

        contarPalavras(
            c.resumida
        ) < 90 ||

        contarPalavras(
            c.marketplace
        ) < 180 ||

        (
            Array.isArray(
                c.beneficios
            ) &&
            c.beneficios.length < 5
        )
    );
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
        /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

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

function atributoHtml(
    tag,
    atributo
) {
    const regex =
        new RegExp(
            `${atributo}\\s*=\\s*(["'])([\\s\\S]*?)\\1`,
            'i'
        );

    const match =
        tag.match(regex);

    return match
        ? match[2]
        : '';
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

function mensagemDeErro(
    erro
) {
    const msg =
        String(
            erro?.message ||
            erro ||
            'Erro desconhecido.'
        );

    if (/503|UNAVAILABLE|high demand/i.test(msg)) {
        return 'O Gemini está com alta demanda no momento. Tente novamente em instantes.';
    }

    if (
        msg.includes(
            'fetch failed'
        )
    ) {
        return (
            'Não foi possível acessar a página informada. ' +
            'Verifique se a URL está pública e tente novamente.'
        );
    }

    if (
        msg.includes(
            'aborted'
        ) ||
        msg.includes(
            'timeout'
        )
    ) {
        return (
            'A página demorou demais para responder. ' +
            'Tente novamente.'
        );
    }

    if (
        msg.includes('JSON')
    ) {
        return (
            'O Gemini respondeu em um formato inesperado. ' +
            'Tente gerar novamente.'
        );
    }

    return msg;
}