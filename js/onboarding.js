import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const onboardingHTML = `
<div class="onboarding-overlay" id="onboardingOverlay" role="dialog" aria-modal="true" aria-labelledby="onboardingTitle0">

  <div class="onboarding-modal">

    <div class="onboarding-top">
      <div class="onboarding-progress" id="onboardingProgress">
        Step 1 of 4
      </div>
      <button type="button" class="onboarding-skip" id="onboardingSkip">Skip</button>
    </div>

    <div class="onboarding-step active">
      <div class="onboarding-icon"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="9" r="2.5"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6M15 14.5c3 0 6 1.8 6 5"/></svg></div>
      <h2 id="onboardingTitle0">Welcome to Sangat Works</h2>
      <p>
        You're in. Sangat Works helps Sikhs across the UK find, hire and recommend
        each other: businesses, tradespeople, professionals and students.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></svg></div>
      <h2>First, fill in your profile</h2>
      <p>
        Add a photo, what you do and your town. That's what puts you in the Directory
        and on the Map, and a fuller profile appears higher up.
      </p>
      <p>
        Add your Gurdwara too and you'll show up in its Gurdwara Network.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></div>
      <h2>Find people and work</h2>
      <p>
        Search the Directory and Map for anyone in the Sangat. Opportunities has jobs,
        freelance work, mentoring and seva, and Young Professionals connects students
        and graduates with mentors.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon"><svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z"/></svg></div>
      <h2>Tell us what you think</h2>
      <p>
        Sangat Works is new and growing. Ask questions or suggest features on the
        FAQ page, and we'll build what members ask for.
      </p>
    </div>

    <div class="onboarding-actions">
      <button id="onboardingPrev" class="btn-secondary" type="button">
        Back
      </button>

      <button id="onboardingNext" class="btn-primary" type="button">
        Next
      </button>
    </div>

  </div>

</div>
`;

let currentStep = 0;

function openOnboarding(uid = "") {
  document.getElementById("onboardingOverlay")?.remove();
  currentStep = 0;

  document.body.insertAdjacentHTML(
    "beforeend",
    onboardingHTML
  );

  showStep(0);

  const steps = document.querySelectorAll(".onboarding-step");

  document
    .getElementById("onboardingPrev")
    .addEventListener("click", () => {
      if (currentStep > 0) {
        currentStep--;
        showStep(currentStep);
      }
    });

  document
    .getElementById("onboardingNext")
    .addEventListener("click", async () => {
      if (currentStep < steps.length - 1) {
        currentStep++;
        showStep(currentStep);
      } else {
        await completeOnboarding(uid);
        goToProfileForm();
      }
    });

  document
    .getElementById("onboardingSkip")
    .addEventListener("click", () => completeOnboarding(uid));

  document.addEventListener("keydown", function closeOnEscape(event) {
    if (event.key !== "Escape") return;
    document.removeEventListener("keydown", closeOnEscape);
    completeOnboarding(uid);
  });

  document.getElementById("onboardingNext").focus();
}

// The tour ends where new members need to be: the profile form.
function goToProfileForm() {
  const form = document.getElementById("profileForm");
  if (!form) {
    window.location.href = "profile.html#profileForm";
    return;
  }
  form.scrollIntoView({ behavior: "smooth", block: "start" });
  form.querySelector("input:not([type=file]), textarea")?.focus({ preventScroll: true });
}

function showStep(index) {
  const steps = document.querySelectorAll(".onboarding-step");

  steps.forEach((step, i) => {
    step.classList.toggle("active", i === index);
  });

  document.getElementById(
    "onboardingProgress"
  ).textContent = `Step ${index + 1} of ${steps.length}`;

  const prevBtn = document.getElementById("onboardingPrev");
  const nextBtn = document.getElementById("onboardingNext");

  if (prevBtn) {
    prevBtn.style.display = index === 0 ? "none" : "inline-flex";
  }

  if (nextBtn) {
    nextBtn.textContent = index === steps.length - 1
      ? "Set up my profile"
      : "Next";
  }
}

async function completeOnboarding(uid) {
  try {
    if (uid) {
      await updateDoc(doc(db, "users", uid), {
        hasSeenIntro: true
      });
    }
  } catch (error) {
    console.error(error);
  }

  document.getElementById("onboardingOverlay")?.remove();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) return;

  window.addEventListener("openSangatWorksWalkthrough", () => {
    openOnboarding(user.uid);
  });

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) return;

  const userData = userSnap.data();

  if (userData.hasSeenIntro === true) {
    return;
  }

  openOnboarding(user.uid);
});
