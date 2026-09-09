import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { protectPage } from "./subscription-guard.js";
import {
  acceptConnection,
  createOrOpenDirectConversation,
  declineConnection,
  escapeHtml,
  getDisplayName,
  getMemberLine,
  getNetworkConnections,
  getUserProfile,
  removeConnection
} from "./member-network.js";

const tabs = document.querySelectorAll(".network-tab");
const lists = {
  connections: document.getElementById("networkConnections"),
  requests: document.getElementById("networkRequests"),
  sent: document.getElementById("networkSent")
};
const networkMessage = document.getElementById("networkMessage");

let currentUser = null;
let rows = [];

function setMessage(message) {
  if (networkMessage) networkMessage.textContent = message;
}

function setTab(tabName) {
  tabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.networkTab === tabName));
  Object.entries(lists).forEach(([name, element]) => {
    element?.classList.toggle("hidden", name !== tabName);
  });
  const url = new URL(window.location.href);
  url.searchParams.set("tab", tabName);
  window.history.replaceState({}, "", url);
}

function getOtherId(connection) {
  return (connection.userIds || []).find((id) => id !== currentUser.uid);
}

async function renderRows() {
  const profileCache = new Map();
  async function profileFor(uid) {
    if (!profileCache.has(uid)) profileCache.set(uid, await getUserProfile(uid));
    return profileCache.get(uid);
  }

  const accepted = [];
  const requests = [];
  const sent = [];

  for (const connection of rows) {
    const otherId = getOtherId(connection);
    const other = await profileFor(otherId);
    const card = renderNetworkCard(connection, other);
    if (connection.status === "accepted") accepted.push(card);
    if (connection.status === "pending" && connection.recipientId === currentUser.uid) requests.push(card);
    if (connection.status === "pending" && connection.requesterId === currentUser.uid) sent.push(card);
  }

  lists.connections.innerHTML = accepted.join("") || `<div class="empty-state">You haven't made any connections yet. Explore the directory to meet members across the Sangat Works network.</div>`;
  lists.requests.innerHTML = requests.join("") || `<div class="empty-state">No pending connection requests.</div>`;
  lists.sent.innerHTML = sent.join("") || `<div class="empty-state">No sent connection requests.</div>`;
}

function renderNetworkCard(connection, profile) {
  const otherId = profile?.uid || profile?.id || getOtherId(connection);
  const isIncoming = connection.status === "pending" && connection.recipientId === currentUser.uid;
  const isOutgoing = connection.status === "pending" && connection.requesterId === currentUser.uid;
  const image = profile?.profilePhotoUrl
    ? `<img src="${escapeHtml(profile.profilePhotoUrl)}" class="network-avatar" alt="">`
    : `<div class="network-avatar placeholder-avatar">${escapeHtml(getDisplayName(profile).slice(0, 1))}</div>`;

  return `
    <article class="network-card">
      ${image}
      <div class="network-card-main">
        <h3>${escapeHtml(getDisplayName(profile))}</h3>
        <p>${escapeHtml(getMemberLine(profile) || "Member profile")}</p>
        <div class="card-links">
          <a href="view.html?id=${encodeURIComponent(otherId)}">View Profile</a>
          ${connection.status === "accepted" ? `<button type="button" class="btn-small" data-message-user-id="${otherId}">Message</button>` : ""}
          ${isIncoming ? `<button type="button" class="btn-small project-accept-btn" data-accept-connection-id="${connection.id}">Accept</button>` : ""}
          ${isIncoming ? `<button type="button" class="btn-small project-reject-btn" data-decline-connection-id="${connection.id}">Decline</button>` : ""}
          ${isOutgoing ? `<span class="project-status-pill status-pending">Requested</span><button type="button" class="btn-small project-withdraw-btn" data-decline-connection-id="${connection.id}">Cancel Request</button>` : ""}
          ${connection.status === "accepted" ? `<button type="button" class="btn-small project-withdraw-btn" data-remove-user-id="${otherId}">Remove Connection</button>` : ""}
        </div>
      </div>
    </article>
  `;
}

async function refreshNetwork() {
  setMessage("Loading your network...");
  rows = await getNetworkConnections(currentUser.uid);
  await renderRows();
  setMessage("");
}

document.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-network-tab]");
  if (tab) setTab(tab.dataset.networkTab);

  const accept = event.target.closest("[data-accept-connection-id]");
  const decline = event.target.closest("[data-decline-connection-id]");
  const remove = event.target.closest("[data-remove-user-id]");
  const message = event.target.closest("[data-message-user-id]");

  try {
    if (accept) {
      await acceptConnection(currentUser.uid, accept.dataset.acceptConnectionId);
      await refreshNetwork();
    }
    if (decline) {
      await declineConnection(currentUser.uid, decline.dataset.declineConnectionId);
      await refreshNetwork();
    }
    if (remove) {
      await removeConnection(currentUser.uid, remove.dataset.removeUserId);
      await refreshNetwork();
    }
    if (message) {
      const conversationId = await createOrOpenDirectConversation(currentUser.uid, message.dataset.messageUserId);
      window.location.href = `messages.html?conversation=${encodeURIComponent(conversationId)}`;
    }
  } catch (error) {
    setMessage(error.message);
  }
});

protectPage({
  onAllowed: (user) => {
    currentUser = user;
    setTab(new URLSearchParams(window.location.search).get("tab") || "connections");
    refreshNetwork();
  }
});
