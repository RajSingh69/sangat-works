// Pure helpers for the public homepage totals (used by site-stats.js and tests).
// Keep INDUSTRY_BUCKETS in step with js/industries.js; tests check they match.
const INDUSTRY_BUCKETS = [
  { name: "Technology", keywords: ["software", "developer", "web", "data", "ai", "cyber", "cloud", "it", "digital", "engineer", "technical"] },
  { name: "Trades", keywords: ["electrician", "builder", "plumber", "carpenter", "decorator", "construction", "trade", "heating", "labour", "roof", "joiner"] },
  { name: "Property", keywords: ["property", "estate", "mortgage", "letting", "landlord", "survey", "architect", "planning", "development"] },
  { name: "Law & Professional Services", keywords: ["law", "legal", "solicitor", "accountant", "consultant", "insurance", "advisor", "adviser", "compliance"] },
  { name: "Business & Finance", keywords: ["business", "finance", "bookkeeping", "tax", "marketing", "sales", "operations", "startup", "strategy"] },
  { name: "Healthcare", keywords: ["doctor", "health", "dentist", "pharmacy", "pharmacist", "therapy", "physio", "mental", "wellbeing", "care"] },
  { name: "Education", keywords: ["teacher", "tutor", "education", "training", "coach", "mentor", "school", "learning"] },
  { name: "Creative & Media", keywords: ["design", "designer", "media", "photo", "video", "creative", "brand", "content", "music", "film"] },
  { name: "Community", keywords: ["charity", "community", "seva", "gurdwara", "nonprofit", "volunteer"] }
];

const keywordPatterns = new Map(
  INDUSTRY_BUCKETS.flatMap(bucket => bucket.keywords).map(keyword => [
    keyword,
    new RegExp(`\\b${keyword}${keyword.length <= 3 ? "\\b" : ""}`)
  ])
);

function getIndustryBucket(profile) {
  const source = [
    profile.serviceTitle, profile.businessType, profile.category, profile.profession,
    profile.role, profile.businessCategory, ...(Array.isArray(profile.tags) ? profile.tags : [])
  ].filter(Boolean).join(" ").toLowerCase();
  const match = INDUSTRY_BUCKETS.find(bucket => bucket.keywords.some(keyword => keywordPatterns.get(keyword).test(source)));
  return match ? match.name : "Other";
}

function toDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Same rule as isListedInDirectory in js/industries.js.
function isListedInDirectory(profile, now = new Date()) {
  if (!profile) return false;
  if (profile.role === "admin" || profile.role === "super_admin") return true;
  if (profile.accessType === "admin_granted_free_year") {
    const expires = toDate(profile.freeAccessExpiresAt);
    return Boolean(expires && expires > now);
  }
  if (profile.hasSubscription !== true) return false;
  const expires = toDate(profile.subscriptionExpiresAt);
  if (profile.subscriptionStatus === "cancelling") return Boolean(expires && expires > now);
  if (profile.subscriptionStatus !== "active") return false;
  return !expires || expires > now;
}

function summariseSiteStats(profiles, opportunities, openProjectCount) {
  const listed = profiles.filter(profile => isListedInDirectory(profile));
  const industryCounts = {};
  listed.forEach(profile => {
    const industry = getIndustryBucket(profile);
    industryCounts[industry] = (industryCounts[industry] || 0) + 1;
  });
  const locations = new Set(listed.map(profile => String(profile.town || profile.serviceArea || "").trim().toLowerCase()).filter(Boolean));

  return {
    members: listed.length,
    industries: Object.keys(industryCounts).filter(name => name !== "Other").length,
    industryCounts,
    locations: locations.size,
    // Closing dates let the homepage drop opportunities that have closed since this was saved.
    openOpportunityClosingDates: opportunities.map(item => String(item.closingDate || "")),
    openProjects: openProjectCount
  };
}

module.exports = { INDUSTRY_BUCKETS, getIndustryBucket, isListedInDirectory, summariseSiteStats };
