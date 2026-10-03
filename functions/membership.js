// Turning membership on after a Stripe payment, for people who already have an
// account (join.html creates the account first, then sends them to Stripe).
// Used by two paths so membership starts as soon as they're back on the site:
//   - stripeWebhook (checkout.session.completed), and
//   - activateMembership, called by join.html when Stripe sends them back,
//     so they aren't left waiting if the webhook is slow.
// Both write the same fields, so running twice is harmless.
const { FieldValue } = require("firebase-admin/firestore");
const {
  MEMBERSHIP_PRICE_IDS,
  Stripe,
  admin,
  getPassExpiryDate,
  getPlanFromPriceId,
  getRoleAfterMembershipActivation,
  getSafeSignupSessionData,
  getSubscriptionExpiryTimestamp,
  getSubscriptionFirestoreStatus,
  isCheckoutSessionPaid,
  onRequest,
  stripeSecret,
  verifyRequestUser
} = require("./shared");
const { recordReferral } = require("./referrals");

// Returns { uid, plan, billingType } or null if there's no account on the session yet.
async function activateMembershipFromSession(stripe, session) {
  const uid = session.metadata?.uid || "";
  const billingType = session.metadata?.billingType;
  let priceId = session.metadata?.priceId || "";
  if (!uid) return null;

  let expiresAt = null;
  let stripeSubscriptionId = "";
  let subscriptionStatus = "active";
  let subscriptionCancelAtPeriodEnd = false;
  const stripeCustomerId = typeof session.customer === "string" ? session.customer : session.customer?.id || "";

  if (billingType === "subscription") {
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);
    priceId = subscription.items.data[0]?.price?.id || priceId;
    stripeSubscriptionId = subscriptionId || "";
    subscriptionStatus = getSubscriptionFirestoreStatus(subscription);
    subscriptionCancelAtPeriodEnd = subscription.cancel_at_period_end === true;
    expiresAt = getSubscriptionExpiryTimestamp(subscription);
  } else if (billingType === "oneoff") {
    expiresAt = getPassExpiryDate(priceId);
  } else {
    return null;
  }

  const plan = getPlanFromPriceId(priceId);
  const userRef = admin.firestore().collection("users").doc(uid);
  const existing = await userRef.get();

  await userRef.set({
    role: getRoleAfterMembershipActivation(existing.exists ? existing.data() : null),
    hasSubscription: true,
    subscriptionStatus,
    membershipStatus: "active",
    accountType: "member",
    subscriptionPlan: plan,
    membershipPlan: plan,
    subscriptionBillingType: billingType,
    subscriptionExpiresAt: expiresAt,
    subscriptionCancelAtPeriodEnd,
    subscriptionCancelledAt: null,
    stripeCustomerId,
    stripeSubscriptionId,
    stripePriceId: priceId,
    stripeCheckoutSessionId: session.id,
    subscriptionUpdatedAt: FieldValue.serverTimestamp(),
    email: session.metadata?.email || session.customer_details?.email || ""
  }, { merge: true });

  // Invited by a member (functions/referrals.js): remember who, for their reward.
  if (session.metadata?.referrerUid) {
    await recordReferral({
      referrerUid: session.metadata.referrerUid,
      referredUid: uid,
      signup: getSafeSignupSessionData(session, priceId)
    }).catch((error) => console.error("Could not record referral:", error));
  }

  return { uid, plan, billingType };
}

exports.activateMembership = onRequest(
  { region: "europe-west1", cors: true, secrets: [stripeSecret], maxInstances: 10 },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "https://sangatworks.co.uk");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const sessionId = String(body.sessionId || "");
      if (!sessionId.startsWith("cs_")) return res.status(400).json({ error: "Missing payment reference." });

      const stripe = Stripe(stripeSecret.value());
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      const uid = session.metadata?.uid || "";

      // Only the account that paid can turn its own membership on.
      if (!uid || !(await verifyRequestUser(req, uid))) {
        return res.status(403).json({ error: "This payment belongs to a different account." });
      }
      if (!isCheckoutSessionPaid(session)) {
        return res.status(402).json({ error: "We haven't received this payment yet." });
      }
      if (!MEMBERSHIP_PRICE_IDS.includes(session.metadata?.priceId || "")) {
        return res.status(400).json({ error: "This payment isn't for a membership." });
      }

      const result = await activateMembershipFromSession(stripe, session);
      return res.status(200).json({ activated: Boolean(result), plan: result?.plan || "" });
    } catch (error) {
      console.error("Membership activation error:", error);
      return res.status(500).json({ error: "We couldn't switch your membership on yet. Please wait a moment and refresh." });
    }
  }
);

module.exports = { activateMembership: exports.activateMembership, activateMembershipFromSession };
