/*
  Cloud Functions entry point. Each file below exports its deployed functions;
  shared.js holds the Firebase Admin setup, secrets, Stripe price IDs and helpers.
*/
Object.assign(
  exports,
  require("./payments"),
  require("./charity"),
  require("./networking"),
  require("./profile-sync"),
  require("./site-stats"),
  // Only the HTTP function; the webhook helper in promotions.js isn't a deployable function.
  { createPromotionCheckout: require("./promotions").createPromotionCheckout },
  { createEmployerJobCheckout: require("./employer-jobs").createEmployerJobCheckout }
);
