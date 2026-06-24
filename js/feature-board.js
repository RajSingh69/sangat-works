import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  increment,
  query,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const featuresGrid = document.getElementById("featuresGrid");
const featureMessage = document.getElementById("featureMessage");

let currentUser = null;

const starterFeatures = [
  {
    id: "highlighted-flashing-card",
    title: "Highlighted Flashing Directory Card",
    description: "Let members pay £0.99 to highlight their directory card for 2 days.",
    category: "Paid boost"
  },
  {
    id: "tutoring-system",
    title: "Tutoring System",
    description: "Allow Sikh tutors to list subjects, prices, availability and profiles.",
    category: "Education"
  },
  {
    id: "jobs-board",
    title: "Jobs Board",
    description: "A community jobs board for businesses, professionals, apprentices and students.",
    category: "Careers"
  },
  {
    id: "mentorship",
    title: "Mentorship",
    description: "Connect younger members with experienced professionals and business owners.",
    category: "Community"
  },
  {
    id: "apprenticeships",
    title: "Apprenticeships",
    description: "Help young people find apprenticeship opportunities through Sangat businesses.",
    category: "Careers"
  },
  {
    id: "business-collaboration",
    title: "Business Collaboration",
    description: "Let members find other Sikh businesses to partner with on projects.",
    category: "Business"
  },
  {
    id: "event-promotion",
    title: "Event Promotion",
    description: "Allow members to promote Sikh business, networking and community events.",
    category: "Events"
  },
  {
    id: "community-requests",
    title: "Community Requests",
    description: "Post requests for help, recommendations, services or community support.",
    category: "Community"
  }
];

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  await seedStarterFeaturesIfNeeded();
  await loadFeatures();
});

async function seedStarterFeaturesIfNeeded() {
  const featuresRef = collection(db, "futureFeatures");
  const snapshot = await getDocs(featuresRef);

  if (!snapshot.empty) return;

  for (let i = 0; i < starterFeatures.length; i++) {
    const feature = starterFeatures[i];

    await setDoc(doc(db, "futureFeatures", feature.id), {
      title: feature.title,
      description: feature.description,
      category: feature.category,
      upvotes: 0,
      downvotes: 0,
      createdAt: serverTimestamp(),
      sortOrder: i + 1,
      active: true
    });
  }
}

async function loadFeatures() {
  featuresGrid.innerHTML = "";
  featureMessage.textContent = "Loading feature ideas...";

  const featuresQuery = query(
    collection(db, "futureFeatures"),
    orderBy("sortOrder", "asc")
  );

  const snapshot = await getDocs(featuresQuery);

  if (snapshot.empty) {
    featureMessage.textContent = "No feature ideas have been added yet.";
    return;
  }

  featureMessage.textContent = currentUser
    ? "Vote once per feature. You can change your vote anytime."
    : "Login to vote on future features.";

  for (const featureDoc of snapshot.docs) {
    const feature = featureDoc.data();

    if (feature.active === false) continue;

    let userVote = null;

    if (currentUser) {
      const voteRef = doc(
        db,
        "futureFeatures",
        featureDoc.id,
        "votes",
        currentUser.uid
      );

      const voteSnap = await getDoc(voteRef);

      if (voteSnap.exists()) {
        userVote = voteSnap.data().vote;
      }
    }

    renderFeatureCard(featureDoc.id, feature, userVote);
  }
}

function renderFeatureCard(featureId, feature, userVote) {
  const card = document.createElement("article");
  card.className = "feature-card";

  card.innerHTML = `
    <span class="feature-tag">${escapeHtml(feature.category || "Feature")}</span>

    <h2>${escapeHtml(feature.title || "Untitled feature")}</h2>

    <p>${escapeHtml(feature.description || "")}</p>

    <div class="vote-row">
      <button 
        class="vote-btn ${userVote === "up" ? "active" : ""}" 
        type="button"
        data-vote="up"
      >
        👍 ${feature.upvotes || 0}
      </button>

      <button 
        class="vote-btn ${userVote === "down" ? "active" : ""}" 
        type="button"
        data-vote="down"
      >
        👎 ${feature.downvotes || 0}
      </button>
    </div>
  `;

  const upBtn = card.querySelector('[data-vote="up"]');
  const downBtn = card.querySelector('[data-vote="down"]');

  upBtn.addEventListener("click", () => handleVote(featureId, "up"));
  downBtn.addEventListener("click", () => handleVote(featureId, "down"));

  featuresGrid.appendChild(card);
}

async function handleVote(featureId, newVote) {
  if (!currentUser) {
    window.location.href = "login.html";
    return;
  }

  const voteRef = doc(
    db,
    "futureFeatures",
    featureId,
    "votes",
    currentUser.uid
  );

  const featureRef = doc(db, "futureFeatures", featureId);

  const voteSnap = await getDoc(voteRef);
  const oldVote = voteSnap.exists() ? voteSnap.data().vote : null;

  if (oldVote === newVote) {
    return;
  }

  const updates = {};

  if (oldVote === "up") updates.upvotes = increment(-1);
  if (oldVote === "down") updates.downvotes = increment(-1);

  if (newVote === "up") updates.upvotes = increment(1);
  if (newVote === "down") updates.downvotes = increment(1);

  await updateDoc(featureRef, updates);

  await setDoc(voteRef, {
    vote: newVote,
    userId: currentUser.uid,
    updatedAt: serverTimestamp()
  });

  await loadFeatures();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}