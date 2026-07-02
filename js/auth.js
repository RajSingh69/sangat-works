import { auth, db } from "./firebase.js";

import {
  signInWithEmailAndPassword
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  hasActiveSubscription
} from "./subscription-guard.js";

import {
  isAdminUser
} from "./roles.js";

const showLogin = document.getElementById("showLogin");
const showRegister = document.getElementById("showRegister");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const authMessage = document.getElementById("authMessage");

const MEMBERSHIP_PLANS = [
  "yearly_subscription",
  "monthly_subscription",
  "yearly_pass",
  "monthly_pass"
];

const requestedPlan = new URLSearchParams(window.location.search).get("plan");
const selectedMembershipPlan = MEMBERSHIP_PLANS.includes(requestedPlan)
  ? requestedPlan
  : "";

function showPaidPlanRequiredMessage() {
  authMessage.innerHTML = `
    The free founding member spaces are now full. Please choose a membership plan to continue.
    <br />
    <a class="btn-primary" href="pricing.html" style="display:inline-block; margin-top:12px;">
      Choose a membership plan
    </a>
  `;
}

showLogin.addEventListener("click", () => {
  loginForm.classList.remove("hidden");
  registerForm.classList.add("hidden");
  showLogin.classList.add("active");
  showRegister.classList.remove("active");
});

showRegister.addEventListener("click", () => {
  showPaidPlanRequiredMessage();
  window.location.href = "pricing.html";
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    authMessage.textContent = "Logging in...";

    const userCredential = await signInWithEmailAndPassword(auth, email, password);

    authMessage.textContent = "Login successful.";

    if (selectedMembershipPlan) {
      window.location.href =
        `pricing.html?checkout=${encodeURIComponent(selectedMembershipPlan)}`;
      return;
    }

    const userRef = doc(db, "users", userCredential.user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      authMessage.textContent =
        "Your account is not active yet. Please complete payment to unlock Sangat Works.";
      window.location.href = "pricing.html";
      return;
    }

    const userData = userSnap.data();

    if (isAdminUser(userData) || hasActiveSubscription(userData)) {
      window.location.href = "profile.html";
      return;
    }

    authMessage.textContent =
      "Your account is not active yet. Please complete payment to unlock Sangat Works.";
    window.location.href = "pricing.html";
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  showPaidPlanRequiredMessage();
  window.location.href = "pricing.html";
});
