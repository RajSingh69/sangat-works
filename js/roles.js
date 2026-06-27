export const ROLE_ORDER = {
  standard: 0,
  member: 1,
  moderator: 2,
  admin: 3,
  super_admin: 4
};

export function getUserRole(userData) {
  if (!userData) return "standard";

  if (ROLE_ORDER[userData.role] !== undefined) {
    return userData.role;
  }

  if (userData.accountType === "admin" || userData.isAdmin === true) {
    return "admin";
  }

  if (userData.hasSubscription === true || userData.isFoundingMember === true) {
    return "member";
  }

  return "standard";
}

export function hasRoleAtLeast(userData, role) {
  const currentRole = getUserRole(userData);
  return ROLE_ORDER[currentRole] >= ROLE_ORDER[role];
}

export function isSuperAdmin(userData) {
  return getUserRole(userData) === "super_admin";
}

export function isAdminUser(userData) {
  return hasRoleAtLeast(userData, "admin");
}

export function canAccessDeveloperFeatures(userData) {
  return isSuperAdmin(userData);
}

export function canBypassPaymentGates(userData) {
  return isSuperAdmin(userData);
}

export function canAccessAnyWorkspace(userData) {
  return isSuperAdmin(userData);
}

export function isInternalAccount(userData) {
  return userData?.internalAccount === true || isSuperAdmin(userData);
}
