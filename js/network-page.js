import { auth } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { protectPage } from "./subscription-guard.js";
import {
  acceptConnection,
  openConversationWithUser,
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

function renderExpandableDetails(detailsId, sections) {
  const visibleSections = sections.filter(section => section.content);
  if (!visibleSections.length) return "";

  return `
    <div class="expandable-profile-details" id="${detailsId}" hidden>
      ${visibleSections.map(section => `
        <section class="expandable-detail-section">
          <h4>${escapeHtml(section.title)}</h4>
          ${section.content}
        </section>
      `).join("")}
    </div>
  `;
}

function renderNetworkCard(connection, profile) {
  const otherId = profile?.uid || profile?.id || getOtherId(connection);
  const isIncoming = connection.status === "pending" && connection.recipientId === currentUser.uid;
  const isOutgoing = connection.status === "pending" && connection.requesterId === currentUser.uid;
  const relationshipLabel = connection.status === "accepted"
    ? "Connected"
    : isIncoming
      ? "Request received"
      : "Request sent";
  const image = profile?.profilePhotoUrl
    ? `<img src="${escapeHtml(profile.profilePhotoUrl)}" class="network-avatar" alt="">`
    : `<div class="network-avatar placeholder-avatar">${escapeHtml(getDisplayName(profile).slice(0, 1))}</div>`;
  const organisation = profile?.businessName || profile?.organisation || profile?.company || "";
  const location = profile?.town || profile?.serviceArea || "";
  const detailsId = `network-profile-details-${encodeURIComponent(otherId)}`;
  const tags = profile?.tags || [];
  const tagsHtml = tags.length
    ? `<div class="tags">${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  const detailRows = [
    organisation ? `<p><strong>Organisation</strong><span>${escapeHtml(organisation)}</span></p>` : "",
    location ? `<p><strong>Location</strong><span>${escapeHtml(location)}</span></p>` : "",
    profile?.serviceArea ? `<p><strong>Service area</strong><span>${escapeHtml(profile.serviceArea)}</span></p>` : "",
    profile?.yearsExperience ? `<p><strong>Experience</strong><span>${escapeHtml(profile.yearsExperience)} years</span></p>` : "",
    profile?.specialistWork ? `<p><strong>Specialist work</strong><span>${escapeHtml(profile.specialistWork)}</span></p>` : ""
  ].filter(Boolean).join("");
  const expandedDetails = renderExpandableDetails(detailsId, [
    { title: "About", content: profile?.description ? `<p>${escapeHtml(profile.description)}</p>` : "" },
    { title: "Skills", content: tagsHtml },
    { title: "Profile details", content: detailRows ? `<div class="expandable-detail-list">${detailRows}</div>` : "" }
  ]);

  return `
    <article class="network-card professional-person-card expandable-profile-card">
      ${image}
      <div class="network-card-main">
        <div class="person-card-heading">
          <div>
            <h3>${escapeHtml(getDisplayName(profile))}</h3>
            <p>${escapeHtml(getMemberLine(profile) || "Member profile")}</p>
          </div>
          <span class="project-status-pill ${connection.status === "accepted" ? "status-accepted" : "status-pending"}">${relationshipLabel}</span>
        </div>
        <div class="person-card-meta">
          ${organisation ? `<span>${escapeHtml(organisation)}</span>` : ""}
          ${location ? `<span>${escapeHtml(location)}</span>` : ""}
        </div>
        <button type="button" class="expandable-profile-toggle" aria-expanded="false" aria-controls="${detailsId}" data-expand-card>More details</button>
        ${expandedDetails}
        <div class="card-links person-card-actions">
          ${connection.status === "accepted" ? `<button type="button" class="btn-small" data-message-user-id="${otherId}">Message</button>` : ""}
          <a href="view.html?id=${encodeURIComponent(otherId)}">View Profile</a>
          ${isIncoming ? `<button type="button" class="btn-small project-accept-btn" data-accept-connection-id="${connection.id}">Accept</button>` : ""}
          ${isIncoming ? `<button type="button" class="btn-small subtle-danger-action" data-decline-connection-id="${connection.id}">Decline</button>` : ""}
          ${isOutgoing ? `<button type="button" class="btn-small subtle-danger-action" data-decline-connection-id="${connection.id}">Cancel Request</button>` : ""}
          ${connection.status === "accepted" ? `<button type="button" class="btn-small subtle-danger-action" data-remove-user-id="${otherId}">Remove</button>` : ""}
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

function collapseExpandableCard(card) {
  const button = card.querySelector("[data-expand-card]");
  const details = button ? document.getElementById(button.getAttribute("aria-controls")) : null;
  card.classList.remove("is-expanded");
  button?.setAttribute("aria-expanded", "false");
  if (button) button.textContent = "More details";
  if (details) details.hidden = true;
}

function toggleExpandableCard(button) {
  const card = button.closest(".expandable-profile-card");
  const list = button.closest(".network-list");
  const details = document.getElementById(button.getAttribute("aria-controls"));
  if (!card || !details) return;

  const shouldExpand = button.getAttribute("aria-expanded") !== "true";
  list?.querySelectorAll(".expandable-profile-card.is-expanded").forEach((openCard) => {
    if (openCard !== card) collapseExpandableCard(openCard);
  });

  card.classList.toggle("is-expanded", shouldExpand);
  button.setAttribute("aria-expanded", String(shouldExpand));
  details.hidden = !shouldExpand;
  button.textContent = shouldExpand ? "Hide details" : "More details";
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelectorAll(".expandable-profile-card.is-expanded").forEach(collapseExpandableCard);
});

document.addEventListener("click", async (event) => {
  const toggle = event.target.closest("[data-expand-card]");
  if (toggle) {
    toggleExpandableCard(toggle);
    return;
  }

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
      await openConversationWithUser(currentUser.uid, message.dataset.messageUserId);
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


