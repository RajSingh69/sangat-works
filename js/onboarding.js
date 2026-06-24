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
        Sangat Works helps Sikhs find, support and recommend trusted businesses,
        tradespeople, professionals and community members across the UK.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon">🗺️</div>
      <h2>Directory & Map</h2>
      <p>
        Use the Directory and Map to search for Sikh businesses, services and
        professionals by skill, location, Gurdwara, rating and featured status.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon">🤝</div>
      <h2>Gurdwara Skills Network</h2>
      <p>
        Join skill pools linked to your Gurdwara, such as construction, technology,
        business, healthcare and other community networks.
      </p>
      <p>
        You can apply for roles inside each pool, discover trusted members and help
        build useful connections within your local Sangat.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon">🎓</div>
      <h2>Young Professionals</h2>
      <p>
        Young Professionals helps Sikh students, graduates and working professionals
        connect, network and discover opportunities for collaboration, mentorship
        and career growth.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon">💡</div>
      <h2>FAQs & Suggestions</h2>
      <p>
        Use FAQs & Suggestions to ask questions, share feedback and suggest features
        you would like to see added to Sangat Works.
      </p>
      <p>
        The platform is still growing, so community feedback directly helps shape
        what gets built next.
      </p>
    </div>

    <div class="onboarding-step">
      <div class="onboarding-icon">⭐</div>
      <h2>Membership Benefits</h2>
      <p>
        Membership unlocks access to the Directory, Map, Young Professionals,
        Gurdwara Skills Network, Featured Listings and future community tools.
      </p>
      <p>
        Every member helps strengthen the Sangat by supporting businesses,
        sharing opportunities and building trusted connections.
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

  const prevBtn = document.getElementById("onboardingPrev");
  const nextBtn = document.getElementById("onboardingNext");

  if (prevBtn) {
    prevBtn.style.display = index === 0 ? "none" : "inline-flex";
  }

  if (nextBtn) {
    nextBtn.textContent = index === steps.length - 1
      ? "Join the Sangat"
      : "Next";
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
        await completeOnboarding(user.uid);
      }
    });
});