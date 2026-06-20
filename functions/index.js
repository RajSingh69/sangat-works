const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const cors = require("cors")({
  origin: ["https://sangatworks.co.uk"]
});
const Stripe = require("stripe");

const stripeSecret = defineSecret("STRIPE_SECRET_KEY");

const YEARLY_PRICE_ID = "price_1TkRE3DUGpJNp57jibUQGKDf";
const MONTHLY_PRICE_ID = "price_1TkREoDUGpJNp57jw98RTUIU";

exports.createCheckoutSession = onRequest(
  {
    region: "europe-west1",
    secrets: [stripeSecret],
    maxInstances: 10
  },
  (req, res) => {
    cors(req, res, async () => {
      try {
        if (req.method !== "POST") {
          return res.status(405).json({ error: "Method not allowed" });
        }

        const { priceId, uid, email } = req.body;

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
    });
  }
);