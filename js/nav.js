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

import {
  canAccessDeveloperFeatures,
  getUserRole,
  isAdminUser,
  isSuperAdmin
} from "./roles.js";

const accountArea = document.getElementById("accountArea");

function renderMembershipBadge(userData) {
  if (!hasActiveSubscription(userData)) {
    return `<span class="account-email">Not Paid</span>`;
  }

  if (isSuperAdmin(userData)) {
    return `<span class="account-email">Lifetime Member</span>`;
  }

  if (userData.isFoundingMember === true) {
    return `<span class="account-email">Founding #${userData.memberNumber || ""}</span>`;
  }

  if (userData.subscriptionPlan === "yearly") {
    return `<span class="account-email">Yearly Member</span>`;
  }

  if (userData.subscriptionPlan === "monthly") {
    return `<span class="account-email">Monthly Member</span>`;
  }

  return `<span class="account-email">Member</span>`;
}

function renderRoleBadge(userData) {
  const role = getUserRole(userData);

  if (canAccessDeveloperFeatures(userData)) {
    return `<span class="account-email">Super Admin</span>`;
  }

  if (role === "admin") {
    return `<span class="account-email">Administrator</span>`;
  }

  if (role === "moderator") {
    return `<span class="account-email">Moderator</span>`;
  }

  return "";
}

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
    let projectsButton = `
      <a href="projects.html" class="btn-small">
        Projects
      </a>
    `;
    let membershipBadge = `<span class="account-email">Not Paid</span>`;
    let roleBadge = "";

    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        const userData = userSnap.data();

        membershipBadge = renderMembershipBadge(userData);
        roleBadge = renderRoleBadge(userData);

        if (hasActiveSubscription(userData)) {
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

        if (isAdminUser(userData)) {
          adminButton = `
            <a href="admin.html" class="btn-small admin-btn">
              Admin
            </a>
          `;
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

      ${projectsButton}

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
