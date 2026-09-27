/*
  Member card for the directory grid/list, plus shared photo framing helpers.

  Photo framing: super admins can set users/{uid}.cardPhoto = { x, y, zoom }
  (x/y are 0-100 % focus points, zoom 1-3). Published via publicProfiles and
  applied wherever a member's photo is cropped into a card.
*/

import { isFeaturedActive } from "./ranking.js";

const ICONS = {
  message: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 3v-3H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`,
  connect: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 20c0-3.3 3.1-6 7-6s7 2.7 7 6M19 8v6M16 11h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
  website: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3Z" fill="none" stroke="currentColor" stroke-width="2"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h3v10H5zM6.5 4.5a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5ZM10 9h3v1.4c.5-.9 1.7-1.6 3.1-1.6 2.6 0 3.9 1.6 3.9 4.5V19h-3v-5.2c0-1.4-.5-2.3-1.7-2.3-1.3 0-2.3.9-2.3 2.5V19h-3z" fill="currentColor"/></svg>`,
  pin: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="9.5" r="2.5" fill="currentColor"/></svg>`,
  check: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  crop: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`
};

export function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeExternalUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

export const DEFAULT_FRAMING = Object.freeze({ x: 50, y: 30, zoom: 1 });

// Older profiles stored a CSS object-position string such as "center 25%".
function parseLegacyPosition(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const words = { left: 0, center: 50, right: 100, top: 0, bottom: 100 };
  const parts = value.trim().split(/\s+/).map(part => (part in words ? words[part] : parseFloat(part)));
  if (parts.some(part => !Number.isFinite(part))) return null;
  return { x: parts[0], y: parts.length > 1 ? parts[1] : 50, zoom: 1 };
}

export function getCardPhotoFraming(profile) {
  const saved = profile?.cardPhoto;
  const legacy = parseLegacyPosition(
    profile?.profileImagePosition || profile?.profilePhotoPosition || profile?.imagePosition || profile?.photoPosition
  );
  const source = saved && typeof saved === "object" ? saved : legacy || DEFAULT_FRAMING;
  return {
    x: clamp(source.x, 0, 100, DEFAULT_FRAMING.x),
    y: clamp(source.y, 0, 100, DEFAULT_FRAMING.y),
    zoom: clamp(source.zoom, 1, 3, 1)
  };
}

export function photoFramingStyle(framing) {
  const { x, y, zoom } = framing;
  return `object-position:${x}% ${y}%;transform:scale(${zoom});transform-origin:${x}% ${y}%;`;
}

export function getInitials(name = "") {
  const words = String(name).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "SW";
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : "")).toUpperCase();
}

export function getCardIdentity(profile) {
  return profile.businessName || profile.fullName || profile.displayName || "Sangat Works Member";
}

// Photo (cropped with framing), else business logo (shown whole), else initials.
// A broken image falls back to the initials underneath.
export function renderCardMedia(profile, { canAdjustPhoto = false } = {}) {
  const identity = getCardIdentity(profile);
  const photoUrl = profile.profilePhotoUrl || profile.photoUrl || "";
  const logoUrl = profile.businessLogoUrl || profile.logoUrl || "";
  const initials = `<span class="member-card-initials" aria-hidden="true">${escapeHtml(getInitials(identity))}</span>`;

  let image = "";
  if (photoUrl) {
    image = `<img class="member-card-photo" src="${escapeHtml(photoUrl)}" alt="${escapeHtml(identity)}" loading="lazy" style="${photoFramingStyle(getCardPhotoFraming(profile))}" onerror="this.closest('.member-card-media').classList.add('is-broken')">`;
  } else if (logoUrl) {
    image = `<img class="member-card-logo-only" src="${escapeHtml(logoUrl)}" alt="${escapeHtml(identity)} logo" loading="lazy" onerror="this.closest('.member-card-media').classList.add('is-broken')">`;
  }

  const adjust = canAdjustPhoto && photoUrl
    ? `<button type="button" class="member-card-adjust" data-adjust-photo-id="${escapeHtml(profile.uid || profile.id || "")}" title="Adjust how this photo sits in the card">${ICONS.crop}<span>Adjust photo</span></button>`
    : "";

  return `
    <div class="member-card-media${image ? "" : " is-empty"}">
      ${initials}
      ${image}
      ${adjust}
    </div>
  `;
}

function getBadges(profile) {
  const badges = [];
  if (isFeaturedActive(profile)) badges.push({ label: "Featured", className: "is-featured" });
  if (profile.isFoundingMember === true) badges.push({ label: "Founding Member", className: "is-founding" });

  const verified = [
    ["Email", profile.emailVerifiedBadge || profile.emailVerified || profile.isEmailVerified],
    ["Business", profile.businessVerified || profile.isBusinessVerified],
    ["Community", profile.communityVerified || profile.isCommunityVerified],
    ["Gurdwara", profile.gurdwaraVerified || profile.isGurdwaraVerified]
  ].filter(([, value]) => value === true).map(([label]) => label);

  if (verified.length) {
    badges.push({ label: "Verified", className: "is-verified", title: `Verified: ${verified.join(", ")}`, icon: ICONS.check });
  }
  return badges;
}

function getRating(profile) {
  const rating = Number(profile.averageRating || profile.ratingAverage || profile.reviewAverage || profile.rating || 0);
  const count = Number(profile.reviewCount || profile.reviewsCount || profile.totalReviews || 0);
  return { rating, count };
}

export function renderMemberCard(profile, { industry = "", canAdjustPhoto = false } = {}) {
  const rawId = profile.uid || profile.id || "";
  const profileId = encodeURIComponent(rawId);
  const profileUrl = `view.html?id=${profileId}`;
  const identity = getCardIdentity(profile);
  const personName = profile.businessName && profile.fullName && profile.fullName !== profile.businessName ? profile.fullName : "";
  const service = profile.serviceTitle || profile.businessType || "";
  const town = profile.town || profile.serviceArea || "";
  const websiteUrl = safeExternalUrl(profile.website);
  const linkedInUrl = safeExternalUrl(profile.linkedin);
  const tags = (Array.isArray(profile.tags) ? profile.tags : []).filter(Boolean).slice(0, 3);
  const badges = getBadges(profile);
  const { rating, count } = getRating(profile);

  const metaParts = [
    service ? `<span class="member-card-service">${escapeHtml(service)}</span>` : "",
    town ? `<span class="member-card-town">${ICONS.pin}${escapeHtml(town)}</span>` : ""
  ].filter(Boolean);

  return `
    <article class="member-card" data-profile-url="${profileUrl}" tabindex="0" aria-label="${escapeHtml(identity)}: open profile">
      ${renderCardMedia(profile, { canAdjustPhoto })}
      ${badges.length ? `
        <div class="member-card-badges">
          ${badges.map(badge => `<span class="member-badge ${badge.className}"${badge.title ? ` title="${escapeHtml(badge.title)}"` : ""}>${badge.icon || ""}${escapeHtml(badge.label)}</span>`).join("")}
        </div>` : ""}

      <div class="member-card-body">
        ${industry && industry !== "Other" ? `<span class="member-card-industry">${escapeHtml(industry)}</span>` : ""}
        <h3 class="member-card-name">${escapeHtml(identity)}</h3>
        ${personName ? `<p class="member-card-person">${escapeHtml(personName)}</p>` : ""}
        ${metaParts.length ? `<p class="member-card-meta">${metaParts.join('<span class="member-card-dot" aria-hidden="true">&middot;</span>')}</p>` : ""}
        ${count > 0 ? `<p class="member-card-rating"><span aria-hidden="true">&#9733;</span> ${rating.toFixed(1)} <small>(${count} review${count === 1 ? "" : "s"})</small></p>` : ""}
        ${profile.description ? `<p class="member-card-summary">${escapeHtml(profile.description)}</p>` : ""}
        ${tags.length ? `<div class="member-card-tags">${tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      </div>

      <div class="member-card-actions">
        <a class="member-card-primary" href="${profileUrl}">View profile</a>
        <div class="member-card-secondary">
          <button type="button" data-directory-message-id="${profileId}" aria-label="Message ${escapeHtml(identity)}">${ICONS.message}<span>Message</span></button>
          <button type="button" data-directory-connect-id="${profileId}" aria-label="Connect with ${escapeHtml(identity)}">${ICONS.connect}<span>Connect</span></button>
          ${websiteUrl
            ? `<a href="${escapeHtml(websiteUrl)}" target="_blank" rel="noopener" aria-label="${escapeHtml(identity)} website">${ICONS.website}<span>Website</span></a>`
            : linkedInUrl
            ? `<a href="${escapeHtml(linkedInUrl)}" target="_blank" rel="noopener" aria-label="${escapeHtml(identity)} on LinkedIn">${ICONS.linkedin}<span>LinkedIn</span></a>`
            : ""}
        </div>
      </div>
    </article>
  `;
}
