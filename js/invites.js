/*
  Invite a friend card on profile.html (rewards handled in functions/referrals.js).
  Each member's link is join.html?invite=<their uid>.
*/

import { auth, db } from "./firebase.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const card = document.getElementById("inviteCard");
const linkInput = document.getElementById("inviteLink");
const copyButton = document.getElementById("inviteCopy");
const whatsappLink = document.getElementById("inviteWhatsApp");
const stats = document.getElementById("inviteStats");

function inviteUrl(uid) {
  return `https://sangatworks.co.uk/join.html?invite=${encodeURIComponent(uid)}`;
}

async function loadStats(uid) {
  try {
    const snap = await getDocs(query(collection(db, "referrals"), where("referrerUid", "==", uid)));
    const joined = snap.size;
    const earned = snap.docs.filter(doc => doc.data().status === "rewarded").length;
    stats.textContent = joined
      ? `${joined} friend${joined === 1 ? "" : "s"} joined · ${earned} free month${earned === 1 ? "" : "s"} earned`
      : "No friends have joined with your link yet.";
  } catch (error) {
    console.warn("Could not load invite stats:", error);
    stats.textContent = "";
  }
}

if (card) {
  onAuthStateChanged(auth, (user) => {
    if (!user) return;
    const url = inviteUrl(user.uid);
    linkInput.value = url;
    const message = `I'm on Sangat Works, the Sikh business and professional network. Join with my link and your first month is free: ${url}`;
    whatsappLink.href = `https://wa.me/?text=${encodeURIComponent(message)}`;
    card.hidden = false;
    loadStats(user.uid);
  });

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(linkInput.value);
    } catch {
      linkInput.select();
      document.execCommand("copy");
    }
    copyButton.textContent = "Copied";
    setTimeout(() => { copyButton.textContent = "Copy link"; }, 2000);
  });

  linkInput.addEventListener("focus", () => linkInput.select());
}
