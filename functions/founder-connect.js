// New members are connected to the founder as soon as their account exists.
const { FieldValue } = require("firebase-admin/firestore");
const { onDocumentCreated } = require("firebase-functions/v2/firestore");
const { admin } = require("./shared");
const { FOUNDER_EMAIL, connectToFounder } = require("./founder-connect-core");

let founderUid = "";

async function getFounderUid() {
  if (!founderUid) founderUid = (await admin.auth().getUserByEmail(FOUNDER_EMAIL)).uid;
  return founderUid;
}

exports.connectNewMemberToFounder = onDocumentCreated(
  { document: "users/{uid}", region: "europe-west1", maxInstances: 10 },
  async (event) => {
    const uid = event.params.uid;
    const db = admin.firestore();
    const founder = await getFounderUid();
    if (uid === founder) return;

    const founderSnap = await db.collection("users").doc(founder).get();
    const created = await connectToFounder(db, FieldValue, {
      founderUid: founder,
      founderData: founderSnap.exists ? founderSnap.data() : {},
      uid,
      userData: event.data?.data() || {}
    });
    if (created) console.log(`Connected new member ${uid} to the founder`);
  }
);
