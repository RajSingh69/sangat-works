// Display and formatting helpers for the Projects page. These take plain data
// and return values or HTML; they don't read or change page state.
export function getProjectUserType(userData) {
  return ["homeowner", "tradesperson"].includes(userData?.projectsUserType)
    ? userData.projectsUserType
    : "";
}
export function getMembershipLabel(userData) {
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
export function renderWorkspaceTask(task) {
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
export function renderWorkspaceNote(note) {
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
export function getProgressLabel(stage) {
  const labels = {
    planning: "Planning",
    team_selected: "Team Selected",
    in_progress: "In Progress",
    snagging: "Snagging",
    completed: "Completed"
  };

  return labels[stage] || "Planning";
}
export function hasActiveTradesJobAccess(userData) {
  const expiryDate = getDateFromTimestamp(userData?.tradesJobAccessExpiresAt);

  return Boolean(
    userData?.tradesJobAccess === true &&
    userData?.tradesJobAccessStatus === "active" &&
    expiryDate &&
    expiryDate > new Date()
  );
}
export function renderApplyRoleButtons(projectId, requiredTrades, openTradeRoles) {
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
export function renderApplicantRow(application) {
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
export function renderTeamMemberRow(member) {
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
export function renderWorkspaceLockCard(project) {
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
export function renderApplicationCard(application) {
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
export function renderTeamMembershipCard(teamMember) {
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
export function getSelectedTrades() {
  const checkedBoxes = document.querySelectorAll(".trade-chip-grid input[type='checkbox']:checked");
  return Array.from(checkedBoxes).map((box) => box.value);
}
export function getInputValue(id) {
  const input = document.getElementById(id);
  return input ? input.value.trim() : "";
}
export function formatProjectDate(timestamp) {
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
export function formatDate(timestamp) {
  const date = getDateFromTimestamp(timestamp);

  if (!date) return "-";

  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
}
export function getDateFromTimestamp(timestamp) {
  if (!timestamp) return null;

  try {
    const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch (error) {
    return null;
  }
}
export function getStatusClass(status) {
  if (status === "accepted") return "status-accepted";
  if (status === "rejected") return "status-rejected";
  return "status-pending";
}
export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
