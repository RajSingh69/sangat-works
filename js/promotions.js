/*
  Starts a Stripe checkout for a paid extra (functions/promotions.js):
  "featured_opportunity" (needs opportunityId) or "business_verification".
  Redirects to Stripe on success; throws with a readable message otherwise.
*/

import { auth } from "./firebase.js";

const PROMOTION_CHECKOUT_URL = "https://europe-west1-sangat-works.cloudfunctions.net/createPromotionCheckout";

export async function startPromotionCheckout(product, details = {}) {
  const user = auth.currentUser;
  if (!user) throw new Error("Please log in again.");

  const response = await fetch(PROMOTION_CHECKOUT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await user.getIdToken()}`
    },
    body: JSON.stringify({ uid: user.uid, product, ...details })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.url) throw new Error(data.error || "Checkout isn't available right now.");
  window.location.href = data.url;
}
