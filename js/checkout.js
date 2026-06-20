import { auth } from "./firebase.js";

const YEARLY_PRICE_ID = "price_1TkRE3DUGpJNp57jibUQGKDf";
const MONTHLY_PRICE_ID = "price_1TkREoDUGpJNp57jw98RTUIU";

const FUNCTION_URL =
  "https://createcheckoutsession-azgck6mz5a-ew.a.run.app";

console.log("checkout.js loaded");

document.querySelectorAll(".checkout-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    const user = auth.currentUser;

    if (!user) {
      alert("Please log in first.");
      window.location.href = "login.html";
      return;
    }

    const selectedPrice =
      button.dataset.plan === "yearly"
        ? YEARLY_PRICE_ID
        : MONTHLY_PRICE_ID;

    try {
      const response = await fetch(FUNCTION_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          priceId: selectedPrice,
          uid: user.uid,
          email: user.email
        })
      });

      const data = await response.json();

      if (data.error) {
        alert(data.error);
        return;
      }

      if (data.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error(error);
      alert("Checkout failed.");
    }
  });
});