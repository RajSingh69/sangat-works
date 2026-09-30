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
  recordDailyActivity
} from "./member-network.js";

import {
  canAccessDeveloperFeatures,
  getUserRole,
  isAdminUser,
  isSuperAdmin
} from "./roles.js";

const accountArea = document.getElementById("accountArea");
let unsubscribeMessageBadge = null;
let unsubscribeRequestBadge = null;
let combinedNetworkActivity = { messages: 0, requests: 0 };

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
  const freeUntil = userData.freeAccessExpiresAt?.toDate ? userData.freeAccessExpiresAt.toDate() : null;
  if (userData.accessType === "admin_granted_free_year" && freeUntil && freeUntil > new Date()) {
    return userData.freeAccessSource === "trial" ? "Free Trial" : "Free Charity Year";
  }
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

// Line icons for the sidebar (24px grid, drawn with currentColor).
const navSvg = (paths) => `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const NAV_ICONS = {
  home: navSvg('<path d="M3 11 12 4l9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>'),
  directory: navSvg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  network: navSvg('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/>'),
  opportunities: navSvg('<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18"/>'),
  marketplace: navSvg('<path d="M6 7h12l1.5 13h-15Z"/><path d="M9 10V6a3 3 0 0 1 6 0v4"/>'),
  learning: navSvg('<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2Z"/><path d="M4 19V5M19 17H6a2 2 0 0 0 0 4h13"/>'),
  gurdwara: navSvg('<path d="M12 3c2 2 3 3.5 3 5.5H9C9 6.5 10 5 12 3Z"/><path d="M5 21v-8h14v8M3 21h18M9 21v-4a3 3 0 0 1 6 0v4M12 8.5V13"/>'),
  young: navSvg('<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11v5c3 2 9 2 12 0v-5"/>'),
  profile: navSvg('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'),
  admin: navSvg('<path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6Z"/><path d="m9 12 2 2 4-4"/>'),
  collapse: navSvg('<path d="m15 6-6 6 6 6"/><path d="M20 5v14"/>'),
  menu: navSvg('<path d="M4 7h16M4 12h16M4 17h16"/>')
};

function navItem(href, icon, label, extra = "") {
  const currentPage = window.location.pathname.split("/").pop() || "index.html";
  const targetPage = href.split("?")[0];
  const networkActive = targetPage === "network.html" && (currentPage === "network.html" || currentPage === "messages.html");
  const active = currentPage === targetPage || networkActive ? "active" : "";
  return `
    <a href="${href}" class="app-nav-item ${active}" ${extra}>
      <span class="app-nav-icon" aria-hidden="true">${NAV_ICONS[icon] || ""}</span>
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
      <a class="member-sidebar-brand" href="index.html" aria-label="Sangat Works home">
        <img class="sidebar-logo-full" src="assets/sangat-works-logo-white.png" alt="Sangat Works" />
        <img class="sidebar-logo-mark" src="assets/sangat-works-emblem-white.png" alt="" />
      </a>
      <button type="button" class="sidebar-collapse-btn" id="sidebarCollapseBtn" aria-label="Collapse navigation">${NAV_ICONS.collapse}</button>
    </div>

    <nav class="member-sidebar-nav" aria-label="Member navigation">
      ${navItem("index.html", "home", "Home")}
      ${navItem("directory.html", "directory", "Directory")}
      ${isPaid ? navItem("network.html", "network", "My Network & Messages", "id=\"networkMessagesNavLink\"") : ""}
      ${navItem("opportunities.html", "opportunities", "Opportunities")}
      ${isPaid ? navItem("marketplace.html", "marketplace", "Marketplace") : ""}
      ${isPaid ? navItem("learning.html", "learning", "Learning Hub") : ""}
      ${isPaid ? navItem("skills-network.html", "gurdwara", "Gurdwara Network") : ""}
      ${isPaid ? navItem("young-professionals.html", "young", "Young Professionals") : ""}
    </nav>

    <nav class="member-sidebar-nav member-sidebar-lower" aria-label="Account navigation">
      ${navItem("profile.html", "profile", "Profile")}
      ${canAdmin ? navItem("admin.html", "admin", "Admin") : ""}
    </nav>
  `;

  document.body.prepend(shell);

  accountArea.innerHTML = `
    <button type="button" class="mobile-menu-btn" id="mobileMenuBtn" aria-label="Open navigation">${NAV_ICONS.menu}<span>Menu</span></button>
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
        <a href="network.html?tab=messages">Messages</a>
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
      if (unsubscribeRequestBadge) {
        unsubscribeRequestBadge();
        unsubscribeRequestBadge = null;
      }
      combinedNetworkActivity = { messages: 0, requests: 0 };

      document.body.classList.remove("member-shell-enabled", "sidebar-open", "sidebar-collapsed");
      document.getElementById("memberAppShellNav")?.remove();
      accountArea.innerHTML = `<a href="login.html" class="btn-small">Log in</a>`;
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

    if (Object.keys(userData).length > 0) {
      recordDailyActivity(user.uid).catch(error => console.warn("Daily activity not recorded:", error.message));
    }

    if (unsubscribeMessageBadge) {
      unsubscribeMessageBadge();
      unsubscribeMessageBadge = null;
    }
    if (unsubscribeRequestBadge) {
      unsubscribeRequestBadge();
      unsubscribeRequestBadge = null;
    }

    function renderNetworkActivityBadge() {
      const networkLink = document.getElementById("networkMessagesNavLink");
      if (!networkLink) return;
      const total = Number(combinedNetworkActivity.messages || 0) + Number(combinedNetworkActivity.requests || 0);
      const badge = total ? `<span class="nav-unread-badge">${total}</span>` : "";
      networkLink.innerHTML = `
        <span class="app-nav-icon" aria-hidden="true">${NAV_ICONS.network}</span>
        <span class="app-nav-label">My Network & Messages</span>
        ${badge}
      `;
    }

    const networkLink = document.getElementById("networkMessagesNavLink");
    if (networkLink) {
      const conversationsQuery = query(
        collection(db, "conversations"),
        where("participantIds", "array-contains", user.uid)
      );
      unsubscribeMessageBadge = onSnapshot(conversationsQuery, (snapshot) => {
        combinedNetworkActivity.messages = snapshot.docs.reduce((total, docSnap) => {
          const data = docSnap.data();
          return total + Number(data.unreadCounts?.[user.uid] || 0);
        }, 0);
        renderNetworkActivityBadge();
      });

      const requestsQuery = query(
        collection(db, "connections"),
        where("recipientId", "==", user.uid),
        where("status", "==", "pending")
      );
      unsubscribeRequestBadge = onSnapshot(requestsQuery, (snapshot) => {
        combinedNetworkActivity.requests = snapshot.size;
        renderNetworkActivityBadge();
      });
    }
  });
}

