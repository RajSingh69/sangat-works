import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyCa9GmLiND2-kn7YfDeyNLBNzrMNub-5O8",
  authDomain: "sangat-works.firebaseapp.com",
  projectId: "sangat-works",
  storageBucket: "sangat-works.firebasestorage.app",
  messagingSenderId: "109164025239",
  appId: "1:109164025239:web:38bec559473e6c5c2d60d2",
  measurementId: "G-TM2JWC4D10"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);