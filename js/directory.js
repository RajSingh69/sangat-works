import { db } from "./firebase.js";
import { protectPage } from "./subscription-guard.js";

import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const searchInput = document.getElementById("searchInput");
const searchBtn = document.getElementById("searchBtn");
const directoryResults = document.getElementById("directoryResults");
const directoryCount = document.getElementById("directoryCount");

const locationFilter = document.getElementById("locationFilter");
const gurdwaraFilter = document.getElementById("gurdwaraFilter");
const serviceFilter = document.getElementById("serviceFilter");
const featuredFilter = document.getElementById("featuredFilter");
const clearFiltersBtn = document.getElementById("clearFiltersBtn");

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

function cleanValue(value) {
  return (value || "").toString().trim();
}

function getProfileService(profile) {
  return cleanValue(profile.serviceTitle || profile.businessType || "");
}

function renderDirectoryProfile(profile) {
  const tags = profile.tags || [];
  const visibleTags = tags.slice(0, 6);
  const tagsHtml = visibleTags.map(tag => `<span class="tag">${tag}</span>`).join("");

  const featuredBadge = profile.featuredListing
    ? `<span class="trust-badge featured-badge">★ Featured</span>`
    : "";

  return `
    <div class="profile-card theme-${profile.themeColour || "gold"}">
      <h3>${profile.businessName || profile.fullName || "Unnamed Profile"}</h3>
      <p class="service">${profile.serviceTitle || ""}</p>

      <div class="badges-row">
        ${featuredBadge}
      </div>

      ${profile.yearsExperience ? `<p><strong>Experience:</strong> ${profile.yearsExperience} years</p>` : ""}
      <p><strong>Location:</strong> ${profile.town || "Location not provided"}</p>
      ${profile.serviceArea ? `<p><strong>Service area:</strong> ${profile.serviceArea}</p>` : ""}

      ${profile.associatedGurdwara && profile.showGurdwara ? `
        <p><strong>Sangat/Gurdwara:</strong> ${profile.associatedGurdwara}</p>
      ` : ""}

      ${discountLabel(profile.communityDiscount) ? `
        <p><strong>Community:</strong> ${discountLabel(profile.communityDiscount)}</p>
      ` : ""}

      ${profile.description ? `<p>${profile.description.substring(0, 180)}${profile.description.length > 180 ? "..." : ""}</p>` : ""}

      <div class="tags">${tagsHtml}</div>

      <div class="card-links">
        <a href="view.html?id=${profile.uid || profile.id}">View Profile</a>
        ${profile.website ? `<a href="${profile.website}" target="_blank">Website</a>` : ""}
        ${profile.linkedin ? `<a href="${profile.linkedin}" target="_blank">LinkedIn</a>` : ""}
        ${profile.showGoogleReviews && profile.googleReviews ? `<a href="${profile.googleReviews}" target="_blank">Reviews</a>` : ""}
      </div>
    </div>
  `;
}

function populateFilter(selectElement, values, defaultLabel) {
  if (!selectElement) return;

  selectElement.innerHTML = `<option value="">${defaultLabel}</option>`;

  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectElement.appendChild(option);
  });
}

function populateFilters() {
  const locations = [...new Set(
    allProfiles
      .map(profile => cleanValue(profile.town))
      .filter(Boolean)
  )].sort();

  const gurdwaras = [...new Set(
    allProfiles
      .map(profile => cleanValue(profile.associatedGurdwara || profile.gurdwaraName))
      .filter(Boolean)
  )].sort();

  const services = [...new Set(
    allProfiles
      .map(profile => getProfileService(profile))
      .filter(Boolean)
  )].sort();

  populateFilter(locationFilter, locations, "All locations");
  populateFilter(gurdwaraFilter, gurdwaras, "All Gurdwaras");
  populateFilter(serviceFilter, services, "All services");
}

function filterProfiles() {
  const queryText = cleanValue(searchInput?.value).toLowerCase();

  const selectedLocation = cleanValue(locationFilter?.value).toLowerCase();
  const selectedGurdwara = cleanValue(gurdwaraFilter?.value).toLowerCase();
  const selectedService = cleanValue(serviceFilter?.value).toLowerCase();
  const featuredOnly = featuredFilter?.checked === true;

  const filteredProfiles = allProfiles.filter(profile => {
    const searchableText = `
      ${profile.fullName || ""}
      ${profile.businessName || ""}
      ${profile.serviceTitle || ""}
      ${profile.businessType || ""}
      ${profile.description || ""}
      ${profile.whyContact || ""}
      ${profile.specialistWork || ""}
      ${profile.associatedGurdwara || ""}
      ${profile.gurdwaraName || ""}
      ${profile.serviceArea || ""}
      ${(profile.tags || []).join(" ")}
      ${profile.town || ""}
    `.toLowerCase();

    const profileLocation = cleanValue(profile.town).toLowerCase();
    const profileGurdwara = cleanValue(profile.associatedGurdwara || profile.gurdwaraName).toLowerCase();
    const profileService = getProfileService(profile).toLowerCase();

    const matchesSearch = !queryText || searchableText.includes(queryText);
    const matchesLocation = !selectedLocation || profileLocation === selectedLocation;
    const matchesGurdwara = !selectedGurdwara || profileGurdwara === selectedGurdwara;
    const matchesService = !selectedService || profileService === selectedService;
    const matchesFeatured = !featuredOnly || profile.featuredListing === true;

    return (
      matchesSearch &&
      matchesLocation &&
      matchesGurdwara &&
      matchesService &&
      matchesFeatured
    );
  });

  if (directoryCount) {
    directoryCount.textContent = `${filteredProfiles.length} profile${filteredProfiles.length === 1 ? "" : "s"} found`;
  }

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

function clearFilters() {
  if (searchInput) searchInput.value = "";
  if (locationFilter) locationFilter.value = "";
  if (gurdwaraFilter) gurdwaraFilter.value = "";
  if (serviceFilter) serviceFilter.value = "";
  if (featuredFilter) featuredFilter.checked = false;

  filterProfiles();
}

async function loadDirectory() {
  directoryResults.innerHTML = `
    <div class="empty-state">Loading Sangat Works profiles...</div>
  `;

  if (directoryCount) {
    directoryCount.textContent = "Loading profiles...";
  }

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

      if (directoryCount) {
        directoryCount.textContent = "0 profiles found";
      }

      return;
    }

    allProfiles.sort((a, b) => {
      return (b.featuredListing === true) - (a.featuredListing === true);
    });

    populateFilters();
    filterProfiles();

  } catch (error) {
    directoryResults.innerHTML = `
      <div class="empty-state">
        Error loading profiles: ${error.message}
      </div>
    `;

    if (directoryCount) {
      directoryCount.textContent = "Could not load profiles";
    }
  }
}

if (searchBtn) {
  searchBtn.addEventListener("click", filterProfiles);
}

if (searchInput) {
  searchInput.addEventListener("keyup", filterProfiles);
}

if (locationFilter) {
  locationFilter.addEventListener("change", filterProfiles);
}

if (gurdwaraFilter) {
  gurdwaraFilter.addEventListener("change", filterProfiles);
}

if (serviceFilter) {
  serviceFilter.addEventListener("change", filterProfiles);
}

if (featuredFilter) {
  featuredFilter.addEventListener("change", filterProfiles);
}

if (clearFiltersBtn) {
  clearFiltersBtn.addEventListener("click", clearFilters);
}

protectPage({
  onAllowed: () => {
    loadDirectory();
  }
});