import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const userGurdwaraName = document.getElementById("userGurdwaraName");
const skillsPoolsList = document.getElementById("skillsPoolsList");
const skillsNetworkMessage = document.getElementById("skillsNetworkMessage");

async function loadPools() {
  if (!skillsPoolsList) return;

  skillsPoolsList.innerHTML = "Loading pools...";

  const poolsQuery = query(
    collection(db, "pools"),
    orderBy("name", "asc")
  );

  const snapshot = await getDocs(poolsQuery);

  if (snapshot.empty) {
    skillsPoolsList.innerHTML = `<p>No pools found yet.</p>`;
    return;
  }

  skillsPoolsList.innerHTML = "";

  snapshot.forEach((docSnap) => {
    const pool = docSnap.data();

    const card = document.createElement("a");
    card.href = `pool.html?gurdwaraId=${profile.gurdwaraId}&poolId=${docSnap.id}`;
    card.className = "pool-card";
    card.innerHTML = `
      <span class="dashboard-number">${pool.name || "Unnamed Pool"}</span>
      <span class="dashboard-label">${pool.description || ""}</span>
    `;

    skillsPoolsList.appendChild(card);
  });
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      userGurdwaraName.textContent = "No profile found.";
      return;
    }

    const profile = userSnap.data();

    if (!profile.gurdwaraName && !profile.associatedGurdwara) {
      userGurdwaraName.textContent = "No Gurdwara selected yet.";
      skillsNetworkMessage.innerHTML = `
        Please go to your profile and select your local Gurdwara first.
      `;
      return;
    }

    userGurdwaraName.textContent = profile.gurdwaraName || profile.associatedGurdwara;

    await loadPools();

  } catch (error) {
    userGurdwaraName.textContent = "Could not load your Gurdwara.";
    skillsNetworkMessage.textContent = error.message;
  }
});