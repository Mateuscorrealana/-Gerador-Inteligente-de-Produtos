
// B.live Intelligence — Firebase
// Esta configuração Web é pública.
// Nunca coloque chaves privadas de conta de serviço aqui.

import {
  initializeApp
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js';

import {
  getAuth,
  GoogleAuthProvider
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js';

import {
  getFirestore
} from 'https://www.gstatic.com/firebasejs/13.2.0/firebase-firestore.js';

const firebaseConfig = {
  apiKey: 'AIzaSyDsoxeSptWkKbuai7-d-1znDssTaE-rORc',
  authDomain: 'gerador-de-produtos.firebaseapp.com',
  projectId: 'gerador-de-produtos',
  storageBucket: 'gerador-de-produtos.firebasestorage.app',
  messagingSenderId: '510937874929',
  appId: '1:510937874929:web:b4f1c47225793aa8918450',
  measurementId: 'G-F6XVXQD70Q'
};

// Aplicativo
const app = initializeApp(firebaseConfig);

// Autenticação
const auth = getAuth(app);

// Banco de dados
const db = getFirestore(app);

// Login com Google
const googleProvider = new GoogleAuthProvider();

googleProvider.setCustomParameters({
  prompt: 'select_account'
});

export {
  auth,
  db,
  googleProvider
};
