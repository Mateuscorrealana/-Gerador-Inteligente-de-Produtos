
'use strict';

// ============================================
// B.LIVE INTELLIGENCE — FIREBASE
// ============================================
// Configuração Web pública do Firebase.
// Nunca inserir chaves privadas ou
// credenciais de contas de serviço aqui.

// INICIALIZAÇÃO DO FIREBASE
import {
  initializeApp
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';

// AUTENTICAÇÃO GOOGLE
import {
  getAuth,
  GoogleAuthProvider
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';

// BANCO DE DADOS — MENSAGENS
import {
  getFirestore
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';

// ARMAZENAMENTO — FOTOS E DOCUMENTOS
import {
  getStorage
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-storage.js';

// CONFIGURAÇÃO DO PROJETO
const firebaseConfig = {
  apiKey: 'AIzaSyDsoxeSptWkKbuai7-d-1znDssTaE-rORc',
  authDomain: 'gerador-de-produtos.firebaseapp.com',
  projectId: 'gerador-de-produtos',
  storageBucket: 'gerador-de-produtos.firebasestorage.app',
  messagingSenderId: '510937874929',
  appId: '1:510937874929:web:b4f1c47225793aa8918450',
  measurementId: 'G-F6XVXQD70Q'
};

// INICIALIZAR APLICAÇÃO
const app = initializeApp(firebaseConfig);

// AUTENTICAÇÃO
const auth = getAuth(app);

// FIRESTORE — MENSAGENS DO CHAT
const db = getFirestore(app);

// STORAGE — ARQUIVOS E IMAGENS
const storage = getStorage(app);

// PROVEDOR DE LOGIN GOOGLE
const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: 'select_account'
});

// DISPONIBILIZAR PARA O CHAT.JS
export {
  auth,
  db,
  storage,
  googleProvider
};
