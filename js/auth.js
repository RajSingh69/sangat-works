import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

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
  registerForm.classList.remove("hidden");
  loginForm.classList.add("hidden");
  showRegister.classList.add("active");
  showLogin.classList.remove("active");
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;

  try {
    authMessage.textContent = "Logging in...";

    await signInWithEmailAndPassword(auth, email, password);

    authMessage.textContent = "Login successful.";

    if (selectedMembershipPlan) {
      window.location.href =
        `pricing.html?checkout=${encodeURIComponent(selectedMembershipPlan)}`;
      return;
    }

    window.location.href = "profile.html";
  } catch (error) {
    authMessage.textContent = error.message;
  }
});

registerForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const fullName = document.getElementById("registerName").value.trim();
  const email = document.getElementById("registerEmail").value.trim();
  const password = document.getElementById("registerPassword").value;

  try {
    authMessage.textContent = "Checking signup options...";

    if (!selectedMembershipPlan) {
      showPaidPlanRequiredMessage();
      return;
    }

    const isFoundingMember = false;
    const memberNumber = null;
    const subscriptionExpiresAt = null;

    authMessage.textContent = "Creating account...";

    const userCredential = await createUserWithEmailAndPassword(
      auth,
      email,
      password
    );

    await updateProfile(userCredential.user, {
      displayName: fullName
    });

    await setDoc(doc(db, "users", userCredential.user.uid), {
      uid: userCredential.user.uid,
      fullName,
      email,
      role: isFoundingMember ? "member" : "standard",
      internalAccount: false,

      isFoundingMember,
      memberNumber,

      hasSubscription: isFoundingMember,
      subscriptionStatus: isFoundingMember ? "active" : "inactive",
      subscriptionPlan: isFoundingMember ? "founding" : "none",
      subscriptionBillingType: isFoundingMember ? "founding-free-year" : "none",
      subscriptionExpiresAt,
      subscriptionUpdatedAt: serverTimestamp(),

      membershipPlan: isFoundingMember ? "founding" : "pending",
      membershipStatus: isFoundingMember ? "active" : "pending-payment",

      stripeCustomerId: "",
      stripeSubscriptionId: "",
      stripePriceId: "",

      featuredListing: false,
      featuredListingStatus: "inactive",
      featuredExpiresAt: null,

      hasSeenIntro: false,

      createdAt: serverTimestamp()
    });

    authMessage.textContent = selectedMembershipPlan
      ? "Account created. Continuing to secure checkout..."
      : isFoundingMember
      ? "Account created. You are a founding member with 1 year free access."
      : "Account created. Please choose a membership plan.";

    if (selectedMembershipPlan) {
      window.location.href =
        `pricing.html?checkout=${encodeURIComponent(selectedMembershipPlan)}`;
      return;
    }

    window.location.href = isFoundingMember ? "profile.html" : "pricing.html";
  } catch (error) {
    authMessage.textContent = error.message;
  }
});
