import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const questionForm = document.getElementById("questionForm");
const questionName = document.getElementById("questionName");
const questionText = document.getElementById("questionText");
const questionMessage = document.getElementById("questionMessage");

const featureForm = document.getElementById("featureForm");
const featureName = document.getElementById("featureName");
const featureText = document.getElementById("featureText");
const featureMessage = document.getElementById("featureMessage");

const faqList = document.getElementById("faqList");

let currentUser = null;

onAuthStateChanged(auth, (user) => {
  currentUser = user;

  const defaultName = user?.displayName || user?.email || "";

  if (defaultName) {
    if (questionName && !questionName.value) {
      questionName.value = defaultName;
    }

    if (featureName && !featureName.value) {
      featureName.value = defaultName;
    }
  }
});

async function submitFaq(type, nameInput, textInput, messageBox) {
  if (!nameInput || !textInput || !messageBox) return;

  try {
    messageBox.textContent = "Submitting...";

    await addDoc(collection(db, "faqs"), {
      type,
      name: nameInput.value.trim(),
      question: textInput.value.trim(),
      answer: "",
      status: "pending",
      userId: currentUser ? currentUser.uid : null,
      userEmail: currentUser ? currentUser.email : null,
      createdAt: serverTimestamp()
    });

    textInput.value = "";
    messageBox.textContent = "Submitted. An admin can review and respond soon.";
  } catch (error) {
    messageBox.textContent = error.message;
  }
}

async function loadAnsweredFaqs() {
  if (!faqList) return;

  faqList.innerHTML = `<div class="empty-state">Loading FAQs...</div>`;

  const faqQuery = query(
    collection(db, "faqs"),
    where("status", "==", "answered"),
    orderBy("createdAt", "desc")
  );

  const snapshot = await getDocs(faqQuery);

  if (snapshot.empty) {
    faqList.innerHTML = `
      <div class="empty-state">
        No answered FAQs yet.
      </div>
    `;
    return;
  }

  faqList.innerHTML = "";

  snapshot.forEach((docSnap) => {
    const faq = docSnap.data();

    const typeLabel =
      faq.type === "feature"
        ? "Feature Request"
        : "Question / Comment";

    const card = document.createElement("div");
    card.className = "feature-card";

    card.innerHTML = `
      <p class="eyebrow">${typeLabel}</p>
      <h3>${faq.question || "Question"}</h3>
      <p>${faq.answer || ""}</p>
      <small>Asked by ${faq.name || "Sangat Member"}</small>
    `;

    faqList.appendChild(card);
  });
}

if (questionForm) {
  questionForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitFaq("question", questionName, questionText, questionMessage);
  });
}

if (featureForm) {
  featureForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await submitFaq("feature", featureName, featureText, featureMessage);
  });
}

loadAnsweredFaqs();