import { auth, db } from "./firebase.js";

import {
  collection,
  addDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const YEARLY_PRICE_ID = "price_1TkRE3DUGpJNp57jibUQGKDf";
const MONTHLY_PRICE_ID = "price_1TkREoDUGpJNp57jw98RTUIU";

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
      const checkoutSessionRef = await addDoc(
        collection(db, "customers", user.uid, "checkout_sessions"),
        {
          price: selectedPrice,
          success_url: window.location.origin + "/success.html",
          cancel_url: window.location.origin + "/cancel.html"
        }
      );

      onSnapshot(checkoutSessionRef, (snap) => {
        const data = snap.data();

        if (!data) return;

        if (data.error) {
          console.error("Stripe checkout error:", data.error);
          alert(data.error.message || "Something went wrong.");
        }

        if (data.url) {
          window.location.assign(data.url);
        }
      });
    } catch (error) {
      console.error("Checkout error:", error);
      alert("Could not start checkout. Check the console.");
    }
  });
});