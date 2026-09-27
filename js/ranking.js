/*
  Member ranking used everywhere members or their posts are listed.

  Score out of 100, from publicProfiles/{uid} data only:
    Paid        45  Featured listing 25, paid membership 20 (free trial / free year 5)
    Profile     20  Profile completion % (12-point checklist, computed server-side)
    Activity    20  Sign-in days in the last 30 (up to 12) + how recently (up to 8)
    Verified    15  Email, business, community and Gurdwara badges

  Admin-pinned profiles (pinnedToTop) always come first.
*/

export const RANKING_WEIGHTS = {
  featured: 25,
  paidMembership: 20,
  freeMembership: 5,
  profile: 20,
  activeDays: 12,
  recency: 8,
  verified: 15
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_DAYS_FOR_FULL_POINTS = 20;

const VERIFICATION_BADGES = [
  { label: "Email", fields: ["emailVerifiedBadge", "emailVerified", "isEmailVerified"] },
  { label: "Business", fields: ["businessVerified", "isBusinessVerified"] },
  { label: "Community", fields: ["communityVerified", "isCommunityVerified"] },
  { label: "Gurdwara", fields: ["gurdwaraVerified", "isGurdwaraVerified"] }
];

function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  if (typeof value.seconds === "number") return new Date(value.seconds * 1000);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function isFeaturedActive(profile, now = new Date()) {
  if (profile?.featuredListing !== true || profile.featuredListingStatus !== "active") return false;
  const expires = toDate(profile.featuredExpiresAt);
  return Boolean(expires && expires > now);
}

function hasActiveMembership(profile, now) {
  if (profile?.hasSubscription !== true) return false;
  if (!["active", "cancelling"].includes(profile.subscriptionStatus)) return false;
  const expires = toDate(profile.subscriptionExpiresAt);
  return !expires || expires > now;
}

export function isPaidMember(profile, now = new Date()) {
  return (
    hasActiveMembership(profile, now) &&
    ["subscription", "oneoff"].includes(profile.subscriptionBillingType)
  );
}

function isFreeMember(profile, now) {
  if (profile?.accessType === "admin_granted_free_year") {
    const expires = toDate(profile.freeAccessExpiresAt);
    return Boolean(expires && expires > now);
  }
  return hasActiveMembership(profile, now);
}

function daysSince(dayString, now) {
  if (!dayString) return Infinity;
  const day = new Date(`${dayString}T12:00:00Z`);
  return Math.max(0, Math.floor((now - day) / DAY_MS));
}

export function getRankingBreakdown(profile, now = new Date()) {
  const w = RANKING_WEIGHTS;
  const featured = isFeaturedActive(profile, now);
  const paid = isPaidMember(profile, now);
  const paidPoints =
    (featured ? w.featured : 0) +
    (paid ? w.paidMembership : isFreeMember(profile, now) ? w.freeMembership : 0);

  const completion = Math.max(0, Math.min(100, Number(profile?.profileCompletion) || 0));
  const profilePoints = (completion / 100) * w.profile;

  const lastActiveDaysAgo = daysSince(profile?.lastActiveOn, now);
  const recentDays = lastActiveDaysAgo <= 30 ? Number(profile?.activeDaysLast30) || 0 : 0;
  const activeDayPoints = (Math.min(recentDays, ACTIVE_DAYS_FOR_FULL_POINTS) / ACTIVE_DAYS_FOR_FULL_POINTS) * w.activeDays;
  const recencyPoints =
    lastActiveDaysAgo <= 1 ? w.recency :
    lastActiveDaysAgo <= 7 ? w.recency * 0.75 :
    lastActiveDaysAgo <= 30 ? w.recency * 0.35 : 0;

  const badges = VERIFICATION_BADGES.map(badge => ({
    label: badge.label,
    verified: badge.fields.some(field => profile?.[field] === true)
  }));
  const verifiedPoints = (badges.filter(b => b.verified).length / badges.length) * w.verified;

  const parts = {
    paid: paidPoints,
    profile: profilePoints,
    activity: activeDayPoints + recencyPoints,
    verified: verifiedPoints
  };
  const total = Math.round(Object.values(parts).reduce((sum, value) => sum + value, 0));

  const tips = [];
  if (!paid) tips.push({ text: "Upgrade to a paid membership", points: w.paidMembership - (isFreeMember(profile, now) ? w.freeMembership : 0) });
  if (!featured) tips.push({ text: "Become a Featured Listing", points: w.featured });
  if (completion < 100) tips.push({ text: `Complete your profile (${completion}% done)`, points: Math.round(w.profile - profilePoints) });
  const missingBadges = badges.filter(b => !b.verified);
  if (missingBadges.length) {
    tips.push({
      text: `Get verified: ${missingBadges.map(b => b.label).join(", ")}`,
      points: Math.round((missingBadges.length / badges.length) * w.verified)
    });
  }
  const activityGap = Math.round(w.activeDays + w.recency - parts.activity);
  if (activityGap > 0) tips.push({ text: "Sign in regularly (most days)", points: activityGap });
  tips.sort((a, b) => b.points - a.points);

  return {
    total,
    parts: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, Math.round(value)])),
    pinned: profile?.pinnedToTop === true,
    featured,
    tips
  };
}

export function getRankingScore(profile, now = new Date()) {
  return getRankingBreakdown(profile, now).total;
}

function createdSeconds(profile) {
  const created = toDate(profile?.createdAt);
  return created ? created.getTime() : 0;
}

// Pinned first, then highest score, then newest member.
export function compareByRanking(a, b, now = new Date()) {
  const pinnedDiff = Number(b?.pinnedToTop === true) - Number(a?.pinnedToTop === true);
  if (pinnedDiff) return pinnedDiff;

  const scoreDiff = getRankingScore(b, now) - getRankingScore(a, now);
  if (scoreDiff) return scoreDiff;

  return createdSeconds(b) - createdSeconds(a);
}

// Sorts items (posts, applications...) by the ranking of the member each belongs to.
export function sortByMemberRanking(items, getMemberProfile, now = new Date()) {
  return [...items].sort((a, b) => compareByRanking(getMemberProfile(a) || {}, getMemberProfile(b) || {}, now));
}
