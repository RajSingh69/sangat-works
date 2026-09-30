/*
  Learning Hub: members ask questions and share guides (learnPosts), reply
  (learnPosts/{id}/replies) and upvote (…/votes/{uid}, one per member).
  Vote and reply counts are kept by Cloud Functions (functions/learning.js);
  the page updates them locally straight away so voting feels instant.
*/

import { db } from "./firebase.js";
import { loadErrorHtml } from "./load-error.js";
import { protectPage } from "./subscription-guard.js";
import { getPublicProfiles } from "./member-network.js";
import { escapeHtml, getCardIdentity, renderFramedPhoto } from "./directory-card.js";
import { isAdminUser } from "./roles.js";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

// Kept in step with validLearnPost() in firestore.rules.
const TOPICS = [
  { id: "maths", label: "Maths" },
  { id: "english", label: "English" },
  { id: "science", label: "Science" },
  { id: "coding", label: "Coding & Software" },
  { id: "diy", label: "DIY & Home" },
  { id: "business", label: "Business & Money" },
  { id: "careers", label: "Careers" },
  { id: "punjabi-sikhi", label: "Punjabi & Sikhi" },
  { id: "other", label: "Other" }
];
const topicLabel = id => (TOPICS.find(topic => topic.id === id) || { label: "Other" }).label;

const $ = id => document.getElementById(id);
const els = {
  count: $("lhCount"),
  results: $("lhResults"),
  tabs: $("lhTopicTabs"),
  search: $("lhSearch"),
  kind: $("lhKind"),
  sort: $("lhSort"),
  mine: $("lhMine"),
  formModal: $("lhFormModal"),
  form: $("lhForm"),
  formHeading: $("lhFormTitle"),
  formKind: $("lhFormKind"),
  formTopic: $("lhFormTopic"),
  formTitle: $("lhFormTitleInput"),
  formBody: $("lhFormBody"),
  formLink: $("lhFormLink"),
  formMessage: $("lhFormMessage"),
  formSubmit: $("lhFormSubmit"),
  detailModal: $("lhDetailModal"),
  detailBody: $("lhDetailBody")
};

let currentUser = null;
let canModerate = false;
let posts = [];
let profiles = new Map();
let myPostVotes = new Set();
let activeTopic = "all";
let editingId = null;
let openPostId = null;
let replies = [];
let myReplyVotes = new Set();
let editingReplyId = null;

// ---------- Helpers

function toDate(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timeAgo(value) {
  const date = toDate(value);
  if (!date) return "just now";
  const minutes = Math.floor((Date.now() - date.getTime()) / 60000);
  if (minutes < 60) return minutes < 2 ? "just now" : `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month ago" : `${months} months ago`;
}

function safeLink(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

// Escapes text, then turns web addresses into links and keeps line breaks.
function richText(text) {
  return escapeHtml(text).replace(/https?:\/\/[^\s<]+/g, url => {
    const trimmed = url.replace(/[.,;:!?)]+$/, "");
    const rest = url.slice(trimmed.length);
    return `<a href="${trimmed}" target="_blank" rel="noopener nofollow ugc">${trimmed}</a>${rest}`;
  });
}

function linkLabel(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function authorName(uid) {
  const profile = profiles.get(uid);
  return profile ? getCardIdentity(profile) : "Sangat Works member";
}

function activityTime(post) {
  return (toDate(post.lastActivityAt) || toDate(post.createdAt))?.getTime() || 0;
}

const upArrow = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 14 6-6 6 6"/></svg>`;

function voteButton({ count, voted, postId, replyId = "", label }) {
  return `
    <button type="button" class="lh-vote${voted ? " is-voted" : ""}" data-vote-post="${escapeHtml(postId)}" data-vote-reply="${escapeHtml(replyId)}"
      aria-pressed="${voted}" aria-label="${voted ? "Remove your upvote from" : "Upvote"} ${escapeHtml(label)}">
      ${upArrow}<span>${Number(count) || 0}</span>
    </button>`;
}

// ---------- Loading

async function loadPosts() {
  try {
    const snap = await getDocs(query(collection(db, "learnPosts"), where("status", "==", "active")));
    posts = snap.docs.map(docSnap => ({ id: docSnap.id, voteCount: 0, replyCount: 0, ...docSnap.data() }));
    const [profileMap, votes] = await Promise.all([
      getPublicProfiles(posts.map(post => post.ownerId)),
      Promise.all(posts.map(post => getDoc(doc(db, "learnPosts", post.id, "votes", currentUser.uid)).catch(() => null)))
    ]);
    profiles = profileMap;
    myPostVotes = new Set(posts.filter((post, index) => votes[index]?.exists()).map(post => post.id));
    renderTabs();
    render();
    const openId = new URLSearchParams(window.location.search).get("post");
    if (openId && posts.some(post => post.id === openId)) openDetail(openId);
  } catch (error) {
    console.error("Could not load the Learning Hub:", error);
    els.count.textContent = "Couldn't load posts";
    els.results.innerHTML = `<div class="opp-empty">${loadErrorHtml("the Learning Hub")}</div>`;
  }
}

// ---------- List

function visiblePosts() {
  const search = els.search.value.trim().toLowerCase();
  let items = posts;
  if (els.mine.checked) items = items.filter(post => post.ownerId === currentUser.uid);
  if (activeTopic !== "all") items = items.filter(post => post.topic === activeTopic);
  if (els.kind.value) items = items.filter(post => post.kind === els.kind.value);
  if (els.sort.value === "unanswered") items = items.filter(post => post.kind === "question" && !post.replyCount);
  if (search) items = items.filter(post => [post.title, post.body, topicLabel(post.topic)].join(" ").toLowerCase().includes(search));

  const newest = (a, b) => (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0);
  const sorters = {
    active: (a, b) => activityTime(b) - activityTime(a),
    newest,
    top: (a, b) => (b.voteCount || 0) - (a.voteCount || 0) || newest(a, b),
    unanswered: newest
  };
  return [...items].sort(sorters[els.sort.value] || sorters.active);
}

function renderTabs() {
  const counts = new Map(TOPICS.map(topic => [topic.id, posts.filter(post => post.topic === topic.id).length]));
  const tabs = [{ id: "all", label: "All", count: posts.length }, ...TOPICS.map(topic => ({ ...topic, count: counts.get(topic.id) }))];
  els.tabs.innerHTML = tabs.map(tab => `
    <button type="button" role="tab" class="opp-type-tab${tab.id === activeTopic ? " is-active" : ""}" data-topic="${tab.id}" aria-selected="${tab.id === activeTopic}">
      ${escapeHtml(tab.label)} <span>${tab.count}</span>
    </button>`).join("");
}

function renderRow(post) {
  const replyLabel = post.replyCount === 1 ? "1 reply" : `${post.replyCount || 0} replies`;
  return `
    <article class="lh-row">
      ${voteButton({ count: post.voteCount, voted: myPostVotes.has(post.id), postId: post.id, label: post.title })}
      <button type="button" class="lh-row-open" data-open-post="${escapeHtml(post.id)}">
        <span class="lh-tags">
          <span class="lh-kind is-${escapeHtml(post.kind)}">${post.kind === "guide" ? "Guide" : "Question"}</span>
          <span class="lh-topic">${escapeHtml(topicLabel(post.topic))}</span>
        </span>
        <strong class="lh-row-title">${escapeHtml(post.title)}</strong>
        <small>${escapeHtml(replyLabel)} &middot; ${escapeHtml(authorName(post.ownerId))} &middot; ${escapeHtml(timeAgo(post.createdAt))}${post.link ? ` &middot; <span class="lh-has-link">Link</span>` : ""}</small>
      </button>
    </article>`;
}

function render() {
  const items = visiblePosts();
  els.count.textContent = `${items.length} of ${posts.length} post${posts.length === 1 ? "" : "s"}`;
  if (!items.length) {
    const empty = els.mine.checked
      ? `<strong>You haven't posted yet.</strong><span>Ask a question or share a guide to get started.</span>`
      : posts.length
        ? `<strong>Nothing here yet.</strong><span>Try another topic, or be the first to ask.</span>`
        : `<strong>Be the first to post.</strong><span>Ask the Sangat something, or share a tip you know.</span>`;
    els.results.innerHTML = `<div class="opp-empty">${empty}</div>`;
    return;
  }
  els.results.innerHTML = items.map(renderRow).join("");
}

// ---------- Post detail with replies

async function openDetail(postId) {
  const post = posts.find(item => item.id === postId);
  if (!post) return;
  openPostId = postId;
  editingReplyId = null;
  replies = [];
  renderDetail(true);
  els.detailModal.hidden = false;
  els.detailModal.querySelector(".opp-modal-close").focus();
  const url = new URL(window.location.href);
  url.searchParams.set("post", postId);
  history.replaceState(null, "", url);

  try {
    const snap = await getDocs(query(collection(db, "learnPosts", postId, "replies"), where("status", "==", "active")));
    replies = snap.docs.map(docSnap => ({ id: docSnap.id, voteCount: 0, ...docSnap.data() }));
    const [profileMap, votes] = await Promise.all([
      getPublicProfiles(replies.map(reply => reply.ownerId)),
      Promise.all(replies.map(reply => getDoc(doc(db, "learnPosts", postId, "replies", reply.id, "votes", currentUser.uid)).catch(() => null)))
    ]);
    profiles = new Map([...profiles, ...profileMap]);
    myReplyVotes = new Set(replies.filter((reply, index) => votes[index]?.exists()).map(reply => reply.id));
    if (openPostId === postId) renderDetail(false);
  } catch (error) {
    console.error("Could not load replies:", error);
    if (openPostId === postId) {
      const list = document.getElementById("lhReplies");
      if (list) list.innerHTML = loadErrorHtml("replies");
    }
  }
}

function renderAuthor(uid, suffix) {
  const profile = profiles.get(uid);
  return `
    <a class="opp-poster lh-author" href="view.html?id=${encodeURIComponent(uid)}">
      ${renderFramedPhoto(profile || {}, { className: "opp-poster-photo" })}
      <span><strong>${escapeHtml(authorName(uid))}</strong><small>${escapeHtml(suffix)}</small></span>
    </a>`;
}

function renderReply(reply) {
  const mine = reply.ownerId === currentUser.uid;
  if (editingReplyId === reply.id) {
    return `
      <article class="lh-reply">
        <form class="lh-reply-form" data-edit-reply-form="${escapeHtml(reply.id)}">
          <textarea name="body" rows="4" maxlength="3000" required>${escapeHtml(reply.body)}</textarea>
          <input type="url" name="link" maxlength="300" placeholder="Link (optional)" value="${escapeHtml(reply.link || "")}" />
          <div class="lh-inline-actions">
            <button type="submit" class="btn-primary">Save</button>
            <button type="button" class="btn-secondary" data-cancel-edit-reply>Cancel</button>
          </div>
        </form>
      </article>`;
  }
  const link = safeLink(reply.link);
  const actions = [
    mine ? `<button type="button" class="lh-text-btn" data-edit-reply="${escapeHtml(reply.id)}">Edit</button>` : "",
    mine ? `<button type="button" class="lh-text-btn is-danger" data-delete-reply="${escapeHtml(reply.id)}">Delete</button>` : "",
    !mine ? `<button type="button" class="lh-text-btn" data-report-reply="${escapeHtml(reply.id)}">Report</button>` : "",
    canModerate && !mine ? `<button type="button" class="lh-text-btn is-danger" data-remove-reply="${escapeHtml(reply.id)}">Take down (admin)</button>` : ""
  ].join("");
  return `
    <article class="lh-reply">
      ${voteButton({ count: reply.voteCount, voted: myReplyVotes.has(reply.id), postId: openPostId, replyId: reply.id, label: "this reply" })}
      <div class="lh-reply-main">
        ${renderAuthor(reply.ownerId, timeAgo(reply.createdAt))}
        <p class="lh-text">${richText(reply.body)}</p>
        ${link ? `<a class="lh-link-card" href="${escapeHtml(link)}" target="_blank" rel="noopener nofollow ugc">${escapeHtml(linkLabel(link))}</a>` : ""}
        <div class="lh-inline-actions">${actions}</div>
      </div>
    </article>`;
}

function renderDetail(loading) {
  const post = posts.find(item => item.id === openPostId);
  if (!post) return;
  const mine = post.ownerId === currentUser.uid;
  const link = safeLink(post.link);
  const sorted = [...replies].sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0) || (toDate(a.createdAt)?.getTime() || 0) - (toDate(b.createdAt)?.getTime() || 0));
  const postActions = [
    mine ? `<button type="button" class="lh-text-btn" data-edit-post="${escapeHtml(post.id)}">Edit</button>` : "",
    mine ? `<button type="button" class="lh-text-btn is-danger" data-delete-post="${escapeHtml(post.id)}">Delete</button>` : "",
    !mine ? `<button type="button" class="lh-text-btn" data-report-post="${escapeHtml(post.id)}">Report</button>` : "",
    canModerate && !mine ? `<button type="button" class="lh-text-btn is-danger" data-remove-post="${escapeHtml(post.id)}">Take down (admin)</button>` : ""
  ].join("");

  els.detailBody.innerHTML = `
    <div class="lh-detail-post">
      ${voteButton({ count: post.voteCount, voted: myPostVotes.has(post.id), postId: post.id, label: post.title })}
      <div class="lh-detail-main">
        <span class="lh-tags">
          <span class="lh-kind is-${escapeHtml(post.kind)}">${post.kind === "guide" ? "Guide" : "Question"}</span>
          <span class="lh-topic">${escapeHtml(topicLabel(post.topic))}</span>
        </span>
        <h2 id="lhDetailTitle">${escapeHtml(post.title)}</h2>
        ${renderAuthor(post.ownerId, `${post.kind === "guide" ? "Shared" : "Asked"} ${timeAgo(post.createdAt)}`)}
        ${post.body ? `<p class="lh-text">${richText(post.body)}</p>` : ""}
        ${link ? `<a class="lh-link-card" href="${escapeHtml(link)}" target="_blank" rel="noopener nofollow ugc">${escapeHtml(linkLabel(link))}</a>` : ""}
        <div class="lh-inline-actions">${postActions}</div>
      </div>
    </div>
    <p class="lh-detail-message" id="lhDetailMessage" role="status"></p>

    <h3 class="lh-replies-title">${loading ? "Replies" : sorted.length === 1 ? "1 reply" : `${sorted.length} replies`}</h3>
    <div class="lh-replies" id="lhReplies">
      ${loading ? `<p class="lh-muted">Loading replies...</p>` : sorted.length ? sorted.map(renderReply).join("") : `<p class="lh-muted">No replies yet. ${post.kind === "question" ? "Know the answer? Help them out below." : "Say thanks or add your own tip below."}</p>`}
    </div>

    <form class="lh-reply-form" id="lhReplyForm">
      <label for="lhReplyBody" class="lh-reply-label">${post.kind === "question" ? "Your answer" : "Your reply"}</label>
      <textarea id="lhReplyBody" name="body" rows="4" maxlength="3000" placeholder="${post.kind === "question" ? "Share what you know. Be kind and specific." : "Add a thank you, a question or your own tip."}" required></textarea>
      <input type="url" name="link" maxlength="300" placeholder="Link (optional): a video, article or resource" />
      <div class="lh-inline-actions">
        <button type="submit" class="btn-primary" id="lhReplySubmit">Post reply</button>
      </div>
    </form>`;
}

function closeDetail() {
  els.detailModal.hidden = true;
  openPostId = null;
  const url = new URL(window.location.href);
  url.searchParams.delete("post");
  history.replaceState(null, "", url);
}

function setDetailMessage(text) {
  const message = document.getElementById("lhDetailMessage");
  if (message) message.textContent = text;
}

function friendlyError(error, fallback) {
  return error?.code || error instanceof TypeError
    ? "That didn't work. Check your connection and try again."
    : error?.message || fallback;
}

// ---------- Posting

function openForm(kind = "question", post = null) {
  editingId = post ? post.id : null;
  els.formKind.value = post?.kind || kind;
  els.formTopic.value = post?.topic || (activeTopic !== "all" ? activeTopic : "");
  els.formTitle.value = post?.title || "";
  els.formBody.value = post?.body || "";
  els.formLink.value = post?.link || "";
  els.formMessage.textContent = "";
  syncFormLabels();
  if (post) closeDetail();
  els.formModal.hidden = false;
  els.formTitle.focus();
}

function syncFormLabels() {
  const guide = els.formKind.value === "guide";
  els.formHeading.textContent = editingId ? "Edit post" : guide ? "Share a guide" : "Ask a question";
  els.formSubmit.textContent = editingId ? "Save changes" : guide ? "Share guide" : "Post question";
  els.formTitle.placeholder = guide ? "e.g. How to bleed a radiator in 5 minutes" : "e.g. How do I change a radiator valve?";
}

function closeForm() {
  els.formModal.hidden = true;
  editingId = null;
}

async function savePost(event) {
  event.preventDefault();
  const title = els.formTitle.value.trim();
  const rawLink = els.formLink.value.trim();
  const link = safeLink(rawLink);
  const problem = title.length < 5 ? "Add a title (at least 5 characters)."
    : !els.formTopic.value ? "Choose a topic."
      : rawLink && !link ? "That link doesn't look right. It should start with https://"
        : "";
  if (problem) {
    els.formMessage.textContent = problem;
    return;
  }

  els.formSubmit.disabled = true;
  els.formMessage.textContent = "Saving...";
  const data = {
    ownerId: currentUser.uid,
    kind: els.formKind.value,
    topic: els.formTopic.value,
    title,
    body: els.formBody.value.trim(),
    link,
    status: "active",
    updatedAt: serverTimestamp()
  };

  try {
    let postId = editingId;
    if (editingId) {
      await updateDoc(doc(db, "learnPosts", editingId), data);
      Object.assign(posts.find(post => post.id === editingId), data, { updatedAt: new Date() });
    } else {
      const created = await addDoc(collection(db, "learnPosts"), { ...data, createdAt: serverTimestamp() });
      postId = created.id;
      posts.unshift({ id: created.id, ...data, voteCount: 0, replyCount: 0, createdAt: new Date(), updatedAt: new Date() });
      if (!profiles.has(currentUser.uid)) profiles = new Map([...profiles, ...(await getPublicProfiles([currentUser.uid]))]);
    }
    closeForm();
    renderTabs();
    render();
    openDetail(postId);
  } catch (error) {
    console.error("Could not save post:", error);
    els.formMessage.textContent = error?.code || error instanceof TypeError
      ? "Couldn't post. Your writing is still here, so check your connection and try again."
      : error.message || "Couldn't post. Please try again.";
  } finally {
    els.formSubmit.disabled = false;
  }
}

async function saveReply(form, replyId = null) {
  const body = form.elements.body.value.trim();
  const rawLink = form.elements.link.value.trim();
  const link = safeLink(rawLink);
  if (body.length < 2) {
    setDetailMessage("Write a reply first.");
    return;
  }
  if (rawLink && !link) {
    setDetailMessage("That link doesn't look right. It should start with https://");
    return;
  }
  const button = form.querySelector("button[type=submit]");
  button.disabled = true;
  const postId = openPostId;
  try {
    if (replyId) {
      await updateDoc(doc(db, "learnPosts", postId, "replies", replyId), { ownerId: currentUser.uid, body, link, status: "active", updatedAt: serverTimestamp() });
      Object.assign(replies.find(reply => reply.id === replyId), { body, link });
      editingReplyId = null;
    } else {
      const created = await addDoc(collection(db, "learnPosts", postId, "replies"), {
        ownerId: currentUser.uid, body, link, status: "active", createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      replies.push({ id: created.id, ownerId: currentUser.uid, body, link, voteCount: 0, createdAt: new Date() });
      const post = posts.find(item => item.id === postId);
      post.replyCount = (post.replyCount || 0) + 1;
      post.lastActivityAt = new Date();
      if (!profiles.has(currentUser.uid)) profiles = new Map([...profiles, ...(await getPublicProfiles([currentUser.uid]))]);
      render();
    }
    renderDetail(false);
  } catch (error) {
    console.error("Could not save reply:", error);
    button.disabled = false;
    setDetailMessage(error?.code || error instanceof TypeError
      ? "Couldn't post your reply. It's still there, so check your connection and try again."
      : error.message || "Couldn't post your reply.");
  }
}

// ---------- Votes

async function toggleVote(button) {
  const postId = button.dataset.votePost;
  const replyId = button.dataset.voteReply;
  const item = replyId ? replies.find(reply => reply.id === replyId) : posts.find(post => post.id === postId);
  const set = replyId ? myReplyVotes : myPostVotes;
  const key = replyId || postId;
  if (!item) return;

  const voted = set.has(key);
  const voteRef = replyId
    ? doc(db, "learnPosts", postId, "replies", replyId, "votes", currentUser.uid)
    : doc(db, "learnPosts", postId, "votes", currentUser.uid);

  // Update straight away; undo if the save fails.
  const apply = (on) => {
    if (on) set.add(key); else set.delete(key);
    item.voteCount = Math.max(0, (item.voteCount || 0) + (on ? 1 : -1));
    render();
    if (openPostId) renderDetail(false);
  };
  apply(!voted);
  try {
    if (voted) await deleteDoc(voteRef);
    else await setDoc(voteRef, { createdAt: serverTimestamp() });
  } catch (error) {
    console.error("Vote failed:", error);
    apply(voted);
    setDetailMessage("Couldn't save your vote. Check your connection and try again.");
  }
}

// ---------- Actions

async function report(postId, replyId) {
  const reason = window.prompt("What's wrong with this? (for example: spam, rude, wrong or dangerous advice)");
  if (reason === null) return;
  if (reason.trim().length < 3) {
    setDetailMessage("Please say briefly what's wrong so we can check it.");
    return;
  }
  await addDoc(collection(db, "learnReports"), {
    postId, replyId: replyId || "", reporterId: currentUser.uid,
    reason: reason.trim().slice(0, 500), status: "open", createdAt: serverTimestamp()
  });
  setDetailMessage("Thanks. Our team will take a look.");
}

async function handleAction(target) {
  const data = target.dataset;
  try {
    if (data.openPost) {
      openDetail(data.openPost);
    } else if (data.votePost !== undefined) {
      await toggleVote(target);
    } else if (data.editPost) {
      openForm(undefined, posts.find(post => post.id === data.editPost));
    } else if (data.deletePost) {
      if (!window.confirm("Delete this post and hide its replies? This can't be undone.")) return;
      await deleteDoc(doc(db, "learnPosts", data.deletePost));
      posts = posts.filter(post => post.id !== data.deletePost);
      closeDetail();
      renderTabs();
      render();
    } else if (data.removePost) {
      if (!window.confirm("Take this post down?")) return;
      await updateDoc(doc(db, "learnPosts", data.removePost), { status: "removed", updatedAt: serverTimestamp() });
      posts = posts.filter(post => post.id !== data.removePost);
      closeDetail();
      renderTabs();
      render();
    } else if (data.reportPost) {
      await report(data.reportPost, "");
    } else if (data.editReply) {
      editingReplyId = data.editReply;
      renderDetail(false);
    } else if (data.cancelEditReply !== undefined) {
      editingReplyId = null;
      renderDetail(false);
    } else if (data.deleteReply || data.removeReply) {
      const replyId = data.deleteReply || data.removeReply;
      if (!window.confirm(data.deleteReply ? "Delete your reply?" : "Take this reply down?")) return;
      const ref = doc(db, "learnPosts", openPostId, "replies", replyId);
      if (data.deleteReply) await deleteDoc(ref);
      else await updateDoc(ref, { status: "removed", updatedAt: serverTimestamp() });
      replies = replies.filter(reply => reply.id !== replyId);
      const post = posts.find(item => item.id === openPostId);
      post.replyCount = Math.max(0, (post.replyCount || 0) - 1);
      render();
      renderDetail(false);
    } else if (data.reportReply) {
      await report(openPostId, data.reportReply);
    }
  } catch (error) {
    console.error("Learning Hub action failed:", error);
    setDetailMessage(friendlyError(error, "That didn't work. Please try again."));
  }
}

// ---------- Wiring

els.formTopic.innerHTML = `<option value="">Choose a topic</option>${TOPICS.map(topic =>
  `<option value="${topic.id}">${escapeHtml(topic.label)}</option>`).join("")}`;

document.addEventListener("click", event => {
  const openForm_ = event.target.closest("[data-open-post-form]");
  if (openForm_) openForm(openForm_.dataset.openPostForm);
  if (event.target.closest("[data-close-post-form]")) closeForm();
  if (event.target.closest("[data-close-post-detail]")) closeDetail();
  const action = event.target.closest("[data-open-post], [data-vote-post], [data-edit-post], [data-delete-post], [data-remove-post], [data-report-post], [data-edit-reply], [data-cancel-edit-reply], [data-delete-reply], [data-remove-reply], [data-report-reply]");
  if (action) handleAction(action);
});

document.addEventListener("submit", event => {
  if (event.target.id === "lhReplyForm") {
    event.preventDefault();
    saveReply(event.target);
  } else if (event.target.dataset.editReplyForm) {
    event.preventDefault();
    saveReply(event.target, event.target.dataset.editReplyForm);
  }
});

els.tabs.addEventListener("click", event => {
  const tab = event.target.closest("[data-topic]");
  if (!tab) return;
  activeTopic = tab.dataset.topic;
  renderTabs();
  render();
});

[els.search, els.kind, els.sort, els.mine].forEach(control => control.addEventListener("input", render));
els.formKind.addEventListener("change", syncFormLabels);
els.form.addEventListener("submit", savePost);

[els.formModal, els.detailModal].forEach(modal => modal.addEventListener("click", event => {
  if (event.target === els.formModal) closeForm();
  if (event.target === els.detailModal) closeDetail();
}));
document.addEventListener("keydown", event => {
  if (event.key !== "Escape") return;
  if (!els.formModal.hidden) closeForm();
  else if (!els.detailModal.hidden) closeDetail();
});

protectPage({
  onAllowed: (user, userData) => {
    currentUser = user;
    canModerate = isAdminUser(userData);
    loadPosts();
    const ask = new URLSearchParams(window.location.search).get("ask");
    if (ask === "question" || ask === "guide") openForm(ask);
  }
});
