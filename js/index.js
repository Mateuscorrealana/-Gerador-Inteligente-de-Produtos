'use strict';

const CONFIG = {
  endpointIA: '/api/gerar-produtos',
  chaveStorage: 'blive_produtos_v3',
  timeoutMs: 150000
};

const $ = (id) => document.getElementById(id);
const valorDe = (id) => ($(id)?.value || '').trim();

/* Liga um evento sem derrubar o script se o elemento não existir no HTML. */
function ligar(id, evento, funcao) {
  const el = $(id);
  if (el) el.addEventListener(evento, funcao);
  else console.warn(`Elemento #${id} não encontrado no index.html.`);
}

const estado = { entrada: null, conteudo: null, dados: null, avisos: [] };

const SECOES = [
  { id: 'palavras', titulo: '1. Palavras-chave para busca interna' },
  { id: 'beneficios', titulo: '2. Benefícios específicos' },
  { id: 'titulo', titulo: '3. Título da descrição' },
  { id: 'subtitulo', titulo: '4. Subtítulo do produto' },
  { id: 'descricao', titulo: '5. Descrição completa para o site' },
  { id: 'resumida', titulo: '6. Descrição resumida' },
  { id: 'marketplace', titulo: '7. Descrição para marketplaces (Shopee, Mercado Livre e TikTok Shop)' },
  { id: 'tituloSeo', titulo: '8. Título SEO para Google', limite: 60 },
  { id: 'meta', titulo: '9. Meta Description', limite: 160 }
];

/* =========================================================
   ENTRADA
   ========================================================= */
function coletarEntrada() {
  const entrada = {
    url: valorDe('url'),
    nome: valorDe('nome'),
    sku: valorDe('sku'),
    info: valorDe('info')
  };

  if (!entrada.url && !entrada.nome && !entrada.info) {
    mostrarToast('Cole a URL do produto ou abra "Produto novo ou sem URL" e informe os dados.');
    $('url')?.focus();
    return null;
  }

  if (entrada.url) {
    try {
      const u = new URL(entrada.url);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Protocolo inválido');
    } catch {
      mostrarToast('Informe uma URL válida, começando com https://');
      $('url')?.focus();
      return null;
    }
  }
  return entrada;
}

/* =========================================================
   FLUXO PRINCIPAL
   ========================================================= */
async function analisarProduto() {
  const btn = $('btnAnalisar');
  if (!btn || btn.disabled) return;

  const entrada = coletarEntrada();
  if (!entrada) return;

  Object.assign(estado, { entrada, conteudo: null, dados: null, avisos: [] });
  limparProgresso();
  $('resultados')?.classList.add('oculto');
  $('avisos')?.classList.add('oculto');
  $('progresso')?.classList.remove('oculto');

  const textoOriginal = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'ANALISANDO...';
  marcarPasso(0);

  const controle = new AbortController();
  const timer = setTimeout(() => controle.abort(), CONFIG.timeoutMs);

  try {
    const resposta = await fetch(CONFIG.endpointIA, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(entrada),
      signal: controle.signal
    });

    const payload = await resposta.json().catch(() => ({}));

    if (!resposta.ok) {
      if (resposta.status === 404 || resposta.status === 405) {
        throw new Error('A API não respondeu. Abra o site com "vercel dev" (não com Live Server) e confira se o arquivo é api/gerar-produtos.js.');
      }
      throw new Error(payload.erro || `Erro ${resposta.status} ao gerar o produto.`);
    }

    [1, 2, 3, 4].forEach(marcarPasso);

    estado.dados = payload.dados || {};
    estado.conteudo = normalizarConteudo(payload.conteudo || {});
    estado.avisos = Array.isArray(payload.dados_a_confirmar)
      ? payload.dados_a_confirmar
      : Array.isArray(payload.avisos) ? payload.avisos : [];

    renderizarAvisos();
    renderizarResultados();
    marcarPasso(5);

    setTimeout(() => $('progresso')?.classList.add('oculto'), 600);
    $('resultados')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (erro) {
    console.error(erro);
    $('progresso')?.classList.add('oculto');
    mostrarToast(
      erro.name === 'AbortError'
        ? 'A análise demorou demais. Tente novamente.'
        : erro.message || 'Não foi possível gerar o cadastro com IA.'
    );
  } finally {
    clearTimeout(timer);
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
}

/* =========================================================
   NORMALIZAÇÃO E RENDERIZAÇÃO
   ========================================================= */
const texto = (v) => (v == null ? '' : String(v).trim());

function arrayParaTexto(v, separador) {
  if (Array.isArray(v)) {
    return v.map((i) => String(i ?? '').trim()).filter(Boolean).join(separador);
  }
  return texto(v);
}

function normalizarConteudo(c) {
  return {
    palavras: arrayParaTexto(c.palavrasChave || c.palavras, ', '),
    beneficios: arrayParaTexto(c.beneficios, '\n\n'),
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

function renderizarAvisos() {
  const box = $('listaAvisos');
  if (!box) return;
  box.innerHTML = '';
  const avisos = estado.avisos.filter(Boolean);
  $('avisos')?.classList.toggle('oculto', avisos.length === 0);
  avisos.forEach((aviso) => {
    const div = document.createElement('div');
    div.className = 'pendencia';
    div.textContent = '⚠️ ' + (typeof aviso === 'string' ? aviso : aviso.pergunta || aviso.campo || JSON.stringify(aviso));
    box.appendChild(div);
  });
}

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

function renderizarResultados() {
  const wrap = $('listaResultados');
  if (!wrap) return;
  wrap.innerHTML = '';

  SECOES.forEach((secao) => {
    const bloco = document.createElement('div');
    bloco.className = 'secao';
    bloco.innerHTML = '<div class="secao-topo"><h3></h3></div><textarea></textarea><div class="contador"></div>';
    bloco.querySelector('h3').textContent = secao.titulo;

    const ta = bloco.querySelector('textarea');
    ta.id = 'res-' + secao.id;
    ta.value = estado.conteudo?.[secao.id] || '';
    bloco.querySelector('.contador').id = 'cont-' + secao.id;

    bloco.querySelector('.secao-topo').appendChild(
      criarBotao('COPIAR', (ev) => copiarResultado(ta.value, ev.currentTarget))
    );

    ta.addEventListener('input', () => {
      ajustarAltura(ta);
      atualizarContador(secao);
      if (estado.conteudo) estado.conteudo[secao.id] = ta.value;
    });

    wrap.appendChild(bloco);
    ajustarAltura(ta);
  });

  $('resultados')?.classList.remove('oculto');
  SECOES.forEach(atualizarContador);
}

function atualizarContador(secao) {
  const ta = $('res-' + secao.id);
  const c = $('cont-' + secao.id);
  if (!ta || !c) return;

  const n = ta.value.length;
  if (secao.limite) {
    c.textContent = `${n} / ${secao.limite} caracteres${n > secao.limite ? ' (acima do limite!)' : ''}`;
    c.classList.toggle('excedeu', n > secao.limite);
  } else {
    const palavras = ta.value.trim() ? ta.value.trim().split(/\s+/).length : 0;
    c.textContent = `${n} caracteres · ${palavras} palavras`;
  }
}

/* =========================================================
   PROGRESSO E AVISOS NA TELA
   ========================================================= */
function limparProgresso() {
  document.querySelectorAll('.passos li').forEach((li) => li.classList.remove('ok'));
}

function marcarPasso(i) {
  $('passo' + i)?.classList.add('ok');
}

function mostrarToast(mensagem) {
  const t = $('toast');
  if (!t) { alert(mensagem); return; }
  t.textContent = mensagem;
  t.classList.add('visivel');
  clearTimeout(mostrarToast.timer);
  mostrarToast.timer = setTimeout(() => t.classList.remove('visivel'), 4000);
}

/* =========================================================
   COPIAR
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
    setTimeout(() => { botao.textContent = original; botao.classList.remove('copiado'); }, 1400);
  }
}

function copiarTudo() {
  if (!estado.conteudo) return mostrarToast('Gere um produto primeiro.');
  const completo = SECOES.map((s) => `===== ${s.titulo.toUpperCase()} =====\n${$('res-' + s.id)?.value || ''}`).join('\n\n');
  copiarResultado(completo, $('btnCopiarTudo'));
}

/* =========================================================
   SALVAR / CARREGAR / LIMPAR (rascunhos no navegador)
   ========================================================= */
function lerSalvos() {
  try { return JSON.parse(localStorage.getItem(CONFIG.chaveStorage)) || {}; } catch { return {}; }
}

function atualizarListaSalvos(selecionado) {
  const select = $('produtosSalvos');
  if (!select) return;
  const chaves = Object.keys(lerSalvos());
  select.innerHTML = '';
  if (!chaves.length) {
    select.innerHTML = '<option value="">Nenhum produto salvo</option>';
    return;
  }
  select.appendChild(new Option('Selecione um produto salvo', ''));
  chaves.forEach((c) => select.appendChild(new Option(c, c)));
  if (selecionado) select.value = selecionado;
}

function salvarProduto() {
  if (!estado.conteudo || !estado.entrada) return mostrarToast('Gere um produto antes de salvar.');

  const campos = {};
  SECOES.forEach((s) => { campos[s.id] = $('res-' + s.id)?.value || estado.conteudo[s.id] || ''; });

  const nome = estado.dados?.nome || estado.entrada.nome || estado.entrada.url || 'Produto';
  const sku = estado.dados?.sku || estado.entrada.sku || '';
  const chave = sku ? `${sku} – ${nome}` : nome;

  const salvos = lerSalvos();
  salvos[chave] = { entrada: estado.entrada, dados: estado.dados, conteudo: campos, avisos: estado.avisos, salvoEm: new Date().toISOString() };

  try {
    localStorage.setItem(CONFIG.chaveStorage, JSON.stringify(salvos));
    atualizarListaSalvos(chave);
    mostrarToast('Produto salvo no navegador.');
  } catch {
    mostrarToast('Não foi possível salvar o produto no navegador.');
  }
}

function carregarProduto() {
  const salvo = lerSalvos()[$('produtosSalvos')?.value];
  if (!salvo) return mostrarToast('Selecione um produto salvo.');

  estado.entrada = salvo.entrada || {};
  estado.dados = salvo.dados || {};
  estado.conteudo = salvo.conteudo || {};
  estado.avisos = salvo.avisos || [];

  ['url', 'nome', 'sku', 'info'].forEach((id) => { const el = $(id); if (el) el.value = estado.entrada[id] || ''; });
  if ($('entradaManual') && (estado.entrada.nome || estado.entrada.sku || estado.entrada.info)) $('entradaManual').open = true;

  renderizarAvisos();
  renderizarResultados();
  mostrarToast('Produto carregado.');
}

function limparProduto(confirmar = true) {
  if (confirmar && estado.conteudo && !window.confirm('Limpar o produto atual? Os produtos já salvos continuarão disponíveis.')) return;

  ['url', 'nome', 'sku', 'info'].forEach((id) => { const el = $(id); if (el) el.value = ''; });
  if ($('entradaManual')) $('entradaManual').open = false;
  ['progresso', 'avisos', 'resultados'].forEach((id) => $(id)?.classList.add('oculto'));

  Object.assign(estado, { entrada: null, conteudo: null, dados: null, avisos: [] });
  limparProgresso();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* =========================================================
   INICIALIZAÇÃO
   ========================================================= */
window.addEventListener('error', (e) => mostrarToast('Erro no script: ' + e.message));
window.addEventListener('unhandledrejection', (e) => mostrarToast('Erro: ' + (e.reason?.message || e.reason)));

function iniciar() {
  ligar('btnAnalisar', 'click', analisarProduto);
  ligar('btnCopiarTudo', 'click', copiarTudo);
  ligar('btnSalvar', 'click', salvarProduto);
  ligar('btnCarregar', 'click', carregarProduto);
  ligar('btnLimparEntrada', 'click', () => limparProduto(true));
  ligar('btnNovo', 'click', () => limparProduto(true));
  ligar('url', 'keydown', (e) => { if (e.key === 'Enter') analisarProduto(); });
  atualizarListaSalvos();
  console.log('B.live In Pets: gerador com Gemini carregado.');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
else iniciar();