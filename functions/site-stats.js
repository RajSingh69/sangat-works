// Public totals for the homepage (siteStats/public), so logged-out visitors see real
// numbers without being able to read any member's profile. Counts only, no names.
// Recalculated whenever a public profile, opportunity or project changes.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { FieldValue } = require("firebase-admin/firestore");
const { admin } = require("./shared");
const { summariseSiteStats } = require("./site-stats-core");

async function refreshSiteStats() {
  const db = admin.firestore();
  const [profiles, opportunities, projects, employerJobs] = await Promise.all([
    db.collection("publicProfiles").where("isPublic", "==", true).get(),
    db.collection("opportunities").where("status", "==", "open").get(),
    db.collection("projects").where("status", "==", "open").get(),
    db.collection("employerJobs").where("status", "==", "live").get()
  ]);

  // Paid employer jobs count until their closing date or 30-day end, whichever is first.
  const employerOpenings = employerJobs.docs.map(doc => {
    const job = doc.data();
    const endsOn = job.liveUntil?.toDate ? job.liveUntil.toDate().toISOString().slice(0, 10) : "";
    const closingDate = [job.closingDate, endsOn].filter(Boolean).sort()[0] || "";
    return { closingDate };
  });

  const stats = summariseSiteStats(
    profiles.docs.map(doc => doc.data()),
    [...opportunities.docs.map(doc => doc.data()), ...employerOpenings],
    projects.size
  );
  await db.collection("siteStats").doc("public").set({ ...stats, updatedAt: FieldValue.serverTimestamp() });
}

const TRIGGER_OPTIONS = { region: "europe-west1", maxInstances: 1 };

exports.refreshStatsOnProfileChange = onDocumentWritten({ ...TRIGGER_OPTIONS, document: "publicProfiles/{uid}" }, refreshSiteStats);
exports.refreshStatsOnOpportunityChange = onDocumentWritten({ ...TRIGGER_OPTIONS, document: "opportunities/{opportunityId}" }, refreshSiteStats);
exports.refreshStatsOnProjectChange = onDocumentWritten({ ...TRIGGER_OPTIONS, document: "projects/{projectId}" }, refreshSiteStats);
exports.refreshStatsOnEmployerJobChange = onDocumentWritten({ ...TRIGGER_OPTIONS, document: "employerJobs/{jobId}" }, refreshSiteStats);
