import { auth } from "./firebase.js";
import { protectPage } from "./subscription-guard.js";
import {
  acceptMessageRequest,
  blockMember,
  createOrOpenDirectConversation,
  declineMessageRequest,
  escapeHtml,
  formatShortTime,
  getDisplayName,
  getMemberLine,
  getUserProfile,
  listenToConversations,
  listenToMessages,
  markConversationRead,
  reportMessage,
  sendMessage,
  setConversationUserFlag
} from "./member-network.js";

const conversationList = document.getElementById("conversationList");
const conversationSearch = document.getElementById("conversationSearch");
const chatHeader = document.getElementById("chatHeader");
const messagesList = document.getElementById("messagesList");
const composer = document.getElementById("messageComposer");
const messageText = document.getElementById("messageText");
const messagesStatus = document.getElementById("messagesStatus");
const messageRequestActions = document.getElementById("messageRequestActions");

let currentUser = null;
let conversations = [];
let selectedConversation = null;
let unsubscribeConversations = null;
let unsubscribeMessages = null;
let profileCache = new Map();
let latestMessages = [];

function setStatus(message) {
  if (messagesStatus) messagesStatus.textContent = message;
}

async function profileFor(uid) {
  if (!profileCache.has(uid)) profileCache.set(uid, await getUserProfile(uid));
  return profileCache.get(uid);
}

function getOtherId(conversation) {
  return (conversation.participantIds || []).find((id) => id !== currentUser.uid);
}

async function renderConversationList() {
  const filter = (conversationSearch?.value || "").trim().toLowerCase();
  const visible = [];

  for (const conversation of conversations) {
    if (conversation.archivedBy?.[currentUser.uid]) continue;
    const other = await profileFor(getOtherId(conversation));
    const name = getDisplayName(other);
    if (filter && !name.toLowerCase().includes(filter)) continue;
    visible.push(renderConversationRow(conversation, other));
  }

  conversationList.innerHTML = visible.join("") || `<div class="empty-state">No conversations yet. Connect with members or message someone from their profile to get started.</div>`;
}

function renderConversationRow(conversation, profile) {
  const unread = Number(conversation.unreadCounts?.[currentUser.uid] || 0);
  const active = selectedConversation?.id === conversation.id ? "active" : "";
  const preview = conversation.lastMessage || (conversation.status === "requested" ? "Message request" : "No messages yet");
  return `
    <button type="button" class="conversation-row ${active}" data-conversation-id="${conversation.id}">
      <span class="conversation-avatar">${escapeHtml(getDisplayName(profile).slice(0, 1))}</span>
      <span class="conversation-row-main">
        <strong>${escapeHtml(getDisplayName(profile))}</strong>
        <span>${escapeHtml(preview.slice(0, 90))}</span>
      </span>
      <span class="conversation-meta">
        <span>${escapeHtml(formatShortTime(conversation.lastMessageAt))}</span>
        ${unread ? `<b>${unread}</b>` : ""}
      </span>
    </button>
  `;
}

async function selectConversation(conversationId) {
  selectedConversation = conversations.find((conversation) => conversation.id === conversationId) || null;
  latestMessages = [];
  if (unsubscribeMessages) unsubscribeMessages();

  if (!selectedConversation) {
    chatHeader.innerHTML = `<div class="empty-state">Select a conversation.</div>`;
    messagesList.innerHTML = `<div class="empty-state">No conversation selected.</div>`;
    composer.classList.add("hidden");
    return;
  }

  await markConversationRead(currentUser.uid, selectedConversation.id);
  await renderChatHeader();
  renderRequestActions();
  composer.classList.toggle("hidden", selectedConversation.status !== "active" && selectedConversation.requestedBy !== currentUser.uid);

  unsubscribeMessages = listenToMessages(selectedConversation.id, async (messages) => {
    latestMessages = messages;
    messagesList.innerHTML = messages.length
      ? messages.map(renderMessageBubble).join("")
      : `<div class="empty-state">No messages yet.</div>`;
    messagesList.scrollTop = messagesList.scrollHeight;
    await markConversationRead(currentUser.uid, selectedConversation.id);
  });

  await renderConversationList();
}

async function renderChatHeader() {
  const otherId = getOtherId(selectedConversation);
  const other = await profileFor(otherId);
  chatHeader.innerHTML = `
    <div class="chat-member-summary">
      <span class="conversation-avatar large">${escapeHtml(getDisplayName(other).slice(0, 1))}</span>
      <div>
        <h2>${escapeHtml(getDisplayName(other))}</h2>
        <p>${escapeHtml(getMemberLine(other) || "Sangat Works Member")}</p>
      </div>
    </div>
    <div class="chat-actions">
      <a href="view.html?id=${encodeURIComponent(otherId)}" class="btn-small">View Profile</a>
      <button type="button" class="btn-small" data-toggle-mute>${selectedConversation.mutedBy?.[currentUser.uid] ? "Unmute" : "Mute"}</button>
      <button type="button" class="btn-small" data-archive-conversation>Archive</button>
      <button type="button" class="btn-small project-withdraw-btn" data-block-user-id="${otherId}">Block</button>
    </div>
  `;
}

function renderRequestActions() {
  const isRecipientRequest = selectedConversation.status === "requested" && selectedConversation.requestedBy !== currentUser.uid;
  const isSenderRequest = selectedConversation.status === "requested" && selectedConversation.requestedBy === currentUser.uid;
  messageRequestActions.classList.toggle("hidden", !isRecipientRequest && !isSenderRequest);
  if (isRecipientRequest) {
    messageRequestActions.innerHTML = `
      <strong>Message request</strong>
      <button type="button" class="btn-small project-accept-btn" data-accept-message-request>Accept</button>
      <button type="button" class="btn-small project-reject-btn" data-decline-message-request>Decline</button>
    `;
  } else if (isSenderRequest) {
    messageRequestActions.innerHTML = `<strong>Message request pending.</strong>`;
  }
}

function renderMessageBubble(message) {
  const mine = message.senderId === currentUser.uid;
  return `
    <div class="message-bubble ${mine ? "sent" : "received"}">
      <p>${escapeHtml(message.text)}</p>
      <span>${escapeHtml(formatShortTime(message.createdAt))}</span>
      ${!mine ? `<button type="button" data-report-message-id="${message.id}">Report</button>` : ""}
    </div>
  `;
}

conversationList?.addEventListener("click", (event) => {
  const row = event.target.closest("[data-conversation-id]");
  if (row) selectConversation(row.dataset.conversationId);
});

conversationSearch?.addEventListener("input", renderConversationList);

composer?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    await sendMessage(currentUser.uid, selectedConversation.id, messageText.value);
    messageText.value = "";
    setStatus("");
  } catch (error) {
    setStatus(error.message);
  }
});

messageText?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

document.addEventListener("click", async (event) => {
  try {
    if (event.target.closest("[data-accept-message-request]")) {
      await acceptMessageRequest(currentUser.uid, selectedConversation.id);
    }
    if (event.target.closest("[data-decline-message-request]")) {
      await declineMessageRequest(currentUser.uid, selectedConversation.id);
    }
    if (event.target.closest("[data-toggle-mute]")) {
      await setConversationUserFlag(currentUser.uid, selectedConversation.id, "mutedBy", !selectedConversation.mutedBy?.[currentUser.uid]);
    }
    if (event.target.closest("[data-archive-conversation]")) {
      await setConversationUserFlag(currentUser.uid, selectedConversation.id, "archivedBy", true);
    }
    const block = event.target.closest("[data-block-user-id]");
    if (block && window.confirm("Block this member? They will not be able to message or connect with you.")) {
      await blockMember(currentUser.uid, block.dataset.blockUserId);
    }
    const report = event.target.closest("[data-report-message-id]");
    if (report) {
      const reason = window.prompt("Report reason: spam, harassment, scam/fraud, inappropriate content, or other", "spam");
      const message = latestMessages.find((item) => item.id === report.dataset.reportMessageId);
      if (reason && message) await reportMessage(currentUser.uid, selectedConversation, message, reason);
    }
  } catch (error) {
    setStatus(error.message);
  }
});

protectPage({
  onAllowed: async (user) => {
    currentUser = user;
    const params = new URLSearchParams(window.location.search);
    const targetUserId = params.get("user");
    if (targetUserId) {
      try {
        const conversationId = await createOrOpenDirectConversation(currentUser.uid, targetUserId);
        window.history.replaceState({}, "", `messages.html?conversation=${encodeURIComponent(conversationId)}`);
      } catch (error) {
        setStatus(error.message);
      }
    }

    unsubscribeConversations = listenToConversations(currentUser.uid, async (items) => {
      conversations = items;
      const selectedId = new URLSearchParams(window.location.search).get("conversation");
      await renderConversationList();
      if (selectedId && (!selectedConversation || selectedConversation.id !== selectedId)) {
        await selectConversation(selectedId);
      } else if (selectedConversation) {
        selectedConversation = conversations.find((item) => item.id === selectedConversation.id) || selectedConversation;
        await renderChatHeader();
        renderRequestActions();
      }
    });
  }
});
