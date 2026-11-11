
'use strict';

// ======================================================
// B.LIVE INTELLIGENCE — CHAT INTERNO
// Google Authentication + Firestore + perfis editáveis
// ======================================================

import { auth, db, googleProvider } from './firebase.config.js';

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
  getDoc,
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

const CONTAS_CHAT = [
  'bliveinpets25@gmail.com',
  'comercial@blive.com.br'
];

let usuarioAtual = null;
let mensagensAtuais = [];
let mensagemRespondida = null;
let enviando = false;
let temporizadorToast = null;

let cancelarEscuta = null;
let cancelarEscutaPerfil = null;
let cancelarEscutaMeuPerfil = null;

let versaoSessao = 0;
let renderizouHistorico = false;

let meuPerfil = null;
let perfilOutro = null;

// null significa utilizar a foto salva no Firestore.
let fotoEditada = null;
let nomeEditado = false;
let salvandoPerfil = false;

const excluindo = new Set();


// ======================================================
// 1. UTILITÁRIOS E STATUS
// ======================================================

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


function definirStatus(rotulo, tipo = '') {
  const elemento = $('chatStatus');

  if (!elemento) return;

  const texto = elemento.querySelector('.status-text');

  if (texto) {
    texto.textContent = rotulo;
  }

  elemento.dataset.estado = tipo;
}


function exibirLogin(mensagem) {
  $('authPanel').hidden = false;
  $('chatApp').hidden = true;
  $('authInfo').textContent = mensagem;
}


function exibirChat() {
  $('authPanel').hidden = true;
  $('chatApp').hidden = false;
}


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


// ======================================================
// 2. PERFIS — FOTO GOOGLE OU FOTO PERSONALIZADA
// ======================================================

function validarFoto(valor) {
  if (typeof valor !== 'string') return '';

  // Foto JPEG personalizada, otimizada e salva
  // como Base64 no Firestore.
  if (
    valor.length <= 80000 &&
    /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(valor)
  ) {
    return valor;
  }

  // Foto original do Google.
  try {
    const url = new URL(valor);

    return url.protocol === 'https:'
      ? url.href
      : '';

  } catch {
    return '';
  }
}


function fotoGoogleAtual() {
  const perfilGoogle = usuarioAtual?.providerData?.find(
    (perfil) => perfil.providerId === 'google.com'
  );

  return validarFoto(
    usuarioAtual?.photoURL ||
    perfilGoogle?.photoURL ||
    ''
  );
}


// Atualiza foto e letra inicial de um avatar.
function preencherAvatar(
  idImagem,
  idFallback,
  nome,
  fotoURL
) {
  const imagem = $(idImagem);
  const fallback = $(idFallback);

  if (!imagem || !fallback) return;

  const inicial = String(nome || '?')
    .trim()
    .charAt(0)
    .toUpperCase() || '?';

  const endereco = validarFoto(fotoURL);

  fallback.textContent = inicial;

  // Exibe a inicial enquanto a foto carrega.
  imagem.onload = () => {
    imagem.hidden = false;
    fallback.hidden = true;
  };

  imagem.onerror = () => {
    imagem.hidden = true;
    fallback.hidden = false;
  };

  if (endereco) {
    imagem.hidden = true;
    fallback.hidden = false;
    imagem.src = endereco;
  } else {
    imagem.removeAttribute('src');
    imagem.hidden = true;
    fallback.hidden = false;
  }
}


// Nome e foto do outro participante.
function mostrarPerfilContato(nome, fotoURL) {
  const nomeExibicao = String(
    nome || 'Outro participante'
  );

  if ($('roomTitle')) {
    $('roomTitle').textContent = nomeExibicao;
  }

  preencherAvatar(
    'contactPhoto',
    'contactFallback',
    nomeExibicao,
    fotoURL
  );
}


// Prévia da própria foto nas configurações.
function atualizarPreviaMeuPerfil(nome, fotoURL) {
  preencherAvatar(
    'perfilFotoPreview',
    'perfilFotoFallback',
    nome,
    fotoURL
  );
}


// Atualiza os campos do editor sem apagar
// alterações ainda não salvas.
function atualizarEditorPerfil() {
  const campoNome = $('perfilNome');

  if (!campoNome) return;

  if (!nomeEditado) {
    campoNome.value =
      meuPerfil?.nome ||
      usuarioAtual?.displayName ||
      '';
  }

  atualizarPreviaMeuPerfil(
    campoNome.value,
    fotoEditada !== null
      ? fotoEditada
      : (meuPerfil?.fotoURL || fotoGoogleAtual())
  );
}


// Interrompe consultas dos perfis anteriores.
function pararEscutasPerfis() {
  if (cancelarEscutaPerfil) {
    cancelarEscutaPerfil();
  }

  if (cancelarEscutaMeuPerfil) {
    cancelarEscutaMeuPerfil();
  }

  cancelarEscutaPerfil = null;
  cancelarEscutaMeuPerfil = null;
}


// ======================================================
// 3. SINCRONIZAÇÃO DOS PERFIS NO FIRESTORE
// ======================================================

async function sincronizarPerfilGoogle(usuario, versao) {
  const email = (usuario.email || '').toLowerCase();

  if (!CONTAS_CHAT.includes(email)) return;

  const outroEmail = CONTAS_CHAT.find(
    (conta) => conta !== email
  );

  const minhaReferencia = doc(
    db,
    'perfis',
    email
  );

  const outraReferencia = doc(
    db,
    'perfis',
    outroEmail
  );

  // Verifica se o usuário ainda é o mesmo.
  // Evita atualizar a interface de outra conta.
  const sessaoValida = () =>
    versaoSessao === versao &&
    usuarioAtual?.uid === usuario.uid;

  if ($('configPerfil')) {
    $('configPerfil').hidden = false;
  }

  atualizarEditorPerfil();

  mostrarPerfilContato(
    'Carregando contato...',
    ''
  );

  // Inicializa o perfil somente na primeira vez.
  // Nunca substitui uma personalização existente
  // pela foto ou pelo nome antigo do Google.
  try {
    const existente = await getDoc(minhaReferencia);

    if (!sessaoValida()) return;

    if (!existente.exists()) {
      const perfilGoogle = usuario.providerData?.find(
        (perfil) => perfil.providerId === 'google.com'
      );

      await setDoc(minhaReferencia, {
        email,

        nome: (
          usuario.displayName ||
          perfilGoogle?.displayName ||
          email
        ).slice(0, 100),

        fotoURL: fotoGoogleAtual(),

        atualizadoEm: serverTimestamp()
      });
    }

  } catch (erro) {
    console.error(
      'Erro ao inicializar perfil:',
      erro
    );

    if (sessaoValida()) {
      mostrarToast(
        'Não foi possível carregar seu perfil. Confira as regras.'
      );
    }
  }

  if (!sessaoValida()) return;

  // Acompanha o próprio perfil em tempo real.
  cancelarEscutaMeuPerfil = onSnapshot(
    minhaReferencia,

    (snapshot) => {
      if (!sessaoValida() || !snapshot.exists()) {
        return;
      }

      meuPerfil = snapshot.data();

      atualizarEditorPerfil();

      if ($('authUser')) {
        $('authUser').textContent =
          meuPerfil.nome ||
          usuario.displayName ||
          email;
      }
    },

    (erro) => {
      console.error(
        'Erro ao acompanhar meu perfil:',
        erro
      );
    }
  );

  // Acompanha a foto e o nome da outra pessoa.
  cancelarEscutaPerfil = onSnapshot(
    outraReferencia,

    (snapshot) => {
      if (!sessaoValida()) return;

      perfilOutro = snapshot.exists()
        ? snapshot.data()
        : null;

      if (perfilOutro) {
        mostrarPerfilContato(
          perfilOutro.nome,
          perfilOutro.fotoURL
        );
      } else {
        mostrarPerfilContato(
          'Aguardando primeiro acesso...',
          ''
        );
      }

      // Atualiza também o nome nas mensagens.
      renderizar();
    },

    (erro) => {
      console.error(
        'Erro ao consultar contato:',
        erro
      );

      if (sessaoValida()) {
        mostrarPerfilContato(
          'Perfil indisponível',
          ''
        );
      }
    }
  );
}


// ======================================================
// 4. PREPARAR FOTO PERSONALIZADA
// ======================================================

// Reduz uma imagem para miniatura JPEG.
// Não exige Firebase Storage.

function prepararFotoPerfil(arquivo) {
  return new Promise((resolve, reject) => {
    if (!arquivo) {
      return reject(
        new Error('Selecione uma foto.')
      );
    }

    const tiposPermitidos = [
      'image/jpeg',
      'image/png',
      'image/webp'
    ];

    if (!tiposPermitidos.includes(arquivo.type)) {
      return reject(
        new Error(
          'Escolha uma imagem JPG, PNG ou WebP.'
        )
      );
    }

    if (arquivo.size > 4 * 1024 * 1024) {
      return reject(
        new Error(
          'A foto original deve ter até 4 MB.'
        )
      );
    }

    const endereco = URL.createObjectURL(arquivo);
    const imagem = new Image();

    imagem.onload = () => {
      try {
        const lado = Math.min(
          imagem.naturalWidth,
          imagem.naturalHeight
        );

        if (!lado) {
          throw new Error('Imagem inválida.');
        }

        const esquerda =
          (imagem.naturalWidth - lado) / 2;

        const topo =
          (imagem.naturalHeight - lado) / 2;

        const canvas = document.createElement('canvas');
        const contexto = canvas.getContext('2d');

        if (!contexto) {
          throw new Error(
            'Não foi possível processar a foto.'
          );
        }

        function gerar(tamanho, qualidade) {
          canvas.width = tamanho;
          canvas.height = tamanho;

          contexto.fillStyle = '#ffffff';

          contexto.fillRect(
            0,
            0,
            tamanho,
            tamanho
          );

          contexto.drawImage(
            imagem,
            esquerda,
            topo,
            lado,
            lado,
            0,
            0,
            tamanho,
            tamanho
          );

          return canvas.toDataURL(
            'image/jpeg',
            qualidade
          );
        }

        // Primeira tentativa: 160 × 160 px.
        let resultado = gerar(160, 0.78);

        // Segunda tentativa, caso necessário.
        if (resultado.length > 80000) {
          resultado = gerar(120, 0.62);
        }

        if (resultado.length > 80000) {
          throw new Error(
            'A imagem ficou grande demais para o perfil.'
          );
        }

        resolve(resultado);

      } catch (erro) {
        reject(erro);

      } finally {
        URL.revokeObjectURL(endereco);
      }
    };

    imagem.onerror = () => {
      URL.revokeObjectURL(endereco);

      reject(
        new Error(
          'Não foi possível abrir esta imagem.'
        )
      );
    };

    imagem.src = endereco;
  });
}


// ======================================================
// 5. EDITAR NOME E FOTO NAS CONFIGURAÇÕES
// ======================================================

function iniciarEditorPerfil() {
  const escolher = $('perfilEscolherFoto');
  const arquivo = $('perfilArquivo');
  const restaurar = $('perfilRestaurarGoogle');
  const salvar = $('perfilSalvar');
  const campoNome = $('perfilNome');

  if (
    !escolher ||
    !arquivo ||
    !restaurar ||
    !salvar ||
    !campoNome
  ) {
    return;
  }

  // Abrir seletor de imagens.
  escolher.addEventListener('click', () => {
    arquivo.click();
  });

  // Escolher e comprimir a foto.
  arquivo.addEventListener('change', async () => {
    const selecionado = arquivo.files?.[0];

    if (!selecionado || !usuarioAtual) return;

    const uidInicial = usuarioAtual.uid;

    escolher.disabled = true;

    try {
      const novaFoto = await prepararFotoPerfil(
        selecionado
      );

      if (usuarioAtual?.uid !== uidInicial) {
        return;
      }

      fotoEditada = novaFoto;
      atualizarEditorPerfil();

    } catch (erro) {
      mostrarToast(
        erro.message ||
        'Não foi possível carregar a foto.'
      );

    } finally {
      escolher.disabled = false;
      arquivo.value = '';
    }
  });

  // Restaurar foto original da conta Google.
  restaurar.addEventListener('click', () => {
    if (!usuarioAtual) return;

    fotoEditada = fotoGoogleAtual();

    atualizarEditorPerfil();
  });

  // Atualizar a prévia da inicial do nome.
  campoNome.addEventListener('input', () => {
    nomeEditado = true;
    atualizarEditorPerfil();
  });

  // Salvar novo nome e foto no Firestore.
  salvar.addEventListener('click', async () => {
    const usuario = usuarioAtual;

    const email = (
      usuario?.email || ''
    ).toLowerCase();

    if (
      !usuario ||
      !CONTAS_CHAT.includes(email)
    ) {
      mostrarToast(
        'Entre com uma conta autorizada.'
      );

      return;
    }

    if (salvandoPerfil) return;

    const nome = campoNome.value.trim();

    if (nome.length < 2 || nome.length > 100) {
      mostrarToast(
        'Informe um nome de 2 a 100 caracteres.'
      );

      return;
    }

    const fotoURL = validarFoto(
      fotoEditada !== null
        ? fotoEditada
        : (
            meuPerfil?.fotoURL ||
            fotoGoogleAtual()
          )
    );

    salvandoPerfil = true;
    salvar.disabled = true;
    salvar.textContent = 'Salvando...';

    try {
      await setDoc(
        doc(db, 'perfis', email),

        {
          email,
          nome,
          fotoURL,
          atualizadoEm: serverTimestamp()
        }
      );

      if (usuarioAtual?.uid !== usuario.uid) {
        return;
      }

      meuPerfil = {
        email,
        nome,
        fotoURL
      };

      fotoEditada = null;
      nomeEditado = false;

      atualizarEditorPerfil();

      if ($('authUser')) {
        $('authUser').textContent = nome;
      }

      mostrarToast(
        'Perfil atualizado com sucesso!'
      );

    } catch (erro) {
      console.error(
        'Erro ao salvar perfil:',
        erro
      );

      mostrarToast(
        'Não foi possível salvar. Confira as regras do Firestore.'
      );

    } finally {
      salvandoPerfil = false;
      salvar.disabled = false;
      salvar.textContent = 'Salvar alterações';
    }
  });
}


// ======================================================
// 6. RESPOSTAS E NAVEGAÇÃO
// ======================================================

function atualizarBarraResposta() {
  const barra = $('replyPreview');

  if (!mensagemRespondida) {
    barra.hidden = true;
    return;
  }

  const original = buscarMensagem(
    mensagemRespondida.id
  );

  barra.hidden = false;

  $('replyAuthor').textContent = original
    ? 'Respondendo a ' + (
        original.autorUid === usuarioAtual?.uid
          ? 'você'
          : (
              perfilOutro?.nome ||
              original.autorNome ||
              'colaborador'
            )
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


function irParaMensagem(id) {
  const busca = $('messageSearch');

  if (busca.value) {
    busca.value = '';
    renderizar();
  }

  const original = $('msg-' + id);

  if (!original) {
    mostrarToast(
      'A mensagem foi excluída ou está fora das últimas 100.'
    );

    return;
  }

  original.scrollIntoView({
    behavior: 'smooth',
    block: 'center'
  });

  original.classList.add(
    'mensagem-destacada'
  );

  setTimeout(() => {
    original.classList.remove(
      'mensagem-destacada'
    );
  }, 1800);
}


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

  botao.setAttribute(
    'aria-label',
    rotulo
  );

  botao.title = rotulo;

  botao.appendChild(
    criarIcone(icone)
  );

  botao.addEventListener('click', acao);

  return botao;
}


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
          : (
              perfilOutro?.nome ||
              original.autorNome ||
              'Colega'
            )
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


// ======================================================
// 7. MENSAGENS EM TEMPO REAL
// ======================================================

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
    : (
        perfilOutro?.nome ||
        item.autorNome ||
        'Colega'
      );

  const horario = document.createElement('time');

  horario.textContent = formatarHora(
    item.criadoEm
  );

  cabecalho.append(
    autor,
    horario
  );

  bolha.appendChild(cabecalho);

  // Mostrar citação, se for uma resposta.
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

  // Botões da mensagem.
  const acoes = document.createElement('div');

  acoes.className = 'mensagem-acoes';

  acoes.appendChild(
    criarBotaoAcao(
      'Responder',
      'ico-responder',
      () => selecionarResposta(item)
    )
  );

  // Somente o autor pode excluir.
  if (propria) {
    const excluir = criarBotaoAcao(
      'Excluir',
      'ico-lixeira',
      () => excluirMensagem(item, excluir),
      'excluir'
    );

    excluir.disabled = excluindo.has(
      item.id
    );

    acoes.appendChild(excluir);
  }

  bolha.appendChild(acoes);
  linha.appendChild(bolha);

  return linha;
}


// Exibir todas as mensagens atuais.
function renderizar() {
  const area = $('messages');

  const busca = $('messageSearch')
    .value
    .trim()
    .toLocaleLowerCase('pt-BR');

  const estavaPertoDoFim =
    !renderizouHistorico ||
    (
      area.scrollHeight -
      area.scrollTop -
      area.clientHeight < 90
    );

  const posicaoAnterior = area.scrollTop;

  area.replaceChildren();

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
      : 'Compartilhe decisões, ideias e pendências do e-commerce da B.live.';

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
  }

  // Preserva a posição da conversa quando
  // o usuário está lendo mensagens antigas.
  if (!busca && estavaPertoDoFim) {
    area.scrollTop = area.scrollHeight;
  } else {
    area.scrollTop = posicaoAnterior;
  }

  renderizouHistorico = true;

  atualizarBarraResposta();
}


// Encerrar a escuta do Firestore.
function pararEscutaChat() {
  if (cancelarEscuta) {
    cancelarEscuta();
  }

  cancelarEscuta = null;
  mensagensAtuais = [];
  renderizouHistorico = false;
}


// Acompanhar mensagens da sala Geral.
function acompanharChat() {
  pararEscutaChat();
  renderizar();

  if (!usuarioAtual) return;

  definirStatus('Conectando ao chat…');

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

      definirStatus(
        'Conectado · tempo real',
        'online'
      );
    },

    (erro) => {
      console.error(
        'Falha ao sincronizar mensagens:',
        erro
      );

      pararEscutaChat();
      renderizar();

      if (erro.code === 'permission-denied') {
        exibirLogin(
          'Esta conta não tem permissão para acessar o chat.'
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
          'Não foi possível sincronizar o chat. Veja o Console (F12).'
        );
      }
    }
  );
}


// ======================================================
// 8. EXCLUIR MENSAGENS PRÓPRIAS
// ======================================================

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
        ? 'Exclusão não autorizada. Confira as regras.'
        : 'Não foi possível excluir esta mensagem.'
    );

  } finally {
    excluindo.delete(item.id);
    botao.disabled = false;
  }
}


// ======================================================
// 9. ALTURA AUTOMÁTICA DO CAMPO DE TEXTO
// ======================================================

function atualizarAltura() {
  const campo = $('messageInput');

  campo.style.height = 'auto';

  campo.style.height =
    Math.min(campo.scrollHeight, 145) + 'px';
}


// ======================================================
// 10. ENVIAR MENSAGENS E FIGURINHAS
// ======================================================

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

        // Usa o nome personalizado, se houver.
        autorNome: (
          meuPerfil?.nome ||
          usuarioAtual.displayName ||
          usuarioAtual.email ||
          'Colaborador'
        ).slice(0, 100),

        figurinha: Boolean(figurinha),

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
        ? 'Sem permissão para enviar. Confira as regras.'
        : 'Falha ao enviar mensagem. Confira a conexão.'
    );

  } finally {
    enviando = false;
    $('sendButton').disabled = false;
  }
}


// ======================================================
// 11. LOGIN GOOGLE E CONTROLE DE SESSÃO
// ======================================================

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


// Entrar com Google.
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


// Sair da conta Google.
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


// ======================================================
// 12. IDENTIFICAR O USUÁRIO
// ======================================================

onAuthStateChanged(
  auth,

  (usuario) => {
    const versao = ++versaoSessao;

    // Limpa consultas da sessão anterior.
    pararEscutaChat();
    pararEscutasPerfis();

    usuarioAtual = usuario;

    mensagemRespondida = null;
    meuPerfil = null;
    perfilOutro = null;
    fotoEditada = null;
    nomeEditado = false;

    if ($('configPerfil')) {
      $('configPerfil').hidden = true;
    }

    cancelarResposta();

    const email = (
      usuario?.email || ''
    ).toLowerCase();

    // Verifica se a conta pode acessar o chat.
    if (
      !usuario ||
      !CONTAS_CHAT.includes(email) ||
      !usuario.emailVerified
    ) {
      $('authUser').textContent = '';

      $('logoutGoogle').hidden = !usuario;

      definirStatus(
        usuario
          ? 'Acesso não autorizado'
          : 'Aguardando acesso',

        usuario ? 'erro' : ''
      );

      exibirLogin(
        usuario
          ? 'Esta conta não está autorizada a utilizar o chat da B.live.'
          : 'Entre com uma das duas contas Google autorizadas da B.live.'
      );

      return;
    }

    $('authUser').textContent =
      usuario.displayName || email;

    $('logoutGoogle').hidden = false;

    exibirChat();

    // Nome e foto dos dois participantes.
    sincronizarPerfilGoogle(
      usuario,
      versao
    ).catch((erro) => {
      console.error(
        'Falha inesperada ao carregar perfis:',
        erro
      );
    });

    // Mensagens em tempo real.
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


// ======================================================
// 13. EVENTOS DA INTERFACE
// ======================================================

// Enviar mensagem pelo botão.
$('composer').addEventListener(
  'submit',

  (evento) => {
    evento.preventDefault();

    enviarMensagem(
      $('messageInput').value
    );
  }
);


// Enter envia; Shift + Enter quebra linha.
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

    // Escape cancela uma resposta.
    if (
      evento.key === 'Escape' &&
      mensagemRespondida
    ) {
      cancelarResposta();
    }
  }
);


// Ajustar altura do campo.
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


// Abrir e fechar emojis.
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


function fecharPicker() {
  $('picker').classList.add('escondido');

  $('emojiButton').setAttribute(
    'aria-expanded',
    'false'
  );
}


// Botão para fechar os emojis.
$('closePicker').addEventListener(
  'click',
  fecharPicker
);


// Inserir emojis na mensagem.
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


// ======================================================
// 14. ANEXOS
// ======================================================

// O envio de arquivos permanece desativado
// até configurar um serviço de armazenamento.
// Fotos de perfil NÃO dependem desse serviço.

$('attachButton').addEventListener(
  'click',

  () => {
    mostrarToast(
      'O envio de fotos e documentos ainda precisa de armazenamento.'
    );
  }
);


// ======================================================
// 15. INICIALIZAÇÃO
// ======================================================

// Ativa a edição de nome e foto.
iniciarEditorPerfil();

// Indica que o script carregou corretamente.
window.__bliveChatReady = true;

definirStatus('Verificando login…');

exibirLogin(
  'Verificando sua conta Google…'
);
