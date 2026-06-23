import { db } from "./firebase.js";

import {
  collection,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const foundingClaimed = document.getElementById("foundingClaimed");
const foundingCounterFill = document.getElementById("foundingCounterFill");
const foundingRemaining = document.getElementById("foundingRemaining");

async function loadFoundingCounter() {
  if (!foundingClaimed || !foundingCounterFill || !foundingRemaining) return;

  const usersSnap = await getDocs(collection(db, "users"));

  let claimed = 0;

  usersSnap.forEach(docSnap => {
    const user = docSnap.data();

    if (user.isFoundingMember === true) {
      claimed++;
    }
  });

  const max = 30;
  const remaining = Math.max(max - claimed, 0);
  const percent = Math.min((claimed / max) * 100, 100);

  foundingClaimed.textContent = claimed;
  foundingCounterFill.style.width = `${percent}%`;
  foundingRemaining.textContent = `${remaining} founding spaces remaining`;
}

loadFoundingCounter();