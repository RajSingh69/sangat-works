import { db } from "./firebase.js";
import { protectPage } from "./subscription-guard.js";

import {
  collection,
  getDocs,
  query,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const mapElement = document.getElementById("map");
const mapSearchInput = document.getElementById("mapSearchInput");
const mapSearchBtn = document.getElementById("mapSearchBtn");
const serviceFilter = document.getElementById("serviceFilter");
const townFilter = document.getElementById("townFilter");
const gurdwaraFilter = document.getElementById("gurdwaraFilter");
const featuredOnlyFilter = document.getElementById("featuredOnlyFilter");
const mapResetBtn = document.getElementById("mapResetBtn");
const mapResultsCount = document.getElementById("mapResultsCount");

let map;
let allProfiles = [];
let markers = [];

const townCoordinates = {
  woking: [51.319, -0.558],
  london: [51.5072, -0.1276],
  southall: [51.5111, -0.3756],
  slough: [51.5105, -0.595],
  birmingham: [52.4862, -1.8904],
  leicester: [52.6369, -1.1398],
  wolverhampton: [52.5862, -2.1287],
  manchester: [53.4808, -2.2426],
  leeds: [53.8008, -1.5491],
  glasgow: [55.8642, -4.2518],
  coventry: [52.4068, -1.5197],
  reading: [51.4543, -0.9781],
  gravesend: [51.4419, 0.3708],
  nottingham: [52.9548, -1.1581],
  derby: [52.9225, -1.4746],
  luton: [51.8787, -0.42],
  bradford: [53.795, -1.7594],
  huddersfield: [53.6458, -1.785],
  smethwick: [52.496, -1.973],
  camberley: [51.3402, -0.7426],
  frimley: [51.3167, -0.7454],
  bisley: [51.3262, -0.631],
  "west end": [51.343, -0.636],
  guildford: [51.2362, -0.5704],
  farnborough: [51.2869, -0.7526],
  aldershot: [51.2482, -0.7639],
  feltham: [51.4462, -0.4139],
  hounslow: [51.47, -0.361],
  hayes: [51.5129, -0.4211],
  uxbridge: [51.5463, -0.4796],
  ilford: [51.5577, 0.0728],
  romford: [51.5775, 0.1786],
  croydon: [51.3762, -0.0982],
  watford: [51.6565, -0.3903],
  swindon: [51.5558, -1.7797],
  oxford: [51.752, -1.2577],
  bristol: [51.4545, -2.5879],
  cardiff: [51.4816, -3.1791],
  newcastle: [54.9783, -1.6178],
  edinburgh: [55.9533, -3.1883]
};

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function titleCase(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, char => char.toUpperCase());
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

function isFeatured(profile) {
  if (!profile) return false;
  if (profile.featuredListing !== true) return false;
  if (profile.featuredListingStatus !== "active") return false;

  const expiryDate = timestampToDate(profile.featuredExpiresAt);

  if (!expiryDate) return false;

  return expiryDate > new Date();
}

function isPaidMapProfile(profile) {
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


function createMarkerIcon(profile) {
  const featured = isFeatured(profile);

  return L.divIcon({
    className: "",
    html: featured
      ? '<div class="featured-marker"></div>'
      : '<div class="standard-marker"></div>',
    iconSize: featured ? [24, 24] : [18, 18],
    iconAnchor: featured ? [12, 12] : [9, 9]
  });
}



function getTownCoords(town) {
  if (!town) return null;

  const key = normalize(town);

  if (townCoordinates[key]) {
    return townCoordinates[key];
  }

  return null;
}

function clearMarkers() {
  markers.forEach(marker => marker.remove());
  markers = [];
}

function getProfileService(profile) {
  return (
    profile.serviceTitle ||
    profile.primaryService ||
    profile.businessType ||
    profile.category ||
    ""
  );
}

function getProfileTown(profile) {
  return profile.town || profile.serviceAreaTown || "";
}

function getProfileGurdwara(profile) {
  return (
    profile.associatedGurdwara ||
    profile.gurdwaraName ||
    profile.gurdwara ||
    profile.organisation ||
    profile.affiliation ||
    ""
  );
}

function getRating(profile) {
  const rating =
    profile.ratingAverage ??
    profile.averageRating ??
    profile.reviewAverage ??
    profile.rating ??
    null;

  const count =
    profile.reviewCount ??
    profile.totalReviews ??
    profile.reviewsCount ??
    0;

  return {
    rating: Number(rating || 0),
    count: Number(count || 0)
  };
}

function getVerificationBadges(profile) {
  const badges = [];

  if (profile.emailVerified || profile.isEmailVerified) {
    badges.push("Email verified");
  }

  if (profile.isVerified || profile.communityVerified || profile.isCommunityVerified) {
    badges.push("Community verified");
  }

  if (profile.businessVerified || profile.isBusinessVerified) {
    badges.push("Business verified");
  }

  if (profile.gurdwaraVerified || profile.isGurdwaraVerified) {
    badges.push("Gurdwara verified");
  }

  return badges;
}

function getSearchableText(profile) {
  return `
    ${profile.fullName || ""}
    ${profile.businessName || ""}
    ${getProfileService(profile)}
    ${profile.description || ""}
    ${profile.whyContact || ""}
    ${profile.specialistWork || ""}
    ${getProfileGurdwara(profile)}
    ${profile.serviceArea || ""}
    ${(profile.tags || []).join(" ")}
    ${getProfileTown(profile)}
  `.toLowerCase();
}

function profileMatchesFilters(profile) {
  const searchText = normalize(mapSearchInput?.value);
  const selectedService = normalize(serviceFilter?.value);
  const selectedTown = normalize(townFilter?.value);
  const selectedGurdwara = normalize(gurdwaraFilter?.value);
  const featuredOnly = Boolean(featuredOnlyFilter?.checked);

  const profileService = normalize(getProfileService(profile));
  const profileTown = normalize(getProfileTown(profile));
  const profileGurdwara = normalize(getProfileGurdwara(profile));

  if (searchText && !getSearchableText(profile).includes(searchText)) {
    return false;
  }

  if (selectedService && profileService !== selectedService) {
    return false;
  }

  if (selectedTown && profileTown !== selectedTown) {
    return false;
  }

  if (selectedGurdwara && profileGurdwara !== selectedGurdwara) {
    return false;
  }

  if (featuredOnly && !isFeatured(profile)) {
    return false;
  }

  return true;
}

function createImageHtml(profile) {
  const profilePhotoUrl = profile.profilePhotoUrl || profile.photoUrl || "";
  const businessLogoUrl = profile.businessLogoUrl || profile.logoUrl || "";

  if (!profilePhotoUrl && !businessLogoUrl) {
    return "";
  }

  return `
    <div class="map-popup-top">
      ${
        profilePhotoUrl
          ? `<img src="${escapeHtml(profilePhotoUrl)}" class="map-popup-photo" alt="Profile photo">`
          : ""
      }
      ${
        businessLogoUrl
          ? `<img src="${escapeHtml(businessLogoUrl)}" class="map-popup-logo" alt="Business logo">`
          : ""
      }
    </div>
  `;
}

function createRatingHtml(profile) {
  const { rating, count } = getRating(profile);

  if (!rating || rating <= 0) {
    return `<div class="map-popup-rating">No reviews yet</div>`;
  }

  const roundedRating = Math.round(rating * 10) / 10;
  const fullStars = Math.max(1, Math.min(5, Math.round(rating)));
  const stars = "★".repeat(fullStars) + "☆".repeat(5 - fullStars);

  return `
    <div class="map-popup-rating">
      <span class="map-popup-stars">${stars}</span><br>
      ${roundedRating}/5 ${count ? `(${count} review${count === 1 ? "" : "s"})` : ""}
    </div>
  `;
}

function createBadgesHtml(profile) {
  const badges = getVerificationBadges(profile);

  if (isFeatured(profile)) {
    badges.unshift("Featured");
  }

  if (!badges.length) {
    return "";
  }

  return `
    <div class="map-popup-badges">
      ${badges.map(badge => `
        <span class="map-popup-badge ${badge === "Featured" ? "map-popup-featured" : ""}">
          ${escapeHtml(badge)}
        </span>
      `).join("")}
    </div>
  `;
}

function createPopup(profile) {
  const name = profile.businessName || profile.fullName || "Sangat Member";
  const service = getProfileService(profile);
  const town = getProfileTown(profile);
  const gurdwara = getProfileGurdwara(profile);

  const discountText = {
    yes: "Community rates available",
    sometimes: "May offer community rates",
    no: "Fair pricing supporter",
    "not-specified": ""
  };

  return `
    <div class="map-popup">
      ${createImageHtml(profile)}

      <h3>${escapeHtml(name)}</h3>

      ${
        service
          ? `<p class="map-popup-service">${escapeHtml(service)}</p>`
          : ""
      }

      ${createRatingHtml(profile)}
      ${createBadgesHtml(profile)}

      <div class="map-popup-meta">
        <div><strong>Town:</strong> ${escapeHtml(town || "Not provided")}</div>

        ${
          gurdwara
            ? `<div><strong>Gurdwara:</strong> ${escapeHtml(gurdwara)}</div>`
            : ""
        }

        ${
          profile.yearsExperience
            ? `<div><strong>Experience:</strong> ${escapeHtml(profile.yearsExperience)} years</div>`
            : ""
        }

        ${
          profile.communityDiscount && discountText[profile.communityDiscount]
            ? `<div><strong>Community:</strong> ${escapeHtml(discountText[profile.communityDiscount])}</div>`
            : ""
        }
      </div>

      <a href="view.html?id=${encodeURIComponent(profile.uid || profile.id)}" class="map-popup-link">
        View Profile
      </a>
    </div>
  `;
}

function getMarkerCoords(profile, index) {
  const town = getProfileTown(profile);
  const coords = getTownCoords(town);

  if (!coords) return null;

  const offset = (index % 8) * 0.002;

  return [
    coords[0] + offset,
    coords[1] + offset
  ];
}

function updateResultsCount(filteredCount, mappedCount) {
  if (!mapResultsCount) return;

  if (!allProfiles.length) {
    mapResultsCount.textContent = "No public members found yet.";
    return;
  }

  if (!filteredCount) {
    mapResultsCount.textContent = "No members match these filters.";
    return;
  }

  if (!mappedCount) {
    mapResultsCount.textContent = `${filteredCount} member${filteredCount === 1 ? "" : "s"} found, but none have a supported town for map placement yet.`;
    return;
  }

  mapResultsCount.textContent = `${mappedCount} member${mappedCount === 1 ? "" : "s"} shown on the map.`;
}

function renderMarkers() {
  if (!map) return;

  clearMarkers();

  const filteredProfiles = allProfiles
    .filter(profileMatchesFilters)
    .sort((a, b) => Number(isFeatured(b)) - Number(isFeatured(a)));

  const bounds = [];

  filteredProfiles.forEach((profile, index) => {
    const coords = getMarkerCoords(profile, index);

    if (!coords) return;

    const marker = L.marker(coords, {
      title: profile.businessName || profile.fullName || "",
      icon: createMarkerIcon(profile)
    })
      .addTo(map)
      .bindPopup(createPopup(profile));

    markers.push(marker);
    bounds.push(coords);
  });

  updateResultsCount(filteredProfiles.length, bounds.length);

  if (bounds.length > 0) {
    map.fitBounds(bounds, {
      padding: [45, 45],
      maxZoom: 10
    });
  } else {
    map.setView([54.5, -3.2], 6);
  }
}

function setSelectOptions(selectElement, values, defaultLabel) {
  if (!selectElement) return;

  const currentValue = selectElement.value;

  selectElement.innerHTML = `
    <option value="">${defaultLabel}</option>
    ${values.map(value => `
      <option value="${escapeHtml(value)}">${escapeHtml(titleCase(value))}</option>
    `).join("")}
  `;

  selectElement.value = currentValue;
}

function populateFilters() {
  const services = new Set();
  const towns = new Set();
  const gurdwaras = new Set();

  allProfiles.forEach(profile => {
    const service = getProfileService(profile);
    const town = getProfileTown(profile);
    const gurdwara = getProfileGurdwara(profile);

    if (service) services.add(service.trim());
    if (town) towns.add(town.trim());
    if (gurdwara) gurdwaras.add(gurdwara.trim());
  });

  setSelectOptions(
    serviceFilter,
    [...services].sort((a, b) => a.localeCompare(b)),
    "All services"
  );

  setSelectOptions(
    townFilter,
    [...towns].sort((a, b) => a.localeCompare(b)),
    "All towns"
  );

  setSelectOptions(
    gurdwaraFilter,
    [...gurdwaras].sort((a, b) => a.localeCompare(b)),
    "All Gurdwaras"
  );
}

async function loadMapProfiles() {
  const usersRef = collection(db, "users");
  const publicUsersQuery = query(usersRef, where("isPublic", "==", true));
  const snapshot = await getDocs(publicUsersQuery);

  allProfiles = [];

  snapshot.forEach(docSnap => {
    const data = docSnap.data();

    const profile = {
      id: docSnap.id,
      uid: data.uid || docSnap.id,
      ...data
    };

    if (isPaidMapProfile(profile)) {
      allProfiles.push(profile);
    }
  });

  populateFilters();
  renderMarkers();
}

function resetFilters() {
  if (mapSearchInput) mapSearchInput.value = "";
  if (serviceFilter) serviceFilter.value = "";
  if (townFilter) townFilter.value = "";
  if (gurdwaraFilter) gurdwaraFilter.value = "";
  if (featuredOnlyFilter) featuredOnlyFilter.checked = false;

  renderMarkers();
}

function attachFilterListeners() {
  if (mapSearchBtn) {
    mapSearchBtn.addEventListener("click", renderMarkers);
  }

  if (mapSearchInput) {
    mapSearchInput.addEventListener("keyup", renderMarkers);
  }

  if (serviceFilter) {
    serviceFilter.addEventListener("change", renderMarkers);
  }

  if (townFilter) {
    townFilter.addEventListener("change", renderMarkers);
  }

  if (gurdwaraFilter) {
    gurdwaraFilter.addEventListener("change", renderMarkers);
  }

  if (featuredOnlyFilter) {
    featuredOnlyFilter.addEventListener("change", renderMarkers);
  }

  if (mapResetBtn) {
    mapResetBtn.addEventListener("click", resetFilters);
  }
}

protectPage({
  onAllowed: () => {
    if (!mapElement) return;

    map = L.map("map").setView([54.5, -3.2], 6);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(map);

    attachFilterListeners();
    loadMapProfiles();
  }
});
