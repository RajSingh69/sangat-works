/*
  Reviews on a member's profile (view.html). Each member can leave one review
  per profile, stored at users/{profileId}/reviews/{reviewerUid}. The reviewer's
  name comes from their own profile; no email is stored because reviews are public.
*/

import { auth, db } from "./firebase.js";
import { getUserProfile } from "./member-network.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const reviewsList = document.getElementById("reviewsList");
const reviewForm = document.getElementById("reviewForm");

const profileId = new URLSearchParams(window.location.search).get("id");

let currentUser = null;
let authChecked = false;
let reviewerIds = new Set();
const reviewFormHtml = reviewForm?.innerHTML || "";

// The form is redrawn by updateFormState, so look its message line up each time.
function setReviewMessage(text) {
  const message = document.getElementById("reviewMessage");
  if (message) message.textContent = text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

function stars(rating) {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return `<span class="pv-stars" aria-label="${full} out of 5">${"&#9733;".repeat(full)}<span>${"&#9733;".repeat(5 - full)}</span></span>`;
}

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : null;
  return date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
}

// Shows the form, or a note explaining why this person can't review. Safe to call
// repeatedly as sign-in and reviews finish loading in either order.
function updateFormState() {
  if (!reviewForm || !profileId || !authChecked) return;
  let note = "";
  if (!currentUser) note = `<a href="login.html">Log in</a> to leave a review.`;
  else if (currentUser.uid === profileId) note = "This is your profile. Reviews from other members will appear here.";
  else if (reviewerIds.has(currentUser.uid)) note = "Thanks, you've already reviewed this member.";

  const html = note ? `<h3>Leave a review</h3><p class="pv-form-note">${note}</p>` : reviewFormHtml;
  if (reviewForm.dataset.state !== (note || "form")) {
    reviewForm.innerHTML = html;
    reviewForm.dataset.state = note || "form";
  }
}

async function loadReviews() {
  if (!profileId || !reviewsList) return;

  reviewsList.innerHTML = `<div class="pv-card pv-empty">Loading reviews...</div>`;

  try {
    const snapshot = await getDocs(query(collection(db, "users", profileId, "reviews"), orderBy("createdAt", "desc")));
    const reviews = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
    reviewerIds = new Set(reviews.map(review => review.reviewerId || review.reviewerUid).filter(Boolean));

    const count = reviews.length;
    const average = count ? reviews.reduce((total, review) => total + Number(review.rating || 0), 0) / count : 0;
    window.swReviewSummary = { average, count };
    window.dispatchEvent(new CustomEvent("sw:reviews-loaded"));
    updateFormState();

    if (!count) {
      reviewsList.innerHTML = `<div class="pv-card pv-empty">No reviews yet. Worked with this member? Be the first to recommend them.</div>`;
      return;
    }

    reviewsList.innerHTML = `
      <div class="pv-card pv-review-summary">
        <strong>${average.toFixed(1)}</strong>
        <div>${stars(average)}<span>${count} review${count === 1 ? "" : "s"}</span></div>
      </div>
      ${reviews.map(review => {
        const reviewerId = review.reviewerId || review.reviewerUid || "";
        const name = escapeHtml(review.reviewerName || "Sangat member");
        return `
          <article class="pv-card pv-review">
            <div class="pv-review-top">
              ${reviewerId ? `<a href="view.html?id=${encodeURIComponent(reviewerId)}"><strong>${name}</strong></a>` : `<strong>${name}</strong>`}
              ${stars(Number(review.rating || 0))}
            </div>
            ${review.serviceUsed || review.createdAt ? `<p class="pv-review-meta">${[review.serviceUsed ? escapeHtml(review.serviceUsed) : "", escapeHtml(formatDate(review.createdAt))].filter(Boolean).join(" &middot; ")}</p>` : ""}
            <p class="pv-text">${escapeHtml(review.reviewText || "")}</p>
          </article>`;
      }).join("")}
    `;
  } catch (error) {
    console.error("Could not load reviews:", error);
    reviewsList.innerHTML = `<div class="pv-card pv-empty">Reviews couldn't be loaded right now.</div>`;
  }
}

async function getReviewerName(user) {
  const profile = await getUserProfile(user.uid).catch(() => null);
  return profile?.fullName || profile?.displayName || profile?.businessName || user.displayName || "Sangat member";
}

if (reviewForm) {
  reviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!currentUser || currentUser.uid === profileId) return updateFormState();

    const rating = Number(document.getElementById("rating").value);
    const serviceUsed = document.getElementById("serviceUsed").value.trim();
    const reviewText = document.getElementById("reviewText").value.trim();

    if (!rating) {
      setReviewMessage("Choose a rating.");
      return;
    }
    if (reviewText.length < 5) {
      setReviewMessage("Write a few words about your experience.");
      return;
    }

    const submitButton = reviewForm.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    setReviewMessage("Saving review...");

    try {
      const reviewRef = doc(db, "users", profileId, "reviews", currentUser.uid);
      if ((await getDoc(reviewRef)).exists()) {
        reviewerIds.add(currentUser.uid);
        updateFormState();
        return;
      }

      await setDoc(reviewRef, {
        profileId,
        reviewerId: currentUser.uid,
        reviewerName: await getReviewerName(currentUser),
        serviceUsed,
        rating,
        reviewText,
        createdAt: serverTimestamp()
      });

      await loadReviews();
    } catch (error) {
      console.error("Could not save review:", error);
      setReviewMessage("Couldn't save your review. Please try again.");
      submitButton.disabled = false;
    }
  });
}

onAuthStateChanged(auth, (user) => {
  currentUser = user;
  authChecked = true;
  updateFormState();
});

loadReviews();
