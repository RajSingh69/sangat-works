import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where
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
let unsubscribeMessageBadge = null;

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function plainMembershipLabel(userData = {}) {
  if (!hasActiveSubscription(userData)) return "Not Paid";
  if (isSuperAdmin(userData)) return "Lifetime Member";
  if (userData.accessType === "admin_granted_free_year") return "Free Charity Year";
  if (userData.isFoundingMember === true) return `Founding #${userData.memberNumber || ""}`.trim();
  if (userData.subscriptionPlan === "yearly") return "Yearly Member";
  if (userData.subscriptionPlan === "monthly") return "Monthly Member";
  return "Member";
}

function renderMembershipBadge(userData) {
  return `<span class="account-email">${escapeHtml(plainMembershipLabel(userData))}</span>`;
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

function getInitial(email = "") {
  return (email.trim().slice(0, 1) || "S").toUpperCase();
}

function navItem(href, icon, label, extra = "") {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const targetPage = href.split("?")[0];
  const active = currentPage === targetPage ? "active" : "";
  return `
    <a href="${href}" class="app-nav-item ${active}" ${extra}>
      <span class="app-nav-icon" aria-hidden="true">${icon}</span>
      <span class="app-nav-label">${label}</span>
    </a>
  `;
}

function renderAppShell(user, userData = {}) {
  const isPaid = hasActiveSubscription(userData);
  const canAdmin = isAdminUser(userData);
  const roleBadge = renderRoleBadge(userData);
  const membershipBadge = renderMembershipBadge(userData);

  document.body.classList.add("member-shell-enabled");

  const oldShell = document.getElementById("memberAppShellNav");
  if (oldShell) oldShell.remove();

  const shell = document.createElement("aside");
  shell.id = "memberAppShellNav";
  shell.className = "member-sidebar";
  shell.innerHTML = `
    <div class="member-sidebar-top">
      <a class="member-sidebar-brand" href="index.html">
        <span class="brand-mark">SW</span>
        <span>Sangat Works</span>
      </a>
      <button type="button" class="sidebar-collapse-btn" id="sidebarCollapseBtn" aria-label="Collapse navigation">=</button>
    </div>

    <nav class="member-sidebar-nav" aria-label="Member navigation">
      ${navItem("index.html", "H", "Home")}
      ${navItem("directory.html", "D", "Directory")}
      ${isPaid ? navItem("network.html", "N", "My Network") : ""}
      ${navItem("messages.html", "M", "Messages", "id=\"messagesNavLink\"")}
      ${navItem("projects.html", "P", "Projects")}
      ${isPaid ? navItem("skills-network.html", "S", "Skills Network") : ""}
      ${isPaid ? navItem("young-professionals.html", "Y", "Young Professionals") : ""}
    </nav>

    <nav class="member-sidebar-nav member-sidebar-lower" aria-label="Account navigation">
      ${navItem("profile.html", "U", "Profile")}
      ${canAdmin ? navItem("admin.html", "A", "Admin") : ""}
    </nav>
  `;

  document.body.prepend(shell);

  accountArea.innerHTML = `
    <button type="button" class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Open navigation">Menu</button>
    <div class="account-menu">
      <button type="button" class="account-menu-trigger" id="accountMenuTrigger" aria-expanded="false">
        <span class="account-avatar">${escapeHtml(getInitial(user.email))}</span>
        <span class="account-menu-copy">
          <strong>${escapeHtml(user.email || "Member")}</strong>
          <span>${escapeHtml(plainMembershipLabel(userData))}</span>
        </span>
      </button>
      <div class="account-menu-panel hidden" id="accountMenuPanel">
        <div class="account-menu-meta">
          <strong>${escapeHtml(user.email || "Member")}</strong>
          <div class="account-badge-row">${membershipBadge}${roleBadge}</div>
        </div>
        <a href="profile.html">Profile settings</a>
        <a href="messages.html">Messages</a>
        ${canAdmin ? `<a href="admin.html">Admin</a>` : ""}
        <button type="button" id="logoutBtn">Logout</button>
      </div>
    </div>
  `;

  document.getElementById("sidebarCollapseBtn")?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-collapsed");
  });

  document.getElementById("mobileMenuBtn")?.addEventListener("click", () => {
    document.body.classList.toggle("sidebar-open");
  });

  document.getElementById("accountMenuTrigger")?.addEventListener("click", () => {
    const panel = document.getElementById("accountMenuPanel");
    const trigger = document.getElementById("accountMenuTrigger");
    const isHidden = panel?.classList.toggle("hidden");
    trigger?.setAttribute("aria-expanded", String(!isHidden));
  });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".account-menu")) {
      document.getElementById("accountMenuPanel")?.classList.add("hidden");
      document.getElementById("accountMenuTrigger")?.setAttribute("aria-expanded", "false");
    }
    if (event.target.closest(".app-nav-item")) {
      document.body.classList.remove("sidebar-open");
    }
  });

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await signOut(auth);
    window.location.href = "login.html";
  });
}

if (accountArea) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      if (unsubscribeMessageBadge) {
        unsubscribeMessageBadge();
        unsubscribeMessageBadge = null;
      }

      document.body.classList.remove("member-shell-enabled", "sidebar-open", "sidebar-collapsed");
      document.getElementById("memberAppShellNav")?.remove();
      accountArea.innerHTML = `<a href="login.html" class="btn-small">Login</a>`;
      return;
    }

    let userData = {};

    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (userSnap.exists()) {
        userData = userSnap.data();
      }
    } catch (error) {
      console.error(error);
    }

    renderAppShell(user, userData);

    if (unsubscribeMessageBadge) {
      unsubscribeMessageBadge();
      unsubscribeMessageBadge = null;
    }

    const messagesNavLink = document.getElementById("messagesNavLink");
    if (messagesNavLink) {
      const conversationsQuery = query(
        collection(db, "conversations"),
        where("participantIds", "array-contains", user.uid)
      );

      unsubscribeMessageBadge = onSnapshot(conversationsQuery, (snapshot) => {
        const unreadTotal = snapshot.docs.reduce((total, docSnap) => {
          const data = docSnap.data();
          return total + Number(data.unreadCounts?.[user.uid] || 0);
        }, 0);

        const badge = unreadTotal ? `<span class="nav-unread-badge">${unreadTotal}</span>` : "";
        messagesNavLink.innerHTML = `
          <span class="app-nav-icon" aria-hidden="true">M</span>
          <span class="app-nav-label">Messages</span>
          ${badge}
        `;
      });
    }
  });
}