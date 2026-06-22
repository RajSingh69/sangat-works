import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const userGurdwaraName = document.getElementById("userGurdwaraName");
const skillsNetworkMessage = document.getElementById("skillsNetworkMessage");

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

  } catch (error) {
    userGurdwaraName.textContent = "Could not load your Gurdwara.";
    skillsNetworkMessage.textContent = error.message;
  }
});