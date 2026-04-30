/* ============================================
   firebase-init.js — Inicialización de Firebase
   Carga Firebase v10 modular vía CDN.
   Expone window.fb con todas las funciones que necesitamos.
   ============================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, sendPasswordResetEmail, updatePassword,
  setPersistence, browserLocalPersistence, indexedDBLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore, collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc,
  deleteDoc, query, where, orderBy, limit, serverTimestamp, onSnapshot,
  enableIndexedDbPersistence, writeBatch, Timestamp
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBEHHwoUXXQPv4graETGidOhjPrZOXh50g",
  authDomain: "alternativecare.firebaseapp.com",
  projectId: "alternativecare",
  storageBucket: "alternativecare.firebasestorage.app",
  messagingSenderId: "919487449610",
  appId: "1:919487449610:web:3fa1380e2dd131d9cbedf3"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const dbFs = getFirestore(app);

console.log('[firebase] Configurando persistencia...');

// CRÍTICO: forzar persistencia local (IndexedDB) para que la sesión sobreviva recargas y navegación entre páginas
setPersistence(auth, indexedDBLocalPersistence)
  .then(() => console.log('[firebase] Persistencia: indexedDBLocalPersistence OK'))
  .catch(err => {
    console.warn('[firebase] indexedDBLocalPersistence falló, probando browserLocalPersistence:', err.message);
    return setPersistence(auth, browserLocalPersistence);
  })
  .catch(err => console.error('[firebase] No se pudo configurar persistencia:', err.message));

// Habilitar caché offline para Firestore
enableIndexedDbPersistence(dbFs).catch(err => {
  if (err.code === 'failed-precondition') {
    console.warn('[firebase] Persistencia Firestore no disponible (múltiples pestañas)');
  } else if (err.code === 'unimplemented') {
    console.warn('[firebase] Persistencia Firestore no soportada');
  }
});

window.fb = {
  app, auth, db: dbFs,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, sendPasswordResetEmail, updatePassword,
  setPersistence, browserLocalPersistence, indexedDBLocalPersistence,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, onSnapshot, writeBatch, Timestamp
};

window.dispatchEvent(new CustomEvent('firebase-ready'));
console.log('[firebase] Inicializado · projectId: alternativecare · currentUser:', auth.currentUser?.email || '(no logueado todavía)');
