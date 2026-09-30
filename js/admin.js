import { auth, db, storage } from "./firebase.js";

import {
  deleteObject,
  getDownloadURL,
  ref
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  orderBy,
  serverTimestamp,
  setDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  getUserRole,
  isAdminUser,
  isExcludedFromFoundingMemberCount,
  isInternalAccount,
  isSuperAdmin
} from "./roles.js";

const adminStatus = document.getElementById("adminStatus");
const adminUsers = document.getElementById("adminUsers");

const statTotalUsers = document.getElementById("statTotalUsers");
const statNewUsers = document.getElementById("statNewUsers");
const statFoundingMembers = document.getElementById("statFoundingMembers");
const statPendingFaqs = document.getElementById("statPendingFaqs");

const adminQuestions = document.getElementById("adminQuestions");
const adminFeatures = document.getElementById("adminFeatures");
const adminMessagePreview = document.getElementById("adminMessagePreview");
const adminReports = document.getElementById("adminReports");
const freeCharityGrantPanel = document.getElementById("freeCharityGrantPanel");
const createFreeCharityAccountForm = document.getElementById("createFreeCharityAccountForm");
const createFreeCharityAccountMessage = document.getElementById("createFreeCharityAccountMessage");
const freeCharityGrantForm = document.getElementById("freeCharityGrantForm");
const freeCharityGrantMessage = document.getElementById("freeCharityGrantMessage");

const CREATE_FREE_CHARITY_ACCOUNT_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/createFreeCharityAccount";
const GRANT_FREE_CHARITY_YEAR_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/grantFreeCharityYear";
const RESOLVE_REPORT_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/resolveReport";
const RESTRICT_MESSAGING_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/restrictMessaging";
const UPDATE_USER_ROLE_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/updateUserRole";

let currentAdminData = null;

function getDateFromTimestamp(value) {
  if (!value) return null;

  const date = value.toDate ? value.toDate() : new Date(value);

  if (Number.isNaN(date.getTime())) return null;

  return date;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}


async function callAdminFunction(url, body = {}) {
  if (!auth.currentUser) throw new Error("Please sign in first.");

  const idToken = await auth.currentUser.getIdToken();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`
    },
    body: JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok) throw new Error(data.error || "Admin action failed.");
  return data;
}
function daysAgo(value) {
  const date = getDateFromTimestamp(value);

  if (!date) return "Unknown";

  const diffMs = new Date() - date;
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days === 0) return "Joined today";
  if (days === 1) return "Joined 1 day ago";

  return `Joined ${days} days ago`;
}

function badgeCheckbox(user, field, label) {
  return `
    <label class="check-row admin-check">
      <input 
        type="checkbox" 
        data-uid="${user.uid}" 
        data-field="${field}"
        ${user[field] === true ? "checked" : ""}
      />
      ${label}
    </label>
  `;
}

function isPaidUser(user) {
  return (
    user?.hasSubscription === true &&
    user?.subscriptionStatus === "active"
  );
}

function isFreeCharityYear(user) {
  return user?.accessType === "admin_granted_free_year";
}

function isFreeCharityYearActive(user) {
  if (!isFreeCharityYear(user)) return false;

  const expiryDate = getDateFromTimestamp(user.freeAccessExpiresAt);
  return Boolean(expiryDate && expiryDate > new Date());
}

function getAccountLabel(user) {
  if (isAdminUser(user)) return "Admin";
  if (isFreeCharityYearActive(user)) {
    return user.freeAccessSource === "trial" ? "Free Trial" : "Free Charity Year";
  }
  if (isFreeCharityYear(user) && !isPaidUser(user)) return "Expired Free Access";

  return isPaidUser(user) ? "Paid Member" : "Not Paid";
}

function getMembershipStatusLabel(user) {
  if (isFreeCharityYear(user)) {
    return isFreeCharityYearActive(user)
      ? "Admin Granted"
      : "Expired Free Access";
  }

  if (isPaidUser(user)) return "Active";
  if (user?.subscriptionStatus === "pending-payment") return "Pending Payment";
  if (user?.membershipStatus === "pending") return "Pending Payment";
  return "Not Paid";
}

function getVisibilityLabel(user) {
  if (user?.adminHidden === true) return "Hidden by admin";
  if (user?.isPublic === false) return "Hidden by member";
  return "Visible";
}

function renderUserRow(user) {
  const name = user.businessName || user.fullName || user.email || "Unnamed user";
  const role = getUserRole(user);
  const currentUserIsSuperAdmin = isSuperAdmin(currentAdminData);
  const permanentInternalAccount = isInternalAccount(user);
  const canDelete = currentUserIsSuperAdmin && !permanentInternalAccount;
  const roleControls = currentUserIsSuperAdmin && !permanentInternalAccount
    ? `
      <select class="role-select" data-uid="${user.uid}">
        ${["standard", "member", "moderator", "admin", "super_admin"].map((option) => `
          <option value="${option}" ${role === option ? "selected" : ""}>${option}</option>
        `).join("")}
      </select>

      <button
        class="btn-small save-role-btn"
        data-uid="${user.uid}"
      >
        Save Role
      </button>
    `
    : "";
  const memberNumberControls = !currentUserIsSuperAdmin
    ? `<p><strong>Protected:</strong> Member number and founding access changes require Super Admin backend approval.</p>`
    : permanentInternalAccount
    ? `<p><strong>Permanent internal account:</strong> Role and member number are locked.</p>`
    : `
      <input
        type="number"
        class="member-number-input"
        data-uid="${user.uid}"
        value="${user.memberNumber || ""}"
        placeholder="Member number"
      />

      <button
        class="btn-small save-member-number-btn"
        data-uid="${user.uid}"
      >
        Save Member Number
      </button>
    `;

  const visibilityControls = currentUserIsSuperAdmin
    ? `
      <div class="admin-badge-controls">
        ${badgeCheckbox(user, "adminHidden", "Hide profile from site (directory, map and profile page)")}
        ${badgeCheckbox(user, "pinnedToTop", "Pin to top of every list (above the ranking)")}
      </div>
    `
    : "";

  return `
    <details class="admin-user-card">
      <summary>
        <strong>${name}</strong>
        <span>${user.pinnedToTop === true ? "Pinned · " : ""}${user.adminHidden === true ? "Hidden · " : ""}${daysAgo(user.createdAt)}</span>
      </summary>

      <div class="admin-user-expanded">
        <p><strong>Name:</strong> ${user.fullName || "Not provided"}</p>
        <p><strong>Email:</strong> ${user.email || "Not provided"}</p>
        <p><strong>Service:</strong> ${user.serviceTitle || "Not provided"}</p>
        <p><strong>Town:</strong> ${user.town || "Not provided"}</p>
        <p><strong>Role:</strong> ${role}</p>
        <p><strong>Account:</strong> ${getAccountLabel(user)}</p>

        <p><strong>Membership:</strong> ${user.membershipPlan || "not set"}</p>
        <p><strong>Status:</strong> ${getMembershipStatusLabel(user)}</p>
        <p><strong>Subscription:</strong> ${user.subscriptionStatus || "not set"}</p>
        ${isFreeCharityYear(user) ? `<p><strong>Free access until:</strong> ${getDateFromTimestamp(user.freeAccessExpiresAt)?.toLocaleDateString("en-GB") || "not set"}</p>` : ""}
        ${user.charityName ? `<p><strong>Charity:</strong> ${user.charityName}</p>` : ""}
        <p><strong>Member Number:</strong> ${user.memberNumber || "not assigned"}</p>
        <p><strong>Visibility:</strong> ${getVisibilityLabel(user)}</p>

        <div class="admin-member-controls">
          ${roleControls}
          ${memberNumberControls}
        </div>

        <div class="admin-badge-controls">
          ${badgeCheckbox(user, "emailVerifiedBadge", "Email Verified")}
          ${badgeCheckbox(user, "communityVerified", "Community Verified")}
          ${badgeCheckbox(user, "businessVerified", "Business Verified")}
          ${badgeCheckbox(user, "gurdwaraVerified", "Gurdwara Verified")}
          ${badgeCheckbox(user, "featuredListing", "Featured Listing")}
        </div>

        ${visibilityControls}

        <div class="card-links">
          <a href="view.html?id=${user.uid}" target="_blank">View Profile</a>
          ${
            canDelete
              ? `<button type="button" class="btn-small project-withdraw-btn delete-profile-btn" data-uid="${user.uid}">Delete Profile</button>`
              : ""
          }
        </div>
      </div>
    </details>
  `;
}

function renderFaqCard(item) {
  const typeLabel =
    item.type === "feature"
      ? "Feature Request"
      : "Question / Comment";

  return `
    <div class="admin-user-card">
      <p class="eyebrow">${typeLabel}</p>

      <h3>${item.question || "No question provided"}</h3>

      <p><strong>Asked by:</strong> ${item.name || "Unknown"}</p>
      <p><strong>Email:</strong> ${item.userEmail || "Not provided"}</p>
      <p><strong>Status:</strong> ${item.status || "pending"}</p>

      ${
        item.answer
          ? `<p><strong>Current answer:</strong> ${item.answer}</p>`
          : ""
      }

      <textarea 
        class="faq-answer-input" 
        data-id="${item.id}" 
        rows="4"
        placeholder="Write admin response..."
      >${item.answer || ""}</textarea>

      <button 
        class="btn-small save-faq-answer-btn" 
        data-id="${item.id}"
      >
        Save Response
      </button>
    </div>
  `;
}

async function loadUsers() {
  adminStatus.textContent = "Loading dashboard...";

  const usersRef = collection(db, "users");
  const usersQuery = query(usersRef, orderBy("createdAt", "desc"));
  const snapshot = await getDocs(usersQuery);

  const users = [];

  snapshot.forEach(docSnap => {
    users.push({
      id: docSnap.id,
      ...docSnap.data()
    });
  });

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const newUsers = users.filter(user => {
    const createdAt = getDateFromTimestamp(user.createdAt);
    return createdAt && createdAt >= sevenDaysAgo;
  }).length;

  const foundingMembers = users.filter(user => {
    return (
      user.isFoundingMember === true &&
      !isExcludedFromFoundingMemberCount(user)
    );
  }).length;

  statTotalUsers.textContent = users.length;
  statNewUsers.textContent = newUsers;
  statFoundingMembers.textContent = foundingMembers;

  adminUsers.innerHTML = users.map(renderUserRow).join("");
  adminUsers.classList.remove("hidden");

  adminStatus.textContent = `${users.length} user${users.length === 1 ? "" : "s"} loaded.`;

  setupUserAdminActions();
}

function setupUserAdminActions() {
  document.querySelectorAll(".save-role-btn").forEach(button => {
    button.addEventListener("click", async (e) => {
      if (!isSuperAdmin(currentAdminData)) {
        adminStatus.textContent = "Only Super Admins can change roles.";
        return;
      }

      const uid = e.target.dataset.uid;
      const input = document.querySelector(`.role-select[data-uid="${uid}"]`);
      const role = input.value;
      const targetSnap = await getDoc(doc(db, "users", uid));

      if (targetSnap.exists() && isInternalAccount(targetSnap.data())) {
        adminStatus.textContent = "Permanent internal account roles cannot be changed here.";
        return;
      }

      await callAdminFunction(UPDATE_USER_ROLE_URL, {
        targetUserId: uid,
        role
      });

      adminStatus.textContent = `Role updated to ${role}.`;
    });
  });

  document.querySelectorAll(".delete-profile-btn").forEach(button => {
    button.addEventListener("click", async (e) => {
      if (!isSuperAdmin(currentAdminData)) {
        adminStatus.textContent = "Only Super Admins can delete profiles.";
        return;
      }

      const uid = e.target.dataset.uid;

      if (!window.confirm("Delete this public profile document? This does not delete the Firebase Auth account.")) {
        return;
      }

      await deleteDoc(doc(db, "users", uid));
      adminStatus.textContent = "Profile deleted.";
      await loadUsers();
    });
  });

  document.querySelectorAll(".save-member-number-btn").forEach(button => {
    button.addEventListener("click", async (e) => {
      const uid = e.target.dataset.uid;
      const input = document.querySelector(`.member-number-input[data-uid="${uid}"]`);
      const memberNumber = Number(input.value);
      const targetSnap = await getDoc(doc(db, "users", uid));

      if (targetSnap.exists() && isInternalAccount(targetSnap.data())) {
        adminStatus.textContent = "Internal accounts are excluded from member numbering.";
        return;
      }

      if (!memberNumber) {
        adminStatus.textContent = "Please enter a valid member number.";
        return;
      }

      await updateDoc(doc(db, "users", uid), {
        memberNumber,
        isFoundingMember: memberNumber <= 30,
        internalAccount: false,
        role: memberNumber <= 30 ? "member" : "standard",
        membershipPlan: memberNumber <= 30 ? "founding-free-year" : "paid-required",
        membershipStatus: memberNumber <= 30 ? "active" : "pending-payment"
      });

      adminStatus.textContent = `Member number ${memberNumber} saved. Refresh to see updated status.`;
    });
  });

  document.querySelectorAll(".admin-check input").forEach(input => {
    input.addEventListener("change", async (e) => {
      const uid = e.target.dataset.uid;
      const field = e.target.dataset.field;
      const value = e.target.checked;

      try {
        await updateDoc(doc(db, "users", uid), {
          [field]: value
        });
      } catch (error) {
        console.error(`Failed to update ${field}:`, error);
        e.target.checked = !value;
        adminStatus.textContent = `Could not update ${field}. Only Super Admins can change this.`;
        return;
      }

      adminStatus.textContent = field === "adminHidden"
        ? `Profile ${value ? "hidden from" : "shown on"} the site. Refresh to see updated status.`
        : field === "pinnedToTop"
        ? `Profile ${value ? "pinned to the top of" : "unpinned from"} every list.`
        : `Updated ${field}.`;
    });
  });
}

async function loadFaqs() {
  const faqsSnap = await getDocs(
    query(collection(db, "faqs"), orderBy("createdAt", "desc"))
  );

  const questions = [];
  const features = [];
  let pendingCount = 0;

  faqsSnap.forEach(docSnap => {
    const item = {
      id: docSnap.id,
      ...docSnap.data()
    };

    if (item.status !== "answered") {
      pendingCount++;
    }

    if (item.type === "feature") {
      features.push(item);
    } else {
      questions.push(item);
    }
  });

  statPendingFaqs.textContent = pendingCount;

  adminQuestions.innerHTML = questions.length
    ? questions.map(renderFaqCard).join("")
    : `<div class="empty-state">No questions or comments yet.</div>`;

  adminFeatures.innerHTML = features.length
    ? features.map(renderFaqCard).join("")
    : `<div class="empty-state">No feature requests yet.</div>`;

  setupFaqAdminActions();
}

function setupFaqAdminActions() {
  document.querySelectorAll(".save-faq-answer-btn").forEach(button => {
    button.addEventListener("click", async (e) => {
      const id = e.target.dataset.id;
      const textarea = document.querySelector(`.faq-answer-input[data-id="${id}"]`);
      const answer = textarea.value.trim();

      if (!answer) {
        adminStatus.textContent = "Please write a response first.";
        return;
      }

      await updateDoc(doc(db, "faqs", id), {
        answer,
        status: "answered"
      });

      adminStatus.textContent = "FAQ response saved.";
      await loadFaqs();
  await loadReports();
  setupReportActions();
    });
  });
}

async function createFreeCharityAccount(event) {
  event.preventDefault();

  if (!isAdminUser(currentAdminData)) {
    createFreeCharityAccountMessage.textContent = "Admins only.";
    return;
  }

  const email = document.getElementById("createFreeCharityEmail")?.value.trim();
  const temporaryPassword = document.getElementById("createFreeCharityPassword")?.value || "";
  const charityName = document.getElementById("createFreeCharityName")?.value.trim();
  const notes = document.getElementById("createFreeCharityNotes")?.value.trim();

  if (!email || !temporaryPassword || !charityName) {
    createFreeCharityAccountMessage.textContent =
      "Email, temporary password and charity name are required.";
    return;
  }

  try {
    createFreeCharityAccountMessage.textContent =
      "Creating Free Charity Account...";

    const idToken = await auth.currentUser.getIdToken();
    const response = await fetch(CREATE_FREE_CHARITY_ACCOUNT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        email,
        temporaryPassword,
        charityName,
        notes
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.error) {
      throw new Error(result.error || "Create account failed.");
    }

    const expiryDate = result.freeAccessExpiresAt
      ? new Date(result.freeAccessExpiresAt).toLocaleDateString("en-GB")
      : "1 year from today";

    createFreeCharityAccountMessage.innerHTML = `
      <strong>Free Charity Account ready.</strong><br>
      Email: ${escapeHtml(email)}<br>
      Temporary password: ${escapeHtml(temporaryPassword)}<br>
      Free access expires: ${escapeHtml(expiryDate)}<br>
      ${
        result.passwordWasSet
          ? "Send these details securely and ask the user to change their password after first login."
          : "This email already had a Firebase Auth account, so the password was not changed. Ask the user to use their existing password or reset it securely."
      }
    `;

    createFreeCharityAccountForm.reset();
    await loadUsers();
  } catch (error) {
    createFreeCharityAccountMessage.textContent =
      error.message || "Could not create Free Charity Account.";
  }
}

async function grantFreeCharityYear(event) {
  event.preventDefault();

  if (!isAdminUser(currentAdminData)) {
    freeCharityGrantMessage.textContent = "Admins only.";
    return;
  }

  const email = document.getElementById("freeCharityEmail")?.value.trim();
  const charityName = document.getElementById("freeCharityName")?.value.trim();
  const adminNotes = document.getElementById("freeCharityNotes")?.value.trim();

  if (!email || !charityName) {
    freeCharityGrantMessage.textContent = "Email and charity name are required.";
    return;
  }

  try {
    freeCharityGrantMessage.textContent = "Granting Free Charity Year...";

    const idToken = await auth.currentUser.getIdToken();
    const response = await fetch(GRANT_FREE_CHARITY_YEAR_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        email,
        charityName,
        adminNotes
      })
    });

    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.error) {
      throw new Error(result.error || "Grant failed.");
    }

    if (result.inviteUrl) {
      freeCharityGrantMessage.innerHTML = `
        Invite created. Send this signup link to the charity contact:<br>
        <a href="${result.inviteUrl}" target="_blank">${result.inviteUrl}</a>
      `;
    } else {
      freeCharityGrantMessage.textContent =
        "Free Charity Year granted to the existing account.";
    }

    freeCharityGrantForm.reset();
    await loadUsers();
  } catch (error) {
    freeCharityGrantMessage.textContent =
      error.message || "Could not grant Free Charity Year.";
  }
}

if (createFreeCharityAccountForm) {
  createFreeCharityAccountForm.addEventListener("submit", createFreeCharityAccount);
}

if (freeCharityGrantForm) {
  freeCharityGrantForm.addEventListener("submit", grantFreeCharityYear);
}


function renderReportCard(report) {
  return `
    <article class="admin-user-card">
      <p class="eyebrow">${escapeHtml(report.type || "report")}</p>
      <h3>${escapeHtml(report.reason || "No reason provided")}</h3>
      <p><strong>Reporter:</strong> ${escapeHtml(report.reporterId || "Unknown")}</p>
      <p><strong>Reported member:</strong> ${escapeHtml(report.reportedUserId || "Unknown")}</p>
      ${report.reportedMessage ? `<p><strong>Reported message:</strong> ${escapeHtml(report.reportedMessage)}</p>` : ""}
      ${report.conversationId ? `<p><strong>Conversation:</strong> ${escapeHtml(report.conversationId)}</p>` : ""}
      <p><strong>Status:</strong> ${escapeHtml(report.status || "open")}</p>
      <p><strong>Created:</strong> ${escapeHtml(getDateFromTimestamp(report.createdAt)?.toLocaleString("en-GB") || "Unknown")}</p>
      <div class="card-links">
        ${report.reportedUserId ? `<a href="view.html?id=${encodeURIComponent(report.reportedUserId)}" target="_blank">View Member</a>` : ""}
        <button type="button" class="btn-small project-accept-btn" data-dismiss-report-id="${report.id}">Dismiss</button>
        <button type="button" class="btn-small project-withdraw-btn" data-restrict-report-user-id="${report.reportedUserId || ""}" data-report-id="${report.id}">Restrict Messaging</button>
      </div>
    </article>
  `;
}

async function loadReports() {
  if (!adminReports) return;
  const reportsSnap = await getDocs(query(collection(db, "reports"), orderBy("createdAt", "desc")));
  const reports = reportsSnap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
  adminReports.innerHTML = reports.length
    ? reports.map(renderReportCard).join("")
    : `<div class="empty-state">No safety reports yet.</div>`;
}

function setupReportActions() {
  if (!adminReports) return;
  adminReports.addEventListener("click", async (event) => {
    const dismiss = event.target.closest("[data-dismiss-report-id]");
    const restrict = event.target.closest("[data-restrict-report-user-id]");

    try {
      if (dismiss) {
        await callAdminFunction(RESOLVE_REPORT_URL, {
          reportId: dismiss.dataset.dismissReportId,
          status: "dismissed"
        });
        await loadReports();
      }

      if (restrict?.dataset.restrictReportUserId) {
        await callAdminFunction(RESTRICT_MESSAGING_URL, {
          targetUserId: restrict.dataset.restrictReportUserId
        });
        await callAdminFunction(RESOLVE_REPORT_URL, {
          reportId: restrict.dataset.reportId,
          status: "actioned"
        });
        await loadReports();
      }
    } catch (error) {
      adminStatus.textContent = error.message || "Admin action failed.";
    }
  }, { once: true });
}
const PARIVAR_STATUS_LABELS = { pending: "Waiting for review", approved: "Shown on page", hidden: "Hidden" };

function escapeAdminHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

async function renderParivarMessage(item) {
  let email = "";
  try {
    const contactSnap = await getDoc(doc(db, "parivarMessageContacts", item.id));
    email = contactSnap.exists() ? contactSnap.data().email : "";
  } catch (error) {
    console.warn("Could not load contact email:", error);
  }

  let videoHtml = item.videoPath ? "<p><em>Video missing or still uploading.</em></p>" : "";
  if (item.videoPath) {
    try {
      const url = await getDownloadURL(ref(storage, item.videoPath));
      videoHtml = `<video src="${escapeAdminHtml(url)}" controls preload="metadata" style="width:100%;max-width:420px;border-radius:12px;background:#000;"></video>`;
    } catch (error) {
      console.warn("Video unavailable:", error);
    }
  }

  const status = item.status || "pending";
  const sent = item.createdAt?.toDate ? item.createdAt.toDate().toLocaleString("en-GB") : "";

  return `
    <details class="admin-user-card" ${status === "pending" ? "open" : ""}>
      <summary>
        <strong>${escapeAdminHtml(item.name)}</strong>
        <span>${PARIVAR_STATUS_LABELS[status] || status} &middot; ${escapeAdminHtml(sent)}</span>
      </summary>
      <div class="admin-user-expanded">
        <p><strong>Email (private):</strong> ${email ? `<a href="mailto:${escapeAdminHtml(email)}">${escapeAdminHtml(email)}</a>` : "not found"}</p>
        <p><strong>Message:</strong> ${escapeAdminHtml(item.message)}</p>
        ${videoHtml}
        <div class="card-links">
          ${status !== "approved" ? `<button type="button" class="btn-small parivar-action" data-id="${item.id}" data-action="approved">Approve &amp; show</button>` : ""}
          ${status !== "hidden" ? `<button type="button" class="btn-small parivar-action" data-id="${item.id}" data-action="hidden">Hide</button>` : ""}
          <button type="button" class="btn-small project-withdraw-btn parivar-action" data-id="${item.id}" data-action="delete" data-video="${escapeAdminHtml(item.videoPath || "")}">Delete</button>
        </div>
      </div>
    </details>
  `;
}

async function loadParivarMessages() {
  const container = document.getElementById("adminParivarMessages");
  if (!container) return;

  try {
    const snapshot = await getDocs(collection(db, "parivarMessages"));
    const order = { pending: 0, approved: 1, hidden: 2 };
    const items = snapshot.docs
      .map(docSnap => ({ id: docSnap.id, ...docSnap.data() }))
      .sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3) || (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

    container.innerHTML = items.length
      ? (await Promise.all(items.map(renderParivarMessage))).join("")
      : `<div class="empty-state">No messages yet.</div>`;
  } catch (error) {
    console.error("Could not load Shaheed Parivars messages:", error);
    container.innerHTML = `<div class="empty-state">Could not load messages.</div>`;
  }
}

function setupParivarActions() {
  const container = document.getElementById("adminParivarMessages");
  if (!container) return;

  container.addEventListener("click", async (event) => {
    const button = event.target.closest(".parivar-action");
    if (!button) return;

    const { id, action, video } = button.dataset;
    button.disabled = true;

    try {
      if (action === "delete") {
        if (!window.confirm("Delete this message and its video permanently?")) {
          button.disabled = false;
          return;
        }
        if (video) {
          await deleteObject(ref(storage, video)).catch(error => console.warn("Video not deleted:", error));
        }
        await deleteDoc(doc(db, "parivarMessageContacts", id)).catch(error => console.warn("Contact not deleted:", error));
        await deleteDoc(doc(db, "parivarMessages", id));
        adminStatus.textContent = "Message deleted.";
      } else {
        await updateDoc(doc(db, "parivarMessages", id), {
          status: action,
          reviewedAt: serverTimestamp(),
          reviewedBy: auth.currentUser?.uid || ""
        });
        adminStatus.textContent = action === "approved" ? "Message approved and now shown on the page." : "Message hidden.";
      }
      await loadParivarMessages();
    } catch (error) {
      console.error("Message action failed:", error);
      adminStatus.textContent = "That didn't work. Please try again.";
      button.disabled = false;
    }
  });
}

// Paid business verification requests (functions/promotions.js). Only the super admin
// can change users/{uid}, so the buttons only show for them.
function safeWebsite(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

async function loadVerificationRequests() {
  const container = document.getElementById("adminVerificationRequests");
  if (!container) return;

  try {
    const snapshot = await getDocs(query(collection(db, "users"), where("verificationRequest.status", "==", "pending")));
    const canDecide = isSuperAdmin(currentAdminData);

    container.innerHTML = snapshot.empty
      ? `<div class="empty-state">No verification requests waiting.</div>`
      : snapshot.docs.map(docSnap => {
          const user = docSnap.data();
          const request = user.verificationRequest || {};
          const website = safeWebsite(user.website);
          const paid = request.paidAt?.toDate ? request.paidAt.toDate().toLocaleDateString("en-GB") : "";
          return `
            <div class="admin-user-card verification-request">
              <strong>${escapeHtml(user.businessName || user.fullName || "Member")}</strong>
              <p>${escapeHtml([user.fullName, user.serviceTitle, user.town].filter(Boolean).join(" · "))}</p>
              <p>${website ? `<a href="${escapeHtml(website)}" target="_blank" rel="noopener">${escapeHtml(website)}</a> · ` : "No website · "}Paid ${escapeHtml(paid)}${request.amountPaid ? ` (£${escapeHtml(request.amountPaid)})` : ""}</p>
              <div class="card-links">
                <a class="btn-small" href="view.html?id=${encodeURIComponent(docSnap.id)}" target="_blank" rel="noopener">View profile</a>
                ${canDecide ? `
                  <button type="button" class="btn-small verification-action" data-uid="${escapeHtml(docSnap.id)}" data-action="approve">Approve</button>
                  <button type="button" class="btn-small verification-action" data-uid="${escapeHtml(docSnap.id)}" data-action="reject">Reject</button>` : `<span>Only the super admin can approve or reject.</span>`}
              </div>
            </div>`;
        }).join("");
  } catch (error) {
    console.error("Could not load verification requests:", error);
    container.innerHTML = `<div class="empty-state">Could not load verification requests.</div>`;
  }
}

function setupVerificationActions() {
  const container = document.getElementById("adminVerificationRequests");
  if (!container) return;

  container.addEventListener("click", async (event) => {
    const button = event.target.closest(".verification-action");
    if (!button) return;
    const { uid, action } = button.dataset;
    const review = {
      "verificationRequest.reviewedAt": serverTimestamp(),
      "verificationRequest.reviewedBy": auth.currentUser?.uid || ""
    };

    try {
      if (action === "approve") {
        if (!window.confirm("Approve and add the Business Verified badge?")) return;
        button.disabled = true;
        await updateDoc(doc(db, "users", uid), { ...review, businessVerified: true, "verificationRequest.status": "approved" });
        adminStatus.textContent = "Approved. Their Business Verified badge is now showing.";
      } else {
        const note = window.prompt("Why couldn't they be verified? (They'll see this on their profile page.)", "");
        if (note === null) return;
        button.disabled = true;
        await updateDoc(doc(db, "users", uid), { ...review, "verificationRequest.status": "rejected", "verificationRequest.reviewNote": note.trim().slice(0, 300) });
        adminStatus.textContent = "Rejected. Remember to refund their £15 in Stripe (Payments, find the payment, Refund).";
      }
      await loadVerificationRequests();
    } catch (error) {
      console.error("Verification action failed:", error);
      adminStatus.textContent = "That didn't work. Please try again.";
      button.disabled = false;
    }
  });
}

// Free trial codes for events (trialCodes; claimed through functions/trials.js).
const TRIAL_LENGTHS = { 7: "1 week", 14: "2 weeks", 30: "1 month" };
const trialLink = code => `https://sangatworks.co.uk/trial.html?code=${encodeURIComponent(code)}`;

async function loadTrialCodes() {
  const container = document.getElementById("adminTrialCodes");
  if (!container) return;

  try {
    const snap = await getDocs(collection(db, "trialCodes"));
    const codes = snap.docs.map(codeSnap => codeSnap.data())
      .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
    if (!codes.length) {
      container.innerHTML = `<div class="empty-state">No trial codes yet. Create one above.</div>`;
      return;
    }
    const now = new Date();
    container.innerHTML = codes.map(code => {
      const ends = code.expiresAt?.toDate ? code.expiresAt.toDate() : null;
      const ended = ends && ends < now;
      const full = (code.uses || 0) >= code.maxUses;
      const state = !code.active ? "Switched off" : ended ? "Ended" : full ? "Limit reached" : "Live";
      const link = trialLink(code.code);
      return `
        <details class="admin-user-card trial-code-card" ${state === "Live" ? "open" : ""}>
          <summary><strong>${escapeHtml(code.code)}</strong> &middot; ${escapeHtml(TRIAL_LENGTHS[code.days] || `${code.days} days`)} &middot; ${escapeHtml(state)} &middot; ${code.uses || 0} / ${code.maxUses} signed up</summary>
          ${code.label ? `<p>${escapeHtml(code.label)}</p>` : ""}
          <p><strong>Sign-ups close:</strong> ${ends ? escapeHtml(ends.toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })) : "Not set"}</p>
          <p><strong>Link:</strong> <a href="${escapeHtml(link)}" target="_blank" rel="noopener">${escapeHtml(link)}</a></p>
          <div class="card-links">
            <button type="button" class="btn-small trial-code-action" data-code="${escapeHtml(code.code)}" data-action="qr">Show QR code</button>
            <button type="button" class="btn-small trial-code-action" data-code="${escapeHtml(code.code)}" data-action="copy">Copy link</button>
            <button type="button" class="btn-small trial-code-action" data-code="${escapeHtml(code.code)}" data-action="${code.active ? "off" : "on"}">${code.active ? "Switch off" : "Switch on"}</button>
          </div>
          <div class="trial-qr" data-qr-for="${escapeHtml(code.code)}" hidden></div>
        </details>`;
    }).join("");
  } catch (error) {
    console.error("Could not load trial codes:", error);
    container.innerHTML = `<div class="empty-state">Could not load trial codes.</div>`;
  }
}

function showTrialQr(code) {
  const box = document.querySelector(`[data-qr-for="${CSS.escape(code)}"]`);
  if (!box) return;
  if (!box.hidden) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  box.innerHTML = `<div class="trial-qr-image"></div><p><a class="btn-small" download="sangat-works-trial-${escapeHtml(code)}.png" href="#" data-qr-download>Download QR code</a></p>`;
  if (typeof window.QRCode !== "function") {
    box.querySelector(".trial-qr-image").textContent = "The QR code couldn't load. Refresh the page and try again, or share the link instead.";
    return;
  }
  new window.QRCode(box.querySelector(".trial-qr-image"), { text: trialLink(code), width: 512, height: 512, correctLevel: window.QRCode.CorrectLevel.M });
  // The library draws a canvas (and an image copy); offer it as a download once drawn.
  setTimeout(() => {
    const canvas = box.querySelector("canvas");
    const download = box.querySelector("[data-qr-download]");
    if (canvas && download) download.href = canvas.toDataURL("image/png");
  }, 150);
}

function setupTrialCodes() {
  const form = document.getElementById("trialCodeCreateForm");
  const container = document.getElementById("adminTrialCodes");
  const message = document.getElementById("trialCodeMessage");
  if (!form || !container) return;

  // Default the last day to the coming Sunday.
  const endInput = document.getElementById("trialCodeEnd");
  const sunday = new Date();
  sunday.setDate(sunday.getDate() + ((7 - sunday.getDay()) % 7));
  endInput.value = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, "0")}-${String(sunday.getDate()).padStart(2, "0")}`;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = document.getElementById("trialCodeNew").value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    const days = Number(document.getElementById("trialCodeDays").value);
    const maxUses = Math.round(Number(document.getElementById("trialCodeMax").value));
    const endDate = endInput.value;
    const label = document.getElementById("trialCodeLabel").value.trim().slice(0, 80);

    if (code.length < 3) { message.textContent = "Codes need at least 3 letters or numbers."; return; }
    if (!(maxUses >= 1 && maxUses <= 5000)) { message.textContent = "Set a sign-up limit between 1 and 5000."; return; }
    if (!endDate) { message.textContent = "Pick the last day people can sign up."; return; }
    // Open until the very end of the chosen day (11:59:59pm).
    const expiresAt = new Date(`${endDate}T23:59:59`);
    if (expiresAt < new Date()) { message.textContent = "That day has already passed."; return; }

    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    try {
      const ref = doc(db, "trialCodes", code);
      if ((await getDoc(ref)).exists()) {
        message.textContent = `${code} already exists. Pick a different code.`;
        return;
      }
      await setDoc(ref, {
        code, days, maxUses, uses: 0, expiresAt, active: true, label,
        createdAt: serverTimestamp(), createdBy: auth.currentUser?.uid || ""
      });
      message.textContent = `${code} created. Show its QR code below.`;
      form.reset();
      document.getElementById("trialCodeDays").value = "14";
      document.getElementById("trialCodeMax").value = "200";
      endInput.value = endDate;
      await loadTrialCodes();
      showTrialQr(code);
    } catch (error) {
      console.error("Could not create trial code:", error);
      message.textContent = "That didn't work. Please try again.";
    } finally {
      button.disabled = false;
    }
  });

  container.addEventListener("click", async (event) => {
    const button = event.target.closest(".trial-code-action");
    if (!button) return;
    const { code, action } = button.dataset;
    if (action === "qr") return showTrialQr(code);
    if (action === "copy") {
      await navigator.clipboard.writeText(trialLink(code)).catch(() => {});
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = "Copy link"; }, 2000);
      return;
    }
    button.disabled = true;
    try {
      await updateDoc(doc(db, "trialCodes", code), { active: action === "on" });
      await loadTrialCodes();
    } catch (error) {
      console.error("Trial code update failed:", error);
      message.textContent = "That didn't work. Please try again.";
      button.disabled = false;
    }
  });
}

// Reported Learning Hub posts and replies (learnReports, filed from learning.html).
async function loadLearnReports() {
  const container = document.getElementById("adminLearnReports");
  if (!container) return;

  try {
    const reportsSnap = await getDocs(query(collection(db, "learnReports"), where("status", "==", "open")));
    if (reportsSnap.empty) {
      container.innerHTML = `<div class="empty-state">No open Learning Hub reports.</div>`;
      return;
    }

    const rows = await Promise.all(reportsSnap.docs.map(async reportSnap => {
      const report = reportSnap.data();
      const targetRef = report.replyId
        ? doc(db, "learnPosts", report.postId, "replies", report.replyId)
        : doc(db, "learnPosts", report.postId);
      const [targetSnap, postSnap, reporterSnap] = await Promise.all([
        getDoc(targetRef).catch(() => null),
        report.replyId ? getDoc(doc(db, "learnPosts", report.postId)).catch(() => null) : null,
        getDoc(doc(db, "users", report.reporterId)).catch(() => null)
      ]);
      return {
        id: reportSnap.id,
        report,
        target: targetSnap?.exists() ? targetSnap.data() : null,
        post: report.replyId ? (postSnap?.exists() ? postSnap.data() : null) : (targetSnap?.exists() ? targetSnap.data() : null),
        reporter: reporterSnap?.exists() ? reporterSnap.data() : {}
      };
    }));

    container.innerHTML = rows.map(({ id, report, target, post, reporter }) => {
      const reported = report.createdAt?.toDate ? report.createdAt.toDate().toLocaleDateString("en-GB") : "";
      const reporterName = reporter.fullName || reporter.displayName || reporter.email || "A member";
      const what = report.replyId ? "Reply" : "Post";
      const excerpt = target ? (report.replyId ? target.body : target.title) : "Already deleted";
      const live = target && target.status !== "removed";
      return `
        <details class="admin-user-card" open>
          <summary><strong>${what}:</strong> ${escapeHtml(String(excerpt || "").slice(0, 120))} &middot; reported ${escapeHtml(reported)}</summary>
          <p>${post ? `In <a href="learning.html?post=${encodeURIComponent(report.postId)}" target="_blank" rel="noopener">${escapeHtml(post.title || "a post")}</a>` : "The post has been deleted"}</p>
          <p><strong>Reason:</strong> ${escapeHtml(report.reason || "")}</p>
          <p><strong>Reported by:</strong> ${escapeHtml(reporterName)}</p>
          <div class="card-links">
            ${live ? `<button type="button" class="btn-small learn-report-action" data-id="${escapeHtml(id)}" data-post="${escapeHtml(report.postId)}" data-reply="${escapeHtml(report.replyId || "")}" data-action="remove">Take ${what.toLowerCase()} down</button>` : ""}
            <button type="button" class="btn-small learn-report-action" data-id="${escapeHtml(id)}" data-action="dismiss">${live ? "Dismiss report" : "Close report"}</button>
          </div>
        </details>`;
    }).join("");
  } catch (error) {
    console.error("Could not load Learning Hub reports:", error);
    container.innerHTML = `<div class="empty-state">Could not load Learning Hub reports.</div>`;
  }
}

function setupLearnReportActions() {
  const container = document.getElementById("adminLearnReports");
  if (!container) return;

  container.addEventListener("click", async (event) => {
    const button = event.target.closest(".learn-report-action");
    if (!button) return;
    const { id, post, reply, action } = button.dataset;
    if (action === "remove" && !window.confirm("Take this down? It will be hidden from the Learning Hub.")) return;

    button.disabled = true;
    try {
      if (action === "remove") {
        const ref = reply ? doc(db, "learnPosts", post, "replies", reply) : doc(db, "learnPosts", post);
        await updateDoc(ref, { status: "removed", updatedAt: serverTimestamp() });
      }
      await updateDoc(doc(db, "learnReports", id), {
        status: action === "remove" ? "actioned" : "dismissed",
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser?.uid || ""
      });
      adminStatus.textContent = action === "remove" ? "Taken down." : "Report closed.";
      await loadLearnReports();
    } catch (error) {
      console.error("Learning Hub report action failed:", error);
      adminStatus.textContent = "That didn't work. Please try again.";
      button.disabled = false;
    }
  });
}

// Reported Marketplace listings (marketplaceReports, filed from marketplace.html).
async function loadMarketplaceReports() {
  const container = document.getElementById("adminMarketplaceReports");
  if (!container) return;

  try {
    const reportsSnap = await getDocs(query(collection(db, "marketplaceReports"), where("status", "==", "open")));
    if (reportsSnap.empty) {
      container.innerHTML = `<div class="empty-state">No open marketplace reports.</div>`;
      return;
    }

    const rows = await Promise.all(reportsSnap.docs.map(async reportSnap => {
      const report = reportSnap.data();
      const [listingSnap, reporterSnap] = await Promise.all([
        getDoc(doc(db, "marketplaceListings", report.listingId)).catch(() => null),
        getDoc(doc(db, "users", report.reporterId)).catch(() => null)
      ]);
      return {
        id: reportSnap.id,
        report,
        listing: listingSnap?.exists() ? listingSnap.data() : null,
        reporter: reporterSnap?.exists() ? reporterSnap.data() : {}
      };
    }));

    container.innerHTML = rows.map(({ id, report, listing, reporter }) => {
      const reported = report.createdAt?.toDate ? report.createdAt.toDate().toLocaleDateString("en-GB") : "";
      const reporterName = reporter.fullName || reporter.displayName || reporter.email || "A member";
      const listingLine = listing
        ? `<a href="marketplace.html?listing=${encodeURIComponent(report.listingId)}" target="_blank" rel="noopener">${escapeHtml(listing.title || "Listing")}</a> &middot; ${escapeHtml(listing.town || "")} &middot; ${escapeHtml(listing.status || "")}`
        : "Listing already deleted";
      return `
        <details class="admin-user-card" open>
          <summary><strong>${escapeHtml(listing?.title || "Deleted listing")}</strong> &middot; reported ${escapeHtml(reported)}</summary>
          <p>${listingLine}</p>
          <p><strong>Reason:</strong> ${escapeHtml(report.reason || "")}</p>
          <p><strong>Reported by:</strong> ${escapeHtml(reporterName)}</p>
          <div class="card-links">
            ${listing && listing.status !== "removed" ? `<button type="button" class="btn-small marketplace-report-action" data-id="${escapeHtml(id)}" data-listing="${escapeHtml(report.listingId)}" data-action="remove">Take listing down</button>` : ""}
            <button type="button" class="btn-small marketplace-report-action" data-id="${escapeHtml(id)}" data-action="dismiss">${listing && listing.status !== "removed" ? "Dismiss report" : "Close report"}</button>
          </div>
        </details>`;
    }).join("");
  } catch (error) {
    console.error("Could not load marketplace reports:", error);
    container.innerHTML = `<div class="empty-state">Could not load marketplace reports.</div>`;
  }
}

function setupMarketplaceReportActions() {
  const container = document.getElementById("adminMarketplaceReports");
  if (!container) return;

  container.addEventListener("click", async (event) => {
    const button = event.target.closest(".marketplace-report-action");
    if (!button) return;
    const { id, listing, action } = button.dataset;
    if (action === "remove" && !window.confirm("Take this listing down? The seller will see it as taken down.")) return;

    button.disabled = true;
    try {
      if (action === "remove") {
        await updateDoc(doc(db, "marketplaceListings", listing), { status: "removed", updatedAt: serverTimestamp() });
      }
      await updateDoc(doc(db, "marketplaceReports", id), {
        status: action === "remove" ? "actioned" : "dismissed",
        reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser?.uid || ""
      });
      adminStatus.textContent = action === "remove" ? "Listing taken down." : "Report closed.";
      await loadMarketplaceReports();
    } catch (error) {
      console.error("Marketplace report action failed:", error);
      adminStatus.textContent = "That didn't work. Please try again.";
      button.disabled = false;
    }
  });
}

// Paid job posts from non-member employers (functions/employer-jobs.js).
async function loadEmployerJobs() {
  const container = document.getElementById("adminEmployerJobs");
  if (!container) return;

  try {
    const [pendingSnap, liveSnap] = await Promise.all([
      getDocs(query(collection(db, "employerJobs"), where("status", "==", "pending_review"))),
      getDocs(query(collection(db, "employerJobs"), where("status", "==", "live")))
    ]);
    const jobs = [...pendingSnap.docs, ...liveSnap.docs];
    if (!jobs.length) {
      container.innerHTML = `<div class="empty-state">No employer job posts waiting or live.</div>`;
      return;
    }

    const contacts = new Map(await Promise.all(jobs.map(async jobSnap => {
      const contactSnap = await getDoc(doc(db, "employerJobContacts", jobSnap.id)).catch(() => null);
      return [jobSnap.id, contactSnap?.exists() ? contactSnap.data() : {}];
    })));

    container.innerHTML = jobs.map(jobSnap => {
      const job = jobSnap.data();
      const contact = contacts.get(jobSnap.id) || {};
      const live = job.status === "live";
      const liveUntil = job.liveUntil?.toDate ? job.liveUntil.toDate().toLocaleDateString("en-GB") : "";
      const paid = job.paidAt?.toDate ? job.paidAt.toDate().toLocaleDateString("en-GB") : "";
      const applyLink = safeWebsite(job.applyLink);
      return `
        <details class="admin-user-card employer-job"${live ? "" : " open"}>
          <summary><strong>${escapeHtml(job.title || "Job")}</strong> at ${escapeHtml(job.companyName || "?")} · ${live ? `Live until ${escapeHtml(liveUntil)}` : `Waiting for review (paid ${escapeHtml(paid)})`}</summary>
          <p>${escapeHtml([job.industry, job.location, job.remote ? "Remote OK" : "", job.pay, job.closingDate ? `Closes ${job.closingDate}` : ""].filter(Boolean).join(" · "))}</p>
          <p style="white-space:pre-line">${escapeHtml(job.description || "")}</p>
          <p>Apply: ${applyLink ? `<a href="${escapeHtml(applyLink)}" target="_blank" rel="noopener">${escapeHtml(applyLink)}</a>` : ""}${applyLink && job.applyEmail ? " or " : ""}${escapeHtml(job.applyEmail || "")}</p>
          <p><strong>Contact:</strong> ${escapeHtml([contact.contactName, contact.contactEmail, contact.contactPhone].filter(Boolean).join(" · ") || "Not available")}</p>
          <div class="card-links">
            ${live
              ? `<button type="button" class="btn-small employer-job-action" data-id="${escapeHtml(jobSnap.id)}" data-action="removed">Take down</button>`
              : `<button type="button" class="btn-small employer-job-action" data-id="${escapeHtml(jobSnap.id)}" data-action="live">Approve (30 days)</button>
                 <button type="button" class="btn-small employer-job-action" data-id="${escapeHtml(jobSnap.id)}" data-action="rejected">Reject</button>`}
          </div>
        </details>`;
    }).join("");
  } catch (error) {
    console.error("Could not load employer jobs:", error);
    container.innerHTML = `<div class="empty-state">Could not load employer job posts.</div>`;
  }
}

function setupEmployerJobActions() {
  const container = document.getElementById("adminEmployerJobs");
  if (!container) return;

  container.addEventListener("click", async (event) => {
    const button = event.target.closest(".employer-job-action");
    if (!button) return;
    const { id, action } = button.dataset;
    const update = { status: action, reviewedAt: serverTimestamp(), reviewedBy: auth.currentUser?.uid || "" };

    if (action === "live") {
      if (!window.confirm("Approve this job? It goes live on Opportunities for 30 days.")) return;
      update.liveUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    } else if (action === "rejected") {
      const note = window.prompt("Reason for rejecting (for your records):", "");
      if (note === null) return;
      update.reviewNote = note.trim().slice(0, 300);
    } else if (!window.confirm("Take this job off the board?")) {
      return;
    }

    button.disabled = true;
    try {
      await updateDoc(doc(db, "employerJobs", id), update);
      adminStatus.textContent = action === "live"
        ? "Approved. The job is now live on Opportunities."
        : action === "rejected"
        ? "Rejected. Remember to refund their £25 in Stripe (Payments, find the payment, Refund)."
        : "Job taken down.";
      await loadEmployerJobs();
    } catch (error) {
      console.error("Employer job action failed:", error);
      adminStatus.textContent = "That didn't work. Please try again.";
      button.disabled = false;
    }
  });
}

async function loadAdminDashboard() {
  await loadUsers();
  await loadFaqs();
  await loadReports();
  setupReportActions();
  await loadParivarMessages();
  setupParivarActions();
  await loadVerificationRequests();
  setupVerificationActions();
  await loadEmployerJobs();
  setupEmployerJobActions();
  await loadMarketplaceReports();
  setupMarketplaceReportActions();
  await loadLearnReports();
  setupLearnReportActions();
  await loadTrialCodes();
  setupTrialCodes();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  const adminRef = doc(db, "users", user.uid);
  const adminSnap = await getDoc(adminRef);

  if (!adminSnap.exists()) {
    adminStatus.textContent = "Access denied.";
    return;
  }

  const adminData = adminSnap.data();
  currentAdminData = adminData;

  if (!isAdminUser(adminData)) {
    adminStatus.textContent = "Access denied. Admins only.";
    return;
  }

  adminMessagePreview?.classList.remove("hidden");
  freeCharityGrantPanel?.classList.remove("hidden");

  await loadAdminDashboard();
});



