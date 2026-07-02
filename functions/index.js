const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const crypto = require("crypto");
const Stripe = require("stripe");

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

  if (userData.subscriptionStatus !== "active") {
    return false;
  }

  if (userData.subscriptionExpiresAt && userData.subscriptionExpiresAt.toDate) {
    return userData.subscriptionExpiresAt.toDate() > new Date();
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

  const hasSubscription = status === "active";

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

exports.verifyPaidSignupSession = onRequest(
  {
    region: "europe-west1",
    cors: true,
    secrets: [stripeSecret],
    maxInstances: 10
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "https://sangatworks.co.uk");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const { sessionId, claimForUid } = body;
      const stripe = Stripe(stripeSecret.value());
      const { session, priceId } = await verifyStripeSignupSession(
        stripe,
        sessionId
      );
      const safeSessionData = getSafeSignupSessionData(session, priceId);
      const sessionRef = admin
        .firestore()
        .collection("usedSignupCheckoutSessions")
        .doc(session.id);

      if (claimForUid) {
        if (!(await verifyRequestUser(req, claimForUid))) {
          return res.status(403).json({ error: "Invalid user token" });
        }

        await admin.firestore().runTransaction(async (transaction) => {
          const usedSnap = await transaction.get(sessionRef);

          if (usedSnap.exists) {
            throw new Error("Checkout session has already been used");
          }

          transaction.set(sessionRef, {
            checkoutSessionId: session.id,
            uid: claimForUid,
            email: safeSessionData.email,
            stripeCustomerId: safeSessionData.stripeCustomerId,
            stripeSubscriptionId: safeSessionData.stripeSubscriptionId,
            stripePriceId: priceId,
            billingType: safeSessionData.billingType,
            planName: safeSessionData.planName,
            claimedAt: admin.firestore.FieldValue.serverTimestamp()
          });
        });

        return res.status(200).json({
          verified: true,
          claimed: true,
          signup: safeSessionData
        });
      }

      const usedSnap = await sessionRef.get();

      if (usedSnap.exists) {
        return res.status(409).json({
          error: "Checkout session has already been used"
        });
      }

      return res.status(200).json({
        verified: true,
        claimed: false,
        signup: safeSessionData
      });
    } catch (error) {
      console.error("Paid signup session verification error:", error);
      return res.status(400).json({
        verified: false,
        error: error.message || "Checkout session could not be verified"
      });
    }
  }
);

exports.grantFreeCharityYear = onRequest(
  {
    region: "europe-west1",
    cors: true,
    maxInstances: 10
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "https://sangatworks.co.uk");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const requestingAdmin = await getAuthorizedAdmin(req);
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const email = normalizeEmail(body.email);
      const charityName = String(body.charityName || "").trim();
      const adminNotes = String(body.adminNotes || "").trim();

      if (!email || !charityName) {
        return res.status(400).json({
          error: "Email and charity/organisation name are required"
        });
      }

      if (normalizeEmail(requestingAdmin.email) === email) {
        return res.status(403).json({
          error: "Admins cannot grant a free year to themselves"
        });
      }

      const freeAccessExpiresAt = getFreeAccessExpiryTimestamp();
      const grantData = getFreeCharityGrantData({
        email,
        charityName,
        adminNotes,
        grantedBy: requestingAdmin.uid,
        freeAccessExpiresAt
      });

      let targetUid = "";
      let resultType = "invite_created";

      try {
        const authUser = await admin.auth().getUserByEmail(email);
        targetUid = authUser.uid;
      } catch (error) {
        if (error.code !== "auth/user-not-found") {
          throw error;
        }
      }

      if (!targetUid) {
        const userDoc = await findUserDocByEmail(email);
        targetUid = userDoc?.id || "";
      }

      if (targetUid) {
        await admin
          .firestore()
          .collection("users")
          .doc(targetUid)
          .set(
            {
              uid: targetUid,
              ...grantData
            },
            { merge: true }
          );

        resultType = "existing_user_updated";
      } else {
        const token = crypto.randomBytes(24).toString("hex");
        const inviteExpiresAt = getInviteExpiryTimestamp();

        await admin
          .firestore()
          .collection("freeAccessInvites")
          .doc(token)
          .set({
            token,
            email,
            charityName,
            adminNotes,
            status: "pending",
            accessType: "admin_granted_free_year",
            freeAccessReason: "charity",
            freeAccessExpiresAt,
            inviteExpiresAt,
            createdAt: admin.firestore.FieldValue.serverTimestamp(),
            createdBy: requestingAdmin.uid
          });

        await admin.firestore().collection("freeAccessGrantLogs").add({
          action: "invite_created",
          email,
          charityName,
          adminNotes,
          grantedBy: requestingAdmin.uid,
          freeAccessExpiresAt,
          inviteExpiresAt,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        return res.status(200).json({
          success: true,
          type: resultType,
          inviteUrl: `https://sangatworks.co.uk/signup.html?invite_token=${token}`,
          inviteExpiresAt: inviteExpiresAt.toDate().toISOString(),
          freeAccessExpiresAt: freeAccessExpiresAt.toDate().toISOString()
        });
      }

      await admin.firestore().collection("freeAccessGrantLogs").add({
        action: resultType,
        uid: targetUid,
        email,
        charityName,
        adminNotes,
        grantedBy: requestingAdmin.uid,
        freeAccessExpiresAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({
        success: true,
        type: resultType,
        uid: targetUid,
        freeAccessExpiresAt: freeAccessExpiresAt.toDate().toISOString()
      });
    } catch (error) {
      console.error("Free Charity Year grant error:", error);
      const status =
        error.message === "Admins only" ||
        error.message === "Missing admin authorization token"
          ? 403
          : 500;
      return res.status(status).json({
        error: error.message || "Could not grant Free Charity Year"
      });
    }
  }
);

exports.createFreeCharityAccount = onRequest(
  {
    region: "europe-west1",
    cors: true,
    maxInstances: 10
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "https://sangatworks.co.uk");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const requestingAdmin = await getAuthorizedAdmin(req);
      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const email = normalizeEmail(body.email);
      const temporaryPassword = String(body.temporaryPassword || "");
      const charityName = String(body.charityName || "").trim();
      const adminNotes = String(body.notes || body.adminNotes || "").trim();

      if (!isValidEmail(email)) {
        return res.status(400).json({ error: "Enter a valid email address" });
      }

      if (!isValidTemporaryPassword(temporaryPassword)) {
        return res.status(400).json({
          error: "Temporary password must be at least 8 characters"
        });
      }

      if (!charityName) {
        return res.status(400).json({
          error: "Charity/organisation name is required"
        });
      }

      if (normalizeEmail(requestingAdmin.email) === email) {
        return res.status(403).json({
          error: "Admins cannot create a free charity account for themselves"
        });
      }

      const freeAccessExpiresAt = getFreeAccessExpiryTimestamp();
      let authUser = null;
      let createdAuthUser = false;
      let passwordWasSet = false;

      try {
        authUser = await admin.auth().getUserByEmail(email);
      } catch (error) {
        if (error.code !== "auth/user-not-found") {
          throw error;
        }

        authUser = await admin.auth().createUser({
          email,
          password: temporaryPassword,
          displayName: charityName,
          emailVerified: false,
          disabled: false
        });
        createdAuthUser = true;
        passwordWasSet = true;
      }

      const grantData = getFreeCharityGrantData({
        email,
        charityName,
        adminNotes,
        grantedBy: requestingAdmin.uid,
        freeAccessExpiresAt
      });

      const userRef = admin.firestore().collection("users").doc(authUser.uid);
      const existingUserSnap = await userRef.get();
      const existingUserData = existingUserSnap.exists
        ? existingUserSnap.data()
        : {};

      await userRef.set(
        {
          uid: authUser.uid,
          fullName:
            existingUserData.fullName ||
            existingUserData.displayName ||
            charityName,
          displayName:
            existingUserData.displayName ||
            existingUserData.fullName ||
            charityName,
          role: existingUserData.role || "standard",
          internalAccount: existingUserData.internalAccount === true,
          createdByAdmin: true,
          ...grantData,
          createdAt: existingUserSnap.exists
            ? existingUserData.createdAt || admin.firestore.FieldValue.serverTimestamp()
            : admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      await admin.firestore().collection("freeAccessGrantLogs").add({
        action: createdAuthUser
          ? "free_charity_account_created"
          : "existing_auth_user_free_charity_updated",
        uid: authUser.uid,
        email,
        charityName,
        adminNotes,
        grantedBy: requestingAdmin.uid,
        createdAuthUser,
        passwordWasSet,
        freeAccessExpiresAt,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({
        success: true,
        uid: authUser.uid,
        email,
        charityName,
        createdAuthUser,
        passwordWasSet,
        freeAccessExpiresAt: freeAccessExpiresAt.toDate().toISOString()
      });
    } catch (error) {
      console.error("Create Free Charity Account error:", error);
      const status =
        error.message === "Admins only" ||
        error.message === "Missing admin authorization token"
          ? 403
          : 500;
      return res.status(status).json({
        error: error.message || "Could not create Free Charity Account"
      });
    }
  }
);

exports.verifyFreeCharityInvite = onRequest(
  {
    region: "europe-west1",
    cors: true,
    maxInstances: 10
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "https://sangatworks.co.uk");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;
      const token = String(body.inviteToken || "").trim();

      if (!token) {
        return res.status(400).json({ error: "Missing invite token" });
      }

      const inviteRef = admin
        .firestore()
        .collection("freeAccessInvites")
        .doc(token);
      const inviteSnap = await inviteRef.get();

      if (!inviteSnap.exists) {
        return res.status(404).json({ error: "Invite not found" });
      }

      const invite = inviteSnap.data();
      const inviteExpiresAt = getDateFromFirestoreValue(invite.inviteExpiresAt);
      const freeAccessExpiresAt = getDateFromFirestoreValue(
        invite.freeAccessExpiresAt
      );

      if (
        invite.status !== "pending" ||
        !inviteExpiresAt ||
        inviteExpiresAt <= new Date() ||
        !freeAccessExpiresAt ||
        freeAccessExpiresAt <= new Date()
      ) {
        return res.status(400).json({
          error: "Invite is invalid, expired, or already used"
        });
      }

      if (!body.claimForUid) {
        return res.status(200).json({
          verified: true,
          claimed: false,
          invite: {
            email: invite.email,
            charityName: invite.charityName,
            freeAccessExpiresAt: freeAccessExpiresAt.toISOString()
          }
        });
      }

      const authorization = req.get("authorization") || "";
      const match = authorization.match(/^Bearer (.+)$/);

      if (!match) {
        return res.status(403).json({ error: "Missing user token" });
      }

      const decodedToken = await admin.auth().verifyIdToken(match[1]);

      if (decodedToken.uid !== body.claimForUid) {
        return res.status(403).json({ error: "Invalid user token" });
      }

      if (normalizeEmail(decodedToken.email) !== normalizeEmail(invite.email)) {
        return res.status(403).json({
          error: "Invite email does not match the signed-in account"
        });
      }

      const claimedData = await admin.firestore().runTransaction(
        async (transaction) => {
          const freshInviteSnap = await transaction.get(inviteRef);

          if (!freshInviteSnap.exists) {
            throw new Error("Invite not found");
          }

          const freshInvite = freshInviteSnap.data();
          const freshInviteExpiresAt = getDateFromFirestoreValue(
            freshInvite.inviteExpiresAt
          );
          const freshFreeAccessExpiresAt = getDateFromFirestoreValue(
            freshInvite.freeAccessExpiresAt
          );

          if (
            freshInvite.status !== "pending" ||
            !freshInviteExpiresAt ||
            freshInviteExpiresAt <= new Date() ||
            !freshFreeAccessExpiresAt ||
            freshFreeAccessExpiresAt <= new Date()
          ) {
            throw new Error("Invite is invalid, expired, or already used");
          }

          const userRef = admin
            .firestore()
            .collection("users")
            .doc(decodedToken.uid);
          const grantData = getFreeCharityGrantData({
            email: normalizeEmail(freshInvite.email),
            charityName: freshInvite.charityName,
            adminNotes: freshInvite.adminNotes || "",
            grantedBy: freshInvite.createdBy,
            freeAccessExpiresAt: freshInvite.freeAccessExpiresAt
          });

          transaction.set(
            userRef,
            {
              uid: decodedToken.uid,
              displayName: decodedToken.name || "",
              role: "standard",
              ...grantData,
              freeAccessInviteToken: token,
              createdAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );

          transaction.set(
            inviteRef,
            {
              status: "used",
              usedBy: decodedToken.uid,
              usedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );

          return {
            email: normalizeEmail(freshInvite.email),
            charityName: freshInvite.charityName,
            freeAccessExpiresAt: freshFreeAccessExpiresAt.toISOString()
          };
        }
      );

      await admin.firestore().collection("freeAccessGrantLogs").add({
        action: "invite_claimed",
        uid: decodedToken.uid,
        email: claimedData.email,
        charityName: claimedData.charityName,
        inviteToken: token,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      return res.status(200).json({
        verified: true,
        claimed: true,
        invite: claimedData
      });
    } catch (error) {
      console.error("Free Charity Year invite error:", error);
      return res.status(400).json({
        verified: false,
        error: error.message || "Invite could not be verified"
      });
    }
  }
);

exports.createCheckoutSession = onRequest(
  {
    region: "europe-west1",
    cors: true,
    secrets: [stripeSecret],
    maxInstances: 10
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "https://sangatworks.co.uk");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const { priceId, billingType, uid, email } = body;

      if (!priceId || !billingType || !email) {
        return res.status(400).json({
          error: "Missing priceId, billingType or email"
        });
      }

      if (!ALL_PRICE_IDS.includes(priceId)) {
        return res.status(400).json({
          error: "Invalid price ID"
        });
      }

      const expectedBillingType = getBillingTypeFromPriceId(priceId);

      if (billingType !== expectedBillingType) {
        return res.status(400).json({
          error: "Invalid billing type for selected price"
        });
      }

      if (billingType === "featured" && !uid) {
        return res.status(400).json({
          error: "Missing uid for Featured Listing checkout"
        });
      }

      if (billingType === "featured") {
        const userSnap = await admin
          .firestore()
          .collection("users")
          .doc(uid)
          .get();

        if (!userSnap.exists || !isActiveMember(userSnap.data())) {
          return res.status(403).json({
            error: "Featured Listing is only available to active members"
          });
        }
      }

      const stripe = Stripe(stripeSecret.value());
      const metadata = {
        uid: uid || "",
        email,
        priceId,
        billingType
      };

      const session = await stripe.checkout.sessions.create({
        mode: billingType === "subscription" ? "subscription" : "payment",
        customer_email: email,
        line_items: [
          {
            price: priceId,
            quantity: 1
          }
        ],
        success_url:
          "https://sangatworks.co.uk/success.html?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: "https://sangatworks.co.uk/cancel.html",
        metadata,
        payment_intent_data:
          billingType === "oneoff" || billingType === "featured"
            ? {
                metadata
              }
            : undefined,
        subscription_data:
          billingType === "subscription"
            ? {
                metadata
              }
            : undefined
      });

      return res.status(200).json({
        url: session.url
      });
    } catch (error) {
      console.error("Stripe checkout error:", error);
      return res.status(500).json({
        error: error.message || "Stripe checkout failed"
      });
    }
  }
);

exports.cancelSubscription = onRequest(
  {
    region: "europe-west1",
    cors: true,
    secrets: [stripeSecret],
    maxInstances: 10
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "https://sangatworks.co.uk");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const { uid } = body;

      if (!uid) {
        return res.status(400).json({
          error: "Missing uid"
        });
      }

      const userRef = admin.firestore().collection("users").doc(uid);
      const userSnap = await userRef.get();

      if (!userSnap.exists) {
        return res.status(404).json({
          error: "User profile not found"
        });
      }

      const userData = userSnap.data();

      if (userData.subscriptionBillingType !== "subscription") {
        return res.status(400).json({
          error: "Only rolling subscriptions can be cancelled here"
        });
      }

      if (!userData.stripeSubscriptionId) {
        return res.status(400).json({
          error: "No Stripe subscription found for this user"
        });
      }

      if (userData.subscriptionCancelAtPeriodEnd === true) {
        return res.status(200).json({
          success: true,
          message: "Subscription is already set to cancel at period end"
        });
      }

      const stripe = Stripe(stripeSecret.value());

      const subscription = await stripe.subscriptions.update(
        userData.stripeSubscriptionId,
        {
          cancel_at_period_end: true
        }
      );

      const expiresAt = getSubscriptionExpiryTimestamp(subscription);

      await userRef.set(
        {
          subscriptionStatus: "cancelling",
          subscriptionCancelAtPeriodEnd: true,
          subscriptionCancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          subscriptionExpiresAt: expiresAt,
          subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      return res.status(200).json({
        success: true,
        message: "Subscription will cancel at the end of the current billing period"
      });
    } catch (error) {
      console.error("Cancel subscription error:", error);
      return res.status(500).json({
        error: error.message || "Failed to cancel subscription"
      });
    }
  }
);

exports.createProjectWorkspaceUnlockSession = onRequest(
  {
    region: "europe-west1",
    cors: true,
    secrets: [stripeSecret],
    maxInstances: 10
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "https://sangatworks.co.uk");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const { uid, email, projectId } = body;

      if (!uid || !email || !projectId) {
        return res.status(400).json({
          error: "Missing uid, email or projectId"
        });
      }

      if (!(await verifyRequestUser(req, uid))) {
        return res.status(403).json({ error: "Invalid user token" });
      }

      const projectRef = admin.firestore().collection("projects").doc(projectId);
      const projectSnap = await projectRef.get();

      if (!projectSnap.exists) {
        return res.status(404).json({ error: "Project not found" });
      }

      const project = projectSnap.data();

      if (project.ownerId !== uid) {
        return res.status(403).json({
          error: "Only the project owner can unlock this workspace"
        });
      }

      if (project.workspaceUnlocked === true) {
        return res.status(400).json({
          error: "This workspace is already unlocked"
        });
      }

      const stripe = Stripe(stripeSecret.value());

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        line_items: [
          {
            price: PROJECT_WORKSPACE_UNLOCK_PRICE_ID,
            quantity: 1
          }
        ],
        success_url: `https://sangatworks.co.uk/project-workspace.html?id=${encodeURIComponent(projectId)}`,
        cancel_url: `https://sangatworks.co.uk/project-workspace.html?id=${encodeURIComponent(projectId)}`,
        metadata: {
          uid,
          email,
          projectId,
          priceId: PROJECT_WORKSPACE_UNLOCK_PRICE_ID,
          billingType: "project_workspace_unlock"
        },
        payment_intent_data: {
          metadata: {
            uid,
            email,
            projectId,
            priceId: PROJECT_WORKSPACE_UNLOCK_PRICE_ID,
            billingType: "project_workspace_unlock"
          }
        }
      });

      return res.status(200).json({ url: session.url });
    } catch (error) {
      console.error("Workspace checkout error:", error);
      return res.status(500).json({
        error: error.message || "Workspace checkout failed"
      });
    }
  }
);

exports.createTradesJobAccessCheckoutSession = onRequest(
  {
    region: "europe-west1",
    cors: true,
    secrets: [stripeSecret],
    maxInstances: 10
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "https://sangatworks.co.uk");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const { uid, email } = body;

      if (!uid || !email) {
        return res.status(400).json({
          error: "Missing uid or email"
        });
      }

      if (!(await verifyRequestUser(req, uid))) {
        return res.status(403).json({ error: "Invalid user token" });
      }

      const openJobsSnap = await admin
        .firestore()
        .collection("projects")
        .where("status", "==", "open")
        .limit(1)
        .get();

      if (openJobsSnap.empty) {
        return res.status(400).json({
          error: "No open jobs are currently available. Please check back soon."
        });
      }

      const stripe = Stripe(stripeSecret.value());

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        customer_email: email,
        line_items: [
          {
            price: TRADES_JOB_ACCESS_PRICE_ID,
            quantity: 1
          }
        ],
        success_url: "https://sangatworks.co.uk/projects.html#openProjectsSection",
        cancel_url: "https://sangatworks.co.uk/projects.html#openProjectsSection",
        metadata: {
          uid,
          email,
          priceId: TRADES_JOB_ACCESS_PRICE_ID,
          billingType: "trades_job_access"
        },
        payment_intent_data: {
          metadata: {
            uid,
            email,
            priceId: TRADES_JOB_ACCESS_PRICE_ID,
            billingType: "trades_job_access"
          }
        }
      });

      return res.status(200).json({ url: session.url });
    } catch (error) {
      console.error("Trades job access checkout error:", error);
      return res.status(500).json({
        error: error.message || "Trades job access checkout failed"
      });
    }
  }
);

exports.unlockProjectWorkspaceAsSuperAdmin = onRequest(
  {
    region: "europe-west1",
    cors: true,
    maxInstances: 10
  },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", "https://sangatworks.co.uk");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
      return res.status(204).send("");
    }

    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body;

      const { uid, projectId } = body;

      if (!uid || !projectId) {
        return res.status(400).json({
          error: "Missing uid or projectId"
        });
      }

      if (!(await verifyRequestUser(req, uid))) {
        return res.status(403).json({ error: "Invalid user token" });
      }

      const userSnap = await admin.firestore().collection("users").doc(uid).get();

      if (!userSnap.exists || !isSuperAdmin(userSnap.data())) {
        return res.status(403).json({
          error: "Only Super Admins can unlock workspaces without payment"
        });
      }

      const projectRef = admin.firestore().collection("projects").doc(projectId);
      const projectSnap = await projectRef.get();

      if (!projectSnap.exists) {
        return res.status(404).json({ error: "Project not found" });
      }

      await projectRef.set(
        {
          workspaceUnlocked: true,
          workspacePaymentStatus: "super_admin_unlocked",
          workspacePaidAt: admin.firestore.FieldValue.serverTimestamp(),
          workspacePaidBy: uid,
          workspaceUnlockAmount: 0,
          workspaceUnlockedByRole: "super_admin",
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        },
        { merge: true }
      );

      return res.status(200).json({ unlocked: true });
    } catch (error) {
      console.error("Super Admin workspace unlock error:", error);
      return res.status(500).json({
        error: error.message || "Workspace unlock failed"
      });
    }
  }
);

exports.seedSuperAdmins = onRequest(
  {
    region: "europe-west1",
    secrets: [superAdminSeedToken, superAdminAccountsJson],
    maxInstances: 1
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const providedToken = req.get("x-seed-token") || "";

      if (!providedToken || providedToken !== superAdminSeedToken.value()) {
        return res.status(403).json({ error: "Invalid seed token" });
      }

      const accounts = JSON.parse(superAdminAccountsJson.value());

      if (!Array.isArray(accounts) || accounts.length === 0) {
        return res.status(400).json({
          error: "SUPER_ADMIN_ACCOUNTS_JSON must be a non-empty JSON array"
        });
      }

      const results = [];

      for (const account of accounts) {
        if (!account.email || !account.password || !account.displayName) {
          results.push({
            email: account.email || "missing",
            status: "skipped",
            reason: "Missing email, password or displayName"
          });
          continue;
        }

        let authUser;
        let created = false;

        try {
          authUser = await admin.auth().getUserByEmail(account.email);
        } catch (error) {
          if (error.code !== "auth/user-not-found") {
            throw error;
          }

          authUser = await admin.auth().createUser({
            email: account.email,
            password: account.password,
            displayName: account.displayName,
            emailVerified: true,
            disabled: false
          });
          created = true;
        }

        if (!created) {
          await admin.auth().updateUser(authUser.uid, {
            displayName: account.displayName,
            emailVerified: true,
            disabled: false
          });
        }

        const profileData = getSuperAdminProfileData(authUser.uid, account);

        if (created) {
          profileData.createdAt = admin.firestore.FieldValue.serverTimestamp();
        }

        await admin
          .firestore()
          .collection("users")
          .doc(authUser.uid)
          .set(profileData, { merge: true });

        results.push({
          email: account.email,
          uid: authUser.uid,
          status: created ? "created" : "updated"
        });
      }

      return res.status(200).json({ success: true, results });
    } catch (error) {
      console.error("Super Admin seed error:", error);
      return res.status(500).json({
        error: error.message || "Super Admin seed failed"
      });
    }
  }
);

exports.seedInternalPaymentTester = onRequest(
  {
    region: "europe-west1",
    secrets: [internalPaymentTesterSeedToken, internalPaymentTesterAccountJson],
    maxInstances: 1
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        return res.status(405).json({ error: "Method not allowed" });
      }

      const providedToken = req.get("x-seed-token") || "";

      if (
        !providedToken ||
        providedToken !== internalPaymentTesterSeedToken.value()
      ) {
        return res.status(403).json({ error: "Invalid seed token" });
      }

      const account = JSON.parse(internalPaymentTesterAccountJson.value());

      if (
        !account ||
        Array.isArray(account) ||
        !account.email ||
        !account.password ||
        !account.displayName
      ) {
        return res.status(400).json({
          error:
            "INTERNAL_PAYMENT_TESTER_ACCOUNT_JSON must be a JSON object with email, password and displayName"
        });
      }

      let authUser;
      let created = false;

      try {
        authUser = await admin.auth().getUserByEmail(account.email);
      } catch (error) {
        if (error.code !== "auth/user-not-found") {
          throw error;
        }

        authUser = await admin.auth().createUser({
          email: account.email,
          password: account.password,
          displayName: account.displayName,
          emailVerified: true,
          disabled: false
        });
        created = true;
      }

      if (!created) {
        await admin.auth().updateUser(authUser.uid, {
          password: account.password,
          displayName: account.displayName,
          emailVerified: true,
          disabled: false
        });
      }

      await admin.auth().setCustomUserClaims(authUser.uid, {
        role: "member",
        internalAccount: true
      });

      const userRef = admin.firestore().collection("users").doc(authUser.uid);
      const existingSnap = await userRef.get();
      const profileData = getInternalPaymentTesterProfileData(
        authUser.uid,
        account,
        existingSnap.exists ? existingSnap.data() : null
      );

      if (created || !existingSnap.exists) {
        profileData.createdAt = admin.firestore.FieldValue.serverTimestamp();
      }

      await userRef.set(profileData, { merge: true });

      return res.status(200).json({
        success: true,
        result: {
          email: account.email,
          uid: authUser.uid,
          status: created ? "created" : "updated"
        }
      });
    } catch (error) {
      console.error("Internal Payment Tester seed error:", error);
      return res.status(500).json({
        error: error.message || "Internal Payment Tester seed failed"
      });
    }
  }
);

exports.stripeWebhook = onRequest(
  {
    region: "europe-west1",
    secrets: [stripeSecret, stripeWebhookSecret],
    maxInstances: 10
  },
  async (req, res) => {
    const stripe = Stripe(stripeSecret.value());

    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.rawBody,
        req.headers["stripe-signature"],
        stripeWebhookSecret.value()
      );
    } catch (error) {
      console.error("Webhook signature verification failed:", error.message);
      return res.status(400).send(`Webhook Error: ${error.message}`);
    }

    try {
      if (event.type === "checkout.session.completed") {
        const session = event.data.object;

        const uid = session.metadata?.uid;
        const email = session.metadata?.email;
        const billingType = session.metadata?.billingType;
        let priceId = session.metadata?.priceId || "";

        if (billingType === "featured") {
          if (!uid) {
            console.error("No uid found in featured checkout session metadata");
            return res.status(200).send("Featured ignored: no uid metadata");
          }

          const userRef = admin.firestore().collection("users").doc(uid);
          const userSnap = await userRef.get();

          if (!userSnap.exists || !isActiveMember(userSnap.data())) {
            console.error(
              `Featured payment completed but user ${uid} is not an active member`
            );
            return res.status(200).send("Featured ignored: inactive member");
          }

          const userData = userSnap.data();
          const featuredExpiresAt = getFeaturedExpiryDate(
            userData.featuredExpiresAt
          );

          await userRef.set(
            {
              featuredListing: true,
              featuredListingStatus: "active",
              featuredExpiresAt,
              featuredStripePriceId: priceId,
              featuredStripeSessionId: session.id || "",
              featuredStripeCustomerId: session.customer || "",
              featuredUpdatedAt:
                admin.firestore.FieldValue.serverTimestamp(),
              email: email || session.customer_details?.email || ""
            },
            { merge: true }
          );

          console.log(`Featured Listing activated for user ${uid}`);
          return res.status(200).send("Featured Listing activated");
        }

        if (billingType === "project_workspace_unlock") {
          if (!uid) {
            console.error("No uid found in workspace checkout session metadata");
            return res.status(200).send("Workspace ignored: no uid metadata");
          }

          const projectId = session.metadata?.projectId;

          if (!projectId) {
            console.error("No projectId found in workspace checkout metadata");
            return res.status(200).send("No projectId metadata");
          }

          const projectRef = admin.firestore().collection("projects").doc(projectId);
          const projectSnap = await projectRef.get();

          if (!projectSnap.exists) {
            console.error(`Workspace payment completed but project ${projectId} was not found`);
            return res.status(200).send("Workspace ignored: project missing");
          }

          const project = projectSnap.data();

          if (project.ownerId !== uid) {
            console.error(`Workspace payment completed by non-owner ${uid} for project ${projectId}`);
            return res.status(200).send("Workspace ignored: owner mismatch");
          }

          await projectRef.set(
            {
              workspaceUnlocked: true,
              workspacePaymentStatus: "paid",
              workspacePaidAt: admin.firestore.FieldValue.serverTimestamp(),
              workspacePaidBy: uid,
              workspaceUnlockAmount: 40,
              workspaceStripePriceId: priceId,
              workspaceStripeSessionId: session.id || "",
              workspaceStripeCustomerId: session.customer || "",
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );

          console.log(`Workspace unlocked for project ${projectId}`);
          return res.status(200).send("Workspace unlocked");
        }

        if (billingType === "trades_job_access") {
          if (!uid) {
            console.error("No uid found in trades job checkout session metadata");
            return res.status(200).send("Trades job access ignored: no uid metadata");
          }

          const userRef = admin.firestore().collection("users").doc(uid);

          await userRef.set(
            {
              tradesJobAccess: true,
              tradesJobAccessStatus: "active",
              tradesJobAccessPaidAt:
                admin.firestore.FieldValue.serverTimestamp(),
              tradesJobAccessExpiresAt: getTradesJobAccessExpiryDate(),
              tradesJobAccessAmount: 14.99,
              tradesJobAccessStripePriceId: priceId,
              tradesJobAccessStripeSessionId: session.id || "",
              tradesJobAccessStripeCustomerId: session.customer || "",
              tradesJobAccessUpdatedAt:
                admin.firestore.FieldValue.serverTimestamp(),
              email: email || session.customer_details?.email || ""
            },
            { merge: true }
          );

          console.log(`Trades job access activated for user ${uid}`);
          return res.status(200).send("Trades job access activated");
        }

        let expiresAt = null;
        let stripeSubscriptionId = "";
        let stripeCustomerId = session.customer || "";
        let subscriptionStatus = "active";
        let subscriptionCancelAtPeriodEnd = false;

        if (billingType === "subscription") {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription
          );

          priceId = subscription.items.data[0]?.price?.id || priceId;
          stripeSubscriptionId = session.subscription || "";
          stripeCustomerId = session.customer || "";
          subscriptionStatus = getSubscriptionFirestoreStatus(subscription);
          subscriptionCancelAtPeriodEnd =
            subscription.cancel_at_period_end === true;

          expiresAt = getSubscriptionExpiryTimestamp(subscription);
        }

        if (billingType === "oneoff") {
          expiresAt = getPassExpiryDate(priceId);
          stripeSubscriptionId = "";
          stripeCustomerId = session.customer || "";
        }

        const plan = getPlanFromPriceId(priceId);

        if (!uid) {
          console.log(
            `Paid membership checkout ${session.id} completed before signup`
          );
          return res.status(200).send("Membership checkout awaiting signup");
        }

        const userRef = admin.firestore().collection("users").doc(uid);
        const existingUserSnap = await userRef.get();
        const existingUserData = existingUserSnap.exists
          ? existingUserSnap.data()
          : null;

        await userRef.set(
          {
            role: getRoleAfterMembershipActivation(existingUserData),
            hasSubscription: true,
            subscriptionStatus,
            membershipStatus: "active",
            accountType: "member",
            subscriptionPlan: plan,
            subscriptionBillingType: billingType,
            subscriptionExpiresAt: expiresAt,
            subscriptionCancelAtPeriodEnd,
            subscriptionCancelledAt: null,
            stripeCustomerId,
            stripeSubscriptionId,
            stripePriceId: priceId,
            subscriptionUpdatedAt:
              admin.firestore.FieldValue.serverTimestamp(),
            email: email || session.customer_details?.email || ""
          },
          { merge: true }
        );

        console.log(
          `Membership activated for user ${uid} using ${billingType}`
        );
      }

      if (event.type === "customer.subscription.updated") {
        const subscription = event.data.object;

        await updateUserFromStripeSubscription(subscription);
      }

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;

        const userDoc = await findUserByStripeSubscriptionId(subscription.id);

        if (!userDoc) {
          console.log(
            `No matching user found for deleted subscription ${subscription.id}`
          );
        } else {
          if (isSuperAdmin(userDoc.data())) {
            console.log(`Skipping subscription deletion for Super Admin ${userDoc.id}`);
            return res.status(200).send("Super Admin subscription deletion skipped");
          }

          const endedAt = subscription.ended_at
            ? admin.firestore.Timestamp.fromMillis(subscription.ended_at * 1000)
            : admin.firestore.FieldValue.serverTimestamp();

          await userDoc.ref.set(
            {
              hasSubscription: false,
              subscriptionStatus: "inactive",
              subscriptionCancelAtPeriodEnd: false,
              subscriptionEndedAt: endedAt,
              subscriptionUpdatedAt:
                admin.firestore.FieldValue.serverTimestamp(),
              stripeSubscriptionId: "",
              stripePriceId: ""
            },
            { merge: true }
          );

          console.log(`Subscription deleted for user ${userDoc.id}`);
        }
      }

      if (event.type === "invoice.payment_failed") {
        const invoice = event.data.object;
        const subscriptionId =
          typeof invoice.subscription === "string"
            ? invoice.subscription
            : invoice.subscription?.id || "";

        if (!subscriptionId) {
          console.log("Payment failed invoice has no subscription ID");
        } else {
          const userDoc = await findUserByStripeSubscriptionId(subscriptionId);

          if (!userDoc) {
            console.log(
              `No matching user found for failed payment subscription ${subscriptionId}`
            );
          } else {
            await userDoc.ref.set(
              {
                hasSubscription: true,
                subscriptionStatus: "past_due",
                subscriptionPaymentFailedAt:
                  admin.firestore.FieldValue.serverTimestamp(),
                subscriptionUpdatedAt:
                  admin.firestore.FieldValue.serverTimestamp()
              },
              { merge: true }
            );

            console.log(`Payment failed marked for user ${userDoc.id}`);
          }
        }
      }

      return res.status(200).send("Webhook received");
    } catch (error) {
      console.error("Webhook processing error:", error);
      return res.status(500).send("Webhook processing failed");
    }
  }
);
