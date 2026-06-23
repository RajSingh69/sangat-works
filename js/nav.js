import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  hasActiveSubscription
} from "./subscription-guard.js";

const accountArea = document.getElementById("accountArea");

if (accountArea) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      accountArea.innerHTML = `
        <a href="login.html" class="btn-small">Login</a>
      `;
      return;
    }

    let adminButton = "";
    let skillsNetworkButton = "";
    let membershipBadge = `<span class="account-email">Free</span>`;

    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const userData = userSnap.data();

        if (hasActiveSubscription(userData)) {
          membershipBadge = `
            <span class="account-email">Member</span>
          `;

          skillsNetworkButton = `
            <a href="skills-network.html" class="btn-small">
              Skills Network
            </a>
          `;
        }

        if (
          userData.accountType === "admin" ||
          userData.isAdmin === true
        ) {
          adminButton = `
            <a href="admin.html" class="btn-small admin-btn">Admin</a>
          `;
        }
      }
    } catch (error) {
      console.error(error);
    }

    accountArea.innerHTML = `
      <span class="account-email">${user.email}</span>
      ${membershipBadge}

      ${skillsNetworkButton}

      ${adminButton}

      <a href="profile.html" class="btn-small">
        Edit Profile
      </a>

      <button id="logoutBtn" class="btn-small logout-btn">
        Logout
      </button>
    `;

    document
      .getElementById("logoutBtn")
      .addEventListener("click", async () => {
        await signOut(auth);
        window.location.href = "login.html";
      });
  });
}