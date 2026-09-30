// Invite a friend. A member shares pricing.html?invite=<their uid>.
// 1. createCheckoutSession gives the friend a 30-day free trial on a Monthly or
//    Yearly subscription (card required) and tags the checkout with the inviter.
// 2. When the friend finishes signing up, verifyPaidSignupSession records
//    referrals/{friendUid} as "pending".
// 3. When the friend's first real payment goes through (invoice.paid with money
//    taken), the inviter gets a free month: £3.99 off their next Stripe bill, or
//    30 extra days if they're on a one-off pass. Fake sign-ups that never pay
//    earn nothing.
const { FieldValue, Timestamp } = require("firebase-admin/firestore");
const { admin, getInvoiceSubscriptionId, isActiveMember } = require("./shared");

const REFERRAL_TRIAL_DAYS = 30;
const REFERRAL_CREDIT_PENCE = 399; // one month of Monthly membership

// The inviter must be a current member, and can't invite their own email.
async function getValidReferrer(referrerUid, checkoutEmail) {
  if (!referrerUid || typeof referrerUid !== "string" || referrerUid.length > 128) return "";
  const snap = await admin.firestore().collection("users").doc(referrerUid).get();
  if (!snap.exists || !isActiveMember(snap.data())) return "";
  const referrerEmail = String(snap.data().email || "").trim().toLowerCase();
  if (referrerEmail && referrerEmail === String(checkoutEmail || "").trim().toLowerCase()) return "";
  return referrerUid;
}

// Called once the invited friend has an account and has claimed their checkout.
async function recordReferral({ referrerUid, referredUid, signup }) {
  if (!referrerUid || !referredUid || referrerUid === referredUid) return;
  const ref = admin.firestore().collection("referrals").doc(referredUid);
  await admin.firestore().runTransaction(async (transaction) => {
    if ((await transaction.get(ref)).exists) return;
    transaction.set(ref, {
      referrerUid,
      referredUid,
      stripeSubscriptionId: signup.stripeSubscriptionId || "",
      checkoutSessionId: signup.checkoutSessionId || "",
      status: "pending",
      createdAt: FieldValue.serverTimestamp()
    });
  });
}

// Stripe webhook, invoice.paid. Returns a short description for the logs.
async function handleReferralInvoicePaid(stripe, invoice) {
  const subscriptionId = getInvoiceSubscriptionId(invoice);
  // Trial invoices are £0; only a real payment earns the inviter their month.
  if (!subscriptionId || !(invoice.amount_paid > 0)) return "not a paid subscription invoice";

  const db = admin.firestore();
  const matches = await db.collection("referrals")
    .where("stripeSubscriptionId", "==", subscriptionId)
    .where("status", "==", "pending")
    .limit(1)
    .get();
  if (matches.empty) return "no pending referral";

  const referralRef = matches.docs[0].ref;
  // Claim the reward first so a retried webhook can't pay it twice.
  const referral = await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(referralRef);
    if (!snap.exists || snap.data().status !== "pending") return null;
    transaction.update(referralRef, { status: "rewarding", firstPaymentAt: FieldValue.serverTimestamp() });
    return snap.data();
  });
  if (!referral) return "already handled";

  try {
    const referrerRef = db.collection("users").doc(referral.referrerUid);
    const referrer = (await referrerRef.get()).data() || {};
    let rewardType = "none";

    if (referrer.subscriptionBillingType === "subscription" && referrer.stripeCustomerId && referrer.hasSubscription === true) {
      await stripe.customers.createBalanceTransaction(
        referrer.stripeCustomerId,
        {
          amount: -REFERRAL_CREDIT_PENCE,
          currency: "gbp",
          description: "Free month for inviting a friend to Sangat Works",
          metadata: { referredUid: referral.referredUid }
        },
        { idempotencyKey: `referral-credit-${referral.referredUid}` }
      );
      rewardType = "stripe_credit";
    } else if (referrer.subscriptionExpiresAt) {
      // One-off passes: add 30 days to whatever time they have left.
      const current = referrer.subscriptionExpiresAt.toDate ? referrer.subscriptionExpiresAt.toDate() : new Date(referrer.subscriptionExpiresAt);
      const from = Number.isNaN(current.getTime()) || current < new Date() ? new Date() : current;
      await referrerRef.update({
        subscriptionExpiresAt: Timestamp.fromMillis(from.getTime() + REFERRAL_TRIAL_DAYS * 86400000),
        subscriptionUpdatedAt: FieldValue.serverTimestamp()
      });
      rewardType = "extended_access";
    }

    await referralRef.update({ status: "rewarded", rewardType, rewardedAt: FieldValue.serverTimestamp() });
    return `rewarded ${referral.referrerUid} (${rewardType})`;
  } catch (error) {
    console.error(`Referral reward failed for ${referral.referredUid}:`, error);
    await referralRef.update({ status: "reward_failed", rewardError: String(error.message || error).slice(0, 300) });
    return "reward failed";
  }
}

module.exports = {
  REFERRAL_CREDIT_PENCE,
  REFERRAL_TRIAL_DAYS,
  getValidReferrer,
  handleReferralInvoicePaid,
  recordReferral
};
