import { auth } from "./firebase.js";

const YEARLY_PRICE_ID = "price_1Tkm1gDbE6tXsxNU9veTZwPE";
const MONTHLY_PRICE_ID = "price_1Tkm19DbE6tXsxNUxU6b7NUI";

const FUNCTION_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/createCheckoutSession";

console.log("checkout.js loaded");

document.querySelectorAll(".checkout-btn").forEach((button) => {
  button.addEventListener("click", async () => {

    console.log("Checkout button clicked");

    const user = auth.currentUser;

    console.log("Current user:", user);

    if (!user) {
      alert("Please log in first.");
      window.location.href = "login.html";
      return;
    }

    const selectedPrice =
      button.dataset.plan === "yearly"
        ? YEARLY_PRICE_ID
        : MONTHLY_PRICE_ID;

    console.log("Selected price:", selectedPrice);

    try {
      console.log("Calling function...");

      const response = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "text/plain"
        },
        body: JSON.stringify({
          priceId: selectedPrice,
          uid: user.uid,
          email: user.email
        })
      });

      console.log("Response received:", response.status);

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