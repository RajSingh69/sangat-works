import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const poolName = document.getElementById("poolName");
const poolDescription = document.getElementById("poolDescription");

const emptyRolesBox = document.getElementById("emptyRolesBox");
const createStarterRolesBtn = document.getElementById("createStarterRolesBtn");
const rolesList = document.getElementById("rolesList");

const selectedRoleBox = document.getElementById("selectedRoleBox");
const selectedRoleName = document.getElementById("selectedRoleName");
const selectedRoleDescription = document.getElementById("selectedRoleDescription");
const roleMembersList = document.getElementById("roleMembersList");
const joinRoleBtn = document.getElementById("joinRoleBtn");
const joinRoleMessage = document.getElementById("joinRoleMessage");

const poolMessage = document.getElementById("poolMessage");

const params = new URLSearchParams(window.location.search);
const gurdwaraId = params.get("gurdwaraId");
const poolId = params.get("poolId");

let selectedRole = null;
let currentUserProfile = null;

const STARTER_ROLES_BY_POOL = {
  construction: [
    { name: "Builder", description: "Building work, repairs and general construction" },
    { name: "Architect", description: "Plans, drawings and design advice" },
    { name: "Electrician", description: "Electrical work, wiring and installations" },
    { name: "Plumber", description: "Plumbing, heating and water systems" },
    { name: "Labourer", description: "General labouring and site support" },
    { name: "Surveyor", description: "Surveys, valuations and property checks" },
    { name: "Project Manager", description: "Managing construction work and contractors" }
  ],
  software: [
    { name: "Front End Developer", description: "Websites, interfaces and user-facing systems" },
    { name: "Back End Developer", description: "Databases, APIs and server-side systems" },
    { name: "Cloud Engineer", description: "Cloud hosting, storage and infrastructure" },
    { name: "UI/UX Designer", description: "Design, layouts and user experience" },
    { name: "Database Developer", description: "Data structure, queries and database support" }
  ],
  healthcare: [
    { name: "Doctor", description: "Medical advice and clinical support" },
    { name: "Pharmacist", description: "Medicine, pharmacy and prescription advice" },
    { name: "Physiotherapist", description: "Movement, injury and rehabilitation support" },
    { name: "Dentist", description: "Dental care and oral health services" },
    { name: "Mental Health Professional", description: "Wellbeing, counselling and mental health support" }
  ],
  legal: [
    { name: "Solicitor", description: "Legal advice and representation" },
    { name: "Immigration Adviser", description: "Visa, immigration and settlement support" },
    { name: "Family Law Specialist", description: "Family, divorce and child-related legal matters" },
    { name: "Commercial Lawyer", description: "Business, contracts and commercial law" }
  ],
  property: [
    { name: "Estate Agent", description: "Buying, selling and property advice" },
    { name: "Mortgage Broker", description: "Mortgage advice and finance support" },
    { name: "Surveyor", description: "Property surveys and valuations" },
    { name: "Landlord", description: "Rental property and accommodation support" },
    { name: "Property Manager", description: "Managing rental and investment properties" }
  ]
};

async function createStarterRoles(pool, user) {
  const poolKey = (pool.name || "").toLowerCase().trim();
  const starterRoles = STARTER_ROLES_BY_POOL[poolKey] || [];

  if (starterRoles.length === 0) {
    poolMessage.textContent = "No starter roles are available for this pool yet.";
    return;
  }

  createStarterRolesBtn.disabled = true;
  createStarterRolesBtn.textContent = "Creating roles...";
  poolMessage.textContent = "";

  for (const role of starterRoles) {
    await addDoc(collection(db, "roles"), {
      name: role.name,
      description: role.description,
      poolId,
      poolName: pool.name || "",
      gurdwaraId,
      gurdwaraName: pool.gurdwaraName || "",
      createdBy: user.uid,
      createdAt: serverTimestamp()
    });
  }

  poolMessage.textContent = "Starter roles created successfully.";
  await loadRoles();
}



async function loadRoleMembers(roleId) {
  if (!roleMembersList) return;

  roleMembersList.innerHTML = "Loading members...";

  const membersQuery = query(
    collection(db, "roleMembers"),
    where("roleId", "==", roleId)
  );

  const snapshot = await getDocs(membersQuery);

  if (snapshot.empty) {
    roleMembersList.innerHTML = "<p>No members have joined this role yet.</p>";
    return;
  }

  roleMembersList.innerHTML = "";

  snapshot.docs.forEach((docSnap) => {
    const member = docSnap.data();

    const memberCard = document.createElement("a");
    memberCard.className = "pool-card";
    memberCard.href = `view.html?id=${member.userId}`;

    memberCard.innerHTML = `
      <span class="dashboard-number">${member.userName || "Unnamed Member"}</span>
      <span class="dashboard-label">${member.businessName || ""}</span>
      <span class="dashboard-label">${member.serviceTitle || ""}</span>
    `;

    roleMembersList.appendChild(memberCard);
  });
}



async function loadRoles() {
  if (!rolesList || !emptyRolesBox) return;

  rolesList.innerHTML = "Loading roles...";
  emptyRolesBox.style.display = "none";

  const rolesQuery = query(
    collection(db, "roles"),
    where("gurdwaraId", "==", gurdwaraId),
    where("poolId", "==", poolId)
  );

  const snapshot = await getDocs(rolesQuery);

  if (snapshot.empty) {
    rolesList.innerHTML = "";
    emptyRolesBox.style.display = "block";
    return;
  }

  emptyRolesBox.style.display = "none";
  rolesList.innerHTML = "";

  const sortedDocs = snapshot.docs.sort((a, b) => {
    const nameA = (a.data().name || "").toLowerCase();
    const nameB = (b.data().name || "").toLowerCase();
    return nameA.localeCompare(nameB);
  });

  for (const docSnap of sortedDocs) {
    const role = docSnap.data();

    const membersQuery = query(
      collection(db, "roleMembers"),
      where("roleId", "==", docSnap.id)
    );

    const membersSnapshot = await getDocs(membersQuery);
    const memberCount = membersSnapshot.size;

    const card = document.createElement("div");
    card.className = "pool-card";

    card.innerHTML = `
      <span class="dashboard-number">${role.name || "Unnamed Role"}</span>
      <span class="dashboard-label">${role.description || ""}</span>
      <span class="dashboard-label">${memberCount} member${memberCount === 1 ? "" : "s"}</span>
    `;

    card.style.cursor = "pointer";

    card.onclick = () => {
      selectedRole = {
        id: docSnap.id,
        ...role
      };

      selectedRoleBox.style.display = "block";
      selectedRoleName.textContent = role.name || "Unnamed Role";
      selectedRoleDescription.textContent = role.description || "";
      joinRoleMessage.textContent = "";
      joinRoleBtn.disabled = false;
      joinRoleBtn.textContent = "Join This Role";
      loadRoleMembers(docSnap.id);
    };

    rolesList.appendChild(card);
  }
}

async function joinSelectedRole(user) {
  if (!selectedRole) {
    joinRoleMessage.textContent = "Please select a role first.";
    return;
  }

  joinRoleBtn.disabled = true;
  joinRoleBtn.textContent = "Joining...";
  joinRoleMessage.textContent = "";

  const existingMembershipQuery = query(
    collection(db, "roleMembers"),
    where("roleId", "==", selectedRole.id),
    where("userId", "==", user.uid)
  );

  const existingMembership = await getDocs(existingMembershipQuery);

  if (!existingMembership.empty) {
    joinRoleMessage.textContent = "You are already a member of this role.";
    joinRoleBtn.disabled = false;
    joinRoleBtn.textContent = "Join This Role";
    return;
  }

  await addDoc(collection(db, "roleMembers"), {
    roleId: selectedRole.id,
    roleName: selectedRole.name || "",
    roleDescription: selectedRole.description || "",
    poolId,
    poolIdName: selectedRole.poolName || "",
    gurdwaraId,
    gurdwaraName: selectedRole.gurdwaraName || "",
    userId: user.uid,
    userName:
      currentUserProfile?.fullName ||
      currentUserProfile?.name ||
      user.displayName ||
      user.email ||
      "Unnamed Member",
    businessName: currentUserProfile?.businessName || "",
    serviceTitle: currentUserProfile?.serviceTitle || "",
    joinedAt: serverTimestamp()
  });

  joinRoleMessage.textContent = "You have joined this role.";
  joinRoleBtn.textContent = "Joined";

  await loadRoles();
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "login.html";
    return;
  }

  if (!gurdwaraId || !poolId) {
    poolName.textContent = "Pool not found";
    poolMessage.textContent = "No Gurdwara or pool was selected.";
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (userSnap.exists()) {
      currentUserProfile = userSnap.data();
    }

    const poolRef = doc(db, "gurdwaras", gurdwaraId, "pools", poolId);
    const poolSnap = await getDoc(poolRef);

    let pool = null;

    if (poolSnap.exists()) {
      pool = poolSnap.data();
    } else {
      const templateRef = doc(db, "pools", poolId);
      const templateSnap = await getDoc(templateRef);

      if (!templateSnap.exists()) {
        poolName.textContent = "Pool not found";
        poolMessage.textContent = "This pool does not exist.";
        return;
      }

      pool = templateSnap.data();
    }

    poolName.textContent = pool.name || "Unnamed Pool";
    poolDescription.textContent = pool.description || "";

    await loadRoles();

    if (createStarterRolesBtn) {
      createStarterRolesBtn.onclick = async () => {
        await createStarterRoles(pool, user);
      };
    }

    if (joinRoleBtn) {
      joinRoleBtn.onclick = async () => {
        await joinSelectedRole(user);
      };
    }

  } catch (error) {
    poolName.textContent = "Error loading pool";
    poolMessage.textContent = error.message;
  }
});