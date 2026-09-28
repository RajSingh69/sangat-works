import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  deleteUser,
  signInWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  serverTimestamp,
  setDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import { friendlyAuthError } from "./auth-errors.js";

const VERIFY_SIGNUP_SESSION_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/verifyPaidSignupSession";
const VERIFY_FREE_INVITE_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/verifyFreeCharityInvite";

const paidSignupForm = document.getElementById("paidSignupForm");
const signupStatus = document.getElementById("signupStatus");
const signupMessage = document.getElementById("signupMessage");
const signupEmail = document.getElementById("signupEmail");

const params = new URLSearchParams(window.location.search);
const sessionId = params.get("session_id");
const inviteToken = params.get("invite_token");

let verifiedSignup = null;
let signupMode = "";

function setMessage(message, isError = false) {
  if (!signupMessage) return;
  signupMessage.textContent = message || "";
  signupMessage.style.color = isError ? "#b42318" : "";
}

function redirectToPricing() {
  window.location.href = "pricing.html";
}

async function verifySessionForDisplay() {
  if (!sessionId && !inviteToken) {
    redirectToPricing();
    return;
  }

  try {
    const response = await fetch(
      inviteToken ? VERIFY_FREE_INVITE_URL : VERIFY_SIGNUP_SESSION_URL,
      {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(
        inviteToken
          ? { inviteToken }
          : { sessionId }
      )
    });

    const result = await response.json().catch(() => ({}));
    const verifiedPayload = inviteToken ? result.invite : result.signup;

    if (!response.ok || result.verified !== true || !verifiedPayload) {
      throw new Error(
        result.error ||
        (inviteToken ? "Invite could not be verified." : "Payment could not be verified.")
      );
    }

    verifiedSignup = verifiedPayload;
    signupMode = inviteToken ? "free_charity_invite" : "paid_stripe";

    if (signupStatus) {
      signupStatus.textContent = inviteToken
        ? `Free Charity Year invite verified for ${verifiedSignup.charityName}. Create your account to unlock Sangat Works for 1 year.`
        : result.alreadyClaimed
          ? "Your payment is safe and already linked to an account. Enter the same name, email and password to finish setting up."
          : `Payment verified for ${verifiedSignup.planName} membership. Create your account to unlock Sangat Works.`;
    }

    if (signupEmail && verifiedSignup.email) {
      signupEmail.value = verifiedSignup.email;
      signupEmail.readOnly = true;
    }

    paidSignupForm?.classList.remove("hidden");
  } catch (error) {
    setMessage(
      inviteToken
        ? "Your charity invite is invalid, expired, or already used. Please contact Sangat Works."
        : "Your signup link is invalid, expired, unpaid, or already used. Please complete payment to continue.",
      true
    );

    setTimeout(redirectToPricing, 1800);
  }
}

function getSubscriptionExpiry(verified) {
  const expiryDate = new Date();

  if (verified.priceId === "price_1Tl8zyDbE6tXsxNUpynPPWft") {
    expiryDate.setDate(expiryDate.getDate() + 30);
    return Timestamp.fromDate(expiryDate);
  }

  if (verified.priceId === "price_1Tl90wDbE6tXsxNUPMzfGO5m") {
    expiryDate.setDate(expiryDate.getDate() + 365);
    return Timestamp.fromDate(expiryDate);
  }

  return null;
}

async function claimVerifiedSession(uid) {
  const idToken = await auth.currentUser.getIdToken();
  const isInvite = signupMode === "free_charity_invite";

  let response;
  try {
    response = await fetch(isInvite ? VERIFY_FREE_INVITE_URL : VERIFY_SIGNUP_SESSION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify(
      isInvite
        ? {
            inviteToken,
            claimForUid: uid
          }
        : {
            sessionId,
            claimForUid: uid
          }
    )
    });
  } catch (networkError) {
    // The server may still have linked the payment, so the account must be kept.
    throw Object.assign(new Error("No connection. Check your internet and tap the button again."), { keepAccount: true });
  }

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.verified !== true || result.claimed !== true) {
    throw new Error(
      result.error ||
      (isInvite
        ? "Could not claim this charity invite."
        : "Could not claim this paid signup session.")
    );
  }

  return isInvite ? result.invite : result.signup;
}

paidSignupForm?.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (!verifiedSignup) {
    setMessage("Payment verification is required before signup.", true);
    return;
  }

  const fullName = document.getElementById("signupName").value.trim();
  const email = signupEmail.value.trim();
  const password = document.getElementById("signupPassword").value;
  const submitButton = paidSignupForm.querySelector("button[type=submit]");

  let user = null;
  let createdNow = false;
  let claimed = false;

  if (submitButton) submitButton.disabled = true;
  setMessage(
    signupMode === "free_charity_invite"
      ? "Creating your Free Charity Year account..."
      : "Creating your account..."
  );

  try {
    // A second attempt (after a dropped connection) signs back in to the
    // account made the first time instead of failing on "email already in use".
    try {
      user = (await createUserWithEmailAndPassword(auth, email, password)).user;
      createdNow = true;
    } catch (error) {
      if (error.code !== "auth/email-already-in-use") throw error;
      try {
        user = (await signInWithEmailAndPassword(auth, email, password)).user;
      } catch (signInError) {
        throw new Error("That email already has an account with a different password. Log in instead, or contact us if you've just paid.");
      }
    }

    await updateProfile(user, { displayName: fullName }).catch(() => {});

    const claimedSignup = await claimVerifiedSession(user.uid);
    claimed = true;

    const profileData = signupMode === "free_charity_invite"
      ? {
          uid: user.uid,
          fullName,
          displayName: fullName,
          email,
          featuredListing: false,
          featuredListingStatus: "inactive",
          featuredExpiresAt: null,
          hasSeenIntro: false,
          isPublic: true,
          updatedAt: serverTimestamp()
        }
      : {
          uid: user.uid,
          fullName,
          displayName: fullName,
          email,
          role: "standard",
          internalAccount: false,
          accountType: "member",
          isAdmin: false,
          isFoundingMember: false,
          memberNumber: null,
          hasSubscription: true,
          subscriptionStatus: "active",
          subscriptionPlan: claimedSignup.planName,
          subscriptionBillingType: claimedSignup.billingType,
          subscriptionExpiresAt: getSubscriptionExpiry(claimedSignup),
          subscriptionUpdatedAt: serverTimestamp(),
          membershipPlan: claimedSignup.planName,
          membershipStatus: "active",
          stripeCustomerId: claimedSignup.stripeCustomerId,
          stripeSubscriptionId: claimedSignup.stripeSubscriptionId || "",
          stripePriceId: claimedSignup.priceId,
          stripeCheckoutSessionId: claimedSignup.checkoutSessionId,
          featuredListing: false,
          featuredListingStatus: "inactive",
          featuredExpiresAt: null,
          hasSeenIntro: false,
          isPublic: true,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        };

    // Saving the membership can fail on patchy wifi; try a few times.
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await setDoc(doc(db, "users", user.uid), profileData, { merge: signupMode === "free_charity_invite" });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
    if (lastError) throw lastError;

    setMessage("Account created. Opening your profile...");
    window.location.href = "profile.html";
  } catch (error) {
    console.error("Signup failed:", error);

    // Only remove an account made on this attempt, and never once the payment
    // is linked to it: otherwise the member has paid and can't get back in.
    if (user && createdNow && !claimed && !error.keepAccount) {
      await deleteUser(user).catch((deleteError) => console.error("Could not delete unclaimed signup user:", deleteError));
    }

    const message = claimed || error.keepAccount
      ? "Your payment is safe. We couldn't finish setting up your account, so tap the button again. If it keeps failing, contact us."
      : error.code
        ? friendlyAuthError(error, "Could not create your account. Please try again.")
        : error.message || "Could not create your account. Please try again.";
    setMessage(message, true);
    if (submitButton) submitButton.disabled = false;
  }
});

verifySessionForDisplay();
