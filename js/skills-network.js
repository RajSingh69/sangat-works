import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const userGurdwaraName = document.getElementById("userGurdwaraName");
const emptyPoolsBox = document.getElementById("emptyPoolsBox");
const createStarterPoolsBtn = document.getElementById("createStarterPoolsBtn");
const skillsPoolsList = document.getElementById("skillsPoolsList");
const skillsNetworkMessage = document.getElementById("skillsNetworkMessage");

const STARTER_POOLS = [
  {
    name: "Construction",
    description: "Building, maintenance and trades"
  },
  {
    name: "Software",
    description: "Software development and technology"
  },
  {
    name: "Healthcare",
    description: "Medical and healthcare professionals"
  },
  {
    name: "Legal",
    description: "Legal advice and services"
  },
  {
    name: "Property",
    description: "Property, surveying and real estate"
  }
];

async function createStarterPools(profile, user) {
  if (!profile.gurdwaraId || !profile.gurdwaraName) {
    skillsNetworkMessage.textContent = "Please select your Gurdwara in your profile first.";
    return;
  }

  createStarterPoolsBtn.disabled = true;
  createStarterPoolsBtn.textContent = "Creating pools...";
  skillsNetworkMessage.textContent = "";

  for (const pool of STARTER_POOLS) {
    await addDoc(collection(db, "pools"), {
      name: pool.name,
      description: pool.description,
      gurdwaraId: profile.gurdwaraId,
      gurdwaraName: profile.gurdwaraName,
      createdBy: user.uid,
      createdAt: serverTimestamp()
    });
  }

  skillsNetworkMessage.textContent = "Starter pools created successfully.";
  await loadPools(profile);
}





async function loadPools(profile) {
  if (!skillsPoolsList || !emptyPoolsBox) return;

  skillsPoolsList.innerHTML = "Loading pools...";
  emptyPoolsBox.style.display = "none";

  const poolsQuery = query(
    collection(db, "pools"),
    where("gurdwaraId", "==", profile.gurdwaraId),
    orderBy("name", "asc")
  );

  const snapshot = await getDocs(poolsQuery);

  if (snapshot.empty) {
    skillsPoolsList.innerHTML = "";
    emptyPoolsBox.style.display = "block";
    return;
  }

  emptyPoolsBox.style.display = "none";
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

    userGurdwaraName.textContent =
    profile.gurdwaraName || profile.associatedGurdwara;

    await loadPools(profile);

    if (createStarterPoolsBtn) {
    createStarterPoolsBtn.onclick = async () => {
        await createStarterPools(profile, user);
    };
    }

  } catch (error) {
    userGurdwaraName.textContent = "Could not load your Gurdwara.";
    skillsNetworkMessage.textContent = error.message;
  }
});