// Every member starts connected to the founder (Rajan). Shared by the
// connectNewMemberToFounder trigger and scripts/connect-founder.js (backfill).
const FOUNDER_EMAIL = "rajanbhamra02@gmail.com";

function pairId(a, b) {
  return [a, b].sort().join("__");
}

function displayName(userData = {}) {
  return userData.businessName || userData.fullName || userData.displayName || "Sangat Works Member";
}

// Creates an accepted founder connection unless one already exists (in any
// state, so a member who removed or blocked the founder is left alone).
// Returns true if a connection was created.
async function connectToFounder(db, FieldValue, { founderUid, founderData, uid, userData }) {
  if (!founderUid || !uid || uid === founderUid) return false;
  const ref = db.collection("connections").doc(pairId(founderUid, uid));

  return db.runTransaction(async (transaction) => {
    const existing = await transaction.get(ref);
    if (existing.exists) return false;

    transaction.set(ref, {
      userIds: [founderUid, uid],
      requesterId: founderUid,
      recipientId: uid,
      requestedBy: founderUid,
      requesterName: displayName(founderData),
      recipientName: displayName(userData),
      status: "accepted",
      autoFounderConnection: true,
      createdAt: FieldValue.serverTimestamp(),
      acceptedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
    return true;
  });
}

module.exports = { FOUNDER_EMAIL, connectToFounder, pairId };
