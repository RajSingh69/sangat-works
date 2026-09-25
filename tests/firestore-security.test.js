const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } = require("firebase/firestore");

const projectId = "sangat-works-security-test";

async function seed(testEnv, refPath, data) {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), refPath), data);
  });
}

describe("Firestore security rules: networking and messaging", () => {
  let testEnv;

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: {
        rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8")
      }
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seed(testEnv, "users/alice", {
      uid: "alice",
      role: "member",
      hasSubscription: true,
      subscriptionStatus: "active",
      subscriptionExpiresAt: new Date("2099-01-01T00:00:00Z")
    });
    await seed(testEnv, "users/bob", {
      uid: "bob",
      role: "member",
      hasSubscription: true,
      subscriptionStatus: "active",
      subscriptionExpiresAt: new Date("2099-01-01T00:00:00Z")
    });
  });

  it("allows participants to read a connection but rejects direct client writes", async () => {
    await seed(testEnv, "connections/alice__bob", {
      userIds: ["alice", "bob"],
      requesterId: "alice",
      recipientId: "bob",
      status: "pending"
    });

    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(doc(aliceDb, "connections/alice__bob")));
    await assertFails(setDoc(doc(aliceDb, "connections/alice__charlie"), { userIds: ["alice", "charlie"] }));
    await assertFails(updateDoc(doc(aliceDb, "connections/alice__bob"), { status: "accepted" }));
  });

  it("rejects direct client conversation and message writes", async () => {
    await seed(testEnv, "conversations/alice__bob", {
      participantIds: ["alice", "bob"],
      status: "active",
      type: "direct",
      updatedAt: new Date("2026-01-01T00:00:00Z")
    });

    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(doc(aliceDb, "conversations/alice__bob")));
    await assertFails(updateDoc(doc(aliceDb, "conversations/alice__bob"), { "mutedBy.alice": true }));
    await assertFails(setDoc(doc(aliceDb, "conversations/alice__bob/messages/msg1"), {
      conversationId: "alice__bob",
      senderId: "alice",
      text: "hello"
    }));
  });

  it("rejects direct client report and block writes", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(aliceDb, "blocks/alice__bob"), { blockerId: "alice", blockedId: "bob" }));
    await assertFails(setDoc(doc(aliceDb, "reports/report1"), { reporterId: "alice", reportedUserId: "bob", status: "open" }));
  });

  it("keeps notification creation server-only while allowing owners to mark read", async () => {
    await seed(testEnv, "notifications/n1", { userId: "alice", read: false });

    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(aliceDb, "notifications/n2"), { userId: "alice", read: false }));
    await assertSucceeds(updateDoc(doc(aliceDb, "notifications/n1"), { read: true }));
  });

  it("allows safe self profile updates while denying privilege escalation and other-user edits", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const bobDb = testEnv.authenticatedContext("bob").firestore();

    await assertSucceeds(updateDoc(doc(aliceDb, "users/alice"), {
      fullName: "Alice Updated",
      profilePhotoUrl: "https://example.com/alice.jpg",
      projectsUserType: "homeowner"
    }));

    await assertFails(updateDoc(doc(aliceDb, "users/alice"), { role: "super_admin" }));
    await assertFails(updateDoc(doc(aliceDb, "users/alice"), { stripeCustomerId: "cus_fake" }));
    await assertFails(updateDoc(doc(bobDb, "users/alice"), { fullName: "Owned" }));
  });

  it("binds reviews to the authenticated reviewer and blocks self-review", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const bobDb = testEnv.authenticatedContext("bob").firestore();

    await assertSucceeds(setDoc(doc(aliceDb, "users/bob/reviews/rev1"), {
      profileId: "bob",
      reviewerId: "alice",
      reviewerName: "Alice",
      rating: 5,
      reviewText: "Great work",
      createdAt: serverTimestamp()
    }));

    await assertFails(setDoc(doc(aliceDb, "users/bob/reviews/rev2"), {
      profileId: "bob",
      reviewerId: "charlie",
      rating: 5,
      createdAt: serverTimestamp()
    }));

    await assertFails(setDoc(doc(bobDb, "users/bob/reviews/rev3"), {
      profileId: "bob",
      reviewerId: "bob",
      rating: 5,
      createdAt: serverTimestamp()
    }));
  });

  it("accepts active founding access and rejects expired founding access", async () => {
    await seed(testEnv, "users/founder", {
      uid: "founder",
      role: "member",
      isFoundingMember: true,
      subscriptionPlan: "founding",
      subscriptionBillingType: "founding-free-year",
      subscriptionExpiresAt: new Date("2099-01-01T00:00:00Z")
    });
    await seed(testEnv, "users/expiredFounder", {
      uid: "expiredFounder",
      role: "member",
      isFoundingMember: true,
      subscriptionPlan: "founding",
      subscriptionBillingType: "founding-free-year",
      subscriptionExpiresAt: new Date("2020-01-01T00:00:00Z")
    });

    const founderDb = testEnv.authenticatedContext("founder").firestore();
    const expiredDb = testEnv.authenticatedContext("expiredFounder").firestore();
    await assertSucceeds(getDoc(doc(founderDb, "projects/project1")));
    await assertFails(getDoc(doc(expiredDb, "projects/project1")));
  });

  it("allows unlocked workspace access for owner/team and denies unrelated members", async () => {
    await seed(testEnv, "projects/workspaceProject", {
      ownerId: "alice",
      workspaceUnlocked: true,
      workspacePaymentStatus: "paid"
    });
    await seed(testEnv, "projectTeams/workspaceProject__bob", {
      projectId: "workspaceProject",
      projectOwnerId: "alice",
      memberId: "bob",
      status: "active"
    });
    await seed(testEnv, "users/charlie", {
      uid: "charlie",
      role: "member",
      hasSubscription: true,
      subscriptionStatus: "active",
      subscriptionExpiresAt: new Date("2099-01-01T00:00:00Z")
    });
    await seed(testEnv, "workspaceTasks/task1", {
      projectId: "workspaceProject",
      createdBy: "alice",
      createdAt: new Date("2026-01-01T00:00:00Z")
    });

    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const bobDb = testEnv.authenticatedContext("bob").firestore();
    const charlieDb = testEnv.authenticatedContext("charlie").firestore();

    await assertSucceeds(getDoc(doc(aliceDb, "workspaceTasks/task1")));
    await assertSucceeds(getDoc(doc(bobDb, "workspaceTasks/task1")));
    await assertFails(getDoc(doc(charlieDb, "workspaceTasks/task1")));
  });
});

assert.ok(projectId);


