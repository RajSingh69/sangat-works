/*
  Super-admin framing for the site's own pictures (founder photos, SayVah images).

  Markup: <span class="site-image-frame ..." data-site-image="founder-rajan"><img ...></span>
  The frame sets the box; the saved framing in siteImages/{id} = { x, y, zoom }
  positions and zooms the picture inside it. Everyone sees the saved framing;
  only the super admin gets the "Adjust photo" button (Firestore rules enforce it).
*/

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { photoFramingStyle } from "./directory-card.js";
import { openPhotoFramer } from "./photo-framer.js";
import { isSuperAdmin } from "./roles.js";

const SITE_DEFAULT_FRAMING = Object.freeze({ x: 50, y: 50, zoom: 1 });
const frames = [...document.querySelectorAll("[data-site-image]")];
const savedFraming = {};

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
};

function framingFor(id) {
  const saved = savedFraming[id];
  const fallback = { ...SITE_DEFAULT_FRAMING, ...readDefault(id) };
  if (!saved) return fallback;
  return {
    x: clamp(saved.x, 0, 100, fallback.x),
    y: clamp(saved.y, 0, 100, fallback.y),
    zoom: clamp(saved.zoom, 1, 3, 1)
  };
}

// A frame can set its starting focus point, e.g. data-default-y="25" for a face.
function readDefault(id) {
  const frame = frames.find(item => item.dataset.siteImage === id);
  const result = {};
  if (frame?.dataset.defaultX) result.x = Number(frame.dataset.defaultX);
  if (frame?.dataset.defaultY) result.y = Number(frame.dataset.defaultY);
  return result;
}

function applyFraming(frame) {
  const image = frame.querySelector("img");
  if (image) image.style.cssText = photoFramingStyle(framingFor(frame.dataset.siteImage));
}

function addAdjustButton(frame) {
  if (frame.querySelector(".site-image-adjust")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "site-image-adjust";
  button.textContent = "Adjust photo";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSiteImageFramer(frame);
  });
  frame.appendChild(button);
}

function openSiteImageFramer(frame) {
  const id = frame.dataset.siteImage;
  const image = frame.querySelector("img");
  const rect = frame.getBoundingClientRect();
  if (!image || !rect.width || !rect.height) return;

  openPhotoFramer({
    imageUrl: image.currentSrc || image.src,
    heading: "Adjust photo",
    title: image.alt || "",
    aspectRatio: rect.width / rect.height,
    framing: framingFor(id),
    defaultFraming: { ...SITE_DEFAULT_FRAMING, ...readDefault(id) },
    onSave: async (framing) => {
      await setDoc(doc(db, "siteImages", id), {
        ...framing,
        updatedAt: serverTimestamp(),
        updatedBy: auth.currentUser.uid
      });
      savedFraming[id] = framing;
      applyFraming(frame);
    }
  });
}

async function loadSavedFraming() {
  try {
    const snapshot = await getDocs(collection(db, "siteImages"));
    snapshot.forEach(item => { savedFraming[item.id] = item.data(); });
  } catch (error) {
    console.error("Could not load site image framing:", error);
  }
  frames.forEach(applyFraming);
}

if (frames.length) {
  frames.forEach(applyFraming);
  loadSavedFraming();

  onAuthStateChanged(auth, async (user) => {
    if (!user) return;
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (snap.exists() && isSuperAdmin(snap.data())) frames.forEach(addAdjustButton);
    } catch (error) {
      console.error("Could not check admin role:", error);
    }
  });
}
