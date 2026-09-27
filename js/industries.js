/*
  Industry groups shared by the directory and the homepage, so both always
  sort members the same way. A member lands in the first group whose keywords
  appear in their service title, business type, category or tags.
*/

function timestampToDate(value) {
  if (!value) return null;
  if (value.toDate) return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export const INDUSTRY_BUCKETS = [
  { name: "Technology", blurb: "Developers, IT and digital", keywords: ["software", "developer", "web", "data", "ai", "cyber", "cloud", "it", "digital", "engineer", "technical"] },
  { name: "Trades", blurb: "Builders, electricians and plumbers", keywords: ["electrician", "builder", "plumber", "carpenter", "decorator", "construction", "trade", "heating", "labour", "roof", "joiner"] },
  { name: "Property", blurb: "Estate agents, mortgages and architects", keywords: ["property", "estate", "mortgage", "letting", "landlord", "survey", "architect", "planning", "development"] },
  { name: "Law & Professional Services", blurb: "Solicitors, accountants and consultants", keywords: ["law", "legal", "solicitor", "accountant", "consultant", "insurance", "advisor", "adviser", "compliance"] },
  { name: "Business & Finance", blurb: "Finance, marketing and start-ups", keywords: ["business", "finance", "bookkeeping", "tax", "marketing", "sales", "operations", "startup", "strategy"] },
  { name: "Healthcare", blurb: "Doctors, dentists and wellbeing", keywords: ["doctor", "health", "dentist", "pharmacy", "pharmacist", "therapy", "physio", "mental", "wellbeing", "care"] },
  { name: "Education", blurb: "Teachers, tutors and coaches", keywords: ["teacher", "tutor", "education", "training", "coach", "mentor", "school", "learning"] },
  { name: "Creative & Media", blurb: "Design, photo, video and music", keywords: ["design", "designer", "media", "photo", "video", "creative", "brand", "content", "music", "film"] },
  { name: "Community", blurb: "Charities, seva and Gurdwaras", keywords: ["charity", "community", "seva", "gurdwara", "nonprofit", "volunteer"] }
];

function getCategorySource(profile) {
  return [
    profile.serviceTitle,
    profile.businessType,
    profile.category,
    profile.profession,
    profile.role,
    profile.businessCategory,
    ...(Array.isArray(profile.tags) ? profile.tags : [])
  ].filter(Boolean).join(" ").toLowerCase();
}

// Keywords match at the start of a word ("developer" matches "developers"). Short
// ones like "it" and "ai" must be the whole word, so "community" isn't Technology.
const keywordPatterns = new Map(
  INDUSTRY_BUCKETS.flatMap(bucket => bucket.keywords).map(keyword => [
    keyword,
    new RegExp(`\\b${keyword}${keyword.length <= 3 ? "\\b" : ""}`)
  ])
);

export function getIndustryBucket(profile) {
  const source = getCategorySource(profile);
  const match = INDUSTRY_BUCKETS.find(bucket => bucket.keywords.some(keyword => keywordPatterns.get(keyword).test(source)));
  return match?.name || "Other";
}

// Who appears in the directory: admins, free-year members and paid-up members.
export function isListedInDirectory(profile) {
  if (!profile) return false;

  if (profile.role === "admin" || profile.role === "super_admin") {
    return true;
  }

  if (profile.accessType === "admin_granted_free_year") {
    const freeAccessExpiryDate = timestampToDate(profile.freeAccessExpiresAt);
    return Boolean(freeAccessExpiryDate && freeAccessExpiryDate > new Date());
  }

  if (profile.hasSubscription !== true) {
    return false;
  }

  const expiryDate = timestampToDate(profile.subscriptionExpiresAt);

  // Cancelled subscriptions stay listed until the paid period ends.
  if (profile.subscriptionStatus === "cancelling") {
    return Boolean(expiryDate && expiryDate > new Date());
  }

  if (profile.subscriptionStatus !== "active") {
    return false;
  }

  return !expiryDate || expiryDate > new Date();
}
