/*
  Opportunities board: jobs, freelance work, collaborations, mentoring and seva
  from members in any industry (opportunities collection), plus open home & trade
  projects (projects collection, managed on projects.html).
  People respond by messaging the poster, or through the poster's own link.
*/

import { db } from "./firebase.js";
import { protectPage } from "./subscription-guard.js";
import { getPublicProfiles, openConversationWithUser } from "./member-network.js";
import { compareByRanking } from "./ranking.js";
import { escapeHtml, getCardIdentity, renderFramedPhoto } from "./directory-card.js";
import { INDUSTRY_BUCKETS } from "./industries.js";
import { isAdminUser } from "./roles.js";
import { startPromotionCheckout } from "./promotions.js";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const TYPES = [
  { id: "job", label: "Job", plural: "Jobs" },
  { id: "freelance", label: "Freelance / Contract", plural: "Freelance & Contract" },
  { id: "collaboration", label: "Collaboration", plural: "Collaborations" },
  { id: "mentoring", label: "Mentoring", plural: "Mentoring" },
  { id: "volunteering", label: "Volunteering & Seva", plural: "Volunteering & Seva" }
];
const PROJECT_TYPE = { id: "project", label: "Home & Trade Project", plural: "Home & Trade Projects" };
const ALL_TYPES = [...TYPES, PROJECT_TYPE];
const typeById = id => ALL_TYPES.find(type => type.id === id) || TYPES[0];
const INDUSTRY_NAMES = [...INDUSTRY_BUCKETS.map(bucket => bucket.name), "Other"];

const els = {
  count: document.getElementById("oppCount"),
  results: document.getElementById("oppResults"),
  tabs: document.getElementById("oppTypeTabs"),
  search: document.getElementById("oppSearch"),
  industry: document.getElementById("oppIndustry"),
  sort: document.getElementById("oppSort"),
  remote: document.getElementById("oppRemote"),
  mine: document.getElementById("oppMine"),
  modal: document.getElementById("oppFormModal"),
  form: document.getElementById("oppForm"),
  formHeading: document.getElementById("oppFormTitle"),
  formType: document.getElementById("oppFormType"),
  formTitle: document.getElementById("oppFormTitleInput"),
  formIndustry: document.getElementById("oppFormIndustry"),
  formDescription: document.getElementById("oppFormDescription"),
  formLocation: document.getElementById("oppFormLocation"),
  formRemote: document.getElementById("oppFormRemote"),
  formPay: document.getElementById("oppFormPay"),
  formClosing: document.getElementById("oppFormClosing"),
  formLink: document.getElementById("oppFormLink"),
  formMessage: document.getElementById("oppFormMessage"),
  formSubmit: document.getElementById("oppFormSubmit")
};

let currentUser = null;
let canModerate = false;
let opportunities = [];
let projects = [];
let employerJobs = [];  // paid posts from non-member employers (functions/employer-jobs.js)
let profiles = new Map();
let activeType = "all";
let editingId = "";
const expanded = new Set();

// ---------- helpers ----------

function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Featured posts (paid for through Stripe) go to the top of the board until featuredUntil.
function isFeatured(item) {
  const until = toDate(item.featuredUntil);
  return item.kind === "opportunity" && item.status === "open" && Boolean(until && until > new Date());
}

function isLive(item) {
  if (item.kind === "employer") {
    const until = toDate(item.liveUntil);
    if (item.status !== "live" || !until || until <= new Date()) return false;
  } else if (item.status !== "open") {
    return false;
  }
  return !item.closingDate || item.closingDate >= todayString();
}

// Everything members can currently see on the board.
function livePool() {
  return [...opportunities.filter(isLive), ...employerJobs.filter(isLive), ...projects];
}

function timeAgo(value) {
  const date = toDate(value);
  if (!date) return "Just now";
  const days = Math.floor((Date.now() - date.getTime()) / 86400000);
  if (days < 1) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function formatClosing(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function safeLink(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

// ---------- loading ----------

async function loadBoard() {
  try {
    const [openSnap, mineSnap, projectSnap, employerSnap] = await Promise.all([
      getDocs(query(collection(db, "opportunities"), where("status", "==", "open"))),
      getDocs(query(collection(db, "opportunities"), where("ownerId", "==", currentUser.uid))),
      getDocs(query(collection(db, "projects"), where("status", "==", "open"))).catch(error => {
        console.warn("Could not load trade projects:", error);
        return { docs: [] };
      }),
      getDocs(query(collection(db, "employerJobs"), where("status", "==", "live"))).catch(error => {
        console.warn("Could not load employer jobs:", error);
        return { docs: [] };
      })
    ]);

    const byId = new Map();
    [...openSnap.docs, ...mineSnap.docs].forEach(item => byId.set(item.id, { id: item.id, kind: "opportunity", ...item.data() }));
    opportunities = [...byId.values()];
    projects = projectSnap.docs.map(item => ({ id: item.id, ...item.data(), kind: "project", type: "project" }));
    employerJobs = employerSnap.docs.map(item => ({ id: item.id, ...item.data(), kind: "employer", type: "job", ownerId: "" }));
    profiles = await getPublicProfiles([...opportunities, ...projects].map(item => item.ownerId));
    render();
  } catch (error) {
    console.error("Could not load opportunities:", error);
    els.results.innerHTML = `<div class="opp-empty">Couldn't load opportunities. Please refresh the page.</div>`;
    els.count.textContent = "";
  }
}

// ---------- filtering + rendering ----------

function getVisibleItems() {
  const search = els.search.value.trim().toLowerCase();
  const industry = els.industry.value;
  const remoteOnly = els.remote.checked;
  const mineOnly = els.mine.checked;

  const pool = mineOnly
    ? [...opportunities, ...projects].filter(item => item.ownerId === currentUser.uid)
    : livePool();

  const items = pool.filter(item => {
    if (activeType !== "all" && item.type !== activeType) return false;
    if (industry && item.kind === "opportunity" && item.industry !== industry) return false;
    if (industry && item.kind === "project" && industry !== "Trades" && industry !== "Property") return false;
    if (remoteOnly && item.remote !== true) return false;
    if (!search) return true;
    const owner = profiles.get(item.ownerId);
    const haystack = [
      item.title, item.description, item.location, item.industry, item.pay, item.budget, item.companyName,
      ...(Array.isArray(item.requiredTrades) ? item.requiredTrades : []),
      owner ? getCardIdentity(owner) : "", owner?.fullName
    ].filter(Boolean).join(" ").toLowerCase();
    return haystack.includes(search);
  });

  const newest = (a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);
  const featuredFirst = (a, b) => Number(isFeatured(b)) - Number(isFeatured(a));
  if (els.sort.value === "newest") return items.sort((a, b) => featuredFirst(a, b) || newest(a, b));
  // Featured first, then paid, active, verified posters (same ranking as the directory), newest first within that.
  return items.sort((a, b) => {
    if (featuredFirst(a, b)) return featuredFirst(a, b);
    if (a.ownerId === b.ownerId) return newest(a, b);
    return compareByRanking(profiles.get(a.ownerId) || {}, profiles.get(b.ownerId) || {}) || newest(a, b);
  });
}

function renderTabs() {
  const liveCount = id => {
    const pool = livePool();
    return id === "all" ? pool.length : pool.filter(item => item.type === id).length;
  };
  const tabs = [{ id: "all", plural: "All" }, ...ALL_TYPES];
  els.tabs.innerHTML = tabs.map(tab => `
    <button type="button" role="tab" class="opp-type-tab${tab.id === activeType ? " is-active" : ""}" aria-selected="${tab.id === activeType}" data-type="${tab.id}">
      ${escapeHtml(tab.plural)} <span>${liveCount(tab.id)}</span>
    </button>`).join("");
}

function renderPoster(item) {
  if (item.kind === "employer") {
    const initial = escapeHtml(String(item.companyName || "?").trim().charAt(0).toUpperCase());
    return `<div class="opp-poster"><span class="opp-poster-company" aria-hidden="true">${initial}</span><span><strong>${escapeHtml(item.companyName || "Employer")}</strong><small>Employer post &middot; ${escapeHtml(timeAgo(item.createdAt))}</small></span></div>`;
  }
  const owner = profiles.get(item.ownerId);
  const name = owner ? getCardIdentity(owner) : item.ownerName || "Sangat Works member";
  const avatar = renderFramedPhoto(owner || {}, { className: "opp-poster-photo" });
  const inner = `${avatar}<span><strong>${escapeHtml(name)}</strong><small>Posted ${escapeHtml(timeAgo(item.createdAt))}</small></span>`;
  return owner
    ? `<a class="opp-poster" href="view.html?id=${encodeURIComponent(item.ownerId)}">${inner}</a>`
    : `<div class="opp-poster">${inner}</div>`;
}

function renderFacts(item) {
  const facts = [];
  if (item.kind === "project") {
    if (item.location) facts.push(item.location);
    if (item.budget) facts.push(`Budget: ${item.budget}`);
  } else {
    const where = [item.location, item.remote ? "Remote OK" : ""].filter(Boolean).join(" · ");
    if (where) facts.push(where);
    if (item.pay) facts.push(item.pay);
    if (item.closingDate) facts.push(`Closes ${formatClosing(item.closingDate)}`);
  }
  return facts.length ? `<ul class="opp-facts">${facts.map(fact => `<li>${escapeHtml(fact)}</li>`).join("")}</ul>` : "";
}

function renderActions(item) {
  const isMine = currentUser && item.ownerId === currentUser.uid;

  if (item.kind === "employer") {
    const link = safeLink(item.applyLink);
    const buttons = [
      link ? `<a class="btn-primary" href="${escapeHtml(link)}" target="_blank" rel="noopener">Apply</a>` : "",
      item.applyEmail ? `<a class="${link ? "btn-secondary" : "btn-primary"}" href="mailto:${escapeHtml(item.applyEmail)}?subject=${encodeURIComponent(`Application: ${item.title || "your job on Sangat Works"}`)}">Apply by email</a>` : "",
      canModerate ? `<button type="button" class="opp-danger" data-remove-employer-job="${item.id}">Take down (admin)</button>` : ""
    ];
    return buttons.join("");
  }

  if (item.kind === "project") {
    return `<a class="btn-primary" href="projects.html#openProjectsSection">${isMine ? "Manage project" : "View &amp; apply"}</a>`;
  }

  const buttons = [];
  if (isMine) {
    if (item.status === "open") {
      buttons.push(isFeatured(item)
        ? `<button type="button" class="opp-feature-btn is-active" data-feature-opp="${item.id}" title="Add another 14 days">Featured until ${escapeHtml(formatClosing(toDate(item.featuredUntil).toISOString().slice(0, 10)))} &middot; Extend</button>`
        : `<button type="button" class="opp-feature-btn" data-feature-opp="${item.id}">Feature this post &middot; £5 for 14 days</button>`);
    }
    buttons.push(`<button type="button" class="btn-secondary" data-edit-opp="${item.id}">Edit</button>`);
    buttons.push(item.status === "open"
      ? `<button type="button" class="btn-secondary" data-close-opp="${item.id}">Mark as filled</button>`
      : `<button type="button" class="btn-secondary" data-reopen-opp="${item.id}">Reopen</button>`);
    buttons.push(`<button type="button" class="opp-danger" data-delete-opp="${item.id}">Delete</button>`);
  } else {
    const link = safeLink(item.applyLink);
    buttons.push(`<button type="button" class="btn-primary" data-message-opp="${item.ownerId}">Message</button>`);
    if (link) buttons.push(`<a class="btn-secondary" href="${escapeHtml(link)}" target="_blank" rel="noopener">Apply on their site</a>`);
    if (canModerate) {
      buttons.push(`<button type="button" class="opp-danger" data-admin-close-opp="${item.id}" title="Admin: hide from the board">Close (admin)</button>`);
      buttons.push(`<button type="button" class="opp-danger" data-delete-opp="${item.id}" title="Admin: delete permanently">Delete (admin)</button>`);
    }
  }
  return buttons.join("");
}

function renderCard(item) {
  const type = typeById(item.type);
  const isOpen = item.kind === "project" || isLive(item);
  const statusBadge = isOpen ? "" : `<span class="opp-status">${item.status === "closed" ? "Filled / closed" : "Past closing date"}</span>`;
  const industry = item.kind === "project" ? (item.projectType || "Home & trades") : item.industry;
  const description = String(item.description || "");
  const isLong = description.length > 220;
  const isExpanded = expanded.has(item.id);
  const trades = item.kind === "project" && Array.isArray(item.requiredTrades) && item.requiredTrades.length
    ? `<div class="opp-tags">${item.requiredTrades.slice(0, 5).map(trade => `<span>${escapeHtml(trade)}</span>`).join("")}</div>`
    : "";

  return `
    <article class="opp-card type-${type.id}${isOpen ? "" : " is-closed"}${isFeatured(item) ? " is-featured" : ""}">
      <div class="opp-card-top">
        ${isFeatured(item) ? `<span class="opp-featured-badge">&#9733; Featured</span>` : ""}
        ${item.kind === "employer" ? `<span class="opp-employer-badge">Employer post</span>` : ""}
        <span class="opp-type-badge">${escapeHtml(type.label)}</span>
        ${industry && industry !== "Other" ? `<span class="opp-industry">${escapeHtml(industry)}</span>` : ""}
        ${statusBadge}
      </div>
      <h3>${escapeHtml(item.title || "Untitled")}</h3>
      ${renderFacts(item)}
      ${description ? `<p class="opp-description${isLong && !isExpanded ? " is-clamped" : ""}">${escapeHtml(description)}</p>` : ""}
      ${isLong ? `<button type="button" class="opp-more" data-expand-opp="${item.id}">${isExpanded ? "Show less" : "Read more"}</button>` : ""}
      ${trades}
      <div class="opp-card-foot">
        ${renderPoster(item)}
        <div class="opp-actions">${renderActions(item)}</div>
      </div>
    </article>`;
}

function render() {
  renderTabs();
  const items = getVisibleItems();
  const liveTotal = livePool().length;
  els.count.textContent = els.mine.checked
    ? `${items.length} of your post${items.length === 1 ? "" : "s"}`
    : `Showing ${items.length} of ${liveTotal} open`;

  if (!items.length) {
    const nothingYet = !liveTotal && !els.mine.checked;
    els.results.innerHTML = `
      <div class="opp-empty">
        <strong>${nothingYet ? "No opportunities yet. Be the first to post one." : "Nothing matches those filters."}</strong>
        ${nothingYet ? `<button type="button" class="btn-primary" data-open-opportunity-form>Post an Opportunity</button>` : ""}
      </div>`;
    return;
  }
  els.results.innerHTML = items.map(renderCard).join("");
}

// ---------- form ----------

function fillSelect(select, options, placeholder) {
  select.innerHTML = `${placeholder ? `<option value="">${escapeHtml(placeholder)}</option>` : ""}${options.map(([value, label]) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("")}`;
}

function openForm(item = null) {
  editingId = item?.id || "";
  els.form.reset();
  els.formMessage.textContent = "";
  els.formHeading.textContent = item ? "Edit your opportunity" : "Post an opportunity";
  els.formSubmit.textContent = item ? "Save changes" : "Post opportunity";
  els.formSubmit.disabled = false;

  if (item) {
    els.formType.value = item.type;
    els.formTitle.value = item.title || "";
    els.formIndustry.value = item.industry || "";
    els.formDescription.value = item.description || "";
    els.formLocation.value = item.location || "";
    els.formRemote.checked = item.remote === true;
    els.formPay.value = item.pay || "";
    els.formClosing.value = item.closingDate || "";
    els.formLink.value = item.applyLink || "";
  }

  els.formClosing.min = todayString();
  els.modal.hidden = false;
  document.body.classList.add("opp-modal-open");
  els.formType.focus();
}

function closeForm() {
  els.modal.hidden = true;
  document.body.classList.remove("opp-modal-open");
  editingId = "";
}

function readForm() {
  const link = els.formLink.value.trim();
  const data = {
    type: els.formType.value,
    title: els.formTitle.value.trim(),
    industry: els.formIndustry.value,
    description: els.formDescription.value.trim(),
    location: els.formLocation.value.trim(),
    remote: els.formRemote.checked,
    pay: els.formPay.value.trim(),
    closingDate: els.formClosing.value || "",
    applyLink: link ? safeLink(/^https?:\/\//i.test(link) ? link : `https://${link}`) : ""
  };

  if (!TYPES.some(type => type.id === data.type)) return { error: "Choose what kind of opportunity this is." };
  if (data.title.length < 3) return { error: "Add a title (at least 3 characters)." };
  if (!data.industry) return { error: "Choose an industry." };
  if (data.description.length < 10) return { error: "Add a description (at least 10 characters)." };
  if (!data.location && !data.remote) return { error: "Add a location, or tick 'Can be done remotely'." };
  if (link && !data.applyLink) return { error: "That link doesn't look right. It should start with https://" };
  return { data };
}

async function submitForm(event) {
  event.preventDefault();
  if (!currentUser) {
    els.formMessage.textContent = "Still checking your account. Please try again in a moment.";
    return;
  }
  const { data, error } = readForm();
  if (error) {
    els.formMessage.textContent = error;
    return;
  }

  els.formSubmit.disabled = true;
  els.formMessage.textContent = editingId ? "Saving..." : "Posting...";

  try {
    if (editingId) {
      const existing = opportunities.find(item => item.id === editingId);
      await updateDoc(doc(db, "opportunities", editingId), { ...data, status: existing?.status || "open", updatedAt: serverTimestamp() });
    } else {
      await addDoc(collection(db, "opportunities"), {
        ...data,
        ownerId: currentUser.uid,
        status: "open",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
    }
    closeForm();
    await loadBoard();
  } catch (saveError) {
    console.error("Could not save opportunity:", saveError);
    els.formMessage.textContent = "Couldn't save that. Please check the details and try again.";
    els.formSubmit.disabled = false;
  }
}

// ---------- actions ----------

async function setStatus(id, status) {
  await updateDoc(doc(db, "opportunities", id), { status, updatedAt: serverTimestamp() });
  const item = opportunities.find(entry => entry.id === id);
  if (item) item.status = status;
  render();
}

async function deleteOpportunity(id) {
  if (!window.confirm("Delete this opportunity? This can't be undone.")) return;
  await deleteDoc(doc(db, "opportunities", id));
  opportunities = opportunities.filter(item => item.id !== id);
  render();
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("button, a");
  if (!target) return;

  if (target.matches("[data-open-opportunity-form]")) return openForm();
  if (target.matches("[data-close-opportunity-form]")) return closeForm();

  const { type, expandOpp, editOpp, closeOpp, reopenOpp, deleteOpp, adminCloseOpp, messageOpp, featureOpp, removeEmployerJob } = target.dataset;

  try {
    if (type && target.classList.contains("opp-type-tab")) {
      activeType = type;
      render();
    } else if (expandOpp) {
      expanded.has(expandOpp) ? expanded.delete(expandOpp) : expanded.add(expandOpp);
      render();
    } else if (editOpp) {
      openForm(opportunities.find(item => item.id === editOpp));
    } else if (closeOpp) {
      await setStatus(closeOpp, "closed");
    } else if (reopenOpp) {
      await setStatus(reopenOpp, "open");
    } else if (adminCloseOpp) {
      if (window.confirm("Close this opportunity? It will be hidden from the board.")) await setStatus(adminCloseOpp, "closed");
    } else if (deleteOpp) {
      await deleteOpportunity(deleteOpp);
    } else if (messageOpp) {
      target.disabled = true;
      target.textContent = "Opening chat...";
      await openConversationWithUser(currentUser.uid, messageOpp);
    } else if (removeEmployerJob) {
      if (!window.confirm("Take this employer job off the board?")) return;
      await updateDoc(doc(db, "employerJobs", removeEmployerJob), { status: "removed", reviewedAt: serverTimestamp(), reviewedBy: currentUser.uid });
      employerJobs = employerJobs.filter(item => item.id !== removeEmployerJob);
      render();
    } else if (featureOpp) {
      target.disabled = true;
      target.textContent = "Opening secure checkout...";
      try {
        await startPromotionCheckout("featured_opportunity", { opportunityId: featureOpp });
      } catch (checkoutError) {
        window.alert(checkoutError.message);
        render();
      }
      return;
    }
  } catch (error) {
    console.error("Opportunity action failed:", error);
    window.alert("Sorry, that didn't work. Please try again.");
    if (messageOpp) {
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
els.form.addEventListener("submit", submitForm);
[els.search, els.industry, els.sort, els.remote, els.mine].forEach(input => input.addEventListener("input", render));

// ---------- start ----------

fillSelect(els.industry, INDUSTRY_NAMES.map(name => [name, name]), "All industries");
fillSelect(els.formIndustry, INDUSTRY_NAMES.map(name => [name, name]), "Choose an industry");
fillSelect(els.formType, TYPES.map(type => [type.id, type.label]), "Choose a type");

// Back from Stripe after paying to feature a post.
if (new URLSearchParams(window.location.search).get("featured") === "paid") {
  const note = document.createElement("div");
  note.className = "opp-paid-note";
  note.setAttribute("role", "status");
  note.innerHTML = "<strong>Thank you!</strong> Your post is now featured at the top of the board for 14 days. It can take a minute to show.";
  els.results.before(note);
  history.replaceState(null, "", window.location.pathname);
}

const requestedType = new URLSearchParams(window.location.search).get("type");
if (ALL_TYPES.some(type => type.id === requestedType)) activeType = requestedType;
if (new URLSearchParams(window.location.search).get("post") === "1") openForm();

protectPage({
  onAllowed: (user, userData) => {
    currentUser = user;
    canModerate = isAdminUser(userData);
    loadBoard();
  }
});
