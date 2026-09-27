/*
 * Read-only report: which members are missing from the directory, and why.
 * Changes nothing.
 *
 * Usage:
 *   node scripts/diagnose-members.js
 *
 * Run with Firebase Admin credentials for the intended project
 * (GOOGLE_APPLICATION_CREDENTIALS pointing at a service account key).
 */

const admin = require("../functions/node_modules/firebase-admin");

admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || "sangat-works" });
const db = admin.firestore();

function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Mirrors isPaidDirectoryProfile in js/directory.js.
function membershipProblem(user) {
  if (["admin", "super_admin"].includes(user.role)) return "";
  const now = new Date();

  if (user.accessType === "admin_granted_free_year") {
    const until = toDate(user.freeAccessExpiresAt);
    return until && until > now ? "" : "free charity year expired";
  }

  if (user.hasSubscription !== true) return `not paid (status: ${user.subscriptionStatus || "none"})`;

  const expires = toDate(user.subscriptionExpiresAt);
  if (user.subscriptionStatus === "cancelling") {
    return expires && expires > now ? "" : "cancelled and expired";
  }
  if (user.subscriptionStatus !== "active") return `status is ${user.subscriptionStatus || "missing"}`;
  if (expires && expires <= now) return `expired ${expires.toISOString().slice(0, 10)}`;
  return "";
}

async function listAllAuthUsers() {
  const users = [];
  let pageToken;
  do {
    const page = await admin.auth().listUsers(1000, pageToken);
    users.push(...page.users);
    pageToken = page.pageToken;
  } while (pageToken);
  return users;
}

async function main() {
  const [authUsers, usersSnap] = await Promise.all([
    listAllAuthUsers(),
    db.collection("users").get()
  ]);

  const docs = new Map(usersSnap.docs.map(d => [d.id, d.data()]));
  const rows = { visible: [], noRecord: [], notPublicSetting: [], hiddenByMember: [], hiddenByAdmin: [], membership: [] };

  for (const authUser of authUsers) {
    const user = docs.get(authUser.uid);
    const label = `${user?.businessName || user?.fullName || authUser.displayName || "(no name)"} <${authUser.email || "no email"}>`;

    if (!user) {
      rows.noRecord.push(`${label}  signed up ${authUser.metadata.creationTime}`);
      continue;
    }

    const problem = membershipProblem(user);
    const extra = `founding=${user.isFoundingMember === true} profileFilled=${Boolean(user.serviceTitle || user.businessName)}`;

    if (user.adminHidden === true) rows.hiddenByAdmin.push(label);
    else if (user.isPublic === false) rows.hiddenByMember.push(label);
    else if (problem) rows.membership.push(`${label}  -> ${problem}  ${extra}`);
    else if (user.isPublic !== true) rows.notPublicSetting.push(`${label}  ${extra}`);
    else rows.visible.push(label);
  }

  const orphanDocs = [...docs.keys()].filter(uid => !authUsers.some(u => u.uid === uid));

  const section = (title, list) => {
    console.log(`\n${title}: ${list.length}`);
    list.forEach(line => console.log(`  - ${line}`));
  };

  console.log(`Login accounts: ${authUsers.length}   Member records: ${docs.size}`);
  section("VISIBLE in directory", rows.visible);
  section("HIDDEN: active member, but 'public' setting never saved", rows.notPublicSetting);
  section("HIDDEN: login exists but no member record", rows.noRecord);
  section("HIDDEN: membership not active", rows.membership);
  section("HIDDEN: member chose private", rows.hiddenByMember);
  section("HIDDEN: hidden by admin", rows.hiddenByAdmin);
  if (orphanDocs.length) console.log(`\nMember records with no login: ${orphanDocs.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
