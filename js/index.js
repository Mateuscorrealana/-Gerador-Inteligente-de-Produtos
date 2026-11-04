
'use strict';

const CONFIG = {
  endpointIA: '/api/gerar-produtos',
  chaveStorage: 'blive_produtos_v3',
  timeoutMs: 150000
};

const $ = (id) => document.getElementById(id);
const valorDe = (id) => ($(id)?.value || '').trim();

function ligar(id, evento, funcao) {
  const el = $(id);

  if (el) {
    el.addEventListener(evento, funcao);
  } else {
    console.warn(`Elemento #${id} não encontrado no index.html.`);
  }
}

const estado = {
  entrada: null,
  conteudo: null,
  dados: null
};

const SECOES = [
  { id: 'palavras', titulo: '1. Palavras-chave para busca interna' },
  { id: 'beneficios', titulo: '2. Benefícios específicos' },
  { id: 'titulo', titulo: '3. Título da descrição' },
  { id: 'subtitulo', titulo: '4. Subtítulo do produto' },
  { id: 'descricao', titulo: '5. Descrição completa para o site' },
  { id: 'resumida', titulo: '6. Descrição resumida' },
  {
    id: 'marketplace',
    titulo: '7. Descrição para marketplaces (Shopee, Mercado Livre e TikTok Shop)'
  },
  {
    id: 'tituloSeo',
    titulo: '8. Título SEO para Google',
    limite: 60
  },
  {
    id: 'meta',
    titulo: '9. Meta Description',
    limite: 160
  }
];


/* =========================================================
   ENTRADA DO PRODUTO
   ========================================================= */

function coletarEntrada() {
  const entrada = {
    url: valorDe('url'),
    nome: valorDe('nome'),
    sku: valorDe('sku'),
    info: valorDe('info')
  };

  if (!entrada.url && !entrada.nome && !entrada.info) {
    mostrarToast('Cole a URL do produto da B.live.');
    $('url')?.focus();
    return null;
  }

  if (entrada.url) {
    try {
      const u = new URL(entrada.url);

      if (!['http:', 'https:'].includes(u.protocol)) {
        throw new Error('Protocolo inválido');
      }
    } catch {
      mostrarToast('Informe uma URL válida, começando com https://');
      $('url')?.focus();
      return null;
    }
  }

  return entrada;
}


/* =========================================================
   GERAR PRODUTO COM GEMINI
   ========================================================= */

async function analisarProduto() {
  const btn = $('btnAnalisar');

  if (!btn || btn.disabled) return;

  const entrada = coletarEntrada();
  if (!entrada) return;

  Object.assign(estado, {
    entrada,
    conteudo: null,
    dados: null
  });

  limparProgresso();

  if ($('tituloProgresso')) {
    $('tituloProgresso').textContent = 'ANALISANDO PRODUTO...';
  }

  $('resultados')?.classList.add('oculto');
  $('progresso')?.classList.remove('oculto');

  const textoOriginal = btn.textContent;

  btn.disabled = true;
  btn.textContent = 'ANALISANDO...';

  const controle = new AbortController();

  const timer = setTimeout(
    () => controle.abort(),
    CONFIG.timeoutMs
  );

  try {
    const resposta = await fetch(CONFIG.endpointIA, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/x-ndjson'
      },
      body: JSON.stringify(entrada),
      signal: controle.signal
    });

    if (resposta.status === 404 || resposta.status === 405) {
      throw new Error(
        'A API não respondeu. Execute o projeto com vercel dev e confira api/gerar-produtos.js.'
      );
    }

    let payload;

    const contentType =
      resposta.headers.get('content-type') || '';

    if (contentType.includes('application/x-ndjson')) {
      payload = await lerRespostaEmEtapas(resposta);
    } else {
      payload = await resposta.json().catch(() => ({}));

      if (!resposta.ok) {
        throw new Error(
          payload.erro ||
          `Erro ${resposta.status} ao gerar o produto.`
        );
      }

      marcarPasso(0);
    }

    if (!resposta.ok) {
      throw new Error(
        payload?.erro ||
        `Erro ${resposta.status} ao gerar o produto.`
      );
    }

    if (!payload?.conteudo || !payload?.dados) {
      throw new Error(
        'A API não retornou os dados do produto.'
      );
    }

    marcarPasso(0);

    estado.dados = payload.dados;
    estado.conteudo = normalizarConteudo(payload.conteudo);

    renderizarResultados();

    marcarPasso(1);

    if ($('tituloProgresso')) {
      $('tituloProgresso').textContent = 'CADASTRO GERADO!';
    }

    $('resultados')?.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });

  } catch (erro) {
    console.error('Falha na geração:', erro);

    if ($('tituloProgresso')) {
      $('tituloProgresso').textContent =
        'NÃO FOI POSSÍVEL CONCLUIR';
    }

    mostrarToast(
      erro.name === 'AbortError'
        ? 'A análise demorou demais. Tente novamente.'
        : erro.message ||
          'Não foi possível gerar o cadastro com IA.'
    );

  } finally {
    clearTimeout(timer);

    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}


/* =========================================================
   RESPOSTA EM ETAPAS DA API
   ========================================================= */

async function lerRespostaEmEtapas(resposta) {
  if (!resposta.body) {
    throw new Error(
      'O navegador não recebeu o conteúdo da API.'
    );
  }

  const leitor = resposta.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  let resultado = null;

  function processarLinha(linha) {
    if (!linha.trim()) return;

    let evento;

    try {
      evento = JSON.parse(linha);
    } catch {
      throw new Error(
        'A API retornou uma resposta incompleta.'
      );
    }

    if (evento.etapa === 'pagina_lida') {
      marcarPasso(0);
    } else if (evento.etapa === 'pronto') {
      resultado = evento.resultado;
    } else if (evento.etapa === 'erro') {
      throw new Error(
        evento.erro || 'Erro ao gerar produto.'
      );
    }
  }

  try {
    for (;;) {
      const { value, done } = await leitor.read();

      if (done) break;

      buffer += decoder.decode(value, {
        stream: true
      });

      let posicao;

      while ((posicao = buffer.indexOf('\n')) >= 0) {
        processarLinha(buffer.slice(0, posicao));
        buffer = buffer.slice(posicao + 1);
      }
    }

    buffer += decoder.decode();

    if (buffer.trim()) {
      processarLinha(buffer);
    }

    if (!resultado) {
      throw new Error(
        'A conexão terminou antes de gerar o produto.'
      );
    }

    return resultado;

  } finally {
    leitor.releaseLock();
  }
}


/* =========================================================
   NORMALIZAÇÃO DOS RESULTADOS
   ========================================================= */

const texto = (v) =>
  v == null ? '' : String(v).trim();

function arrayParaTexto(v, separador) {
  if (Array.isArray(v)) {
    return v
      .map((i) => String(i ?? '').trim())
      .filter(Boolean)
      .join(separador);
  }

  return texto(v);
}

function normalizarConteudo(c) {
  return {
    palavras: arrayParaTexto(
      c.palavrasChave || c.palavras,
      ', '
    ),
    beneficios: arrayParaTexto(
      c.beneficios,
      '\n\n'
    ),
    titulo: texto(c.titulo),
    subtitulo: texto(c.subtitulo),
    descricao: texto(c.descricao),
    resumida: texto(c.resumida),
    marketplace: texto(c.marketplace),
    imagens: arrayParaTexto(c.imagens, '\n'),
    slug: texto(c.slug),
    tituloSeo: texto(c.tituloSeo),
    meta: texto(c.meta)
  };
}


/* =========================================================
   BOTÕES DOS RESULTADOS
   ========================================================= */

function criarBotao(rotulo, acao) {
  const b = document.createElement('button');

  b.type = 'button';
  b.className = 'btn pequeno';
  b.textContent = rotulo;

  b.addEventListener('click', acao);

  return b;
}

function ajustarAltura(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 6 + 'px';
}


/* =========================================================
   RENDERIZAÇÃO DOS RESULTADOS
   ========================================================= */

function renderizarResultados() {
  const wrap = $('listaResultados');

  if (!wrap) return;

  wrap.innerHTML = '';

  SECOES.forEach((secao) => {
    const bloco = document.createElement('div');

    bloco.className = 'secao';

    bloco.innerHTML = `
      <div class="secao-topo">
        <h3></h3>
      </div>
      <textarea></textarea>
      <div class="contador"></div>
    `;

    bloco.querySelector('h3').textContent =
      secao.titulo;

    const ta = bloco.querySelector('textarea');

    ta.id = 'res-' + secao.id;
    ta.value = estado.conteudo?.[secao.id] || '';

    bloco.querySelector('.contador').id =
      'cont-' + secao.id;

    bloco.querySelector('.secao-topo').appendChild(
      criarBotao(
        'COPIAR',
        (ev) => copiarResultado(
          ta.value,
          ev.currentTarget
        )
      )
    );

    ta.addEventListener('input', () => {
      ajustarAltura(ta);
      atualizarContador(secao);

      if (estado.conteudo) {
        estado.conteudo[secao.id] = ta.value;
      }
    });

    wrap.appendChild(bloco);
    ajustarAltura(ta);
  });

  $('resultados')?.classList.remove('oculto');

  SECOES.forEach(atualizarContador);
}


/* =========================================================
   CONTADOR DE CARACTERES
   ========================================================= */

function atualizarContador(secao) {
  const ta = $('res-' + secao.id);
  const c = $('cont-' + secao.id);

  if (!ta || !c) return;

  const n = ta.value.length;

  if (secao.limite) {
    c.textContent =
      `${n} / ${secao.limite} caracteres` +
      (n > secao.limite ? ' (acima do limite!)' : '');

    c.classList.toggle(
      'excedeu',
      n > secao.limite
    );

  } else {
    const palavras = ta.value.trim()
      ? ta.value.trim().split(/\s+/).length
      : 0;

    c.textContent =
      `${n} caracteres · ${palavras} palavras`;
  }
}


/* =========================================================
   PROGRESSO — APENAS PASSOS 0 E 1
   ========================================================= */

function limparProgresso() {
  document
    .querySelectorAll('.passos li')
    .forEach((li) => {
      li.classList.remove('ok');
      li.removeAttribute('aria-label');
    });
}

function marcarPasso(i) {
  if (i !== 0 && i !== 1) return;

  const passo = $('passo' + i);

  if (passo) {
    passo.classList.add('ok');

    passo.setAttribute(
      'aria-label',
      passo.textContent.trim() + ' — concluído'
    );
  }
}


/* =========================================================
   NOTIFICAÇÕES
   ========================================================= */

function mostrarToast(mensagem) {
  const t = $('toast');

  if (!t) {
    console.warn(mensagem);
    return;
  }

  t.textContent = mensagem;
  t.classList.add('visivel');

  clearTimeout(mostrarToast.timer);

  mostrarToast.timer = setTimeout(() => {
    t.classList.remove('visivel');
  }, 4000);
}


/* =========================================================
   COPIAR RESULTADOS
   ========================================================= */

async function copiarResultado(valor, botao) {
  try {
    await navigator.clipboard.writeText(valor);

  } catch {
    const ta = document.createElement('textarea');

    ta.value = valor;
    document.body.appendChild(ta);
    ta.select();

    document.execCommand('copy');
    ta.remove();
  }

  mostrarToast('Copiado!');

  if (botao) {
    const original = botao.textContent;

    botao.textContent = 'COPIADO ✓';
    botao.classList.add('copiado');

    setTimeout(() => {
      botao.textContent = original;
      botao.classList.remove('copiado');
    }, 1400);
  }
}

function copiarTudo() {
  if (!estado.conteudo) {
    return mostrarToast('Gere um produto primeiro.');
  }

  const completo = SECOES.map((s) => {
    return (
      `===== ${s.titulo.toUpperCase()} =====\n` +
      ($('res-' + s.id)?.value || '')
    );
  }).join('\n\n');

  copiarResultado(
    completo,
    $('btnCopiarTudo')
  );
}


/* =========================================================
   BIBLIOTECA — PRODUTOS SALVOS
   ========================================================= */

function lerSalvos() {
  try {
    return (
      JSON.parse(
        localStorage.getItem(CONFIG.chaveStorage)
      ) || {}
    );
  } catch {
    return {};
  }
}

function atualizarListaSalvos(selecionado) {
  const select = $('produtosSalvos');

  if (!select) return;

  const chaves = Object.keys(lerSalvos());

  select.innerHTML = '';

  if (!chaves.length) {
    select.innerHTML =
      '<option value="">Nenhum produto salvo</option>';
    return;
  }

  select.appendChild(
    new Option('Selecione um produto salvo', '')
  );

  chaves.forEach((c) => {
    select.appendChild(
      new Option(c, c)
    );
  });

  if (selecionado) {
    select.value = selecionado;
  }
}


/* =========================================================
   SALVAR PRODUTO
   ========================================================= */

function salvarProduto() {
  if (!estado.conteudo || !estado.entrada) {
    return mostrarToast(
      'Gere um produto antes de salvar.'
    );
  }

  const campos = {};

  SECOES.forEach((s) => {
    campos[s.id] =
      $('res-' + s.id)?.value ||
      estado.conteudo[s.id] ||
      '';
  });

  const nome =
    estado.dados?.nome ||
    estado.entrada.nome ||
    estado.entrada.url ||
    'Produto';

  const sku =
    estado.dados?.sku ||
    estado.entrada.sku ||
    '';

  const chave = sku
    ? `${sku} – ${nome}`
    : nome;

  const salvos = lerSalvos();

  salvos[chave] = {
    entrada: estado.entrada,
    dados: estado.dados,
    conteudo: campos,
    salvoEm: new Date().toISOString()
  };

  try {
    localStorage.setItem(
      CONFIG.chaveStorage,
      JSON.stringify(salvos)
    );

    atualizarListaSalvos(chave);

    mostrarToast('Produto salvo no navegador.');

  } catch {
    mostrarToast(
      'Não foi possível salvar o produto no navegador.'
    );
  }
}


/* =========================================================
   CARREGAR PRODUTO
   ========================================================= */

function carregarProduto() {
  const salvo = lerSalvos()[
    $('produtosSalvos')?.value
  ];

  if (!salvo) {
    return mostrarToast(
      'Selecione um produto salvo.'
    );
  }

  estado.entrada = salvo.entrada || {};
  estado.dados = salvo.dados || {};
  estado.conteudo = salvo.conteudo || {};

  ['url', 'nome', 'sku', 'info'].forEach((id) => {
    const el = $(id);

    if (el) {
      el.value = estado.entrada[id] || '';
    }
  });

  if (
    $('entradaManual') &&
    (
      estado.entrada.nome ||
      estado.entrada.sku ||
      estado.entrada.info
    )
  ) {
    $('entradaManual').open = true;
  }

  renderizarResultados();

  mostrarToast('Produto carregado.');
}


/* =========================================================
   LIMPAR PRODUTO
   ========================================================= */

function limparProduto(
  confirmar = true,
  rolarTopo = true
) {
  if (
    confirmar &&
    estado.conteudo &&
    !window.confirm(
      'Limpar o produto atual? Os produtos já salvos continuarão disponíveis.'
    )
  ) {
    return false;
  }

  ['url', 'nome', 'sku', 'info'].forEach((id) => {
    const el = $(id);

    if (el) {
      el.value = '';
    }
  });

  if ($('entradaManual')) {
    $('entradaManual').open = false;
  }

  ['progresso', 'resultados'].forEach((id) => {
    $(id)?.classList.add('oculto');
  });

  Object.assign(estado, {
    entrada: null,
    conteudo: null,
    dados: null
  });

  limparProgresso();

  if ($('tituloProgresso')) {
    $('tituloProgresso').textContent =
      'ANALISANDO PRODUTO...';
  }

  if (rolarTopo) {
    window.scrollTo({
      top: 0,
      behavior: 'smooth'
    });
  }

  return true;
}


/* =========================================================
   NOVO PRODUTO — BOTÃO DO HEADER
   ========================================================= */

function novoProduto() {

  // Impede limpar enquanto o Gemini está gerando.
  if ($('btnAnalisar')?.disabled) {
    mostrarToast(
      'Aguarde a análise terminar antes de iniciar outro produto.'
    );
    return;
  }

  // Verifica se existe conteúdo ou dados preenchidos.
  const possuiCadastroAberto = Boolean(
    estado.conteudo ||
    ['url', 'nome', 'sku', 'info'].some(
      (id) => valorDe(id)
    )
  );

  // Confirma antes de descartar o cadastro atual.
  if (possuiCadastroAberto) {
    const confirmou = window.confirm(
      'Deseja iniciar um novo produto?\n\n' +
      'As alterações não salvas serão perdidas.'
    );

    if (!confirmou) return;
  }

  // Limpa o cadastro, preservando a biblioteca.
  limparProduto(false, false);

  // Leva automaticamente ao formulário.
  const entrada = $('entrada');
  const url = $('url');

  if (entrada) {
    entrada.scrollIntoView({
      behavior: 'smooth',
      block: 'start'
    });
  }

  // Posiciona o cursor para digitar a nova URL.
  if (url) {
    url.focus({
      preventScroll: true
    });
  }
}


/* =========================================================
   TRATAMENTO DE ERROS
   ========================================================= */

window.addEventListener('error', (e) => {
  mostrarToast(
    'Erro no script: ' + e.message
  );
});

window.addEventListener('unhandledrejection', (e) => {
  mostrarToast(
    'Erro: ' +
    (e.reason?.message || e.reason)
  );
});


/* =========================================================
   INICIALIZAÇÃO DO SISTEMA
   ========================================================= */

function iniciar() {

  // Gerador de produtos
  ligar(
    'btnAnalisar',
    'click',
    analisarProduto
  );

  // Copiar os resultados
  ligar(
    'btnCopiarTudo',
    'click',
    copiarTudo
  );

  // Biblioteca
  ligar(
    'btnSalvar',
    'click',
    salvarProduto
  );

  ligar(
    'btnCarregar',
    'click',
    carregarProduto
  );

  // Limpeza manual
  ligar(
    'btnLimparEntrada',
    'click',
    () => limparProduto(true)
  );

  // BOTÃO NOVO PRODUTO DO HEADER
  ligar(
    'btnNovo',
    'click',
    novoProduto
  );

  // Gerar pressionando Enter no campo URL
  ligar('url', 'keydown', (e) => {
    if (e.key === 'Enter') {
      analisarProduto();
    }
  });

  // Carrega os produtos salvos na biblioteca
  atualizarListaSalvos();

  console.log(
    'B.live In Pets: Gerador Inteligente carregado.'
  );
}


// Inicializa quando o HTML estiver pronto.
if (document.readyState === 'loading') {
  document.addEventListener(
    'DOMContentLoaded',
    iniciar
  );
} else {
  iniciar();
}
