import { protectPage } from "./subscription-guard.js";
import {
  acceptMessageRequest,
  blockMember,
  createOrOpenDirectConversation,
  declineMessageRequest,
  escapeHtml,
  formatShortTime,
  getConversationById,
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
const messagesShell = document.querySelector(".messages-shell");

let currentUser = null;
let conversations = [];
let selectedConversation = null;
let requestedConversationId = "";
let unsubscribeConversations = null;
let unsubscribeMessages = null;
let profileCache = new Map();
let latestMessages = [];

function setStatus(message) {
  if (messagesStatus) messagesStatus.textContent = message || "";
}

function setListState(message) {
  if (conversationList) conversationList.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function setEmptyChat(title, detail = "") {
  chatHeader.innerHTML = `<div class="empty-state">${escapeHtml(title)}</div>`;
  messagesList.innerHTML = detail ? `<div class="empty-state">${escapeHtml(detail)}</div>` : "";
  messageRequestActions.classList.add("hidden");
  composer.classList.add("hidden");
  messagesShell?.classList.remove("conversation-open");
}

async function profileFor(uid) {
  if (!uid) return null;
  if (!profileCache.has(uid)) profileCache.set(uid, await getUserProfile(uid));
  return profileCache.get(uid);
}

function getOtherId(conversation) {
  return (conversation?.participantIds || []).find((id) => id !== currentUser.uid) || "";
}

function displayNameFor(conversation, profile) {
  const otherId = getOtherId(conversation);
  if (profile) return getDisplayName(profile);
  return conversation?.participantNames?.[otherId] || "Sangat Works Member";
}

function upsertConversation(conversation) {
  if (!conversation?.id) return;
  const index = conversations.findIndex((item) => item.id === conversation.id);
  if (index >= 0) conversations[index] = conversation;
  else conversations = [conversation, ...conversations];
}

function syncUrl(conversationId) {
  const url = new URL(window.location.href);
  if (conversationId) url.searchParams.set("conversation", conversationId);
  else url.searchParams.delete("conversation");
  window.history.replaceState({}, "", `${url.pathname}${url.search}`);
}

async function renderConversationList() {
  const filter = (conversationSearch?.value || "").trim().toLowerCase();
  const visible = [];

  for (const conversation of conversations) {
    if (conversation.archivedBy?.[currentUser.uid]) continue;
    const other = await profileFor(getOtherId(conversation));
    const name = displayNameFor(conversation, other);
    if (filter && !name.toLowerCase().includes(filter)) continue;
    visible.push(renderConversationRow(conversation, other));
  }

  conversationList.innerHTML = visible.join("") || `<div class="empty-state">No conversations yet. Connect with members or message someone from their profile to get started.</div>`;
}

function renderConversationRow(conversation, profile) {
  const unread = Number(conversation.unreadCounts?.[currentUser.uid] || 0);
  const active = selectedConversation?.id === conversation.id ? "active" : "";
  const isRequest = conversation.status === "requested";
  const preview = conversation.lastMessage || (isRequest ? "Message request" : "No messages yet");
  return `
    <button type="button" class="conversation-row ${active}" data-conversation-id="${escapeHtml(conversation.id)}">
      <span class="conversation-avatar">${escapeHtml(displayNameFor(conversation, profile).slice(0, 1))}</span>
      <span class="conversation-row-main">
        <strong>${escapeHtml(displayNameFor(conversation, profile))}</strong>
        <span>${escapeHtml(preview.slice(0, 90))}</span>
      </span>
      <span class="conversation-meta">
        ${isRequest ? `<em>Request</em>` : ""}
        <span>${escapeHtml(formatShortTime(conversation.lastMessageAt))}</span>
        ${unread ? `<b>${unread}</b>` : ""}
      </span>
    </button>
  `;
}

async function openConversation(conversation, options = {}) {
  selectedConversation = conversation;
  latestMessages = [];
  if (unsubscribeMessages) unsubscribeMessages();
  upsertConversation(conversation);
  syncUrl(conversation.id);
  messagesShell?.classList.add("conversation-open");

  try {
    await markConversationRead(currentUser.uid, selectedConversation.id);
  } catch (error) {
    console.warn("Could not mark conversation as read", error);
  }

  await renderChatHeader();
  renderRequestActions();
  renderComposer();
  messagesList.innerHTML = `<div class="empty-state">Loading messages...</div>`;

  unsubscribeMessages = listenToMessages(selectedConversation.id, async (messages) => {
    latestMessages = messages;
    messagesList.innerHTML = messages.length
      ? messages.map(renderMessageBubble).join("")
      : `<div class="empty-state">No messages yet. Send the first message.</div>`;
    messagesList.scrollTop = messagesList.scrollHeight;
    try {
      await markConversationRead(currentUser.uid, selectedConversation.id);
    } catch (error) {
      console.warn("Could not mark conversation as read", error);
    }
  }, (error) => {
    messagesList.innerHTML = `<div class="empty-state">Could not load messages. Please refresh or try again.</div>`;
    setStatus(getFriendlyError(error));
  });

  await renderConversationList();
  if (options.focus !== false && !composer.classList.contains("hidden")) {
    messageText?.focus();
  }
}

async function selectConversation(conversationId) {
  if (!conversationId) {
    setEmptyChat("Select a conversation.", "No conversation selected.");
    return;
  }

  const existing = conversations.find((conversation) => conversation.id === conversationId);
  if (existing) {
    await openConversation(existing);
    return;
  }

  try {
    const fetched = await getConversationById(conversationId);
    if (!fetched) {
      setEmptyChat("Conversation not found.", "This conversation may have been removed or the link is invalid.");
      return;
    }
    if (!(fetched.participantIds || []).includes(currentUser.uid)) {
      setEmptyChat("Conversation unavailable.", "You do not have access to this conversation.");
      return;
    }
    await openConversation(fetched);
  } catch (error) {
    console.error("Could not open conversation", error);
    setEmptyChat("Could not open this conversation.", "Please refresh or try again.");
    setStatus(getFriendlyError(error));
  }
}

async function renderChatHeader() {
  const otherId = getOtherId(selectedConversation);
  const other = await profileFor(otherId);
  chatHeader.innerHTML = `
    <button type="button" class="btn-small messages-back-btn" data-back-to-conversations>Back</button>
    <div class="chat-member-summary">
      <span class="conversation-avatar large">${escapeHtml(displayNameFor(selectedConversation, other).slice(0, 1))}</span>
      <div>
        <h2>${escapeHtml(displayNameFor(selectedConversation, other))}</h2>
        <p>${escapeHtml(getMemberLine(other) || "Sangat Works Member")}</p>
      </div>
    </div>
    <div class="chat-actions">
      <a href="view.html?id=${encodeURIComponent(otherId)}" class="btn-small">View Profile</a>
      <button type="button" class="btn-small" data-toggle-mute>${selectedConversation.mutedBy?.[currentUser.uid] ? "Unmute" : "Mute"}</button>
      <button type="button" class="btn-small" data-archive-conversation>Archive</button>
      <button type="button" class="btn-small project-withdraw-btn" data-block-user-id="${escapeHtml(otherId)}">Block</button>
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
    messageRequestActions.innerHTML = `<strong>Message request sent.</strong>`;
  } else {
    messageRequestActions.innerHTML = "";
  }
}

function renderComposer() {
  const canSend = selectedConversation && ["active", "requested"].includes(selectedConversation.status);
  composer.classList.toggle("hidden", !canSend);
}

function renderMessageBubble(message) {
  const mine = message.senderId === currentUser.uid;
  return `
    <div class="message-bubble ${mine ? "sent" : "received"}">
      <p>${escapeHtml(message.text)}</p>
      <span>${escapeHtml(formatShortTime(message.createdAt))}</span>
      ${!mine ? `<button type="button" data-report-message-id="${escapeHtml(message.id)}">Report</button>` : ""}
    </div>
  `;
}

function getFriendlyError(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.includes("permission") || message.includes("denied")) return "You cannot access this conversation.";
  if (message.includes("index")) return "Could not load your conversations. Please refresh or try again.";
  if (message.includes("blocked")) return "You cannot message this member.";
  if (message.includes("connections")) return "This member only accepts messages from connections.";
  return error?.message || "Messaging is temporarily unavailable.";
}

conversationList?.addEventListener("click", (event) => {
  const row = event.target.closest("[data-conversation-id]");
  if (row) selectConversation(row.dataset.conversationId);
});

conversationSearch?.addEventListener("input", renderConversationList);

composer?.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedConversation) return;
  try {
    await sendMessage(currentUser.uid, selectedConversation.id, messageText.value);
    messageText.value = "";
    setStatus("");
  } catch (error) {
    console.error("Could not send message", error);
    setStatus(getFriendlyError(error));
  }
});

messageText?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    composer.requestSubmit();
  }
});

document.addEventListener("click", async (event) => {
  if (!selectedConversation) return;
  try {
    if (event.target.closest("[data-back-to-conversations]")) {
      messagesShell?.classList.remove("conversation-open");
      return;
    }
    if (event.target.closest("[data-accept-message-request]")) {
      await acceptMessageRequest(currentUser.uid, selectedConversation.id);
      const updated = await getConversationById(selectedConversation.id);
      if (updated) await openConversation(updated);
    }
    if (event.target.closest("[data-decline-message-request]")) {
      await declineMessageRequest(currentUser.uid, selectedConversation.id);
      const updated = await getConversationById(selectedConversation.id);
      if (updated) await openConversation(updated, { focus: false });
    }
    if (event.target.closest("[data-toggle-mute]")) {
      await setConversationUserFlag(currentUser.uid, selectedConversation.id, "mutedBy", !selectedConversation.mutedBy?.[currentUser.uid]);
    }
    if (event.target.closest("[data-archive-conversation]")) {
      await setConversationUserFlag(currentUser.uid, selectedConversation.id, "archivedBy", true);
      messagesShell?.classList.remove("conversation-open");
    }
    const block = event.target.closest("[data-block-user-id]");
    if (block && window.confirm("Block this member? They will not be able to message or connect with you.")) {
      await blockMember(currentUser.uid, block.dataset.blockUserId);
      setStatus("Member blocked.");
    }
    const report = event.target.closest("[data-report-message-id]");
    if (report) {
      const reason = window.prompt("Report reason: spam, harassment, scam/fraud, inappropriate content, or other", "spam");
      const message = latestMessages.find((item) => item.id === report.dataset.reportMessageId);
      if (reason && message) {
        await reportMessage(currentUser.uid, selectedConversation, message, reason);
        setStatus("Report submitted.");
      }
    }
  } catch (error) {
    console.error("Message action failed", error);
    setStatus(getFriendlyError(error));
  }
});

protectPage({
  onAllowed: async (user) => {
    currentUser = user;
    const params = new URLSearchParams(window.location.search);
    const targetUserId = params.get("user");
    requestedConversationId = params.get("conversation") || "";

    if (targetUserId) {
      try {
        requestedConversationId = await createOrOpenDirectConversation(currentUser.uid, targetUserId);
        syncUrl(requestedConversationId);
      } catch (error) {
        console.error("Could not start conversation", error);
        setEmptyChat("Could not start this conversation.", getFriendlyError(error));
        setListState("Couldn't load your conversations. Please refresh or try again.");
      }
    }

    if (requestedConversationId) {
      await selectConversation(requestedConversationId);
    }

    unsubscribeConversations = listenToConversations(currentUser.uid, async (items) => {
      conversations = items;
      if (selectedConversation && !conversations.some((item) => item.id === selectedConversation.id)) {
        upsertConversation(selectedConversation);
      }
      await renderConversationList();

      const selectedId = new URLSearchParams(window.location.search).get("conversation");
      if (selectedId && (!selectedConversation || selectedConversation.id !== selectedId)) {
        await selectConversation(selectedId);
      } else if (selectedConversation) {
        const updated = conversations.find((item) => item.id === selectedConversation.id);
        if (updated) {
          selectedConversation = updated;
          await renderChatHeader();
          renderRequestActions();
          renderComposer();
          await renderConversationList();
        }
      }
    }, (error) => {
      setListState("Couldn't load your conversations. Please refresh or try again.");
      setStatus(getFriendlyError(error));
    });
  }
});




