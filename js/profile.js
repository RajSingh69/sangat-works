import { auth, db, storage } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  increment,
  serverTimestamp,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const profileForm = document.getElementById("profileForm");
const profileMessage = document.getElementById("profileMessage");
const publicProfile = document.getElementById("publicProfile");

const gurdwaraSelect = document.getElementById("gurdwaraSelect");
const newGurdwaraName = document.getElementById("newGurdwaraName");
const associatedGurdwaraInput = document.getElementById("associatedGurdwara");

let currentUser = null;
let existingProfile = {};

const profileStrengthPercent = document.getElementById("profileStrengthPercent");
const profileStrengthFill = document.getElementById("profileStrengthFill");
const profileStrengthChecklist = document.getElementById("profileStrengthChecklist");

const membershipPlan = document.getElementById("membershipPlan");
const membershipStatus = document.getElementById("membershipStatus");
const membershipExpiry = document.getElementById("membershipExpiry");
const membershipDays = document.getElementById("membershipDays");

const dashboardReviews = document.getElementById("dashboardReviews");
const dashboardRecommendations = document.getElementById("dashboardRecommendations");
const dashboardViews = document.getElementById("dashboardViews");
const dashboardTrustScore = document.getElementById("dashboardTrustScore");
const dashboardMemberLevel = document.getElementById("dashboardMemberLevel");

const dashboardWebsiteClicks = document.getElementById("dashboardWebsiteClicks");
const dashboardLinkedInClicks = document.getElementById("dashboardLinkedInClicks");
const dashboardGoogleClicks = document.getElementById("dashboardGoogleClicks");

function calculateProfileStrength(profile) {
  const checks = [
    {
      label: "Add a profile photo",
      complete: !!profile.profilePhotoUrl
    },
    {
      label: "Add a business logo",
      complete: !!profile.businessLogoUrl
    },
    {
      label: "Add your business or profile name",
      complete: !!profile.businessName || !!profile.fullName
    },
    {
      label: "Add a service title",
      complete: !!profile.serviceTitle
    },
    {
      label: "Add a description",
      complete: !!profile.description
    },
    {
      label: "Add tags",
      complete: (profile.tags || []).length > 0
    },
    {
      label: "Add your town/location",
      complete: !!profile.town
    },
    {
      label: "Add years of experience",
      complete: !!profile.yearsExperience
    },
    {
      label: "Add specialist work/projects",
      complete: !!profile.specialistWork
    },
    {
      label: "Add Gurdwara/Sangat association",
      complete: !!profile.associatedGurdwara
    },
    {
      label: "Add website or LinkedIn",
      complete: !!profile.website || !!profile.linkedin
    },
    {
      label: "Add 2 fun facts",
      complete: !!profile.funFactOne && !!profile.funFactTwo
    }
  ];

  const completed = checks.filter(check => check.complete).length;
  const percent = Math.round((completed / checks.length) * 100);

  if (profileStrengthPercent) {
    profileStrengthPercent.textContent = `${percent}%`;
  }

  if (profileStrengthFill) {
    profileStrengthFill.style.width = `${percent}%`;
  }

  if (profileStrengthChecklist) {
    profileStrengthChecklist.innerHTML = checks
      .map(check => `
        <li class="${check.complete ? "complete" : ""}">
          ${check.complete ? "✓" : "○"} ${check.label}
        </li>
      `)
      .join("");
  }
}


function formatSubscriptionPlan(profile) {
  if (profile.isFoundingMember === true) {
    return "Founding Member";
  }

  if (profile.subscriptionPlan === "yearly") {
    return "Yearly Member";
  }

  if (profile.subscriptionPlan === "monthly") {
    return "Monthly Member";
  }

  if (profile.hasSubscription === true) {
    return "Active Member";
  }

  return "Free";
}

function calculateDaysRemaining(profile) {
  if (!profile.subscriptionExpiresAt) {
    return profile.hasSubscription === true ? "Active" : "0";
  }

  const expiryDate = profile.subscriptionExpiresAt.toDate
    ? profile.subscriptionExpiresAt.toDate()
    : new Date(profile.subscriptionExpiresAt);

  const today = new Date();
  const diffMs = expiryDate - today;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return diffDays > 0 ? diffDays : 0;
}


function formatExpiryDate(profile) {
  if (!profile.subscriptionExpiresAt) {
    return "-";
  }

  const expiryDate = profile.subscriptionExpiresAt.toDate
    ? profile.subscriptionExpiresAt.toDate()
    : new Date(profile.subscriptionExpiresAt);

  if (Number.isNaN(expiryDate.getTime())) {
    return "-";
  }

  return expiryDate.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}


function renderMembershipStatus(profile) {
  if (!membershipPlan || !membershipStatus || !membershipExpiry || !membershipDays) return;

  const isActive =
    profile.hasSubscription === true ||
    profile.subscriptionStatus === "active" ||
    profile.isFoundingMember === true;

  membershipPlan.textContent = formatSubscriptionPlan(profile);
  membershipStatus.textContent = isActive ? "Active" : "Inactive";
  membershipExpiry.textContent = formatExpiryDate(profile);
  membershipDays.textContent = calculateDaysRemaining(profile);

}


function renderMemberDashboard(profile) {
  if (
    !dashboardReviews ||
    !dashboardRecommendations ||
    !dashboardViews ||
    !dashboardTrustScore ||
    !dashboardMemberLevel
  ) {
    return;
  }

  const reviews = profile.reviewCount || 0;
  const recommendations = profile.recommendationCount || 0;
  const views = profile.profileViews || 0;

  const trustScore = Math.min(
    100,
    Math.round(
      reviews * 10 +
      recommendations * 6 +
      views * 0.2
    )
  );

  dashboardReviews.textContent = reviews;
  dashboardRecommendations.textContent = recommendations;
  dashboardViews.textContent = views;
  dashboardTrustScore.textContent = trustScore;

  if (dashboardWebsiteClicks) {
    dashboardWebsiteClicks.textContent = profile.websiteClicks || 0;
  }

  if (dashboardLinkedInClicks) {
    dashboardLinkedInClicks.textContent = profile.linkedinClicks || 0;
  }

  if (dashboardGoogleClicks) {
    dashboardGoogleClicks.textContent = profile.googleReviewClicks || 0;
  }

  if (trustScore >= 80) {
    dashboardMemberLevel.textContent = "Highly Trusted Member";
  } else if (trustScore >= 50) {
    dashboardMemberLevel.textContent = "Trusted Member";
  } else if (trustScore >= 20) {
    dashboardMemberLevel.textContent = "Growing Community Member";
  } else {
    dashboardMemberLevel.textContent = "Community Member";
  }
}


function getTags(tagsString) {
  return tagsString
    .split(",")
    .map(tag => tag.trim().toLowerCase())
    .filter(tag => tag.length > 0);
}

function value(id) {
  return document.getElementById(id)?.value.trim() || "";
}

function checked(id) {
  return document.getElementById(id)?.checked || false;
}

async function loadGurdwaras(selectedGurdwaraId = "") {
  if (!gurdwaraSelect) return;

  gurdwaraSelect.innerHTML = `
    <option value="">Select your Gurdwara</option>
    <option value="add-new">+ Add New Gurdwara</option>
  `;

  const gurdwarasQuery = query(
    collection(db, "gurdwaras"),
    orderBy("name", "asc")
  );

  const snapshot = await getDocs(gurdwarasQuery);

  snapshot.forEach((docSnap) => {
    const gurdwara = docSnap.data();

    const option = document.createElement("option");
    option.value = docSnap.id;
    option.textContent = gurdwara.name || "Unnamed Gurdwara";

    gurdwaraSelect.insertBefore(option, gurdwaraSelect.querySelector('option[value="add-new"]'));
  });

  if (selectedGurdwaraId) {
    gurdwaraSelect.value = selectedGurdwaraId;
  }
}

function setupGurdwaraSelect() {
  if (!gurdwaraSelect || !newGurdwaraName) return;

  gurdwaraSelect.addEventListener("change", () => {
    if (gurdwaraSelect.value === "add-new") {
      newGurdwaraName.style.display = "block";
      newGurdwaraName.required = true;
    } else {
      newGurdwaraName.style.display = "none";
      newGurdwaraName.required = false;
      newGurdwaraName.value = "";
    }
  });
}

async function uploadImage(file, folder, uid) {
  if (!file) return null;

  const filePath = `${folder}/${uid}/${Date.now()}-${file.name}`;
  const imageRef = ref(storage, filePath);

  await uploadBytes(imageRef, file);
  return await getDownloadURL(imageRef);
}

function fillForm(profile) {
  document.getElementById("fullName").value = profile.fullName || "";
  document.getElementById("businessName").value = profile.businessName || "";
  document.getElementById("serviceTitle").value = profile.serviceTitle || "";
  document.getElementById("description").value = profile.description || "";
  document.getElementById("whyContact").value = profile.whyContact || "";
  document.getElementById("tags").value = (profile.tags || []).join(", ");

  document.getElementById("yearsExperience").value = profile.yearsExperience || "";
  document.getElementById("specialistWork").value = profile.specialistWork || "";
  document.getElementById("googleReviews").value = profile.googleReviews || "";

  if (gurdwaraSelect) {
    gurdwaraSelect.value = profile.gurdwaraId || "";
  }

  if (associatedGurdwaraInput) {
    associatedGurdwaraInput.value = profile.gurdwaraName || profile.associatedGurdwara || "";
  }
  document.getElementById("communityDiscount").value = profile.communityDiscount || "not-specified";

  document.getElementById("funFactOne").value = profile.funFactOne || "";
  document.getElementById("funFactTwo").value = profile.funFactTwo || "";

  document.getElementById("phone").value = profile.phone || "";
  document.getElementById("email").value = profile.email || "";
  document.getElementById("website").value = profile.website || "";
  document.getElementById("linkedin").value = profile.linkedin || "";

  document.getElementById("town").value = profile.town || "";
  document.getElementById("postcode").value = profile.postcode || "";
  document.getElementById("serviceArea").value = profile.serviceArea || "";

  document.getElementById("layoutStyle").value = profile.layoutStyle || "classic";
  document.getElementById("themeColour").value = profile.themeColour || "gold";

  document.getElementById("isPublic").checked = profile.isPublic !== false;
  document.getElementById("showPhone").checked = profile.showPhone === true;
  document.getElementById("showEmail").checked = profile.showEmail === true;
  document.getElementById("showPostcode").checked = profile.showPostcode === true;
  document.getElementById("showGurdwara").checked = profile.showGurdwara !== false;
  document.getElementById("showGoogleReviews").checked = profile.showGoogleReviews !== false;
}

function renderProfile(profile) {
  const tags = profile.tags || [];
  const tagsHtml = tags.map(tag => `<span class="tag">${tag}</span>`).join("");

  const membershipBadge = profile.isFoundingMember
  ? `<span class="trust-badge verified">★ Founding Member #${profile.memberNumber || ""} — Free 1 Year</span>`
  : "";

  const discountText = {
    yes: "Offers Sangat/community rates where possible",
    sometimes: "May offer community rates depending on the job",
    no: "No fixed discount, but supports fair pricing",
    "not-specified": "Not specified"
  };

  return `
    <div class="public-profile-card theme-${profile.themeColour || "gold"}">

      <div class="profile-visual-row">
        ${profile.profilePhotoUrl ? `<img src="${profile.profilePhotoUrl}" class="profile-image" alt="Profile photo">` : ""}
        ${profile.businessLogoUrl ? `<img src="${profile.businessLogoUrl}" class="logo-image" alt="Business logo">` : ""}
      </div>

      <h1>${profile.businessName || profile.fullName}</h1>
      <p class="service">${profile.serviceTitle || ""}</p>

      <div class="badges-row">
        ${membershipBadge}
      </div>

      <p>${profile.description || ""}</p>

      ${profile.whyContact ? `<p><strong>Why contact me:</strong> ${profile.whyContact}</p>` : ""}

      <div class="tags">${tagsHtml}</div>

      <p><strong>Name:</strong> ${profile.fullName || ""}</p>
      <p><strong>Location:</strong> ${profile.town || "Location not provided"} ${profile.showPostcode ? profile.postcode || "" : ""}</p>
      ${profile.serviceArea ? `<p><strong>Service area:</strong> ${profile.serviceArea}</p>` : ""}

      ${profile.yearsExperience ? `<p><strong>Experience:</strong> ${profile.yearsExperience} years</p>` : ""}
      ${profile.specialistWork ? `<p><strong>Specialist work:</strong> ${profile.specialistWork}</p>` : ""}

      ${profile.showGurdwara && profile.associatedGurdwara ? `<p><strong>Associated Sangat/Gurdwara:</strong> ${profile.associatedGurdwara}</p>` : ""}

      <p><strong>Community support:</strong> ${discountText[profile.communityDiscount] || "Not specified"}</p>

      ${profile.funFactOne || profile.funFactTwo ? `
        <div class="fun-facts">
          <h3>Fun facts</h3>
          ${profile.funFactOne ? `<p>• ${profile.funFactOne}</p>` : ""}
          ${profile.funFactTwo ? `<p>• ${profile.funFactTwo}</p>` : ""}
        </div>
      ` : ""}

      ${profile.showPhone ? `<p><strong>Phone:</strong> ${profile.phone || "Not provided"}</p>` : ""}
      ${profile.showEmail ? `<p><strong>Email:</strong> ${profile.email || "Not provided"}</p>` : ""}

      <div class="card-links">
        ${profile.website ? `<a href="${profile.website}" target="_blank" class="tracked-link" data-click-type="websiteClicks">Website</a>` : ""}
        ${profile.linkedin ? `<a href="${profile.linkedin}" target="_blank" class="tracked-link" data-click-type="linkedinClicks">LinkedIn</a>` : ""}
        ${profile.showGoogleReviews && profile.googleReviews ? `<a href="${profile.googleReviews}" target="_blank" class="tracked-link" data-click-type="googleReviewClicks">Google Reviews</a>` : ""}
      </div>
    </div>
  `;
}

if (profileForm) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }

    currentUser = user;

    setupGurdwaraSelect();

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      existingProfile = userSnap.data();
      await loadGurdwaras(existingProfile.gurdwaraId || "");
      fillForm(existingProfile);
      calculateProfileStrength(existingProfile);
      renderMembershipStatus(existingProfile);
      renderMemberDashboard(existingProfile);


    } else {
      existingProfile = {
        fullName: user.displayName || "",
        email: user.email || ""
      };
      await loadGurdwaras();
      fillForm(existingProfile);
    }


  });

  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!currentUser) {
      profileMessage.textContent = "You need to be logged in.";
      return;
    }

    try {
      profileMessage.textContent = "Saving profile...";

      const profilePhotoFile = document.getElementById("profilePhoto")?.files[0];
      const businessLogoFile = document.getElementById("businessLogo")?.files[0];

      let profilePhotoUrl = existingProfile.profilePhotoUrl || "";
      let businessLogoUrl = existingProfile.businessLogoUrl || "";

      if (profilePhotoFile) {
        profileMessage.textContent = "Uploading profile photo...";
        profilePhotoUrl = await uploadImage(profilePhotoFile, "profilePhotos", currentUser.uid);
      }

      if (businessLogoFile) {
        profileMessage.textContent = "Uploading business logo...";
        businessLogoUrl = await uploadImage(businessLogoFile, "businessLogos", currentUser.uid);
      }


      let selectedGurdwaraId = "";
      let selectedGurdwaraName = "";

      if (gurdwaraSelect) {
        if (gurdwaraSelect.value === "add-new") {
          const newName = value("newGurdwaraName");

          if (!newName) {
            profileMessage.textContent = "Please enter the new Gurdwara name.";
            return;
          }

          const newGurdwaraRef = await addDoc(collection(db, "gurdwaras"), {
            name: newName,
            createdBy: currentUser.uid,
            createdAt: serverTimestamp()
          });

          selectedGurdwaraId = newGurdwaraRef.id;
          selectedGurdwaraName = newName;
        } else if (gurdwaraSelect.value) {
          selectedGurdwaraId = gurdwaraSelect.value;
          selectedGurdwaraName = gurdwaraSelect.options[gurdwaraSelect.selectedIndex].textContent;
        }
      }


      const profile = {
        uid: currentUser.uid,

        profilePhotoUrl,
        businessLogoUrl,

        fullName: value("fullName"),
        businessName: value("businessName"),
        serviceTitle: value("serviceTitle"),
        description: value("description"),
        whyContact: value("whyContact"),
        tags: getTags(value("tags")),

        yearsExperience: value("yearsExperience"),
        specialistWork: value("specialistWork"),
        googleReviews: value("googleReviews"),

        gurdwaraId: selectedGurdwaraId,
        gurdwaraName: selectedGurdwaraName,
        associatedGurdwara: selectedGurdwaraName,
        communityDiscount: value("communityDiscount"),

        funFactOne: value("funFactOne"),
        funFactTwo: value("funFactTwo"),

        phone: value("phone"),
        email: value("email"),
        website: value("website"),
        linkedin: value("linkedin"),

        town: value("town"),
        postcode: value("postcode"),
        serviceArea: value("serviceArea"),

        layoutStyle: value("layoutStyle"),
        themeColour: value("themeColour"),

        isPublic: checked("isPublic"),
        showPhone: checked("showPhone"),
        showEmail: checked("showEmail"),
        showPostcode: checked("showPostcode"),
        showGurdwara: checked("showGurdwara"),
        showGoogleReviews: checked("showGoogleReviews"),

        updatedAt: serverTimestamp()
      };

      await setDoc(doc(db, "users", currentUser.uid), profile, { merge: true });

      existingProfile = {
        ...existingProfile,
        ...profile
      };

      calculateProfileStrength(existingProfile);
      renderMembershipStatus(existingProfile);
      renderMemberDashboard(existingProfile);
      profileMessage.textContent = "Profile saved successfully.";



    } catch (error) {
      profileMessage.textContent = error.message;
    }
  });
}

if (publicProfile) {
  const params = new URLSearchParams(window.location.search);
  const profileId = params.get("id");

  async function loadPublicProfile() {
    if (!profileId) {
      publicProfile.innerHTML = `<div class="empty-state">No profile selected.</div>`;
      return;
    }

    try {
      const userRef = doc(db, "users", profileId);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        publicProfile.innerHTML = `<div class="empty-state">Profile not found.</div>`;
        return;
      }

      const profile = userSnap.data();

      try {
        await updateDoc(userRef, {
          profileViews: increment(1)
        });
      } catch (error) {
        console.error("Failed to track profile view:", error);
      }

      if (profile.isPublic === false) {
        publicProfile.innerHTML = `<div class="empty-state">This profile is not public.</div>`;
        return;
      }

      publicProfile.innerHTML = renderProfile(profile);


      document.querySelectorAll(".tracked-link").forEach((link) => {
      link.addEventListener("click", async () => {
        const clickType = link.dataset.clickType;

        if (!clickType) return;

        try {
          await updateDoc(userRef, {
            [clickType]: increment(1)
          });
        } catch (error) {
          console.error("Failed to track contact click:", error);
        }
      });
    });


    } catch (error) {
      publicProfile.innerHTML = `<div class="empty-state">Error loading profile: ${error.message}</div>`;
    }
  }

  loadPublicProfile();
}