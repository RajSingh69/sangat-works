// Free trials from event codes (e.g. CAREERS26), no card needed.
// An admin creates trialCodes/{CODE} in the Admin panel with a length (7, 14 or
// 30 days), a sign-up limit and an end date. People open trial.html?code=CODE,
// create an account and call freeTrial to claim it. The trial uses the same
// time-limited free access as the Free Charity Year (accessType
// "admin_granted_free_year" + freeAccessExpiresAt), marked freeAccessSource
// "trial" so the site can label it "Free Trial". One trial per account.
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { admin, isActiveMember, onRequest } = require("./shared");

const SITE_URL = "https://sangatworks.co.uk";

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function normaliseCode(value) {
  return String(value || "").trim().toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32);
}

function describeCode(data) {
  if (!data || data.active !== true) throw httpError(404, "This trial code isn't valid.");
  const endsAt = data.expiresAt?.toDate ? data.expiresAt.toDate() : null;
  if (endsAt && endsAt < new Date()) throw httpError(410, "This trial code has ended.");
  if ((data.uses || 0) >= (data.maxUses || 0)) throw httpError(410, "All the free trials for this code have been taken.");
  return { days: data.days, label: data.label || "" };
}

// Checks a code (no account needed) so the trial page can show the length.
async function checkTrialCode(db, rawCode) {
  const code = normaliseCode(rawCode);
  if (!code) throw httpError(400, "Enter a trial code.");
  const snap = await db.collection("trialCodes").doc(code).get();
  return { code, ...describeCode(snap.exists ? snap.data() : null) };
}

// Gives the signed-in account its free trial. Exported for tests.
async function claimTrial(db, { uid, email, name, rawCode }) {
  const code = normaliseCode(rawCode);
  if (!code) throw httpError(400, "Enter a trial code.");
  const codeRef = db.collection("trialCodes").doc(code);
  const userRef = db.collection("users").doc(uid);

  return db.runTransaction(async (transaction) => {
    const [codeSnap, userSnap] = await Promise.all([transaction.get(codeRef), transaction.get(userRef)]);
    const { days } = describeCode(codeSnap.exists ? codeSnap.data() : null);
    const user = userSnap.exists ? userSnap.data() : null;

    if (user && isActiveMember(user)) throw httpError(409, "You already have membership, so you don't need a trial.");
    if (user?.trialUsedAt) throw httpError(409, "This account has already had a free trial. Choose a plan to carry on.");

    const expiresAt = Timestamp.fromMillis(Date.now() + days * 86400000);
    const cleanName = String(name || "").trim().slice(0, 120);
    const base = user ? {} : {
      uid,
      email: String(email || "").toLowerCase(),
      fullName: cleanName,
      displayName: cleanName,
      role: "standard",
      accountType: "member",
      isFoundingMember: false,
      hasSubscription: false,
      hasSeenIntro: false,
      isPublic: true,
      createdAt: FieldValue.serverTimestamp()
    };

    transaction.set(userRef, {
      ...base,
      accessType: "admin_granted_free_year",
      freeAccessSource: "trial",
      freeAccessExpiresAt: expiresAt,
      trialCode: code,
      trialUsedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });
    transaction.update(codeRef, { uses: FieldValue.increment(1), lastUsedAt: FieldValue.serverTimestamp() });

    return { days, expiresAt: expiresAt.toDate().toISOString() };
  });
}

exports.freeTrial = onRequest(
  { region: "europe-west1", cors: true, maxInstances: 10 },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", SITE_URL);
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const db = admin.firestore();

      if (body.action === "check") {
        return res.status(200).json(await checkTrialCode(db, body.code));
      }

      const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
      if (!token) throw httpError(401, "Please create your account first.");
      const decoded = await admin.auth().verifyIdToken(token).catch(() => null);
      if (!decoded) throw httpError(401, "Please log in again.");

      const result = await claimTrial(db, { uid: decoded.uid, email: decoded.email, name: body.name, rawCode: body.code });
      return res.status(200).json({ ok: true, ...result });
    } catch (error) {
      if (!error.status) console.error("Free trial error:", error);
      return res.status(error.status || 500).json({ error: error.status ? error.message : "Something went wrong. Please try again." });
    }
  }
);

module.exports = { freeTrial: exports.freeTrial, checkTrialCode, claimTrial, normaliseCode };
