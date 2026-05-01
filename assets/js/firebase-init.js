/* ============================================
   firebase-init.js — Inicialización de Firebase
   Soporta múltiples pestañas con sincronización entre tabs.
   La persistencia de Auth se configura SÍNCRONAMENTE desde el inicio.
   ============================================ */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  initializeAuth, getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, sendPasswordResetEmail, updatePassword, deleteUser,
  browserLocalPersistence, indexedDBLocalPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, onSnapshot, writeBatch, Timestamp
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

// ====== AUTH con persistencia desde el inicio ======
let auth;
try {
  auth = initializeAuth(app, {
    persistence: [indexedDBLocalPersistence, browserLocalPersistence]
  });
  console.log('[firebase] Auth inicializado con persistencia local');
} catch (err) {
  // Ya estaba inicializado en otra pestaña/módulo
  console.log('[firebase] Auth ya inicializado, reutilizando');
  auth = getAuth(app);
}

// ====== FIRESTORE con caché multi-tab ======
// initializeFirestore con persistentMultipleTabManager permite múltiples pestañas
let dbFs;
try {
  dbFs = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  });
  console.log('[firebase] Firestore inicializado con caché multi-tab');
} catch (err) {
  // Ya estaba inicializado, usar versión existente
  console.warn('[firebase] Firestore ya inicializado:', err.message);
  const { getFirestore } = await import("https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js");
  dbFs = getFirestore(app);
}

window.fb = {
  app, auth, db: dbFs,
  signInWithEmailAndPassword, signOut, onAuthStateChanged,
  createUserWithEmailAndPassword, sendPasswordResetEmail, updatePassword, deleteUser,
  browserLocalPersistence, indexedDBLocalPersistence,
  collection, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, serverTimestamp, onSnapshot, writeBatch, Timestamp
};

window.dispatchEvent(new CustomEvent('firebase-ready'));
console.log('[firebase] Inicializado · projectId:', firebaseConfig.projectId);
