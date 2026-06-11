import { auth } from "./firebase.js";

import {
  onAuthStateChanged,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";

const accountArea = document.getElementById("accountArea");

if (accountArea) {
  onAuthStateChanged(auth, (user) => {
    if (user) {
      accountArea.innerHTML = `
        <span class="account-email">${user.email}</span>
        <a href="profile.html" class="btn-small">Edit Profile</a>
        <button id="logoutBtn" class="btn-small logout-btn">Logout</button>
      `;

      document.getElementById("logoutBtn").addEventListener("click", async () => {
        await signOut(auth);
        window.location.href = "login.html";
      });
    } else {
      accountArea.innerHTML = `
        <a href="login.html" class="btn-small">Login</a>
      `;
    }
  });
}