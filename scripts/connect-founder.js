/*
 * One-off: connects every existing member to the founder (Rajan).
 * New members get this automatically (functions/founder-connect.js).
 * Members who already have any connection record with the founder
 * (accepted, pending, removed or blocked) are left as they are.
 *
 * Usage:
 *   node scripts/connect-founder.js --dry-run
 *   node scripts/connect-founder.js --execute
 *
 * Run with Firebase Admin credentials (GOOGLE_APPLICATION_CREDENTIALS).
 */

const admin = require("../functions/node_modules/firebase-admin");
const path = require("path");
const { FieldValue } = require(require.resolve("firebase-admin/firestore", { paths: [path.join(__dirname, "../functions")] }));
const { FOUNDER_EMAIL, connectToFounder, pairId } = require("../functions/founder-connect-core");

const execute = process.argv.includes("--execute");

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "sangat-works" });
const db = admin.firestore();

async function main() {
  const founderUid = (await admin.auth().getUserByEmail(FOUNDER_EMAIL)).uid;
  const founderSnap = await db.collection("users").doc(founderUid).get();
  const users = await db.collection("users").get();

  let toConnect = 0;
  let created = 0;
  for (const userSnap of users.docs) {
    if (userSnap.id === founderUid) continue;
    const existing = await db.collection("connections").doc(pairId(founderUid, userSnap.id)).get();
    if (existing.exists) continue;
    toConnect++;
    if (execute) {
      const made = await connectToFounder(db, FieldValue, {
        founderUid,
        founderData: founderSnap.data() || {},
        uid: userSnap.id,
        userData: userSnap.data()
      });
      if (made) created++;
    }
  }

  console.log(`${users.size} members checked. ${toConnect} not yet connected to the founder.`);
  console.log(execute ? `Connected ${created}.` : "Dry run: nothing changed. Run with --execute to connect them.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
