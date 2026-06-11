import { db } from "./firebase.js";

import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const directoryResults = document.getElementById("directoryResults");

let allProfiles = [];

function discountLabel(value) {
  const labels = {
    yes: "Community rates available",
    sometimes: "May offer community rates",
    no: "Fair pricing supporter",
    "not-specified": ""
  };

  return labels[value] || "";
}

function renderDirectoryProfile(profile) {
  const tags = profile.tags || [];
  const visibleTags = tags.slice(0, 6);
  const tagsHtml = visibleTags.map(tag => `<span class="tag">${tag}</span>`).join("");

  return `
    <div class="profile-card theme-${profile.themeColour || "gold"}">
      <h3>${profile.businessName || profile.fullName}</h3>
      <p class="service">${profile.serviceTitle || ""}</p>

      ${profile.yearsExperience ? `<p><strong>Experience:</strong> ${profile.yearsExperience} years</p>` : ""}
      <p><strong>Location:</strong> ${profile.town || "Location not provided"}</p>
      ${profile.serviceArea ? `<p><strong>Service area:</strong> ${profile.serviceArea}</p>` : ""}

      ${profile.associatedGurdwara && profile.showGurdwara ? `
        <p><strong>Sangat/Gurdwara:</strong> ${profile.associatedGurdwara}</p>
      ` : ""}

      ${discountLabel(profile.communityDiscount) ? `
        <p><strong>Community:</strong> ${discountLabel(profile.communityDiscount)}</p>
      ` : ""}

      ${profile.description ? `<p>${profile.description.substring(0, 160)}${profile.description.length > 160 ? "..." : ""}</p>` : ""}

      <div class="tags">${tagsHtml}</div>

      <div class="card-links">
        <a href="view.html?id=${profile.uid}">View Profile</a>
        ${profile.website ? `<a href="${profile.website}" target="_blank">Website</a>` : ""}
        ${profile.linkedin ? `<a href="${profile.linkedin}" target="_blank">LinkedIn</a>` : ""}
        ${profile.showGoogleReviews && profile.googleReviews ? `<a href="${profile.googleReviews}" target="_blank">Reviews</a>` : ""}
      </div>
    </div>
  `;
}

function filterProfiles() {
  const queryText = searchInput.value.toLowerCase().trim();

  const filteredProfiles = allProfiles.filter(profile => {
    const searchableText = `
      ${profile.fullName || ""}
      ${profile.businessName || ""}
      ${profile.serviceTitle || ""}
      ${profile.description || ""}
      ${profile.whyContact || ""}
      ${profile.specialistWork || ""}
      ${profile.associatedGurdwara || ""}
      ${profile.serviceArea || ""}
      ${(profile.tags || []).join(" ")}
      ${profile.town || ""}
    `.toLowerCase();

    return searchableText.includes(queryText);
  });

  if (filteredProfiles.length === 0) {
    directoryResults.innerHTML = `
      <div class="empty-state">No matching profiles found.</div>
    `;
    return;
  }

  directoryResults.innerHTML = filteredProfiles
    .map(profile => renderDirectoryProfile(profile))
    .join("");
}

async function loadDirectory() {
  directoryResults.innerHTML = `
    <div class="empty-state">Loading Sangat Works profiles...</div>
  `;

  try {
    const usersRef = collection(db, "users");
    const publicUsersQuery = query(usersRef, where("isPublic", "==", true));
    const snapshot = await getDocs(publicUsersQuery);

    allProfiles = [];

    snapshot.forEach(docSnap => {
      allProfiles.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    if (allProfiles.length === 0) {
      directoryResults.innerHTML = `
        <div class="empty-state">
          No public profiles yet. Be the first to join Sangat Works.
        </div>
      `;
      return;
    }

    filterProfiles();
  } catch (error) {
    directoryResults.innerHTML = `
      <div class="empty-state">
        Error loading profiles: ${error.message}
      </div>
    `;
  }
}

if (searchBtn) {
  searchBtn.addEventListener("click", filterProfiles);
}

if (searchInput) {
  searchInput.addEventListener("keyup", filterProfiles);
}

loadDirectory();