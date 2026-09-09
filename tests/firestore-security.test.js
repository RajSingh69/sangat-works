const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} = require("@firebase/rules-unit-testing");
const { doc, getDoc, setDoc, updateDoc, deleteDoc } = require("firebase/firestore");

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
});

assert.ok(projectId);
