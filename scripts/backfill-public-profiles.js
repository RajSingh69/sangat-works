/*
 * Creates publicProfiles/{uid} for every existing users/{uid} document.
 * New and updated users are kept in sync by the syncPublicProfile Cloud
 * Function; this only needs running once, after that function is deployed
 * and before the new firestore.rules are deployed.
 *
 * Usage:
 *   node scripts/backfill-public-profiles.js --dry-run
 *   node scripts/backfill-public-profiles.js --execute
 *
 * Run with Firebase Admin credentials for the intended project
 * (e.g. `gcloud auth application-default login`).
 */

const admin = require("../functions/node_modules/firebase-admin");
const { buildPublicProfile } = require("../functions/public-profile");

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "sangat-works" });
const db = admin.firestore();

async function main() {
  const usersSnap = await db.collection("users").get();
  const writer = db.bulkWriter();
  let publicCount = 0;

  usersSnap.forEach(userDoc => {
    const profile = buildPublicProfile(userDoc.id, userDoc.data());
    if (profile.isPublic !== false) publicCount++;
    if (execute) writer.set(db.collection("publicProfiles").doc(userDoc.id), profile);
  });

  if (execute) await writer.close();

  console.log(
    `${execute ? "Wrote" : "Would write"} ${usersSnap.size} public profiles ` +
    `(${publicCount} public, ${usersSnap.size - publicCount} private).`
  );
  if (!execute) console.log("Dry run only. Re-run with --execute to write.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
