import { auth, db } from "./firebase.js";
import { protectPage } from "./subscription-guard.js";
import { openConversationWithUser, sendConnectionRequest } from "./member-network.js";

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
const sortBy = document.getElementById("sortBy");

let allProfiles = [];
let currentUser = null;

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeExternalUrl(value = "") {
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed, window.location.origin);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch (error) {
    return "";
  }
}

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

function getRating(profile) {
  const rating =
    profile.averageRating ||
    profile.ratingAverage ||
    profile.reviewAverage ||
    0;

  return Number(rating) || 0;
}

function getReviewCount(profile) {
  return Number(profile.reviewCount || profile.reviewsCount || 0);
}

function renderStars(rating) {
  if (!rating) return "☆☆☆☆☆";

  const rounded = Math.max(0, Math.min(5, Math.round(rating)));
  return "★★★★★".slice(0, rounded) + "☆☆☆☆☆".slice(0, 5 - rounded);
}

function timestampToDate(value) {
  if (!value) return null;

  if (value.toDate) {
    return value.toDate();
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function isFeaturedActive(profile) {
  if (!profile) return false;
  if (profile.featuredListing !== true) return false;
  if (profile.featuredListingStatus !== "active") return false;

  const expiryDate = timestampToDate(profile.featuredExpiresAt);

  if (!expiryDate) return false;

  return expiryDate > new Date();
}

function isPaidDirectoryProfile(profile) {
  if (!profile) return false;

  if (profile.role === "admin" || profile.role === "super_admin") {
    return true;
  }

  if (profile.accessType === "admin_granted_free_year") {
    const freeAccessExpiryDate = timestampToDate(profile.freeAccessExpiresAt);
    return Boolean(freeAccessExpiryDate && freeAccessExpiryDate > new Date());
  }

  if (profile.hasSubscription !== true) {
    return false;
  }

  if (profile.subscriptionStatus !== "active") {
    return false;
  }

  const expiryDate = timestampToDate(profile.subscriptionExpiresAt);
  return !expiryDate || expiryDate > new Date();
}

function renderDirectoryBadges(profile) {
  const badges = [];

  if (profile.isFoundingMember === true) {
    badges.push("★ Founding Member");
  }

  if (profile.emailVerified === true || profile.isEmailVerified === true) {
    badges.push("✓ Email Verified");
  }

  if (profile.businessVerified === true || profile.isBusinessVerified === true) {
    badges.push("✓ Business Verified");
  }

  if (profile.gurdwaraVerified === true || profile.isGurdwaraVerified === true) {
    badges.push("✓ Gurdwara Verified");
  }

  if (badges.length === 0) {
    return "";
  }

  return `
    <div class="directory-badges-row">
      ${badges.map(badge => `<span class="trust-badge verified">${badge}</span>`).join("")}
    </div>
  `;
}

function businessNameRow(value) {
  return value ? `<p><strong>Business</strong><span>${escapeHtml(value)}</span></p>` : "";
}

function renderExpandableDetails(detailsId, sections) {
  const visibleSections = sections.filter(section => section.content);
  if (!visibleSections.length) return "";

  return `
    <div class="expandable-profile-details" id="${detailsId}" hidden>
      ${visibleSections.map(section => `
        <section class="expandable-detail-section">
          <h4>${escapeHtml(section.title)}</h4>
          ${section.content}
        </section>
      `).join("")}
    </div>
  `;
}

function renderDirectoryProfile(profile) {
  const tags = profile.tags || [];
  const visibleTags = tags.slice(0, 5);
  const tagsHtml = visibleTags
    .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");

  const featuredBadge = isFeaturedActive(profile)
    ? `<span class="trust-badge featured-badge">Featured</span>`
    : "";

  const experienceBadge = profile.yearsExperience
    ? `<span class="trust-badge">${escapeHtml(profile.yearsExperience)} yrs experience</span>`
    : "";

  const rating = getRating(profile);
  const reviewCount = getReviewCount(profile);
  const badgesHtml = renderDirectoryBadges(profile);
  const rawProfileId = profile.uid || profile.id || "";
  const profileId = encodeURIComponent(rawProfileId);
  const identity = profile.businessName || profile.fullName || "Unnamed Profile";
  const personName = profile.businessName && profile.fullName ? profile.fullName : "";
  const service = profile.serviceTitle || profile.businessType || "Member service";
  const websiteUrl = safeExternalUrl(profile.website);
  const linkedInUrl = safeExternalUrl(profile.linkedin);
  const reviewsUrl = safeExternalUrl(profile.googleReviews);
  const description = profile.description
    ? `${profile.description.substring(0, 150)}${profile.description.length > 150 ? "..." : ""}`
    : "";
  const detailsId = `directory-profile-details-${profileId}`;
  const fullTagsHtml = tags.length
    ? `<div class="tags">${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  const detailRows = [
    businessNameRow(profile.businessName),
    profile.serviceArea ? `<p><strong>Service area</strong><span>${escapeHtml(profile.serviceArea)}</span></p>` : "",
    profile.associatedGurdwara && profile.showGurdwara ? `<p><strong>Gurdwara</strong><span>${escapeHtml(profile.associatedGurdwara)}</span></p>` : "",
    profile.yearsExperience ? `<p><strong>Experience</strong><span>${escapeHtml(profile.yearsExperience)} years</span></p>` : "",
    profile.specialistWork ? `<p><strong>Specialist work</strong><span>${escapeHtml(profile.specialistWork)}</span></p>` : ""
  ].filter(Boolean).join("");
  const expandedDetails = renderExpandableDetails(detailsId, [
    { title: "About", content: profile.description ? `<p>${escapeHtml(profile.description)}</p>` : "" },
    { title: "Skills", content: fullTagsHtml },
    { title: "Business / Organisation", content: detailRows ? `<div class="expandable-detail-list">${detailRows}</div>` : "" },
    { title: "Community", content: discountLabel(profile.communityDiscount) ? `<p>${escapeHtml(discountLabel(profile.communityDiscount))}</p>` : "" }
  ]);

  const reviewHtml = reviewCount > 0
    ? `
      <div class="directory-rating-row">
        <span class="directory-stars">${renderStars(rating)}</span>
        <strong>${rating.toFixed(1)}</strong>
        <span>${reviewCount} review${reviewCount === 1 ? "" : "s"}</span>
      </div>
    `
    : "";

  return `
    <article class="profile-card directory-profile-card directory-person-card expandable-profile-card theme-${escapeHtml(profile.themeColour || "gold")}">
      <div class="directory-card-head">
        <div class="directory-card-visuals">
          ${profile.profilePhotoUrl ? `<img src="${escapeHtml(profile.profilePhotoUrl)}" class="directory-profile-photo" alt="Profile photo">` : `<span class="directory-profile-photo placeholder-avatar">${escapeHtml(identity.slice(0, 1))}</span>`}
          ${profile.businessLogoUrl ? `<img src="${escapeHtml(profile.businessLogoUrl)}" class="directory-business-logo" alt="Business logo">` : ""}
        </div>
        <div>
          <h3>${escapeHtml(identity)}</h3>
          ${personName ? `<span class="directory-person-name">${escapeHtml(personName)}</span>` : ""}
          <p class="service">${escapeHtml(service)}</p>
        </div>
      </div>

      <div class="directory-badges-row compact-badges">
        ${featuredBadge}
        ${experienceBadge}
      </div>
      ${badgesHtml}
      ${reviewHtml}

      <div class="directory-meta-list">
        <span>${escapeHtml(profile.town || "Location not provided")}</span>
        ${profile.serviceArea ? `<span>${escapeHtml(profile.serviceArea)}</span>` : ""}
        ${profile.associatedGurdwara && profile.showGurdwara ? `<span>${escapeHtml(profile.associatedGurdwara)}</span>` : ""}
      </div>

      ${description ? `<p class="directory-description">${escapeHtml(description)}</p>` : ""}
      ${discountLabel(profile.communityDiscount) ? `<p class="directory-community-note">${escapeHtml(discountLabel(profile.communityDiscount))}</p>` : ""}

      <div class="tags">${tagsHtml}</div>

      <button type="button" class="expandable-profile-toggle" aria-expanded="false" aria-controls="${detailsId}" data-expand-card>More details</button>

      ${expandedDetails}

      <div class="card-links directory-card-actions">
        <a class="directory-primary-action" href="view.html?id=${profileId}">View Profile</a>
        <button type="button" class="btn-small" data-directory-message-id="${profileId}">Message</button>
        <button type="button" class="btn-small secondary-action" data-directory-connect-id="${profileId}">Connect</button>
        ${websiteUrl ? `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener" class="secondary-link">Website</a>` : ""}
        ${linkedInUrl ? `<a href="${escapeHtml(linkedInUrl)}" target="_blank" rel="noopener" class="secondary-link">LinkedIn</a>` : ""}
        ${profile.showGoogleReviews && reviewsUrl ? `<a href="${escapeHtml(reviewsUrl)}" target="_blank" rel="noopener" class="secondary-link">Reviews</a>` : ""}
      </div>
    </article>
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

  let filteredProfiles = allProfiles.filter(profile => {
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
    const matchesFeatured = !featuredOnly || isFeaturedActive(profile);

    return (
      matchesSearch &&
      matchesLocation &&
      matchesGurdwara &&
      matchesService &&
      matchesFeatured
    );
  });

  const sortValue = sortBy?.value || "featured";

  filteredProfiles.sort((a, b) => {
    const aFeatured = isFeaturedActive(a);
    const bFeatured = isFeaturedActive(b);

    if (sortValue === "rating") {
      return getRating(b) - getRating(a);
    }

    if (sortValue === "experience") {
      return Number(b.yearsExperience || 0) -
        Number(a.yearsExperience || 0);
    }

    if (sortValue === "newest") {
      const aTime = a.createdAt?.seconds || a.updatedAt?.seconds || 0;
      const bTime = b.createdAt?.seconds || b.updatedAt?.seconds || 0;
      return bTime - aTime;
    }

    return Number(bFeatured) - Number(aFeatured);
  });

  if (directoryCount) {
    directoryCount.textContent = `Showing ${filteredProfiles.length} Sangat member${filteredProfiles.length === 1 ? "" : "s"}`;
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
  if (sortBy) sortBy.value = "featured";

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
      const profile = {
        id: docSnap.id,
        ...docSnap.data()
      };

      if (isPaidDirectoryProfile(profile)) {
        allProfiles.push(profile);
      }
    });

    if (allProfiles.length === 0) {
      directoryResults.innerHTML = `
        <div class="empty-state">
          No public profiles yet. Be the first to join Sangat Works.
        </div>
      `;

      if (directoryCount) {
        directoryCount.textContent = "Showing 0 Sangat members";
      }

      return;
    }

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

if (sortBy) {
  sortBy.addEventListener("change", filterProfiles);
}

function collapseExpandableCard(card) {
  const button = card.querySelector("[data-expand-card]");
  const details = button ? document.getElementById(button.getAttribute("aria-controls")) : null;
  card.classList.remove("is-expanded");
  button?.setAttribute("aria-expanded", "false");
  if (button) button.textContent = "More details";
  if (details) details.hidden = true;
}

function toggleExpandableCard(button) {
  const card = button.closest(".expandable-profile-card");
  const list = button.closest(".directory-results-grid, .network-list");
  const details = document.getElementById(button.getAttribute("aria-controls"));
  if (!card || !details) return;

  const shouldExpand = button.getAttribute("aria-expanded") !== "true";
  list?.querySelectorAll(".expandable-profile-card.is-expanded").forEach((openCard) => {
    if (openCard !== card) collapseExpandableCard(openCard);
  });

  card.classList.toggle("is-expanded", shouldExpand);
  button.setAttribute("aria-expanded", String(shouldExpand));
  details.hidden = !shouldExpand;
  button.textContent = shouldExpand ? "Hide details" : "More details";
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelectorAll(".expandable-profile-card.is-expanded").forEach(collapseExpandableCard);
});
document.addEventListener("click", async (event) => {
  const toggle = event.target.closest("[data-expand-card]");
  if (toggle) {
    toggleExpandableCard(toggle);
    return;
  }

  const connect = event.target.closest("[data-directory-connect-id]");
  const message = event.target.closest("[data-directory-message-id]");

  try {
    if (connect) {
      await sendConnectionRequest(currentUser.uid, connect.dataset.directoryConnectId);
      connect.textContent = "Requested";
      connect.disabled = true;
    }

    if (message) {
      await openConversationWithUser(currentUser.uid, message.dataset.directoryMessageId);
    }
  } catch (error) {
    if (directoryCount) directoryCount.textContent = error.message || "Messaging is temporarily unavailable.";
  }
});

protectPage({
  onAllowed: (user) => {
    currentUser = user;
    loadDirectory();
  }
});




