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
const directoryIndustryTabs = document.getElementById("directoryIndustryTabs");
const directoryFanStage = document.getElementById("directoryFanStage");
const directoryFanPrev = document.getElementById("directoryFanPrev");
const directoryFanNext = document.getElementById("directoryFanNext");
const directoryFanPosition = document.getElementById("directoryFanPosition");

let allProfiles = [];
let currentUser = null;
let activeIndustry = "All";
let fanIndex = 0;
let fanProfiles = [];
let touchStartX = 0;
let directoryDataLoaded = false;
let fanRenderMode = "initial";
let hasRenderedFanMembers = false;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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


const INDUSTRY_BUCKETS = [
  { name: "Technology", keywords: ["software", "developer", "web", "data", "ai", "cyber", "cloud", "it", "digital", "engineer", "technical"] },
  { name: "Trades", keywords: ["electrician", "builder", "plumber", "carpenter", "decorator", "construction", "trade", "heating", "labour", "roof", "joiner"] },
  { name: "Property", keywords: ["property", "estate", "mortgage", "letting", "landlord", "survey", "architect", "planning", "development"] },
  { name: "Law & Professional Services", keywords: ["law", "legal", "solicitor", "accountant", "consultant", "insurance", "advisor", "adviser", "compliance"] },
  { name: "Business & Finance", keywords: ["business", "finance", "bookkeeping", "tax", "marketing", "sales", "operations", "startup", "strategy"] },
  { name: "Healthcare", keywords: ["doctor", "health", "dentist", "pharmacy", "pharmacist", "therapy", "physio", "mental", "wellbeing", "care"] },
  { name: "Education", keywords: ["teacher", "tutor", "education", "training", "coach", "mentor", "school", "learning"] },
  { name: "Creative & Media", keywords: ["design", "designer", "media", "photo", "video", "creative", "brand", "content", "music", "film"] },
  { name: "Community", keywords: ["charity", "community", "seva", "gurdwara", "nonprofit", "volunteer"] }
];

function getProfileUrl(profile) {
  return `view.html?id=${encodeURIComponent(profile.uid || profile.id || "")}`;
}

function getIdentity(profile) {
  return profile.businessName || profile.fullName || "Unnamed Profile";
}

function getPersonName(profile) {
  return profile.businessName && profile.fullName ? profile.fullName : "";
}

function getProfileImageUrl(profile) {
  return profile.profilePhotoUrl || profile.businessLogoUrl || profile.logoUrl || "";
}

function getCategorySource(profile) {
  return [
    profile.serviceTitle,
    profile.businessType,
    profile.category,
    profile.profession,
    profile.role,
    profile.businessCategory,
    ...(Array.isArray(profile.tags) ? profile.tags : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

function getIndustryBucket(profile) {
  const source = getCategorySource(profile);
  const match = INDUSTRY_BUCKETS.find(bucket => bucket.keywords.some(keyword => source.includes(keyword)));
  return match?.name || "Other";
}

function getIndustryGroups(profiles) {
  const groups = new Map();
  profiles.forEach(profile => {
    const bucket = getIndustryBucket(profile);
    if (!groups.has(bucket)) groups.set(bucket, []);
    groups.get(bucket).push(profile);
  });
  return groups;
}

function renderIndustryTabs(groups) {
  if (!directoryIndustryTabs) return;
  if (!allProfiles.length) {
    directoryIndustryTabs.innerHTML = "";
    return;
  }
  const tabs = [{ name: "All", count: allProfiles.length }, ...[...groups.entries()].map(([name, profiles]) => ({ name, count: profiles.length }))];
  directoryIndustryTabs.innerHTML = tabs.map(tab => `
    <button type="button" class="directory-industry-tab${tab.name === activeIndustry ? " is-active" : ""}" role="tab" aria-selected="${tab.name === activeIndustry}" data-industry="${escapeHtml(tab.name)}">
      <span>${escapeHtml(tab.name)}</span>
      <small>${tab.count}</small>
    </button>
  `).join("");
}

function getVisibleFanProfiles() {
  if (activeIndustry === "All") return allProfiles;
  return allProfiles.filter(profile => getIndustryBucket(profile) === activeIndustry);
}

function fanSlotClass(offset) {
  if (offset === 0) return "is-center";
  if (offset === -1) return "is-left-one";
  if (offset === 1) return "is-right-one";
  if (offset === -2) return "is-left-two";
  if (offset === 2) return "is-right-two";
  if (offset === -3) return "is-left-three";
  return "is-right-three";
}

function setFanControlsState(count) {
  const hasMembers = count > 0;
  const canCycle = count > 1;
  [directoryFanPrev, directoryFanNext, directoryFanPosition].forEach((control) => {
    if (!control) return;
    control.classList.toggle("is-visible", hasMembers);
    if (hasMembers) {
      control.hidden = false;
    } else {
      window.setTimeout(() => {
        if (!control.classList.contains("is-visible")) control.hidden = true;
      }, reducedMotion ? 0 : 180);
    }
  });
  if (directoryFanPrev) directoryFanPrev.disabled = !canCycle;
  if (directoryFanNext) directoryFanNext.disabled = !canCycle;
}

function renderFanCarousel() {
  if (!directoryFanStage) return;
  fanProfiles = getVisibleFanProfiles();
  if (!directoryDataLoaded) {
    directoryFanStage.classList.remove("is-ready", "is-cycling-next", "is-cycling-prev", "is-switching");
    directoryFanStage.innerHTML = `<div class="directory-fan-empty is-loading">Loading members...</div>`;
    setFanControlsState(0);
    return;
  }

  if (!fanProfiles.length) {
    directoryFanStage.classList.remove("is-ready", "is-cycling-next", "is-cycling-prev", "is-switching");
    hasRenderedFanMembers = false;
    directoryFanStage.innerHTML = `<div class="directory-fan-empty">No members in this category yet.</div>`;
    if (directoryFanPosition) directoryFanPosition.textContent = "";
    setFanControlsState(0);
    return;
  }

  fanIndex = ((fanIndex % fanProfiles.length) + fanProfiles.length) % fanProfiles.length;
  const visibleCount = Math.min(7, fanProfiles.length);
  const half = Math.floor(visibleCount / 2);
  const offsets = Array.from({ length: visibleCount }, (_, index) => index - half);

  const stageMode = hasRenderedFanMembers ? fanRenderMode : "initial";
  directoryFanStage.classList.remove("is-cycle-next", "is-cycle-prev", "is-category", "is-initial", "is-switching", "is-settled");
  directoryFanStage.classList.add("is-ready", `is-${stageMode}`);
  requestAnimationFrame(() => directoryFanStage.classList.add("is-settled"));

  directoryFanStage.innerHTML = offsets.map((offset, renderIndex) => {
    const profile = fanProfiles[(fanIndex + offset + fanProfiles.length) % fanProfiles.length];
    const identity = getIdentity(profile);
    const imageUrl = getProfileImageUrl(profile);
    const service = getProfileService(profile) || "Member service";
    const tag = (Array.isArray(profile.tags) && profile.tags[0]) || getIndustryBucket(profile);
    const profileUrl = getProfileUrl(profile);
    const trust = isFeaturedActive(profile)
      ? "Featured"
      : (profile.businessVerified || profile.isBusinessVerified ? "Verified" : "");
    return `
      <article class="directory-fan-card ${fanSlotClass(offset)}" style="--fan-offset: ${offset}; --fan-stagger: ${renderIndex};" data-profile-url="${profileUrl}" tabindex="0" aria-label="Open ${escapeHtml(identity)} profile">
        <div class="directory-fan-image">
          ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(identity)}">` : `<span>${escapeHtml(identity.slice(0, 1))}</span>`}
        </div>
        <div class="directory-fan-copy">
          <small>${escapeHtml(tag)}</small>
          <h3>${escapeHtml(identity)}</h3>
          ${getPersonName(profile) ? `<p>${escapeHtml(getPersonName(profile))}</p>` : ""}
          <strong>${escapeHtml(service)}</strong>
          <span>${escapeHtml(profile.town || "UK network")}</span>
          ${trust ? `<em>${escapeHtml(trust)}</em>` : ""}
        </div>
      </article>
    `;
  }).join("");

  if (directoryFanPosition) directoryFanPosition.textContent = `${fanIndex + 1} / ${fanProfiles.length}`;
  setFanControlsState(fanProfiles.length);
  hasRenderedFanMembers = true;
  fanRenderMode = "cycle-next";
  window.setTimeout(() => {
    directoryFanStage?.classList.remove("is-initial", "is-cycle-next", "is-cycle-prev", "is-category");
  }, reducedMotion ? 0 : 720);
}

function renderDirectoryDiscovery() {
  const groups = getIndustryGroups(allProfiles);
  if (activeIndustry !== "All" && !groups.has(activeIndustry)) activeIndustry = "All";
  renderIndustryTabs(groups);
  renderFanCarousel();
}

function cycleFan(direction) {
  if (!fanProfiles.length) return;
  fanRenderMode = direction > 0 ? "cycle-next" : "cycle-prev";
  fanIndex = (fanIndex + direction + fanProfiles.length) % fanProfiles.length;
  renderFanCarousel();
}

function changeIndustry(nextIndustry) {
  if (activeIndustry === nextIndustry) return;
  const applyChange = () => {
    activeIndustry = nextIndustry;
    fanIndex = 0;
    fanRenderMode = "category";
    hasRenderedFanMembers = false;
    renderDirectoryDiscovery();
  };

  if (reducedMotion || !directoryFanStage || !fanProfiles.length) {
    applyChange();
    return;
  }

  directoryFanStage.classList.add("is-switching");
  window.setTimeout(applyChange, 180);
}
function renderDirectoryProfile(profile) {
  const tags = Array.isArray(profile.tags) ? profile.tags : [];
  const visibleTags = tags.slice(0, 2);
  const tagsHtml = visibleTags
    .map(tag => `<span class="tag">${escapeHtml(tag)}</span>`)
    .join("");

  const featuredBadge = isFeaturedActive(profile)
    ? `<span class="trust-badge featured-badge">Featured</span>`
    : "";

  const verifiedBadge = !featuredBadge && (profile.businessVerified === true || profile.isBusinessVerified === true)
    ? `<span class="trust-badge verified">Business Verified</span>`
    : "";

  const primaryBadge = featuredBadge || verifiedBadge;
  const rating = getRating(profile);
  const reviewCount = getReviewCount(profile);
  const badgesHtml = renderDirectoryBadges(profile);
  const rawProfileId = profile.uid || profile.id || "";
  const profileId = encodeURIComponent(rawProfileId);
  const profileUrl = `view.html?id=${profileId}`;
  const identity = profile.businessName || profile.fullName || "Unnamed Profile";
  const personName = profile.businessName && profile.fullName ? profile.fullName : "";
  const service = profile.serviceTitle || profile.businessType || "Member service";
  const websiteUrl = safeExternalUrl(profile.website);
  const linkedInUrl = safeExternalUrl(profile.linkedin);
  const reviewsUrl = safeExternalUrl(profile.googleReviews);
  const detailsId = `directory-profile-details-${profileId}`;
  const imageUrl = profile.profilePhotoUrl || profile.businessLogoUrl || profile.logoUrl || "";
  const fullTagsHtml = tags.length
    ? `<div class="tags expandable-tags">${tags.map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  const businessRows = [
    businessNameRow(profile.businessName),
    profile.serviceArea ? `<p><strong>Service area</strong><span>${escapeHtml(profile.serviceArea)}</span></p>` : "",
    profile.specialistWork ? `<p><strong>Specialist work</strong><span>${escapeHtml(profile.specialistWork)}</span></p>` : ""
  ].filter(Boolean).join("");
  const communityRows = [
    profile.associatedGurdwara && profile.showGurdwara ? `<p><strong>Gurdwara</strong><span>${escapeHtml(profile.associatedGurdwara)}</span></p>` : "",
    discountLabel(profile.communityDiscount) ? `<p><strong>Community rates</strong><span>${escapeHtml(discountLabel(profile.communityDiscount))}</span></p>` : ""
  ].filter(Boolean).join("");
  const experienceContent = profile.yearsExperience
    ? `<p>${escapeHtml(profile.yearsExperience)} years experience</p>`
    : "";
  const reviewContent = reviewCount > 0
    ? `<div class="directory-rating-row expanded-rating"><span class="directory-stars">${renderStars(rating)}</span><strong>${rating.toFixed(1)}</strong><span>${reviewCount} review${reviewCount === 1 ? "" : "s"}</span></div>`
    : "";
  const contactLinks = [
    websiteUrl ? `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener" class="secondary-link">Website</a>` : "",
    linkedInUrl ? `<a href="${escapeHtml(linkedInUrl)}" target="_blank" rel="noopener" class="secondary-link">LinkedIn</a>` : "",
    profile.showGoogleReviews && reviewsUrl ? `<a href="${escapeHtml(reviewsUrl)}" target="_blank" rel="noopener" class="secondary-link">Reviews</a>` : ""
  ].filter(Boolean).join("");
  const expandedDetails = renderExpandableDetails(detailsId, [
    { title: "About", content: profile.description ? `<p>${escapeHtml(profile.description)}</p>` : "" },
    { title: "Skills / Services", content: fullTagsHtml },
    { title: "Experience", content: experienceContent },
    { title: "Business / Organisation", content: businessRows ? `<div class="expandable-detail-list">${businessRows}</div>` : "" },
    { title: "Gurdwara / Community", content: communityRows ? `<div class="expandable-detail-list">${communityRows}</div>` : "" },
    { title: "Trust", content: badgesHtml + reviewContent },
    { title: "Contact / External Links", content: contactLinks ? `<div class="expanded-external-links">${contactLinks}</div>` : "" }
  ]);

  return `
    <article class="profile-card directory-profile-card directory-person-card expandable-profile-card theme-${escapeHtml(profile.themeColour || "gold")}" data-profile-url="${profileUrl}">
      <div class="directory-card-head">
        <div class="directory-card-visuals">
          ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" class="directory-profile-photo" alt="Profile photo">` : `<span class="directory-profile-photo placeholder-avatar">${escapeHtml(identity.slice(0, 1))}</span>`}
          ${profile.businessLogoUrl && profile.businessLogoUrl !== imageUrl ? `<img src="${escapeHtml(profile.businessLogoUrl)}" class="directory-business-logo" alt="Business logo">` : ""}
        </div>
        <div class="directory-card-identity">
          <h3>${escapeHtml(identity)}</h3>
          ${personName ? `<span class="directory-person-name">${escapeHtml(personName)}</span>` : ""}
          <p class="service">${escapeHtml(service)}</p>
          <div class="directory-meta-list compact-location">
            <span>${escapeHtml(profile.town || "Location not provided")}</span>
          </div>
        </div>
      </div>

      ${tagsHtml ? `<div class="tags compact-tags">${tagsHtml}</div>` : ""}
      ${primaryBadge ? `<div class="directory-badges-row compact-badges">${primaryBadge}</div>` : ""}

      <button type="button" class="expandable-profile-toggle" aria-expanded="false" aria-controls="${detailsId}" data-expand-card>More details</button>

      ${expandedDetails}

      <div class="card-links directory-card-actions">
        <a class="directory-primary-action" href="${profileUrl}">View Profile</a>
        <button type="button" class="btn-small" data-directory-message-id="${profileId}">Message</button>
        <button type="button" class="btn-small secondary-action" data-directory-connect-id="${profileId}">Connect</button>
        ${websiteUrl ? `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener" class="secondary-link">Website</a>` : ""}
        ${linkedInUrl ? `<a href="${escapeHtml(linkedInUrl)}" target="_blank" rel="noopener" class="secondary-link">LinkedIn</a>` : ""}
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

  directoryDataLoaded = false;
  renderDirectoryDiscovery();

  try {
    const usersRef = collection(db, "users");
    const publicUsersQuery = query(usersRef, where("isPublic", "==", true));
    const snapshot = await getDocs(publicUsersQuery);

    allProfiles = [];
    directoryDataLoaded = false;
    renderDirectoryDiscovery();

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

      directoryDataLoaded = true;
      renderDirectoryDiscovery();
      return;
    }

    directoryDataLoaded = true;
    populateFilters();
    renderDirectoryDiscovery();
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
    directoryDataLoaded = true;
    renderDirectoryDiscovery();
  }
}


if (directoryIndustryTabs) {
  directoryIndustryTabs.addEventListener("click", (event) => {
    const tab = event.target.closest("[data-industry]");
    if (!tab) return;
    changeIndustry(tab.dataset.industry);
  });
}

if (directoryFanPrev) directoryFanPrev.addEventListener("click", () => cycleFan(-1));
if (directoryFanNext) directoryFanNext.addEventListener("click", () => cycleFan(1));

if (directoryFanStage) {
  directoryFanStage.addEventListener("click", (event) => {
    const card = event.target.closest(".directory-fan-card[data-profile-url]");
    if (card?.dataset.profileUrl) window.location.href = card.dataset.profileUrl;
  });

  directoryFanStage.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      cycleFan(-1);
    }
    if (event.key === "ArrowRight") {
      event.preventDefault();
      cycleFan(1);
    }
    if (event.key === "Enter") {
      const card = event.target.closest(".directory-fan-card[data-profile-url]") || directoryFanStage.querySelector(".directory-fan-card.is-center[data-profile-url]");
      if (card?.dataset.profileUrl) window.location.href = card.dataset.profileUrl;
    }
  });

  directoryFanStage.addEventListener("touchstart", (event) => {
    touchStartX = event.touches[0]?.clientX || 0;
  }, { passive: true });

  directoryFanStage.addEventListener("touchend", (event) => {
    const endX = event.changedTouches[0]?.clientX || 0;
    const delta = endX - touchStartX;
    if (Math.abs(delta) > 42) cycleFan(delta > 0 ? -1 : 1);
  }, { passive: true });
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
  button.textContent = shouldExpand ? "Less details" : "More details";
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  document.querySelectorAll(".expandable-profile-card.is-expanded").forEach(collapseExpandableCard);
});
document.addEventListener("click", async (event) => {
  const toggle = event.target.closest("[data-expand-card]");
  if (toggle) {
    event.stopPropagation();
    toggleExpandableCard(toggle);
    return;
  }

  const interactive = event.target.closest("a, button");
  const connect = event.target.closest("[data-directory-connect-id]");
  const message = event.target.closest("[data-directory-message-id]");

  if (interactive) {
    event.stopPropagation();
  }

  try {
    if (connect) {
      await sendConnectionRequest(currentUser.uid, connect.dataset.directoryConnectId);
      connect.textContent = "Requested";
      connect.disabled = true;
      return;
    }

    if (message) {
      await openConversationWithUser(currentUser.uid, message.dataset.directoryMessageId);
      return;
    }
  } catch (error) {
    if (directoryCount) directoryCount.textContent = error.message || "Messaging is temporarily unavailable.";
    return;
  }

  if (interactive) return;

  const expandedCard = event.target.closest(".directory-person-card.is-expanded[data-profile-url]");
  if (expandedCard?.dataset.profileUrl) {
    window.location.href = expandedCard.dataset.profileUrl;
  }
});
protectPage({
  onAllowed: (user) => {
    currentUser = user;
    loadDirectory();
  }
});




