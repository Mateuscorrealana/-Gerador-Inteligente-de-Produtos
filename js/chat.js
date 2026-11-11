
'use strict';

import {
  auth,
  db,
  googleProvider
} from './firebase.config.js';


// ========================================
// PERFIL GOOGLE DO OUTRO PARTICIPANTE
// ========================================

const CONTAS_CHAT = [
  'bliveinpets25@gmail.com',
  'comercial@blive.com.br'
];

let cancelarEscutaPerfil = null;

function validarFoto(url) {
  try {
    const endereco = new URL(url);

    return endereco.protocol === 'https:'
      ? endereco.href
      : '';
  } catch {
    return '';
  }
}

function mostrarPerfilContato(nome, fotoURL) {
  const titulo = $('roomTitle');
  const foto = $('contactPhoto');
  const fallback = $('contactFallback');

  const nomeSeguro = nome || 'Outro participante';
  const urlSegura = validarFoto(fotoURL);

  titulo.textContent = nomeSeguro;

  fallback.textContent = nomeSeguro
    .trim()
    .charAt(0)
    .toUpperCase() || '?';

  foto.onerror = () => {
    foto.hidden = true;
    fallback.hidden = false;
  };

  if (urlSegura) {
    foto.src = urlSegura;
    foto.hidden = false;
    fallback.hidden = true;
  } else {
    foto.removeAttribute('src');
    foto.hidden = true;
    fallback.hidden = false;
  }
}

function sincronizarPerfilGoogle(usuario) {
  if (cancelarEscutaPerfil) {
    cancelarEscutaPerfil();
    cancelarEscutaPerfil = null;
  }

  if (!usuario?.email) return;

  const emailAtual = usuario.email.toLowerCase();

  if (!CONTAS_CHAT.includes(emailAtual)) {
    return;
  }

  const outroEmail = CONTAS_CHAT.find(
    email => email !== emailAtual
  );

  // Obtém nome e foto do próprio login Google.
  const perfilGoogle = usuario.providerData.find(
    perfil => perfil.providerId === 'google.com'
  );

  const nome = (
    usuario.displayName ||
    perfilGoogle?.displayName ||
    emailAtual
  ).slice(0, 100);

  const fotoURL = validarFoto(
    usuario.photoURL ||
    perfilGoogle?.photoURL ||
    ''
  );

  // Salva somente o próprio perfil.
  setDoc(
    doc(db, 'perfis', emailAtual),
    {
      email: emailAtual,
      nome,
      fotoURL,
      atualizadoEm: serverTimestamp()
    }
  ).catch(erro => {
    console.error(
      'Erro ao salvar perfil Google:',
      erro
    );
  });

  mostrarPerfilContato('Carregando contato...', '');

  // Acompanha o perfil da outra conta.
  cancelarEscutaPerfil = onSnapshot(
    doc(db, 'perfis', outroEmail),

    snapshot => {
      if (!snapshot.exists()) {
        mostrarPerfilContato(
          'Aguardando primeiro acesso...',
          ''
        );

        return;
      }

      const perfil = snapshot.data();

      mostrarPerfilContato(
        perfil.nome,
        perfil.fotoURL
      );
    },

    erro => {
      console.error(
        'Erro ao buscar perfil do contato:',
        erro
      );

      mostrarPerfilContato(
        'Perfil indisponível',
        ''
      );
    }
  );
}

import {
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

const CAMINHO = ['salas', 'geral', 'mensagens'];

const LIMITE_HISTORICO = 100;

let usuarioAtual = null;
let mensagensAtuais = [];
let cancelarEscuta = null;
let mensagemRespondida = null;
let enviando = false;

const excluindo = new Set();

let temporizadorToast = null;


/* =========================================================
   NOTIFICAÇÕES
   ========================================================= */

function mostrarToast(mensagem) {

  const elemento = $('chatToast');

  if (!elemento) return;

  elemento.textContent = mensagem;

  elemento.classList.add('mostrar');

  clearTimeout(temporizadorToast);

  temporizadorToast = setTimeout(() => {
    elemento.classList.remove('mostrar');
  }, 4000);
}


/* =========================================================
   STATUS DA CONEXÃO
   ========================================================= */

function definirStatus(rotulo, tipo = '') {

  const elemento = $('chatStatus');

  if (!elemento) return;

  const texto = elemento.querySelector('.status-text');

  if (texto) {
    texto.textContent = rotulo;
  }

  elemento.dataset.estado = tipo;
}


/* =========================================================
   LOGIN E CHAT
   ========================================================= */

function exibirLogin(mensagem) {

  $('authPanel').hidden = false;

  $('chatApp').hidden = true;

  $('authInfo').textContent = mensagem;
}

function exibirChat() {

  $('authPanel').hidden = true;

  $('chatApp').hidden = false;
}


/* =========================================================
   SINCRONIZAÇÃO
   ========================================================= */

function pararEscuta() {

  if (cancelarEscuta) {

    cancelarEscuta();

    cancelarEscuta = null;
  }

  mensagensAtuais = [];
}


/* =========================================================
   FORMATAÇÃO
   ========================================================= */

function formatarHora(timestamp) {

  const data = timestamp?.toDate?.();

  return data
    ? data.toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit'
    })
    : 'Enviando…';
}

function encurtar(texto, tamanho = 180) {

  const valor = String(texto || '')
    .replace(/\s+/g, ' ')
    .trim();

  return valor.length > tamanho
    ? valor.slice(0, tamanho - 1) + '…'
    : valor;
}

function buscarMensagem(id) {

  return mensagensAtuais.find(
    (item) => item.id === id
  ) || null;
}


/* =========================================================
   CRIAR ÍCONES SVG
   ========================================================= */

function criarIcone(idIcone) {

  const svg = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'svg'
  );

  svg.setAttribute('class', 'ico');

  svg.setAttribute('aria-hidden', 'true');

  const use = document.createElementNS(
    'http://www.w3.org/2000/svg',
    'use'
  );

  use.setAttribute('href', '#' + idIcone);

  svg.appendChild(use);

  return svg;
}


/* =========================================================
   RESPONDER UMA MENSAGEM
   ========================================================= */

function atualizarBarraResposta() {

  const barra = $('replyPreview');

  if (!mensagemRespondida) {
    barra.hidden = true;
    return;
  }

  const original = buscarMensagem(mensagemRespondida.id);

  barra.hidden = false;

  $('replyAuthor').textContent = original
    ? 'Respondendo a ' + (
      original.autorUid === usuarioAtual?.uid
        ? 'você'
        : (original.autorNome || 'colaborador')
    )
    : 'Respondendo a uma mensagem';

  $('replyText').textContent = original
    ? encurtar(original.texto, 165)
    : 'Mensagem original excluída ou fora do histórico recente';
}

function selecionarResposta(item) {

  mensagemRespondida = {
    id: item.id
  };

  atualizarBarraResposta();

  $('messageInput').focus({
    preventScroll: true
  });

  $('composer').scrollIntoView({
    behavior: 'smooth',
    block: 'nearest'
  });
}

function cancelarResposta() {

  mensagemRespondida = null;

  atualizarBarraResposta();
}


/* =========================================================
   IR ATÉ A MENSAGEM ORIGINAL
   ========================================================= */

function irParaMensagem(id) {

  const busca = $('messageSearch');

  if (busca.value) {

    busca.value = '';

    renderizar();
  }

  const original = document.getElementById(
    'msg-' + id
  );

  if (!original) {

    mostrarToast(
      'A mensagem original foi excluída ou está fora das últimas 100.'
    );

    return;
  }

  original.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });

  original.classList.add('mensagem-destacada');

  setTimeout(() => {
    original.classList.remove('mensagem-destacada');
  }, 1800);
}


/* =========================================================
   BOTÕES DE AÇÃO — SOMENTE ÍCONES
   ========================================================= */

function criarBotaoAcao(
  rotulo,
  icone,
  acao,
  extra = ''
) {

  const botao = document.createElement('button');

  botao.type = 'button';

  botao.className =
    'acao-mensagem' +
    (extra ? ' ' + extra : '');

  // Nome para acessibilidade.
  botao.setAttribute(
    'aria-label',
    rotulo
  );

  // Nome exibido ao passar o mouse.
  botao.title = rotulo;

  // Adiciona apenas o ícone SVG.
  // Não cria texto dentro do botão.
  botao.appendChild(
    criarIcone(icone)
  );

  botao.addEventListener('click', acao);

  return botao;
}


/* =========================================================
   CITAÇÃO DE UMA MENSAGEM
   ========================================================= */

function criarCitacao(idOriginal) {

  const original = buscarMensagem(idOriginal);

  const botao = document.createElement('button');

  botao.type = 'button';

  botao.className = 'citacao-mensagem';

  botao.title = 'Ir para a mensagem original';

  const autor = document.createElement('strong');

  const resumo = document.createElement('span');

  autor.textContent = original
    ? (
      original.autorUid === usuarioAtual?.uid
        ? 'Você'
        : (original.autorNome || 'Colega')
    )
    : 'Mensagem anterior';

  resumo.textContent = original
    ? encurtar(original.texto, 140)
    : 'Mensagem excluída ou fora das últimas 100';

  botao.append(autor, resumo);

  botao.addEventListener('click', () => {
    irParaMensagem(idOriginal);
  });

  return botao;
}


/* =========================================================
   CRIAR BALÃO DE MENSAGEM
   ========================================================= */

function criarMensagemVisual(item) {

  const propria =
    item.autorUid === usuarioAtual?.uid;

  const linha = document.createElement('div');

  linha.className =
    'mensagem-linha' +
    (propria ? '' : ' recebida');

  linha.id = 'msg-' + item.id;

  const bolha = document.createElement('article');

  bolha.className =
    'mensagem-bolha' +
    (item.figurinha ? ' figurinha' : '');

  // Autor e horário.
  const cabecalho = document.createElement('div');

  cabecalho.className = 'mensagem-dados';

  const autor = document.createElement('strong');

  autor.textContent = propria
    ? 'Você'
    : (item.autorNome || 'Colega');

  const horario = document.createElement('time');

  horario.textContent = formatarHora(item.criadoEm);

  cabecalho.append(autor, horario);

  bolha.appendChild(cabecalho);

  // Mostra a mensagem original quando é uma resposta.
  if (
    typeof item.respondeA === 'string' &&
    item.respondeA
  ) {

    bolha.appendChild(
      criarCitacao(item.respondeA)
    );
  }

  // Conteúdo da mensagem.
  const conteudo = document.createElement('p');

  conteudo.textContent = item.texto || '';

  bolha.appendChild(conteudo);

  // Área dos botões.
  const acoes = document.createElement('div');

  acoes.className = 'mensagem-acoes';

  // BOTÃO RESPONDER — APENAS ÍCONE.
  acoes.appendChild(
    criarBotaoAcao(
      'Responder',
      'ico-responder',
      () => selecionarResposta(item)
    )
  );

  // BOTÃO EXCLUIR — APENAS ÍCONE.
  // Só aparece para quem enviou a mensagem.
  if (propria) {

    const excluir = criarBotaoAcao(
      'Excluir',
      'ico-lixeira',
      () => excluirMensagem(item, excluir),
      'excluir'
    );

    excluir.disabled = excluindo.has(item.id);

    acoes.appendChild(excluir);
  }

  bolha.appendChild(acoes);

  linha.appendChild(bolha);

  return linha;
}


/* =========================================================
   EXIBIR MENSAGENS
   ========================================================= */

function renderizar() {

  const area = $('messages');

  area.replaceChildren();

  const busca = $('messageSearch')
    .value
    .trim()
    .toLocaleLowerCase('pt-BR');

  const visiveis = mensagensAtuais.filter(
    (item) =>
      String(item.texto || '')
        .toLocaleLowerCase('pt-BR')
        .includes(busca)
  );

  if (!visiveis.length) {

    const vazio = document.createElement('div');

    vazio.className = 'chat-vazio';

    const icone = document.createElement('div');

    icone.className = 'vazio-ilustracao';

    icone.textContent = '💬';

    const titulo = document.createElement('h3');

    titulo.textContent = busca
      ? 'Nenhum resultado'
      : 'Comece a conversa';

    const descricao = document.createElement('p');

    descricao.textContent = busca
      ? 'Tente outra palavra. A busca considera as últimas 100 mensagens.'
      : 'Compartilhe decisões, ideias e pendências do e-commerce com sua líder.';

    vazio.append(
      icone,
      titulo,
      descricao
    );

    area.appendChild(vazio);

  } else {

    visiveis.forEach((item) => {
      area.appendChild(
        criarMensagemVisual(item)
      );
    });

    if (!busca) {
      area.scrollTop = area.scrollHeight;
    }
  }

  atualizarBarraResposta();
}


/* =========================================================
   FIRESTORE — CONVERSA EM TEMPO REAL
   ========================================================= */

function acompanharChat() {

  pararEscuta();

  renderizar();

  if (!usuarioAtual) return;


  const referencia = collection(
    db,
    ...CAMINHO
  );

  const consulta = query(
    referencia,
    orderBy('criadoEm', 'desc'),
    limit(LIMITE_HISTORICO)
  );

  cancelarEscuta = onSnapshot(
    consulta,

    (snapshot) => {

      mensagensAtuais = snapshot.docs
        .map((documento) => ({
          id: documento.id,

          ...documento.data({
            serverTimestamps: 'estimate'
          })
        }))
        .reverse();

      renderizar();
    },

    (erro) => {

      console.error(
        'Falha na sincronização Firestore:',
        erro
      );

      pararEscuta();

      renderizar();

      if (erro.code === 'permission-denied') {

        exibirLogin(
          'Esta conta não tem permissão para acessar o chat. ' +
          'Confira os e-mails autorizados e as regras do Firestore.'
        );

        definirStatus(
          'Acesso não autorizado',
          'erro'
        );

      } else {

        definirStatus(
          'Falha na conexão',
          'erro'
        );

        mostrarToast(
          'Não foi possível sincronizar o chat. Confira o Console (F12).'
        );
      }
    }
  );
}


/* =========================================================
   EXCLUIR SOMENTE MENSAGENS PRÓPRIAS
   ========================================================= */

async function excluirMensagem(item, botao) {

  if (
    !usuarioAtual ||
    item.autorUid !== usuarioAtual.uid
  ) {

    mostrarToast(
      'Você só pode excluir mensagens enviadas por você.'
    );

    return;
  }

  if (excluindo.has(item.id)) return;

  const confirmado = window.confirm(
    'Excluir esta mensagem para as duas pessoas?\n\n' +
    'Ela será removida do Firestore e não poderá ser recuperada pelo chat.'
  );

  if (!confirmado) return;

  excluindo.add(item.id);

  botao.disabled = true;

  try {

    await deleteDoc(
      doc(
        db,
        ...CAMINHO,
        item.id
      )
    );

    if (mensagemRespondida?.id === item.id) {
      cancelarResposta();
    }

    mostrarToast(
      'Mensagem excluída para as duas pessoas.'
    );

  } catch (erro) {

    console.error(
      'Erro ao excluir mensagem:',
      erro
    );

    mostrarToast(
      erro.code === 'permission-denied'
        ? 'Exclusão não autorizada. Confira as regras do Firestore.'
        : 'Não foi possível excluir esta mensagem.'
    );

  } finally {

    excluindo.delete(item.id);

    botao.disabled = false;
  }
}


/* =========================================================
   ALTURA AUTOMÁTICA DO CAMPO DE TEXTO
   ========================================================= */

function atualizarAltura() {

  const campo = $('messageInput');

  campo.style.height = 'auto';

  campo.style.height =
    Math.min(campo.scrollHeight, 145) + 'px';
}


/* =========================================================
   ENVIAR MENSAGENS E RESPOSTAS
   ========================================================= */

async function enviarMensagem(
  valor,
  figurinha = false
) {

  const mensagem = String(valor || '').trim();

  if (!usuarioAtual) {

    mostrarToast(
      'Entre com sua conta Google para enviar mensagens.'
    );

    return;
  }

  if (!mensagem || enviando) return;

  if (mensagem.length > 4000) {

    mostrarToast(
      'A mensagem deve ter até 4.000 caracteres.'
    );

    return;
  }

  enviando = true;

  $('sendButton').disabled = true;

  const idRespondido =
    mensagemRespondida?.id || '';

  try {

    await addDoc(
      collection(db, ...CAMINHO),

      {
        texto: mensagem,

        autorUid: usuarioAtual.uid,

        autorNome: (
          usuarioAtual.displayName ||
          usuarioAtual.email ||
          'Colaborador'
        ).slice(0, 100),

        figurinha: Boolean(figurinha),

        // ID da mensagem que está sendo respondida.
        respondeA: idRespondido,

        criadoEm: serverTimestamp()
      }
    );

    if (
      !figurinha &&
      $('messageInput').value.trim() === mensagem
    ) {

      $('messageInput').value = '';

      atualizarAltura();
    }

    cancelarResposta();

    fecharPicker();

    $('messageInput').focus({
      preventScroll: true
    });

  } catch (erro) {

    console.error(
      'Erro ao enviar:',
      erro
    );

    mostrarToast(
      erro.code === 'permission-denied'
        ? 'Sem permissão para enviar. Confira as regras do Firestore.'
        : 'Falha ao enviar mensagem. Confira a conexão.'
    );

  } finally {

    enviando = false;

    $('sendButton').disabled = false;
  }
}


/* =========================================================
   EMOJIS E FIGURINHAS
   ========================================================= */

function fecharPicker() {

  $('picker').classList.add('escondido');

  $('emojiButton').setAttribute(
    'aria-expanded',
    'false'
  );
}


/* =========================================================
   TRATAMENTO DOS ERROS DE LOGIN
   ========================================================= */

function mensagemErroLogin(erro) {

  if (erro.code === 'auth/popup-closed-by-user') {
    return 'A janela de login foi fechada.';
  }

  if (erro.code === 'auth/unauthorized-domain') {
    return 'Autorize o domínio em Firebase Authentication → Authorized domains.';
  }

  if (erro.code === 'auth/operation-not-allowed') {
    return 'Ative o provedor Google no Firebase Authentication.';
  }

  if (erro.code === 'auth/popup-blocked') {
    return 'Permita pop-ups neste navegador.';
  }

  return erro.message ||
    'Não foi possível entrar com o Google.';
}


/* =========================================================
   ENTRAR COM GOOGLE
   ========================================================= */

$('loginGoogle').addEventListener(
  'click',

  async () => {

    const botao = $('loginGoogle');

    botao.disabled = true;

    botao.textContent = 'Abrindo Google...';

    $('authInfo').textContent =
      'Abrindo o login Google. Se não aparecer, permita pop-ups.';

    definirStatus('Solicitando login…');

    try {

      await signInWithPopup(
        auth,
        googleProvider
      );

    } catch (erro) {

      console.error(
        'Erro de login:',
        erro
      );

      const descricao = mensagemErroLogin(erro);

      $('authInfo').textContent = descricao;

      definirStatus(
        'Falha no login',
        'erro'
      );

      mostrarToast(descricao);

    } finally {

      botao.disabled = false;

      botao.textContent = 'Entrar com Google';
    }
  }
);


/* =========================================================
   SAIR DA CONTA
   ========================================================= */

$('logoutGoogle').addEventListener(
  'click',

  async () => {

    try {

      await signOut(auth);

    } catch (erro) {

      mostrarToast(
        erro.message || 'Não foi possível sair.'
      );
    }
  }
);


/* =========================================================
   IDENTIFICAR O USUÁRIO
   ========================================================= */

onAuthStateChanged(
  auth,

  (usuario) => {

    pararEscuta();

    usuarioAtual = usuario;

    cancelarResposta();

    if (cancelarEscutaPerfil) {
      cancelarEscutaPerfil();
      cancelarEscutaPerfil = null;
    }

    if (!usuario) {

      $('authUser').textContent = '';

      $('logoutGoogle').hidden = true;

      definirStatus('Aguardando acesso');

      exibirLogin(
        'Entre com uma das duas contas Google autorizadas da B.live.'
      );

      return;
    }

    $('authUser').textContent =
      usuario.displayName ||
      usuario.email ||
      'Conta conectada';

    $('logoutGoogle').hidden = false;

    exibirChat();

    // Exibe nome e foto da outra conta.
    sincronizarPerfilGoogle(usuario);

    acompanharChat();
  },

  (erro) => {

    console.error(
      'Erro de autenticação:',
      erro
    );

    exibirLogin(
      'Não foi possível verificar seu login. Atualize a página.'
    );

    definirStatus(
      'Erro de autenticação',
      'erro'
    );
  }
);


/* =========================================================
   EVENTOS DA INTERFACE
   ========================================================= */

// Enviar mensagem ao clicar no botão.
$('composer').addEventListener(
  'submit',

  (evento) => {

    evento.preventDefault();

    enviarMensagem(
      $('messageInput').value
    );
  }
);


// Enviar com Enter.
// Shift + Enter cria uma nova linha.
$('messageInput').addEventListener(
  'keydown',

  (evento) => {

    if (
      evento.key === 'Enter' &&
      !evento.shiftKey &&
      !evento.isComposing
    ) {

      evento.preventDefault();

      $('composer').requestSubmit();
    }

    // Escape cancela uma resposta em andamento.
    if (
      evento.key === 'Escape' &&
      mensagemRespondida
    ) {

      cancelarResposta();
    }
  }
);


// Ajustar a altura do campo.
$('messageInput').addEventListener(
  'input',
  atualizarAltura
);


// Buscar mensagens.
$('messageSearch').addEventListener(
  'input',
  renderizar
);


// Cancelar resposta.
$('cancelReply').addEventListener(
  'click',
  cancelarResposta
);


// Abrir ou fechar os emojis.
$('emojiButton').addEventListener(
  'click',

  () => {

    const fechado = $('picker')
      .classList.toggle('escondido');

    $('emojiButton').setAttribute(
      'aria-expanded',
      String(!fechado)
    );
  }
);


// Fechar painel de emojis.
$('closePicker').addEventListener(
  'click',
  fecharPicker
);


// Inserir emojis no campo de texto.
document
  .querySelectorAll('[data-emoji]')
  .forEach((botao) => {

    botao.addEventListener('click', () => {

      const campo = $('messageInput');

      campo.setRangeText(
        botao.dataset.emoji,
        campo.selectionStart,
        campo.selectionEnd,
        'end'
      );

      campo.focus();

      atualizarAltura();
    });
  });


// Enviar figurinhas.
document
  .querySelectorAll('[data-sticker]')
  .forEach((botao) => {

    botao.addEventListener('click', () => {

      enviarMensagem(
        botao.dataset.sticker,
        true
      );
    });
  });


// Anexos: ainda não implementados.
$('attachButton').addEventListener(
  'click',

  () => {

    mostrarToast(
      'Fotos e documentos ainda precisam do Firebase Storage.'
    );
  }
);


/* =========================================================
   FINALIZAÇÃO
   ========================================================= */

window.__bliveChatReady = true;

definirStatus('Verificando login…');

exibirLogin(
  'Verificando sua conta Google…'
);
