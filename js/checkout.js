import { auth } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const PRICE_IDS = {
  yearly_subscription: "price_1Tkm1gDbE6tXsxNU9veTZwPE",
  monthly_subscription: "price_1Tkm19DbE6tXsxNUxU6b7NUI",
  yearly_pass: "price_1Tl90wDbE6tXsxNUPMzfGO5m",
  monthly_pass: "price_1Tl8zyDbE6tXsxNUpynPPWft",
  featured_listing: "price_1TlZxODbE6tXsxNUzI1ng4Iy"
};

const FUNCTION_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/createCheckoutSession";

const MEMBERSHIP_PLANS = [
  "yearly_subscription",
  "monthly_subscription",
  "yearly_pass",
  "monthly_pass"
];

function getBillingType(selectedPlan) {
  return selectedPlan === "featured_listing"
    ? "featured"
    : selectedPlan.includes("_pass")
      ? "oneoff"
      : "subscription";
}

const emailBox = document.getElementById("checkoutEmailBox");
const emailInput = document.getElementById("checkoutEmail");
const checkoutMessage = document.getElementById("checkoutMessage");

function showCheckoutMessage(text) {
  if (!checkoutMessage) {
    if (text) alert(text);
    return;
  }
  checkoutMessage.textContent = text || "";
  if (text) checkoutMessage.scrollIntoView({ behavior: "smooth", block: "center" });
}

// Signed-out visitors type the email for their new account here.
onAuthStateChanged(auth, (user) => {
  if (emailBox) emailBox.hidden = Boolean(user);
});

function sendToLoginWithPlan(selectedPlan) {
  if (MEMBERSHIP_PLANS.includes(selectedPlan)) {
    window.location.href = `pricing.html?checkout=${encodeURIComponent(selectedPlan)}`;
    return;
  }

  alert("Please log in first.");
  window.location.href = "login.html";
}

async function startCheckout(selectedPlan, button) {

  const user = auth.currentUser;

  if (!user && !MEMBERSHIP_PLANS.includes(selectedPlan)) {
    sendToLoginWithPlan(selectedPlan);
    return;
  }

  const selectedPrice = PRICE_IDS[selectedPlan];

  if (!selectedPrice) {
    alert("Invalid membership option selected.");
    return;
  }

  const billingType = getBillingType(selectedPlan);
  const checkoutEmail = user?.email || emailInput?.value.trim() || "";

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(checkoutEmail)) {
    showCheckoutMessage("Enter your email address above first. It becomes your Sangat Works login.");
    emailInput?.focus();
    return;
  }

  const buttonLabel = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Opening secure checkout...";
  }
  showCheckoutMessage("");

  try {
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      body: JSON.stringify({
        priceId: selectedPrice,
        billingType,
        uid: user?.uid || "",
        email: checkoutEmail.trim()
      })
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok || !data.url) {
      throw new Error(data.error || "We couldn't open checkout. Please try again.");
    }

    window.location.href = data.url;
  } catch (error) {
    console.error("Checkout error:", error);
    showCheckoutMessage(
      error instanceof TypeError
        ? "No connection. Check your internet and try again."
        : error.message
    );
    if (button) {
      button.disabled = false;
      button.textContent = buttonLabel;
    }
  }
}

document.querySelectorAll(".checkout-btn").forEach((button) => {
  button.addEventListener("click", () => {
    startCheckout(button.dataset.plan, button);
  });
});

const checkoutPlan = new URLSearchParams(window.location.search).get("checkout");

if (checkoutPlan && PRICE_IDS[checkoutPlan]) {
  let hasStartedCheckout = false;

  onAuthStateChanged(auth, (user) => {
    if (!user || hasStartedCheckout) {
      return;
    }

    hasStartedCheckout = true;
    startCheckout(checkoutPlan);
  });
}
