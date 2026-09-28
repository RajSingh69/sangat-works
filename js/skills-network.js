/*
  Gurdwara Network: members grouped by the Gurdwara on their profile, then by the
  same industries as the directory. Nothing to set up or join: a member appears
  here when their profile lists a Gurdwara (and they haven't hidden it).
  Browsing a Gurdwara never changes your profile; "Set as my Gurdwara" does.
*/

import { db } from "./firebase.js";
import { protectPage } from "./subscription-guard.js";
import { openConversationWithUser, sendConnectionRequest } from "./member-network.js";
import { compareByRanking } from "./ranking.js";
import { escapeHtml, renderMemberCard } from "./directory-card.js";
import { adjustMemberPhoto } from "./photo-framer.js";
import { INDUSTRY_BUCKETS, getIndustryBucket, isListedInDirectory } from "./industries.js";
import { isSuperAdmin } from "./roles.js";

import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const els = {
  select: document.getElementById("gnSelect"),
  myGurdwara: document.getElementById("gnMyGurdwara"),
  detail: document.getElementById("gnDetail"),
  name: document.getElementById("gnName"),
  address: document.getElementById("gnAddress"),
  setMine: document.getElementById("gnSetMine"),
  stats: document.getElementById("gnStats"),
  seva: document.getElementById("gnSeva"),
  tabs: document.getElementById("gnIndustryTabs"),
  members: document.getElementById("gnMembers"),
  tiles: document.getElementById("gnTiles")
};

let currentUser = null;
let myProfile = {};
let canAdjustPhotos = false;
let gurdwaras = [];            // { id, name, address, postcode }
let membersByGurdwara = new Map();
let sevaByOwner = new Map();   // ownerId -> open volunteering opportunities
let selectedId = "";
let activeIndustry = "All";

const normalise = value => String(value || "").trim().toLowerCase();

function gurdwaraName(data) {
  return data.name || data.gurdwaraName || data.localGurdwara || "Unnamed Gurdwara";
}

// Profiles made before Gurdwaras had ids only stored the name, so match on that too.
function findGurdwaraId(profile, idsByName) {
  if (profile.gurdwaraId && gurdwaras.some(item => item.id === profile.gurdwaraId)) return profile.gurdwaraId;
  const name = normalise(profile.gurdwaraName || profile.associatedGurdwara || profile.localGurdwara || profile.gurdwara);
  return idsByName.get(name) || "";
}

async function loadData() {
  const today = new Date().toISOString().slice(0, 10);
  const [gurdwaraSnap, profileSnap, sevaSnap] = await Promise.all([
    getDocs(collection(db, "gurdwaras")),
    getDocs(query(collection(db, "publicProfiles"), where("isPublic", "==", true))),
    getDocs(query(collection(db, "opportunities"), where("status", "==", "open"))).catch(() => ({ docs: [] }))
  ]);

  gurdwaras = gurdwaraSnap.docs.map(item => {
    const data = item.data();
    return { id: item.id, name: gurdwaraName(data), address: data.address || "", postcode: data.postcode || "" };
  });

  const idsByName = new Map(gurdwaras.map(item => [normalise(item.name), item.id]));
  membersByGurdwara = new Map();
  profileSnap.docs.forEach(item => {
    const profile = { id: item.id, uid: item.id, ...item.data() };
    if (!isListedInDirectory(profile)) return;
    const gurdwaraId = findGurdwaraId(profile, idsByName);
    if (!gurdwaraId) return;
    if (!membersByGurdwara.has(gurdwaraId)) membersByGurdwara.set(gurdwaraId, []);
    membersByGurdwara.get(gurdwaraId).push(profile);
  });
  membersByGurdwara.forEach(list => list.sort(compareByRanking));

  sevaByOwner = new Map();
  sevaSnap.docs.forEach(item => {
    const data = { id: item.id, ...item.data() };
    if (data.type !== "volunteering" || (data.closingDate && data.closingDate < today)) return;
    if (!sevaByOwner.has(data.ownerId)) sevaByOwner.set(data.ownerId, []);
    sevaByOwner.get(data.ownerId).push(data);
  });

  gurdwaras.sort((a, b) =>
    (membersByGurdwara.get(b.id)?.length || 0) - (membersByGurdwara.get(a.id)?.length || 0) || a.name.localeCompare(b.name));
}

// ---------- rendering ----------

function memberCount(id) {
  return membersByGurdwara.get(id)?.length || 0;
}

function renderPicker() {
  els.select.innerHTML = `<option value="">Select a Gurdwara</option>${gurdwaras.map(item =>
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.name)} (${memberCount(item.id)})</option>`).join("")}`;
  els.select.value = selectedId;
}

function renderMyGurdwara() {
  const mine = gurdwaras.find(item => item.id === myProfile.gurdwaraId);
  els.myGurdwara.innerHTML = mine
    ? `Your Gurdwara: <strong>${escapeHtml(mine.name)}</strong>`
    : `You haven't chosen your Gurdwara yet. Pick one below and click <strong>Set as my Gurdwara</strong>.`;
}

function renderTiles() {
  if (!gurdwaras.length) {
    els.tiles.innerHTML = `<div class="opp-empty"><strong>No Gurdwaras added yet.</strong><a class="btn-primary" href="profile.html">Add yours on your profile</a></div>`;
    return;
  }
  els.tiles.innerHTML = gurdwaras.map(item => {
    const count = memberCount(item.id);
    return `
      <a class="industry-tile${count ? "" : " is-empty"}${item.id === selectedId ? " is-selected" : ""}" href="?gurdwara=${encodeURIComponent(item.id)}" data-gurdwara-id="${escapeHtml(item.id)}">
        <span class="industry-tile-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c-2 2-4 3.5-4 6h8c0-2.5-2-4-4-6Z"/><path d="M5 21V12h14v9"/><path d="M3 21h18M10 21v-4h4v4"/></svg>
        </span>
        <span class="industry-tile-text">
          <strong>${escapeHtml(item.name)}</strong>
          <small>${escapeHtml([item.address, item.postcode].filter(Boolean).join(", ") || "Address not added")}</small>
        </span>
        <span class="industry-tile-count">${count ? `${count} member${count === 1 ? "" : "s"}` : "No members yet"}</span>
        <span class="industry-tile-arrow home-arrow" aria-hidden="true"></span>
      </a>`;
  }).join("");
}

function renderDetail() {
  const gurdwara = gurdwaras.find(item => item.id === selectedId);
  els.detail.hidden = !gurdwara;
  if (!gurdwara) return;

  const members = membersByGurdwara.get(gurdwara.id) || [];
  const groups = new Map();
  members.forEach(profile => {
    const industry = getIndustryBucket(profile);
    groups.set(industry, (groups.get(industry) || 0) + 1);
  });
  if (activeIndustry !== "All" && !groups.has(activeIndustry)) activeIndustry = "All";

  const seva = members.flatMap(profile => sevaByOwner.get(profile.uid) || []);

  els.name.textContent = gurdwara.name;
  els.address.textContent = [gurdwara.address, gurdwara.postcode].filter(Boolean).join(", ");
  els.setMine.hidden = myProfile.gurdwaraId === gurdwara.id;
  els.setMine.disabled = false;
  els.setMine.textContent = "Set as my Gurdwara";

  const industryCount = [...groups.keys()].filter(name => name !== "Other").length;
  els.stats.innerHTML = `
    <div><strong>${members.length}</strong><span>Member${members.length === 1 ? "" : "s"}</span></div>
    <div><strong>${industryCount}</strong><span>Industr${industryCount === 1 ? "y" : "ies"}</span></div>
    <div><strong>${seva.length}</strong><span>Seva opportunit${seva.length === 1 ? "y" : "ies"}</span></div>`;

  els.seva.hidden = !seva.length;
  els.seva.innerHTML = seva.length ? `
    <strong>Seva needed</strong>
    <ul>${seva.slice(0, 4).map(item => `<li><a href="opportunities.html?type=volunteering">${escapeHtml(item.title)}</a>${item.location ? ` <span>${escapeHtml(item.location)}</span>` : ""}</li>`).join("")}</ul>` : "";

  const order = [...INDUSTRY_BUCKETS.map(bucket => bucket.name), "Other"].filter(name => groups.has(name));
  const tabs = [["All", members.length], ...order.map(name => [name, groups.get(name)])];
  els.tabs.hidden = members.length === 0;
  els.tabs.innerHTML = tabs.map(([name, count]) => `
    <button type="button" role="tab" class="opp-type-tab${name === activeIndustry ? " is-active" : ""}" aria-selected="${name === activeIndustry}" data-gn-industry="${escapeHtml(name)}">
      ${escapeHtml(name)} <span>${count}</span>
    </button>`).join("");

  if (!members.length) {
    els.members.innerHTML = `
      <div class="opp-empty">
        <strong>No members have linked this Gurdwara yet.</strong>
        <span>Is this your Gurdwara? Click <strong>Set as my Gurdwara</strong> and you'll be the first.</span>
      </div>`;
    return;
  }

  const shown = activeIndustry === "All" ? members : members.filter(profile => getIndustryBucket(profile) === activeIndustry);
  els.members.innerHTML = shown.map(profile =>
    renderMemberCard(profile, { industry: getIndustryBucket(profile), canAdjustPhoto: canAdjustPhotos })).join("");
}

function selectGurdwara(id, { updateUrl = true } = {}) {
  selectedId = gurdwaras.some(item => item.id === id) ? id : "";
  activeIndustry = "All";
  els.select.value = selectedId;
  if (updateUrl) {
    const url = new URL(window.location.href);
    if (selectedId) url.searchParams.set("gurdwara", selectedId);
    else url.searchParams.delete("gurdwara");
    history.replaceState(null, "", url);
  }
  renderDetail();
  renderTiles();
}

// ---------- actions ----------

async function setAsMine() {
  const gurdwara = gurdwaras.find(item => item.id === selectedId);
  if (!gurdwara || !currentUser) return;
  els.setMine.disabled = true;
  els.setMine.textContent = "Saving...";
  try {
    await setDoc(doc(db, "users", currentUser.uid), {
      gurdwaraId: gurdwara.id,
      gurdwaraName: gurdwara.name,
      associatedGurdwara: gurdwara.name,
      localGurdwara: gurdwara.name,
      updatedAt: serverTimestamp()
    }, { merge: true });
    myProfile = { ...myProfile, gurdwaraId: gurdwara.id };
    renderMyGurdwara();
    els.setMine.hidden = true;
    els.myGurdwara.innerHTML += `<br><small>Saved. You'll appear in this Gurdwara's list within a minute (unless your profile hides your Gurdwara).</small>`;
  } catch (error) {
    console.error("Could not save Gurdwara:", error);
    els.setMine.disabled = false;
    els.setMine.textContent = "Couldn't save, try again";
  }
}

els.select.addEventListener("change", () => selectGurdwara(els.select.value));
els.setMine.addEventListener("click", setAsMine);

document.addEventListener("click", async (event) => {
  const tile = event.target.closest("[data-gurdwara-id]");
  if (tile) {
    event.preventDefault();
    selectGurdwara(tile.dataset.gurdwaraId);
    els.detail.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const tab = event.target.closest("[data-gn-industry]");
  if (tab) {
    activeIndustry = tab.dataset.gnIndustry;
    renderDetail();
    return;
  }

  const adjust = event.target.closest("[data-adjust-photo-id]");
  if (adjust) {
    event.stopPropagation();
    const profile = (membersByGurdwara.get(selectedId) || []).find(item => item.uid === adjust.dataset.adjustPhotoId);
    if (profile && canAdjustPhotos) adjustMemberPhoto(profile, () => renderDetail());
    return;
  }

  const connect = event.target.closest("[data-directory-connect-id]");
  const message = event.target.closest("[data-directory-message-id]");
  try {
    if (connect && currentUser) {
      await sendConnectionRequest(currentUser.uid, decodeURIComponent(connect.dataset.directoryConnectId));
      const label = connect.querySelector("span");
      if (label) label.textContent = "Requested";
      connect.disabled = true;
      return;
    }
    if (message && currentUser) {
      await openConversationWithUser(currentUser.uid, decodeURIComponent(message.dataset.directoryMessageId));
      return;
    }
  } catch (error) {
    window.alert(error.message || "Messaging is temporarily unavailable.");
    return;
  }

  if (event.target.closest("a, button")) return;
  const card = event.target.closest(".member-card[data-profile-url]");
  if (card) window.location.href = card.dataset.profileUrl;
});

document.addEventListener("keydown", event => {
  const card = event.target.closest?.(".member-card[data-profile-url]");
  if (card && event.key === "Enter" && event.target === card) window.location.href = card.dataset.profileUrl;
});

// ---------- start ----------

protectPage({
  onAllowed: async (user, userData) => {
    currentUser = user;
    myProfile = userData || {};
    canAdjustPhotos = isSuperAdmin(userData);

    try {
      await loadData();
    } catch (error) {
      console.error("Could not load the Gurdwara Network:", error);
      els.tiles.innerHTML = `<div class="opp-empty"><strong>Couldn't load Gurdwaras.</strong><span>Please refresh the page.</span></div>`;
      return;
    }

    // Match a name-only profile Gurdwara to its id for "Your Gurdwara".
    if (!myProfile.gurdwaraId) {
      const idsByName = new Map(gurdwaras.map(item => [normalise(item.name), item.id]));
      myProfile.gurdwaraId = findGurdwaraId(myProfile, idsByName);
    }

    const requested = new URLSearchParams(window.location.search).get("gurdwara");
    selectedId = gurdwaras.some(item => item.id === requested) ? requested : myProfile.gurdwaraId || "";
    renderPicker();
    renderMyGurdwara();
    selectGurdwara(selectedId, { updateUrl: false });
  }
});
