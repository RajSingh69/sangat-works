/*
  Public profile projection
  users/{uid} holds private data (Stripe IDs, admin notes, hidden contact
  details), so it is only readable by its owner and admins. Pages that show
  other members read publicProfiles/{uid}, which is built here from an
  allowlist of fields and the member's own privacy toggles.
*/

// Needed by every page to decide whether a member is active, featured or founding.
const MEMBERSHIP_FIELDS = [
  "uid", "isPublic", "role", "accountType", "isAdmin", "internalAccount",
  "excludeFromFoundingMemberCount", "hasSubscription", "subscriptionStatus",
  "subscriptionExpiresAt", "subscriptionPlan", "subscriptionBillingType",
  "membershipPlan", "membershipStatus", "accessType", "freeAccessExpiresAt",
  "isFoundingMember", "memberNumber", "featuredListing", "featuredListingStatus",
  "featuredExpiresAt", "pinnedToTop", "createdAt"
];

// Same 12 checks as calculateProfileStrength in js/profile.js; keep them in step.
// Computed from the full record so private fields (e.g. hidden Gurdwara) still count.
function calculateProfileCompletion(user) {
  const checks = [
    Boolean(user.profilePhotoUrl),
    Boolean(user.businessLogoUrl),
    Boolean(user.businessName || user.fullName),
    Boolean(user.serviceTitle),
    Boolean(user.description),
    (user.tags || []).length > 0,
    Boolean(user.town),
    Boolean(user.yearsExperience),
    Boolean(user.specialistWork),
    Boolean(user.associatedGurdwara),
    Boolean(user.website || user.linkedin),
    Boolean(user.funFactOne && user.funFactTwo)
  ];

  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

// activeDays is the private list of "YYYY-MM-DD" sign-in days kept by recordDailyActivity.
// Only the count and the most recent day are published.
function summariseActivity(activeDays, now = new Date()) {
  const days = Array.isArray(activeDays) ? [...activeDays].sort() : [];
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return {
    activeDaysLast30: days.filter(day => day >= cutoff).length,
    lastActiveOn: days.length ? days[days.length - 1] : null
  };
}

// Profile content, only copied when the profile is public.
const PROFILE_FIELDS = [
  "fullName", "displayName", "businessName", "serviceTitle", "description",
  "whyContact", "tags", "yearsExperience", "specialistWork", "communityDiscount",
  "funFactOne", "funFactTwo", "website", "linkedin", "town", "serviceArea",
  "layoutStyle", "themeColour", "showPhone", "showEmail", "showPostcode",
  "showGurdwara", "showGoogleReviews", "profilePhotoUrl", "businessLogoUrl",
  "connectionPrivacy", "messagePrivacy", "projectsUserType", "updatedAt",
  "businessCategory", "businessType", "category", "profession", "primaryService",
  "serviceAreaTown", "affiliation", "organisation", "company", "location",
  "logoUrl", "photoUrl", "imagePosition", "photoPosition", "profileImagePosition",
  "profilePhotoPosition", "businessVerified", "isBusinessVerified", "emailVerified",
  "isEmailVerified", "gurdwaraVerified", "isGurdwaraVerified", "communityVerified",
  "isCommunityVerified", "isVerified", "emailVerifiedBadge", "averageRating", "ratingAverage",
  "reviewAverage", "reviewCount", "reviewsCount", "rating", "totalReviews",
  "cardPhoto", "recommendationCount", "profileViews", "websiteClicks", "linkedinClicks",
  "googleReviewClicks"
];

const GURDWARA_FIELDS = [
  "gurdwaraId", "gurdwaraName", "associatedGurdwara", "localGurdwara", "gurdwara"
];

function copyFields(target, source, fields) {
  fields.forEach(field => {
    if (source[field] !== undefined) {
      target[field] = source[field];
    }
  });
}

function buildPublicProfile(uid, userData) {
  const profile = {};

  copyFields(profile, userData, MEMBERSHIP_FIELDS);
  profile.uid = uid;

  // Hidden by an admin: publish as private without touching the member's own isPublic choice.
  if (userData.adminHidden === true) {
    profile.isPublic = false;
    return profile;
  }

  // Matches profile.js, which treats a missing isPublic as public. Early free-trial
  // signups never saved the setting, so publish it explicitly for the directory query.
  if (userData.isPublic === false) {
    return profile;
  }
  profile.isPublic = true;

  copyFields(profile, userData, PROFILE_FIELDS);

  if (userData.showPhone === true && userData.phone) profile.phone = userData.phone;
  if (userData.showEmail === true && userData.email) profile.email = userData.email;
  if (userData.showPostcode === true && userData.postcode) profile.postcode = userData.postcode;
  if (userData.showGurdwara !== false) copyFields(profile, userData, GURDWARA_FIELDS);
  if (userData.showGoogleReviews !== false && userData.googleReviews) {
    profile.googleReviews = userData.googleReviews;
  }

  // Ranking inputs (see js/ranking.js).
  profile.profileCompletion = calculateProfileCompletion(userData);
  Object.assign(profile, summariseActivity(userData.activeDays));

  return profile;
}

module.exports = { buildPublicProfile, calculateProfileCompletion, summariseActivity };
