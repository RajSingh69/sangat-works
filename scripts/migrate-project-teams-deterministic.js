/*
 * Migrates projectTeams documents from legacy random IDs to deterministic
 * {projectId}__{memberId} IDs used by the hardened Firestore rules.
 *
 * Usage:
 *   node scripts/migrate-project-teams-deterministic.js --dry-run
 *   node scripts/migrate-project-teams-deterministic.js --execute
 *   node scripts/migrate-project-teams-deterministic.js --execute --delete-originals
 *
 * Run with Firebase Admin credentials for the intended project. Start with
 * --dry-run and review conflicts before using --execute.
 */

const admin = require("firebase-admin");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run") || !args.has("--execute");
const execute = args.has("--execute");
const deleteOriginals = args.has("--delete-originals");

if (dryRun && deleteOriginals) {
  console.error("--delete-originals requires --execute.");
  process.exit(1);
}

admin.initializeApp();
const db = admin.firestore();

function deterministicTeamId(data) {
  if (!data.projectId || !data.memberId) return "";
  return `${data.projectId}__${data.memberId}`;
}

async function migrateProjectTeams() {
  const snapshot = await db.collection("projectTeams").get();
  const summary = {
    total: snapshot.size,
    alreadyDeterministic: 0,
    missingKeys: 0,
    conflicts: 0,
    copied: 0,
    deletedOriginals: 0
  };

  for (const docSnap of snapshot.docs) {
    const data = docSnap.data();
    const targetId = deterministicTeamId(data);

    if (!targetId) {
      summary.missingKeys += 1;
      console.warn(`SKIP missing projectId/memberId: ${docSnap.id}`);
      continue;
    }

    if (docSnap.id === targetId) {
      summary.alreadyDeterministic += 1;
      continue;
    }

    const targetRef = db.collection("projectTeams").doc(targetId);
    const targetSnap = await targetRef.get();

    if (targetSnap.exists) {
      summary.conflicts += 1;
      console.warn(`CONFLICT ${docSnap.id} -> ${targetId}: target already exists`);
      continue;
    }

    console.log(`${dryRun ? "WOULD COPY" : "COPY"} ${docSnap.id} -> ${targetId}`);

    if (execute) {
      await targetRef.set(data, { merge: false });
      summary.copied += 1;

      if (deleteOriginals) {
        await docSnap.ref.delete();
        summary.deletedOriginals += 1;
      }
    }
  }

  console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "execute", deleteOriginals, ...summary }, null, 2));
}

migrateProjectTeams().catch((error) => {
  console.error(error);
  process.exit(1);
});
