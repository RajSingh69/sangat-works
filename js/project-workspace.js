import { auth, db } from "./firebase.js";

import {
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

import {
  canAccessAnyWorkspace,
  isSuperAdmin
} from "./roles.js";

const projectId = new URLSearchParams(window.location.search).get("id");
const PROJECT_WORKSPACE_UNLOCK_CHECKOUT_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/createProjectWorkspaceUnlockSession";
const SUPER_ADMIN_UNLOCK_WORKSPACE_URL =
  "https://europe-west1-sangat-works.cloudfunctions.net/unlockProjectWorkspaceAsSuperAdmin";

const els = {
  title: document.getElementById("workspaceProjectTitle"),
  summary: document.getElementById("workspaceProjectSummary"),
  accessBox: document.getElementById("workspaceAccessBox"),
  accessTitle: document.getElementById("workspaceAccessTitle"),
  accessMessage: document.getElementById("workspaceAccessMessage"),
  lockedBox: document.getElementById("workspaceLockedBox"),
  lockedMessage: document.getElementById("workspaceLockedMessage"),
  checkoutButton: document.getElementById("workspaceCheckoutPlaceholderBtn"),
  checkoutMessage: document.getElementById("workspaceCheckoutMessage"),
  shell: document.getElementById("workspaceShell"),
  roleMessage: document.getElementById("workspaceRoleMessage"),

  dashboardStatusLabel: document.getElementById("dashboardStatusLabel"),
  dashboardBudgetLabel: document.getElementById("dashboardBudgetLabel"),
  dashboardTeamCount: document.getElementById("dashboardTeamCount"),
  dashboardQuoteCount: document.getElementById("dashboardQuoteCount"),
  dashboardQuoteTotal: document.getElementById("dashboardQuoteTotal"),
  dashboardSpendTotal: document.getElementById("dashboardSpendTotal"),
  dashboardLatestActivity: document.getElementById("dashboardLatestActivity"),
  projectSummaryDetails: document.getElementById("projectSummaryDetails"),

  taskForm: document.getElementById("workspaceTaskForm"),
  taskTitle: document.getElementById("workspaceTaskTitle"),
  taskAssignedTo: document.getElementById("workspaceTaskAssignedTo"),
  taskDueDate: document.getElementById("workspaceTaskDueDate"),
  taskMessage: document.getElementById("workspaceTaskMessage"),
  taskCount: document.getElementById("workspaceTaskCount"),
  taskTodo: document.getElementById("taskColumnTodo"),
  taskInProgress: document.getElementById("taskColumnInProgress"),
  taskDone: document.getElementById("taskColumnDone"),
  taskBoard: document.getElementById("workspaceTaskBoard"),

  progressLabel: document.getElementById("workspaceProgressLabel"),
  progressSelect: document.getElementById("workspaceProgressSelect"),
  progressButton: document.getElementById("saveWorkspaceProgressBtn"),
  progressMessage: document.getElementById("workspaceProgressMessage"),

  milestoneForm: document.getElementById("workspaceMilestoneForm"),
  milestoneTitle: document.getElementById("workspaceMilestoneTitle"),
  milestoneDate: document.getElementById("workspaceMilestoneDate"),
  milestoneStatus: document.getElementById("workspaceMilestoneStatus"),
  milestoneMessage: document.getElementById("workspaceMilestoneMessage"),
  milestonesList: document.getElementById("workspaceMilestonesList"),
  timelineList: document.getElementById("workspaceTimelineList"),

  teamList: document.getElementById("workspaceTeamList"),

  documentForm: document.getElementById("workspaceDocumentForm"),
  documentTitle: document.getElementById("workspaceDocumentTitle"),
  documentType: document.getElementById("workspaceDocumentType"),
  documentUrl: document.getElementById("workspaceDocumentUrl"),
  documentMessage: document.getElementById("workspaceDocumentMessage"),
  documentsList: document.getElementById("workspaceDocumentsList"),

  photoForm: document.getElementById("workspacePhotoForm"),
  photoTitle: document.getElementById("workspacePhotoTitle"),
  photoUrl: document.getElementById("workspacePhotoUrl"),
  photoCaption: document.getElementById("workspacePhotoCaption"),
  photoMessage: document.getElementById("workspacePhotoMessage"),
  photosList: document.getElementById("workspacePhotosList"),

  quoteForm: document.getElementById("workspaceQuoteForm"),
  quoteSupplier: document.getElementById("workspaceQuoteSupplier"),
  quoteAmount: document.getElementById("workspaceQuoteAmount"),
  quoteStatus: document.getElementById("workspaceQuoteStatus"),
  quoteNotes: document.getElementById("workspaceQuoteNotes"),
  quoteMessage: document.getElementById("workspaceQuoteMessage"),
  quotesList: document.getElementById("workspaceQuotesList"),

  messageForm: document.getElementById("workspaceMessageForm"),
  messageText: document.getElementById("workspaceMessageText"),
  messageFormMessage: document.getElementById("workspaceMessageFormMessage"),
  messagesList: document.getElementById("workspaceMessagesList"),

  budgetSummary: document.getElementById("workspaceBudgetSummary"),
  budgetForm: document.getElementById("workspaceBudgetForm"),
  budgetTitle: document.getElementById("workspaceBudgetTitle"),
  budgetAmount: document.getElementById("workspaceBudgetAmount"),
  budgetDate: document.getElementById("workspaceBudgetDate"),
  budgetMessage: document.getElementById("workspaceBudgetMessage"),
  budgetItemsList: document.getElementById("workspaceBudgetItemsList"),

  noteForm: document.getElementById("workspaceNoteForm"),
  noteText: document.getElementById("workspaceNoteText"),
  noteMessage: document.getElementById("workspaceNoteMessage"),
  notesList: document.getElementById("workspaceNotesList"),

  activityList: document.getElementById("workspaceActivityList")
};

let currentUser = null;
let currentUserData = null;
let selectedProject = null;
let accessRole = "";

const workspaceState = {
  team: [],
  tasks: [],
  milestones: [],
  documents: [],
  photos: [],
  quotes: [],
  messages: [],
  budgetItems: [],
  notes: [],
  activity: []
};

onAuthStateChanged(auth, async (user) => {
  currentUser = user;

  if (!projectId) {
    showBlockedState("Workspace not found", "This workspace link is missing a project ID.");
    return;
  }

  if (!user) {
    showBlockedState("Login required", "Please login to open this project workspace.");
    return;
  }

  try {
    const userSnap = await getDoc(doc(db, "users", user.uid));

    if (!userSnap.exists()) {
      showBlockedState("Profile required", "Please complete your Sangat Works profile before opening workspaces.");
      return;
    }

    currentUserData = userSnap.data();

    const projectSnap = await getDoc(doc(db, "projects", projectId));

    if (!projectSnap.exists()) {
      showBlockedState("Project not found", "This project could not be found.");
      return;
    }

    selectedProject = {
      id: projectSnap.id,
      ...projectSnap.data()
    };

    updateProjectHeading();

    const allowed = await resolveWorkspaceAccess();

    if (!allowed) {
      showBlockedState("Access blocked", "Only the homeowner and accepted project team members can open this workspace.");
      return;
    }

    if (!selectedProject.workspaceUnlocked) {
      showLockedState();
      return;
    }

    showWorkspaceState();
    await loadWorkspaceData();
  } catch (error) {
    console.error(error);
    showBlockedState("Workspace error", "Could not load this workspace. Please refresh and try again.");
  }
});

bindForm(els.taskForm, createWorkspaceTask);
bindForm(els.milestoneForm, createWorkspaceMilestone);
bindForm(els.documentForm, createWorkspaceDocument);
bindForm(els.photoForm, createWorkspacePhoto);
bindForm(els.quoteForm, createWorkspaceQuote);
bindForm(els.messageForm, createWorkspaceMessage);
bindForm(els.budgetForm, createBudgetItem);
bindForm(els.noteForm, createWorkspaceNote);

if (els.progressButton) {
  els.progressButton.addEventListener("click", saveWorkspaceProgress);
}

if (els.checkoutButton) {
  els.checkoutButton.addEventListener("click", startWorkspaceUnlockCheckout);
}

if (els.taskBoard) {
  els.taskBoard.addEventListener("click", async (event) => {
    const statusButton = event.target.closest("[data-task-status]");
    const deleteButton = event.target.closest("[data-delete-task-id]");

    if (statusButton) {
      await updateTaskStatus(
        statusButton.getAttribute("data-task-id"),
        statusButton.getAttribute("data-task-status")
      );
    }

    if (deleteButton) {
      await deleteWorkspaceTask(deleteButton.getAttribute("data-delete-task-id"));
    }
  });
}

function bindForm(form, handler) {
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await handler();
  });
}

async function resolveWorkspaceAccess() {
  if (canAccessAnyWorkspace(currentUserData)) {
    accessRole = "super_admin";
    return true;
  }

  if (selectedProject.ownerId === currentUser.uid) {
    accessRole = "owner";
    return true;
  }

  const teamQuery = query(
    collection(db, "projectTeams"),
    where("projectId", "==", selectedProject.id),
    where("memberId", "==", currentUser.uid),
    where("status", "==", "active"),
    limit(1)
  );

  const teamSnapshot = await getDocs(teamQuery);

  if (!teamSnapshot.empty) {
    accessRole = "team";
    return true;
  }

  return false;
}

function updateProjectHeading() {
  if (els.title) {
    els.title.textContent = selectedProject.title || "Project Workspace";
  }

  if (els.summary) {
    els.summary.textContent = `${selectedProject.projectType || "Project"} in ${selectedProject.location || "location not provided"}.`;
  }
}

function showBlockedState(title, message) {
  hideWorkspaceViews();
  els.accessBox?.classList.remove("hidden");

  if (els.accessTitle) els.accessTitle.textContent = title;
  if (els.accessMessage) els.accessMessage.textContent = message;
}

function showLockedState() {
  hideWorkspaceViews();

  els.accessBox?.classList.remove("hidden");
  els.lockedBox?.classList.remove("hidden");

  if (els.accessTitle) els.accessTitle.textContent = "Workspace locked";

  if (els.accessMessage) {
    els.accessMessage.textContent = accessRole === "owner" || accessRole === "super_admin"
      ? "You can access this project, but the workspace tools are locked until the one-off unlock is connected and completed."
      : "You are on this project team, but the homeowner needs to unlock the workspace before team members can use it.";
  }

  if (els.lockedMessage && (accessRole === "owner" || accessRole === "super_admin")) {
    const amount = selectedProject.workspaceUnlockAmount || 40;
    els.lockedMessage.textContent = accessRole === "super_admin"
      ? "Super Admins can unlock this workspace without payment."
      : `Unlock this project workspace with a one-off \u00a3${amount} payment.`;
  }

  if (els.checkoutButton) {
    els.checkoutButton.classList.toggle("hidden", accessRole !== "owner" && accessRole !== "super_admin");
    els.checkoutButton.textContent = accessRole === "super_admin"
      ? "Unlock Workspace"
      : "Unlock Workspace for \u00a340";
  }
}

function showWorkspaceState() {
  hideWorkspaceViews();
  els.shell?.classList.remove("hidden");

  if (els.roleMessage) {
    els.roleMessage.textContent = accessRole === "super_admin"
      ? "You are using this workspace as a Super Admin."
      : accessRole === "owner"
      ? "You are managing this workspace as the project owner."
      : "You are using this workspace as an accepted project team member.";
  }

  if (els.progressSelect) {
    els.progressSelect.value = selectedProject.progressStage || "planning";
    els.progressSelect.disabled = accessRole !== "owner" && accessRole !== "super_admin";
  }

  if (els.progressButton) {
    els.progressButton.disabled = accessRole !== "owner" && accessRole !== "super_admin";
  }

  updateProgressLabel(selectedProject.progressStage || "planning");
}

function hideWorkspaceViews() {
  els.accessBox?.classList.add("hidden");
  els.lockedBox?.classList.add("hidden");
  els.shell?.classList.add("hidden");
}

async function loadWorkspaceData() {
  await Promise.all([
    loadTeam(),
    loadTasks(),
    loadMilestones(),
    loadDocuments(),
    loadPhotos(),
    loadQuotes(),
    loadMessages(),
    loadBudgetItems(),
    loadNotes(),
    loadActivity()
  ]);

  renderDashboard();
}

async function loadTeam() {
  try {
    const teamQuery = query(
      collection(db, "projectTeams"),
      where("projectId", "==", selectedProject.id),
      where("status", "==", "active")
    );

    workspaceState.team = snapshotToArray(await getDocs(teamQuery)).sort(compareCreatedAtDesc);
  } catch (error) {
    console.error(error);
    workspaceState.team = [];
  }

  renderTeam();
}

async function loadTasks() {
  workspaceState.tasks = await loadProjectCollection("workspaceTasks");
  renderTasks();
}

async function loadMilestones() {
  workspaceState.milestones = await loadProjectCollection("workspaceMilestones");
  renderMilestones();
  renderTimeline();
}

async function loadDocuments() {
  workspaceState.documents = await loadProjectCollection("workspaceDocuments");
  renderDocuments();
}

async function loadPhotos() {
  workspaceState.photos = await loadProjectCollection("workspacePhotos");
  renderPhotos();
}

async function loadQuotes() {
  workspaceState.quotes = await loadProjectCollection("workspaceQuotes");
  renderQuotes();
}

async function loadMessages() {
  workspaceState.messages = await loadProjectCollection("workspaceMessages");
  renderMessages();
}

async function loadBudgetItems() {
  workspaceState.budgetItems = await loadProjectCollection("workspaceBudgetItems");
  renderBudget();
}

async function loadNotes() {
  workspaceState.notes = await loadProjectCollection("workspaceNotes");
  renderNotes();
}

async function loadActivity() {
  workspaceState.activity = await loadProjectCollection("workspaceActivity");
  renderActivity();
}

async function loadProjectCollection(collectionName) {
  try {
    const collectionQuery = query(
      collection(db, collectionName),
      where("projectId", "==", selectedProject.id)
    );

    return snapshotToArray(await getDocs(collectionQuery)).sort(compareCreatedAtDesc);
  } catch (error) {
    console.error(error);
    return [];
  }
}

function snapshotToArray(snapshot) {
  const items = [];

  snapshot.forEach((docSnap) => {
    items.push({
      id: docSnap.id,
      ...docSnap.data()
    });
  });

  return items;
}

function compareCreatedAtDesc(a, b) {
  return getTimestampMs(b.createdAt) - getTimestampMs(a.createdAt);
}

function getTimestampMs(value) {
  if (!value) return 0;

  try {
    const date = value.toDate ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? 0 : date.getTime();
  } catch (error) {
    return 0;
  }
}

function renderDashboard() {
  const quoteTotal = sumAmounts(workspaceState.quotes);
  const spendTotal = sumAmounts(workspaceState.budgetItems);

  setText(els.dashboardStatusLabel, selectedProject.status || "open");
  setText(els.dashboardBudgetLabel, selectedProject.budget || "Not set");
  setText(els.dashboardTeamCount, String(workspaceState.team.length + 1));
  setText(els.dashboardQuoteCount, String(workspaceState.quotes.length));
  setText(els.dashboardQuoteTotal, formatMoney(quoteTotal));
  setText(els.dashboardSpendTotal, formatMoney(spendTotal));
  setText(els.taskCount, String(workspaceState.tasks.length));
  updateProgressLabel(selectedProject.progressStage || "planning");

  if (els.projectSummaryDetails) {
    els.projectSummaryDetails.innerHTML = `
      ${renderDetailRow("Type", selectedProject.projectType || "Project")}
      ${renderDetailRow("Location", selectedProject.location || "Not provided")}
      ${renderDetailRow("Budget", selectedProject.budget || "Not provided")}
      ${renderDetailRow("Required trades", formatTrades(selectedProject.requiredTrades))}
      ${renderDetailRow("Workspace", selectedProject.workspacePaymentStatus || "unlocked")}
    `;
  }

  if (els.dashboardLatestActivity) {
    const latest = workspaceState.activity.slice(0, 4);
    els.dashboardLatestActivity.innerHTML = latest.length
      ? latest.map(renderActivityItem).join("")
      : `<div class="empty-state">No activity yet.</div>`;
  }
}

function renderTasks() {
  const groups = {
    todo: [],
    in_progress: [],
    done: []
  };

  workspaceState.tasks.forEach((task) => {
    groups[normalizeTaskStatus(task.status)].push(task);
  });

  renderTaskColumn(els.taskTodo, groups.todo, "No to-do tasks.");
  renderTaskColumn(els.taskInProgress, groups.in_progress, "No tasks in progress.");
  renderTaskColumn(els.taskDone, groups.done, "No completed tasks.");
  setText(els.taskCount, String(workspaceState.tasks.length));
}

function renderTaskColumn(container, tasks, emptyMessage) {
  if (!container) return;

  container.innerHTML = tasks.length
    ? tasks.map(renderTaskCard).join("")
    : `<div class="empty-state">${emptyMessage}</div>`;
}

function renderTaskCard(task) {
  const status = normalizeTaskStatus(task.status);

  return `
    <div class="workspace-item workspace-task-card">
      <div>
        <strong>${escapeHtml(task.title || "Task")}</strong>
        <span>Assigned: ${escapeHtml(task.assignedTo || "Unassigned")}</span>
        <span>Due: ${escapeHtml(task.dueDate || "No due date")}</span>
      </div>
      <div class="workspace-item-actions">
        ${status !== "todo" ? renderTaskStatusButton(task.id, "todo", "To Do") : ""}
        ${status !== "in_progress" ? renderTaskStatusButton(task.id, "in_progress", "In Progress") : ""}
        ${status !== "done" ? renderTaskStatusButton(task.id, "done", "Done") : ""}
        <button type="button" class="btn-small project-withdraw-btn" data-delete-task-id="${task.id}">Delete</button>
      </div>
    </div>
  `;
}

function renderTaskStatusButton(taskId, status, label) {
  return `<button type="button" class="btn-small" data-task-id="${taskId}" data-task-status="${status}">${label}</button>`;
}

function renderMilestones() {
  if (!els.milestonesList) return;

  const milestones = [...workspaceState.milestones].sort((a, b) => {
    return String(a.date || "").localeCompare(String(b.date || ""));
  });

  els.milestonesList.innerHTML = milestones.length
    ? milestones.map(renderMilestoneItem).join("")
    : `<div class="empty-state">No milestones yet.</div>`;
}

function renderTimeline() {
  if (!els.timelineList) return;

  const phaseItems = [
    {
      title: "Project created",
      date: formatProjectDate(selectedProject.createdAt),
      status: "complete"
    },
    ...workspaceState.milestones
  ].sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));

  els.timelineList.innerHTML = phaseItems.length
    ? phaseItems.map((item) => `
      <div class="workspace-timeline-item">
        <strong>${escapeHtml(item.title || "Timeline item")}</strong>
        <span>${escapeHtml(item.date || "Date not set")}</span>
        <span class="project-status-pill">${escapeHtml(formatStatus(item.status || "upcoming"))}</span>
      </div>
    `).join("")
    : `<div class="empty-state">No timeline yet.</div>`;
}

function renderMilestoneItem(milestone) {
  return `
    <div class="workspace-item">
      <div>
        <strong>${escapeHtml(milestone.title || "Milestone")}</strong>
        <span>Date: ${escapeHtml(milestone.date || "No date")}</span>
        <span>Status: ${escapeHtml(formatStatus(milestone.status || "upcoming"))}</span>
      </div>
    </div>
  `;
}

function renderTeam() {
  if (!els.teamList) return;

  const owner = `
    <div class="workspace-item">
      <div>
        <strong>${escapeHtml(selectedProject.ownerName || "Project Owner")}</strong>
        <span>${escapeHtml(selectedProject.ownerEmail || "")}</span>
        <span>Owner</span>
      </div>
    </div>
  `;

  const team = workspaceState.team.map((member) => `
    <div class="workspace-item">
      <div>
        <strong>${escapeHtml(member.memberName || "Team Member")}</strong>
        <span>${escapeHtml(member.memberService || member.role || "Trade")}</span>
        <span>${escapeHtml(member.memberEmail || "")}</span>
      </div>
    </div>
  `).join("");

  els.teamList.innerHTML = owner + (team || `<div class="empty-state">No accepted tradespeople yet.</div>`);
  setText(els.dashboardTeamCount, String(workspaceState.team.length + 1));
}

function renderDocuments() {
  renderSimpleList(
    els.documentsList,
    workspaceState.documents,
    "No document links yet.",
    (item) => `
      <div class="workspace-item">
        <div>
          <strong>${escapeHtml(item.title || "Document")}</strong>
          <span>${escapeHtml(item.type || "Document")}</span>
          <a href="${escapeAttribute(item.url || "#")}" target="_blank" rel="noopener">Open link</a>
        </div>
      </div>
    `
  );
}

function renderPhotos() {
  renderSimpleList(
    els.photosList,
    workspaceState.photos,
    "No photos yet.",
    (item) => `
      <div class="workspace-item workspace-photo-item">
        <div>
          <strong>${escapeHtml(item.title || "Photo")}</strong>
          <span>${escapeHtml(item.caption || "No caption")}</span>
          <a href="${escapeAttribute(item.imageUrl || "#")}" target="_blank" rel="noopener">Open image</a>
        </div>
        ${item.imageUrl ? `<img src="${escapeAttribute(item.imageUrl)}" alt="${escapeAttribute(item.title || "Project photo")}" />` : ""}
      </div>
    `
  );
}

function renderQuotes() {
  renderSimpleList(
    els.quotesList,
    workspaceState.quotes,
    "No quotes yet.",
    (item) => `
      <div class="workspace-item">
        <div>
          <strong>${escapeHtml(item.supplier || "Quote")}</strong>
          <span>Amount: ${formatMoney(Number(item.amount || 0))}</span>
          <span>Status: ${escapeHtml(formatStatus(item.status || "received"))}</span>
          <p>${escapeHtml(item.notes || "")}</p>
        </div>
      </div>
    `
  );

  setText(els.dashboardQuoteCount, String(workspaceState.quotes.length));
  setText(els.dashboardQuoteTotal, formatMoney(sumAmounts(workspaceState.quotes)));
}

function renderMessages() {
  renderSimpleList(
    els.messagesList,
    workspaceState.messages,
    "No messages yet.",
    (item) => `
      <div class="workspace-item">
        <div>
          <strong>${escapeHtml(item.createdByName || "Project Member")}</strong>
          <p>${escapeHtml(item.message || "")}</p>
          <span>${formatProjectDate(item.createdAt)}</span>
        </div>
      </div>
    `
  );
}

function renderBudget() {
  const quoteTotal = sumAmounts(workspaceState.quotes);
  const spendTotal = sumAmounts(workspaceState.budgetItems);

  if (els.budgetSummary) {
    els.budgetSummary.innerHTML = `
      ${renderDetailRow("Project budget", selectedProject.budget || "Not set")}
      ${renderDetailRow("Quote total", formatMoney(quoteTotal))}
      ${renderDetailRow("Manual spend", formatMoney(spendTotal))}
    `;
  }

  renderSimpleList(
    els.budgetItemsList,
    workspaceState.budgetItems,
    "No spend items yet.",
    (item) => `
      <div class="workspace-item">
        <div>
          <strong>${escapeHtml(item.title || "Spend item")}</strong>
          <span>${formatMoney(Number(item.amount || 0))}</span>
          <span>${escapeHtml(item.date || "No date")}</span>
        </div>
      </div>
    `
  );

  setText(els.dashboardSpendTotal, formatMoney(spendTotal));
}

function renderNotes() {
  renderSimpleList(
    els.notesList,
    workspaceState.notes,
    "No notes yet.",
    (item) => `
      <div class="workspace-item">
        <div>
          <strong>${escapeHtml(item.createdByName || "Project Member")}</strong>
          <p>${escapeHtml(item.note || "")}</p>
          <span>${formatProjectDate(item.createdAt)}</span>
        </div>
      </div>
    `
  );
}

function renderActivity() {
  renderSimpleList(
    els.activityList,
    workspaceState.activity,
    "No activity yet.",
    renderActivityItem
  );

  if (els.dashboardLatestActivity) {
    const latest = workspaceState.activity.slice(0, 4);
    els.dashboardLatestActivity.innerHTML = latest.length
      ? latest.map(renderActivityItem).join("")
      : `<div class="empty-state">No activity yet.</div>`;
  }
}

function renderActivityItem(item) {
  return `
    <div class="workspace-item workspace-activity-item">
      <div>
        <strong>${escapeHtml(item.title || "Activity")}</strong>
        <p>${escapeHtml(item.body || "")}</p>
        <span>${escapeHtml(item.createdByName || "Project Member")} - ${formatProjectDate(item.createdAt)}</span>
      </div>
    </div>
  `;
}

function renderSimpleList(container, items, emptyMessage, renderer) {
  if (!container) return;

  container.innerHTML = items.length
    ? items.map(renderer).join("")
    : `<div class="empty-state">${emptyMessage}</div>`;
}

async function createWorkspaceTask() {
  if (!canUseWorkspace()) return setTaskMessage("This workspace is locked or unavailable.");

  const title = getValue(els.taskTitle);
  const assignedTo = getValue(els.taskAssignedTo);
  const dueDate = getValue(els.taskDueDate);

  if (!title) return setTaskMessage("Enter a task title.");

  try {
    setTaskMessage("Adding task...");

    const docRef = await addDoc(collection(db, "workspaceTasks"), baseRecord({
      title,
      assignedTo,
      dueDate,
      status: "todo"
    }));

    await addActivity("task", "Task added", title, "workspaceTasks", docRef.id);
    els.taskForm.reset();
    setTaskMessage("Task added.");
    await Promise.all([loadTasks(), loadActivity()]);
    renderDashboard();
  } catch (error) {
    console.error(error);
    setTaskMessage("Could not add task.");
  }
}

async function startWorkspaceUnlockCheckout() {
  if (!currentUser || !selectedProject) return;

  if (accessRole !== "owner" && accessRole !== "super_admin") {
    setCheckoutMessage("Only the project owner can unlock this workspace.");
    return;
  }

  try {
    setCheckoutMessage(isSuperAdmin(currentUserData) ? "Unlocking workspace..." : "Opening checkout...");
    els.checkoutButton.disabled = true;
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
        projectId: selectedProject.id
      })
    });

    const data = await response.json();

    if (!response.ok || data.error) {
      throw new Error(data.error || "Could not create workspace checkout.");
    }

    if (data.unlocked) {
      selectedProject.workspaceUnlocked = true;
      selectedProject.workspacePaymentStatus = "super_admin_unlocked";
      showWorkspaceState();
      await loadWorkspaceData();
      return;
    }

    if (!data.url) {
      throw new Error("No checkout URL returned.");
    }

    window.location.href = data.url;
  } catch (error) {
    console.error(error);
    setCheckoutMessage(error.message || "Workspace checkout failed.");
    els.checkoutButton.disabled = false;
  }
}

async function updateTaskStatus(taskId, status) {
  if (!canUseWorkspace() || !taskId || !status) return;

  try {
    await updateDoc(doc(db, "workspaceTasks", taskId), {
      status,
      updatedAt: serverTimestamp()
    });

    const task = workspaceState.tasks.find((item) => item.id === taskId);
    await addActivity("task", "Task moved", `${task?.title || "Task"} moved to ${formatStatus(status)}.`, "workspaceTasks", taskId);
    await Promise.all([loadTasks(), loadActivity()]);
    renderDashboard();
  } catch (error) {
    console.error(error);
    alert("Could not update task.");
  }
}

async function deleteWorkspaceTask(taskId) {
  if (!canUseWorkspace() || !taskId) return;
  if (!window.confirm("Delete this task?")) return;

  try {
    await deleteDoc(doc(db, "workspaceTasks", taskId));
    await addActivity("task", "Task deleted", "A task was deleted.", "workspaceTasks", taskId);
    await Promise.all([loadTasks(), loadActivity()]);
    renderDashboard();
  } catch (error) {
    console.error(error);
    alert("Could not delete task.");
  }
}

async function createWorkspaceMilestone() {
  if (!canUseWorkspace()) return setMilestoneMessage("This workspace is locked or unavailable.");

  const title = getValue(els.milestoneTitle);
  const date = getValue(els.milestoneDate);
  const status = getValue(els.milestoneStatus) || "upcoming";

  if (!title || !date) return setMilestoneMessage("Enter a milestone title and date.");

  try {
    setMilestoneMessage("Adding milestone...");

    const docRef = await addDoc(collection(db, "workspaceMilestones"), baseRecord({ title, date, status }));
    await addActivity("milestone", "Milestone added", `${title} - ${date}`, "workspaceMilestones", docRef.id);
    els.milestoneForm.reset();
    setMilestoneMessage("Milestone added.");
    await Promise.all([loadMilestones(), loadActivity()]);
  } catch (error) {
    console.error(error);
    setMilestoneMessage("Could not add milestone.");
  }
}

async function createWorkspaceDocument() {
  if (!canUseWorkspace()) return setDocumentMessage("This workspace is locked or unavailable.");

  const title = getValue(els.documentTitle);
  const type = getValue(els.documentType);
  const url = normalizeUrl(getValue(els.documentUrl));

  if (!title || !url) return setDocumentMessage("Enter a document title and URL.");

  try {
    setDocumentMessage("Adding document...");

    const docRef = await addDoc(collection(db, "workspaceDocuments"), baseRecord({ title, type, url }));
    await addActivity("document", "Document added", title, "workspaceDocuments", docRef.id);
    els.documentForm.reset();
    setDocumentMessage("Document added.");
    await Promise.all([loadDocuments(), loadActivity()]);
  } catch (error) {
    console.error(error);
    setDocumentMessage("Could not add document.");
  }
}

async function createWorkspacePhoto() {
  if (!canUseWorkspace()) return setPhotoMessage("This workspace is locked or unavailable.");

  const title = getValue(els.photoTitle);
  const imageUrl = normalizeUrl(getValue(els.photoUrl));
  const caption = getValue(els.photoCaption);

  if (!title || !imageUrl) return setPhotoMessage("Enter a photo title and image URL.");

  try {
    setPhotoMessage("Adding photo...");

    const docRef = await addDoc(collection(db, "workspacePhotos"), baseRecord({ title, imageUrl, caption }));
    await addActivity("photo", "Photo added", title, "workspacePhotos", docRef.id);
    els.photoForm.reset();
    setPhotoMessage("Photo added.");
    await Promise.all([loadPhotos(), loadActivity()]);
  } catch (error) {
    console.error(error);
    setPhotoMessage("Could not add photo.");
  }
}

async function createWorkspaceQuote() {
  if (!canUseWorkspace()) return setQuoteMessage("This workspace is locked or unavailable.");

  const supplier = getValue(els.quoteSupplier);
  const amount = Number(getValue(els.quoteAmount));
  const status = getValue(els.quoteStatus) || "received";
  const notes = getValue(els.quoteNotes);

  if (!supplier || Number.isNaN(amount)) return setQuoteMessage("Enter a supplier and amount.");

  try {
    setQuoteMessage("Adding quote...");

    const docRef = await addDoc(collection(db, "workspaceQuotes"), baseRecord({ supplier, amount, status, notes }));
    await addActivity("quote", "Quote added", `${supplier} - ${formatMoney(amount)}`, "workspaceQuotes", docRef.id);
    els.quoteForm.reset();
    setQuoteMessage("Quote added.");
    await Promise.all([loadQuotes(), loadActivity()]);
    renderDashboard();
    renderBudget();
  } catch (error) {
    console.error(error);
    setQuoteMessage("Could not add quote.");
  }
}

async function createWorkspaceMessage() {
  if (!canUseWorkspace()) return setMessageFormMessage("This workspace is locked or unavailable.");

  const message = getValue(els.messageText);

  if (!message) return setMessageFormMessage("Enter a message.");

  try {
    setMessageFormMessage("Sending message...");

    const docRef = await addDoc(collection(db, "workspaceMessages"), baseRecord({ message }));
    await addActivity("message", "Message posted", message.slice(0, 120), "workspaceMessages", docRef.id);
    els.messageForm.reset();
    setMessageFormMessage("Message sent.");
    await Promise.all([loadMessages(), loadActivity()]);
  } catch (error) {
    console.error(error);
    setMessageFormMessage("Could not send message.");
  }
}

async function createBudgetItem() {
  if (!canUseWorkspace()) return setBudgetMessage("This workspace is locked or unavailable.");

  const title = getValue(els.budgetTitle);
  const amount = Number(getValue(els.budgetAmount));
  const date = getValue(els.budgetDate);

  if (!title || Number.isNaN(amount)) return setBudgetMessage("Enter a spend title and amount.");

  try {
    setBudgetMessage("Adding spend item...");

    const docRef = await addDoc(collection(db, "workspaceBudgetItems"), baseRecord({ title, amount, date }));
    await addActivity("budget", "Spend item added", `${title} - ${formatMoney(amount)}`, "workspaceBudgetItems", docRef.id);
    els.budgetForm.reset();
    setBudgetMessage("Spend item added.");
    await Promise.all([loadBudgetItems(), loadActivity()]);
    renderDashboard();
  } catch (error) {
    console.error(error);
    setBudgetMessage("Could not add spend item.");
  }
}

async function createWorkspaceNote() {
  if (!canUseWorkspace()) return setNoteMessage("This workspace is locked or unavailable.");

  const note = getValue(els.noteText);

  if (!note) return setNoteMessage("Enter a note.");

  try {
    setNoteMessage("Adding note...");

    const docRef = await addDoc(collection(db, "workspaceNotes"), baseRecord({ note }));
    await addActivity("note", "Note added", note.slice(0, 120), "workspaceNotes", docRef.id);
    els.noteForm.reset();
    setNoteMessage("Note added.");
    await Promise.all([loadNotes(), loadActivity()]);
  } catch (error) {
    console.error(error);
    setNoteMessage("Could not add note.");
  }
}

async function saveWorkspaceProgress() {
  if (!canUseWorkspace()) return setProgressMessage("This workspace is locked or unavailable.");
  if (accessRole !== "owner" && accessRole !== "super_admin") return setProgressMessage("Only the project owner can update progress.");

  const progressStage = getValue(els.progressSelect) || "planning";

  try {
    setProgressMessage("Saving progress...");

    await updateDoc(doc(db, "projects", selectedProject.id), {
      progressStage,
      updatedAt: serverTimestamp()
    });

    selectedProject.progressStage = progressStage;
    updateProgressLabel(progressStage);
    await addActivity("progress", "Progress updated", `Stage set to ${getProgressLabel(progressStage)}.`, "projects", selectedProject.id);
    await loadActivity();
    renderDashboard();
    setProgressMessage("Progress saved.");
  } catch (error) {
    console.error(error);
    setProgressMessage("Could not save progress.");
  }
}

async function addActivity(type, title, body, sourceCollection, sourceId) {
  if (!selectedProject || !currentUser) return;

  await addDoc(collection(db, "workspaceActivity"), baseRecord({
    type,
    title,
    body,
    sourceCollection,
    sourceId
  }));
}

function baseRecord(data) {
  return {
    projectId: selectedProject.id,
    projectTitle: selectedProject.title || "",
    createdBy: currentUser.uid,
    createdByName: getCurrentUserDisplayName(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...data
  };
}

function canUseWorkspace() {
  return Boolean(
    currentUser &&
    selectedProject &&
    (selectedProject.workspaceUnlocked || canAccessAnyWorkspace(currentUserData)) &&
    accessRole
  );
}

function normalizeTaskStatus(status) {
  if (status === "done" || status === "completed") return "done";
  if (status === "in_progress") return "in_progress";
  return "todo";
}

function updateProgressLabel(stage) {
  setText(els.progressLabel, getProgressLabel(stage));
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

function formatStatus(status) {
  return String(status || "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatTrades(trades) {
  return Array.isArray(trades) && trades.length ? trades.join(", ") : "Not set";
}

function sumAmounts(items) {
  return items.reduce((total, item) => {
    const amount = Number(item.amount || 0);
    return total + (Number.isNaN(amount) ? 0 : amount);
  }, 0);
}

function formatMoney(amount) {
  return `\u00a3${Number(amount || 0).toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  })}`;
}

function formatProjectDate(timestamp) {
  if (!timestamp) return "Just now";

  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);

    if (Number.isNaN(date.getTime())) return "Recently";

    return date.toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  } catch (error) {
    return "Recently";
  }
}

function renderDetailRow(label, value) {
  return `
    <div class="workspace-detail-row">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function getValue(input) {
  return input ? input.value.trim() : "";
}

function normalizeUrl(value) {
  if (!value) return "";

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
  } catch (error) {
    return "";
  }
}

function setText(element, value) {
  if (element) element.textContent = value;
}

function setTaskMessage(message) {
  setText(els.taskMessage, message);
}

function setMilestoneMessage(message) {
  setText(els.milestoneMessage, message);
}

function setDocumentMessage(message) {
  setText(els.documentMessage, message);
}

function setPhotoMessage(message) {
  setText(els.photoMessage, message);
}

function setQuoteMessage(message) {
  setText(els.quoteMessage, message);
}

function setMessageFormMessage(message) {
  setText(els.messageFormMessage, message);
}

function setBudgetMessage(message) {
  setText(els.budgetMessage, message);
}

function setNoteMessage(message) {
  setText(els.noteMessage, message);
}

function setProgressMessage(message) {
  setText(els.progressMessage, message);
}

function setCheckoutMessage(message) {
  setText(els.checkoutMessage, message);
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

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}
