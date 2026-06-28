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
  setDoc,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const userGurdwaraName = document.getElementById("userGurdwaraName");
const skillsGurdwaraSelect = document.getElementById("skillsGurdwaraSelect");
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
    skillsNetworkMessage.textContent = "Select your local Gurdwara below to load its Skills Pools.";
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

async function loadGurdwaraOptions(selectedGurdwaraId = "") {
  if (!skillsGurdwaraSelect) return;

  skillsGurdwaraSelect.innerHTML = `<option value="">Select your Gurdwara</option>`;

  const snapshot = await getDocs(collection(db, "gurdwaras"));
  const gurdwaras = snapshot.docs
    .map((docSnap) => ({
      id: docSnap.id,
      name: getGurdwaraDisplayName(docSnap.data())
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  gurdwaras.forEach((gurdwara) => {
    const option = document.createElement("option");
    option.value = gurdwara.id;
    option.textContent = gurdwara.name;
    skillsGurdwaraSelect.appendChild(option);
  });

  skillsGurdwaraSelect.value = selectedGurdwaraId || "";
}

function getSelectedGurdwaraName() {
  if (!skillsGurdwaraSelect || !skillsGurdwaraSelect.value) return "";
  return skillsGurdwaraSelect.options[skillsGurdwaraSelect.selectedIndex]?.textContent || "";
}

function getGurdwaraDisplayName(gurdwara) {
  return gurdwara.name || gurdwara.gurdwaraName || gurdwara.localGurdwara || "Unnamed Gurdwara";
}

function findGurdwaraIdByName(gurdwaraName) {
  if (!skillsGurdwaraSelect || !gurdwaraName) return "";

  const normalisedName = gurdwaraName.trim().toLowerCase();
  const option = [...skillsGurdwaraSelect.options].find((item) => {
    return item.value && item.textContent.trim().toLowerCase() === normalisedName;
  });

  return option?.value || "";
}

function renderNoGurdwaraSelected() {
  userGurdwaraName.textContent = "No Gurdwara selected yet.";
  skillsNetworkMessage.textContent = "Select your local Gurdwara below to load its Skills Pools.";

  if (skillsPoolsList) {
    skillsPoolsList.innerHTML = "";
  }

  if (emptyPoolsBox) {
    emptyPoolsBox.style.display = "none";
  }
}

async function loadPools(profile) {
  if (!skillsPoolsList || !emptyPoolsBox) return;

  if (!profile.gurdwaraId) {
    renderNoGurdwaraSelected();
    return;
  }

  skillsPoolsList.innerHTML = "Loading pools...";
  emptyPoolsBox.style.display = "none";

  const poolsQuery = query(
    collection(db, "pools"),
    where("gurdwaraId", "==", profile.gurdwaraId)
);

  const snapshot = await getDocs(poolsQuery);

  if (snapshot.empty) {
    skillsPoolsList.innerHTML = "";
    emptyPoolsBox.style.display = "block";
    return;
  }

  emptyPoolsBox.style.display = "none";
  skillsPoolsList.innerHTML = "";

  const sortedDocs = snapshot.docs.sort((a, b) => {
    const nameA = (a.data().name || "").toLowerCase();
    const nameB = (b.data().name || "").toLowerCase();
    return nameA.localeCompare(nameB);
    });

    sortedDocs.forEach((docSnap) => {
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

    const profile = userSnap.exists() ? userSnap.data() : {};
    await loadGurdwaraOptions(profile.gurdwaraId || "");
    let activeProfile = { ...profile };
    const legacyGurdwaraName = profile.gurdwaraName || profile.associatedGurdwara || profile.localGurdwara || "";

    if (!profile.gurdwaraId && legacyGurdwaraName) {
      const matchedGurdwaraId = findGurdwaraIdByName(legacyGurdwaraName);

      if (matchedGurdwaraId) {
        profile.gurdwaraId = matchedGurdwaraId;
        profile.gurdwaraName = legacyGurdwaraName;
        profile.associatedGurdwara = legacyGurdwaraName;
        profile.localGurdwara = legacyGurdwaraName;
        skillsGurdwaraSelect.value = matchedGurdwaraId;

        await setDoc(userRef, {
          gurdwaraId: matchedGurdwaraId,
          gurdwaraName: legacyGurdwaraName,
          associatedGurdwara: legacyGurdwaraName,
          localGurdwara: legacyGurdwaraName,
          updatedAt: serverTimestamp()
        }, { merge: true });
      }
    }

    if (skillsGurdwaraSelect) {
      skillsGurdwaraSelect.addEventListener("change", async () => {
        const selectedGurdwaraId = skillsGurdwaraSelect.value;
        const selectedGurdwaraName = getSelectedGurdwaraName();

        if (!selectedGurdwaraId) {
          activeProfile = {
            ...activeProfile,
            gurdwaraId: "",
            gurdwaraName: "",
            associatedGurdwara: "",
            localGurdwara: ""
          };

          await setDoc(userRef, {
            gurdwaraId: "",
            gurdwaraName: "",
            associatedGurdwara: "",
            localGurdwara: "",
            updatedAt: serverTimestamp()
          }, { merge: true });
          renderNoGurdwaraSelected();
          return;
        }

        activeProfile = {
          ...activeProfile,
          gurdwaraId: selectedGurdwaraId,
          gurdwaraName: selectedGurdwaraName,
          associatedGurdwara: selectedGurdwaraName,
          localGurdwara: selectedGurdwaraName
        };

        await setDoc(userRef, {
          gurdwaraId: selectedGurdwaraId,
          gurdwaraName: selectedGurdwaraName,
          associatedGurdwara: selectedGurdwaraName,
          localGurdwara: selectedGurdwaraName,
          updatedAt: serverTimestamp()
        }, { merge: true });

        userGurdwaraName.textContent = selectedGurdwaraName;
        skillsNetworkMessage.textContent = "";

        if (createStarterPoolsBtn) {
          createStarterPoolsBtn.onclick = async () => {
            await createStarterPools(activeProfile, user);
          };
        }

        await loadPools(activeProfile);
      });
    }

    if (!profile.gurdwaraId && !profile.gurdwaraName && !profile.associatedGurdwara) {
      renderNoGurdwaraSelected();
      return;
    }

    if (profile.gurdwaraId && !profile.gurdwaraName && !profile.associatedGurdwara) {
      profile.gurdwaraName = getSelectedGurdwaraName();
      profile.associatedGurdwara = profile.gurdwaraName;
    }

    userGurdwaraName.textContent =
    profile.gurdwaraName || profile.associatedGurdwara;
    activeProfile = { ...profile };

    await loadPools(profile);

    if (createStarterPoolsBtn) {
    createStarterPoolsBtn.onclick = async () => {
        await createStarterPools(activeProfile, user);
    };
    }

  } catch (error) {
    userGurdwaraName.textContent = "Could not load your Gurdwara.";
    skillsNetworkMessage.textContent = error.message;
  }
});
