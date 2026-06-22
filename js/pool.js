import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const poolName = document.getElementById("poolName");
const poolDescription = document.getElementById("poolDescription");
const poolMessage = document.getElementById("poolMessage");

const params = new URLSearchParams(window.location.search);
const poolId = params.get("id");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  if (!poolId) {
    poolName.textContent = "Pool not found";
    poolMessage.textContent = "No pool was selected.";
    return;
  }

  try {
    const poolRef = doc(db, "pools", poolId);
    const poolSnap = await getDoc(poolRef);

    if (!poolSnap.exists()) {
      poolName.textContent = "Pool not found";
      poolMessage.textContent = "This pool does not exist.";
      return;
    }

    const pool = poolSnap.data();

    poolName.textContent = pool.name || "Unnamed Pool";
    poolDescription.textContent = pool.description || "";

  } catch (error) {
    poolName.textContent = "Error loading pool";
    poolMessage.textContent = error.message;
  }
});