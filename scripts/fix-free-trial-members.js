/*
 * One-off repair for members affected by the early free-trial signup flow.
 *
 * 1. Creates the missing member record for a free-trial signup whose login was
 *    created but whose users/{uid} document never was (founding member,
 *    one year from their original signup date).
 * 2. Gives unpaid, non-hidden members an active membership for one year from today.
 * 3. Rebuilds every publicProfiles/{uid} so members who never saved their
 *    "public" setting appear in the directory.
 *
 * Deploy the syncPublicProfile function first so later edits keep them visible.
 *
 * Usage:
 *   node scripts/fix-free-trial-members.js --dry-run
 *   node scripts/fix-free-trial-members.js --execute
 *
 * Run with Firebase Admin credentials for the intended project.
 */

const admin = require("../functions/node_modules/firebase-admin");
const { buildPublicProfile } = require("../functions/public-profile");

const MISSING_FOUNDING_RECORD_EMAILS = ["jags@nxtgensportsgroup.com"];

const args = new Set(process.argv.slice(2));
const execute = args.has("--execute");

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "sangat-works" });
const db = admin.firestore();
const { Timestamp, FieldValue } = admin.firestore;

function oneYearAfter(date) {
  const result = new Date(date);
  result.setFullYear(result.getFullYear() + 1);
  return Timestamp.fromDate(result);
}

function isUnpaidVisibleMember(user) {
  return (
    user.hasSubscription !== true &&
    !["moderator", "admin", "super_admin"].includes(user.role) &&
    user.accountType !== "admin" &&
    user.isAdmin !== true &&
    user.internalAccount !== true &&
    user.adminHidden !== true &&
    user.isPublic !== false &&
    user.accessType !== "admin_granted_free_year" &&
    !user.stripeSubscriptionId
  );
}

async function main() {
  const usersSnap = await db.collection("users").get();
  const users = new Map(usersSnap.docs.map(d => [d.id, d.data()]));
  const writes = [];

  // 1. Missing founding member records
  const highestMemberNumber = Math.max(
    0,
    ...[...users.values()].map(u => (typeof u.memberNumber === "number" ? u.memberNumber : 0))
  );
  let nextMemberNumber = highestMemberNumber + 1;

  for (const email of MISSING_FOUNDING_RECORD_EMAILS) {
    let authUser;
    try {
      authUser = await admin.auth().getUserByEmail(email);
    } catch (error) {
      console.log(`SKIP ${email}: no login found`);
      continue;
    }

    if (users.has(authUser.uid)) {
      console.log(`SKIP ${email}: member record already exists`);
      continue;
    }

    const signedUpAt = new Date(authUser.metadata.creationTime);
    const record = {
      uid: authUser.uid,
      fullName: (authUser.displayName || "").trim(),
      displayName: (authUser.displayName || "").trim(),
      email,
      role: "member",
      accountType: "member",
      isAdmin: false,
      internalAccount: false,
      isFoundingMember: true,
      memberNumber: nextMemberNumber++,
      hasSubscription: true,
      subscriptionStatus: "active",
      subscriptionPlan: "founding",
      subscriptionBillingType: "founding-free-year",
      subscriptionExpiresAt: oneYearAfter(signedUpAt),
      subscriptionUpdatedAt: FieldValue.serverTimestamp(),
      membershipPlan: "founding",
      membershipStatus: "active",
      stripeCustomerId: "",
      stripeSubscriptionId: "",
      stripePriceId: "",
      featuredListing: false,
      featuredListingStatus: "inactive",
      featuredExpiresAt: null,
      hasSeenIntro: false,
      isPublic: true,
      createdAt: Timestamp.fromDate(signedUpAt),
      updatedAt: FieldValue.serverTimestamp()
    };

    console.log(
      `CREATE founding record for ${record.fullName || "(no name)"} <${email}>: ` +
      `member #${record.memberNumber}, free until ${record.subscriptionExpiresAt.toDate().toISOString().slice(0, 10)}`
    );
    writes.push({ ref: db.collection("users").doc(authUser.uid), data: record, merge: false });
    users.set(authUser.uid, record);
  }

  // 2. Unpaid members get a free year from today
  const freeYearExpiresAt = oneYearAfter(new Date());
  for (const [uid, user] of users) {
    if (!isUnpaidVisibleMember(user)) continue;

    console.log(
      `GRANT free year to ${user.businessName || user.fullName || "(no name)"} <${user.email || "no email"}> ` +
      `until ${freeYearExpiresAt.toDate().toISOString().slice(0, 10)}`
    );
    const grant = {
      role: "member",
      accountType: "member",
      hasSubscription: true,
      subscriptionStatus: "active",
      subscriptionPlan: "free_year",
      subscriptionBillingType: "free-trial-year",
      subscriptionExpiresAt: freeYearExpiresAt,
      subscriptionUpdatedAt: FieldValue.serverTimestamp(),
      membershipPlan: "free_year",
      membershipStatus: "active",
      updatedAt: FieldValue.serverTimestamp()
    };
    writes.push({ ref: db.collection("users").doc(uid), data: grant, merge: true });
    users.set(uid, { ...user, ...grant });
  }

  // 3. Rebuild every public profile
  let nowPublic = 0;
  for (const [uid, user] of users) {
    const profile = buildPublicProfile(uid, user);
    if (profile.isPublic === true) nowPublic++;
    writes.push({ ref: db.collection("publicProfiles").doc(uid), data: profile, merge: false });
  }
  console.log(`REBUILD ${users.size} public profiles (${nowPublic} will be public in the directory, before membership checks)`);

  if (!execute) {
    console.log("\nDry run only. Nothing was changed. Re-run with --execute to apply.");
    return;
  }

  const writer = db.bulkWriter();
  writes.forEach(({ ref, data, merge }) => writer.set(ref, data, { merge }));
  await writer.close();
  console.log(`\nDone. ${writes.length} writes applied.`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
