/* ============================================
   firebase-init.js — Inicialización de Firebase
   CRÍTICO: usa initializeAuth() en vez de getAuth() para configurar
   la persistencia DESDE EL INICIO de manera síncrona.
   Esto evita que la sesión se pierda al navegar entre páginas.
   ============================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  initializeAuth, getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, sendPasswordResetEmail, updatePassword,
  browserLocalPersistence, indexedDBLocalPersistence
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

// CRÍTICO: initializeAuth permite pasar persistencia DESDE EL INICIO
// (a diferencia de getAuth + setPersistence que es async y crea race condition)
let auth;
try {
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence]
  });
  console.log('[firebase] Auth inicializado con persistencia local');
} catch (err) {
  // Si ya estaba inicializado (otro script lo hizo), usar getAuth
  console.warn('[firebase] initializeAuth falló, usando getAuth:', err.message);
  auth = getAuth(app);
}

const dbFs = getFirestore(app);

// Habilitar caché offline para Firestore (no bloquea)
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
  browserLocalPersistence, indexedDBLocalPersistence,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, onSnapshot, writeBatch, Timestamp
};

window.dispatchEvent(new CustomEvent('firebase-ready'));
console.log('[firebase] Inicializado · projectId:', firebaseConfig.projectId);
