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
  luton: [51.8787, -0.4200],
  bradford: [53.7950, -1.7594],
  huddersfield: [53.6458, -1.7850],
  smethwick: [52.4960, -1.9730]
};

function getTownCoords(town) {
  if (!town) return null;

  const key = town.trim().toLowerCase();

  if (townCoordinates[key]) {
    return townCoordinates[key];
  }

  return null;
}

function clearMarkers() {
  markers.forEach(marker => marker.remove());
  markers = [];
}

function profileMatchesSearch(profile, searchText) {
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

  return searchableText.includes(searchText);
}

function createPopup(profile) {
  const photo = profile.profilePhotoUrl
    ? `<img src="${profile.profilePhotoUrl}" class="map-popup-photo" alt="Profile photo">`
    : "";

  const logo = profile.businessLogoUrl
    ? `<img src="${profile.businessLogoUrl}" class="map-popup-logo" alt="Business logo">`
    : "";

  const discountText = {
    yes: "Community rates available",
    sometimes: "May offer community rates",
    no: "Fair pricing supporter",
    "not-specified": ""
  };

  return `
    <div class="map-popup">
      <div class="map-popup-images">
        ${photo}
        ${logo}
      </div>

      <h3>${profile.businessName || profile.fullName || "Sangat Member"}</h3>
      <p class="map-popup-service">${profile.serviceTitle || ""}</p>
      <p><strong>Town:</strong> ${profile.town || "Not provided"}</p>

      ${profile.yearsExperience ? `<p><strong>Experience:</strong> ${profile.yearsExperience} years</p>` : ""}
      ${profile.communityDiscount && discountText[profile.communityDiscount] ? `
        <p><strong>Community:</strong> ${discountText[profile.communityDiscount]}</p>
      ` : ""}

      <a href="view.html?id=${profile.uid}" class="map-popup-link">View Profile</a>
    </div>
  `;
}

function renderMarkers() {
  if (!map) return;

  clearMarkers();

  const searchText = mapSearchInput.value.toLowerCase().trim();

  const filteredProfiles = allProfiles.filter(profile => {
    return !searchText || profileMatchesSearch(profile, searchText);
  });

  const bounds = [];

  filteredProfiles.forEach(profile => {
    const coords = getTownCoords(profile.town);

    if (!coords) return;

    const marker = L.marker(coords)
      .addTo(map)
      .bindPopup(createPopup(profile));

    markers.push(marker);
    bounds.push(coords);
  });

  if (bounds.length > 0) {
    map.fitBounds(bounds, {
      padding: [40, 40],
      maxZoom: 10
    });
  }
}

async function loadMapProfiles() {
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

  renderMarkers();
}

protectPage({
  onAllowed: () => {
    if (mapElement) {
      map = L.map("map").setView([54.5, -3.2], 6);

      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: "&copy; OpenStreetMap contributors"
      }).addTo(map);

      loadMapProfiles();
    }
  }
});

if (mapSearchBtn) {
  mapSearchBtn.addEventListener("click", renderMarkers);
}

if (mapSearchInput) {
  mapSearchInput.addEventListener("keyup", renderMarkers);
}