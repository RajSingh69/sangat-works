// Stripe payments: membership signup, checkout, cancellation, paid unlocks and the webhook.
const {
  ALL_PRICE_IDS,
  PROJECT_WORKSPACE_UNLOCK_PRICE_ID,
  Stripe,
  TRADES_JOB_ACCESS_PRICE_ID,
  admin,
  findUserByStripeSubscriptionId,
  getBillingTypeFromPriceId,
  getFeaturedExpiryDate,
  getInternalPaymentTesterProfileData,
  getPassExpiryDate,
  getPlanFromPriceId,
  getRoleAfterMembershipActivation,
  getSafeSignupSessionData,
  getSubscriptionExpiryTimestamp,
  getSubscriptionFirestoreStatus,
  getSuperAdminProfileData,
  getTradesJobAccessExpiryDate,
  internalPaymentTesterAccountJson,
  internalPaymentTesterSeedToken,
  isActiveMember,
  isSuperAdmin,
  onRequest,
  stripeSecret,
  stripeWebhookSecret,
  superAdminAccountsJson,
  superAdminSeedToken,
  updateUserFromStripeSubscription,
  verifyRequestUser,
  verifyStripeSignupSession
} = require("./shared");
const { handlePromotionPayment } = require("./promotions");
const { handleEmployerJobPayment } = require("./employer-jobs");

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
            // The same member retrying after a dropped connection is fine.
            if (usedSnap.data().uid === claimForUid) return;
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

      // Already linked to an account: still show the form, so the member who
      // paid can finish setting up by signing in with the same details (the
      // claim above only succeeds for that same account).
      return res.status(200).json({
        verified: true,
        claimed: false,
        alreadyClaimed: usedSnap.exists,
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
        // Featured Listing buyers are already members, so send them back to their
        // profile rather than the new-member "finish creating your account" page.
        success_url: billingType === "featured"
          ? "https://sangatworks.co.uk/profile.html?featured=paid"
          : "https://sangatworks.co.uk/success.html?session_id={CHECKOUT_SESSION_ID}",
        cancel_url: billingType === "featured"
          ? "https://sangatworks.co.uk/profile.html"
          : "https://sangatworks.co.uk/cancel.html",
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

      if (!(await verifyRequestUser(req, uid))) {
        return res.status(403).json({ error: "Invalid user token" });
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

const disabledSeedSuperAdmins = onRequest(
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

const disabledSeedInternalPaymentTester = onRequest(
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

        // Featured opportunities and business verification (functions/promotions.js).
        if (await handlePromotionPayment(session)) {
          return res.status(200).send("Promotion payment handled");
        }
        if (await handleEmployerJobPayment(session)) {
          return res.status(200).send("Employer job payment handled");
        }

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
