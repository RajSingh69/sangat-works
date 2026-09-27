// Member networking and messaging trusted API.
const {
  admin,
  getUserRole,
  isActiveMember,
  isSuperAdmin,
  onRequest
} = require("./shared");

// =========================================
// Member Networking / Messaging Trusted API
// =========================================
const NETWORKING_CORS_ORIGIN = "https://sangatworks.co.uk";
const MESSAGE_MAX_LENGTH = 2000;
const REPORT_REASONS = new Set(["spam", "harassment", "scam_fraud", "scam/fraud", "inappropriate", "inappropriate_content", "other"]);

function setNetworkingCors(res) {
  res.set("Access-Control-Allow-Origin", NETWORKING_CORS_ORIGIN);
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function parseBody(req) {
  return typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
}

async function getAuthenticatedUser(req) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer (.+)$/);

  if (!match) {
    const error = new Error("Authentication required");
    error.status = 401;
    throw error;
  }

  const decodedToken = await admin.auth().verifyIdToken(match[1]);
  const userSnap = await admin.firestore().collection("users").doc(decodedToken.uid).get();

  if (!userSnap.exists) {
    const error = new Error("Sangat Works profile required");
    error.status = 403;
    throw error;
  }

  return {
    uid: decodedToken.uid,
    email: decodedToken.email || userSnap.data().email || "",
    data: userSnap.data()
  };
}

function assertActiveMember(authUser) {
  if (!isActiveMember(authUser.data)) {
    const error = new Error("Active Sangat Works membership required");
    error.status = 403;
    throw error;
  }

  if (authUser.data.messagingRestricted === true || authUser.data.banned === true || authUser.data.suspended === true) {
    const error = new Error("This account is currently restricted");
    error.status = 403;
    throw error;
  }
}

function pairId(a, b) {
  return [a, b].sort().join("__");
}

function blockId(blockerId, blockedId) {
  return `${blockerId}__${blockedId}`;
}

async function blockExists(userAId, userBId) {
  const db = admin.firestore();
  const [aBlocksB, bBlocksA] = await Promise.all([
    db.collection("blocks").doc(blockId(userAId, userBId)).get(),
    db.collection("blocks").doc(blockId(userBId, userAId)).get()
  ]);

  return aBlocksB.exists || bBlocksA.exists;
}

function getSafeDisplayName(userData) {
  return userData.businessName || userData.fullName || userData.displayName || userData.email || "Sangat Works Member";
}

async function createMemberNotification({ recipientId, senderId, type, connectionId = "", conversationId = "" }) {
  if (!recipientId || recipientId === senderId) return;

  const recipientSnap = await admin.firestore().collection("users").doc(recipientId).get();
  const recipient = recipientSnap.exists ? recipientSnap.data() : {};

  if (recipient.allowMessageNotifications === false) return;
  if (await blockExists(recipientId, senderId)) return;

  await admin.firestore().collection("notifications").add({
    userId: recipientId,
    recipientId,
    senderId,
    type,
    connectionId,
    conversationId,
    read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

function sendNetworkingError(res, error) {
  console.error("Networking API error:", error);
  return res.status(error.status || 500).json({
    error: error.status ? error.message : "Request failed"
  });
}

function networkingEndpoint(handler) {
  return onRequest(
    {
      region: "europe-west1",
      cors: true,
      maxInstances: 10
    },
    async (req, res) => {
      setNetworkingCors(res);

      if (req.method === "OPTIONS") {
        return res.status(204).send("");
      }

      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      try {
        const authUser = await getAuthenticatedUser(req);
        return await handler(req, res, authUser, parseBody(req));
      } catch (error) {
        return sendNetworkingError(res, error);
      }
    }
  );
}



async function writeAdminAuditLog(action, actorUid, targetUid, details = {}) {
  await admin.firestore().collection("adminAuditLogs").add({
    action,
    actorUid,
    targetUid,
    details,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

function requireSuperAdmin(authUser) {
  if (!isSuperAdmin(authUser.data)) {
    const error = new Error("Super Admins only");
    error.status = 403;
    throw error;
  }
}

async function loadAdminTargetUser(targetUserId) {
  const snap = await admin.firestore().collection("users").doc(targetUserId).get();
  if (!snap.exists) {
    const error = new Error("Target user not found");
    error.status = 404;
    throw error;
  }
  return snap;
}

function rejectInternalTarget(targetSnap) {
  if (targetSnap.data().internalAccount === true) {
    const error = new Error("Permanent internal accounts cannot be changed here");
    error.status = 403;
    throw error;
  }
}

exports.updateUserRole = networkingEndpoint(async (req, res, authUser, body) => {
  requireSuperAdmin(authUser);
  const targetUserId = String(body.targetUserId || "").trim();
  const role = String(body.role || "").trim();
  if (!targetUserId || targetUserId === authUser.uid || !["standard", "member", "moderator", "admin", "super_admin"].includes(role)) {
    return res.status(400).json({ error: "Invalid role change" });
  }

  const targetSnap = await loadAdminTargetUser(targetUserId);
  rejectInternalTarget(targetSnap);
  await targetSnap.ref.set({
    role,
    internalAccount: role === "super_admin",
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });
  await writeAdminAuditLog("update_user_role", authUser.uid, targetUserId, { role });
  return res.status(200).json({ updated: true, role });
});
exports.trackProfileMetric = networkingEndpoint(async (req, res, authUser, body) => {
  const targetUserId = String(body.targetUserId || "").trim();
  const metric = String(body.metric || "").trim();
  const allowedMetrics = new Set(["profileViews", "websiteClicks", "linkedinClicks", "googleReviewClicks"]);

  if (!targetUserId || !allowedMetrics.has(metric)) {
    return res.status(400).json({ error: "Invalid profile metric" });
  }

  const targetRef = admin.firestore().collection("users").doc(targetUserId);
  const targetSnap = await targetRef.get();
  if (!targetSnap.exists) return res.status(404).json({ error: "Profile not found" });

  await targetRef.update({ [metric]: admin.firestore.FieldValue.increment(1) });
  return res.status(200).json({ tracked: true, metric });
});

exports.voteFeature = networkingEndpoint(async (req, res, authUser, body) => {
  const featureId = String(body.featureId || "").trim();
  const vote = String(body.vote || "").trim();

  if (!featureId || !["up", "down", "none"].includes(vote)) {
    return res.status(400).json({ error: "Invalid vote" });
  }

  const db = admin.firestore();
  const featureRef = db.collection("futureFeatures").doc(featureId);
  const voteRef = featureRef.collection("votes").doc(authUser.uid);

  await db.runTransaction(async (transaction) => {
    const featureSnap = await transaction.get(featureRef);
    if (!featureSnap.exists || featureSnap.data().active === false) {
      throw Object.assign(new Error("Feature not available"), { status: 404 });
    }

    const voteSnap = await transaction.get(voteRef);
    const oldVote = voteSnap.exists ? voteSnap.data().vote : "none";
    if (oldVote === vote) return;

    let upvotes = Number(featureSnap.data().upvotes || 0);
    let downvotes = Number(featureSnap.data().downvotes || 0);
    if (oldVote === "up") upvotes = Math.max(0, upvotes - 1);
    if (oldVote === "down") downvotes = Math.max(0, downvotes - 1);
    if (vote === "up") upvotes += 1;
    if (vote === "down") downvotes += 1;

    transaction.update(featureRef, {
      upvotes,
      downvotes,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    if (vote === "none") {
      transaction.delete(voteRef);
    } else {
      transaction.set(voteRef, {
        vote,
        userId: authUser.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  });

  return res.status(200).json({ voted: true, vote });
});
exports.sendConnectionRequest = networkingEndpoint(async (req, res, authUser, body) => {
  assertActiveMember(authUser);
  const targetUserId = String(body.targetUserId || body.userId || "").trim();

  if (!targetUserId || targetUserId === authUser.uid) {
    return res.status(400).json({ error: "Choose another member to connect with" });
  }

  const db = admin.firestore();
  const targetSnap = await db.collection("users").doc(targetUserId).get();

  if (!targetSnap.exists || !isActiveMember(targetSnap.data())) {
    return res.status(404).json({ error: "Member not available" });
  }

  if (targetSnap.data().connectionPrivacy === "nobody") {
    return res.status(403).json({ error: "This member is not accepting connection requests" });
  }

  if (await blockExists(authUser.uid, targetUserId)) {
    return res.status(403).json({ error: "This member is not available for new connection requests" });
  }

  const id = pairId(authUser.uid, targetUserId);
  const connectionRef = db.collection("connections").doc(id);

  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(connectionRef);

    if (existing.exists && ["pending", "accepted", "blocked"].includes(existing.data().status)) {
      throw Object.assign(new Error("A connection or request already exists"), { status: 409 });
    }

    transaction.set(connectionRef, {
      userIds: [authUser.uid, targetUserId],
      requesterId: authUser.uid,
      recipientId: targetUserId,
      requestedBy: authUser.uid,
      requesterName: getSafeDisplayName(authUser.data),
      recipientName: getSafeDisplayName(targetSnap.data()),
      status: "pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  await createMemberNotification({ recipientId: targetUserId, senderId: authUser.uid, type: "connection_request", connectionId: id });
  return res.status(200).json({ connectionId: id, status: "pending" });
});

exports.acceptConnection = networkingEndpoint(async (req, res, authUser, body) => {
  assertActiveMember(authUser);
  const connectionId = String(body.connectionId || "").trim();
  const db = admin.firestore();
  const connectionRef = db.collection("connections").doc(connectionId);
  let requesterId = "";

  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(connectionRef);
    if (!snap.exists) throw Object.assign(new Error("Connection request not found"), { status: 404 });
    const data = snap.data();
    if (data.recipientId !== authUser.uid || data.status !== "pending") {
      throw Object.assign(new Error("You cannot accept this request"), { status: 403 });
    }
    requesterId = data.requesterId;
    transaction.update(connectionRef, {
      status: "accepted",
      acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  if (requesterId && !(await blockExists(authUser.uid, requesterId))) {
    await createMemberNotification({ recipientId: requesterId, senderId: authUser.uid, type: "connection_accepted", connectionId });
  }

  return res.status(200).json({ connectionId, status: "accepted" });
});

exports.declineConnection = networkingEndpoint(async (req, res, authUser, body) => {
  assertActiveMember(authUser);
  const connectionId = String(body.connectionId || "").trim();
  const ref = admin.firestore().collection("connections").doc(connectionId);
  const snap = await ref.get();

  if (!snap.exists) return res.status(404).json({ error: "Connection request not found" });
  const data = snap.data();

  if (data.recipientId !== authUser.uid) {
    return res.status(403).json({ error: "Only the recipient can decline this request" });
  }

  await ref.update({ status: "declined", updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  return res.status(200).json({ connectionId, status: "declined" });
});

exports.removeConnection = networkingEndpoint(async (req, res, authUser, body) => {
  assertActiveMember(authUser);
  const otherUserId = String(body.otherUserId || body.userId || "").trim();
  const connectionId = body.connectionId || pairId(authUser.uid, otherUserId);
  const ref = admin.firestore().collection("connections").doc(connectionId);
  const snap = await ref.get();

  if (!snap.exists) return res.status(404).json({ error: "Connection not found" });
  if (!(snap.data().userIds || []).includes(authUser.uid)) {
    return res.status(403).json({ error: "You cannot remove this connection" });
  }

  await ref.update({ status: "removed", removedBy: authUser.uid, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  return res.status(200).json({ connectionId, status: "removed" });
});

exports.blockMember = networkingEndpoint(async (req, res, authUser, body) => {
  assertActiveMember(authUser);
  const targetUserId = String(body.targetUserId || body.userId || "").trim();

  if (!targetUserId || targetUserId === authUser.uid) {
    return res.status(400).json({ error: "Choose another member to block" });
  }

  const db = admin.firestore();
  const blockRef = db.collection("blocks").doc(blockId(authUser.uid, targetUserId));
  const connectionRef = db.collection("connections").doc(pairId(authUser.uid, targetUserId));

  await db.runTransaction(async (transaction) => {
    transaction.set(blockRef, {
      blockerId: authUser.uid,
      blockedId: targetUserId,
      pairId: pairId(authUser.uid, targetUserId),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    transaction.set(connectionRef, {
      userIds: [authUser.uid, targetUserId],
      status: "blocked",
      blockedBy: authUser.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true });
  });

  return res.status(200).json({ blocked: true });
});

exports.unblockMember = networkingEndpoint(async (req, res, authUser, body) => {
  const targetUserId = String(body.targetUserId || body.userId || "").trim();
  if (!targetUserId || targetUserId === authUser.uid) {
    return res.status(400).json({ error: "Choose another member to unblock" });
  }
  if (authUser.data.banned === true || authUser.data.suspended === true) {
    return res.status(403).json({ error: "This account is currently restricted" });
  }
  await admin.firestore().collection("blocks").doc(blockId(authUser.uid, targetUserId)).delete();
  return res.status(200).json({ unblocked: true });
});

exports.createOrOpenDirectConversation = networkingEndpoint(async (req, res, authUser, body) => {
  assertActiveMember(authUser);
  const targetUserId = String(body.targetUserId || body.userId || "").trim();

  if (!targetUserId || targetUserId === authUser.uid) {
    return res.status(400).json({ error: "Choose another member to message" });
  }

  const db = admin.firestore();
  const [targetSnap, connectionSnap] = await Promise.all([
    db.collection("users").doc(targetUserId).get(),
    db.collection("connections").doc(pairId(authUser.uid, targetUserId)).get()
  ]);

  if (!targetSnap.exists || !isActiveMember(targetSnap.data())) {
    return res.status(404).json({ error: "Member not available" });
  }

  if (await blockExists(authUser.uid, targetUserId)) {
    return res.status(403).json({ error: "Messaging is unavailable for this member" });
  }

  const connected = connectionSnap.exists && connectionSnap.data().status === "accepted";
  if (targetSnap.data().messagePrivacy === "connections" && !connected) {
    return res.status(403).json({ error: "This member only accepts messages from connections" });
  }

  const conversationId = pairId(authUser.uid, targetUserId);
  const conversationRef = db.collection("conversations").doc(conversationId);
  const status = connected ? "active" : "requested";

  await db.runTransaction(async (transaction) => {
    const existing = await transaction.get(conversationRef);
    if (existing.exists) return;
    transaction.set(conversationRef, {
      type: "direct",
      participantIds: [authUser.uid, targetUserId],
      participantNames: {
        [authUser.uid]: getSafeDisplayName(authUser.data),
        [targetUserId]: getSafeDisplayName(targetSnap.data())
      },
      requestedBy: authUser.uid,
      status,
      lastMessage: "",
      lastMessageAt: null,
      lastMessageSenderId: "",
      unreadCounts: {
        [authUser.uid]: 0,
        [targetUserId]: 0
      },
      archivedBy: {},
      mutedBy: {},
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
  });

  if (status === "requested") {
    await createMemberNotification({ recipientId: targetUserId, senderId: authUser.uid, type: "message_request", conversationId });
  }

  return res.status(200).json({ conversationId, status });
});

async function updateMessageRequest(req, res, authUser, body, nextStatus) {
  assertActiveMember(authUser);
  const conversationId = String(body.conversationId || "").trim();
  const ref = admin.firestore().collection("conversations").doc(conversationId);
  const snap = await ref.get();

  if (!snap.exists) return res.status(404).json({ error: "Conversation not found" });
  const data = snap.data();
  if (!(data.participantIds || []).includes(authUser.uid) || data.requestedBy === authUser.uid || data.status !== "requested") {
    return res.status(403).json({ error: "You cannot update this message request" });
  }

  await ref.update({ status: nextStatus, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
  return res.status(200).json({ conversationId, status: nextStatus });
}

exports.acceptMessageRequest = networkingEndpoint((req, res, authUser, body) => updateMessageRequest(req, res, authUser, body, "active"));
exports.declineMessageRequest = networkingEndpoint((req, res, authUser, body) => updateMessageRequest(req, res, authUser, body, "declined"));

exports.sendMessage = networkingEndpoint(async (req, res, authUser, body) => {
  assertActiveMember(authUser);
  const conversationId = String(body.conversationId || "").trim();
  const text = String(body.text || "").trim();

  if (!text) return res.status(400).json({ error: "Write a message first" });
  if (text.length > MESSAGE_MAX_LENGTH) return res.status(400).json({ error: `Messages are limited to ${MESSAGE_MAX_LENGTH} characters` });

  const db = admin.firestore();
  const conversationRef = db.collection("conversations").doc(conversationId);
  const messageRef = conversationRef.collection("messages").doc();
  let otherUserId = "";

  await db.runTransaction(async (transaction) => {
    const conversationSnap = await transaction.get(conversationRef);
    if (!conversationSnap.exists) throw Object.assign(new Error("Conversation not found"), { status: 404 });
    const conversation = conversationSnap.data();
    if (!(conversation.participantIds || []).includes(authUser.uid)) throw Object.assign(new Error("You cannot send messages here"), { status: 403 });
    if (!["active", "requested"].includes(conversation.status)) throw Object.assign(new Error("This conversation is not open for messages"), { status: 403 });
    otherUserId = conversation.participantIds.find((id) => id !== authUser.uid);
    transaction.set(messageRef, {
      conversationId,
      senderId: authUser.uid,
      text,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      readBy: [authUser.uid]
    });
    transaction.update(conversationRef, {
      lastMessage: text.slice(0, 180),
      lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
      lastMessageSenderId: authUser.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      [`unreadCounts.${otherUserId}`]: admin.firestore.FieldValue.increment(1),
      [`archivedBy.${authUser.uid}`]: false,
      [`archivedBy.${otherUserId}`]: false
    });
  });

  if (otherUserId && !(await blockExists(authUser.uid, otherUserId))) {
    await createMemberNotification({ recipientId: otherUserId, senderId: authUser.uid, type: "new_message", conversationId });
  }

  return res.status(200).json({ messageId: messageRef.id, conversationId });
});

exports.markConversationRead = networkingEndpoint(async (req, res, authUser, body) => {
  const conversationId = String(body.conversationId || "").trim();
  const ref = admin.firestore().collection("conversations").doc(conversationId);
  const snap = await ref.get();

  if (!snap.exists || !(snap.data().participantIds || []).includes(authUser.uid)) {
    return res.status(403).json({ error: "Conversation not available" });
  }

  await ref.update({
    [`unreadCounts.${authUser.uid}`]: 0,
    [`lastReadAt.${authUser.uid}`]: admin.firestore.FieldValue.serverTimestamp()
  });
  return res.status(200).json({ read: true });
});

exports.reportMember = networkingEndpoint(async (req, res, authUser, body) => {
  assertActiveMember(authUser);
  const reportedUserId = String(body.reportedUserId || body.targetUserId || "").trim();
  const reason = String(body.reason || "").trim().toLowerCase();
  const details = String(body.details || "").trim().slice(0, 1000);

  if (!reportedUserId || reportedUserId === authUser.uid) return res.status(400).json({ error: "Choose another member to report" });
  if (!REPORT_REASONS.has(reason)) return res.status(400).json({ error: "Choose a valid report reason" });

  const reportedSnap = await admin.firestore().collection("users").doc(reportedUserId).get();
  if (!reportedSnap.exists) return res.status(404).json({ error: "Reported member not found" });

  const reportRef = await admin.firestore().collection("reports").add({
    type: "member",
    reporterId: authUser.uid,
    reportedUserId,
    reason,
    details,
    status: "open",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return res.status(200).json({ reportId: reportRef.id });
});

exports.reportMessage = networkingEndpoint(async (req, res, authUser, body) => {
  assertActiveMember(authUser);
  const conversationId = String(body.conversationId || "").trim();
  const messageId = String(body.messageId || "").trim();
  const reason = String(body.reason || "").trim().toLowerCase();

  if (!REPORT_REASONS.has(reason)) return res.status(400).json({ error: "Choose a valid report reason" });

  const db = admin.firestore();
  const conversationSnap = await db.collection("conversations").doc(conversationId).get();
  if (!conversationSnap.exists || !(conversationSnap.data().participantIds || []).includes(authUser.uid)) {
    return res.status(403).json({ error: "Conversation not available" });
  }

  const messageSnap = await db.collection("conversations").doc(conversationId).collection("messages").doc(messageId).get();
  if (!messageSnap.exists) return res.status(404).json({ error: "Message not found" });
  const message = messageSnap.data();

  const reportRef = await db.collection("reports").add({
    type: "message",
    reporterId: authUser.uid,
    reportedUserId: message.senderId,
    conversationId,
    messageId,
    reason,
    reportedMessage: String(message.text || "").slice(0, 2000),
    reportedMessageAt: message.createdAt || null,
    participantIds: conversationSnap.data().participantIds || [],
    status: "open",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return res.status(200).json({ reportId: reportRef.id });
});

exports.resolveReport = networkingEndpoint(async (req, res, authUser, body) => {
  if (!isModeratorOrAdminRole(authUser.data)) {
    return res.status(403).json({ error: "Moderators only" });
  }

  const reportId = String(body.reportId || "").trim();
  const status = String(body.status || "dismissed").trim();
  if (!["dismissed", "actioned"].includes(status)) return res.status(400).json({ error: "Invalid report status" });

  await admin.firestore().collection("reports").doc(reportId).update({
    status,
    resolutionNote: String(body.resolutionNote || "").slice(0, 1000),
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedBy: authUser.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return res.status(200).json({ reportId, status });
});

exports.restrictMessaging = networkingEndpoint(async (req, res, authUser, body) => {
  if (!isModeratorOrAdminRole(authUser.data)) {
    return res.status(403).json({ error: "Moderators only" });
  }

  const targetUserId = String(body.targetUserId || "").trim();
  if (!targetUserId || targetUserId === authUser.uid) return res.status(400).json({ error: "Invalid member" });

  await admin.firestore().collection("users").doc(targetUserId).set({
    messagingRestricted: true,
    messagingRestrictedAt: admin.firestore.FieldValue.serverTimestamp(),
    messagingRestrictedBy: authUser.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true });

  return res.status(200).json({ restricted: true });
});

exports.setConversationUserFlag = networkingEndpoint(async (req, res, authUser, body) => {
  assertActiveMember(authUser);
  const conversationId = String(body.conversationId || "").trim();
  const field = String(body.field || "").trim();
  const value = Boolean(body.value);

  if (!["archivedBy", "mutedBy"].includes(field)) {
    return res.status(400).json({ error: "Invalid conversation setting" });
  }

  const ref = admin.firestore().collection("conversations").doc(conversationId);
  const snap = await ref.get();

  if (!snap.exists || !(snap.data().participantIds || []).includes(authUser.uid)) {
    return res.status(403).json({ error: "Conversation not available" });
  }

  await ref.update({
    [`${field}.${authUser.uid}`]: value,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return res.status(200).json({ conversationId, field, value });
});
function isModeratorOrAdminRole(userData) {
  return ["moderator", "admin", "super_admin"].includes(getUserRole(userData));
}
