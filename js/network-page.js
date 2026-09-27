import { protectPage } from "./subscription-guard.js";
import { renderFramedPhoto } from "./directory-card.js";
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

const workspaceTabs = document.querySelectorAll("[data-workspace-tab]");
const workspacePanels = document.querySelectorAll("[data-workspace-panel]");
const requestTabs = document.querySelectorAll("[data-request-tab]");
const connectionSearch = document.getElementById("connectionSearch");
const connectionFilters = document.querySelectorAll("[data-connection-filter]");
const lists = {
  connections: document.getElementById("networkConnections"),
  requests: document.getElementById("networkRequests"),
  sent: document.getElementById("networkSent")
};
const networkMessage = document.getElementById("networkMessage");
const counts = {
  connections: document.getElementById("connectionsTabCount"),
  requests: document.getElementById("requestsTabCount"),
  messages: document.getElementById("messagesTabCount")
};

let currentUser = null;
let rows = [];
let profileCache = new Map();
let currentConnectionFilter = "all";

function setMessage(message) {
  if (networkMessage) networkMessage.textContent = message || "";
}

function setWorkspaceTab(tabName, options = {}) {
  const normalized = ["connections", "requests", "messages"].includes(tabName) ? tabName : "connections";
  workspaceTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.workspaceTab === normalized));
  workspacePanels.forEach((panel) => panel.classList.toggle("hidden", panel.dataset.workspacePanel !== normalized));
  const url = new URL(window.location.href);
  url.searchParams.set("tab", normalized);
  if (normalized !== "messages" && !options.keepConversation) url.searchParams.delete("conversation");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
  document.querySelector(".messages-shell")?.classList.toggle("workspace-messages-visible", normalized === "messages");
}

function setRequestTab(tabName) {
  const normalized = tabName === "sent" ? "sent" : "received";
  requestTabs.forEach((tab) => tab.classList.toggle("active", tab.dataset.requestTab === normalized));
  lists.requests?.classList.toggle("hidden", normalized !== "received");
  lists.sent?.classList.toggle("hidden", normalized !== "sent");
}

function getOtherId(connection) {
  return (connection.userIds || []).find((id) => id !== currentUser.uid);
}

async function profileFor(uid) {
  if (!uid) return null;
  if (!profileCache.has(uid)) profileCache.set(uid, await getUserProfile(uid));
  return profileCache.get(uid);
}

function getLocation(profile) {
  return profile?.town || profile?.serviceArea || profile?.location || "UK network";
}

function updateCounts(accepted, incoming) {
  if (counts.connections) counts.connections.textContent = accepted ? String(accepted) : "";
  if (counts.requests) counts.requests.textContent = incoming ? String(incoming) : "";
}

function matchesConnectionSearch(profile) {
  const query = (connectionSearch?.value || "").trim().toLowerCase();
  if (!query) return true;
  return [getDisplayName(profile), getMemberLine(profile), getLocation(profile), profile?.businessName]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

function sortConnections(connections) {
  if (currentConnectionFilter !== "recent") return connections;
  return [...connections].sort((a, b) => {
    const aTime = a.acceptedAt?.toMillis?.() || a.updatedAt?.toMillis?.() || 0;
    const bTime = b.acceptedAt?.toMillis?.() || b.updatedAt?.toMillis?.() || 0;
    return bTime - aTime;
  });
}

async function renderRows() {
  const accepted = [];
  const incoming = [];
  const sent = [];

  for (const connection of rows) {
    const otherId = getOtherId(connection);
    const other = await profileFor(otherId);
    if (connection.status === "accepted") accepted.push({ connection, profile: other });
    if (connection.status === "pending" && connection.recipientId === currentUser.uid) incoming.push({ connection, profile: other });
    if (connection.status === "pending" && connection.requesterId === currentUser.uid) sent.push({ connection, profile: other });
  }

  const visibleAccepted = sortConnections(accepted).filter(({ profile }) => matchesConnectionSearch(profile));
  updateCounts(accepted.length, incoming.length);

  lists.connections.innerHTML = visibleAccepted.map(({ connection, profile }) => renderConnectionRow(connection, profile)).join("") || `
    <div class="network-empty-state">
      <strong>Your network starts here.</strong>
      <span>Find professionals, businesses and people across the Sangat.</span>
      <a href="directory.html">Explore Directory <span aria-hidden="true">-&gt;</span></a>
    </div>`;

  lists.requests.innerHTML = incoming.map(({ connection, profile }) => renderRequestRow(connection, profile, "incoming")).join("") || `
    <div class="network-empty-state"><strong>You're all caught up.</strong><span>No connection requests waiting for you.</span></div>`;

  lists.sent.innerHTML = sent.map(({ connection, profile }) => renderRequestRow(connection, profile, "sent")).join("") || `
    <div class="network-empty-state"><strong>No sent requests.</strong><span>Connection requests you send will appear here.</span></div>`;
}

function renderAvatar(profile) {
  return renderFramedPhoto(profile, { className: "network-avatar" });
}

function renderPersonSummary(profile, otherId) {
  const name = getDisplayName(profile);
  return `
    ${renderAvatar(profile)}
    <a class="network-person-copy" href="view.html?id=${encodeURIComponent(otherId)}">
      <strong>${escapeHtml(name)}</strong>
      <span>${escapeHtml(getMemberLine(profile) || "Sangat Works Member")}</span>
      <small>${escapeHtml(getLocation(profile))}</small>
    </a>`;
}

function renderConnectionRow(connection, profile) {
  const otherId = profile?.uid || profile?.id || getOtherId(connection);
  return `
    <article class="network-person-row">
      ${renderPersonSummary(profile, otherId)}
      <div class="network-row-actions">
        <button type="button" class="btn-small" data-message-user-id="${escapeHtml(otherId)}">Message</button>
        <details class="network-row-menu">
          <summary aria-label="More actions">...</summary>
          <a href="view.html?id=${encodeURIComponent(otherId)}">View profile</a>
          <button type="button" data-remove-user-id="${escapeHtml(otherId)}">Remove connection</button>
        </details>
      </div>
    </article>`;
}

function renderRequestRow(connection, profile, type) {
  const otherId = profile?.uid || profile?.id || getOtherId(connection);
  return `
    <article class="network-person-row request-row">
      ${renderPersonSummary(profile, otherId)}
      <div class="network-row-actions">
        ${type === "incoming" ? `<button type="button" class="btn-small project-accept-btn" data-accept-connection-id="${escapeHtml(connection.id)}">Accept</button>` : `<span class="request-status">Pending</span>`}
        ${type === "incoming" ? `<button type="button" class="btn-small subtle-danger-action" data-decline-connection-id="${escapeHtml(connection.id)}">Decline</button>` : `<button type="button" class="btn-small subtle-danger-action" data-decline-connection-id="${escapeHtml(connection.id)}">Cancel</button>`}
      </div>
    </article>`;
}

async function refreshNetwork() {
  setMessage("Loading your network...");
  rows = await getNetworkConnections(currentUser.uid);
  await renderRows();
  setMessage("");
}

workspaceTabs.forEach((tab) => {
  tab.addEventListener("click", () => setWorkspaceTab(tab.dataset.workspaceTab, { keepConversation: true }));
});

requestTabs.forEach((tab) => {
  tab.addEventListener("click", () => setRequestTab(tab.dataset.requestTab));
});

connectionSearch?.addEventListener("input", renderRows);

connectionFilters.forEach((filter) => {
  filter.addEventListener("click", () => {
    currentConnectionFilter = filter.dataset.connectionFilter || "all";
    connectionFilters.forEach((item) => item.classList.toggle("active", item === filter));
    renderRows();
  });
});

document.addEventListener("click", async (event) => {
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
      setMessage("Opening conversation...");
      const conversationId = await createOrOpenDirectConversation(currentUser.uid, message.dataset.messageUserId);
      const url = new URL(window.location.href);
      url.searchParams.set("tab", "messages");
      url.searchParams.set("conversation", conversationId);
      window.location.href = `${url.pathname}${url.search}`;
    }
  } catch (error) {
    setMessage(error.message);
  }
});

protectPage({
  onAllowed: async (user) => {
    currentUser = user;
    const params = new URLSearchParams(window.location.search);
    const initialTab = params.get("conversation") ? "messages" : (params.get("tab") || "connections");
    setWorkspaceTab(initialTab, { keepConversation: true });
    setRequestTab(params.get("requestTab") || "received");
    await refreshNetwork();
  }
});
