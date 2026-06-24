import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const membershipStatusBox = document.getElementById("membershipStatusBox");
const membershipStatusText = document.getElementById("membershipStatusText");
const membershipPlanText = document.getElementById("membershipPlanText");
const membershipBillingText = document.getElementById("membershipBillingText");
const membershipExpiryText = document.getElementById("membershipExpiryText");
const featuredStatusText = document.getElementById("featuredStatusText");
const featuredExpiryText = document.getElementById("featuredExpiryText");
const cancelSubscriptionBtn = document.getElementById("cancelSubscriptionBtn");
const cancelSubscriptionMessage = document.getElementById("cancelSubscriptionMessage");

const CANCEL_SUBSCRIPTION_FUNCTION_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/cancelSubscription";

let currentUser = null;
let currentUserData = null;

function formatDate(value) {
  if (!value) return "Not set";

  if (value.toDate) {
    return value.toDate().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  }

  return "Not set";
}

function pretty(value) {
  if (!value) return "Not set";

  return String(value)
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function hideCancelButton() {
  if (cancelSubscriptionBtn) {
    cancelSubscriptionBtn.style.display = "none";
  }
}

function showCancelButton() {
  if (cancelSubscriptionBtn) {
    cancelSubscriptionBtn.style.display = "block";
  }
}

function setCancelMessage(message, isError = false) {
  if (!cancelSubscriptionMessage) return;

  cancelSubscriptionMessage.textContent = message || "";
  cancelSubscriptionMessage.style.color = isError ? "#ff6b6b" : "";
}

function setCancelButtonLoading(isLoading) {
  if (!cancelSubscriptionBtn) return;

  cancelSubscriptionBtn.disabled = isLoading;
  cancelSubscriptionBtn.textContent = isLoading
    ? "Cancelling..."
    : "Cancel Subscription";
}

async function cancelCurrentSubscription() {
  if (!currentUser) {
    setCancelMessage("Please log in before cancelling your subscription.", true);
    return;
  }

  if (!currentUserData) {
    setCancelMessage("Membership details could not be loaded.", true);
    return;
  }

  const canCancel =
    currentUserData.hasSubscription === true &&
    currentUserData.subscriptionBillingType === "subscription" &&
    currentUserData.stripeSubscriptionId &&
    currentUserData.subscriptionCancelAtPeriodEnd !== true &&
    currentUserData.subscriptionStatus !== "cancelling";

  if (!canCancel) {
    setCancelMessage("This subscription cannot be cancelled from here.", true);
    return;
  }

  const confirmed = window.confirm(
    "Cancel your rolling subscription? You will keep access until your current access end date."
  );

  if (!confirmed) return;

  try {
    setCancelButtonLoading(true);
    setCancelMessage("Cancelling your subscription...");

    const response = await fetch(CANCEL_SUBSCRIPTION_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        uid: currentUser.uid
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(result.error || "Cancellation failed");
    }

    setCancelMessage(
      "Subscription cancellation started. You will keep access until your current access end date."
    );

    hideCancelButton();

    setTimeout(() => {
      window.location.reload();
    }, 1500);
  } catch (error) {
    console.error("Cancel subscription failed:", error);
    setCancelMessage(
      error.message || "Could not cancel subscription. Please try again.",
      true
    );
    setCancelButtonLoading(false);
  }
}

if (cancelSubscriptionBtn) {
  cancelSubscriptionBtn.addEventListener("click", cancelCurrentSubscription);
}

onAuthStateChanged(auth, async (user) => {
  if (!membershipStatusBox) return;

  currentUser = user;
  currentUserData = null;

  hideCancelButton();
  setCancelButtonLoading(false);
  setCancelMessage("");

  if (!user) {
    membershipStatusBox.style.display = "block";
    membershipStatusText.textContent = "Please log in to view your membership details.";
    membershipPlanText.textContent = "-";
    membershipBillingText.textContent = "-";
    membershipExpiryText.textContent = "-";
    featuredStatusText.textContent = "-";
    featuredExpiryText.textContent = "-";
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      membershipStatusBox.style.display = "block";
      membershipStatusText.textContent = "No membership profile found yet.";
      membershipPlanText.textContent = "-";
      membershipBillingText.textContent = "-";
      membershipExpiryText.textContent = "-";
      featuredStatusText.textContent = "-";
      featuredExpiryText.textContent = "-";
      return;
    }

    const data = userSnap.data();
    currentUserData = data;

    membershipStatusBox.style.display = "block";

    const isCancelling =
      data.subscriptionCancelAtPeriodEnd === true ||
      data.subscriptionStatus === "cancelling";

    membershipStatusText.textContent = isCancelling
      ? "Cancelling"
      : pretty(data.subscriptionStatus || "inactive");

    membershipPlanText.textContent = pretty(data.subscriptionPlan);
    membershipBillingText.textContent = pretty(data.subscriptionBillingType);
    membershipExpiryText.textContent = formatDate(data.subscriptionExpiresAt);

    featuredStatusText.textContent = data.featuredListing === true
      ? pretty(data.featuredListingStatus || "active")
      : "Not active";

    featuredExpiryText.textContent = data.featuredListing === true
      ? formatDate(data.featuredExpiresAt)
      : "Not active";

    const canCancel =
      data.hasSubscription === true &&
      data.subscriptionBillingType === "subscription" &&
      data.stripeSubscriptionId &&
      !isCancelling;

    if (canCancel) {
      showCancelButton();
    } else {
      hideCancelButton();
    }

    if (isCancelling) {
      setCancelMessage(
        "Your subscription is cancelling. You will keep access until your current access end date."
      );
    }
  } catch (error) {
    console.error("Pricing membership load failed:", error);

    membershipStatusBox.style.display = "block";
    membershipStatusText.textContent = "Could not load membership details.";
    membershipPlanText.textContent = "-";
    membershipBillingText.textContent = "-";
    membershipExpiryText.textContent = "-";
    featuredStatusText.textContent = "-";
    featuredExpiryText.textContent = "-";

    setCancelMessage(
      "There was a problem loading your membership details.",
      true
    );
  }
});