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

const ALL_PRICE_IDS = [
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
          billingType === "oneoff"
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

        let expiresAt = null;
        let stripeSubscriptionId = "";
        let stripeCustomerId = session.customer || "";
        let subscriptionStatus = "active";

        if (billingType === "subscription") {
          const subscription = await stripe.subscriptions.retrieve(
            session.subscription
          );

          priceId = subscription.items.data[0]?.price?.id || priceId;
          stripeSubscriptionId = session.subscription || "";
          stripeCustomerId = session.customer || "";

          expiresAt = subscription.current_period_end
            ? admin.firestore.Timestamp.fromMillis(
                subscription.current_period_end * 1000
              )
            : null;
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
            stripeCustomerId,
            stripeSubscriptionId,
            stripePriceId: priceId,
            subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            email: email || session.customer_details?.email || ""
          },
          { merge: true }
        );

        console.log(
          `Membership activated for user ${uid} using ${billingType}`
        );
      }

      if (event.type === "customer.subscription.deleted") {
        const subscription = event.data.object;

        const snapshot = await admin
          .firestore()
          .collection("users")
          .where("stripeSubscriptionId", "==", subscription.id)
          .limit(1)
          .get();

        if (!snapshot.empty) {
          const userDoc = snapshot.docs[0];

          await userDoc.ref.set(
            {
              hasSubscription: false,
              subscriptionStatus: "inactive",
              subscriptionUpdatedAt:
                admin.firestore.FieldValue.serverTimestamp()
            },
            { merge: true }
          );

          console.log(`Subscription cancelled for user ${userDoc.id}`);
        } else {
          console.log(
            `No matching user found for cancelled subscription ${subscription.id}`
          );
        }
      }

      return res.status(200).send("Webhook received");
    } catch (error) {
      console.error("Webhook processing error:", error);
      return res.status(500).send("Webhook processing failed");
    }
  }
);