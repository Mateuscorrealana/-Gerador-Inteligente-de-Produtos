
'use strict';

// B.live Intelligence — Chat em tempo real com Firebase Firestore.
// Acesso: Google Authentication + regras de segurança.
// Não misturar com o script antigo de teste local.

import {
  auth,
  db,
  googleProvider
} from './firebase-config.js';

import {
  onAuthStateChanged,
  signInWithPopup,
  signOut
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';

import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';

const $ = (id) => document.getElementById(id);

const SALAS = new Set([
  'geral',
  'produtos',
  'marketplaces',
  'campanhas',
  'pendencias'
]);

const MAX_MENSAGENS = 100;

let salaAtual = 'geral';
let usuarioAtual = null;
let mensagensAtuais = [];
let cancelarEscuta = null;
let enviando = false;
let temporizadorToast;

/* =========================================================
   NOTIFICAÇÕES
   ========================================================= */

function toast(mensagem) {
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

function status(texto, tipo = '') {
  const elemento = $('chatStatus');

  if (!elemento) return;

  const rotulo = elemento.querySelector('.status-text');

  if (rotulo) {
    rotulo.textContent = texto;
  }

  elemento.dataset.estado = tipo;
}

/* =========================================================
   TELAS DE LOGIN E CHAT
   ========================================================= */

function mostrarAcesso(mensagem) {
  $('authPanel').hidden = false;
  $('chatApp').hidden = true;
  $('authInfo').textContent = mensagem;
}

function mostrarChat() {
  $('authPanel').hidden = true;
  $('chatApp').hidden = false;
}

/* =========================================================
   CONTROLE DE SINCRONIZAÇÃO
   ========================================================= */

function pararEscuta() {
  if (cancelarEscuta) {
    cancelarEscuta();
    cancelarEscuta = null;
  }

  mensagensAtuais = [];
}

/* =========================================================
   FORMATAÇÃO DAS MENSAGENS
   ========================================================= */

function horaBrasileira(timestamp) {
  const data = timestamp?.toDate?.();

  return data
    ? data.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'Enviando…';
}

function mensagemVisual(item) {
  const propria = item.autorUid === usuarioAtual?.uid;

  const linha = document.createElement('div');

  linha.className =
    'mensagem-linha' + (propria ? '' : ' recebida');

  const bolha = document.createElement('article');

  bolha.className =
    'mensagem-bolha' + (item.figurinha ? ' figurinha' : '');

  const cabecalho = document.createElement('div');
  cabecalho.className = 'mensagem-dados';

  const nome = document.createElement('strong');

  nome.textContent = propria
    ? 'Você'
    : (item.autorNome || 'Colega');

  const horario = document.createElement('time');
  horario.textContent = horaBrasileira(item.criadoEm);

  cabecalho.append(nome, horario);

  const conteudo = document.createElement('p');
  conteudo.textContent = item.texto || '';

  bolha.append(cabecalho, conteudo);
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

  const filtradas = mensagensAtuais.filter((item) =>
    String(item.texto || '')
      .toLocaleLowerCase('pt-BR')
      .includes(busca)
  );

  if (!filtradas.length) {
    const vazio = document.createElement('div');

    vazio.className = 'chat-vazio';

    const icone = document.createElement('div');
    icone.className = 'vazio-ilustracao';
    icone.textContent = '💬';

    const titulo = document.createElement('h3');

    titulo.textContent = busca
      ? 'Nenhuma mensagem encontrada'
      : 'Comece a conversa';

    const descricao = document.createElement('p');

    descricao.textContent = busca
      ? 'Tente buscar por outra palavra.'
      : 'Suas mensagens ficam sincronizadas em tempo real com as contas autorizadas.';

    vazio.append(icone, titulo, descricao);

    area.appendChild(vazio);
    return;
  }

  filtradas.forEach((item) => {
    area.appendChild(mensagemVisual(item));
  });

  if (!busca) {
    area.scrollTop = area.scrollHeight;
  }
}

/* =========================================================
   FIRESTORE — MENSAGENS EM TEMPO REAL
   ========================================================= */

function acompanharSala() {
  pararEscuta();
  renderizar();

  if (!usuarioAtual || !SALAS.has(salaAtual)) return;

  status('Conectando ao chat…');

  const referencia = collection(
    db,
    'salas',
    salaAtual,
    'mensagens'
  );

  const consulta = query(
    referencia,
    orderBy('criadoEm', 'desc'),
    limit(MAX_MENSAGENS)
  );

  cancelarEscuta = onSnapshot(
    consulta,

    (snapshot) => {
      mensagensAtuais = snapshot.docs
        .map((doc) => ({
          id: doc.id,
          ...doc.data({
            serverTimestamps: 'estimate'
          })
        }))
        .reverse();

      renderizar();

      status('Conectado · tempo real', 'online');
    },

    (erro) => {
      console.error('Erro ao acompanhar mensagens:', erro);

      pararEscuta();

      if (erro.code === 'permission-denied') {
        mostrarAcesso(
          'Esta conta não tem permissão para ler o chat. ' +
          'Cadastre o e-mail nas regras do Firestore e publique as regras.'
        );

        status('Acesso não autorizado', 'erro');

      } else {
        status('Não foi possível sincronizar', 'erro');

        toast(
          'Falha na conexão com Firestore. ' +
          'Confira o console do navegador.'
        );
      }
    }
  );
}

/* =========================================================
   TROCAR DE CANAL
   ========================================================= */

function mudarSala(botao) {
  const nova = botao.dataset.room;

  if (!SALAS.has(nova)) return;

  salaAtual = nova;

  document.querySelectorAll('[data-room]').forEach((item) => {
    item.classList.toggle(
      'ativa',
      item === botao
    );

    item.setAttribute(
      'aria-pressed',
      String(item === botao)
    );
  });

  $('roomTitle').textContent = botao.dataset.title;

  $('roomDescription').textContent =
    botao.dataset.description;

  $('messageSearch').value = '';

  fecharPicker();
  acompanharSala();
}

/* =========================================================
   ALTURA AUTOMÁTICA DO CAMPO
   ========================================================= */

function atualizarAltura() {
  const campo = $('messageInput');

  campo.style.height = 'auto';

  campo.style.height =
    Math.min(campo.scrollHeight, 145) + 'px';
}

/* =========================================================
   ENVIAR MENSAGEM PARA O FIRESTORE
   ========================================================= */

async function enviarMensagem(texto, figurinha = false) {
  const mensagem = texto.trim();

  if (!usuarioAtual) {
    return toast(
      'Entre com sua conta Google para enviar mensagens.'
    );
  }

  if (!mensagem || enviando) return;

  if (mensagem.length > 4000) {
    return toast(
      'A mensagem deve ter até 4.000 caracteres.'
    );
  }

  enviando = true;
  $('sendButton').disabled = true;

  const salaDeEnvio = salaAtual;

  try {
    await addDoc(
      collection(db, 'salas', salaDeEnvio, 'mensagens'),
      {
        texto: mensagem,
        autorUid: usuarioAtual.uid,
        autorNome: (
          usuarioAtual.displayName ||
          usuarioAtual.email ||
          'Colaborador'
        ).slice(0, 100),
        figurinha: Boolean(figurinha),
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

    fecharPicker();
    $('messageInput').focus();

  } catch (erro) {
    console.error('Erro ao enviar mensagem:', erro);

    toast(
      erro.code === 'permission-denied'
        ? 'Sem permissão para enviar. Confira os dois e-mails autorizados nas regras do Firestore.'
        : 'Não foi possível enviar. Confira sua conexão.'
    );

  } finally {
    enviando = false;
    $('sendButton').disabled = false;
  }
}

/* =========================================================
   EMOJIS
   ========================================================= */

function fecharPicker() {
  $('picker').classList.add('escondido');

  $('emojiButton').setAttribute(
    'aria-expanded',
    'false'
  );
}

/* =========================================================
   LOGIN COM GOOGLE
   ========================================================= */

function erroLogin(erro) {
  if (erro.code === 'auth/popup-closed-by-user') {
    return 'A janela de login foi fechada.';
  }

  if (erro.code === 'auth/unauthorized-domain') {
    return 'Adicione este domínio em Firebase → Authentication → Settings → Authorized domains.';
  }

  if (erro.code === 'auth/operation-not-allowed') {
    return 'Ative o provedor Google no Firebase Authentication.';
  }

  if (erro.code === 'auth/popup-blocked') {
    return 'Permita pop-ups no navegador para entrar com o Google.';
  }

  return erro.message ||
    'Não foi possível entrar com o Google.';
}

$('loginGoogle').addEventListener('click', async () => {
  $('loginGoogle').disabled = true;

  try {
    await signInWithPopup(
      auth,
      googleProvider
    );

  } catch (erro) {
    console.error('Erro de login:', erro);
    toast(erroLogin(erro));

  } finally {
    $('loginGoogle').disabled = false;
  }
});

/* =========================================================
   SAIR DA CONTA GOOGLE
   ========================================================= */

$('logoutGoogle').addEventListener('click', async () => {
  try {
    await signOut(auth);
  } catch (erro) {
    toast(erro.message || 'Não foi possível sair.');
  }
});

/* =========================================================
   IDENTIFICAR USUÁRIO CONECTADO
   ========================================================= */

onAuthStateChanged(
  auth,

  (usuario) => {
    pararEscuta();

    usuarioAtual = usuario;

    if (!usuario) {
      $('authUser').textContent = '';
      $('logoutGoogle').hidden = true;

      status('Aguardando acesso');

      mostrarAcesso(
        'Entre com uma das duas contas Google autorizadas para conversar.'
      );

      return;
    }

    $('authUser').textContent =
      usuario.displayName ||
      usuario.email ||
      'Conta conectada';

    $('logoutGoogle').hidden = false;

    mostrarChat();
    acompanharSala();
  },

  (erro) => {
    console.error('Erro de autenticação:', erro);

    mostrarAcesso(
      'Não foi possível verificar o login. Atualize a página.'
    );

    status('Erro de autenticação', 'erro');
  }
);

/* =========================================================
   EVENTOS DA INTERFACE
   ========================================================= */

// Trocar canais
document.querySelectorAll('[data-room]').forEach((botao) => {
  botao.addEventListener('click', () => {
    mudarSala(botao);
  });
});

// Enviar pelo botão
$('composer').addEventListener('submit', (evento) => {
  evento.preventDefault();

  enviarMensagem(
    $('messageInput').value
  );
});

// Enviar com Enter
$('messageInput').addEventListener('keydown', (evento) => {
  if (
    evento.key === 'Enter' &&
    !evento.shiftKey &&
    !evento.isComposing
  ) {
    evento.preventDefault();
    $('composer').requestSubmit();
  }
});

// Ajustar altura
$('messageInput').addEventListener(
  'input',
  atualizarAltura
);

// Buscar mensagens
$('messageSearch').addEventListener(
  'input',
  renderizar
);

// Abrir emojis
$('emojiButton').addEventListener('click', () => {
  const fechado = $('picker')
    .classList.toggle('escondido');

  $('emojiButton').setAttribute(
    'aria-expanded',
    String(!fechado)
  );
});

// Fechar emojis
$('closePicker').addEventListener(
  'click',
  fecharPicker
);

// Inserir emoji na mensagem
document.querySelectorAll('[data-emoji]').forEach((botao) => {
  botao.addEventListener('click', () => {
    const campo = $('messageInput');

    const inicio = campo.selectionStart;
    const fim = campo.selectionEnd;

    campo.setRangeText(
      botao.dataset.emoji,
      inicio,
      fim,
      'end'
    );

    campo.focus();
    atualizarAltura();
  });
});

// Enviar figurinha de emoji
document.querySelectorAll('[data-sticker]').forEach((botao) => {
  botao.addEventListener('click', () => {
    enviarMensagem(
      botao.dataset.sticker,
      true
    );
  });
});

// Anexos serão integrados ao Firebase Storage
$('attachButton').addEventListener('click', () => {
  toast(
    'Anexos exigem Firebase Storage. ' +
    'Nesta etapa, o chat envia textos e emojis em tempo real.'
  );
});

// Exclusão desabilitada para preservar conversas
$('clearRoom').hidden = true;

// Estado inicial
status('Verificando login…');
mostrarAcesso('Verificando sua conta Google…');
