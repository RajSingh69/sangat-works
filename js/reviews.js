import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const reviewsList = document.getElementById("reviewsList");
const reviewForm = document.getElementById("reviewForm");
const reviewMessage = document.getElementById("reviewMessage");

const params = new URLSearchParams(window.location.search);
const profileId = params.get("id");

let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  if (!user && reviewForm) {
    reviewForm.innerHTML = `
      <div class="empty-state">
        Please log in to leave a review.
      </div>
    `;
  }

  if (user && user.uid === profileId && reviewForm) {
    reviewForm.innerHTML = `
      <div class="empty-state">
        You cannot review your own profile.
      </div>
    `;
  }
});

function stars(rating) {
  return "★".repeat(rating) + "☆".repeat(5 - rating);
}

async function loadReviews() {
  if (!profileId || !reviewsList) return;

  reviewsList.innerHTML = `<div class="empty-state">Loading reviews...</div>`;

  const reviewsRef = collection(db, "users", profileId, "reviews");
  const reviewsQuery = query(reviewsRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(reviewsQuery);

  if (snapshot.empty) {
    reviewsList.innerHTML = `
      <div class="empty-state">
        No reviews yet. Be the first to recommend this member.
      </div>
    `;
    return;
  }

  let total = 0;
  let reviews = [];

  snapshot.forEach(docSnap => {
    const review = docSnap.data();
    total += Number(review.rating || 0);
    reviews.push(review);
  });

  const average = (total / reviews.length).toFixed(1);

  reviewsList.innerHTML = `
    <div class="review-summary">
      <strong>${average}/5</strong>
      <span>${stars(Math.round(average))}</span>
      <p>${reviews.length} review${reviews.length === 1 ? "" : "s"}</p>
    </div>

    ${reviews.map(review => `
      <div class="review-card">
        <div class="review-top">
          <strong>${review.reviewerName || "Sangat Member"}</strong>
          <span>${stars(Number(review.rating || 0))}</span>
        </div>

        ${review.serviceUsed ? `<p><strong>Service used:</strong> ${review.serviceUsed}</p>` : ""}
        <p>${review.reviewText || ""}</p>
      </div>
    `).join("")}
  `;
}

if (reviewForm) {
  reviewForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!currentUser) {
      reviewMessage.textContent = "Please log in to leave a review.";
      return;
    }

    if (currentUser.uid === profileId) {
      reviewMessage.textContent = "You cannot review your own profile.";
      return;
    }

    const reviewerName = document.getElementById("reviewerName").value.trim();
    const serviceUsed = document.getElementById("serviceUsed").value.trim();
    const rating = Number(document.getElementById("rating").value);
    const reviewText = document.getElementById("reviewText").value.trim();

    try {
      reviewMessage.textContent = "Saving review...";

      await addDoc(collection(db, "users", profileId, "reviews"), {
        profileId,
        reviewerUid: currentUser.uid,
        reviewerEmail: currentUser.email,
        reviewerName,
        serviceUsed,
        rating,
        reviewText,
        createdAt: serverTimestamp()
      });

      reviewForm.reset();
      reviewMessage.textContent = "Review added successfully.";

      await loadReviews();
    } catch (error) {
      reviewMessage.textContent = error.message;
    }
  });
}

loadReviews();