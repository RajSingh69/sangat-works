console.log("subscription-guard.js loaded");

import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  isAdminUser
} from "./roles.js";

function getExpiryDate(userData) {
  if (!userData || !userData.subscriptionExpiresAt) {
    return null;
  }

  const expiryDate = userData.subscriptionExpiresAt.toDate
    ? userData.subscriptionExpiresAt.toDate()
    : new Date(userData.subscriptionExpiresAt);

  if (Number.isNaN(expiryDate.getTime())) {
    return null;
  }

  return expiryDate;
}

function isAllowedStatus(status) {
  return status === "active";
}

export function hasActiveSubscription(userData) {
  if (!userData) return false;

  if (isAdminUser(userData)) {
    return true;
  }

  const expiryDate = getExpiryDate(userData);

  if (userData.hasSubscription !== true) {
    return false;
  }

  if (!isAllowedStatus(userData.subscriptionStatus)) {
    return false;
  }

  return !expiryDate || expiryDate > new Date();
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
      const allowed = hasActiveSubscription(userData);

      console.log("Subscription check:", userData);
      console.log("isFoundingMember value:", userData.isFoundingMember);
      console.log("hasSubscription value:", userData.hasSubscription);
      console.log("subscriptionStatus value:", userData.subscriptionStatus);
      console.log("subscriptionExpiresAt value:", userData.subscriptionExpiresAt);
      console.log("Allowed:", allowed);

      if (!allowed) {
        window.location.href =
          `${redirectTo}${redirectTo.includes("?") ? "&" : "?"}payment_required=1`;
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
