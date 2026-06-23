import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const adminStatus = document.getElementById("adminStatus");
const adminUsers = document.getElementById("adminUsers");

let currentAdmin = null;

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

function renderUserCard(user) {
  return `
    <div class="admin-user-card">
      <h3>${user.businessName || user.fullName || "Unnamed user"}</h3>
      <p><strong>Name:</strong> ${user.fullName || "Not provided"}</p>
      <p><strong>Email:</strong> ${user.email || "Not provided"}</p>
      <p><strong>Service:</strong> ${user.serviceTitle || "Not provided"}</p>
      <p><strong>Town:</strong> ${user.town || "Not provided"}</p>
      <p><strong>Account:</strong> ${user.accountType || "member"}</p>

      <p><strong>Membership:</strong> ${user.membershipPlan || "not set"}</p>
      <p><strong>Status:</strong> ${user.membershipStatus || "not set"}</p>
      <p><strong>Member Number:</strong> ${user.memberNumber || "not assigned"}</p>

      <div class="admin-member-controls">
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
      </div>
    </div>
  `;
}

async function loadUsers() {
  adminStatus.textContent = "Loading users...";

  const usersRef = collection(db, "users");
  const usersQuery = query(usersRef, orderBy("fullName"));
  const snapshot = await getDocs(usersQuery);

  const users = [];

  snapshot.forEach(docSnap => {
    users.push({
      id: docSnap.id,
      ...docSnap.data()
    });
  });

  adminUsers.innerHTML = users.map(renderUserCard).join("");
  adminUsers.classList.remove("hidden");

  adminStatus.textContent = `${users.length} user profile${users.length === 1 ? "" : "s"} loaded.`;


  
  document.querySelectorAll(".save-member-number-btn").forEach(button => {
    button.addEventListener("click", async (e) => {
      const uid = e.target.dataset.uid;
      const input = document.querySelector(`.member-number-input[data-uid="${uid}"]`);
      const memberNumber = Number(input.value);

      if (!memberNumber) {
        adminStatus.textContent = "Please enter a valid member number.";
        return;
      }

      await updateDoc(doc(db, "users", uid), {
        memberNumber,
        isFoundingMember: memberNumber <= 30,
        membershipPlan: memberNumber <= 30 ? "founding-free-year" : "paid-required",
        membershipStatus: memberNumber <= 30 ? "active" : "pending-payment"
      });

      adminStatus.textContent = `Member number ${memberNumber} saved.`;
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

      adminStatus.textContent = `Updated ${field} for user.`;
    });
  });
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

  if (adminData.accountType !== "admin" && adminData.isAdmin !== true) {
    adminStatus.textContent = "Access denied. Admins only.";
    return;
  }

  currentAdmin = user;
  await loadUsers();
});