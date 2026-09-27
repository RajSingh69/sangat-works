const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const crypto = require("crypto");
const Stripe = require("stripe");
const { buildPublicProfile } = require("./public-profile");

const admin = require("firebase-admin");

admin.initializeApp();

const stripeSecret = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");
const superAdminSeedToken = defineSecret("SUPER_ADMIN_SEED_TOKEN");
const superAdminAccountsJson = defineSecret("SUPER_ADMIN_ACCOUNTS_JSON");
const internalPaymentTesterSeedToken = defineSecret("INTERNAL_PAYMENT_TESTER_SEED_TOKEN");
const internalPaymentTesterAccountJson = defineSecret("INTERNAL_PAYMENT_TESTER_ACCOUNT_JSON");

/*
  Subscription prices
  These auto-renew through Stripe.
*/
const YEARLY_SUBSCRIPTION_PRICE_ID = "price_1Tkm1gDbE6tXsxNU9veTZwPE";
const MONTHLY_SUBSCRIPTION_PRICE_ID = "price_1Tkm19DbE6tXsxNUxU6b7NUI";

/*
  One-off pass prices
  These do not auto-renew.
*/
const YEARLY_PASS_PRICE_ID = "price_1Tl90wDbE6tXsxNUPMzfGO5m";
const MONTHLY_PASS_PRICE_ID = "price_1Tl8zyDbE6tXsxNUpynPPWft";

/*
  Featured Listing
  One-off £5 for 30 days.
*/
const FEATURED_LISTING_PRICE_ID = "price_1TlZxODbE6tXsxNUzI1ng4Iy";

/*
  Project payment prices
  Switch PROJECT_PAYMENT_PRICE_MODE between "TEST" and "LIVE".
  Membership and Featured Listing prices are configured separately above.
*/
const PROJECT_PAYMENT_PRICE_MODE = "LIVE";
const PROJECT_PAYMENT_PRICE_IDS = {
  TEST: {
    workspaceUnlock: "price_1TnFVKDbE6tXsxNUocVIIChZ",
    tradesJobAccess: "price_1TnFVvDbE6tXsxNUmZrBhyR1"
  },
  LIVE: {
    workspaceUnlock: "price_1Tn0FTDbE6tXsxNUOlu3a5eJ",
    tradesJobAccess: "price_1Tn0GsDbE6tXsxNU3wHbCQBo"
  }
};
const ACTIVE_PROJECT_PAYMENT_PRICE_IDS =
  PROJECT_PAYMENT_PRICE_IDS[PROJECT_PAYMENT_PRICE_MODE];
const PROJECT_WORKSPACE_UNLOCK_PRICE_ID =
  ACTIVE_PROJECT_PAYMENT_PRICE_IDS.workspaceUnlock;
const TRADES_JOB_ACCESS_PRICE_ID =
  ACTIVE_PROJECT_PAYMENT_PRICE_IDS.tradesJobAccess;

const ALL_PRICE_IDS = [
  YEARLY_SUBSCRIPTION_PRICE_ID,
  MONTHLY_SUBSCRIPTION_PRICE_ID,
  YEARLY_PASS_PRICE_ID,
  MONTHLY_PASS_PRICE_ID,
  FEATURED_LISTING_PRICE_ID
];

const MEMBERSHIP_PRICE_IDS = [
  YEARLY_SUBSCRIPTION_PRICE_ID,
  MONTHLY_SUBSCRIPTION_PRICE_ID,
  YEARLY_PASS_PRICE_ID,
  MONTHLY_PASS_PRICE_ID
];

function getPlanFromPriceId(priceId) {
  if (
    priceId === YEARLY_SUBSCRIPTION_PRICE_ID ||
    priceId === YEARLY_PASS_PRICE_ID
  ) {
    return "yearly";
  }

  if (
    priceId === MONTHLY_SUBSCRIPTION_PRICE_ID ||
    priceId === MONTHLY_PASS_PRICE_ID
  ) {
    return "monthly";
  }

  if (priceId === FEATURED_LISTING_PRICE_ID) {
    return "featured";
  }

  return "unknown";
}

function getBillingTypeFromPriceId(priceId) {
  if (
    priceId === YEARLY_SUBSCRIPTION_PRICE_ID ||
    priceId === MONTHLY_SUBSCRIPTION_PRICE_ID
  ) {
    return "subscription";
  }

  if (
    priceId === YEARLY_PASS_PRICE_ID ||
    priceId === MONTHLY_PASS_PRICE_ID
  ) {
    return "oneoff";
  }

  if (priceId === FEATURED_LISTING_PRICE_ID) {
    return "featured";
  }

  return "unknown";
}

function getPassExpiryDate(priceId) {
  const now = new Date();

  if (priceId === MONTHLY_PASS_PRICE_ID) {
    now.setDate(now.getDate() + 30);
    return admin.firestore.Timestamp.fromDate(now);
  }

  if (priceId === YEARLY_PASS_PRICE_ID) {
    now.setDate(now.getDate() + 365);
    return admin.firestore.Timestamp.fromDate(now);
  }

  return null;
}

function isActiveMember(userData) {
  if (!userData) return false;

  if (isAdminUser(userData)) return true;

  if (hasActiveFreeCharityYear(userData)) return true;

  if (userData.accessType === "admin_granted_free_year") return false;

  if (userData.hasSubscription !== true) return false;

  const expiresAt = getDateFromFirestoreValue(userData.subscriptionExpiresAt);

  // Cancelled subscriptions keep access until the paid period ends.
  if (userData.subscriptionStatus === "cancelling") {
    return Boolean(expiresAt && expiresAt > new Date());
  }

  if (userData.subscriptionStatus !== "active") {
    return false;
  }

  if (expiresAt) {
    return expiresAt > new Date();
  }

  return true;
}

function getUserRole(userData) {
  if (!userData) return "standard";

  if (
    userData.role === "standard" ||
    userData.role === "member" ||
    userData.role === "moderator" ||
    userData.role === "admin" ||
    userData.role === "super_admin"
  ) {
    return userData.role;
  }

  if (userData.accountType === "admin" || userData.isAdmin === true) {
    return "admin";
  }

  if (userData.hasSubscription === true || userData.isFoundingMember === true) {
    return "member";
  }

  return "standard";
}

function isSuperAdmin(userData) {
  return getUserRole(userData) === "super_admin";
}

function isAdmin(userData) {
  return getUserRole(userData) === "admin";
}

function isAdminUser(userData) {
  return isAdmin(userData) || isSuperAdmin(userData);
}

function getDateFromFirestoreValue(value) {
  if (!value) return null;

  if (value.toDate) {
    return value.toDate();
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function hasActiveFreeCharityYear(userData) {
  if (!userData) return false;

  if (userData.accessType !== "admin_granted_free_year") {
    return false;
  }

  const expiresAt = getDateFromFirestoreValue(userData.freeAccessExpiresAt);
  return Boolean(expiresAt && expiresAt > new Date());
}

function getRoleAfterMembershipActivation(userData) {
  const role = getUserRole(userData);

  if (role === "moderator" || role === "admin" || role === "super_admin") {
    return role;
  }

  return "member";
}

function getLifetimeExpiryTimestamp() {
  return admin.firestore.Timestamp.fromDate(new Date("2099-12-31T23:59:59.000Z"));
}

function getSuperAdminProfileData(uid, account) {
  const lifetimeExpiry = getLifetimeExpiryTimestamp();

  return {
    uid,
    fullName: account.displayName,
    displayName: account.displayName,
    email: account.email,
    role: "super_admin",
    internalAccount: true,
    excludeFromFoundingMemberCount: true,
    canImpersonateUsers: true,
    impersonationReady: true,
    canViewHiddenDiagnostics: true,
    hasSubscription: true,
    subscriptionStatus: "active",
    subscriptionPlan: "lifetime",
    subscriptionBillingType: "internal-lifetime",
    subscriptionExpiresAt: lifetimeExpiry,
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    membershipPlan: "lifetime",
    membershipStatus: "active",
    tradesJobAccess: true,
    tradesJobAccessStatus: "active",
    tradesJobAccessPaidAt: admin.firestore.FieldValue.serverTimestamp(),
    tradesJobAccessExpiresAt: lifetimeExpiry,
    tradesJobAccessAmount: 0,
    isFoundingMember: false,
    memberNumber: null,
    accountType: "admin",
    isAdmin: true,
    isPublic: true,
    hasSeenIntro: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

function hasPaidMembershipData(userData) {
  if (!userData) return false;

  return (
    userData.subscriptionBillingType === "subscription" ||
    userData.subscriptionBillingType === "oneoff" ||
    Boolean(userData.stripeSubscriptionId) ||
    (
      Boolean(userData.stripePriceId) &&
      userData.subscriptionBillingType !== "founding-free-year"
    )
  );
}

function getInternalPaymentTesterProfileData(uid, account, existingData) {
  const profileData = {
    uid,
    fullName: account.displayName,
    displayName: account.displayName,
    email: account.email,
    role: "member",
    internalAccount: true,
    excludeFromFoundingMemberCount: true,
    canImpersonateUsers: false,
    impersonationReady: false,
    canViewHiddenDiagnostics: false,
    isFoundingMember: false,
    memberNumber: null,
    accountType: "member",
    isAdmin: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };

  const shouldResetMembership =
    !existingData ||
    existingData.isFoundingMember === true ||
    existingData.subscriptionBillingType === "founding-free-year" ||
    existingData.subscriptionPlan === "founding" ||
    !hasPaidMembershipData(existingData);

  if (shouldResetMembership) {
    return {
      ...profileData,
      hasSubscription: false,
      subscriptionStatus: "inactive",
      subscriptionPlan: "none",
      subscriptionBillingType: "none",
      subscriptionExpiresAt: null,
      subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
      membershipPlan: "pending",
      membershipStatus: "pending-payment",
      stripeCustomerId: existingData?.stripeCustomerId || "",
      stripeSubscriptionId: "",
      stripePriceId: "",
      featuredListing: false,
      featuredListingStatus: "inactive",
      featuredExpiresAt: null,
      tradesJobAccess: false,
      tradesJobAccessStatus: "inactive",
      tradesJobAccessExpiresAt: null,
      hasSeenIntro: existingData?.hasSeenIntro === true,
      isPublic: existingData?.isPublic === true
    };
  }

  return profileData;
}

async function verifyRequestUser(req, uid) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer (.+)$/);

  if (!match) {
    return false;
  }

  const decodedToken = await admin.auth().verifyIdToken(match[1]);
  return decodedToken.uid === uid;
}

async function getAuthorizedAdmin(req) {
  const authorization = req.get("authorization") || "";
  const match = authorization.match(/^Bearer (.+)$/);

  if (!match) {
    throw new Error("Missing admin authorization token");
  }

  const decodedToken = await admin.auth().verifyIdToken(match[1]);
  const adminSnap = await admin
    .firestore()
    .collection("users")
    .doc(decodedToken.uid)
    .get();

  if (!adminSnap.exists || !isAdminUser(adminSnap.data())) {
    throw new Error("Admins only");
  }

  return {
    uid: decodedToken.uid,
    email: decodedToken.email || adminSnap.data().email || "",
    data: adminSnap.data()
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidTemporaryPassword(password) {
  return typeof password === "string" && password.length >= 8;
}

function getFreeAccessExpiryTimestamp() {
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);
  return admin.firestore.Timestamp.fromDate(expiryDate);
}

function getInviteExpiryTimestamp() {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);
  return admin.firestore.Timestamp.fromDate(expiryDate);
}

function getFreeCharityGrantData({
  email,
  charityName,
  adminNotes,
  grantedBy,
  freeAccessExpiresAt
}) {
  return {
    email,
    hasSubscription: true,
    subscriptionStatus: "active",
    membershipStatus: "active",
    accountType: "member",
    accessType: "admin_granted_free_year",
    freeAccessReason: "charity",
    freeAccessExpiresAt,
    freeAccessGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
    freeAccessGrantedBy: grantedBy,
    charityName,
    adminNotes,
    subscriptionPlan: "free_charity_year",
    subscriptionBillingType: "admin_granted_free_year",
    membershipPlan: "free_charity_year",
    subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  };
}

async function findUserDocByEmail(email) {
  const snapshot = await admin
    .firestore()
    .collection("users")
    .where("email", "==", email)
    .limit(1)
    .get();

  return snapshot.empty ? null : snapshot.docs[0];
}

function getFeaturedExpiryDate(existingFeaturedExpiresAt) {
  const now = new Date();

  let startDate = now;

  if (
    existingFeaturedExpiresAt &&
    existingFeaturedExpiresAt.toDate &&
    existingFeaturedExpiresAt.toDate() > now
  ) {
    startDate = existingFeaturedExpiresAt.toDate();
  }

  startDate.setDate(startDate.getDate() + 30);

  return admin.firestore.Timestamp.fromDate(startDate);
}

function getTradesJobAccessExpiryDate() {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + 30);
  return admin.firestore.Timestamp.fromDate(expiryDate);
}

function getSubscriptionExpiryTimestamp(subscription) {
  if (subscription.current_period_end) {
    return admin.firestore.Timestamp.fromMillis(
      subscription.current_period_end * 1000
    );
  }

  if (subscription.cancel_at) {
    return admin.firestore.Timestamp.fromMillis(subscription.cancel_at * 1000);
  }

  if (subscription.ended_at) {
    return admin.firestore.Timestamp.fromMillis(subscription.ended_at * 1000);
  }

  return null;
}

function getSubscriptionFirestoreStatus(subscription) {
  if (
    subscription.cancel_at_period_end === true &&
    (subscription.status === "active" || subscription.status === "trialing")
  ) {
    return "cancelling";
  }

  return subscription.status || "unknown";
}

function getCheckoutSessionPriceId(session) {
  return (
    session.line_items?.data?.[0]?.price?.id ||
    session.metadata?.priceId ||
    ""
  );
}

function isCheckoutSessionPaid(session) {
  return (
    session &&
    session.status === "complete" &&
    (
      session.payment_status === "paid" ||
      session.payment_status === "no_payment_required"
    )
  );
}

function getSafeSignupSessionData(session, priceId) {
  return {
    planName: getPlanFromPriceId(priceId),
    priceId,
    billingType: getBillingTypeFromPriceId(priceId),
    stripeCustomerId:
      typeof session.customer === "string"
        ? session.customer
        : session.customer?.id || "",
    stripeSubscriptionId:
      typeof session.subscription === "string"
        ? session.subscription
        : session.subscription?.id || "",
    checkoutSessionId: session.id,
    email: session.customer_details?.email || session.customer_email || ""
  };
}

async function verifyStripeSignupSession(stripe, sessionId) {
  if (!sessionId || typeof sessionId !== "string") {
    throw new Error("Missing checkout session ID");
  }

  const session = await stripe.checkout.sessions.retrieve(sessionId, {
    expand: ["line_items.data.price"]
  });

  if (!session || !isCheckoutSessionPaid(session)) {
    throw new Error("Checkout session is not paid");
  }

  const priceId = getCheckoutSessionPriceId(session);

  if (!MEMBERSHIP_PRICE_IDS.includes(priceId)) {
    throw new Error("Checkout session is not for a valid membership plan");
  }

  if (
    session.mode === "subscription" &&
    getBillingTypeFromPriceId(priceId) !== "subscription"
  ) {
    throw new Error("Checkout session billing type does not match the plan");
  }

  if (
    session.mode === "payment" &&
    getBillingTypeFromPriceId(priceId) !== "oneoff"
  ) {
    throw new Error("Checkout session billing type does not match the plan");
  }

  return { session, priceId };
}

async function findUserByStripeSubscriptionId(subscriptionId) {
  const snapshot = await admin
    .firestore()
    .collection("users")
    .where("stripeSubscriptionId", "==", subscriptionId)
    .limit(1)
    .get();

  if (snapshot.empty) {
    return null;
  }

  return snapshot.docs[0];
}

async function updateUserFromStripeSubscription(subscription) {
  const userDoc = await findUserByStripeSubscriptionId(subscription.id);

  if (!userDoc) {
    console.log(`No matching user found for subscription ${subscription.id}`);
    return;
  }

  if (isSuperAdmin(userDoc.data())) {
    console.log(`Skipping subscription update for Super Admin ${userDoc.id}`);
    return;
  }

  const priceId = subscription.items?.data?.[0]?.price?.id || "";
  const status = getSubscriptionFirestoreStatus(subscription);
  const expiresAt = getSubscriptionExpiryTimestamp(subscription);

  const hasSubscription = status === "active" || status === "cancelling";

  await userDoc.ref.set(
    {
      role: getRoleAfterMembershipActivation(userDoc.data()),
      hasSubscription,
      subscriptionStatus: status,
      membershipStatus: hasSubscription ? "active" : "not_paid",
      accountType: hasSubscription ? "member" : "lead",
      subscriptionPlan: getPlanFromPriceId(priceId),
      subscriptionBillingType: "subscription",
      subscriptionExpiresAt: expiresAt,
      subscriptionCancelAtPeriodEnd:
        subscription.cancel_at_period_end === true,
      subscriptionCancelledAt: subscription.cancel_at_period_end
        ? admin.firestore.FieldValue.serverTimestamp()
        : null,
      stripeCustomerId:
        typeof subscription.customer === "string"
          ? subscription.customer
          : subscription.customer?.id || "",
      stripeSubscriptionId: subscription.id,
      stripePriceId: priceId,
      subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
    },
    { merge: true }
  );

  console.log(`Subscription updated for user ${userDoc.id}`);
}

module.exports = {
  ACTIVE_PROJECT_PAYMENT_PRICE_IDS,
  ALL_PRICE_IDS,
  FEATURED_LISTING_PRICE_ID,
  MEMBERSHIP_PRICE_IDS,
  MONTHLY_PASS_PRICE_ID,
  MONTHLY_SUBSCRIPTION_PRICE_ID,
  PROJECT_PAYMENT_PRICE_IDS,
  PROJECT_PAYMENT_PRICE_MODE,
  PROJECT_WORKSPACE_UNLOCK_PRICE_ID,
  Stripe,
  TRADES_JOB_ACCESS_PRICE_ID,
  YEARLY_PASS_PRICE_ID,
  YEARLY_SUBSCRIPTION_PRICE_ID,
  admin,
  buildPublicProfile,
  crypto,
  defineSecret,
  findUserByStripeSubscriptionId,
  findUserDocByEmail,
  getAuthorizedAdmin,
  getBillingTypeFromPriceId,
  getCheckoutSessionPriceId,
  getDateFromFirestoreValue,
  getFeaturedExpiryDate,
  getFreeAccessExpiryTimestamp,
  getFreeCharityGrantData,
  getInternalPaymentTesterProfileData,
  getInviteExpiryTimestamp,
  getLifetimeExpiryTimestamp,
  getPassExpiryDate,
  getPlanFromPriceId,
  getRoleAfterMembershipActivation,
  getSafeSignupSessionData,
  getSubscriptionExpiryTimestamp,
  getSubscriptionFirestoreStatus,
  getSuperAdminProfileData,
  getTradesJobAccessExpiryDate,
  getUserRole,
  hasActiveFreeCharityYear,
  hasPaidMembershipData,
  internalPaymentTesterAccountJson,
  internalPaymentTesterSeedToken,
  isActiveMember,
  isAdmin,
  isAdminUser,
  isCheckoutSessionPaid,
  isSuperAdmin,
  isValidEmail,
  isValidTemporaryPassword,
  normalizeEmail,
  onDocumentWritten,
  onRequest,
  stripeSecret,
  stripeWebhookSecret,
  superAdminAccountsJson,
  superAdminSeedToken,
  updateUserFromStripeSubscription,
  verifyRequestUser,
  verifyStripeSignupSession
};
