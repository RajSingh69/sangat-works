import { auth, db } from "./firebase.js";

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
  orderBy
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
const freeCharityGrantPanel = document.getElementById("freeCharityGrantPanel");
const createFreeCharityAccountForm = document.getElementById("createFreeCharityAccountForm");
const createFreeCharityAccountMessage = document.getElementById("createFreeCharityAccountMessage");
const freeCharityGrantForm = document.getElementById("freeCharityGrantForm");
const freeCharityGrantMessage = document.getElementById("freeCharityGrantMessage");

const CREATE_FREE_CHARITY_ACCOUNT_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/createFreeCharityAccount";
const GRANT_FREE_CHARITY_YEAR_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/grantFreeCharityYear";

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
  if (isFreeCharityYear(user)) {
    return isFreeCharityYearActive(user)
      ? "Free Charity Year"
      : "Expired Free Access";
  }

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
  const memberNumberControls = permanentInternalAccount
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

  return `
    <details class="admin-user-card">
      <summary>
        <strong>${name}</strong>
        <span>${daysAgo(user.createdAt)}</span>
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

      await updateDoc(doc(db, "users", uid), {
        role,
        internalAccount: role === "super_admin"
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

      await updateDoc(doc(db, "users", uid), {
        [field]: value
      });

      adminStatus.textContent = `Updated ${field}.`;
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

async function loadAdminDashboard() {
  await loadUsers();
  await loadFaqs();
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
