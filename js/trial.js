/*
  Free trial sign-up (trial.html?code=CODE). No card: create an account, then the
  freeTrial Cloud Function (functions/trials.js) checks the code and turns the
  trial on. A second attempt with the same details signs back in and claims it.
*/

import { auth } from "./firebase.js";
import { friendlyAuthError } from "./auth-errors.js";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const TRIAL_URL = "https://europe-west1-sangat-works.cloudfunctions.net/freeTrial";
const $ = id => document.getElementById(id);
const els = {
  eyebrow: $("trialEyebrow"),
  title: $("trialTitle"),
  lead: $("trialLead"),
  points: $("trialPoints"),
  codeForm: $("trialCodeForm"),
  codeInput: $("trialCodeInput"),
  signupForm: $("trialSignupForm"),
  name: $("trialName"),
  email: $("trialEmail"),
  password: $("trialPassword"),
  submit: $("trialSubmit"),
  message: $("trialMessage"),
  login: $("trialLogin")
};

let code = "";
let signedInUser = null;

const lengthLabel = days => (days === 7 ? "1-week" : days === 14 ? "2-week" : days === 30 ? "1-month" : `${days}-day`);

function setMessage(text, isError = false) {
  els.message.textContent = text || "";
  els.message.style.color = isError ? "#b42318" : "";
}

async function callTrial(body, idToken = "") {
  let response;
  try {
    response = await fetch(TRIAL_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}) },
      body: JSON.stringify(body)
    });
  } catch {
    throw new Error("No connection. Check your internet and try again.");
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}

function showCodeForm(text) {
  els.lead.textContent = text;
  els.codeForm.hidden = false;
  els.signupForm.hidden = true;
  els.points.hidden = true;
  els.codeInput.focus();
}

async function checkCode(rawCode) {
  setMessage("");
  els.lead.textContent = "Checking your trial code...";
  try {
    const result = await callTrial({ action: "check", code: rawCode });
    code = result.code;
    const url = new URL(window.location.href);
    url.searchParams.set("code", code);
    history.replaceState(null, "", url);

    els.eyebrow.textContent = result.label || "Free trial";
    els.title.textContent = `Your ${lengthLabel(result.days)} free trial`;
    els.lead.textContent = `Join Sangat Works free for ${result.days} days. No card needed.`;
    els.points.hidden = false;
    els.codeForm.hidden = true;
    els.signupForm.hidden = false;
    if (signedInUser) showSignedIn();
  } catch (error) {
    showCodeForm(error.message);
  }
}

// Already logged in (e.g. an old account that never paid): claim with one tap.
function showSignedIn() {
  els.name.closest("form").querySelectorAll("input, .password-wrap").forEach(el => { el.hidden = true; });
  els.submit.textContent = "Start my free trial";
  els.lead.textContent += ` You're logged in as ${signedInUser.email}.`;
  els.login.hidden = true;
}

async function claim(user, name) {
  const token = await user.getIdToken();
  const result = await callTrial({ action: "claim", code, name }, token);
  setMessage(`You're in. Your free trial runs until ${new Date(result.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}. Opening your profile...`);
  window.location.href = "profile.html";
}

els.codeForm.addEventListener("submit", event => {
  event.preventDefault();
  const value = els.codeInput.value.trim();
  if (value) checkCode(value);
});

els.signupForm.addEventListener("submit", async event => {
  event.preventDefault();
  els.submit.disabled = true;
  setMessage("Starting your free trial...");

  try {
    let user = signedInUser;
    const name = els.name.value.trim();
    if (!user) {
      const email = els.email.value.trim();
      const password = els.password.value;
      if (!name) throw new Error("Add your name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Add a valid email address.");
      if (password.length < 6) throw new Error("Use a password with at least 6 characters.");
      try {
        user = (await createUserWithEmailAndPassword(auth, email, password)).user;
        await updateProfile(user, { displayName: name }).catch(() => {});
      } catch (error) {
        if (error.code !== "auth/email-already-in-use") throw error;
        // Tried before and the connection dropped: sign back in and finish.
        try {
          user = (await signInWithEmailAndPassword(auth, email, password)).user;
        } catch {
          throw new Error("That email already has an account. Log in first, then open this link again.");
        }
      }
    }
    await claim(user, name || user.displayName || "");
  } catch (error) {
    console.error("Free trial failed:", error);
    setMessage(error.code ? friendlyAuthError(error) : error.message, true);
    els.submit.disabled = false;
  }
});

onAuthStateChanged(auth, user => {
  signedInUser = user;
  if (user && code && !els.signupForm.hidden) showSignedIn();
});

const fromUrl = new URLSearchParams(window.location.search).get("code");
if (fromUrl) checkCode(fromUrl);
else showCodeForm("Enter the trial code from the event, or scan the QR code again.");
