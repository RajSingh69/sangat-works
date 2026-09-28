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
  require("./site-stats")
);
