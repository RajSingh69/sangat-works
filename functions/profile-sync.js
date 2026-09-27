// Keeps publicProfiles/{uid} in sync with users/{uid}.
const {
  admin,
  buildPublicProfile,
  onDocumentWritten
} = require("./shared");

// =========================================
// Public profile sync
// =========================================
exports.syncPublicProfile = onDocumentWritten(
  {
    document: "users/{uid}",
    region: "europe-west1",
    maxInstances: 10
  },
  async (event) => {
    const uid = event.params.uid;
    const publicRef = admin.firestore().collection("publicProfiles").doc(uid);
    const after = event.data?.after;

    if (!after || !after.exists) {
      await publicRef.delete();
      return;
    }

    await publicRef.set(buildPublicProfile(uid, after.data()));
  }
);
