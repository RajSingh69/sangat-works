import { auth, db, storage } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  increment,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const profileForm = document.getElementById("profileForm");
const profileMessage = document.getElementById("profileMessage");
const publicProfile = document.getElementById("publicProfile");

let currentUser = null;
let existingProfile = {};

const profileStrengthPercent = document.getElementById("profileStrengthPercent");
const profileStrengthFill = document.getElementById("profileStrengthFill");
const profileStrengthChecklist = document.getElementById("profileStrengthChecklist");

const membershipPlan = document.getElementById("membershipPlan");
const membershipStatus = document.getElementById("membershipStatus");
const membershipExpiry = document.getElementById("membershipExpiry");
const membershipDays = document.getElementById("membershipDays");

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

  document.getElementById("associatedGurdwara").value = profile.associatedGurdwara || "";
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
        ${profile.website ? `<a href="${profile.website}" target="_blank">Website</a>` : ""}
        ${profile.linkedin ? `<a href="${profile.linkedin}" target="_blank">LinkedIn</a>` : ""}
        ${profile.showGoogleReviews && profile.googleReviews ? `<a href="${profile.googleReviews}" target="_blank">Google Reviews</a>` : ""}
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

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      existingProfile = userSnap.data();
      fillForm(existingProfile);
      calculateProfileStrength(existingProfile);
      renderMembershipStatus(existingProfile);
    } else {
      existingProfile = {
        fullName: user.displayName || "",
        email: user.email || ""
      };
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

        associatedGurdwara: value("associatedGurdwara"),
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

      existingProfile = profile;
      calculateProfileStrength(existingProfile);
      renderMembershipStatus(existingProfile);
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
    } catch (error) {
      publicProfile.innerHTML = `<div class="empty-state">Error loading profile: ${error.message}</div>`;
    }
  }

  loadPublicProfile();
}