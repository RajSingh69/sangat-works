import { auth, db } from "./firebase.js";
import { protectPage } from "./subscription-guard.js";
import { openConversationWithUser, sendConnectionRequest } from "./member-network.js";
import { compareByRanking } from "./ranking.js";
import { getIndustryBucket, isListedInDirectory } from "./industries.js";
import { renderCardMedia, renderMemberCard } from "./directory-card.js";
import { adjustMemberPhoto } from "./photo-framer.js";
import { isSuperAdmin } from "./roles.js";

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
const directoryFilterToggle = document.getElementById("directoryFilterToggle");
const directoryFilterClose = document.getElementById("directoryFilterClose");
const directoryFiltersPanel = document.getElementById("directoryFiltersPanel");
const directoryFilterBackdrop = document.getElementById("directoryFilterBackdrop");
const directoryFilterCount = document.getElementById("directoryFilterCount");
const directoryActiveFilters = document.getElementById("directoryActiveFilters");
const directoryHeroStats = document.getElementById("directoryHeroStats");
const directoryMembersTitle = document.getElementById("directoryMembersTitle");
const directoryGridView = document.getElementById("directoryGridView");
const directoryListView = document.getElementById("directoryListView");
const directoryIndustryTabs = document.getElementById("directoryIndustryTabs");
const directoryFanStage = document.getElementById("directoryFanStage");
const directoryFanPrev = document.getElementById("directoryFanPrev");
const directoryFanNext = document.getElementById("directoryFanNext");
const directoryFanPosition = document.getElementById("directoryFanPosition");

let allProfiles = [];
let currentUser = null;
let canAdjustPhotos = false;
// The homepage industry tiles link here with ?industry=Technology etc.
let activeIndustry = new URLSearchParams(window.location.search).get("industry") || "All";
let fanIndex = 0;
let fanProfiles = [];
let touchStartX = 0;
let directoryDataLoaded = false;
let fanRenderMode = "initial";
let hasRenderedFanMembers = false;
let directoryViewMode = "grid";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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

function getActiveFilterItems() {
  const items = [];
  if (cleanValue(locationFilter?.value)) items.push({ label: "Location", value: locationFilter.value });
  if (cleanValue(gurdwaraFilter?.value)) items.push({ label: "Gurdwara", value: gurdwaraFilter.value });
  if (cleanValue(serviceFilter?.value)) items.push({ label: "Service", value: serviceFilter.value });
  if (featuredFilter?.checked === true) items.push({ label: "Featured", value: "Only" });
  return items;
}

function renderActiveFilterState() {
  const items = getActiveFilterItems();
  if (directoryFilterCount) {
    directoryFilterCount.textContent = String(items.length);
    directoryFilterCount.hidden = items.length === 0;
  }
  if (directoryActiveFilters) {
    directoryActiveFilters.innerHTML = items.length
      ? items.map(item => `<span>${escapeHtml(item.label)}: ${escapeHtml(item.value)}</span>`).join("")
      : "";
  }
}

function setFilterDrawer(open) {
  document.body.classList.toggle("directory-filters-open", open);
  directoryFilterToggle?.setAttribute("aria-expanded", String(open));
  if (directoryFilterBackdrop) directoryFilterBackdrop.hidden = !open;
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

function getProfileUrl(profile) {
  return `view.html?id=${encodeURIComponent(profile.uid || profile.id || "")}`;
}

function getIdentity(profile) {
  return profile.businessName || profile.fullName || "Unnamed Profile";
}

function getPersonName(profile) {
  return profile.businessName && profile.fullName ? profile.fullName : "";
}


function getPrimaryTrustBadge(profile) {
  if (isFeaturedActive(profile)) return { label: "Featured", className: "is-featured" };
  if (profile.isFoundingMember === true) return { label: "Founding Member", className: "is-founding" };
  if (profile.businessVerified === true || profile.isBusinessVerified === true) return { label: "Business Verified", className: "is-verified" };
  if (profile.gurdwaraVerified === true || profile.isGurdwaraVerified === true) return { label: "Gurdwara Verified", className: "is-verified" };
  return null;
}

function renderDirectoryStats(groups = getIndustryGroups(allProfiles)) {
  if (!directoryHeroStats) return;
  const industryCount = [...groups.values()].filter((profiles) => profiles.length > 0).length;
  const locationCount = new Set(allProfiles.map((profile) => cleanValue(profile.town)).filter(Boolean)).size;
  directoryHeroStats.innerHTML = `
    <div><span aria-hidden="true">M</span><strong>${allProfiles.length}</strong><small>Members</small></div>
    <div><span aria-hidden="true">I</span><strong>${industryCount}</strong><small>Industries</small></div>
    <div><span aria-hidden="true">UK</span><strong>${locationCount}</strong><small>UK Locations</small></div>
    <div><span aria-hidden="true">+</span><strong>Growing</strong><small>Every week</small></div>
  `;
}

function setDirectoryViewMode(mode) {
  directoryViewMode = mode === "list" ? "list" : "grid";
  directoryResults?.classList.toggle("is-list-view", directoryViewMode === "list");
  directoryGridView?.classList.toggle("is-active", directoryViewMode === "grid");
  directoryListView?.classList.toggle("is-active", directoryViewMode === "list");
  directoryGridView?.setAttribute("aria-pressed", String(directoryViewMode === "grid"));
  directoryListView?.setAttribute("aria-pressed", String(directoryViewMode === "list"));
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
    const service = getProfileService(profile);
    const industry = getIndustryBucket(profile);
    const tag = (Array.isArray(profile.tags) && profile.tags[0]) || (industry !== "Other" ? industry : "");
    const profileUrl = getProfileUrl(profile);
    const trustBadge = getPrimaryTrustBadge(profile);
    return `
      <article class="directory-fan-card ${fanSlotClass(offset)}" style="--fan-offset: ${offset}; --fan-stagger: ${renderIndex};" data-profile-url="${profileUrl}" tabindex="0" aria-label="Open ${escapeHtml(identity)} profile">
        <div class="directory-fan-image">
          ${renderCardMedia(profile)}
        </div>
        <div class="directory-fan-copy">
          ${tag ? `<small>${escapeHtml(tag)}</small>` : ""}
          <h3>${escapeHtml(identity)}</h3>
          ${getPersonName(profile) ? `<p>${escapeHtml(getPersonName(profile))}</p>` : ""}
          ${service ? `<strong>${escapeHtml(service)}</strong>` : ""}
          ${profile.town ? `<span>${escapeHtml(profile.town)}</span>` : ""}
          ${trustBadge ? `<em class="${trustBadge.className}">${escapeHtml(trustBadge.label)}</em>` : ""}
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
  if (directoryDataLoaded && activeIndustry !== "All" && !groups.has(activeIndustry)) activeIndustry = "All";
  renderIndustryTabs(groups);
  renderDirectoryStats(groups);
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
    if (directoryDataLoaded) filterProfiles();
  };

  if (reducedMotion || !directoryFanStage || !fanProfiles.length) {
    applyChange();
    return;
  }

  directoryFanStage.classList.add("is-switching");
  window.setTimeout(applyChange, 180);
}
function renderDirectoryProfile(profile) {
  return renderMemberCard(profile, { industry: getIndustryBucket(profile), canAdjustPhoto: canAdjustPhotos });
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
    const matchesIndustry = activeIndustry === "All" || getIndustryBucket(profile) === activeIndustry;

    return (
      matchesSearch &&
      matchesLocation &&
      matchesGurdwara &&
      matchesService &&
      matchesFeatured &&
      matchesIndustry
    );
  });

  const sortValue = sortBy?.value || "featured";

  const now = new Date();

  filteredProfiles.sort((a, b) => {
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

    // Default "featured" option: pinned, then ranking score (featured listings score highest).
    return compareByRanking(a, b, now);
  });

  renderActiveFilterState();

  if (directoryMembersTitle) {
    directoryMembersTitle.textContent = `${filteredProfiles.length} Member${filteredProfiles.length === 1 ? "" : "s"}`;
  }

  if (directoryCount) {
    directoryCount.textContent = "Sikh businesses, tradespeople and professionals.";
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
    const usersRef = collection(db, "publicProfiles");
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

      if (isListedInDirectory(profile)) {
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

directoryGridView?.addEventListener("click", () => setDirectoryViewMode("grid"));
directoryListView?.addEventListener("click", () => setDirectoryViewMode("list"));

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
  setFilterDrawer(false);
  document.querySelectorAll(".expandable-profile-card.is-expanded").forEach(collapseExpandableCard);
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  const card = event.target.closest(".member-card[data-profile-url]");
  if (card?.dataset.profileUrl && event.target === card) {
    window.location.href = card.dataset.profileUrl;
  }
});

// Super admins only (the button is only rendered for them, and Firestore rules
// reject cardPhoto writes from anyone else).
function openCardPhotoFramer(profileId) {
  const profile = allProfiles.find(item => (item.uid || item.id) === profileId);
  if (!profile || !canAdjustPhotos) return;

  adjustMemberPhoto({ ...profile, uid: profileId }, (framing) => {
    profile.cardPhoto = framing;
    filterProfiles();
    renderFanCarousel();
  });
}

document.addEventListener("click", async (event) => {
  const toggle = event.target.closest("[data-expand-card]");
  if (toggle) {
    event.stopPropagation();
    toggleExpandableCard(toggle);
    return;
  }

  const adjustPhoto = event.target.closest("[data-adjust-photo-id]");
  if (adjustPhoto) {
    event.stopPropagation();
    openCardPhotoFramer(adjustPhoto.dataset.adjustPhotoId);
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
      const connectLabel = connect.querySelector("span");
      if (connectLabel) connectLabel.textContent = "Requested";
      else connect.textContent = "Requested";
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

  const directoryCard = event.target.closest(".member-card[data-profile-url]");
  if (directoryCard?.dataset.profileUrl) {
    window.location.href = directoryCard.dataset.profileUrl;
  }
});
protectPage({
  onAllowed: (user, userData) => {
    currentUser = user;
    canAdjustPhotos = isSuperAdmin(userData);
    loadDirectory();
  }
});




