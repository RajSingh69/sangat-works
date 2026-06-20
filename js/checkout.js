import { auth, db } from "./firebase.js";

import {
  collection,
  addDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

document.querySelectorAll(".checkout-btn").forEach(button => {

  button.addEventListener("click", async () => {

    const user = auth.currentUser;

    if (!user) {
      alert("Please log in first.");
      window.location.href = "login.html";
      return;
    }

    alert("Checkout connection successful. Stripe step coming next.");

  });

});