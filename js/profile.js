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
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  ref,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

import {
  isAdminUser,
  isSuperAdmin
} from "./roles.js";

import {
  acceptConnection,
  blockMember,
  openConversationWithUser,
  getConnection,
  getUserProfile,
  removeConnection,
  reportMember,
  sendConnectionRequest
} from "./member-network.js";

import { getRankingBreakdown } from "./ranking.js";
import { renderFramedPhoto } from "./directory-card.js";
import { adjustMemberPhoto } from "./photo-framer.js";

const FEATURED_LISTING_PRICE_ID = "price_1TlZxODbE6tXsxNUzI1ng4Iy";
const CHECKOUT_FUNCTION_URL = "https://europe-west1-sangat-works.cloudfunctions.net/createCheckoutSession";
const TRACK_PROFILE_METRIC_URL = "https://europe-west1-sangat-works.cloudfunctions.net/trackProfileMetric";

const profileForm = document.getElementById("profileForm");
const profileMessage = document.getElementById("profileMessage");
const publicProfile = document.getElementById("publicProfile");
const pendingPaymentWarning = document.getElementById("pendingPaymentWarning");
const viewWalkthroughBtn = document.getElementById("viewWalkthroughBtn");

const gurdwaraSelect = document.getElementById("gurdwaraSelect");
const newGurdwaraName = document.getElementById("newGurdwaraName");
const newGurdwaraAddress = document.getElementById("newGurdwaraAddress");
const newGurdwaraPostcode = document.getElementById("newGurdwaraPostcode");
const associatedGurdwaraInput = document.getElementById("associatedGurdwara");

let currentUser = null;
let existingProfile = {};
let viewedProfileId = "";
let viewedPublicProfile = null;
let currentConnection = null;
let canAdjustPhotos = false;

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeExternalUrl(value = "") {
  const trimmed = String(value).trim();
  if (!trimmed) return "";
  try {
    // Bare domains like "www.example.com" need https://, not the site's own origin.
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.href;
  } catch (error) {
    return "";
  }
}

const profileStrengthPercent = document.getElementById("profileStrengthPercent");
const profileStrengthFill = document.getElementById("profileStrengthFill");
const profileStrengthChecklist = document.getElementById("profileStrengthChecklist");

const membershipPlan = document.getElementById("membershipPlan");
const membershipStatus = document.getElementById("membershipStatus");
const membershipExpiry = document.getElementById("membershipExpiry");
const membershipDays = document.getElementById("membershipDays");

const featuredStatus = document.getElementById("featuredStatus");
const featuredExpiry = document.getElementById("featuredExpiry");
const featuredDays = document.getElementById("featuredDays");
const becomeFeaturedBtn = document.getElementById("becomeFeaturedBtn");
const featuredMessage = document.getElementById("featuredMessage");

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
    { label: "Add a profile photo", complete: !!profile.profilePhotoUrl },
    { label: "Add a business logo", complete: !!profile.businessLogoUrl },
    { label: "Add your business or profile name", complete: !!profile.businessName || !!profile.fullName },
    { label: "Add a service title", complete: !!profile.serviceTitle },
    { label: "Add a description", complete: !!profile.description },
    { label: "Add tags", complete: (profile.tags || []).length > 0 },
    { label: "Add your town/location", complete: !!profile.town },
    { label: "Add years of experience", complete: !!profile.yearsExperience },
    { label: "Add specialist work/projects", complete: !!profile.specialistWork },
    { label: "Add Gurdwara/Sangat association", complete: !!profile.associatedGurdwara },
    { label: "Add website or LinkedIn", complete: !!profile.website || !!profile.linkedin },
    { label: "Add 2 fun facts", complete: !!profile.funFactOne && !!profile.funFactTwo }
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

// Uses the public profile because that's exactly what the directory ranks.
async function renderRankingScore(uid) {
  const valueEl = document.getElementById("rankingScoreValue");
  const fillEl = document.getElementById("rankingScoreFill");
  const summaryEl = document.getElementById("rankingScoreSummary");
  const tipsEl = document.getElementById("rankingScoreTips");
  if (!valueEl || !fillEl || !summaryEl || !tipsEl) return;

  let publicProfile = null;
  try {
    publicProfile = await getUserProfile(uid);
  } catch (error) {
    console.error("Could not load ranking:", error);
  }

  if (!publicProfile || publicProfile.isPublic !== true) {
    valueEl.textContent = "-";
    fillEl.style.width = "0%";
    summaryEl.textContent = "Your profile isn't public, so it isn't shown or ranked in the directory.";
    tipsEl.innerHTML = "";
    return;
  }

  const ranking = getRankingBreakdown(publicProfile);
  valueEl.textContent = `${ranking.total}/100`;
  fillEl.style.width = `${ranking.total}%`;
  summaryEl.textContent = ranking.pinned
    ? "Pinned to the top by Sangat Works. Your score still counts if the pin is removed."
    : `Paid ${ranking.parts.paid}/45 - Profile ${ranking.parts.profile}/20 - Activity ${ranking.parts.activity}/20 - Verified ${ranking.parts.verified}/15. Higher scores appear first.`;
  tipsEl.innerHTML = ranking.tips.length
    ? ranking.tips.map(tip => `<li>+${tip.points}: ${escapeHtml(tip.text)}</li>`).join("")
    : `<li class="complete">Top marks. Keep signing in to stay there.</li>`;
}

function timestampToDate(value) {
  if (!value) return null;

  if (value.toDate) {
    return value.toDate();
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function formatDate(value) {
  const date = timestampToDate(value);

  if (!date) {
    return "-";
  }

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getDaysRemaining(value) {
  const expiryDate = timestampToDate(value);

  if (!expiryDate) {
    return 0;
  }

  const today = new Date();
  const diffMs = expiryDate - today;
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return diffDays > 0 ? diffDays : 0;
}

function isFreeCharityYear(profile) {
  return profile?.accessType === "admin_granted_free_year";
}

function getFreeAccessDaysRemaining(profile) {
  return getDaysRemaining(profile?.freeAccessExpiresAt);
}

function formatSubscriptionPlan(profile) {
  if (isFreeCharityYear(profile)) {
    return "Free Charity Year";
  }

  if (profile.isFoundingMember === true) {
    return `👑 Founding Member #${profile.memberNumber || ""}`;
  }

  if (profile.subscriptionPlan === "yearly") {
    return "⭐ Yearly Member";
  }

  if (profile.subscriptionPlan === "monthly") {
    return "⭐ Monthly Member";
  }

  if (profile.hasSubscription === true) {
    return "⭐ Active Member";
  }

  return "Free User";
}

function isActiveMember(profile) {
  if (!profile) return false;

  if (isAdminUser(profile)) return true;

  if (isFreeCharityYear(profile)) {
    return getFreeAccessDaysRemaining(profile) > 0;
  }

  if (profile.hasSubscription !== true) return false;

  // Cancelled subscriptions stay active until the paid period ends.
  if (profile.subscriptionStatus === "cancelling") {
    return Boolean(profile.subscriptionExpiresAt) && getDaysRemaining(profile.subscriptionExpiresAt) > 0;
  }

  if (profile.subscriptionStatus !== "active") {
    return false;
  }

  if (profile.subscriptionExpiresAt) {
    return getDaysRemaining(profile.subscriptionExpiresAt) > 0;
  }

  return true;
}

function isSuperAdminOrInternalAccount(profile) {
  return (
    profile?.role === "super_admin" ||
    profile?.internalAccount === true
  );
}

function isPendingPaymentAccount(profile) {
  if (!profile) return false;
  if (isActiveMember(profile)) return false;
  if (profile.isFoundingMember === true) return false;
  if (isFreeCharityYear(profile)) return getFreeAccessDaysRemaining(profile) <= 0;
  if (isSuperAdminOrInternalAccount(profile)) return false;

  const pendingValues = new Set([
    profile.subscriptionStatus,
    profile.membershipStatus,
    profile.membershipPlan,
    profile.subscriptionPlan
  ]);

  return (
    pendingValues.has("pending") ||
    pendingValues.has("pending-payment") ||
    (
      profile.hasSubscription === false &&
      profile.subscriptionStatus === "pending-payment"
    )
  );
}

function renderPendingPaymentWarning(profile) {
  if (!pendingPaymentWarning) return;

  pendingPaymentWarning.classList.toggle(
    "hidden",
    !isPendingPaymentAccount(profile)
  );
}

function blockUnpaidProfileAccess(profile) {
  if (isActiveMember(profile)) return false;

  if (profileForm) {
    profileForm.classList.add("hidden");
  }

  if (pendingPaymentWarning) {
    pendingPaymentWarning.classList.remove("hidden");
  }

  if (profileMessage) {
    profileMessage.textContent =
      "Your account is not active yet. Please complete payment to unlock Sangat Works.";
  }

  setTimeout(() => {
    window.location.href = "pricing.html?payment_required=1";
  }, 1600);

  return true;
}

function renderMembershipStatus(profile) {
  if (!membershipPlan || !membershipStatus || !membershipExpiry || !membershipDays) {
    return;
  }

  const active = isActiveMember(profile);
  const daysRemaining = isFreeCharityYear(profile)
    ? getFreeAccessDaysRemaining(profile)
    : getDaysRemaining(profile.subscriptionExpiresAt);

  membershipPlan.textContent = formatSubscriptionPlan(profile);

  if (isFreeCharityYear(profile)) {
    membershipStatus.textContent = active
      ? "Active (Free Charity Year)"
      : "Expired Free Access";
  } else if (profile.isFoundingMember === true) {
    membershipStatus.textContent = active
      ? "Active (Free Founding Membership)"
      : "Expired";
  } else {
    membershipStatus.textContent = active
      ? "Active"
      : "Inactive";
  }

  membershipExpiry.textContent = isFreeCharityYear(profile)
    ? formatDate(profile.freeAccessExpiresAt)
    : formatDate(profile.subscriptionExpiresAt);

  if (active) {
    membershipDays.textContent = `${daysRemaining} days`;
  } else {
    membershipDays.textContent = "Expired";
  }
}

function isFeaturedActive(profile) {
  if (!profile) return false;

  if (profile.featuredListing !== true) return false;
  if (profile.featuredListingStatus !== "active") return false;

  return getDaysRemaining(profile.featuredExpiresAt) > 0;
}

function renderFeaturedListingStatus(profile) {
  if (!featuredStatus || !featuredExpiry || !featuredDays || !becomeFeaturedBtn) return;

  const memberActive = isActiveMember(profile);
  const featuredActive = isFeaturedActive(profile);
  const daysRemaining = getDaysRemaining(profile.featuredExpiresAt);

  featuredStatus.textContent = featuredActive ? "Active" : "Inactive";
  featuredExpiry.textContent = formatDate(profile.featuredExpiresAt);
  featuredDays.textContent = daysRemaining;

  if (!memberActive) {
    becomeFeaturedBtn.disabled = true;
    becomeFeaturedBtn.textContent = "Active Membership Required";
    if (featuredMessage) {
      featuredMessage.textContent = "Featured Listing is only available to active Sangat Works members.";
    }
    return;
  }

  becomeFeaturedBtn.disabled = false;

  if (featuredActive) {
    becomeFeaturedBtn.textContent = "Extend Featured Listing (£5 / 30 Days)";
    if (featuredMessage) {
      featuredMessage.textContent = "You are currently featured. Buying again adds another 30 days.";
    }
  } else {
    becomeFeaturedBtn.textContent = "Become Featured (£5 / 30 Days)";
    if (featuredMessage) {
      featuredMessage.textContent = "";
    }
  }
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

function normalisePostcode(postcode) {
  return postcode.trim().toUpperCase().replace(/\s+/g, "");
}

function getGurdwaraDisplayName(gurdwara) {
  return gurdwara.name || gurdwara.gurdwaraName || gurdwara.localGurdwara || "Unnamed Gurdwara";
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

  const snapshot = await getDocs(collection(db, "gurdwaras"));
  const gurdwaras = snapshot.docs
    .map((docSnap) => ({
      id: docSnap.id,
      name: getGurdwaraDisplayName(docSnap.data())
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  gurdwaras.forEach((gurdwara) => {
    const option = document.createElement("option");
    option.value = gurdwara.id;
    option.textContent = gurdwara.name;

    gurdwaraSelect.insertBefore(option, gurdwaraSelect.querySelector('option[value="add-new"]'));
  });

  if (selectedGurdwaraId) {
    gurdwaraSelect.value = selectedGurdwaraId;
  }
}

function setupGurdwaraSelect() {
  if (!gurdwaraSelect || !newGurdwaraName || !newGurdwaraAddress || !newGurdwaraPostcode) return;

  function setNewGurdwaraFieldsVisible(isVisible) {
    const display = isVisible ? "block" : "none";
    [newGurdwaraName, newGurdwaraAddress, newGurdwaraPostcode].forEach((field) => {
      field.style.display = display;
      field.required = isVisible;

      if (!isVisible) {
        field.value = "";
      }
    });
  }

  gurdwaraSelect.addEventListener("change", () => {
    if (gurdwaraSelect.value === "add-new") {
      setNewGurdwaraFieldsVisible(true);
    } else {
      setNewGurdwaraFieldsVisible(false);
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

  const connectionPrivacy = document.getElementById("connectionPrivacy");
  const messagePrivacy = document.getElementById("messagePrivacy");
  const allowMessageNotifications = document.getElementById("allowMessageNotifications");

  if (connectionPrivacy) connectionPrivacy.value = profile.connectionPrivacy || "everyone";
  if (messagePrivacy) messagePrivacy.value = profile.messagePrivacy || "requests";
  if (allowMessageNotifications) allowMessageNotifications.checked = profile.allowMessageNotifications !== false;
}


async function trackProfileMetric(targetUserId, metric) {
  if (!currentUser || !targetUserId) return;

  const idToken = await currentUser.getIdToken();
  const response = await fetch(TRACK_PROFILE_METRIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify({ targetUserId, metric })
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || "Profile metric was not recorded.");
  }
}
const PV_ICONS = {
  pin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  star: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9Z" fill="currentColor"/></svg>`
};

function getVerifiedLabels(profile) {
  return [
    ["Email", profile.emailVerifiedBadge || profile.emailVerified || profile.isEmailVerified],
    ["Business", profile.businessVerified || profile.isBusinessVerified],
    ["Community", profile.communityVerified || profile.isCommunityVerified],
    ["Gurdwara", profile.gurdwaraVerified || profile.isGurdwaraVerified]
  ].filter(([, value]) => value === true).map(([label]) => label);
}

// Filled in by reviews.js once reviews load (see "sw:reviews-loaded").
function renderRatingSummary() {
  const summary = window.swReviewSummary;
  if (!summary || !summary.count) return "";
  return `<a class="pv-rating" href="#reviews">${PV_ICONS.star}<strong>${summary.average.toFixed(1)}</strong> <span>(${summary.count} review${summary.count === 1 ? "" : "s"})</span></a>`;
}

window.addEventListener("sw:reviews-loaded", () => {
  const slot = document.getElementById("pvRatingSlot");
  if (slot) slot.innerHTML = renderRatingSummary();
});

function renderProfile(profile) {
  const tags = (Array.isArray(profile.tags) ? profile.tags : []).filter(Boolean);
  const websiteUrl = safeExternalUrl(profile.website);
  const linkedInUrl = safeExternalUrl(profile.linkedin);
  const reviewsUrl = safeExternalUrl(profile.googleReviews);

  const businessName = profile.businessName || "";
  const displayName = businessName || profile.fullName || "Member profile";
  const personName = businessName && profile.fullName && profile.fullName !== businessName ? profile.fullName : "";
  const title = profile.serviceTitle || profile.businessType || "Sangat Works Member";
  const town = [profile.town, profile.showPostcode && profile.postcode ? profile.postcode : ""].filter(Boolean).join(" ");
  const memberSince = timestampToDate(profile.createdAt);
  const gurdwaraName = profile.showGurdwara !== false ? (profile.gurdwaraName || profile.associatedGurdwara || "") : "";

  const badges = [
    isFeaturedActive(profile) ? `<span class="pv-badge is-featured">Featured Member</span>` : "",
    profile.isFoundingMember ? `<span class="pv-badge is-founding">Founding Member${profile.memberNumber ? ` #${escapeHtml(profile.memberNumber)}` : ""}</span>` : "",
    ...getVerifiedLabels(profile).map(label => `<span class="pv-badge is-verified">${PV_ICONS.check}${escapeHtml(label)} verified</span>`)
  ].filter(Boolean).join("");

  const discountText = {
    yes: "Offers Sangat/community rates where possible",
    sometimes: "May offer community rates depending on the job",
    no: "No fixed discount, but supports fair pricing"
  }[profile.communityDiscount] || "";

  const facts = [
    profile.yearsExperience ? ["Experience", `${profile.yearsExperience} years`] : null,
    profile.specialistWork ? ["Specialist work", profile.specialistWork] : null,
    profile.serviceArea ? ["Service area", profile.serviceArea] : null,
    discountText ? ["Community rates", discountText] : null
  ].filter(Boolean);

  const funFacts = [profile.funFactOne, profile.funFactTwo].filter(Boolean);

  const contactRows = [
    profile.showPhone && profile.phone ? `<a class="pv-contact-row" href="tel:${escapeHtml(String(profile.phone).replace(/[^\d+]/g, ""))}"><span>Phone</span><strong>${escapeHtml(profile.phone)}</strong></a>` : "",
    profile.showEmail && profile.email ? `<a class="pv-contact-row" href="mailto:${escapeHtml(profile.email)}"><span>Email</span><strong>${escapeHtml(profile.email)}</strong></a>` : "",
    websiteUrl ? `<a class="pv-contact-row tracked-link" data-click-type="websiteClicks" href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener"><span>Website</span><strong>${escapeHtml(websiteUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}</strong></a>` : "",
    linkedInUrl ? `<a class="pv-contact-row tracked-link" data-click-type="linkedinClicks" href="${escapeHtml(linkedInUrl)}" target="_blank" rel="noopener"><span>LinkedIn</span><strong>View profile</strong></a>` : "",
    profile.showGoogleReviews && reviewsUrl ? `<a class="pv-contact-row tracked-link" data-click-type="googleReviewClicks" href="${escapeHtml(reviewsUrl)}" target="_blank" rel="noopener"><span>Google reviews</span><strong>Read reviews</strong></a>` : ""
  ].filter(Boolean).join("");

  const sangatFacts = [
    businessName && profile.fullName ? `<div><dt>Name</dt><dd>${escapeHtml(profile.fullName)}</dd></div>` : "",
    gurdwaraName ? `<div><dt>Local Gurdwara</dt><dd>${profile.gurdwaraId
      ? `<a href="skills-network.html?gurdwara=${encodeURIComponent(profile.gurdwaraId)}">${escapeHtml(gurdwaraName)}</a>`
      : escapeHtml(gurdwaraName)}</dd></div>` : "",
    memberSince ? `<div><dt>Member since</dt><dd>${escapeHtml(memberSince.toLocaleDateString("en-GB", { month: "long", year: "numeric" }))}</dd></div>` : ""
  ].filter(Boolean).join("");

  return `
    <article class="pv">
      <header class="pv-hero">
        <div class="pv-hero-inner">
          <div class="pv-photo-block">
            ${renderFramedPhoto(profile, { className: "pv-photo", alt: displayName })}
            ${canAdjustPhotos && profile.profilePhotoUrl ? `<button type="button" class="pv-adjust" data-adjust-viewed-photo>Adjust photo</button>` : ""}
          </div>

          <div class="pv-identity">
            ${badges ? `<div class="pv-badges">${badges}</div>` : ""}
            <h1>${escapeHtml(displayName)}</h1>
            ${personName ? `<p class="pv-person">${escapeHtml(personName)}</p>` : ""}
            <p class="pv-title">${escapeHtml(title)}</p>
            <div class="pv-meta">
              ${town ? `<span>${PV_ICONS.pin}${escapeHtml(town)}</span>` : ""}
              <span id="pvRatingSlot">${renderRatingSummary()}</span>
            </div>
            ${renderRelationshipActions(profile)}
          </div>

          ${profile.businessLogoUrl ? `<img class="pv-logo" src="${escapeHtml(profile.businessLogoUrl)}" alt="${escapeHtml(displayName)} logo">` : ""}
        </div>
      </header>

      <div class="pv-body">
        <div class="pv-main">
          ${profile.description ? `
            <section class="pv-card">
              <h2>About</h2>
              <p class="pv-text">${escapeHtml(profile.description)}</p>
            </section>` : ""}

          ${profile.whyContact ? `
            <section class="pv-card pv-card-highlight">
              <h2>Why get in touch</h2>
              <p class="pv-text">${escapeHtml(profile.whyContact)}</p>
            </section>` : ""}

          ${tags.length ? `
            <section class="pv-card">
              <h2>Skills &amp; services</h2>
              <div class="pv-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
            </section>` : ""}

          ${facts.length ? `
            <section class="pv-card">
              <h2>Experience</h2>
              <dl class="pv-facts">${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
            </section>` : ""}

          ${funFacts.length ? `
            <section class="pv-card">
              <h2>A bit more about me</h2>
              ${funFacts.map(fact => `<p class="pv-text">${escapeHtml(fact)}</p>`).join("")}
            </section>` : ""}
        </div>

        <aside class="pv-side">
          ${contactRows ? `
            <section class="pv-card">
              <h2>Contact</h2>
              <div class="pv-contact">${contactRows}</div>
            </section>` : ""}

          ${sangatFacts ? `
            <section class="pv-card">
              <h2>In the Sangat</h2>
              <dl class="pv-facts">${sangatFacts}</dl>
            </section>` : ""}
        </aside>
      </div>
    </article>
  `;
}

function renderRelationshipActions() {
  if (!currentUser || !viewedProfileId || currentUser.uid === viewedProfileId) return "";

  let connectButton = `<button type="button" class="pv-btn" data-connect-user-id="${viewedProfileId}">Connect</button>`;
  if (currentConnection?.status === "pending" && currentConnection.requesterId === currentUser.uid) {
    connectButton = `<button type="button" class="pv-btn" disabled>Request sent</button>`;
  } else if (currentConnection?.status === "pending" && currentConnection.recipientId === currentUser.uid) {
    connectButton = `<button type="button" class="pv-btn is-accept" data-accept-connection-id="${currentConnection.id}">Accept connection</button>`;
  } else if (currentConnection?.status === "accepted") {
    connectButton = `<button type="button" class="pv-btn" disabled>Connected</button>`;
  } else if (currentConnection?.status === "blocked") {
    connectButton = `<button type="button" class="pv-btn" disabled>Unavailable</button>`;
  }

  return `
    <div class="pv-actions">
      <button type="button" class="pv-btn is-primary" data-message-user-id="${viewedProfileId}">Message</button>
      ${connectButton}
      <details class="pv-more">
        <summary>More</summary>
        <div class="pv-more-menu">
          ${currentConnection?.status === "accepted" ? `<button type="button" data-remove-user-id="${viewedProfileId}">Remove connection</button>` : ""}
          <button type="button" data-report-user-id="${viewedProfileId}">Report member</button>
          <button type="button" class="is-danger" data-block-user-id="${viewedProfileId}">Block member</button>
        </div>
      </details>
    </div>
    <p id="profileActionMessage" class="pv-action-message" role="status"></p>
  `;
}

async function startFeaturedCheckout() {
  if (!currentUser) {
    if (featuredMessage) {
      featuredMessage.textContent = "Please log in first.";
    }
    return;
  }

  if (!isActiveMember(existingProfile)) {
    if (featuredMessage) {
      featuredMessage.textContent = "You need an active membership before buying Featured Listing.";
    }
    return;
  }

  try {
    if (featuredMessage) {
      featuredMessage.textContent = "Creating Featured Listing checkout...";
    }

    if (becomeFeaturedBtn) {
      becomeFeaturedBtn.disabled = true;
    }

    const response = await fetch(CHECKOUT_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        priceId: FEATURED_LISTING_PRICE_ID,
        billingType: "featured",
        uid: currentUser.uid,
        email: currentUser.email || existingProfile.email || ""
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || "Could not create Featured Listing checkout.");
    }

    if (!data.url) {
      throw new Error("No checkout URL returned.");
    }

    window.location.href = data.url;
  } catch (error) {
    if (featuredMessage) {
      featuredMessage.textContent = error.message;
    }

    if (becomeFeaturedBtn) {
      becomeFeaturedBtn.disabled = false;
    }
  }
}

if (becomeFeaturedBtn) {
  becomeFeaturedBtn.addEventListener("click", startFeaturedCheckout);
}

if (viewWalkthroughBtn) {
  viewWalkthroughBtn.addEventListener("click", () => {
    window.dispatchEvent(new CustomEvent("openSangatWorksWalkthrough"));
  });
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

      if (blockUnpaidProfileAccess(existingProfile)) {
        return;
      }

      await loadGurdwaras(existingProfile.gurdwaraId || "");
      fillForm(existingProfile);
      calculateProfileStrength(existingProfile);
      renderMembershipStatus(existingProfile);
      renderPendingPaymentWarning(existingProfile);
      renderFeaturedListingStatus(existingProfile);
      renderMemberDashboard(existingProfile);
      renderRankingScore(user.uid);
    } else {
      existingProfile = {
        fullName: user.displayName || "",
        email: user.email || ""
      };
      blockUnpaidProfileAccess(existingProfile);
      return;
    }
  });

  profileForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    if (!currentUser) {
      profileMessage.textContent = "You need to be logged in.";
      return;
    }

    if (!isActiveMember(existingProfile)) {
      profileMessage.textContent =
        "Your account is not active yet. Please complete payment to unlock Sangat Works.";
      window.location.href = "pricing.html?payment_required=1";
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

      let selectedGurdwaraId = existingProfile.gurdwaraId || "";
      let selectedGurdwaraName = existingProfile.gurdwaraName || existingProfile.associatedGurdwara || "";

      if (gurdwaraSelect) {
        if (gurdwaraSelect.value === "add-new") {
          const newName = value("newGurdwaraName");
          const newAddress = value("newGurdwaraAddress");
          const newPostcode = value("newGurdwaraPostcode");
          const postcodeNormalised = normalisePostcode(newPostcode);

          if (!newName) {
            profileMessage.textContent = "Please enter the new Gurdwara name.";
            return;
          }

          if (!newAddress) {
            profileMessage.textContent = "Please enter the new Gurdwara address.";
            return;
          }

          if (!newPostcode) {
            profileMessage.textContent = "Please enter the new Gurdwara postcode.";
            return;
          }

          const gurdwarasSnapshot = await getDocs(collection(db, "gurdwaras"));
          const duplicateExists = gurdwarasSnapshot.docs.some((docSnap) => {
            const gurdwara = docSnap.data();
            const existingPostcode = gurdwara.postcodeNormalised || gurdwara.postcode || "";
            return normalisePostcode(existingPostcode) === postcodeNormalised;
          });

          if (duplicateExists) {
            profileMessage.textContent = "A Gurdwara with this postcode already exists.";
            return;
          }

          const newGurdwaraRef = await addDoc(collection(db, "gurdwaras"), {
            name: newName,
            gurdwaraName: newName,
            localGurdwara: newName,
            address: newAddress,
            postcode: newPostcode,
            postcodeNormalised,
            createdBy: currentUser.uid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp()
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
        connectionPrivacy: value("connectionPrivacy") || "everyone",
        messagePrivacy: value("messagePrivacy") || "requests",
        allowMessageNotifications: checked("allowMessageNotifications"),

        updatedAt: serverTimestamp()
      };

      await setDoc(doc(db, "users", currentUser.uid), profile, { merge: true });

      existingProfile = {
        ...existingProfile,
        ...profile
      };

      calculateProfileStrength(existingProfile);
      renderMembershipStatus(existingProfile);
      renderPendingPaymentWarning(existingProfile);
      renderFeaturedListingStatus(existingProfile);
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
  viewedProfileId = profileId || "";

  async function loadPublicProfile() {
    if (!profileId) {
      publicProfile.innerHTML = `<div class="empty-state">No profile selected.</div>`;
      return;
    }

    try {
      const userRef = doc(db, "publicProfiles", profileId);
      const userSnap = await getDoc(userRef);

      if (!userSnap.exists()) {
        publicProfile.innerHTML = `<div class="empty-state">Profile not found.</div>`;
        return;
      }

      const profile = userSnap.data();
      viewedPublicProfile = { ...profile, uid: profileId };

      if (currentUser && currentUser.uid !== profileId) {
        try {
          await trackProfileMetric(profileId, "profileViews");
        } catch (error) {
          console.error("Failed to track profile view:", error);
        }
      }

      if (profile.isPublic === false) {
        publicProfile.innerHTML = `<div class="empty-state">This profile is not public.</div>`;
        return;
      }

      if (!isActiveMember(profile)) {
        publicProfile.innerHTML = `<div class="empty-state">This profile is not active.</div>`;
        return;
      }

      if (currentUser && currentUser.uid !== profileId) {
        currentConnection = await getConnection(currentUser.uid, profileId);
      }

      publicProfile.innerHTML = renderProfile(profile);

      document.querySelectorAll(".tracked-link").forEach((link) => {
        link.addEventListener("click", async () => {
          const clickType = link.dataset.clickType;

          if (!clickType) return;

          try {
            await trackProfileMetric(profileId, clickType);
          } catch (error) {
            console.error("Failed to track contact click:", error);
          }
        });
      });
    } catch (error) {
      publicProfile.innerHTML = `<div class="empty-state">Error loading profile: ${error.message}</div>`;
    }
  }

  // Wait for sign-in so Connect/Message show for members and super admins get Adjust photo.
  onAuthStateChanged(auth, async (user) => {
    currentUser = user;
    canAdjustPhotos = false;

    if (user) {
      try {
        const viewerSnap = await getDoc(doc(db, "users", user.uid));
        canAdjustPhotos = viewerSnap.exists() && isSuperAdmin(viewerSnap.data());
      } catch (error) {
        console.error("Could not load viewer role:", error);
      }
    }

    loadPublicProfile();
  });
}

document.addEventListener("click", async (event) => {
  const actionMessage = document.getElementById("profileActionMessage");
  function setActionMessage(message) {
    if (actionMessage) actionMessage.textContent = message;
  }

  try {
    const connect = event.target.closest("[data-connect-user-id]");
    const accept = event.target.closest("[data-accept-connection-id]");
    const remove = event.target.closest("[data-remove-user-id]");
    const message = event.target.closest("[data-message-user-id]");
    const block = event.target.closest("[data-block-user-id]");
    const report = event.target.closest("[data-report-user-id]");
    const adjustPhoto = event.target.closest("[data-adjust-viewed-photo]");

    if (adjustPhoto && canAdjustPhotos && viewedPublicProfile) {
      adjustMemberPhoto(viewedPublicProfile, () => {
        publicProfile.innerHTML = renderProfile(viewedPublicProfile);
      });
    }

    if (connect) {
      await sendConnectionRequest(currentUser.uid, connect.dataset.connectUserId);
      setActionMessage("Connection request sent.");
      currentConnection = await getConnection(currentUser.uid, connect.dataset.connectUserId);
      publicProfile.innerHTML = renderProfile({ ...viewedPublicProfile, uid: viewedProfileId });
    }

    if (accept) {
      await acceptConnection(currentUser.uid, accept.dataset.acceptConnectionId);
      setActionMessage("Connection accepted.");
      currentConnection = await getConnection(currentUser.uid, viewedProfileId);
      publicProfile.innerHTML = renderProfile({ ...viewedPublicProfile, uid: viewedProfileId });
    }

    if (remove) {
      await removeConnection(currentUser.uid, viewedProfileId);
      setActionMessage("Connection removed.");
      currentConnection = await getConnection(currentUser.uid, viewedProfileId);
      publicProfile.innerHTML = renderProfile({ ...viewedPublicProfile, uid: viewedProfileId });
    }

    if (message) {
      await openConversationWithUser(currentUser.uid, message.dataset.messageUserId);
    }

    if (block && window.confirm("Block this member?")) {
      await blockMember(currentUser.uid, block.dataset.blockUserId);
      setActionMessage("Member blocked.");
    }

    if (report) {
      const reason = window.prompt("Report reason: spam, harassment, scam/fraud, inappropriate content, or other", "spam");
      if (reason) {
        await reportMember(currentUser.uid, report.dataset.reportUserId, reason);
        setActionMessage("Report submitted.");
      }
    }
  } catch (error) {
    setActionMessage(error.message);
  }
});








