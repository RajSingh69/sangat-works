// Plain-English messages for Firebase Auth errors (shown on login and signup).
const MESSAGES = {
  "auth/invalid-credential": "That email and password don't match. Check them and try again.",
  "auth/wrong-password": "That email and password don't match. Check them and try again.",
  "auth/user-not-found": "There's no account with that email yet.",
  "auth/invalid-email": "That email address doesn't look right.",
  "auth/email-already-in-use": "That email already has an account. Log in instead.",
  "auth/weak-password": "Please use a password with at least 6 characters.",
  "auth/too-many-requests": "Too many attempts. Wait a minute, then try again.",
  "auth/network-request-failed": "No connection. Check your internet and try again.",
  "auth/user-disabled": "This account has been disabled. Please contact us."
};

export function friendlyAuthError(error, fallback = "Something went wrong. Please try again.") {
  return MESSAGES[error?.code] || fallback;
}
