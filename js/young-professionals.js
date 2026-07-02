import { auth, db } from "./firebase.js";
import { protectPage } from "./subscription-guard.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const ypForm = document.getElementById("ypForm");
const ypMessage = document.getElementById("ypMessage");

const ypFullName = document.getElementById("ypFullName");
const ypTown = document.getElementById("ypTown");
const ypUniversity = document.getElementById("ypUniversity");
const ypDegree = document.getElementById("ypDegree");
const ypGraduationYear = document.getElementById("ypGraduationYear");
const ypIndustry = document.getElementById("ypIndustry");
const ypSkills = document.getElementById("ypSkills");
const ypLinkedin = document.getElementById("ypLinkedin");
const ypBio = document.getElementById("ypBio");
const ypLookingForWork = document.getElementById("ypLookingForWork");
const ypOfferingMentorship = document.getElementById("ypOfferingMentorship");

const ypSearchInput = document.getElementById("ypSearchInput");
const ypIndustryFilter = document.getElementById("ypIndustryFilter");
const ypTownFilter = document.getElementById("ypTownFilter");
const ypStatusFilter = document.getElementById("ypStatusFilter");
const ypResetFiltersBtn = document.getElementById("ypResetFiltersBtn");

const ypResults = document.getElementById("ypResults");
const ypCount = document.getElementById("ypCount");

let currentUser = null;
let userMainProfile = {};
let youngProfiles = [];

function cleanValue(value) {
  return String(value || "").trim();
}

function lowerValue(value) {
  return cleanValue(value).toLowerCase();
}

function getSkillsArray(value) {
  return cleanValue(value)
    .split(",")
    .map(skill => skill.trim())
    .filter(Boolean);
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatYear(value) {
  const year = cleanValue(value);

  if (!year) return "";

  return year;
}

function fillForm(profile) {
  if (!profile) return;

  ypFullName.value =
    profile.fullName ||
    userMainProfile.fullName ||
    currentUser?.displayName ||
    "";

  ypTown.value =
    profile.town ||
    userMainProfile.town ||
    "";

  ypUniversity.value = profile.university || "";
  ypDegree.value = profile.degree || "";
  ypGraduationYear.value = profile.graduationYear || "";
  ypIndustry.value = profile.industry || "";
  ypSkills.value = (profile.skills || []).join(", ");
  ypLinkedin.value = profile.linkedin || userMainProfile.linkedin || "";
  ypBio.value = profile.bio || "";
  ypLookingForWork.checked = profile.lookingForWork === true;
  ypOfferingMentorship.checked = profile.offeringMentorship === true;
}

function populateSelect(selectElement, values, defaultLabel) {
  if (!selectElement) return;

  const currentValue = selectElement.value;

  selectElement.innerHTML = `<option value="">${defaultLabel}</option>`;

  values.forEach(value => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    selectElement.appendChild(option);
  });

  selectElement.value = currentValue;
}

function populateFilters() {
  const industries = [...new Set(
    youngProfiles
      .map(profile => cleanValue(profile.industry))
      .filter(Boolean)
  )].sort();

  const towns = [...new Set(
    youngProfiles
      .map(profile => cleanValue(profile.town))
      .filter(Boolean)
  )].sort();

  populateSelect(ypIndustryFilter, industries, "All industries");
  populateSelect(ypTownFilter, towns, "All towns");
}

function getSearchableText(profile) {
  return `
    ${profile.fullName || ""}
    ${profile.town || ""}
    ${profile.university || ""}
    ${profile.degree || ""}
    ${profile.graduationYear || ""}
    ${profile.industry || ""}
    ${(profile.skills || []).join(" ")}
    ${profile.bio || ""}
  `.toLowerCase();
}

function profileMatchesFilters(profile) {
  const searchText = lowerValue(ypSearchInput?.value);
  const selectedIndustry = lowerValue(ypIndustryFilter?.value);
  const selectedTown = lowerValue(ypTownFilter?.value);
  const selectedStatus = cleanValue(ypStatusFilter?.value);

  if (searchText && !getSearchableText(profile).includes(searchText)) {
    return false;
  }

  if (selectedIndustry && lowerValue(profile.industry) !== selectedIndustry) {
    return false;
  }

  if (selectedTown && lowerValue(profile.town) !== selectedTown) {
    return false;
  }

  if (selectedStatus === "looking" && profile.lookingForWork !== true) {
    return false;
  }

  if (selectedStatus === "mentor" && profile.offeringMentorship !== true) {
    return false;
  }

  return true;
}

function renderProfileCard(profile) {
  const skills = profile.skills || [];

  const skillsHtml = skills
    .slice(0, 8)
    .map(skill => `<span class="tag">${escapeHtml(skill)}</span>`)
    .join("");

  const graduationText = profile.graduationYear
    ? `Graduated / graduating ${escapeHtml(formatYear(profile.graduationYear))}`
    : "";

  return `
    <div class="yp-card">
      <h3>${escapeHtml(profile.fullName || "Young Professional")}</h3>

      <p class="service">
        ${escapeHtml(profile.industry || "Industry not provided")}
      </p>

      <div class="yp-badges">
        ${
          profile.lookingForWork === true
            ? `<span class="yp-badge green">Looking for work</span>`
            : ""
        }

        ${
          profile.offeringMentorship === true
            ? `<span class="yp-badge">Offering mentorship</span>`
            : ""
        }
      </div>

      <div class="yp-meta">
        ${
          profile.town
            ? `<div><strong>Town:</strong> ${escapeHtml(profile.town)}</div>`
            : ""
        }

        ${
          profile.university
            ? `<div><strong>University:</strong> ${escapeHtml(profile.university)}</div>`
            : ""
        }

        ${
          profile.degree
            ? `<div><strong>Degree:</strong> ${escapeHtml(profile.degree)}</div>`
            : ""
        }

        ${
          graduationText
            ? `<div><strong>Year:</strong> ${graduationText}</div>`
            : ""
        }
      </div>

      ${
        skillsHtml
          ? `<div class="tags">${skillsHtml}</div>`
          : ""
      }

      ${
        profile.bio
          ? `<p class="yp-bio">${escapeHtml(profile.bio).substring(0, 220)}${profile.bio.length > 220 ? "..." : ""}</p>`
          : `<p class="yp-bio">No bio added yet.</p>`
      }

      <div class="yp-actions">
        ${
          profile.linkedin
            ? `<a href="${escapeHtml(profile.linkedin)}" target="_blank">LinkedIn</a>`
            : ""
        }

        ${
          profile.uid
            ? `<a href="view.html?id=${encodeURIComponent(profile.uid)}">Main Profile</a>`
            : ""
        }
      </div>
    </div>
  `;
}

function renderProfiles() {
  const filteredProfiles = youngProfiles
    .filter(profileMatchesFilters)
    .sort((a, b) => {
      if (a.lookingForWork === true && b.lookingForWork !== true) return -1;
      if (b.lookingForWork === true && a.lookingForWork !== true) return 1;

      const aTime = a.updatedAt?.seconds || a.createdAt?.seconds || 0;
      const bTime = b.updatedAt?.seconds || b.createdAt?.seconds || 0;

      return bTime - aTime;
    });

  if (ypCount) {
    ypCount.textContent = `Showing ${filteredProfiles.length} young professional${filteredProfiles.length === 1 ? "" : "s"}`;
  }

  if (!ypResults) return;

  if (filteredProfiles.length === 0) {
    ypResults.innerHTML = `
      <div class="empty-state">
        No young professionals match these filters yet.
      </div>
    `;
    return;
  }

  ypResults.innerHTML = filteredProfiles
    .map(profile => renderProfileCard(profile))
    .join("");
}

async function loadMainUserProfile(uid) {
  const userRef = doc(db, "users", uid);
  const userSnap = await getDoc(userRef);

  if (userSnap.exists()) {
    userMainProfile = userSnap.data();
  }
}

async function loadCurrentYoungProfile(uid) {
  const ypRef = doc(db, "youngProfessionals", uid);
  const ypSnap = await getDoc(ypRef);

  if (ypSnap.exists()) {
    fillForm(ypSnap.data());
  } else {
    fillForm({
      fullName: userMainProfile.fullName || currentUser?.displayName || "",
      town: userMainProfile.town || "",
      linkedin: userMainProfile.linkedin || ""
    });
  }
}

async function loadYoungProfessionals() {
  if (ypResults) {
    ypResults.innerHTML = `
      <div class="empty-state">
        Loading young professionals...
      </div>
    `;
  }

  if (ypCount) {
    ypCount.textContent = "Loading profiles...";
  }

  const [snapshot, usersSnapshot] = await Promise.all([
    getDocs(collection(db, "youngProfessionals")),
    getDocs(collection(db, "users"))
  ]);

  const activeUserIds = new Set();

  usersSnapshot.forEach(docSnap => {
    const user = docSnap.data();
    const expiryDate = user.subscriptionExpiresAt?.toDate
      ? user.subscriptionExpiresAt.toDate()
      : user.subscriptionExpiresAt
      ? new Date(user.subscriptionExpiresAt)
      : null;
    const notExpired = !expiryDate || expiryDate > new Date();

    const freeAccessExpiryDate = user.freeAccessExpiresAt?.toDate
      ? user.freeAccessExpiresAt.toDate()
      : user.freeAccessExpiresAt
      ? new Date(user.freeAccessExpiresAt)
      : null;
    const freeAccessActive =
      user.accessType === "admin_granted_free_year" &&
      freeAccessExpiryDate &&
      freeAccessExpiryDate > new Date();

    if (
      (user.role === "admin" || user.role === "super_admin") ||
      freeAccessActive ||
      (
        user.hasSubscription === true &&
        user.subscriptionStatus === "active" &&
        notExpired
      )
    ) {
      activeUserIds.add(docSnap.id);
    }
  });

  youngProfiles = [];

  snapshot.forEach(docSnap => {
    if (activeUserIds.has(docSnap.id)) {
      youngProfiles.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    }
  });

  populateFilters();
  renderProfiles();
}

async function saveYoungProfessionalProfile(event) {
  event.preventDefault();

  if (!currentUser) {
    ypMessage.textContent = "You need to be logged in.";
    return;
  }

  try {
    ypMessage.textContent = "Saving profile...";

    const ypRef = doc(db, "youngProfessionals", currentUser.uid);
    const existingSnap = await getDoc(ypRef);

    const profileData = {
      uid: currentUser.uid,
      email: currentUser.email || "",

      fullName: cleanValue(ypFullName.value),
      town: cleanValue(ypTown.value),
      university: cleanValue(ypUniversity.value),
      degree: cleanValue(ypDegree.value),
      graduationYear: cleanValue(ypGraduationYear.value),
      industry: cleanValue(ypIndustry.value),
      skills: getSkillsArray(ypSkills.value),
      linkedin: cleanValue(ypLinkedin.value),
      bio: cleanValue(ypBio.value),

      lookingForWork: ypLookingForWork.checked === true,
      offeringMentorship: ypOfferingMentorship.checked === true,

      updatedAt: serverTimestamp()
    };

    if (!existingSnap.exists()) {
      profileData.createdAt = serverTimestamp();
    }

    await setDoc(ypRef, profileData, { merge: true });

    ypMessage.textContent = "Young Professional profile saved.";

    await loadYoungProfessionals();
  } catch (error) {
    ypMessage.textContent = error.message;
  }
}

function attachListeners() {
  if (ypForm) {
    ypForm.addEventListener("submit", saveYoungProfessionalProfile);
  }

  if (ypSearchInput) {
    ypSearchInput.addEventListener("keyup", renderProfiles);
  }

  if (ypIndustryFilter) {
    ypIndustryFilter.addEventListener("change", renderProfiles);
  }

  if (ypTownFilter) {
    ypTownFilter.addEventListener("change", renderProfiles);
  }

  if (ypStatusFilter) {
    ypStatusFilter.addEventListener("change", renderProfiles);
  }

  if (ypResetFiltersBtn) {
    ypResetFiltersBtn.addEventListener("click", () => {
      if (ypSearchInput) ypSearchInput.value = "";
      if (ypIndustryFilter) ypIndustryFilter.value = "";
      if (ypTownFilter) ypTownFilter.value = "";
      if (ypStatusFilter) ypStatusFilter.value = "";

      renderProfiles();
    });
  }
}

protectPage({
  onAllowed: () => {
    onAuthStateChanged(auth, async (user) => {
      if (!user) {
        window.location.href = "login.html";
        return;
      }

      currentUser = user;

      try {
        attachListeners();

        await loadMainUserProfile(user.uid);
        await loadCurrentYoungProfile(user.uid);
        await loadYoungProfessionals();
      } catch (error) {
        if (ypResults) {
          ypResults.innerHTML = `
            <div class="empty-state">
              Error loading Young Professionals: ${error.message}
            </div>
          `;
        }

        if (ypMessage) {
          ypMessage.textContent = error.message;
        }
      }
    });
  }
});
