import { auth, db } from "./firebase.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const FUNCTIONS_BASE_URL = "https://europe-west1-sangat-works.cloudfunctions.net";

export const MESSAGE_MAX_LENGTH = 2000;

export function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function getDisplayName(profile) {
  return profile?.businessName || profile?.fullName || profile?.displayName || profile?.email || "Sangat Works Member";
}

export function getMemberLine(profile) {
  return [profile?.serviceTitle, profile?.businessName, profile?.town]
    .filter(Boolean)
    .join(" / ");
}

export function getPairId(a, b) {
  return [a, b].sort().join("__");
}

export function timestampToDate(value) {
  if (!value) return null;
  const date = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatShortTime(value) {
  const date = timestampToDate(value);
  if (!date) return "";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

async function callMemberFunction(name, body = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please sign in first.");

  const token = await user.getIdToken();
  let response;
  try {
    response = await fetch(`${FUNCTIONS_BASE_URL}/${name}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    console.error(`Cloud Function ${name} was not reachable`, error);
    throw new Error("Messaging is temporarily unavailable.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Messaging is temporarily unavailable.");
  return data;
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, "users", uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getConversationById(conversationId) {
  const snap = await getDoc(doc(db, "conversations", conversationId));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getConnection(currentUserId, otherUserId) {
  if (!currentUserId || !otherUserId || currentUserId === otherUserId) return null;
  const snap = await getDoc(doc(db, "connections", getPairId(currentUserId, otherUserId)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function sendConnectionRequest(currentUserId, otherUserId) {
  return callMemberFunction("sendConnectionRequest", { targetUserId: otherUserId });
}

export async function acceptConnection(currentUserId, connectionId) {
  return callMemberFunction("acceptConnection", { connectionId });
}

export async function declineConnection(currentUserId, connectionId) {
  return callMemberFunction("declineConnection", { connectionId });
}

export async function removeConnection(currentUserId, otherUserId) {
  return callMemberFunction("removeConnection", { otherUserId });
}

export async function blockMember(currentUserId, otherUserId) {
  return callMemberFunction("blockMember", { targetUserId: otherUserId });
}

export async function unblockMember(currentUserId, otherUserId) {
  return callMemberFunction("unblockMember", { targetUserId: otherUserId });
}

export async function createOrOpenDirectConversation(currentUserId, otherUserId) {
  const data = await callMemberFunction("createOrOpenDirectConversation", { targetUserId: otherUserId });
  return data.conversationId;
}

export async function openConversationWithUser(currentUserId, otherUserId) {
  const conversationId = await createOrOpenDirectConversation(currentUserId, otherUserId);
  window.location.href = `messages.html?conversation=${encodeURIComponent(conversationId)}`;
  return conversationId;
}

export async function sendMessage(currentUserId, conversationId, text) {
  const cleanText = String(text || "").trim();
  if (!cleanText) throw new Error("Write a message first.");
  if (cleanText.length > MESSAGE_MAX_LENGTH) throw new Error(`Messages are limited to ${MESSAGE_MAX_LENGTH} characters.`);
  return callMemberFunction("sendMessage", { conversationId, text: cleanText });
}

export async function acceptMessageRequest(currentUserId, conversationId) {
  return callMemberFunction("acceptMessageRequest", { conversationId });
}

export async function declineMessageRequest(currentUserId, conversationId) {
  return callMemberFunction("declineMessageRequest", { conversationId });
}

export async function markConversationRead(currentUserId, conversationId) {
  return callMemberFunction("markConversationRead", { conversationId });
}

export async function setConversationUserFlag(currentUserId, conversationId, field, value) {
  if (!["archivedBy", "mutedBy"].includes(field)) return null;
  return callMemberFunction("setConversationUserFlag", { conversationId, field, value: Boolean(value) });
}

export function listenToConversations(currentUserId, callback, onError) {
  const conversationsQuery = query(
    collection(db, "conversations"),
    where("participantIds", "array-contains", currentUserId),
    orderBy("updatedAt", "desc"),
    limit(40)
  );

  return onSnapshot(conversationsQuery, (snapshot) => {
    callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })));
  }, (error) => {
    console.error("Could not load conversations", error);
    if (onError) onError(error);
  });
}

export function listenToMessages(conversationId, callback, onError) {
  const messagesQuery = query(
    collection(db, "conversations", conversationId, "messages"),
    orderBy("createdAt", "desc"),
    limit(50)
  );

  return onSnapshot(messagesQuery, (snapshot) => {
    callback(snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() })).reverse());
  }, (error) => {
    console.error("Could not load messages", error);
    if (onError) onError(error);
  });
}

export async function reportMember(reporterId, reportedUserId, reason, details = "") {
  return callMemberFunction("reportMember", { reportedUserId, reason, details });
}

export async function reportMessage(reporterId, conversation, message, reason) {
  return callMemberFunction("reportMessage", {
    conversationId: conversation.id,
    messageId: message.id,
    reason
  });
}

export async function getNetworkConnections(currentUserId) {
  const snapshot = await getDocs(query(
    collection(db, "connections"),
    where("userIds", "array-contains", currentUserId)
  ));
  return snapshot.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}
