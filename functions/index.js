const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const Stripe = require("stripe");

const admin = require("firebase-admin");

admin.initializeApp();

const stripeSecret = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

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

const ALL_PRICE_IDS = [
  YEARLY_SUBSCRIPTION_PRICE_ID,
  MONTHLY_SUBSCRIPTION_PRICE_ID,
  YEARLY_PASS_PRICE_ID,
  MONTHLY_PASS_PRICE_ID,
  FEATURED_LISTING_PRICE_ID
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

  if (userData.hasSubscription !== true) return false;

  if (
    userData.subscriptionStatus !== "active" &&
    userData.subscriptionStatus !== "trialing" &&
    userData.subscriptionStatus !== "cancelling"
  ) {
    return false;
  }

  if (userData.subscriptionExpiresAt && userData.subscriptionExpiresAt.toDate) {
    return userData.subscriptionExpiresAt.toDate() > new Date();
  }

  return true;
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

  const priceId = subscription.items?.data?.[0]?.price?.id || "";
  const status = getSubscriptionFirestoreStatus(subscription);
  const expiresAt = getSubscriptionExpiryTimestamp(subscription);

  const hasSubscription =
    status === "active" ||
    status === "trialing" ||
    status === "cancelling" ||
    status === "past_due";

  await userDoc.ref.set(
    {
      hasSubscription,
      subscriptionStatus: status,
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
    res.set("Access-Control-Allow-Headers", "Content-Type");

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

      if (!priceId || !billingType || !uid || !email) {
        return res.status(400).json({
          error: "Missing priceId, billingType, uid or email"
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

      const session = await stripe.checkout.sessions.create({
        mode: billingType === "subscription" ? "subscription" : "payment",
        customer_email: email,
        line_items: [
          {
            price: priceId,
            quantity: 1
          }
        ],
        success_url: "https://sangatworks.co.uk/success.html",
        cancel_url: "https://sangatworks.co.uk/cancel.html",
        metadata: {
          uid,
          email,
          priceId,
          billingType
        },
        payment_intent_data:
          billingType === "oneoff" || billingType === "featured"
            ? {
                metadata: {
                  uid,
                  email,
                  priceId,
                  billingType
                }
              }
            : undefined,
        subscription_data:
          billingType === "subscription"
            ? {
                metadata: {
                  uid,
                  email,
                  priceId,
                  billingType
                }
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
    res.set("Access-Control-Allow-Headers", "Content-Type");

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

        if (!uid) {
          console.error("No uid found in checkout session metadata");
          return res.status(200).send("No uid metadata");
        }

        if (billingType === "featured") {
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

        await admin.firestore().collection("users").doc(uid).set(
          {
            hasSubscription: true,
            subscriptionStatus,
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