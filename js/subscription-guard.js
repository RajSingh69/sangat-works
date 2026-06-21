import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

export function hasActiveSubscription(userData) {
  if (!userData) return false;

  if (userData.hasSubscription === true) {
    return true;
  }

  if (userData.subscriptionStatus === "active") {
    return true;
  }

  if (userData.isFoundingMember === true) {
    return true;
  }

  return false;
}

export function protectPage(options = {}) {
  const redirectTo = options.redirectTo || "pricing.html";

  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    try {
      const userRef = doc(db, "users", user.uid);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        window.location.href = "profile.html";
        return;
      }

      const userData = userSnap.data();

      if (!hasActiveSubscription(userData)) {
        window.location.href = redirectTo;
        return;
      }

      if (typeof options.onAllowed === "function") {
        options.onAllowed(user, userData);
      }
    } catch (error) {
      console.error("Subscription guard error:", error);
      window.location.href = redirectTo;
    }
  });
}