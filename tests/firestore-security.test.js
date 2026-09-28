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

  it("allows one clean review per reviewer and blocks self-review", async () => {
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const bobDb = testEnv.authenticatedContext("bob").firestore();
    const review = (reviewerId, extra = {}) => ({
      profileId: "bob",
      reviewerId,
      reviewerName: "Alice",
      serviceUsed: "Website",
      rating: 5,
      reviewText: "Great work",
      createdAt: serverTimestamp(),
      ...extra
    });

    await assertSucceeds(setDoc(doc(aliceDb, "users/bob/reviews/alice"), review("alice")));
    // Second review from the same person, or one stored under someone else's id.
    await assertFails(setDoc(doc(aliceDb, "users/bob/reviews/alice"), review("alice")));
    await assertFails(setDoc(doc(aliceDb, "users/bob/reviews/rev2"), review("alice")));
    await assertFails(setDoc(doc(aliceDb, "users/bob/reviews/charlie"), review("charlie")));
    // No private extras (like an email) and ratings stay 1-5.
    await testEnv.withSecurityRulesDisabled(context => deleteDoc(doc(context.firestore(), "users/bob/reviews/alice")));
    await assertFails(setDoc(doc(aliceDb, "users/bob/reviews/alice"), review("alice", { reviewerEmail: "alice@example.com" })));
    await assertFails(setDoc(doc(aliceDb, "users/bob/reviews/alice"), review("alice", { rating: 9 })));
    await assertFails(setDoc(doc(bobDb, "users/bob/reviews/bob"), review("bob")));
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

describe("Firestore security rules: paid signup and cancelling access", () => {
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
    await seed(testEnv, "usedSignupCheckoutSessions/cs_monthly", {
      checkoutSessionId: "cs_monthly",
      uid: "newbie",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "",
      stripePriceId: "price_monthly_pass",
      billingType: "oneoff",
      planName: "monthly"
    });
    await seed(testEnv, "projects/p1", { ownerId: "someone", title: "Test project" });
  });

  function daysFromNow(days) {
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  function paidSignupProfile(overrides = {}) {
    return {
      uid: "newbie",
      fullName: "New Member",
      displayName: "New Member",
      email: "newbie@example.com",
      role: "standard",
      internalAccount: false,
      accountType: "member",
      isAdmin: false,
      isFoundingMember: false,
      memberNumber: null,
      hasSubscription: true,
      subscriptionStatus: "active",
      subscriptionPlan: "monthly",
      subscriptionBillingType: "oneoff",
      subscriptionExpiresAt: daysFromNow(30),
      subscriptionUpdatedAt: serverTimestamp(),
      membershipPlan: "monthly",
      membershipStatus: "active",
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "",
      stripePriceId: "price_monthly_pass",
      stripeCheckoutSessionId: "cs_monthly",
      featuredListing: false,
      featuredListingStatus: "inactive",
      featuredExpiresAt: null,
      hasSeenIntro: false,
      isPublic: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
      ...overrides
    };
  }

  it("allows a genuine paid signup matching the claimed checkout session", async () => {
    const newbieDb = testEnv.authenticatedContext("newbie").firestore();
    await assertSucceeds(setDoc(doc(newbieDb, "users/newbie"), paidSignupProfile()));
  });

  it("rejects paid signups that try to grant extra privileges or a better plan", async () => {
    const newbieDb = testEnv.authenticatedContext("newbie").firestore();
    const attempts = [
      { role: "super_admin" },
      { role: "admin" },
      { isAdmin: true },
      { internalAccount: true },
      { canImpersonateUsers: true },
      { subscriptionPlan: "lifetime" },
      { stripePriceId: "price_yearly_pass" },
      { subscriptionExpiresAt: daysFromNow(365) },
      { featuredListing: true }
    ];

    for (const overrides of attempts) {
      await assertFails(setDoc(doc(newbieDb, "users/newbie"), paidSignupProfile(overrides)));
    }
  });

  it("rejects a paid signup using another user's checkout session", async () => {
    const intruderDb = testEnv.authenticatedContext("intruder").firestore();
    await assertFails(setDoc(doc(intruderDb, "users/intruder"), paidSignupProfile({ uid: "intruder" })));
  });

  it("keeps access for cancelling subscriptions until the paid period ends", async () => {
    await seed(testEnv, "users/leaving", {
      uid: "leaving",
      role: "member",
      hasSubscription: true,
      subscriptionStatus: "cancelling",
      subscriptionExpiresAt: daysFromNow(10)
    });
    await seed(testEnv, "users/gone", {
      uid: "gone",
      role: "member",
      hasSubscription: true,
      subscriptionStatus: "cancelling",
      subscriptionExpiresAt: daysFromNow(-1)
    });
    await seed(testEnv, "users/lapsed", {
      uid: "lapsed",
      role: "member",
      hasSubscription: true,
      subscriptionStatus: "past_due",
      subscriptionExpiresAt: daysFromNow(10)
    });

    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext("leaving").firestore(), "projects/p1")));
    await assertFails(getDoc(doc(testEnv.authenticatedContext("gone").firestore(), "projects/p1")));
    await assertFails(getDoc(doc(testEnv.authenticatedContext("lapsed").firestore(), "projects/p1")));
  });
});

describe("Firestore security rules: private user records vs public profiles", () => {
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
    const member = {
      role: "member",
      hasSubscription: true,
      subscriptionStatus: "active",
      subscriptionExpiresAt: new Date("2099-01-01T00:00:00Z")
    };
    await seed(testEnv, "users/alice", { uid: "alice", ...member, stripeCustomerId: "cus_secret", phone: "07000" });
    await seed(testEnv, "users/bob", { uid: "bob", ...member });
    await seed(testEnv, "users/boss", { uid: "boss", role: "admin" });
    await seed(testEnv, "publicProfiles/alice", { uid: "alice", fullName: "Alice", isPublic: true });
  });

  it("only lets the owner and admins read a full user record", async () => {
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext("alice").firestore(), "users/alice")));
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext("boss").firestore(), "users/alice")));
    await assertFails(getDoc(doc(testEnv.authenticatedContext("bob").firestore(), "users/alice")));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "users/alice")));
  });

  it("only lets super admins hide profiles, and members can't un-hide themselves", async () => {
    await seed(testEnv, "users/owner", { uid: "owner", role: "super_admin" });
    await seed(testEnv, "users/carol", { uid: "carol", role: "member", hasSubscription: true, subscriptionStatus: "active", adminHidden: true });

    await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext("owner").firestore(), "users/alice"), { adminHidden: true }));
    await assertFails(updateDoc(doc(testEnv.authenticatedContext("boss").firestore(), "users/bob"), { adminHidden: true }));
    await assertFails(updateDoc(doc(testEnv.authenticatedContext("bob").firestore(), "users/alice"), { adminHidden: false }));
    await assertFails(updateDoc(doc(testEnv.authenticatedContext("carol").firestore(), "users/carol"), { adminHidden: false }));
  });

  it("only lets admins list full user records", async () => {
    const { collection, getDocs } = require("firebase/firestore");
    await assertSucceeds(getDocs(collection(testEnv.authenticatedContext("boss").firestore(), "users")));
    await assertFails(getDocs(collection(testEnv.authenticatedContext("bob").firestore(), "users")));
  });

  it("lets anyone view a public profile, members list them, and nobody write them", async () => {
    const { collection, getDocs } = require("firebase/firestore");
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "publicProfiles/alice")));
    await assertSucceeds(getDocs(collection(testEnv.authenticatedContext("bob").firestore(), "publicProfiles")));
    await assertFails(getDocs(collection(testEnv.unauthenticatedContext().firestore(), "publicProfiles")));
    await assertFails(setDoc(doc(testEnv.authenticatedContext("alice").firestore(), "publicProfiles/alice"), { uid: "alice", fullName: "Hacked" }));
    await assertFails(setDoc(doc(testEnv.authenticatedContext("bob").firestore(), "publicProfiles/bob"), { uid: "bob" }));
  });
});

describe("buildPublicProfile", () => {
  const { buildPublicProfile } = require("../functions/public-profile");

  const fullRecord = {
    uid: "alice",
    fullName: "Alice",
    businessName: "Alice Plumbing",
    town: "Leicester",
    isPublic: true,
    role: "member",
    hasSubscription: true,
    subscriptionStatus: "active",
    phone: "07000 000000",
    email: "alice@example.com",
    postcode: "LE1 1AA",
    gurdwaraName: "Guru Nanak Gurdwara",
    showPhone: false,
    showEmail: true,
    showPostcode: false,
    showGurdwara: false,
    stripeCustomerId: "cus_secret",
    stripeSubscriptionId: "sub_secret",
    adminNotes: "internal note",
    canImpersonateUsers: true,
    banned: false
  };

  it("keeps public fields and applies the member's privacy toggles", () => {
    const profile = buildPublicProfile("alice", fullRecord);
    assert.strictEqual(profile.fullName, "Alice");
    assert.strictEqual(profile.businessName, "Alice Plumbing");
    assert.strictEqual(profile.subscriptionStatus, "active");
    assert.strictEqual(profile.email, "alice@example.com");
    assert.strictEqual(profile.phone, undefined);
    assert.strictEqual(profile.postcode, undefined);
    assert.strictEqual(profile.gurdwaraName, undefined);
  });

  it("never copies private or internal fields", () => {
    const profile = buildPublicProfile("alice", fullRecord);
    ["stripeCustomerId", "stripeSubscriptionId", "adminNotes", "canImpersonateUsers", "banned"].forEach(field => {
      assert.strictEqual(profile[field], undefined, `${field} leaked`);
    });
  });

  it("publishes admin-hidden profiles as private, and restores them when un-hidden", () => {
    const hidden = buildPublicProfile("alice", { ...fullRecord, adminHidden: true });
    assert.strictEqual(hidden.isPublic, false);
    assert.strictEqual(hidden.fullName, undefined);
    assert.strictEqual(hidden.email, undefined);
    assert.strictEqual(hidden.subscriptionStatus, "active");

    const shown = buildPublicProfile("alice", { ...fullRecord, adminHidden: false });
    assert.strictEqual(shown.isPublic, true);
    assert.strictEqual(shown.fullName, "Alice");
  });

  it("treats a never-saved public setting as public", () => {
    const { isPublic, ...neverSaved } = fullRecord;
    const profile = buildPublicProfile("alice", neverSaved);
    assert.strictEqual(isPublic, true);
    assert.strictEqual(profile.isPublic, true);
    assert.strictEqual(profile.fullName, "Alice");
  });

  it("only exposes membership status for private profiles", () => {
    const profile = buildPublicProfile("alice", { ...fullRecord, isPublic: false, showPhone: true });
    assert.strictEqual(profile.isPublic, false);
    assert.strictEqual(profile.subscriptionStatus, "active");
    assert.strictEqual(profile.fullName, undefined);
    assert.strictEqual(profile.phone, undefined);
    assert.strictEqual(profile.email, undefined);
  });
});

describe("Ranking inputs in public profiles", () => {
  const { buildPublicProfile, calculateProfileCompletion, summariseActivity } = require("../functions/public-profile");

  it("publishes completion, activity summary, pin and join date but not the raw sign-in days", () => {
    const today = new Date().toISOString().slice(0, 10);
    const profile = buildPublicProfile("alice", {
      fullName: "Alice",
      serviceTitle: "Plumber",
      pinnedToTop: true,
      cardPhoto: { x: 40, y: 25, zoom: 1.4 },
      createdAt: new Date("2026-06-01T00:00:00Z"),
      activeDays: ["2020-01-01", today],
      lastActiveAt: new Date()
    });
    assert.strictEqual(profile.profileCompletion, 17);
    assert.strictEqual(profile.activeDaysLast30, 1);
    assert.strictEqual(profile.lastActiveOn, today);
    assert.strictEqual(profile.pinnedToTop, true);
    assert.deepStrictEqual(profile.cardPhoto, { x: 40, y: 25, zoom: 1.4 });
    assert.ok(profile.createdAt);
    assert.strictEqual(profile.activeDays, undefined);
    assert.strictEqual(profile.lastActiveAt, undefined);
  });

  it("scores a fully completed profile at 100%", () => {
    assert.strictEqual(calculateProfileCompletion({
      profilePhotoUrl: "x", businessLogoUrl: "x", businessName: "x", serviceTitle: "x", description: "x",
      tags: ["x"], town: "x", yearsExperience: "2", specialistWork: "x", associatedGurdwara: "x",
      website: "x", funFactOne: "x", funFactTwo: "x"
    }), 100);
    assert.deepStrictEqual(summariseActivity(undefined), { activeDaysLast30: 0, lastActiveOn: null });
  });
});

describe("Ranking score and order (js/ranking.js)", () => {
  let ranking;
  const now = new Date("2026-10-01T12:00:00Z");
  const future = new Date("2027-06-01T00:00:00Z");
  const member = (overrides = {}) => ({
    isPublic: true, hasSubscription: true, subscriptionStatus: "active", subscriptionExpiresAt: future,
    subscriptionBillingType: "founding-free-year", profileCompletion: 0, ...overrides
  });

  before(async () => {
    const os = require("os");
    const { pathToFileURL } = require("url");
    const tmp = path.join(os.tmpdir(), `ranking-${process.pid}.mjs`);
    fs.copyFileSync(path.join(__dirname, "..", "js", "ranking.js"), tmp);
    ranking = await import(pathToFileURL(tmp).href);
  });

  it("gives paid members more than free members, and featured paid members the most", () => {
    const free = ranking.getRankingScore(member(), now);
    const paid = ranking.getRankingScore(member({ subscriptionBillingType: "subscription" }), now);
    const featured = ranking.getRankingScore(member({
      subscriptionBillingType: "subscription", featuredListing: true, featuredListingStatus: "active", featuredExpiresAt: future
    }), now);
    assert.strictEqual(free, 5);
    assert.strictEqual(paid, 20);
    assert.strictEqual(featured, 45);
  });

  it("adds profile, activity and verification points up to 100", () => {
    const perfect = member({
      subscriptionBillingType: "oneoff", featuredListing: true, featuredListingStatus: "active", featuredExpiresAt: future,
      profileCompletion: 100, activeDaysLast30: 25, lastActiveOn: "2026-10-01",
      emailVerifiedBadge: true, businessVerified: true, communityVerified: true, gurdwaraVerified: true
    });
    const breakdown = ranking.getRankingBreakdown(perfect, now);
    assert.strictEqual(breakdown.total, 100);
    assert.deepStrictEqual(breakdown.tips, []);
  });

  it("stops counting activity once a member has been away over 30 days", () => {
    const away = member({ activeDaysLast30: 20, lastActiveOn: "2026-08-01" });
    assert.strictEqual(ranking.getRankingBreakdown(away, now).parts.activity, 0);
  });

  it("orders pinned first, then by score, then newest", () => {
    const low = { ...member(), id: "low" };
    const high = { ...member({ subscriptionBillingType: "subscription", profileCompletion: 100 }), id: "high" };
    const pinned = { ...member(), id: "pinned", pinnedToTop: true };
    const sorted = [low, high, pinned].sort((a, b) => ranking.compareByRanking(a, b, now)).map(p => p.id);
    assert.deepStrictEqual(sorted, ["pinned", "high", "low"]);
  });

  it("suggests the biggest improvements first", () => {
    const tips = ranking.getRankingBreakdown(member(), now).tips;
    assert.strictEqual(tips[0].text, "Become a Featured Listing");
    assert.ok(tips.some(tip => tip.text.startsWith("Complete your profile")));
  });
});

describe("Firestore security rules: Shaheed Parivars messages", () => {
  let testEnv;
  const { writeBatch, collection, getDocs, query, where } = require("firebase/firestore");

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8") }
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  beforeEach(async () => {
    await testEnv.clearFirestore();
    await seed(testEnv, "users/boss", { uid: "boss", role: "admin" });
    await seed(testEnv, "users/bob", { uid: "bob", role: "member", hasSubscription: true, subscriptionStatus: "active" });
  });

  function submit(db, id, overrides = {}, email = "visitor@example.com") {
    const batch = writeBatch(db);
    batch.set(doc(db, `parivarMessages/${id}`), {
      name: "Visitor",
      message: "Thank you for your sacrifice.",
      videoPath: "",
      status: "pending",
      createdAt: serverTimestamp(),
      ...overrides
    });
    batch.set(doc(db, `parivarMessageContacts/${id}`), { email, createdAt: serverTimestamp() });
    return batch.commit();
  }

  it("lets anyone (even logged out) submit a pending message with their email kept private", async () => {
    const visitorDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(submit(visitorDb, "m1", { videoPath: "parivarVideos/m1/video.mp4" }));

    await assertFails(getDoc(doc(visitorDb, "parivarMessages/m1")));
    await assertFails(getDoc(doc(visitorDb, "parivarMessageContacts/m1")));
    await assertFails(getDoc(doc(testEnv.authenticatedContext("bob").firestore(), "parivarMessageContacts/m1")));
    await assertSucceeds(getDoc(doc(testEnv.authenticatedContext("boss").firestore(), "parivarMessageContacts/m1")));
  });

  it("rejects self-approved, oversized, extra-field or wrongly pathed submissions", async () => {
    const visitorDb = testEnv.unauthenticatedContext().firestore();
    await assertFails(submit(visitorDb, "a", { status: "approved" }));
    await assertFails(submit(visitorDb, "b", { message: "x".repeat(1001) }));
    await assertFails(submit(visitorDb, "c", { featured: true }));
    await assertFails(submit(visitorDb, "d", { videoPath: "parivarVideos/other/video.mp4" }));
    await assertFails(submit(visitorDb, "e", {}, "not-an-email"));
  });

  it("only shows approved messages publicly, and only admins can approve", async () => {
    const visitorDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(submit(visitorDb, "m2"));
    await assertFails(updateDoc(doc(testEnv.authenticatedContext("bob").firestore(), "parivarMessages/m2"), { status: "approved" }));
    await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext("boss").firestore(), "parivarMessages/m2"), { status: "approved", reviewedAt: serverTimestamp(), reviewedBy: "boss" }));

    await assertSucceeds(getDoc(doc(visitorDb, "parivarMessages/m2")));
    await assertSucceeds(getDocs(query(collection(visitorDb, "parivarMessages"), where("status", "==", "approved"))));
    await assertFails(getDocs(collection(visitorDb, "parivarMessages")));
  });

  it("doesn't let anyone add or change a contact email after the message exists", async () => {
    const visitorDb = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(submit(visitorDb, "m3"));
    await assertFails(setDoc(doc(visitorDb, "parivarMessageContacts/m3"), { email: "other@example.com", createdAt: serverTimestamp() }));
  });
});

describe("Homepage totals (functions/site-stats-core.js)", () => {
  const core = require("../functions/site-stats-core");

  it("uses the same industry groups as the website", async () => {
    const site = await import("../js/industries.js");
    assert.deepStrictEqual(
      core.INDUSTRY_BUCKETS.map(bucket => [bucket.name, bucket.keywords]),
      site.INDUSTRY_BUCKETS.map(bucket => [bucket.name, bucket.keywords])
    );
    const samples = ["Software Developer", "Community Charity Seva", "Maintenance and repairs", "IT Support", "Mortgage Advisor", "Wedding Photographer"];
    samples.forEach(serviceTitle => {
      assert.strictEqual(core.getIndustryBucket({ serviceTitle }), site.getIndustryBucket({ serviceTitle }), serviceTitle);
    });
  });

  it("counts listed members, industries and locations without exposing anyone", () => {
    const active = { hasSubscription: true, subscriptionStatus: "active" };
    const stats = core.summariseSiteStats([
      { ...active, serviceTitle: "Web Developer", town: "Leicester" },
      { ...active, serviceTitle: "Electrician", town: "leicester " },
      { ...active, serviceTitle: "Accountant", serviceArea: "London" },
      { hasSubscription: false, serviceTitle: "Plumber", town: "Derby" },
      { role: "super_admin", serviceTitle: "Something else" }
    ], [{ closingDate: "" }, { closingDate: "2026-12-01" }], 2);

    assert.deepStrictEqual(stats, {
      members: 4,
      industries: 3,
      industryCounts: { Technology: 1, Trades: 1, "Law & Professional Services": 1, Other: 1 },
      locations: 2,
      openOpportunityClosingDates: ["", "2026-12-01"],
      openProjects: 2
    });
  });
});

describe("Firestore security rules: ranking fields are admin/server only", () => {
  let testEnv;

  before(async () => {
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: { rules: fs.readFileSync(path.join(__dirname, "..", "firestore.rules"), "utf8") }
    });
  });

  after(async () => {
    await testEnv.cleanup();
  });

  it("stops members pinning themselves or faking sign-in days", async () => {
    await testEnv.clearFirestore();
    await seed(testEnv, "users/alice", { uid: "alice", role: "member", hasSubscription: true, subscriptionStatus: "active" });
    await seed(testEnv, "users/owner", { uid: "owner", role: "super_admin" });
    const aliceDb = testEnv.authenticatedContext("alice").firestore();

    await assertFails(updateDoc(doc(aliceDb, "users/alice"), { pinnedToTop: true }));
    await assertFails(updateDoc(doc(aliceDb, "users/alice"), { activeDays: ["2026-10-01"] }));
    await assertFails(updateDoc(doc(aliceDb, "users/alice"), { cardPhoto: { x: 50, y: 20, zoom: 1.5 } }));
    await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext("owner").firestore(), "users/alice"), { cardPhoto: { x: 50, y: 20, zoom: 1.5 } }));
    await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext("owner").firestore(), "users/alice"), { pinnedToTop: true }));
  });

  it("lets members post opportunities, and only the poster or an admin change them", async () => {
    await testEnv.clearFirestore();
    const member = uid => ({ uid, role: "member", hasSubscription: true, subscriptionStatus: "active" });
    await seed(testEnv, "users/alice", member("alice"));
    await seed(testEnv, "users/bob", member("bob"));
    await seed(testEnv, "users/lapsed", { uid: "lapsed", role: "member", hasSubscription: false });
    await seed(testEnv, "users/mod", { uid: "mod", role: "admin" });
    const post = (ownerId, extra = {}) => ({
      ownerId, type: "job", title: "Junior developer", industry: "Technology",
      description: "Two days a week helping on our booking app.", location: "Birmingham", remote: false,
      pay: "", closingDate: "", applyLink: "", status: "open",
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), ...extra
    });
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const bobDb = testEnv.authenticatedContext("bob").firestore();

    await assertSucceeds(setDoc(doc(aliceDb, "opportunities/o1"), post("alice")));
    await assertFails(setDoc(doc(aliceDb, "opportunities/o2"), post("bob")));
    await assertFails(setDoc(doc(aliceDb, "opportunities/o3"), post("alice", { type: "spam" })));
    await assertFails(setDoc(doc(aliceDb, "opportunities/o4"), post("alice", { applyLink: "javascript:alert(1)" })));
    await assertFails(setDoc(doc(aliceDb, "opportunities/o5"), post("alice", { status: "closed" })));
    await assertFails(setDoc(doc(testEnv.authenticatedContext("lapsed").firestore(), "opportunities/o6"), post("lapsed")));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "opportunities/o1")));
    await assertSucceeds(getDoc(doc(bobDb, "opportunities/o1")));

    await assertFails(updateDoc(doc(bobDb, "opportunities/o1"), { status: "closed", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(aliceDb, "opportunities/o1"), { title: "Junior web developer", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(aliceDb, "opportunities/o1"), { ownerId: "bob", updatedAt: serverTimestamp() }));
    const modDb = testEnv.authenticatedContext("mod").firestore();
    await assertFails(updateDoc(doc(modDb, "opportunities/o1"), { title: "Changed by admin", updatedAt: serverTimestamp() }));
    await assertSucceeds(updateDoc(doc(modDb, "opportunities/o1"), { status: "closed", updatedAt: serverTimestamp() }));
    await assertFails(deleteDoc(doc(bobDb, "opportunities/o1")));
    await assertSucceeds(deleteDoc(doc(aliceDb, "opportunities/o1")));

    // Featuring is paid for through Stripe: members can't set it themselves...
    const { Timestamp } = require("firebase/firestore");
    const soon = Timestamp.fromMillis(Date.now() + 86400000);
    await assertFails(setDoc(doc(aliceDb, "opportunities/o7"), post("alice", { featuredUntil: soon })));
    await assertSucceeds(setDoc(doc(aliceDb, "opportunities/o8"), post("alice")));
    await assertFails(updateDoc(doc(aliceDb, "opportunities/o8"), { featuredUntil: soon, updatedAt: serverTimestamp() }));
    // ...but can still edit a post the webhook has featured, without changing that.
    await testEnv.withSecurityRulesDisabled(context => updateDoc(doc(context.firestore(), "opportunities/o8"), { featuredUntil: soon, featuredSessionId: "cs_test" }));
    await assertSucceeds(updateDoc(doc(aliceDb, "opportunities/o8"), { title: "Junior developer (featured)", updatedAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(aliceDb, "opportunities/o8"), { featuredUntil: Timestamp.fromMillis(Date.now() + 90 * 86400000), updatedAt: serverTimestamp() }));
  });

  it("shows only approved employer jobs to members and keeps employer contacts private", async () => {
    await testEnv.clearFirestore();
    await seed(testEnv, "users/alice", { uid: "alice", role: "member", hasSubscription: true, subscriptionStatus: "active" });
    await seed(testEnv, "users/mod", { uid: "mod", role: "admin" });
    await seed(testEnv, "employerJobs/live1", { title: "Accountant", status: "live" });
    await seed(testEnv, "employerJobs/review1", { title: "Pending", status: "pending_review" });
    await seed(testEnv, "employerJobContacts/review1", { contactEmail: "boss@example.com" });
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const modDb = testEnv.authenticatedContext("mod").firestore();
    const { collection, query, where, getDocs } = require("firebase/firestore");

    await assertSucceeds(getDoc(doc(aliceDb, "employerJobs/live1")));
    await assertFails(getDoc(doc(aliceDb, "employerJobs/review1")));
    await assertSucceeds(getDocs(query(collection(aliceDb, "employerJobs"), where("status", "==", "live"))));
    await assertFails(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "employerJobs/live1")));
    await assertFails(getDoc(doc(aliceDb, "employerJobContacts/review1")));
    await assertFails(setDoc(doc(aliceDb, "employerJobs/fake"), { title: "Free post", status: "live" }));
    await assertFails(updateDoc(doc(aliceDb, "employerJobs/review1"), { status: "live" }));

    await assertSucceeds(getDoc(doc(modDb, "employerJobContacts/review1")));
    await assertSucceeds(updateDoc(doc(modDb, "employerJobs/review1"), { status: "live", reviewedBy: "mod" }));
    await assertFails(updateDoc(doc(modDb, "employerJobs/review1"), { title: "Edited by admin" }));
  });

  it("validates employer job posts before payment", () => {
    const { validateEmployerJob } = require("../functions/employer-jobs");
    const good = {
      companyName: "Kaur Accounts", title: "Junior Accountant", industry: "Law & Professional Services",
      location: "Leicester", description: "Supporting clients with bookkeeping and year-end accounts.",
      applyLink: "kauraccounts.co.uk/jobs", contactName: "Harpreet", contactEmail: "HR@KaurAccounts.co.uk"
    };
    const { job, contact } = validateEmployerJob(good);
    assert.strictEqual(job.applyLink, "https://kauraccounts.co.uk/jobs");
    assert.strictEqual(contact.contactEmail, "hr@kauraccounts.co.uk");
    assert.throws(() => validateEmployerJob({ ...good, industry: "Spam" }), /industry/);
    assert.throws(() => validateEmployerJob({ ...good, applyLink: "", applyEmail: "" }), /applications/);
    assert.throws(() => validateEmployerJob({ ...good, contactEmail: "nope" }), /contact email/);
    assert.throws(() => validateEmployerJob({ ...good, location: "", remote: false }), /location/);
  });

  it("keeps business verification in the hands of the super admin", async () => {
    await testEnv.clearFirestore();
    await seed(testEnv, "users/alice", { uid: "alice", role: "member", hasSubscription: true, subscriptionStatus: "active" });
    await seed(testEnv, "users/owner", { uid: "owner", role: "super_admin" });
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    await assertFails(updateDoc(doc(aliceDb, "users/alice"), { businessVerified: true }));
    await assertFails(updateDoc(doc(aliceDb, "users/alice"), { verificationRequest: { status: "pending" } }));
    await assertSucceeds(updateDoc(doc(testEnv.authenticatedContext("owner").firestore(), "users/alice"), {
      businessVerified: true, "verificationRequest.status": "approved"
    }));
  });

  it("keeps email addresses out of Young Professional profiles", async () => {
    await testEnv.clearFirestore();
    await seed(testEnv, "users/alice", { uid: "alice", role: "member", hasSubscription: true, subscriptionStatus: "active" });
    const aliceDb = testEnv.authenticatedContext("alice").firestore();
    const profile = { uid: "alice", fullName: "Alice", industry: "Law" };

    await assertFails(setDoc(doc(aliceDb, "youngProfessionals/alice"), { ...profile, email: "alice@example.com" }));
    await assertSucceeds(setDoc(doc(aliceDb, "youngProfessionals/alice"), profile));
    await assertFails(setDoc(doc(aliceDb, "youngProfessionals/bob"), { ...profile, uid: "bob" }));
  });

  it("lets anyone read the homepage totals but nobody write them", async () => {
    await testEnv.clearFirestore();
    await seed(testEnv, "siteStats/public", { members: 3 });
    await seed(testEnv, "users/owner", { uid: "owner", role: "super_admin" });
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "siteStats/public")));
    await assertFails(setDoc(doc(testEnv.authenticatedContext("owner").firestore(), "siteStats/public"), { members: 9999 }));
  });

  it("lets only the super admin frame the site's own pictures", async () => {
    await testEnv.clearFirestore();
    await seed(testEnv, "users/alice", { uid: "alice", role: "admin" });
    await seed(testEnv, "users/owner", { uid: "owner", role: "super_admin" });
    const framing = uid => ({ x: 40, y: 25, zoom: 1.4, updatedAt: serverTimestamp(), updatedBy: uid });
    const ownerDb = testEnv.authenticatedContext("owner").firestore();

    await assertFails(setDoc(doc(testEnv.authenticatedContext("alice").firestore(), "siteImages/founder-rajan"), framing("alice")));
    await assertFails(setDoc(doc(testEnv.unauthenticatedContext().firestore(), "siteImages/founder-rajan"), framing("nobody")));
    await assertFails(setDoc(doc(ownerDb, "siteImages/founder-rajan"), { ...framing("owner"), zoom: 9 }));
    await assertFails(setDoc(doc(ownerDb, "siteImages/founder-rajan"), { ...framing("owner"), note: "extra" }));
    await assertSucceeds(setDoc(doc(ownerDb, "siteImages/founder-rajan"), framing("owner")));
    await assertSucceeds(getDoc(doc(testEnv.unauthenticatedContext().firestore(), "siteImages/founder-rajan")));
  });
});

assert.ok(projectId);


