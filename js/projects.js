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
  orderBy,
  serverTimestamp,
  updateDoc,
  deleteDoc,
  increment,
  arrayUnion
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  hasActiveSubscription
} from "./subscription-guard.js";

import {
  canAccessAnyWorkspace,
  isSuperAdmin
} from "./roles.js";

const TRADES_JOB_ACCESS_CHECKOUT_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/createTradesJobAccessCheckoutSession";
const PROJECT_WORKSPACE_UNLOCK_CHECKOUT_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/createProjectWorkspaceUnlockSession";
const SUPER_ADMIN_UNLOCK_WORKSPACE_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/unlockProjectWorkspaceAsSuperAdmin";

const projectsAuthMessage = document.getElementById("projectsAuthMessage");
const projectsMemberArea = document.getElementById("projectsMemberArea");
const projectsLoggedOutArea = document.getElementById("projectsLoggedOutArea");
const projectsUserBadge = document.getElementById("projectsUserBadge");
const projectRoleChoiceSection = document.getElementById("projectRoleChoiceSection");
const projectRoleSummarySection = document.getElementById("projectRoleSummarySection");
const projectRoleSummaryTitle = document.getElementById("projectRoleSummaryTitle");
const projectRoleSummaryText = document.getElementById("projectRoleSummaryText");
const projectRoleChoiceMessage = document.getElementById("projectRoleChoiceMessage");
const changeProjectRoleBtn = document.getElementById("changeProjectRoleBtn");
const openJobsCountText = document.getElementById("openJobsCountText");
const tradesJobAccessStatusText = document.getElementById("tradesJobAccessStatusText");
const tradesJobAccessCheckoutBtn = document.getElementById("tradesJobAccessCheckoutBtn");
const tradesJobAccessMessage = document.getElementById("tradesJobAccessMessage");
const summaryProjectsMode = document.getElementById("summaryProjectsMode");
const summaryHomeownerProjects = document.getElementById("summaryHomeownerProjects");
const summaryOpenJobs = document.getElementById("summaryOpenJobs");
const summaryTradesAccess = document.getElementById("summaryTradesAccess");
const summaryTradesAccessExpiry = document.getElementById("summaryTradesAccessExpiry");
const summaryUnlockedWorkspaces = document.getElementById("summaryUnlockedWorkspaces");
const summaryLockedWorkspaces = document.getElementById("summaryLockedWorkspaces");
const summaryPaymentStatus = document.getElementById("summaryPaymentStatus");
const workspaceHomeownerProjectCount = document.getElementById("workspaceHomeownerProjectCount");
const workspaceProtectionMessage = document.getElementById("workspaceProtectionMessage");
const workspaceChooseProjectBtn = document.getElementById("workspaceChooseProjectBtn");

const createProjectForm = document.getElementById("createProjectForm");
const projectFormMessage = document.getElementById("projectFormMessage");

const myProjectsList = document.getElementById("myProjectsList");
const openProjectsList = document.getElementById("openProjectsList");
const myApplicationsList = document.getElementById("myApplicationsList");
const myTeamsList = document.getElementById("myTeamsList");

const workspaceProjectSelect = document.getElementById("workspaceProjectSelect");
const workspaceMessage = document.getElementById("workspaceMessage");
const workspaceLockedBox = document.getElementById("workspaceLockedBox");
const workspaceShell = document.getElementById("workspaceShell");

const workspaceTaskForm = document.getElementById("workspaceTaskForm");
const workspaceNoteForm = document.getElementById("workspaceNoteForm");
const workspaceTasksList = document.getElementById("workspaceTasksList");
const workspaceNotesList = document.getElementById("workspaceNotesList");

const workspaceTaskCount = document.getElementById("workspaceTaskCount");
const workspaceOpenTaskCount = document.getElementById("workspaceOpenTaskCount");
const workspaceNoteCount = document.getElementById("workspaceNoteCount");
const workspaceProgressLabel = document.getElementById("workspaceProgressLabel");
const workspaceProgressSelect = document.getElementById("workspaceProgressSelect");
const saveWorkspaceProgressBtn = document.getElementById("saveWorkspaceProgressBtn");
const workspaceProgressMessage = document.getElementById("workspaceProgressMessage");

const workspaceTaskTitle = document.getElementById("workspaceTaskTitle");
const workspaceTaskAssignedTo = document.getElementById("workspaceTaskAssignedTo");
const workspaceTaskDueDate = document.getElementById("workspaceTaskDueDate");
const workspaceTaskMessage = document.getElementById("workspaceTaskMessage");

const workspaceNoteText = document.getElementById("workspaceNoteText");
const workspaceNoteMessage = document.getElementById("workspaceNoteMessage");

const PROJECT_DASHBOARD_SECTIONS = {
  homeowner: [
    "createProjectSection",
    "myProjectsSection",
    "openProjectsSection",
    "projectWorkspaceSection"
  ],
  tradesperson: [
    "openProjectsSection",
    "myApplicationsSection",
    "myTeamsSection",
    "projectWorkspaceSection"
  ]
};

let currentUser = null;
let currentUserData = null;
let currentUserIsMember = false;
let currentProjectUserType = "";
let openProjectJobCount = 0;
let homeownerProjectCount = 0;
let unlockedWorkspaceCount = 0;
let lockedWorkspaceCount = 0;

let myApplicationMap = new Map();
let projectApplicationsMap = new Map();
let projectTeamsMap = new Map();
let myTeamProjectMap = new Map();
let workspaceProjectsMap = new Map();
let selectedWorkspaceProject = null;

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!user) {
    showLoggedOutState();
    renderSignedOutProjectAreas();
    return;
  }

  try {
    const userRef = doc(db, "users", user.uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
      showBlockedState("Your profile could not be found. Please complete your Sangat Works profile first.");
      renderSignedOutProjectAreas();
      return;
    }

    currentUserData = userSnap.data();
    currentUserIsMember = hasActiveSubscription(currentUserData);
    currentProjectUserType = getProjectUserType(currentUserData);

    showMemberState(currentUserData);
    await refreshProjectsDashboard();
  } catch (error) {
    console.error(error);
    showBlockedState("Something went wrong loading Projects. Please refresh and try again.");
  }
});

if (createProjectForm) {
  createProjectForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!currentUser) {
      setFormMessage("Please login or create an account to publish a project.");
      return;
    }

    const selectedTrades = getSelectedTrades();

    const title = getInputValue("projectTitle");
    const projectType = getInputValue("projectType");
    const description = getInputValue("projectDescription");
    const location = getInputValue("projectLocation");
    const budget = getInputValue("projectBudget");
    const estimatedStart = getInputValue("projectStartDate");
    const estimatedFinish = getInputValue("projectEndDate");

    if (!title || !projectType || !description || !location) {
      setFormMessage("Please complete the required project fields.");
      return;
    }

    if (selectedTrades.length === 0) {
      setFormMessage("Please select at least one required trade.");
      return;
    }

    try {
      setFormMessage("Publishing project...");

      const ownerName = getCurrentUserDisplayName();

      await addDoc(collection(db, "projects"), {
        ownerId: currentUser.uid,
        ownerEmail: currentUser.email,
        ownerName,
        title,
        titleLower: title.toLowerCase(),
        projectType,
        description,
        location,
        locationLower: location.toLowerCase(),
        budget,
        estimatedStart,
        estimatedFinish,
        requiredTrades: selectedTrades,
        filledTradeRoles: [],
        status: "open",
        progressStage: "planning",
        applicantCount: 0,
        pendingApplicantCount: 0,
        acceptedApplicantCount: 0,
        rejectedApplicantCount: 0,
        teamCount: 0,
        workspaceUnlocked: false,
        workspacePaymentStatus: "locked",
        workspaceUnlockAmount: 40,
        visibility: "public",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });

      createProjectForm.reset();
      setFormMessage("Project published successfully.");

      await refreshProjectsDashboard();

      document.getElementById("myProjectsSection")?.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    } catch (error) {
      console.error(error);
      setFormMessage("Could not publish project. Please try again.");
    }
  });
}

if (openProjectsList) {
  openProjectsList.addEventListener("click", async (event) => {
    const applyButton = event.target.closest("[data-apply-project-id]");
    const withdrawButton = event.target.closest("[data-withdraw-application-id]");

    if (applyButton) {
      const projectId = applyButton.getAttribute("data-apply-project-id");
      const originalText = applyButton.textContent;

      applyButton.disabled = true;
      applyButton.textContent = "Applying...";

      await applyToProject(
        projectId,
        applyButton.getAttribute("data-selected-trade-role") || ""
      );

      if (document.body.contains(applyButton) && !myApplicationMap.has(projectId)) {
        applyButton.disabled = false;
        applyButton.textContent = originalText;
      }
    }

    if (withdrawButton) {
      await withdrawApplication(
        withdrawButton.getAttribute("data-withdraw-application-id"),
        withdrawButton.getAttribute("data-project-id")
      );
    }
  });
}

if (myApplicationsList) {
  myApplicationsList.addEventListener("click", async (event) => {
    const withdrawButton = event.target.closest("[data-withdraw-application-id]");

    if (withdrawButton) {
      await withdrawApplication(
        withdrawButton.getAttribute("data-withdraw-application-id"),
        withdrawButton.getAttribute("data-project-id")
      );
    }
  });
}

if (myProjectsList) {
  myProjectsList.addEventListener("click", async (event) => {
    const acceptButton = event.target.closest("[data-accept-application-id]");
    const rejectButton = event.target.closest("[data-reject-application-id]");
    const unlockButton = event.target.closest("[data-unlock-workspace-project-id]");

    if (acceptButton) {
      await acceptApplication(acceptButton.getAttribute("data-accept-application-id"));
    }

    if (rejectButton) {
      await rejectApplication(rejectButton.getAttribute("data-reject-application-id"));
    }

    if (unlockButton) {
      await startWorkspaceUnlockCheckout(
        unlockButton.getAttribute("data-unlock-workspace-project-id"),
        unlockButton
      );
    }
  });
}

if (workspaceProjectSelect) {
  workspaceProjectSelect.addEventListener("change", async () => {
    const projectId = workspaceProjectSelect.value;

    if (!projectId) {
      selectedWorkspaceProject = null;
      hideWorkspacePanels();
      setWorkspaceMessage("Select a project to open its workspace.");
      return;
    }

    selectedWorkspaceProject = workspaceProjectsMap.get(projectId) || null;

    if (!selectedWorkspaceProject) {
      hideWorkspacePanels();
      setWorkspaceMessage("Could not find this workspace project.");
      return;
    }

    await loadSelectedWorkspace();
  });
}

if (workspaceTaskForm) {
  workspaceTaskForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createWorkspaceTask();
  });
}

if (workspaceNoteForm) {
  workspaceNoteForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await createWorkspaceNote();
  });
}

if (saveWorkspaceProgressBtn) {
  saveWorkspaceProgressBtn.addEventListener("click", async () => {
    await saveWorkspaceProgress();
  });
}

if (workspaceTasksList) {
  workspaceTasksList.addEventListener("click", async (event) => {
    const completeButton = event.target.closest("[data-complete-task-id]");
    const reopenButton = event.target.closest("[data-reopen-task-id]");
    const deleteButton = event.target.closest("[data-delete-task-id]");

    if (completeButton) {
      await updateTaskStatus(completeButton.getAttribute("data-complete-task-id"), "completed");
    }

    if (reopenButton) {
      await updateTaskStatus(reopenButton.getAttribute("data-reopen-task-id"), "open");
    }

    if (deleteButton) {
      await deleteWorkspaceTask(deleteButton.getAttribute("data-delete-task-id"));
    }
  });
}

async function refreshProjectsDashboard() {
  await loadMyApplications();
  await loadMyTeamMemberships();
  await loadProjectApplicationsForOwnedProjects();
  await loadProjectTeamsForOwnedProjects();
  await loadMyProjects();
  await loadOpenProjects();
  await buildWorkspaceProjectOptions();
  updateProjectsRoleUI();
  updateProjectsAccountSummary();
  updateWorkspaceProtectionUI();
}

function showLoggedOutState() {
  currentProjectUserType = "";
  resetProjectSummaryCounts();
  projectsLoggedOutArea?.classList.remove("hidden");
  projectsMemberArea?.classList.add("hidden");
  projectRoleChoiceSection?.classList.add("hidden");
  projectRoleSummarySection?.classList.add("hidden");
  setDashboardSectionsVisible([]);

  if (projectsAuthMessage) {
    projectsAuthMessage.textContent = "Login or create an account to access Sangat Works Projects.";
  }
}

function showBlockedState(message) {
  currentProjectUserType = "";
  resetProjectSummaryCounts();
  projectsLoggedOutArea?.classList.remove("hidden");
  projectsMemberArea?.classList.add("hidden");
  projectRoleChoiceSection?.classList.add("hidden");
  projectRoleSummarySection?.classList.add("hidden");
  setDashboardSectionsVisible([]);

  if (projectsAuthMessage) {
    projectsAuthMessage.textContent = message;
  }
}

function showMemberState(userData) {
  projectsLoggedOutArea?.classList.add("hidden");
  projectsMemberArea?.classList.remove("hidden");
  updateProjectsRoleUI();

  if (projectsUserBadge) {
    projectsUserBadge.textContent = isSuperAdmin(userData)
      ? "Super Admin"
      : currentUserIsMember
      ? getMembershipLabel(userData)
      : "Free Homeowner";
  }

  if (projectsAuthMessage) {
    projectsAuthMessage.textContent = currentUserIsMember
      ? "Projects is live. You can create projects, apply, build teams and use unlocked workspaces."
      : "Projects is live. You can create homeowner projects for free. Active membership is required to apply as a tradesperson.";
  }

  updateProjectsAccountSummary();
  updateWorkspaceProtectionUI();
}

if (tradesJobAccessCheckoutBtn) {
  tradesJobAccessCheckoutBtn.addEventListener("click", startTradesJobAccessCheckout);
}

document.querySelectorAll(".project-role-choice-btn").forEach((button) => {
  button.addEventListener("click", async () => {
    await saveProjectUserType(button.dataset.projectUserType);
  });
});

if (changeProjectRoleBtn) {
  changeProjectRoleBtn.addEventListener("click", () => {
    currentProjectUserType = "";
    showProjectRoleChoice();
  });
}

if (workspaceChooseProjectBtn) {
  workspaceChooseProjectBtn.addEventListener("click", (event) => {
    if (homeownerProjectCount > 0) return;

    event.preventDefault();
    updateWorkspaceProtectionUI();
  });
}

async function saveProjectUserType(projectUserType) {
  if (!currentUser || !["homeowner", "tradesperson"].includes(projectUserType)) {
    return;
  }

  try {
    setProjectRoleChoiceMessage("Saving your Projects dashboard...");

    await updateDoc(doc(db, "users", currentUser.uid), {
      projectsUserType: projectUserType,
      projectsUserTypeUpdatedAt: serverTimestamp()
    });

    currentProjectUserType = projectUserType;
    currentUserData = {
      ...currentUserData,
      projectsUserType: projectUserType
    };

    setProjectRoleChoiceMessage("");
    updateProjectsRoleUI();

    const targetId = projectUserType === "homeowner"
      ? "createProjectSection"
      : "openProjectsSection";

    document.getElementById(targetId)?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  } catch (error) {
    console.error(error);
    setProjectRoleChoiceMessage("Could not save your Projects role. Please try again.");
  }
}

function getProjectUserType(userData) {
  return ["homeowner", "tradesperson"].includes(userData?.projectsUserType)
    ? userData.projectsUserType
    : "";
}

function updateProjectsRoleUI() {
  if (!currentUser) {
    projectRoleChoiceSection?.classList.add("hidden");
    projectRoleSummarySection?.classList.add("hidden");
    setDashboardSectionsVisible([]);
    updateProjectsAccountSummary();
    updateWorkspaceProtectionUI();
    return;
  }

  if (!currentProjectUserType) {
    showProjectRoleChoice();
    return;
  }

  projectRoleChoiceSection?.classList.add("hidden");
  projectRoleSummarySection?.classList.remove("hidden");
  setDashboardSectionsVisible(PROJECT_DASHBOARD_SECTIONS[currentProjectUserType] || []);

  if (projectRoleSummaryTitle) {
    projectRoleSummaryTitle.textContent = currentProjectUserType === "homeowner"
      ? "Homeowner Dashboard"
      : "Tradesperson Dashboard";
  }

  if (projectRoleSummaryText) {
    projectRoleSummaryText.textContent = currentProjectUserType === "homeowner"
      ? "Create projects for free, review applicants and unlock workspaces after payment."
      : "Browse open jobs, buy Job Access if needed, apply to projects and manage accepted teams.";
  }

  updateProjectsAccountSummary();
  updateWorkspaceProtectionUI();
}

function showProjectRoleChoice() {
  projectRoleChoiceSection?.classList.remove("hidden");
  projectRoleSummarySection?.classList.add("hidden");
  setDashboardSectionsVisible([]);
}

function setDashboardSectionsVisible(visibleSectionIds) {
  const visible = new Set(visibleSectionIds);

  Object.values(PROJECT_DASHBOARD_SECTIONS)
    .flat()
    .forEach((sectionId) => {
      document.getElementById(sectionId)?.classList.toggle("hidden", !visible.has(sectionId));
    });
}

function setProjectRoleChoiceMessage(message) {
  if (projectRoleChoiceMessage) projectRoleChoiceMessage.textContent = message;
}

function getMembershipLabel(userData) {
  if (userData?.isFoundingMember === true) {
    return `Founding Member #${userData.memberNumber || ""}`;
  }

  if (userData?.subscriptionPlan === "yearly") {
    return "Yearly Member";
  }

  if (userData?.subscriptionPlan === "monthly") {
    return "Monthly Member";
  }

  return "Member";
}

async function loadMyProjects() {
  if (!myProjectsList || !currentUser) return;

  homeownerProjectCount = 0;
  unlockedWorkspaceCount = 0;
  lockedWorkspaceCount = 0;
  myProjectsList.innerHTML = `<div class="empty-state">Loading your projects...</div>`;

  try {
    const myProjectsQuery = query(
      collection(db, "projects"),
      where("ownerId", "==", currentUser.uid),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(myProjectsQuery);
    homeownerProjectCount = snapshot.size;

    if (snapshot.empty) {
      myProjectsList.innerHTML = `<div class="empty-state">You have not created any projects yet.</div>`;
      return;
    }

    myProjectsList.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const project = {
        id: docSnap.id,
        ...docSnap.data()
      };

      if (project.workspaceUnlocked) {
        unlockedWorkspaceCount += 1;
      } else {
        lockedWorkspaceCount += 1;
      }

      myProjectsList.innerHTML += renderProjectCard(project, "owner");
    });
  } catch (error) {
    console.error(error);
    homeownerProjectCount = 0;
    unlockedWorkspaceCount = 0;
    lockedWorkspaceCount = 0;
    myProjectsList.innerHTML = `<div class="empty-state">Could not load your projects. Firestore may ask you to create an index.</div>`;
  }
}

async function loadOpenProjects() {
  if (!openProjectsList) return;

  openProjectsList.innerHTML = `<div class="empty-state">Loading open projects...</div>`;

  try {
    const openProjectsQuery = query(
      collection(db, "projects"),
      where("status", "==", "open"),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(openProjectsQuery);
    openProjectJobCount = snapshot.size;
    renderTradesJobAccessBox();

    if (snapshot.empty) {
      openProjectsList.innerHTML = `<div class="empty-state">There are currently no open projects available. Please check back soon.</div>`;
      return;
    }

    if (!canAccessProjectJobs() && currentProjectUserType !== "homeowner") {
      openProjectsList.innerHTML = `<div class="empty-state">Buy job access or use active membership to view and apply to open project jobs.</div>`;
      return;
    }

    openProjectsList.innerHTML = "";

    snapshot.forEach((docSnap) => {
      openProjectsList.innerHTML += renderProjectCard({
        id: docSnap.id,
        ...docSnap.data()
      }, currentProjectUserType === "homeowner" ? "browse" : "trade");
    });
  } catch (error) {
    console.error(error);
    openProjectJobCount = 0;
    renderTradesJobAccessBox();
    openProjectsList.innerHTML = `<div class="empty-state">Could not load open projects. Firestore may ask you to create an index.</div>`;
  }
}

async function loadMyApplications() {
  if (!myApplicationsList || !currentUser) return;

  myApplicationMap = new Map();
  myApplicationsList.innerHTML = `<div class="empty-state">Loading your applications...</div>`;

  try {
    const myApplicationsQuery = query(
      collection(db, "applications"),
      where("applicantId", "==", currentUser.uid),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(myApplicationsQuery);

    if (snapshot.empty) {
      myApplicationsList.innerHTML = `<div class="empty-state">You have not applied to any projects yet.</div>`;
      return;
    }

    myApplicationsList.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const application = {
        id: docSnap.id,
        ...docSnap.data()
      };

      myApplicationMap.set(application.projectId, application);
      myApplicationsList.innerHTML += renderApplicationCard(application);
    });
  } catch (error) {
    console.error(error);
    myApplicationsList.innerHTML = `<div class="empty-state">Could not load your applications. Firestore may ask you to create an index.</div>`;
  }
}

async function loadProjectApplicationsForOwnedProjects() {
  projectApplicationsMap = new Map();

  if (!currentUser) return;

  try {
    const ownedApplicationsQuery = query(
      collection(db, "applications"),
      where("projectOwnerId", "==", currentUser.uid),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(ownedApplicationsQuery);

    snapshot.forEach((docSnap) => {
      const application = {
        id: docSnap.id,
        ...docSnap.data()
      };

      const existing = projectApplicationsMap.get(application.projectId) || [];
      existing.push(application);
      projectApplicationsMap.set(application.projectId, existing);
    });
  } catch (error) {
    console.error(error);
  }
}

async function loadProjectTeamsForOwnedProjects() {
  projectTeamsMap = new Map();

  if (!currentUser) return;

  try {
    const ownedTeamsQuery = query(
      collection(db, "projectTeams"),
      where("projectOwnerId", "==", currentUser.uid),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(ownedTeamsQuery);

    snapshot.forEach((docSnap) => {
      const teamMember = {
        id: docSnap.id,
        ...docSnap.data()
      };

      const existing = projectTeamsMap.get(teamMember.projectId) || [];
      existing.push(teamMember);
      projectTeamsMap.set(teamMember.projectId, existing);
    });
  } catch (error) {
    console.error(error);
  }
}

async function loadMyTeamMemberships() {
  myTeamProjectMap = new Map();

  if (!myTeamsList || !currentUser) return;

  myTeamsList.innerHTML = `<div class="empty-state">Loading your project teams...</div>`;

  try {
    const myTeamsQuery = query(
      collection(db, "projectTeams"),
      where("memberId", "==", currentUser.uid),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(myTeamsQuery);

    if (snapshot.empty) {
      myTeamsList.innerHTML = `<div class="empty-state">You are not on any project teams yet.</div>`;
      return;
    }

    myTeamsList.innerHTML = "";

    snapshot.forEach((docSnap) => {
      const teamMember = {
        id: docSnap.id,
        ...docSnap.data()
      };

      myTeamProjectMap.set(teamMember.projectId, teamMember);
      myTeamsList.innerHTML += renderTeamMembershipCard(teamMember);
    });
  } catch (error) {
    console.error(error);
    myTeamsList.innerHTML = `<div class="empty-state">Could not load your project teams. Firestore may ask you to create an index.</div>`;
  }
}

async function applyToProject(projectId, selectedTradeRole = "") {
  if (!currentUser || !projectId) return;

  if (!canAccessProjectJobs()) {
    alert("Active Sangat Works membership or a 30-day Job Access Pass is required to apply as a tradesperson.");
    return;
  }

  if (myApplicationMap.has(projectId)) {
    alert("You have already applied to this project.");
    return;
  }

  if (myTeamProjectMap.has(projectId)) {
    alert("You are already on this project team.");
    return;
  }

  try {
    const projectRef = doc(db, "projects", projectId);
    const projectSnap = await getDoc(projectRef);

    if (!projectSnap.exists()) {
      alert("This project could not be found.");
      return;
    }

    const project = projectSnap.data();
    const requiredTrades = Array.isArray(project.requiredTrades) ? project.requiredTrades : [];
    const filledTradeRoles = Array.isArray(project.filledTradeRoles) ? project.filledTradeRoles : [];
    const openTradeRoles = requiredTrades.filter((trade) => !filledTradeRoles.includes(trade));

    if (project.ownerId === currentUser.uid) {
      alert("You cannot apply to your own project.");
      return;
    }

    const existingApplicationQuery = query(
      collection(db, "applications"),
      where("applicantId", "==", currentUser.uid),
      where("projectId", "==", projectId)
    );
    const existingApplicationSnap = await getDocs(existingApplicationQuery);

    if (!existingApplicationSnap.empty) {
      alert("You have already applied to this project.");
      return;
    }

    if (requiredTrades.length > 0 && !requiredTrades.includes(selectedTradeRole)) {
      alert("Please choose which trade role you are applying for.");
      return;
    }

    if (selectedTradeRole && filledTradeRoles.includes(selectedTradeRole)) {
      alert("That trade role has already been filled on this project.");
      return;
    }

    if (requiredTrades.length > 0 && openTradeRoles.length === 0) {
      alert("All required trade roles are currently covered on this project.");
      return;
    }

    const applicationRef = await addDoc(collection(db, "applications"), {
      projectId,
      projectTitle: project.title || "",
      projectOwnerId: project.ownerId || "",
      projectOwnerEmail: project.ownerEmail || "",
      projectOwnerName: project.ownerName || "",
      projectLocation: project.location || "",
      projectType: project.projectType || "",
      applicantId: currentUser.uid,
      applicantEmail: currentUser.email,
      applicantName: getCurrentUserDisplayName(),
      applicantService: currentUserData?.service || currentUserData?.businessCategory || currentUserData?.category || "",
      applicantProfileId: currentUser.uid,
      selectedTradeRole,
      status: "pending",
      message: "",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    await updateDoc(projectRef, {
      applicantCount: increment(1),
      pendingApplicantCount: increment(1),
      updatedAt: serverTimestamp()
    });

    myApplicationMap.set(projectId, {
      id: applicationRef.id,
      projectId,
      projectTitle: project.title || "",
      projectLocation: project.location || "",
      projectType: project.projectType || "",
      selectedTradeRole,
      status: "pending"
    });

    await refreshProjectsDashboard();
    alert("Application sent.");
  } catch (error) {
    console.error(error);
    alert("Could not apply to this project. Please try again.");
  }
}

async function withdrawApplication(applicationId, projectId) {
  if (!currentUser || !canAccessProjectJobs() || !applicationId || !projectId) return;

  if (!window.confirm("Withdraw this application?")) return;

  try {
    const applicationRef = doc(db, "applications", applicationId);
    const applicationSnap = await getDoc(applicationRef);

    if (!applicationSnap.exists()) {
      alert("This application could not be found.");
      return;
    }

    const application = applicationSnap.data();

    if (application.status === "accepted") {
      alert("Accepted applications cannot be withdrawn here yet.");
      return;
    }

    await deleteDoc(applicationRef);

    const projectUpdates = {
      applicantCount: increment(-1),
      updatedAt: serverTimestamp()
    };

    if (application.status === "pending") projectUpdates.pendingApplicantCount = increment(-1);
    if (application.status === "rejected") projectUpdates.rejectedApplicantCount = increment(-1);

    await updateDoc(doc(db, "projects", projectId), projectUpdates);

    myApplicationMap.delete(projectId);

    await refreshProjectsDashboard();
    alert("Application withdrawn.");
  } catch (error) {
    console.error(error);
    alert("Could not withdraw application. Please try again.");
  }
}

async function acceptApplication(applicationId) {
  if (!currentUser || !applicationId) return;

  if (!window.confirm("Accept this applicant and add them to the project team?")) return;

  try {
    const applicationRef = doc(db, "applications", applicationId);
    const applicationSnap = await getDoc(applicationRef);

    if (!applicationSnap.exists()) {
      alert("Application not found.");
      return;
    }

    const application = applicationSnap.data();

    if (application.projectOwnerId !== currentUser.uid) {
      alert("You can only manage applicants on your own projects.");
      return;
    }

    if (application.status === "accepted") {
      alert("This applicant is already accepted.");
      return;
    }

    const projectRef = doc(db, "projects", application.projectId);
    const projectSnap = await getDoc(projectRef);

    if (!projectSnap.exists()) {
      alert("Project not found.");
      return;
    }

    const project = projectSnap.data();
    const selectedTradeRole = application.selectedTradeRole || "";
    const requiredTrades = Array.isArray(project.requiredTrades) ? project.requiredTrades : [];
    const filledTradeRoles = Array.isArray(project.filledTradeRoles) ? project.filledTradeRoles : [];

    if (requiredTrades.length > 0 && !selectedTradeRole) {
      alert("This application is missing a selected trade role and cannot be accepted.");
      return;
    }

    if (selectedTradeRole && requiredTrades.length > 0 && !requiredTrades.includes(selectedTradeRole)) {
      alert("This applicant selected a trade role that is no longer required on this project.");
      return;
    }

    if (selectedTradeRole && filledTradeRoles.includes(selectedTradeRole)) {
      alert(`${selectedTradeRole} is already covered on this project.`);
      return;
    }

    await updateDoc(applicationRef, {
      status: "accepted",
      updatedAt: serverTimestamp()
    });

    await addDoc(collection(db, "projectTeams"), {
      projectId: application.projectId,
      projectTitle: application.projectTitle || project.title || "",
      projectOwnerId: currentUser.uid,
      projectOwnerEmail: currentUser.email,
      projectOwnerName: getCurrentUserDisplayName(),
      memberId: application.applicantId,
      memberEmail: application.applicantEmail || "",
      memberName: application.applicantName || "",
      memberService: application.applicantService || "",
      selectedTradeRole,
      role: "trade",
      status: "active",
      sourceApplicationId: applicationId,
      trustedTradeEligible: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    const projectUpdates = {
      acceptedApplicantCount: increment(1),
      teamCount: increment(1),
      updatedAt: serverTimestamp()
    };

    if (selectedTradeRole) {
      projectUpdates.filledTradeRoles = arrayUnion(selectedTradeRole);
    }

    if (application.status === "pending") projectUpdates.pendingApplicantCount = increment(-1);
    if (application.status === "rejected") projectUpdates.rejectedApplicantCount = increment(-1);

    await updateDoc(projectRef, projectUpdates);

    await refreshProjectsDashboard();
    alert("Applicant accepted and added to the project team.");
  } catch (error) {
    console.error(error);
    alert("Could not accept applicant. Please try again.");
  }
}

async function rejectApplication(applicationId) {
  if (!currentUser || !applicationId) return;

  if (!window.confirm("Reject this application?")) return;

  try {
    const applicationRef = doc(db, "applications", applicationId);
    const applicationSnap = await getDoc(applicationRef);

    if (!applicationSnap.exists()) {
      alert("Application not found.");
      return;
    }

    const application = applicationSnap.data();

    if (application.projectOwnerId !== currentUser.uid) {
      alert("You can only manage applicants on your own projects.");
      return;
    }

    if (application.status === "rejected") {
      alert("This application is already rejected.");
      return;
    }

    if (application.status === "accepted") {
      alert("Accepted team members cannot be rejected here yet.");
      return;
    }

    await updateDoc(applicationRef, {
      status: "rejected",
      updatedAt: serverTimestamp()
    });

    const projectUpdates = {
      rejectedApplicantCount: increment(1),
      updatedAt: serverTimestamp()
    };

    if (application.status === "pending") projectUpdates.pendingApplicantCount = increment(-1);

    await updateDoc(doc(db, "projects", application.projectId), projectUpdates);

    await refreshProjectsDashboard();
    alert("Application rejected.");
  } catch (error) {
    console.error(error);
    alert("Could not reject application. Please try again.");
  }
}

async function buildWorkspaceProjectOptions() {
  if (!workspaceProjectSelect || !currentUser) return;

  workspaceProjectsMap = new Map();
  workspaceProjectSelect.innerHTML = `<option value="">Select a project</option>`;

  try {
    const ownedProjectsQuery = canAccessAnyWorkspace(currentUserData)
      ? query(
          collection(db, "projects"),
          orderBy("createdAt", "desc")
        )
      : query(
          collection(db, "projects"),
          where("ownerId", "==", currentUser.uid),
          orderBy("createdAt", "desc")
        );

    const ownedSnapshot = await getDocs(ownedProjectsQuery);

    ownedSnapshot.forEach((docSnap) => {
      const project = {
        id: docSnap.id,
        accessRole: canAccessAnyWorkspace(currentUserData) ? "super_admin" : "owner",
        ...docSnap.data()
      };

      workspaceProjectsMap.set(project.id, project);
    });

    for (const teamMember of myTeamProjectMap.values()) {
      const projectSnap = await getDoc(doc(db, "projects", teamMember.projectId));

      if (projectSnap.exists()) {
        const project = {
          id: projectSnap.id,
          accessRole: "team",
          ...projectSnap.data()
        };

        workspaceProjectsMap.set(project.id, project);
      }
    }

    workspaceProjectsMap.forEach((project) => {
      const accessLabel = project.accessRole === "super_admin"
        ? "Super Admin"
        : project.accessRole === "owner"
        ? "Owner"
        : "Team";

      workspaceProjectSelect.innerHTML += `
        <option value="${project.id}">
          ${escapeHtml(project.title || "Untitled Project")} - ${accessLabel}
        </option>
      `;
    });

    if (workspaceProjectsMap.size === 0) {
      setWorkspaceMessage("No project workspaces available yet.");
    } else {
      setWorkspaceMessage("Select a project to open its workspace.");
    }
  } catch (error) {
    console.error(error);
    setWorkspaceMessage("Could not load workspace projects.");
  }
}

async function loadSelectedWorkspace() {
  if (!selectedWorkspaceProject) return;

  if (!canUseSelectedWorkspace()) {
    workspaceShell?.classList.add("hidden");
    workspaceLockedBox?.classList.remove("hidden");
    setWorkspaceMessage("This workspace is locked until the £40 one-off unlock is completed.");
    return;
  }

  workspaceLockedBox?.classList.add("hidden");
  workspaceShell?.classList.remove("hidden");

  if (workspaceProgressSelect) {
    workspaceProgressSelect.value = selectedWorkspaceProject.progressStage || "planning";
  }

  updateWorkspaceProgressLabel(selectedWorkspaceProject.progressStage || "planning");
  setWorkspaceMessage(`Workspace opened: ${selectedWorkspaceProject.title || "Project"}`);

  await loadWorkspaceTasks();
  await loadWorkspaceNotes();
}

async function createWorkspaceTask() {
  if (!canUseSelectedWorkspace()) {
    setTaskMessage("Select an unlocked workspace first.");
    return;
  }

  const title = workspaceTaskTitle?.value.trim() || "";
  const assignedTo = workspaceTaskAssignedTo?.value.trim() || "";
  const dueDate = workspaceTaskDueDate?.value || "";

  if (!title) {
    setTaskMessage("Enter a task title.");
    return;
  }

  try {
    setTaskMessage("Adding task...");

    await addDoc(collection(db, "workspaceTasks"), {
      projectId: selectedWorkspaceProject.id,
      projectTitle: selectedWorkspaceProject.title || "",
      title,
      assignedTo,
      dueDate,
      status: "open",
      createdBy: currentUser.uid,
      createdByName: getCurrentUserDisplayName(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    workspaceTaskForm.reset();
    setTaskMessage("Task added.");

    await loadWorkspaceTasks();
  } catch (error) {
    console.error(error);
    setTaskMessage("Could not add task.");
  }
}

async function loadWorkspaceTasks() {
  if (!workspaceTasksList || !selectedWorkspaceProject) return;

  workspaceTasksList.innerHTML = `<div class="empty-state">Loading tasks...</div>`;

  try {
    const tasksQuery = query(
      collection(db, "workspaceTasks"),
      where("projectId", "==", selectedWorkspaceProject.id),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(tasksQuery);

    if (snapshot.empty) {
      workspaceTasksList.innerHTML = `<div class="empty-state">No tasks yet.</div>`;
      updateWorkspaceTaskCounts([]);
      return;
    }

    const tasks = [];

    snapshot.forEach((docSnap) => {
      tasks.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    updateWorkspaceTaskCounts(tasks);

    workspaceTasksList.innerHTML = tasks.map(renderWorkspaceTask).join("");
  } catch (error) {
    console.error(error);
    workspaceTasksList.innerHTML = `<div class="empty-state">Could not load tasks. Firestore may ask you to create an index.</div>`;
  }
}

function renderWorkspaceTask(task) {
  const isCompleted = task.status === "completed";

  return `
    <div class="workspace-item ${isCompleted ? "workspace-item-complete" : ""}">
      <div>
        <strong>${escapeHtml(task.title || "Task")}</strong>
        <span>Assigned: ${escapeHtml(task.assignedTo || "Unassigned")}</span>
        <span>Due: ${escapeHtml(task.dueDate || "No due date")}</span>
        <span>Status: ${escapeHtml(task.status || "open")}</span>
      </div>

      <div class="workspace-item-actions">
        ${
          isCompleted
            ? `
              <button type="button" class="btn-small" data-reopen-task-id="${task.id}">
                Reopen
              </button>
            `
            : `
              <button type="button" class="btn-small project-accept-btn" data-complete-task-id="${task.id}">
                Complete
              </button>
            `
        }

        <button type="button" class="btn-small project-withdraw-btn" data-delete-task-id="${task.id}">
          Delete
        </button>
      </div>
    </div>
  `;
}

async function updateTaskStatus(taskId, status) {
  if (!taskId) return;

  try {
    await updateDoc(doc(db, "workspaceTasks", taskId), {
      status,
      updatedAt: serverTimestamp()
    });

    await loadWorkspaceTasks();
  } catch (error) {
    console.error(error);
    alert("Could not update task.");
  }
}

async function deleteWorkspaceTask(taskId) {
  if (!taskId) return;
  if (!window.confirm("Delete this task?")) return;

  try {
    await deleteDoc(doc(db, "workspaceTasks", taskId));
    await loadWorkspaceTasks();
  } catch (error) {
    console.error(error);
    alert("Could not delete task.");
  }
}

function updateWorkspaceTaskCounts(tasks) {
  const openTasks = tasks.filter((task) => task.status !== "completed");

  if (workspaceTaskCount) workspaceTaskCount.textContent = String(tasks.length);
  if (workspaceOpenTaskCount) workspaceOpenTaskCount.textContent = String(openTasks.length);
}

async function createWorkspaceNote() {
  if (!canUseSelectedWorkspace()) {
    setNoteMessage("Select an unlocked workspace first.");
    return;
  }

  const note = workspaceNoteText?.value.trim() || "";

  if (!note) {
    setNoteMessage("Enter a note.");
    return;
  }

  try {
    setNoteMessage("Adding note...");

    await addDoc(collection(db, "workspaceNotes"), {
      projectId: selectedWorkspaceProject.id,
      projectTitle: selectedWorkspaceProject.title || "",
      note,
      createdBy: currentUser.uid,
      createdByName: getCurrentUserDisplayName(),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });

    workspaceNoteForm.reset();
    setNoteMessage("Note added.");

    await loadWorkspaceNotes();
  } catch (error) {
    console.error(error);
    setNoteMessage("Could not add note.");
  }
}

async function loadWorkspaceNotes() {
  if (!workspaceNotesList || !selectedWorkspaceProject) return;

  workspaceNotesList.innerHTML = `<div class="empty-state">Loading notes...</div>`;

  try {
    const notesQuery = query(
      collection(db, "workspaceNotes"),
      where("projectId", "==", selectedWorkspaceProject.id),
      orderBy("createdAt", "desc")
    );

    const snapshot = await getDocs(notesQuery);

    if (snapshot.empty) {
      workspaceNotesList.innerHTML = `<div class="empty-state">No notes yet.</div>`;
      if (workspaceNoteCount) workspaceNoteCount.textContent = "0";
      return;
    }

    const notes = [];

    snapshot.forEach((docSnap) => {
      notes.push({
        id: docSnap.id,
        ...docSnap.data()
      });
    });

    if (workspaceNoteCount) workspaceNoteCount.textContent = String(notes.length);

    workspaceNotesList.innerHTML = notes.map(renderWorkspaceNote).join("");
  } catch (error) {
    console.error(error);
    workspaceNotesList.innerHTML = `<div class="empty-state">Could not load notes. Firestore may ask you to create an index.</div>`;
  }
}

function renderWorkspaceNote(note) {
  return `
    <div class="workspace-item">
      <div>
        <strong>${escapeHtml(note.createdByName || "Project Member")}</strong>
        <p>${escapeHtml(note.note || "")}</p>
        <span>${formatProjectDate(note.createdAt)}</span>
      </div>
    </div>
  `;
}

async function saveWorkspaceProgress() {
  if (!selectedWorkspaceProject) {
    setProgressMessage("Select a workspace first.");
    return;
  }

  if (selectedWorkspaceProject.ownerId !== currentUser.uid) {
    setProgressMessage("Only the project owner can update progress.");
    return;
  }

  const progressStage = workspaceProgressSelect?.value || "planning";

  try {
    setProgressMessage("Saving progress...");

    await updateDoc(doc(db, "projects", selectedWorkspaceProject.id), {
      progressStage,
      updatedAt: serverTimestamp()
    });

    selectedWorkspaceProject.progressStage = progressStage;
    workspaceProjectsMap.set(selectedWorkspaceProject.id, selectedWorkspaceProject);

    updateWorkspaceProgressLabel(progressStage);
    setProgressMessage("Progress saved.");
    await refreshProjectsDashboard();
  } catch (error) {
    console.error(error);
    setProgressMessage("Could not save progress.");
  }
}

function updateWorkspaceProgressLabel(stage) {
  const label = getProgressLabel(stage);

  if (workspaceProgressLabel) {
    workspaceProgressLabel.textContent = label;
  }
}

function getProgressLabel(stage) {
  const labels = {
    planning: "Planning",
    team_selected: "Team Selected",
    in_progress: "In Progress",
    snagging: "Snagging",
    completed: "Completed"
  };

  return labels[stage] || "Planning";
}

function hideWorkspacePanels() {
  workspaceLockedBox?.classList.add("hidden");
  workspaceShell?.classList.add("hidden");
}

function canUseSelectedWorkspace() {
  return Boolean(
    selectedWorkspaceProject &&
    (selectedWorkspaceProject.workspaceUnlocked || canAccessAnyWorkspace(currentUserData))
  );
}

function setWorkspaceMessage(message) {
  if (workspaceMessage) workspaceMessage.textContent = message;
}

function setTaskMessage(message) {
  if (workspaceTaskMessage) workspaceTaskMessage.textContent = message;
}

function setNoteMessage(message) {
  if (workspaceNoteMessage) workspaceNoteMessage.textContent = message;
}

function setProgressMessage(message) {
  if (workspaceProgressMessage) workspaceProgressMessage.textContent = message;
}

function renderSignedOutProjectAreas() {
  if (myProjectsList) myProjectsList.innerHTML = `<div class="empty-state">Login to see your projects.</div>`;
  if (openProjectsList) openProjectsList.innerHTML = `<div class="empty-state">Login to browse open projects.</div>`;
  if (myApplicationsList) myApplicationsList.innerHTML = `<div class="empty-state">Login as a member to see your applications.</div>`;
  if (myTeamsList) myTeamsList.innerHTML = `<div class="empty-state">Login as a member to see your project teams.</div>`;
  projectRoleChoiceSection?.classList.add("hidden");
  projectRoleSummarySection?.classList.add("hidden");
  setDashboardSectionsVisible([]);
  hideWorkspacePanels();
  renderTradesJobAccessBox();
}

async function startTradesJobAccessCheckout() {
  if (!currentUser) {
    window.location.href = "login.html";
    return;
  }

  if (openProjectJobCount === 0) {
    setTradesJobAccessMessage("No open jobs are currently available. Please check back soon.");
    return;
  }

  try {
    setTradesJobAccessMessage("Creating Job Access checkout...");
    tradesJobAccessCheckoutBtn.disabled = true;
    const idToken = await currentUser.getIdToken();

    const response = await fetch(TRADES_JOB_ACCESS_CHECKOUT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        uid: currentUser.uid,
        email: currentUser.email
      })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || "Could not create Job Access checkout.");
    }

    if (!data.url) {
      throw new Error("No checkout URL returned.");
    }

    window.location.href = data.url;
  } catch (error) {
    console.error(error);
    setTradesJobAccessMessage(error.message || "Checkout failed.");
    tradesJobAccessCheckoutBtn.disabled = false;
  }
}

async function startWorkspaceUnlockCheckout(projectId, button) {
  if (!currentUser || !projectId) return;

  try {
    if (homeownerProjectCount === 0 && !isSuperAdmin(currentUserData)) {
      alert("Please post a project before unlocking a Project Workspace.");
      return;
    }

    const projectSnap = await getDoc(doc(db, "projects", projectId));

    if (!projectSnap.exists()) {
      alert("Project not found.");
      return;
    }

    const project = projectSnap.data();

    if (project.ownerId !== currentUser.uid && !isSuperAdmin(currentUserData)) {
      alert("Only the homeowner/project owner can unlock a Project Workspace.");
      return;
    }

    if (project.workspaceUnlocked) {
      alert("This workspace is already unlocked.");
      return;
    }

    if (button) {
      button.disabled = true;
      button.textContent = isSuperAdmin(currentUserData)
        ? "Unlocking..."
        : "Opening checkout...";
    }

    const idToken = await currentUser.getIdToken();

    const response = await fetch(
      isSuperAdmin(currentUserData)
        ? SUPER_ADMIN_UNLOCK_WORKSPACE_URL
        : PROJECT_WORKSPACE_UNLOCK_CHECKOUT_URL,
      {
      method: "POST",
      headers: {
        "Content-Type": "text/plain",
        "Authorization": `Bearer ${idToken}`
      },
      body: JSON.stringify({
        uid: currentUser.uid,
        email: currentUser.email,
        projectId
      })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || "Could not create workspace checkout.");
    }

    if (data.unlocked) {
      await refreshProjectsDashboard();
      alert("Workspace unlocked.");
      return;
    }

    if (!data.url) {
      throw new Error("No checkout URL returned.");
    }

    window.location.href = data.url;
  } catch (error) {
    console.error(error);
    alert(error.message || "Workspace checkout failed.");

    if (button) {
      button.disabled = false;
      button.textContent = "Unlock Workspace for \u00a340";
    }
  }
}

function canAccessProjectJobs() {
  return currentUserIsMember || hasActiveTradesJobAccess(currentUserData);
}

function hasActiveTradesJobAccess(userData) {
  const expiryDate = getDateFromTimestamp(userData?.tradesJobAccessExpiresAt);

  return Boolean(
    userData?.tradesJobAccess === true &&
    userData?.tradesJobAccessStatus === "active" &&
    expiryDate &&
    expiryDate > new Date()
  );
}

function renderTradesJobAccessBox() {
  if (openJobsCountText) {
    openJobsCountText.textContent = openProjectJobCount === 0
      ? "There are currently no open projects available. Please check back soon."
      : `There are currently ${openProjectJobCount} open project jobs available.`;
  }

  if (!tradesJobAccessStatusText || !tradesJobAccessCheckoutBtn) return;

  if (!currentUser) {
    tradesJobAccessStatusText.textContent = "Login to buy job access or use active membership.";
    tradesJobAccessCheckoutBtn.classList.add("hidden");
    return;
  }

  if (currentUserIsMember) {
    tradesJobAccessStatusText.textContent = "Your active Sangat Works membership includes project job access.";
    tradesJobAccessCheckoutBtn.classList.add("hidden");
    return;
  }

  if (currentProjectUserType === "homeowner") {
    tradesJobAccessStatusText.textContent = "Homeowners can browse open projects here. Choose Tradesperson if you want to apply.";
    tradesJobAccessCheckoutBtn.classList.add("hidden");
    return;
  }

  if (hasActiveTradesJobAccess(currentUserData)) {
    tradesJobAccessStatusText.textContent = `Your 30-day Job Access Pass is active until ${formatDate(currentUserData.tradesJobAccessExpiresAt)}.`;
    tradesJobAccessCheckoutBtn.classList.add("hidden");
    return;
  }

  if (openProjectJobCount === 0) {
    tradesJobAccessStatusText.textContent = "There are currently no open projects available. Please check back soon.";
    tradesJobAccessCheckoutBtn.disabled = true;
    tradesJobAccessCheckoutBtn.classList.add("hidden");
    return;
  }

  tradesJobAccessStatusText.textContent = "Buy a one-time 30-day pass to view and apply to open project jobs.";
  tradesJobAccessCheckoutBtn.disabled = false;
  tradesJobAccessCheckoutBtn.classList.remove("hidden");
}

function updateProjectsAccountSummary() {
  const tradesAccessActive = hasActiveTradesJobAccess(currentUserData);
  const modeLabel = currentProjectUserType === "homeowner"
    ? "Homeowner"
    : currentProjectUserType === "tradesperson"
    ? "Tradesperson"
    : "Not selected";

  if (summaryProjectsMode) summaryProjectsMode.textContent = modeLabel;
  if (summaryHomeownerProjects) summaryHomeownerProjects.textContent = String(homeownerProjectCount);
  if (summaryOpenJobs) summaryOpenJobs.textContent = String(openProjectJobCount);
  if (summaryTradesAccess) summaryTradesAccess.textContent = tradesAccessActive ? "Active" : "Inactive";
  if (summaryTradesAccessExpiry) {
    summaryTradesAccessExpiry.textContent = tradesAccessActive
      ? formatDate(currentUserData?.tradesJobAccessExpiresAt)
      : "Not active";
  }
  if (summaryUnlockedWorkspaces) summaryUnlockedWorkspaces.textContent = String(unlockedWorkspaceCount);
  if (summaryLockedWorkspaces) summaryLockedWorkspaces.textContent = String(lockedWorkspaceCount);
  if (summaryPaymentStatus) summaryPaymentStatus.textContent = getProjectsPaymentStatusLabel(tradesAccessActive);
}

function updateWorkspaceProtectionUI() {
  if (workspaceHomeownerProjectCount) {
    workspaceHomeownerProjectCount.textContent = String(homeownerProjectCount);
  }

  if (workspaceProtectionMessage) {
    workspaceProtectionMessage.textContent = homeownerProjectCount === 0
      ? "Post a project first before unlocking paid workspace software."
      : "Choose one of your projects below to unlock its homeowner workspace.";
  }

  if (workspaceChooseProjectBtn) {
    const disabled = homeownerProjectCount === 0;
    workspaceChooseProjectBtn.classList.toggle("disabled-link", disabled);
    workspaceChooseProjectBtn.setAttribute("aria-disabled", disabled ? "true" : "false");
    workspaceChooseProjectBtn.tabIndex = disabled ? -1 : 0;
  }
}

function resetProjectSummaryCounts() {
  openProjectJobCount = 0;
  homeownerProjectCount = 0;
  unlockedWorkspaceCount = 0;
  lockedWorkspaceCount = 0;
  updateProjectsAccountSummary();
  updateWorkspaceProtectionUI();
}

function getProjectsPaymentStatusLabel(tradesAccessActive) {
  if (currentUserIsMember) {
    return `${getMembershipLabel(currentUserData)} active`;
  }

  if (tradesAccessActive) {
    return "30-day Trades Job Access active";
  }

  if (currentProjectUserType === "homeowner") {
    return homeownerProjectCount > 0
      ? "Homeowner workspace unlock available per project"
      : "Free homeowner account - post a project first";
  }

  if (currentProjectUserType === "tradesperson") {
    return openProjectJobCount > 0
      ? "Trades Job Access available"
      : "No open jobs - payment hidden";
  }

  return "Choose a Projects mode";
}

function setTradesJobAccessMessage(message) {
  if (tradesJobAccessMessage) tradesJobAccessMessage.textContent = message;
}

function renderProjectCard(project, mode) {
  const requiredTrades = Array.isArray(project.requiredTrades) ? project.requiredTrades : [];
  const filledTradeRoles = Array.isArray(project.filledTradeRoles) ? project.filledTradeRoles : [];
  const openTradeRoles = requiredTrades.filter((trade) => !filledTradeRoles.includes(trade));

  const tradeTags = requiredTrades.length
    ? requiredTrades.map((trade) => {
        const isFilled = filledTradeRoles.includes(trade);
        return `
          <span class="tag project-trade-tag ${isFilled ? "trade-filled" : "trade-open"}">
            ${escapeHtml(trade)} · ${isFilled ? "Filled" : "Open"}
          </span>
        `;
      }).join("")
    : `<span class="tag">No trades selected</span>`;

  const existingApplication = myApplicationMap.get(project.id);
  const existingTeam = myTeamProjectMap.get(project.id);

  const ownerActions = `
    <div class="project-card-actions">
      <span class="project-status-pill">${escapeHtml(project.status || "open")}</span>
      <span class="project-mini-stat">${project.applicantCount || 0} applicants</span>
      <span class="project-mini-stat">${project.teamCount || 0} team members</span>
      <span class="project-mini-stat">Workspace ${project.workspaceUnlocked ? "Unlocked" : "Locked"}</span>
    </div>

    ${renderOwnerApplicantReview(project)}
    ${renderOwnerTeamMembers(project)}
    ${renderWorkspaceLockCard(project)}
  `;

  let tradeActions = "";

  if (mode === "browse") {
    tradeActions = `<div class="project-card-actions"><span class="project-mini-stat">Homeowner browsing view</span></div>`;
  } else if (project.ownerId === currentUser?.uid) {
    tradeActions = `<div class="project-card-actions"><span class="project-mini-stat">Your project</span></div>`;
  } else if (existingTeam) {
    tradeActions = `
      <div class="project-card-actions">
        <span class="project-status-pill">You are on this team</span>
        <span class="project-mini-stat">${escapeHtml(existingTeam.selectedTradeRole || "Trade role")}</span>
      </div>
    `;
  } else if (existingApplication) {
    tradeActions = `
      <div class="project-card-actions">
        <span class="project-status-pill">Applied: ${escapeHtml(existingApplication.status || "pending")}</span>
        <span class="project-mini-stat">${escapeHtml(existingApplication.selectedTradeRole || "Trade role not set")}</span>
        ${
          existingApplication.status === "pending" || existingApplication.status === "rejected"
            ? `
              <button class="btn-small project-withdraw-btn" type="button"
                data-withdraw-application-id="${existingApplication.id}"
                data-project-id="${project.id}">
                Withdraw
              </button>
            `
            : ""
        }
      </div>
    `;
  } else {
    tradeActions = `
      <div class="project-card-actions">
        ${renderApplyRoleButtons(project.id, requiredTrades, openTradeRoles)}
        <span class="project-mini-stat">${project.applicantCount || 0} applicants</span>
      </div>
    `;
  }

  return `
    <article class="project-card">
      <div class="project-card-top">
        <span class="project-type-pill">${escapeHtml(project.projectType || "Project")}</span>
        <span class="project-date">${formatProjectDate(project.createdAt)}</span>
      </div>

      <h3>${escapeHtml(project.title || "Untitled Project")}</h3>
      <p class="project-location">📍 ${escapeHtml(project.location || "Location not provided")}</p>
      <p class="project-description">${escapeHtml(project.description || "No project description provided.")}</p>

      <div class="project-details-grid">
        <div><strong>Budget</strong><span>${escapeHtml(project.budget || "Budget not provided")}</span></div>
        <div><strong>Start</strong><span>${escapeHtml(project.estimatedStart || "Flexible")}</span></div>
        <div><strong>Stage</strong><span>${escapeHtml(getProgressLabel(project.progressStage || "planning"))}</span></div>
      </div>

      <div class="tags">${tradeTags}</div>

      ${mode === "owner" ? ownerActions : tradeActions}
    </article>
  `;
}

function renderApplyRoleButtons(projectId, requiredTrades, openTradeRoles) {
  if (!requiredTrades.length) {
    return `<span class="project-mini-stat">No trade roles listed</span>`;
  }

  if (!openTradeRoles.length) {
    return `<span class="project-mini-stat">All listed trade roles are filled</span>`;
  }

  return openTradeRoles.map((trade) => `
    <button class="btn-small project-apply-btn" type="button"
      data-apply-project-id="${projectId}"
      data-selected-trade-role="${escapeHtml(trade)}">
      Apply as ${escapeHtml(trade)}
    </button>
  `).join("");
}

function renderOwnerApplicantReview(project) {
  const applications = projectApplicationsMap.get(project.id) || [];

  if (!applications.length) {
    return `<div class="project-sub-panel"><h4>Applicants</h4><p>No applications yet.</p></div>`;
  }

  return `
    <div class="project-sub-panel">
      <h4>Applicants</h4>
      <div class="project-applicant-list">
        ${applications.map(renderApplicantRow).join("")}
      </div>
    </div>
  `;
}

function renderApplicantRow(application) {
  const status = application.status || "pending";

  return `
    <div class="project-applicant-row">
      <div>
        <strong>${escapeHtml(application.applicantName || "Applicant")}</strong>
        <span>${escapeHtml(application.applicantService || "Trade / Service not set")}</span>
        <span>Applied as: ${escapeHtml(application.selectedTradeRole || "Trade role not selected")}</span>
        <span>${escapeHtml(application.applicantEmail || "")}</span>
      </div>

      <div class="project-applicant-actions">
        <span class="project-status-pill ${getStatusClass(status)}">${escapeHtml(status)}</span>

        ${
          status === "pending"
            ? `
              <button type="button" class="btn-small project-accept-btn" data-accept-application-id="${application.id}">Accept</button>
              <button type="button" class="btn-small project-reject-btn" data-reject-application-id="${application.id}">Reject</button>
            `
            : ""
        }
      </div>
    </div>
  `;
}

function renderOwnerTeamMembers(project) {
  const teamMembers = projectTeamsMap.get(project.id) || [];

  if (!teamMembers.length) {
    return `<div class="project-sub-panel"><h4>Project Team</h4><p>No accepted team members yet.</p></div>`;
  }

  return `
    <div class="project-sub-panel">
      <h4>Project Team</h4>
      <div class="project-team-list">
        ${teamMembers.map(renderTeamMemberRow).join("")}
      </div>
    </div>
  `;
}

function renderTeamMemberRow(member) {
  return `
    <div class="project-team-row">
      <div>
        <strong>${escapeHtml(member.memberName || "Team Member")}</strong>
        <span>${escapeHtml(member.memberService || "Trade / Service")}</span>
        <span>Role covered: ${escapeHtml(member.selectedTradeRole || "Trade role not set")}</span>
      </div>
      <span class="project-status-pill">Active</span>
    </div>
  `;
}

function renderWorkspaceLockCard(project) {
  const workspaceUrl = `project-workspace.html?id=${encodeURIComponent(project.id)}`;

  if (project.workspaceUnlocked) {
    return `
      <div class="project-workspace-card workspace-unlocked">
        <strong>Workspace Unlocked</strong>
        <p>Open the Project Workspace section to manage tasks, notes and progress.</p>
        <a href="${workspaceUrl}" class="btn-small project-workspace-open-btn">Open Workspace</a>
      </div>
    `;
  }

  return `
    <div class="project-workspace-card">
      <strong>Workspace Locked</strong>
      <p>Once the team is ready, the homeowner can unlock the Project Workspace for £40.</p>
      <button type="button" class="btn-small project-workspace-placeholder" data-unlock-workspace-project-id="${project.id}">
        Unlock Workspace for \u00a340
      </button>
      <a href="${workspaceUrl}" class="btn-small project-workspace-open-btn">Open Workspace</a>
    </div>
  `;
}

function renderApplicationCard(application) {
  const status = application.status || "pending";

  return `
    <article class="project-card application-card">
      <div class="project-card-top">
        <span class="project-type-pill">${escapeHtml(application.projectType || "Project")}</span>
        <span class="project-status-pill ${getStatusClass(status)}">${escapeHtml(status)}</span>
      </div>

      <h3>${escapeHtml(application.projectTitle || "Untitled Project")}</h3>
      <p class="project-location">📍 ${escapeHtml(application.projectLocation || "Location not provided")}</p>
      <p class="project-description">Your application is currently marked as <strong>${escapeHtml(status)}</strong>.</p>
      <p class="project-description">Applied as: <strong>${escapeHtml(application.selectedTradeRole || "Trade role not selected")}</strong>.</p>

      <div class="project-card-actions">
        ${
          status === "pending" || status === "rejected"
            ? `
              <button class="btn-small project-withdraw-btn" type="button"
                data-withdraw-application-id="${application.id}"
                data-project-id="${application.projectId}">
                Withdraw
              </button>
            `
            : `<span class="project-mini-stat">Accepted applicants are now project team members.</span>`
        }
      </div>
    </article>
  `;
}

function renderTeamMembershipCard(teamMember) {
  return `
    <article class="project-card team-card">
      <div class="project-card-top">
        <span class="project-type-pill">Project Team</span>
        <span class="project-status-pill">Active</span>
      </div>

      <h3>${escapeHtml(teamMember.projectTitle || "Project")}</h3>
      <p class="project-description">You have been accepted onto this project team.</p>

      <div class="project-details-grid">
        <div><strong>Role</strong><span>${escapeHtml(teamMember.selectedTradeRole || teamMember.role || "Trade")}</span></div>
        <div><strong>Status</strong><span>${escapeHtml(teamMember.status || "Active")}</span></div>
        <div><strong>Buddy Ready</strong><span>${teamMember.trustedTradeEligible ? "Yes" : "No"}</span></div>
      </div>

      <div class="project-card-actions">
        <a href="project-workspace.html?id=${encodeURIComponent(teamMember.projectId)}" class="btn-small project-workspace-open-btn">
          Open Workspace
        </a>
      </div>
    </article>
  `;
}

function getSelectedTrades() {
  const checkedBoxes = document.querySelectorAll(".trade-chip-grid input[type='checkbox']:checked");
  return Array.from(checkedBoxes).map((box) => box.value);
}

function getInputValue(id) {
  const input = document.getElementById(id);
  return input ? input.value.trim() : "";
}

function setFormMessage(message) {
  if (projectFormMessage) projectFormMessage.textContent = message;
}

function getCurrentUserDisplayName() {
  return (
    currentUserData?.displayName ||
    currentUserData?.fullName ||
    currentUserData?.name ||
    currentUserData?.businessName ||
    currentUser?.email ||
    "Sangat Works Member"
  );
}

function formatProjectDate(timestamp) {
  if (!timestamp || !timestamp.toDate) return "Just now";

  try {
    return timestamp.toDate().toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  } catch (error) {
    return "Recently";
  }
}

function formatDate(timestamp) {
  const date = getDateFromTimestamp(timestamp);

  if (!date) return "-";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}

function getDateFromTimestamp(timestamp) {
  if (!timestamp) return null;

  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch (error) {
    return null;
  }
}

function getStatusClass(status) {
  if (status === "accepted") return "status-accepted";
  if (status === "rejected") return "status-rejected";
  return "status-pending";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
