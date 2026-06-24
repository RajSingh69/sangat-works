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
    let youngProfessionalsButton = "";
    let membershipBadge = `<span class="account-email">Free</span>`;
    let roleBadge = "";

    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const userData = userSnap.data();

        if (hasActiveSubscription(userData)) {
          if (userData.isFoundingMember === true) {
            membershipBadge = `
              <span class="account-email">
                👑 Founding #${userData.memberNumber || ""}
              </span>
            `;
          } else if (userData.subscriptionPlan === "yearly") {
            membershipBadge = `
              <span class="account-email">
                ⭐ Yearly Member
              </span>
            `;
          } else if (userData.subscriptionPlan === "monthly") {
            membershipBadge = `
              <span class="account-email">
                ⭐ Monthly Member
              </span>
            `;
          } else {
            membershipBadge = `
              <span class="account-email">
                ⭐ Member
              </span>
            `;
          }

          skillsNetworkButton = `
            <a href="skills-network.html" class="btn-small">
              Skills Network
            </a>
          `;

          youngProfessionalsButton = `
            <a href="young-professionals.html" class="btn-small">
              Young Professionals
            </a>
          `;
        }

        if (
          userData.accountType === "admin" ||
          userData.isAdmin === true
        ) {
          adminButton = `
            <a href="admin.html" class="btn-small admin-btn">
              Admin
            </a>
          `;

          if (user.email === "rajanbhamra02@gmail.com") {
            roleBadge = `
              <span class="account-email">
                👨‍💻 Platform Developer
              </span>
            `;
          } else {
            roleBadge = `
              <span class="account-email">
                🛡️ Administrator
              </span>
            `;
          }
        }
      }
    } catch (error) {
      console.error(error);
    }

    accountArea.innerHTML = `
      <span class="account-email">${user.email}</span>

      ${roleBadge}

      ${membershipBadge}

      ${skillsNetworkButton}

      ${youngProfessionalsButton}

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