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

console.log("checkout.js loaded");

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

function sendToLoginWithPlan(selectedPlan) {
  if (MEMBERSHIP_PLANS.includes(selectedPlan)) {
    window.location.href = `login.html?plan=${encodeURIComponent(selectedPlan)}`;
    return;
  }

  alert("Please log in first.");
  window.location.href = "login.html";
}

async function startCheckout(selectedPlan) {
  console.log("Checkout button clicked");

  const user = auth.currentUser;

  if (!user) {
    sendToLoginWithPlan(selectedPlan);
    return;
  }

  const selectedPrice = PRICE_IDS[selectedPlan];

  if (!selectedPrice) {
    alert("Invalid membership option selected.");
    return;
  }

  const billingType = getBillingType(selectedPlan);

  console.log("Selected plan:", selectedPlan);
  console.log("Selected price:", selectedPrice);
  console.log("Billing type:", billingType);

  try {
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain"
      },
      body: JSON.stringify({
        priceId: selectedPrice,
        billingType,
        uid: user.uid,
        email: user.email
      })
    });

    const data = await response.json();

    console.log("Function returned:", data);

    if (data.error) {
      alert(data.error);
      return;
    }

    if (data.url) {
      window.location.href = data.url;
    }
  } catch (error) {
    console.error("Checkout error:", error);
    alert("Checkout failed.");
  }
}

document.querySelectorAll(".checkout-btn").forEach((button) => {
  button.addEventListener("click", () => {
    startCheckout(button.dataset.plan);
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
