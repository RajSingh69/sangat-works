import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  deleteUser,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  serverTimestamp,
  setDoc,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const VERIFY_SIGNUP_SESSION_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/verifyPaidSignupSession";

const paidSignupForm = document.getElementById("paidSignupForm");
const signupStatus = document.getElementById("signupStatus");
const signupMessage = document.getElementById("signupMessage");
const signupEmail = document.getElementById("signupEmail");

const sessionId = new URLSearchParams(window.location.search).get("session_id");

let verifiedSignup = null;

function setMessage(message, isError = false) {
  if (!signupMessage) return;
  signupMessage.textContent = message || "";
  signupMessage.style.color = isError ? "#b42318" : "";
}

function redirectToPricing() {
  window.location.href = "pricing.html";
}

async function verifySessionForDisplay() {
  if (!sessionId) {
    redirectToPricing();
    return;
  }

  try {
    const response = await fetch(VERIFY_SIGNUP_SESSION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ sessionId })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.verified !== true || !result.signup) {
      throw new Error(result.error || "Payment could not be verified.");
    }

    verifiedSignup = result.signup;

    if (signupStatus) {
      signupStatus.textContent =
        `Payment verified for ${verifiedSignup.planName} membership. Create your account to unlock Sangat Works.`;
    }

    if (signupEmail && verifiedSignup.email) {
      signupEmail.value = verifiedSignup.email;
    }

    paidSignupForm?.classList.remove("hidden");
  } catch (error) {
    setMessage(
      "Your signup link is invalid, expired, unpaid, or already used. Please complete payment to continue.",
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

  const response = await fetch(VERIFY_SIGNUP_SESSION_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${idToken}`
    },
    body: JSON.stringify({
      sessionId,
      claimForUid: uid
    })
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || result.verified !== true || result.claimed !== true) {
    throw new Error(result.error || "Could not claim this paid signup session.");
  }

  return result.signup;
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

  let createdUser = null;

  try {
    paidSignupForm.classList.add("hidden");
    setMessage("Creating your paid account...");

    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    createdUser = userCredential.user;

    await updateProfile(createdUser, {
      displayName: fullName
    });

    const claimedSignup = await claimVerifiedSession(createdUser.uid);
    const subscriptionExpiresAt = getSubscriptionExpiry(claimedSignup);

    await setDoc(doc(db, "users", createdUser.uid), {
      uid: createdUser.uid,
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
      subscriptionExpiresAt,
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
    });

    setMessage("Account created. Opening your profile...");
    window.location.href = "profile.html";
  } catch (error) {
    if (createdUser) {
      try {
        await deleteUser(createdUser);
      } catch (deleteError) {
        console.error("Could not delete unclaimed signup user:", deleteError);
      }
    }

    paidSignupForm.classList.remove("hidden");
    setMessage(error.message || "Could not create your account.", true);
  }
});

verifySessionForDisplay();
