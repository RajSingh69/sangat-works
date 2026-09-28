/*
 * One-off: removes reviewerEmail from existing reviews. Reviews are public
 * (users/{uid}/reviews), and older reviews stored the reviewer's email.
 * New reviews no longer store it (js/reviews.js, firestore.rules).
 *
 * Usage:
 *   node scripts/strip-review-emails.js --dry-run
 *   node scripts/strip-review-emails.js --execute
 *
 * Run with Firebase Admin credentials (GOOGLE_APPLICATION_CREDENTIALS).
 */

const admin = require("../functions/node_modules/firebase-admin");
const path = require("path");
const { FieldValue } = require(require.resolve("firebase-admin/firestore", { paths: [path.join(__dirname, "../functions")] }));

const execute = process.argv.includes("--execute");

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "sangat-works" });
const db = admin.firestore();

async function main() {
  const reviews = await db.collectionGroup("reviews").get();
  const withEmail = reviews.docs.filter(review => "reviewerEmail" in review.data());

  if (execute && withEmail.length) {
    const writer = db.bulkWriter();
    withEmail.forEach(review => writer.update(review.ref, { reviewerEmail: FieldValue.delete() }));
    await writer.close();
  }

  console.log(`${reviews.size} reviews checked. ${execute ? "Removed" : "Would remove"} the email from ${withEmail.length}.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
