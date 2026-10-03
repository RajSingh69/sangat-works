/*
  Join page (join.html): one form to become a member.
  1. Account first (name, email, password twice), so people choose their own
     password before paying.
  2. Optional code: a free trial code skips payment (functions/trials.js).
  3. Plan: 1 month or 1 year, auto-renew or pay once, then Stripe Checkout.
  Stripe sends them back to join.html?paid=1&session_id=..., where
  activateMembership (functions/membership.js) switches membership on.
*/

import { auth, db } from "./firebase.js";
import { friendlyAuthError } from "./auth-errors.js";
import { hasActiveSubscription } from "./subscription-guard.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { doc, getDoc, serverTimestamp, setDoc } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const FUNCTIONS = "https://europe-west1-sangat-works.cloudfunctions.net";
// Same Stripe prices as js/checkout.js.
const PLANS = {
  "month-renew": { priceId: "price_1Tkm19DbE6tXsxNUxU6b7NUI", billingType: "subscription", text: "£3.99 a month, renews monthly. Cancel any time." },
  "year-renew": { priceId: "price_1Tkm1gDbE6tXsxNU9veTZwPE", billingType: "subscription", text: "£25 a year, renews yearly. Cancel any time." },
  "month-once": { priceId: "price_1Tl8zyDbE6tXsxNUpynPPWft", billingType: "oneoff", text: "£3.99 once for 30 days. No renewal." },
  "year-once": { priceId: "price_1Tl90wDbE6tXsxNUPMzfGO5m", billingType: "oneoff", text: "£25 once for 365 days. No renewal." }
};
const INVITE_KEY = "swInvite";

const $ = id => document.getElementById(id);
const els = {
  formCard: $("joinFormCard"),
  activating: $("joinActivating"),
  activatingText: $("joinActivatingText"),
  activatingLink: $("joinActivatingLink"),
  member: $("joinMember"),
  cancelled: $("joinCancelled"),
  invite: $("joinInvite"),
  form: $("joinForm"),
  signedIn: $("joinSignedIn"),
  accountFields: $("joinAccountFields"),
  name: $("joinName"),
  email: $("joinEmail"),
  password: $("joinPassword"),
  confirm: $("joinPasswordConfirm"),
  code: $("joinCode"),
  codeApply: $("joinCodeApply"),
  codeMessage: $("joinCodeMessage"),
  planStep: $("joinPlanStep"),
  summary: $("joinSummary"),
  message: $("joinMessage"),
  submit: $("joinSubmit")
};

const params = new URLSearchParams(window.location.search);
let currentUser = null;
let trial = null; // { code, days, label } once a free trial code checks out

// ---------- Invites (pricing.html?invite=... or join.html?invite=...)

function readInvite() {
  try {
    const fromUrl = params.get("invite");
    if (fromUrl && /^[A-Za-z0-9_-]{6,128}$/.test(fromUrl)) {
      localStorage.setItem(INVITE_KEY, JSON.stringify({ uid: fromUrl, at: Date.now() }));
      return fromUrl;
    }
    const saved = JSON.parse(localStorage.getItem(INVITE_KEY) || "null");
    if (saved?.uid && Date.now() - saved.at < 30 * 86400000) return saved.uid;
  } catch {
    // Storage blocked: the invite only works from the link itself.
  }
  return "";
}
const inviterUid = readInvite();

// ---------- Helpers

function setMessage(text, isError = true) {
  els.message.textContent = text || "";
  els.message.classList.toggle("is-error", Boolean(text) && isError);
}

async function post(path, body, token = "") {
  let response;
  try {
    response = await fetch(`${FUNCTIONS}/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("No connection. Check your internet and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || "Something went wrong. Please try again."), { status: response.status });
  return data;
}

function selectedPlanKey() {
  const length = els.form.querySelector("input[name=joinLength]:checked").value;
  const payment = els.form.querySelector("input[name=joinPayment]:checked").value;
  return `${length}-${payment}`;
}

function updateSummary() {
  const key = selectedPlanKey();
  const plan = PLANS[key];
  const invited = inviterUid && plan.billingType === "subscription";
  els.summary.textContent = invited
    ? `First month free, then ${plan.text.charAt(0).toLowerCase()}${plan.text.slice(1)}`
    : plan.text;
  els.invite.hidden = !inviterUid || Boolean(trial);
}

function updateMode() {
  els.planStep.hidden = Boolean(trial);
  els.submit.textContent = trial ? `Start my ${trial.days}-day free trial` : "Continue to secure payment";
  updateSummary();
}

// ---------- Code

async function applyCode() {
  const raw = els.code.value.trim();
  trial = null;
  if (!raw) {
    els.codeMessage.textContent = "";
    updateMode();
    return true;
  }
  els.codeApply.disabled = true;
  els.codeMessage.className = "join-code-message";
  els.codeMessage.textContent = "Checking...";
  try {
    const result = await post("freeTrial", { action: "check", code: raw });
    trial = result;
    els.code.value = result.code;
    els.codeMessage.classList.add("is-good");
    els.codeMessage.textContent = `Code applied: ${result.days} days free, no card needed.${result.label ? ` (${result.label})` : ""}`;
    updateMode();
    return true;
  } catch (error) {
    els.codeMessage.classList.add("is-error");
    els.codeMessage.textContent = error.message;
    updateMode();
    return false;
  } finally {
    els.codeApply.disabled = false;
  }
}

// ---------- Account

async function getOrCreateAccount() {
  if (currentUser) return currentUser;
  const name = els.name.value.trim();
  const email = els.email.value.trim();
  const password = els.password.value;

  if (!name) throw new Error("Add your full name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Add a valid email address.");
  if (password.length < 6) throw new Error("Your password needs at least 6 characters.");
  if (password !== els.confirm.value) throw new Error("The two passwords don't match.");

  let user;
  try {
    user = (await createUserWithEmailAndPassword(auth, email, password)).user;
    await updateProfile(user, { displayName: name }).catch(() => {});
  } catch (error) {
    if (error.code !== "auth/email-already-in-use") throw error;
    // Back after a cancelled payment, or a dropped connection: carry on with that account.
    try {
      user = (await signInWithEmailAndPassword(auth, email, password)).user;
    } catch {
      throw new Error("That email already has an account. Log in instead, or use a different email.");
    }
  }

  // A basic member record (no membership yet); payment or a trial switches access on.
  const userRef = doc(db, "users", user.uid);
  if (!(await getDoc(userRef)).exists()) {
    await setDoc(userRef, {
      uid: user.uid,
      fullName: name,
      displayName: name,
      email: email.toLowerCase(),
      hasSeenIntro: false,
      isPublic: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  }
  return user;
}

// ---------- Submit

async function submit(event) {
  event.preventDefault();
  setMessage("");
  els.submit.disabled = true;
  const label = els.submit.textContent;

  try {
    // A typed but unchecked code gets checked first.
    if (els.code.value.trim() && (!trial || trial.code !== els.code.value.trim().toUpperCase())) {
      if (!(await applyCode())) throw new Error("Check your code, or clear it to pay instead.");
    }

    els.submit.textContent = currentUser ? "One moment..." : "Creating your account...";
    const user = await getOrCreateAccount();
    const token = await user.getIdToken();

    if (trial) {
      els.submit.textContent = "Starting your free trial...";
      await post("freeTrial", { action: "claim", code: trial.code, name: els.name.value.trim() || user.displayName || "" }, token);
      window.location.href = "profile.html";
      return;
    }

    const plan = PLANS[selectedPlanKey()];
    els.submit.textContent = "Opening secure payment...";
    const data = await post("createCheckoutSession", {
      priceId: plan.priceId,
      billingType: plan.billingType,
      uid: user.uid,
      email: user.email,
      referrerUid: plan.billingType === "subscription" ? inviterUid : ""
    });
    if (!data.url) throw new Error("We couldn't open the payment page. Please try again.");
    window.location.href = data.url;
  } catch (error) {
    console.error("Join failed:", error);
    setMessage(error.code ? friendlyAuthError(error) : error.message);
    els.submit.textContent = label;
    els.submit.disabled = false;
  }
}

// ---------- Back from Stripe: switch membership on

async function finishPayment(user) {
  els.formCard.hidden = true;
  els.activating.hidden = false;
  const sessionId = params.get("session_id") || "";
  try {
    if (sessionId) await post("activateMembership", { sessionId }, await user.getIdToken());
  } catch (error) {
    console.warn("Activation call failed, waiting for Stripe instead:", error);
  }
  // Wait (up to about 40 seconds) for membership to show as active.
  for (let attempt = 0; attempt < 20; attempt++) {
    const data = (await getDoc(doc(db, "users", user.uid)).catch(() => null))?.data();
    if (data && hasActiveSubscription(data)) {
      els.activatingText.textContent = "You're all set. Opening your profile...";
      window.location.href = "profile.html";
      return;
    }
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  els.activatingText.textContent = "Your payment went through, but it's taking a little longer than usual to switch everything on. Try your profile in a minute. If it still says you're not a member, contact us and we'll sort it straight away.";
  els.activatingLink.hidden = false;
  document.querySelector(".join-spinner")?.remove();
}

// ---------- Start

function showSignedIn(user) {
  els.accountFields.hidden = true;
  els.signedIn.hidden = false;
  els.signedIn.innerHTML = `Logged in as <strong></strong>. <button type="button" class="join-link-button" id="joinSignOut">Not you?</button>`;
  els.signedIn.querySelector("strong").textContent = user.email;
  document.getElementById("joinSignOut").addEventListener("click", async () => {
    await signOut(auth);
    window.location.reload();
  });
}

els.form.addEventListener("submit", submit);
els.form.addEventListener("change", event => {
  if (event.target.name === "joinLength" || event.target.name === "joinPayment") updateSummary();
});
els.codeApply.addEventListener("click", applyCode);
els.code.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    event.preventDefault();
    applyCode();
  }
});

els.cancelled.hidden = params.get("cancelled") !== "1";
if (params.get("code")) {
  els.code.value = params.get("code");
  applyCode();
}
updateMode();

let started = false;
onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  const headerLogin = document.getElementById("joinHeaderLogin");
  if (headerLogin) headerLogin.hidden = Boolean(user);
  if (started) return;
  started = true;

  if (!user) {
    if (params.get("paid") === "1") {
      els.formCard.hidden = true;
      els.activating.hidden = false;
      els.activatingText.textContent = "Payment received. Log in to finish setting up your membership.";
      els.activatingLink.textContent = "Log in";
      els.activatingLink.href = "login.html";
      els.activatingLink.hidden = false;
      document.querySelector(".join-spinner")?.remove();
    }
    return;
  }

  if (params.get("paid") === "1") {
    finishPayment(user);
    return;
  }
  const data = (await getDoc(doc(db, "users", user.uid)).catch(() => null))?.data();
  if (data && hasActiveSubscription(data)) {
    els.formCard.hidden = true;
    els.member.hidden = false;
    return;
  }
  // Free trial over: same account, they just need a plan now (one trial per account).
  const freeUntil = data?.freeAccessExpiresAt?.toDate ? data.freeAccessExpiresAt.toDate() : null;
  if (data?.freeAccessSource === "trial" && freeUntil && freeUntil < new Date()) {
    document.getElementById("joinTrialEnded").hidden = false;
  }
  showSignedIn(user);
});
