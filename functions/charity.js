// Free charity year accounts and invites (admin granted).
const {
  admin,
  crypto,
  findUserDocByEmail,
  getAuthorizedAdmin,
  getDateFromFirestoreValue,
  getFreeAccessExpiryTimestamp,
  getFreeCharityGrantData,
  getInviteExpiryTimestamp,
  isValidEmail,
  isValidTemporaryPassword,
  normalizeEmail,
  onRequest
} = require("./shared");

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
