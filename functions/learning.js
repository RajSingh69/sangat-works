// Learning Hub counters (learning.html). Upvotes are one doc per voter
// (learnPosts/{postId}/votes/{uid}), and these triggers recount them so the
// numbers shown can't be edited from the browser.
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { FieldValue } = require("firebase-admin/firestore");
const { admin } = require("./shared");

const OPTIONS = { region: "europe-west1", maxInstances: 5 };

// Updates a post or reply only if it still exists (it may have just been deleted).
async function setIfExists(ref, data) {
  try {
    await ref.update(data);
  } catch (error) {
    if (error.code !== 5) throw error; // 5 = NOT_FOUND
  }
}

async function recountVotes(parentRef) {
  const snap = await parentRef.collection("votes").count().get();
  await setIfExists(parentRef, { voteCount: snap.data().count });
}

exports.countLearnPostVotes = onDocumentWritten(
  { ...OPTIONS, document: "learnPosts/{postId}/votes/{voterId}" },
  async (event) => {
    await recountVotes(admin.firestore().collection("learnPosts").doc(event.params.postId));
  }
);

exports.countLearnReplyVotes = onDocumentWritten(
  { ...OPTIONS, document: "learnPosts/{postId}/replies/{replyId}/votes/{voterId}" },
  async (event) => {
    const { postId, replyId } = event.params;
    await recountVotes(admin.firestore().collection("learnPosts").doc(postId).collection("replies").doc(replyId));
  }
);

exports.countLearnReplies = onDocumentWritten(
  { ...OPTIONS, document: "learnPosts/{postId}/replies/{replyId}" },
  async (event) => {
    const postRef = admin.firestore().collection("learnPosts").doc(event.params.postId);
    const snap = await postRef.collection("replies").where("status", "==", "active").count().get();
    const update = { replyCount: snap.data().count };
    // A new reply bumps the post up the "Active" sort.
    if (!event.data?.before?.exists && event.data?.after?.exists) update.lastActivityAt = FieldValue.serverTimestamp();
    await setIfExists(postRef, update);
  }
);
