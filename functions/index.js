const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const Stripe = require("stripe");

const admin = require("firebase-admin");

admin.initializeApp();

const stripeSecret = defineSecret("STRIPE_SECRET_KEY");
const stripeWebhookSecret = defineSecret("STRIPE_WEBHOOK_SECRET");

const YEARLY_PRICE_ID = "price_1Tkm1gDbE6tXsxNU9veTZwPE";
const MONTHLY_PRICE_ID = "price_1Tkm19DbE6tXsxNUxU6b7NUI";

function getPlanFromPriceId(priceId) {
  if (priceId === YEARLY_PRICE_ID) {
    return "yearly";
  }

  if (priceId === MONTHLY_PRICE_ID) {
    return "monthly";
  }

  return "unknown";
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

      const { priceId, uid, email } = body;

      if (!priceId || !uid || !email) {
        return res.status(400).json({
          error: "Missing priceId, uid or email"
        });
      }

      if (![YEARLY_PRICE_ID, MONTHLY_PRICE_ID].includes(priceId)) {
        return res.status(400).json({
          error: "Invalid price ID"
        });
      }

      const stripe = Stripe(stripeSecret.value());

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
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
          email
        }
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

        if (!uid) {
          console.error("No uid found in checkout session metadata");
          return res.status(200).send("No uid metadata");
        }

        const subscription = await stripe.subscriptions.retrieve(
          session.subscription
        );

        const priceId = subscription.items.data[0]?.price?.id || "";
        const plan = getPlanFromPriceId(priceId);

        const expiresAt = subscription.current_period_end
          ? admin.firestore.Timestamp.fromMillis(
              subscription.current_period_end * 1000
            )
          : null;

        await admin.firestore().collection("users").doc(uid).set(
          {
            hasSubscription: true,
            subscriptionStatus: "active",
            subscriptionPlan: plan,
            subscriptionExpiresAt: expiresAt,
            stripeCustomerId: session.customer || "",
            stripeSubscriptionId: session.subscription || "",
            stripePriceId: priceId,
            subscriptionUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
            email: email || session.customer_details?.email || ""
          },
          { merge: true }
        );

        console.log(`Subscription activated for user ${uid}`);
      }

      return res.status(200).send("Webhook received");
    } catch (error) {
      console.error("Webhook processing error:", error);
      return res.status(500).send("Webhook processing failed");
    }
  }
);