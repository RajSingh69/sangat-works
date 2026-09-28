// Public totals for the homepage (siteStats/public), so logged-out visitors see real
// numbers without being able to read any member's profile. Counts only, no names.
// Recalculated whenever a public profile, opportunity or project changes.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { FieldValue } = require("firebase-admin/firestore");
const { admin } = require("./shared");
const { summariseSiteStats } = require("./site-stats-core");

async function refreshSiteStats() {
  const db = admin.firestore();
  const [profiles, opportunities, projects] = await Promise.all([
    db.collection("publicProfiles").where("isPublic", "==", true).get(),
    db.collection("opportunities").where("status", "==", "open").get(),
    db.collection("projects").where("status", "==", "open").get()
  ]);

  const stats = summariseSiteStats(
    profiles.docs.map(doc => doc.data()),
    opportunities.docs.map(doc => doc.data()),
    projects.size
  );
  await db.collection("siteStats").doc("public").set({ ...stats, updatedAt: FieldValue.serverTimestamp() });
}

const TRIGGER_OPTIONS = { region: "europe-west1", maxInstances: 1 };

exports.refreshStatsOnProfileChange = onDocumentWritten({ ...TRIGGER_OPTIONS, document: "publicProfiles/{uid}" }, refreshSiteStats);
exports.refreshStatsOnOpportunityChange = onDocumentWritten({ ...TRIGGER_OPTIONS, document: "opportunities/{opportunityId}" }, refreshSiteStats);
exports.refreshStatsOnProjectChange = onDocumentWritten({ ...TRIGGER_OPTIONS, document: "projects/{projectId}" }, refreshSiteStats);
