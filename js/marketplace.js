/*
  Marketplace: members sell things to each other (marketplaceListings collection).
  Buyers message the seller; payment and collection are sorted between them.
  Photos go to Storage under marketplacePhotos/{uid}/, shrunk in the browser first
  so listings load quickly on phones.
*/

import { db, storage } from "./firebase.js";
import { loadErrorHtml } from "./load-error.js";
import { protectPage } from "./subscription-guard.js";
import { getPublicProfiles, openConversationWithUser } from "./member-network.js";
import { escapeHtml, getCardIdentity, renderFramedPhoto } from "./directory-card.js";
import { isAdminUser } from "./roles.js";

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

import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

// Kept in step with validListing() in firestore.rules.
const CATEGORIES = [
  { id: "home-garden", label: "Home & Garden" },
  { id: "furniture", label: "Furniture" },
  { id: "electronics", label: "Electronics" },
  { id: "vehicles", label: "Cars & Vehicles" },
  { id: "clothing", label: "Clothing & Accessories" },
  { id: "baby-kids", label: "Baby & Kids" },
  { id: "sports-leisure", label: "Sports & Leisure" },
  { id: "books-music", label: "Books & Music" },
  { id: "tools-diy", label: "Tools & DIY" },
  { id: "cultural", label: "Sikh & Cultural" },
  { id: "other", label: "Other" }
];
const CONDITIONS = { "new": "New", "like-new": "Like new", "good": "Good", "fair": "Fair" };
const categoryLabel = id => (CATEGORIES.find(category => category.id === id) || { label: "Other" }).label;
const MAX_PHOTOS = 4;

const $ = id => document.getElementById(id);
const els = {
  count: $("mkCount"),
  results: $("mkResults"),
  tabs: $("mkCategoryTabs"),
  search: $("mkSearch"),
  sort: $("mkSort"),
  free: $("mkFree"),
  mine: $("mkMine"),
  formModal: $("mkFormModal"),
  form: $("mkForm"),
  formHeading: $("mkFormTitle"),
  formTitle: $("mkFormTitleInput"),
  formCategory: $("mkFormCategory"),
  formCondition: $("mkFormCondition"),
  formPrice: $("mkFormPrice"),
  formPriceType: $("mkFormPriceType"),
  formTown: $("mkFormTown"),
  formDescription: $("mkFormDescription"),
  formMessage: $("mkFormMessage"),
  formSubmit: $("mkFormSubmit"),
  photoList: $("mkPhotoList"),
  photoInput: $("mkPhotoInput"),
  photoAdd: $("mkPhotoAdd"),
  detailModal: $("mkDetailModal"),
  detailBody: $("mkDetailBody")
};

let currentUser = null;
let currentUserData = {};
let canModerate = false;
let listings = [];
let profiles = new Map();
let activeCategory = "all";
let editingId = null;
// Photos in the form: { url } for ones already uploaded, { file, preview } for new ones.
let formPhotos = [];

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
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

function formatPrice(item) {
  if (item.priceType === "free" || !item.price) return "Free";
  const amount = Number(item.price).toLocaleString("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: Number.isInteger(Number(item.price)) ? 0 : 2
  });
  return item.priceType === "offers" ? `${amount} ono` : amount;
}

function isMine(item) {
  return Boolean(currentUser && item.ownerId === currentUser.uid);
}

// ---------- Loading

async function loadListings() {
  try {
    const [activeSnap, mineSnap] = await Promise.all([
      getDocs(query(collection(db, "marketplaceListings"), where("status", "==", "active"))),
      getDocs(query(collection(db, "marketplaceListings"), where("ownerId", "==", currentUser.uid)))
    ]);
    const byId = new Map();
    [...activeSnap.docs, ...mineSnap.docs].forEach(snap => byId.set(snap.id, { id: snap.id, ...snap.data() }));
    listings = [...byId.values()];
    profiles = await getPublicProfiles(listings.map(item => item.ownerId));
    renderTabs();
    render();
    const openId = new URLSearchParams(window.location.search).get("listing");
    if (openId && byId.has(openId)) openDetail(openId);
  } catch (error) {
    console.error("Could not load the marketplace:", error);
    els.count.textContent = "Couldn't load listings";
    els.results.innerHTML = `<div class="opp-empty">${loadErrorHtml("the marketplace")}</div>`;
  }
}

// ---------- Browsing

function visibleListings() {
  const search = els.search.value.trim().toLowerCase();
  let items = els.mine.checked
    ? listings.filter(isMine)
    : listings.filter(item => item.status === "active");
  if (activeCategory !== "all") items = items.filter(item => item.category === activeCategory);
  if (els.free.checked) items = items.filter(item => item.priceType === "free" || !item.price);
  if (search) {
    items = items.filter(item => [item.title, item.description, item.town, categoryLabel(item.category)]
      .join(" ").toLowerCase().includes(search));
  }
  const newest = (a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);
  const price = item => (item.priceType === "free" ? 0 : Number(item.price) || 0);
  const sorters = {
    "newest": newest,
    "price-low": (a, b) => price(a) - price(b) || newest(a, b),
    "price-high": (a, b) => price(b) - price(a) || newest(a, b)
  };
  return items.sort(sorters[els.sort.value] || newest);
}

function renderTabs() {
  const active = listings.filter(item => item.status === "active");
  const counts = new Map(CATEGORIES.map(category => [category.id, active.filter(item => item.category === category.id).length]));
  const tabs = [{ id: "all", label: "All", count: active.length }, ...CATEGORIES.map(category => ({ ...category, count: counts.get(category.id) }))]
    .filter(tab => tab.id === "all" || tab.count > 0 || tab.id === activeCategory);
  els.tabs.innerHTML = tabs.map(tab => `
    <button type="button" role="tab" class="opp-type-tab${tab.id === activeCategory ? " is-active" : ""}" data-category="${tab.id}" aria-selected="${tab.id === activeCategory}">
      ${escapeHtml(tab.label)} <span>${tab.count}</span>
    </button>`).join("");
}

function statusBadge(item) {
  if (item.status === "sold") return `<span class="mk-badge is-sold">Sold</span>`;
  if (item.status === "removed") return `<span class="mk-badge is-removed">Taken down</span>`;
  return "";
}

function renderCard(item) {
  const cover = (item.photos || [])[0];
  return `
    <article class="mk-card${item.status !== "active" ? " is-inactive" : ""}">
      <button type="button" class="mk-card-open" data-open-listing="${escapeHtml(item.id)}" aria-label="${escapeHtml(item.title)}, ${escapeHtml(formatPrice(item))}">
        <span class="mk-card-photo">
          ${cover ? `<img src="${escapeHtml(cover)}" alt="" loading="lazy">` : `<span class="mk-card-nophoto" aria-hidden="true">No photo</span>`}
          ${statusBadge(item)}
        </span>
        <span class="mk-card-body">
          <strong class="mk-card-price">${escapeHtml(formatPrice(item))}</strong>
          <span class="mk-card-title">${escapeHtml(item.title)}</span>
          <small>${escapeHtml(item.town)} &middot; ${escapeHtml(timeAgo(item.createdAt))}</small>
        </span>
      </button>
    </article>`;
}

function render() {
  const items = visibleListings();
  const total = listings.filter(item => item.status === "active").length;
  els.count.textContent = els.mine.checked
    ? `${items.length} of your listing${items.length === 1 ? "" : "s"}`
    : `${items.length} of ${total} for sale`;

  if (!items.length) {
    const empty = els.mine.checked
      ? `<strong>You haven't listed anything yet.</strong><span>Tap "Sell something" to post your first item.</span>`
      : total
        ? `<strong>Nothing matches.</strong><span>Try another category or search.</span>`
        : `<strong>Nothing for sale yet.</strong><span>Be the first: tap "Sell something" to list an item.</span>`;
    els.results.innerHTML = `<div class="opp-empty">${empty}</div>`;
    return;
  }
  els.results.innerHTML = items.map(renderCard).join("");
}

// ---------- Listing detail

function openDetail(id) {
  const item = listings.find(listing => listing.id === id);
  if (!item) return;
  const owner = profiles.get(item.ownerId);
  const seller = owner ? getCardIdentity(owner) : "Sangat Works member";
  const photos = item.photos || [];
  const mine = isMine(item);

  const actions = [];
  if (mine) {
    if (item.status === "active") {
      actions.push(`<button type="button" class="btn-primary" data-mark-sold="${escapeHtml(item.id)}">Mark as sold</button>`);
      actions.push(`<button type="button" class="btn-secondary" data-edit-listing="${escapeHtml(item.id)}">Edit</button>`);
    } else if (item.status === "sold") {
      actions.push(`<button type="button" class="btn-secondary" data-relist="${escapeHtml(item.id)}">Put back on sale</button>`);
    }
    actions.push(`<button type="button" class="opp-danger" data-delete-listing="${escapeHtml(item.id)}">Delete</button>`);
  } else {
    actions.push(`<button type="button" class="btn-primary" data-message-seller="${escapeHtml(item.ownerId)}">Message seller</button>`);
    actions.push(`<button type="button" class="mk-link-button" data-report-listing="${escapeHtml(item.id)}">Report listing</button>`);
  }
  if (canModerate && !mine && item.status === "active") {
    actions.push(`<button type="button" class="opp-danger" data-remove-listing="${escapeHtml(item.id)}">Take down (admin)</button>`);
  }

  els.detailBody.innerHTML = `
    ${photos.length ? `
      <div class="mk-gallery">
        <img class="mk-gallery-main" id="mkGalleryMain" src="${escapeHtml(photos[0])}" alt="${escapeHtml(item.title)}">
        ${photos.length > 1 ? `<div class="mk-gallery-thumbs">${photos.map((url, index) => `
          <button type="button" class="mk-thumb${index === 0 ? " is-active" : ""}" data-show-photo="${escapeHtml(url)}" aria-label="Photo ${index + 1}">
            <img src="${escapeHtml(url)}" alt="" loading="lazy">
          </button>`).join("")}</div>` : ""}
      </div>` : ""}
    <div class="mk-detail-head">
      ${statusBadge(item)}
      <h2 id="mkDetailTitle">${escapeHtml(item.title)}</h2>
      <p class="mk-detail-price">${escapeHtml(formatPrice(item))}</p>
    </div>
    <dl class="mk-facts">
      <div><dt>Condition</dt><dd>${escapeHtml(CONDITIONS[item.condition] || "Good")}</dd></div>
      <div><dt>Category</dt><dd>${escapeHtml(categoryLabel(item.category))}</dd></div>
      <div><dt>Town</dt><dd>${escapeHtml(item.town)}</dd></div>
      <div><dt>Listed</dt><dd>${escapeHtml(timeAgo(item.createdAt))}</dd></div>
    </dl>
    ${item.description ? `<p class="mk-description">${escapeHtml(item.description)}</p>` : ""}
    <a class="opp-poster" href="view.html?id=${encodeURIComponent(item.ownerId)}">
      ${renderFramedPhoto(owner || {}, { className: "opp-poster-photo" })}
      <span><strong>${escapeHtml(seller)}</strong><small>${mine ? "Your listing" : "Seller"}</small></span>
    </a>
    <p class="mk-detail-message" id="mkDetailMessage" role="status"></p>
    <div class="mk-detail-actions">${actions.join("")}</div>
    ${mine ? "" : `<p class="mk-safety">Meet somewhere public, check the item before paying, and never pay a deposit to someone you haven't met.</p>`}`;

  els.detailModal.hidden = false;
  els.detailModal.querySelector(".opp-modal-close").focus();
  const url = new URL(window.location.href);
  url.searchParams.set("listing", id);
  history.replaceState(null, "", url);
}

function closeDetail() {
  els.detailModal.hidden = true;
  const url = new URL(window.location.href);
  url.searchParams.delete("listing");
  history.replaceState(null, "", url);
}

function setDetailMessage(text) {
  const message = document.getElementById("mkDetailMessage");
  if (message) message.textContent = text;
}

// ---------- Sell / edit form

function renderPhotoList() {
  els.photoList.innerHTML = formPhotos.map((photo, index) => `
    <span class="mk-photo-item">
      <img src="${escapeHtml(photo.url || photo.preview)}" alt="">
      ${index === 0 ? `<span class="mk-photo-cover">Cover</span>` : ""}
      <button type="button" class="mk-photo-remove" data-remove-photo="${index}" aria-label="Remove photo ${index + 1}">&times;</button>
    </span>`).join("");
  els.photoAdd.hidden = formPhotos.length >= MAX_PHOTOS;
}

function openForm(item = null) {
  editingId = item ? item.id : null;
  els.formHeading.textContent = item ? "Edit listing" : "Sell something";
  els.formSubmit.textContent = item ? "Save changes" : "Post listing";
  els.formTitle.value = item?.title || "";
  els.formCategory.value = item?.category || "";
  els.formCondition.value = item?.condition || "good";
  els.formPrice.value = item && item.priceType !== "free" ? item.price : "";
  els.formPriceType.value = item?.priceType || "fixed";
  els.formTown.value = item?.town || currentUserData.town || "";
  els.formDescription.value = item?.description || "";
  formPhotos = (item?.photos || []).map(url => ({ url }));
  els.formMessage.textContent = "";
  syncPriceField();
  renderPhotoList();
  closeDetail();
  els.formModal.hidden = false;
  els.formTitle.focus();
}

function closeForm() {
  els.formModal.hidden = true;
  formPhotos.forEach(photo => photo.preview && URL.revokeObjectURL(photo.preview));
  formPhotos = [];
  editingId = null;
}

function syncPriceField() {
  const free = els.formPriceType.value === "free";
  els.formPrice.disabled = free;
  if (free) els.formPrice.value = "";
}

// Shrink a photo to at most 1400px on its longest side as a JPEG.
async function shrinkPhoto(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return new Promise((resolve, reject) => canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error("Couldn't read that photo."))), "image/jpeg", 0.8));
}

async function uploadPhoto(photo) {
  if (photo.url) return photo.url;
  const blob = await shrinkPhoto(photo.file);
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
  const photoRef = ref(storage, `marketplacePhotos/${currentUser.uid}/${name}`);
  await uploadBytes(photoRef, blob, { contentType: "image/jpeg" });
  return getDownloadURL(photoRef);
}

async function deletePhotos(urls) {
  await Promise.all(urls.map(url => deleteObject(ref(storage, url)).catch(() => {})));
}

async function saveListing(event) {
  event.preventDefault();
  const title = els.formTitle.value.trim();
  const town = els.formTown.value.trim();
  const priceType = els.formPriceType.value;
  const price = priceType === "free" ? 0 : Number(els.formPrice.value);

  const problem = title.length < 3 ? "Add what you're selling (at least 3 characters)."
    : !els.formCategory.value ? "Choose a category."
      : priceType !== "free" && !(price > 0) ? "Add a price, or choose Free."
        : price > 1000000 ? "That price is too high."
          : town.length < 2 ? "Add your town."
            : "";
  if (problem) {
    els.formMessage.textContent = problem;
    return;
  }

  els.formSubmit.disabled = true;
  els.formMessage.textContent = formPhotos.some(photo => !photo.url) ? "Uploading photos..." : "Saving...";

  try {
    const photos = [];
    for (const photo of formPhotos) photos.push(await uploadPhoto(photo));
    const data = {
      ownerId: currentUser.uid,
      title,
      description: els.formDescription.value.trim(),
      price: Math.round(price * 100) / 100,
      priceType,
      category: els.formCategory.value,
      condition: els.formCondition.value,
      town,
      photos,
      updatedAt: serverTimestamp()
    };

    if (editingId) {
      const before = listings.find(item => item.id === editingId);
      await updateDoc(doc(db, "marketplaceListings", editingId), { ...data, status: before.status === "sold" ? "sold" : "active" });
      await deletePhotos((before.photos || []).filter(url => !photos.includes(url)));
      Object.assign(before, data, { updatedAt: new Date() });
    } else {
      const created = await addDoc(collection(db, "marketplaceListings"), { ...data, status: "active", createdAt: serverTimestamp() });
      listings.unshift({ id: created.id, ...data, status: "active", createdAt: new Date(), updatedAt: new Date() });
      if (!profiles.has(currentUser.uid)) profiles = new Map([...profiles, ...(await getPublicProfiles([currentUser.uid]))]);
    }
    const listingId = editingId;
    closeForm();
    renderTabs();
    render();
    if (listingId) openDetail(listingId);
  } catch (error) {
    console.error("Could not save listing:", error);
    els.formMessage.textContent = error?.code || error instanceof TypeError
      ? "Couldn't save. Your details are still here, so check your connection and try again."
      : error.message || "Couldn't save your listing. Please try again.";
  } finally {
    els.formSubmit.disabled = false;
  }
}

// ---------- Actions

async function handleAction(target) {
  const { openListing, editListing, markSold, relist, deleteListing, removeListing, messageSeller, reportListing, showPhoto } = target.dataset;
  const find = id => listings.find(item => item.id === id);

  try {
    if (openListing) {
      openDetail(openListing);
    } else if (showPhoto) {
      document.getElementById("mkGalleryMain").src = showPhoto;
      els.detailBody.querySelectorAll(".mk-thumb").forEach(thumb => thumb.classList.toggle("is-active", thumb === target));
    } else if (editListing) {
      openForm(find(editListing));
    } else if (markSold || relist) {
      const id = markSold || relist;
      const status = markSold ? "sold" : "active";
      target.disabled = true;
      await updateDoc(doc(db, "marketplaceListings", id), { status, updatedAt: serverTimestamp() });
      find(id).status = status;
      renderTabs();
      render();
      openDetail(id);
    } else if (deleteListing) {
      if (!window.confirm("Delete this listing? This can't be undone.")) return;
      const item = find(deleteListing);
      target.disabled = true;
      await deleteDoc(doc(db, "marketplaceListings", deleteListing));
      await deletePhotos(item.photos || []);
      listings = listings.filter(listing => listing.id !== deleteListing);
      closeDetail();
      renderTabs();
      render();
    } else if (removeListing) {
      if (!window.confirm("Take this listing down? The seller will see it as taken down.")) return;
      target.disabled = true;
      await updateDoc(doc(db, "marketplaceListings", removeListing), { status: "removed", updatedAt: serverTimestamp() });
      listings = listings.filter(listing => listing.id !== removeListing);
      closeDetail();
      renderTabs();
      render();
    } else if (messageSeller) {
      target.disabled = true;
      setDetailMessage("Opening your conversation...");
      await openConversationWithUser(currentUser.uid, messageSeller);
    } else if (reportListing) {
      const reason = window.prompt("What's wrong with this listing? (for example: scam, offensive, not allowed)");
      if (reason === null) return;
      if (reason.trim().length < 3) {
        setDetailMessage("Please say briefly what's wrong so we can check it.");
        return;
      }
      await addDoc(collection(db, "marketplaceReports"), {
        listingId: reportListing,
        reporterId: currentUser.uid,
        reason: reason.trim().slice(0, 500),
        status: "open",
        createdAt: serverTimestamp()
      });
      setDetailMessage("Thanks. Our team will take a look.");
    }
  } catch (error) {
    console.error("Marketplace action failed:", error);
    setDetailMessage(error?.code || error instanceof TypeError
      ? "That didn't work. Check your connection and try again."
      : error.message || "That didn't work. Please try again.");
    target.disabled = false;
  }
}

// ---------- Wiring

els.formCategory.innerHTML = `<option value="">Choose a category</option>${CATEGORIES.map(category =>
  `<option value="${category.id}">${escapeHtml(category.label)}</option>`).join("")}`;

document.addEventListener("click", event => {
  if (event.target.closest("[data-open-listing-form]")) openForm();
  if (event.target.closest("[data-close-listing-form]")) closeForm();
  if (event.target.closest("[data-close-listing-detail]")) closeDetail();
  const remove = event.target.closest("[data-remove-photo]");
  if (remove) {
    const [photo] = formPhotos.splice(Number(remove.dataset.removePhoto), 1);
    if (photo?.preview) URL.revokeObjectURL(photo.preview);
    renderPhotoList();
    return;
  }
  const action = event.target.closest("[data-open-listing], [data-edit-listing], [data-mark-sold], [data-relist], [data-delete-listing], [data-remove-listing], [data-message-seller], [data-report-listing], [data-show-photo]");
  if (action) handleAction(action);
});

els.tabs.addEventListener("click", event => {
  const tab = event.target.closest("[data-category]");
  if (!tab) return;
  activeCategory = tab.dataset.category;
  renderTabs();
  render();
});

[els.search, els.sort, els.free, els.mine].forEach(control => control.addEventListener("input", render));
els.formPriceType.addEventListener("change", syncPriceField);
els.form.addEventListener("submit", saveListing);

els.photoInput.addEventListener("change", () => {
  const files = [...els.photoInput.files].filter(file => file.type.startsWith("image/"));
  const room = MAX_PHOTOS - formPhotos.length;
  files.slice(0, room).forEach(file => formPhotos.push({ file, preview: URL.createObjectURL(file) }));
  if (files.length > room) els.formMessage.textContent = `You can add up to ${MAX_PHOTOS} photos.`;
  els.photoInput.value = "";
  renderPhotoList();
});

[els.formModal, els.detailModal].forEach(modal => modal.addEventListener("click", event => {
  if (event.target === els.formModal) closeForm();
  if (event.target === els.detailModal) closeDetail();
}));
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!els.formModal.hidden) closeForm();
  else if (!els.detailModal.hidden) closeDetail();
});

protectPage({
  onAllowed: (user, userData) => {
    currentUser = user;
    currentUserData = userData || {};
    canModerate = isAdminUser(userData);
    loadListings();
    if (new URLSearchParams(window.location.search).get("sell") === "1") openForm();
  }
});
