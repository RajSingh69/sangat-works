import { auth } from "./firebase.js";

const PRICE_IDS = {
  yearly_subscription: "price_1Tkm1gDbE6tXsxNU9veTZwPE",
  monthly_subscription: "price_1Tkm19DbE6tXsxNUxU6b7NUI",
  yearly_pass: "price_1Tl90wDbE6tXsxNUPMzfGO5m",
  monthly_pass: "price_1Tl8zyDbE6tXsxNUpynPPWft"
};

const FUNCTION_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/createCheckoutSession";

console.log("checkout.js loaded");

document.querySelectorAll(".checkout-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    console.log("Checkout button clicked");

    const user = auth.currentUser;

    if (!user) {
      alert("Please log in first.");
      window.location.href = "login.html";
      return;
    }

    const selectedPlan = button.dataset.plan;
    const selectedPrice = PRICE_IDS[selectedPlan];

    if (!selectedPrice) {
      alert("Invalid membership option selected.");
      return;
    }

    const billingType = selectedPlan.includes("_pass")
      ? "oneoff"
      : "subscription";

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
  });
});