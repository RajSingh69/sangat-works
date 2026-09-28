/*
  Young Professionals: members add a short YP profile (youngProfessionals/{uid})
  saying whether they're looking for work and/or offering mentoring. Cards use
  the member's public profile photo and link to their main profile.
  No email is stored because every member can read these.
*/

import { db } from "./firebase.js";
import { protectPage } from "./subscription-guard.js";
import { getPublicProfiles, openConversationWithUser } from "./member-network.js";
import { compareByRanking } from "./ranking.js";
import { escapeHtml, renderFramedPhoto } from "./directory-card.js";
import { isListedInDirectory } from "./industries.js";

import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const $ = id => document.getElementById(id);
const els = {
  count: $("ypCount"),
  results: $("ypResults"),
  search: $("ypSearchInput"),
  industry: $("ypIndustryFilter"),
  town: $("ypTownFilter"),
  reset: $("ypResetFiltersBtn"),
  heroButton: $("ypHeroButton"),
  modal: $("ypFormModal"),
  form: $("ypForm"),
  message: $("ypMessage"),
  saveBtn: $("ypSaveBtn"),
  removeBtn: $("ypRemoveBtn")
};
const fields = {
  fullName: $("ypFullName"),
  town: $("ypTown"),
  university: $("ypUniversity"),
  degree: $("ypDegree"),
  graduationYear: $("ypGraduationYear"),
  industry: $("ypIndustry"),
  skills: $("ypSkills"),
  linkedin: $("ypLinkedin"),
  bio: $("ypBio"),
  lookingForWork: $("ypLookingForWork"),
  offeringMentorship: $("ypOfferingMentorship")
};

let currentUser = null;
let userMainProfile = {};
let myYpProfile = null;
let youngProfiles = [];
let memberProfiles = new Map();
let activeStatus = "";
const expanded = new Set();

const clean = value => String(value ?? "").trim();
const lower = value => clean(value).toLowerCase();

function safeLink(value) {
  const raw = clean(value);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

// ---------- loading ----------

async function loadYoungProfessionals() {
  const snapshot = await getDocs(collection(db, "youngProfessionals"));
  const all = snapshot.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data() }));
  memberProfiles = await getPublicProfiles(all.map(profile => profile.id));

  // Only people whose main membership is active (same rule as the directory).
  youngProfiles = all.filter(profile => isListedInDirectory(memberProfiles.get(profile.id)));
  myYpProfile = all.find(profile => profile.id === currentUser.uid) || null;

  populateFilters();
  updateHeroButton();
  render();
}

// ---------- filters ----------

function populateSelect(select, values, label) {
  const current = select.value;
  select.innerHTML = `<option value="">${label}</option>${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
  select.value = values.includes(current) ? current : "";
}

function populateFilters() {
  const unique = key => [...new Set(youngProfiles.map(profile => clean(profile[key])).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  populateSelect(els.industry, unique("industry"), "All industries");
  populateSelect(els.town, unique("town"), "All towns");
}

function matches(profile, status = activeStatus) {
  const search = lower(els.search.value);
  if (search) {
    const text = [profile.fullName, profile.town, profile.university, profile.degree, profile.graduationYear, profile.industry, ...(profile.skills || []), profile.bio]
      .map(lower).join(" ");
    if (!text.includes(search)) return false;
  }
  if (els.industry.value && lower(profile.industry) !== lower(els.industry.value)) return false;
  if (els.town.value && lower(profile.town) !== lower(els.town.value)) return false;
  if (status === "looking" && profile.lookingForWork !== true) return false;
  if (status === "mentor" && profile.offeringMentorship !== true) return false;
  return true;
}

// ---------- rendering ----------

function renderCard(profile) {
  const member = memberProfiles.get(profile.id) || {};
  const isMine = profile.id === currentUser?.uid;
  const name = profile.fullName || member.fullName || "Young Professional";
  const linkedin = safeLink(profile.linkedin);
  const skills = (profile.skills || []).filter(Boolean).slice(0, 6);
  const bio = clean(profile.bio);
  const isLong = bio.length > 200;

  const facts = [
    profile.university,
    profile.degree,
    profile.graduationYear ? `Class of ${profile.graduationYear}` : "",
    profile.town
  ].filter(Boolean);

  return `
    <article class="yp-card${isMine ? " is-mine" : ""}">
      <div class="yp-card-head">
        ${renderFramedPhoto(member, { className: "yp-photo", alt: "" })}
        <div class="yp-card-id">
          <h3>${escapeHtml(name)}</h3>
          <p>${escapeHtml(profile.industry || "Industry not added")}</p>
        </div>
      </div>
      <div class="yp-badges">
        ${isMine ? `<span class="yp-badge is-you">You</span>` : ""}
        ${profile.lookingForWork === true ? `<span class="yp-badge is-looking">Looking for work</span>` : ""}
        ${profile.offeringMentorship === true ? `<span class="yp-badge is-mentor">Offers mentoring</span>` : ""}
      </div>
      ${facts.length ? `<ul class="opp-facts">${facts.map(fact => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>` : ""}
      ${bio ? `<p class="opp-description${isLong && !expanded.has(profile.id) ? " is-clamped" : ""}">${escapeHtml(bio)}</p>` : ""}
      ${isLong ? `<button type="button" class="opp-more" data-yp-expand="${escapeHtml(profile.id)}">${expanded.has(profile.id) ? "Show less" : "Read more"}</button>` : ""}
      ${skills.length ? `<div class="opp-tags">${skills.map(skill => `<span>${escapeHtml(skill)}</span>`).join("")}</div>` : ""}
      <div class="opp-actions yp-actions">
        ${isMine
          ? `<button type="button" class="btn-primary" data-open-yp-form>Edit my profile</button>`
          : `<button type="button" class="btn-primary" data-yp-message="${escapeHtml(profile.id)}">Message</button>`}
        <a class="btn-secondary" href="view.html?id=${encodeURIComponent(profile.id)}">View profile</a>
        ${linkedin ? `<a class="btn-secondary" href="${escapeHtml(linkedin)}" target="_blank" rel="noopener">LinkedIn</a>` : ""}
      </div>
    </article>`;
}

function render() {
  const counts = { "": 0, looking: 0, mentor: 0 };
  Object.keys(counts).forEach(status => { counts[status] = youngProfiles.filter(profile => matches(profile, status)).length; });
  $("ypCountAll").textContent = counts[""];
  $("ypCountLooking").textContent = counts.looking;
  $("ypCountMentor").textContent = counts.mentor;
  document.querySelectorAll("[data-yp-status]").forEach(tab => {
    const active = tab.dataset.ypStatus === activeStatus;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
  });

  const shown = youngProfiles.filter(profile => matches(profile)).sort((a, b) => {
    const ranking = compareByRanking(memberProfiles.get(a.id) || {}, memberProfiles.get(b.id) || {});
    if (ranking) return ranking;
    return (b.updatedAt?.seconds || 0) - (a.updatedAt?.seconds || 0);
  });

  els.count.textContent = `Showing ${shown.length} of ${youngProfiles.length}`;

  if (!shown.length) {
    const none = !youngProfiles.length;
    els.results.innerHTML = `
      <div class="opp-empty">
        <strong>${none ? "No young professionals yet. Be the first to add yourself." : "Nobody matches those filters."}</strong>
        ${none ? `<button type="button" class="btn-primary" data-open-yp-form>Add my profile</button>` : ""}
      </div>`;
    return;
  }
  els.results.innerHTML = shown.map(renderCard).join("");
}

function updateHeroButton() {
  els.heroButton.textContent = myYpProfile ? "Edit my Young Professional profile" : "Add my Young Professional profile";
}

// ---------- form ----------

function openForm() {
  const profile = myYpProfile || {};
  fields.fullName.value = profile.fullName || userMainProfile.fullName || "";
  fields.town.value = profile.town || userMainProfile.town || "";
  fields.university.value = profile.university || "";
  fields.degree.value = profile.degree || "";
  fields.graduationYear.value = profile.graduationYear || "";
  fields.industry.value = profile.industry || "";
  fields.skills.value = (profile.skills || []).join(", ");
  fields.linkedin.value = profile.linkedin || userMainProfile.linkedin || "";
  fields.bio.value = profile.bio || "";
  fields.lookingForWork.checked = profile.lookingForWork === true;
  fields.offeringMentorship.checked = profile.offeringMentorship === true;

  els.message.textContent = "";
  els.saveBtn.disabled = false;
  els.removeBtn.hidden = !myYpProfile;
  els.modal.hidden = false;
  document.body.classList.add("opp-modal-open");
  fields.fullName.focus();
}

function closeForm() {
  els.modal.hidden = true;
  document.body.classList.remove("opp-modal-open");
}

async function saveProfile(event) {
  event.preventDefault();
  if (!currentUser) return;

  if (!clean(fields.fullName.value) || !clean(fields.industry.value)) {
    els.message.textContent = "Please add your name and industry.";
    return;
  }
  const linkedinRaw = clean(fields.linkedin.value);
  if (linkedinRaw && !safeLink(linkedinRaw)) {
    els.message.textContent = "That LinkedIn link doesn't look right.";
    return;
  }

  els.saveBtn.disabled = true;
  els.message.textContent = "Saving...";

  try {
    const data = {
      uid: currentUser.uid,
      fullName: clean(fields.fullName.value),
      town: clean(fields.town.value),
      university: clean(fields.university.value),
      degree: clean(fields.degree.value),
      graduationYear: clean(fields.graduationYear.value),
      industry: clean(fields.industry.value),
      skills: clean(fields.skills.value).split(",").map(skill => skill.trim()).filter(Boolean),
      linkedin: linkedinRaw ? safeLink(linkedinRaw) : "",
      bio: clean(fields.bio.value),
      lookingForWork: fields.lookingForWork.checked,
      offeringMentorship: fields.offeringMentorship.checked,
      // Older profiles stored the sign-in email; YP profiles are visible to all members.
      email: deleteField(),
      updatedAt: serverTimestamp()
    };
    if (!myYpProfile) data.createdAt = serverTimestamp();

    await setDoc(doc(db, "youngProfessionals", currentUser.uid), data, { merge: true });
    closeForm();
    await loadYoungProfessionals();
  } catch (error) {
    console.error("Could not save Young Professional profile:", error);
    els.message.textContent = "Couldn't save. Please try again.";
    els.saveBtn.disabled = false;
  }
}

async function removeProfile() {
  if (!window.confirm("Remove your Young Professional profile? Your main Sangat Works profile stays as it is.")) return;
  try {
    await deleteDoc(doc(db, "youngProfessionals", currentUser.uid));
    closeForm();
    await loadYoungProfessionals();
  } catch (error) {
    console.error("Could not remove Young Professional profile:", error);
    els.message.textContent = "Couldn't remove it. Please try again.";
  }
}

// ---------- events ----------

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;

  if (target.matches("[data-open-yp-form]")) return openForm();
  if (target.matches("[data-close-yp-form]")) return closeForm();

  if (target.dataset.ypStatus !== undefined) {
    activeStatus = target.dataset.ypStatus;
    render();
  } else if (target.dataset.ypExpand) {
    const id = target.dataset.ypExpand;
    expanded.has(id) ? expanded.delete(id) : expanded.add(id);
    render();
  } else if (target.dataset.ypMessage) {
    target.disabled = true;
    target.textContent = "Opening chat...";
    try {
      await openConversationWithUser(currentUser.uid, target.dataset.ypMessage);
    } catch (error) {
      window.alert(error.message || "Messaging is temporarily unavailable.");
      target.disabled = false;
      target.textContent = "Message";
    }
  }
});

els.modal.addEventListener("click", event => {
  if (event.target === els.modal) closeForm();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !els.modal.hidden) closeForm();
});
els.form.addEventListener("submit", saveProfile);
els.removeBtn.addEventListener("click", removeProfile);
[els.search, els.industry, els.town].forEach(input => input.addEventListener("input", render));
els.reset.addEventListener("click", () => {
  els.search.value = "";
  els.industry.value = "";
  els.town.value = "";
  activeStatus = "";
  render();
});

protectPage({
  onAllowed: async (user) => {
    currentUser = user;
    try {
      const mainSnap = await getDoc(doc(db, "users", user.uid));
      userMainProfile = mainSnap.exists() ? mainSnap.data() : {};
      await loadYoungProfessionals();
    } catch (error) {
      console.error("Could not load Young Professionals:", error);
      els.results.innerHTML = `<div class="opp-empty"><strong>Couldn't load Young Professionals.</strong><span>Please refresh the page.</span></div>`;
      els.count.textContent = "";
    }
  }
});
