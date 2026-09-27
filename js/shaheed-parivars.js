import { db, storage } from "./firebase.js";

import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  getDownloadURL,
  ref,
  uploadBytesResumable
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
const MAX_VIDEO_SECONDS = 60;

const form = document.getElementById("parivarMessageForm");
const nameInput = document.getElementById("parivarName");
const emailInput = document.getElementById("parivarEmail");
const messageInput = document.getElementById("parivarMessage");
const messageCount = document.getElementById("parivarMessageCount");
const videoInput = document.getElementById("parivarVideo");
const consentInput = document.getElementById("parivarConsent");
const submitButton = document.getElementById("parivarSubmit");
const formMessage = document.getElementById("parivarFormMessage");
const progress = document.getElementById("parivarProgress");
const progressFill = document.getElementById("parivarProgressFill");
const wall = document.getElementById("parivarWall");

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function setFormMessage(text, isError = false) {
  formMessage.textContent = text;
  formMessage.classList.toggle("error", isError);
}

function getVideoDuration(file) {
  return new Promise(resolve => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    video.src = url;
  });
}

function getVideoExtension(file) {
  const fromName = (file.name.split(".").pop() || "").toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(fromName)) return fromName;
  return (file.type.split("/")[1] || "mp4").replace(/[^a-z0-9]/g, "").slice(0, 5) || "mp4";
}

async function validateVideo(file) {
  if (!file) return "";
  if (!file.type.startsWith("video/")) return "Please choose a video file.";
  if (file.size > MAX_VIDEO_BYTES) return "That video is over 50MB. Please choose a shorter one.";

  const duration = await getVideoDuration(file);
  if (duration && duration > MAX_VIDEO_SECONDS + 1) {
    return `That video is ${Math.round(duration)} seconds. Please keep it to 60 seconds or less.`;
  }
  return "";
}

function uploadVideo(path, file) {
  return new Promise((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), file, { contentType: file.type });
    progress.classList.remove("hidden");
    task.on(
      "state_changed",
      snapshot => {
        progressFill.style.width = `${Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100)}%`;
      },
      reject,
      resolve
    );
  });
}

messageInput?.addEventListener("input", () => {
  messageCount.textContent = `${messageInput.value.length} / 1000`;
});

form?.addEventListener("submit", async event => {
  event.preventDefault();

  const name = nameInput.value.trim();
  const email = emailInput.value.trim();
  const message = messageInput.value.trim();
  const video = videoInput.files[0] || null;

  if (!name || !message) return setFormMessage("Please add your name and a message.", true);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return setFormMessage("Please enter a valid email address.", true);
  if (!consentInput.checked) return setFormMessage("Please tick the box to confirm your message can be shown.", true);

  submitButton.disabled = true;
  setFormMessage(video ? "Checking your video..." : "Sending your message...");

  try {
    const videoError = await validateVideo(video);
    if (videoError) {
      setFormMessage(videoError, true);
      submitButton.disabled = false;
      return;
    }

    const messageRef = doc(collection(db, "parivarMessages"));
    const videoPath = video ? `parivarVideos/${messageRef.id}/video.${getVideoExtension(video)}` : "";

    const batch = writeBatch(db);
    batch.set(messageRef, {
      name,
      message,
      videoPath,
      status: "pending",
      createdAt: serverTimestamp()
    });
    batch.set(doc(db, "parivarMessageContacts", messageRef.id), {
      email,
      createdAt: serverTimestamp()
    });
    await batch.commit();

    if (video) {
      setFormMessage("Uploading your video...");
      await uploadVideo(videoPath, video);
    }

    form.reset();
    messageCount.textContent = "0 / 1000";
    progress.classList.add("hidden");
    progressFill.style.width = "0%";
    setFormMessage("Thank you. Your message has been sent and will appear here once it's been reviewed.");
  } catch (error) {
    console.error("Could not send message:", error);
    setFormMessage("Sorry, your message couldn't be sent. Please try again.", true);
  } finally {
    submitButton.disabled = false;
  }
});

function formatDate(value) {
  const date = value?.toDate ? value.toDate() : null;
  return date ? date.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }) : "";
}

async function renderMessageCard(item) {
  let videoHtml = "";
  if (item.videoPath) {
    try {
      const url = await getDownloadURL(ref(storage, item.videoPath));
      videoHtml = `<video src="${escapeHtml(url)}" controls preload="metadata" playsinline></video>`;
    } catch (error) {
      console.warn("Video unavailable:", error);
    }
  }

  return `
    <article class="story-card parivar-message">
      ${videoHtml}
      <p>${escapeHtml(item.message)}</p>
      <strong>${escapeHtml(item.name)}</strong>
      <small>${escapeHtml(formatDate(item.createdAt))}</small>
    </article>
  `;
}

async function loadWall() {
  if (!wall) return;

  try {
    const snapshot = await getDocs(query(collection(db, "parivarMessages"), where("status", "==", "approved")));
    const items = snapshot.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    if (!items.length) {
      wall.innerHTML = `<p class="story-lead">No messages yet. Be the first to <a href="#send-thanks">say thank you</a>.</p>`;
      return;
    }

    wall.innerHTML = (await Promise.all(items.map(renderMessageCard))).join("");
  } catch (error) {
    console.error("Could not load messages:", error);
    wall.innerHTML = `<p class="story-lead">Messages couldn't be loaded right now.</p>`;
  }
}

loadWall();
