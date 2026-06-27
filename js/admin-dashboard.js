import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  doc,
  getDoc,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  isAdminUser
} from "./roles.js";

const adminDashboardCard = document.getElementById("adminDashboardCard");

const adminTotalUsers = document.getElementById("adminTotalUsers");
const adminPublicProfiles = document.getElementById("adminPublicProfiles");
const adminVerifiedUsers = document.getElementById("adminVerifiedUsers");
const adminPendingUsers = document.getElementById("adminPendingUsers");

async function loadAdminStats() {
  const usersSnap = await getDocs(collection(db, "users"));

  let totalUsers = 0;
  let publicProfiles = 0;
  let verifiedUsers = 0;
  let pendingUsers = 0;

  usersSnap.forEach(docSnap => {
    const user = docSnap.data();

    totalUsers++;

    if (user.isPublic === true) {
      publicProfiles++;
    }

    const isVerified =
      user.emailVerifiedBadge === true ||
      user.communityVerified === true ||
      user.businessVerified === true ||
      user.gurdwaraVerified === true;

    if (isVerified) {
      verifiedUsers++;
    } else {
      pendingUsers++;
    }
  });

  adminTotalUsers.textContent = totalUsers;
  adminPublicProfiles.textContent = publicProfiles;
  adminVerifiedUsers.textContent = verifiedUsers;
  adminPendingUsers.textContent = pendingUsers;
}

if (adminDashboardCard) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) return;

    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) return;

    const userData = userSnap.data();

    if (isAdminUser(userData)) {
      adminDashboardCard.classList.remove("hidden");
      await loadAdminStats();
    }
  });
}
