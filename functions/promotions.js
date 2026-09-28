// Paid extras for members, bought through Stripe Checkout:
// - Featured Opportunity: pins one of the member's open opportunities to the top of
//   the board for FEATURED_OPPORTUNITY_DAYS (buying again extends it).
// - Business Verification: a one-off review. Payment creates a pending request on
//   users/{uid}.verificationRequest; a super admin approves (sets businessVerified)
//   or rejects (and refunds in Stripe) from the Admin panel.
// The Stripe webhook in payments.js hands these sessions to handlePromotionPayment.
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const {
  Stripe,
  admin,
  isActiveMember,
  onRequest,
  stripeSecret,
  verifyRequestUser
} = require("./shared");

// Stripe price IDs (live, one-off payments).
const FEATURED_OPPORTUNITY_PRICE_ID = "price_1UKeWRDbE6tXsxNUiI0qh7Wd"; // £5 one-off
const BUSINESS_VERIFICATION_PRICE_ID = "price_1UKeXdDbE6tXsxNUCuMHpGUi"; // £15 one-off
const FEATURED_OPPORTUNITY_DAYS = 14;

const SITE_URL = "https://sangatworks.co.uk";
const DAY_MS = 24 * 60 * 60 * 1000;

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function prepareFeaturedOpportunity(uid, opportunityId) {
  if (!FEATURED_OPPORTUNITY_PRICE_ID) throw httpError(503, "Featured posts aren't available yet.");
  if (!opportunityId) throw httpError(400, "Choose an opportunity to feature.");

  const snap = await admin.firestore().collection("opportunities").doc(opportunityId).get();
  if (!snap.exists) throw httpError(404, "Opportunity not found.");
  const opportunity = snap.data();
  if (opportunity.ownerId !== uid) throw httpError(403, "You can only feature your own posts.");
  if (opportunity.status !== "open") throw httpError(400, "Only open posts can be featured.");

  return {
    priceId: FEATURED_OPPORTUNITY_PRICE_ID,
    metadata: { opportunityId },
    successUrl: `${SITE_URL}/opportunities.html?featured=paid`,
    cancelUrl: `${SITE_URL}/opportunities.html`
  };
}

async function prepareBusinessVerification(uid, userData) {
  if (!BUSINESS_VERIFICATION_PRICE_ID) throw httpError(503, "Business verification isn't available yet.");
  if (userData.businessVerified === true) throw httpError(400, "Your business is already verified.");
  if (userData.verificationRequest?.status === "pending") throw httpError(400, "Your verification is already being reviewed.");

  return {
    priceId: BUSINESS_VERIFICATION_PRICE_ID,
    metadata: {},
    successUrl: `${SITE_URL}/profile.html?verification=paid`,
    cancelUrl: `${SITE_URL}/profile.html`
  };
}

exports.createPromotionCheckout = onRequest(
  { region: "europe-west1", cors: true, secrets: [stripeSecret], maxInstances: 10 },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", SITE_URL);
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const { uid, product, opportunityId } = body;
      if (!uid || !product) throw httpError(400, "Missing details.");
      if (!(await verifyRequestUser(req, uid))) throw httpError(403, "Please log in again.");

      const userSnap = await admin.firestore().collection("users").doc(uid).get();
      if (!userSnap.exists || !isActiveMember(userSnap.data())) throw httpError(403, "This is only available to active members.");

      const prepared = product === "featured_opportunity"
        ? await prepareFeaturedOpportunity(uid, String(opportunityId || ""))
        : product === "business_verification"
        ? await prepareBusinessVerification(uid, userSnap.data())
        : null;
      if (!prepared) throw httpError(400, "Unknown product.");

      const authUser = await admin.auth().getUser(uid);
      const metadata = { uid, billingType: product, priceId: prepared.priceId, ...prepared.metadata };
      const stripe = Stripe(stripeSecret.value());
      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: authUser.email || undefined,
        line_items: [{ price: prepared.priceId, quantity: 1 }],
        success_url: prepared.successUrl,
        cancel_url: prepared.cancelUrl,
        metadata,
        payment_intent_data: { metadata }
      });

      return res.status(200).json({ url: session.url });
    } catch (error) {
      if (!error.status) console.error("Promotion checkout error:", error);
      return res.status(error.status || 500).json({ error: error.status ? error.message : "Checkout failed. Please try again." });
    }
  }
);

// Called by stripeWebhook for checkout.session.completed. Returns true if handled.
async function handlePromotionPayment(session) {
  const { billingType, uid, opportunityId } = session.metadata || {};
  if (billingType !== "featured_opportunity" && billingType !== "business_verification") return false;
  if (!uid) {
    console.error(`${billingType} payment without uid metadata`, session.id);
    return true;
  }
  if (session.payment_status && session.payment_status !== "paid") {
    console.error(`${billingType} session ${session.id} not paid (${session.payment_status})`);
    return true;
  }

  const db = admin.firestore();

  if (billingType === "featured_opportunity") {
    const ref = db.collection("opportunities").doc(opportunityId || "");
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists || snap.data().ownerId !== uid) {
        console.error(`Featured payment ${session.id}: opportunity ${opportunityId} missing or not owned by ${uid}`);
        return;
      }
      const current = snap.data().featuredUntil?.toMillis?.() || 0;
      const start = Math.max(Date.now(), current);
      transaction.update(ref, {
        featuredUntil: Timestamp.fromMillis(start + FEATURED_OPPORTUNITY_DAYS * DAY_MS),
        featuredSessionId: session.id
      });
    });
    console.log(`Opportunity ${opportunityId} featured for ${uid}`);
    return true;
  }

  await db.collection("users").doc(uid).set({
    verificationRequest: {
      status: "pending",
      paidAt: FieldValue.serverTimestamp(),
      stripeSessionId: session.id,
      amountPaid: typeof session.amount_total === "number" ? session.amount_total / 100 : null
    }
  }, { merge: true });
  console.log(`Business verification requested by ${uid}`);
  return true;
}

module.exports = {
  createPromotionCheckout: exports.createPromotionCheckout,
  handlePromotionPayment,
  FEATURED_OPPORTUNITY_DAYS
};
