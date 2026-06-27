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
  isSuperAdmin
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
  return (
    status === "active" ||
    status === "trialing" ||
    status === "cancelling" ||
    status === "past_due"
  );
}

export function hasActiveSubscription(userData) {
  if (!userData) return false;

  if (isSuperAdmin(userData)) {
    return true;
  }

  const expiryDate = getExpiryDate(userData);

  if (userData.isFoundingMember === true) {
    if (!expiryDate) {
      return false;
    }

    return expiryDate > new Date();
  }

  if (userData.hasSubscription !== true) {
    return false;
  }

  if (!isAllowedStatus(userData.subscriptionStatus)) {
    return false;
  }

  if (!expiryDate) {
    return false;
  }

  return expiryDate > new Date();
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
