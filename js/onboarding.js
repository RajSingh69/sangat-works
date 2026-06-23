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
<div class="onboarding-overlay" id="onboardingOverlay">

  <div class="onboarding-modal">

    <div class="onboarding-progress" id="onboardingProgress">
      Step 1 of 6
    </div>

    <div class="onboarding-step active">
      <div class="onboarding-icon">🤝</div>
      <h2>Welcome to Sangat Works</h2>
      <p>
        A community platform built to help Sikhs find, support and recommend one another.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon">🏢</div>
      <h2>Create Your Profile</h2>
      <p>
        Showcase your business, experience, services, links and community involvement.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon">🔎</div>
      <h2>Discover Trusted People</h2>
      <p>
        Search electricians, tutors, accountants, developers, trades and professionals.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon">⭐</div>
      <h2>Reviews & Verification</h2>
      <p>
        Community reviews and verification badges help build trust.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon">🚀</div>
      <h2>Founding Members</h2>
      <p>
        The first 30 members join free for 1 year and help shape the future of the platform.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon">🙏</div>
      <h2>Support the Sangat</h2>
      <p>
        Strengthen community connections and keep opportunities within the Sangat where possible.
      </p>
    </div>

    <div class="onboarding-actions">
      <button id="onboardingPrev" class="btn-secondary">
        Previous
      </button>

      <button id="onboardingNext" class="btn-primary">
        Next
      </button>
    </div>

  </div>

</div>
`;

let currentStep = 0;

function showStep(index) {
  const steps = document.querySelectorAll(".onboarding-step");

  steps.forEach((step, i) => {
    step.classList.toggle("active", i === index);
  });

  document.getElementById(
    "onboardingProgress"
  ).textContent = `Step ${index + 1} of ${steps.length}`;

  const nextBtn = document.getElementById("onboardingNext");

  if (index === steps.length - 1) {
    nextBtn.textContent = "Get Started";
  } else {
    nextBtn.textContent = "Next";
  }
}

async function completeOnboarding(uid) {
  try {
    await updateDoc(doc(db, "users", uid), {
      hasSeenIntro: true
    });
  } catch (error) {
    console.error(error);
  }

  document.getElementById("onboardingOverlay")?.remove();
}

onAuthStateChanged(auth, async (user) => {

  if (!user) return;

  const userRef = doc(db, "users", user.uid);
  const userSnap = await getDoc(userRef);

  if (!userSnap.exists()) return;

  const userData = userSnap.data();

  if (userData.hasSeenIntro === true) {
    return;
  }

  document.body.insertAdjacentHTML(
    "beforeend",
    onboardingHTML
  );

  showStep(0);

  const steps =
    document.querySelectorAll(".onboarding-step");

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
        await completeOnboarding(user.uid);
      }

    });

});