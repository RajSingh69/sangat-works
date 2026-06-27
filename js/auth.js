import { auth, db } from "./firebase.js";

import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  doc,
  getDocs,
  setDoc,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  isInternalAccount
} from "./roles.js";

const FOUNDING_MEMBER_LIMIT = 30;

const showLogin = document.getElementById("showLogin");
const showRegister = document.getElementById("showRegister");
const loginForm = document.getElementById("loginForm");
const registerForm = document.getElementById("registerForm");
const authMessage = document.getElementById("authMessage");

function getOneYearFromNowTimestamp() {
  const expiryDate = new Date();
  expiryDate.setFullYear(expiryDate.getFullYear() + 1);
  return Timestamp.fromDate(expiryDate);
}

async function getFoundingMemberCount() {
  const usersSnap = await getDocs(collection(db, "users"));

  let count = 0;

  usersSnap.forEach((docSnap) => {
    const user = docSnap.data();

    if (user.isFoundingMember === true && !isInternalAccount(user)) {
      count++;
    }
  });

  return count;
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
    authMessage.textContent = "Checking founding member spaces...";

    const foundingCount = await getFoundingMemberCount();
    const isFoundingMember = foundingCount < FOUNDING_MEMBER_LIMIT;
    const memberNumber = isFoundingMember ? foundingCount + 1 : null;
    const subscriptionExpiresAt = isFoundingMember
      ? getOneYearFromNowTimestamp()
      : null;

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

    authMessage.textContent = isFoundingMember
      ? "Account created. You are a founding member with 1 year free access."
      : "Account created. Please choose a membership plan.";

    window.location.href = isFoundingMember ? "profile.html" : "pricing.html";
  } catch (error) {
    authMessage.textContent = error.message;
  }
});
