// Paid job posts from employers who aren't members (post-a-job.html).
// 1. createEmployerJobCheckout validates the job, saves it as "awaiting_payment"
//    (contact details kept separately in employerJobContacts, admin-only) and
//    opens a Stripe Checkout.
// 2. The Stripe webhook calls handleEmployerJobPayment, which moves it to
//    "pending_review".
// 3. An admin approves it in the Admin panel (status "live" for 30 days) or
//    rejects it (and refunds in Stripe). Members see live posts on Opportunities.
const { FieldValue } = require("firebase-admin/firestore");
const { Stripe, admin, isValidEmail, onRequest, stripeSecret } = require("./shared");
const { INDUSTRY_BUCKETS } = require("./site-stats-core");

// Stripe price ID (live, one-off). Leave blank until the product exists.
const EMPLOYER_JOB_PRICE_ID = "";

const SITE_URL = "https://sangatworks.co.uk";
const INDUSTRIES = new Set([...INDUSTRY_BUCKETS.map(bucket => bucket.name), "Other"]);

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

function text(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

function httpsLink(value) {
  const raw = text(value, 300);
  if (!raw) return "";
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch (error) {
    return "";
  }
}

// Exported for tests.
function validateEmployerJob(body) {
  const job = {
    companyName: text(body.companyName, 120),
    title: text(body.title, 120),
    industry: text(body.industry, 60),
    location: text(body.location, 80),
    remote: body.remote === true,
    pay: text(body.pay, 80),
    description: text(body.description, 3000),
    closingDate: /^\d{4}-\d{2}-\d{2}$/.test(String(body.closingDate || "")) ? body.closingDate : "",
    applyLink: httpsLink(body.applyLink),
    applyEmail: text(body.applyEmail, 200).toLowerCase()
  };
  const contact = {
    contactName: text(body.contactName, 120),
    contactEmail: text(body.contactEmail, 200).toLowerCase(),
    contactPhone: text(body.contactPhone, 40)
  };

  if (!job.companyName) throw httpError(400, "Add your company name.");
  if (job.title.length < 3) throw httpError(400, "Add a job title.");
  if (!INDUSTRIES.has(job.industry)) throw httpError(400, "Choose an industry.");
  if (!job.location && !job.remote) throw httpError(400, "Add a location, or tick remote.");
  if (job.description.length < 30) throw httpError(400, "Describe the job in a bit more detail.");
  if (body.applyLink && !job.applyLink) throw httpError(400, "That application link doesn't look right.");
  if (job.applyEmail && !isValidEmail(job.applyEmail)) throw httpError(400, "That application email doesn't look right.");
  if (!job.applyLink && !job.applyEmail) throw httpError(400, "Add a link or email for applications.");
  if (!contact.contactName) throw httpError(400, "Add your name.");
  if (!isValidEmail(contact.contactEmail)) throw httpError(400, "Add a valid contact email.");

  return { job, contact };
}

exports.createEmployerJobCheckout = onRequest(
  { region: "europe-west1", cors: true, secrets: [stripeSecret], maxInstances: 5 },
  async (req, res) => {
    res.set("Access-Control-Allow-Origin", SITE_URL);
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).send("");
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    try {
      if (!EMPLOYER_JOB_PRICE_ID) throw httpError(503, "Job posting isn't open yet. Please check back soon.");
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const { job, contact } = validateEmployerJob(body);

      const db = admin.firestore();
      const jobRef = db.collection("employerJobs").doc();
      const batch = db.batch();
      batch.set(jobRef, { ...job, status: "awaiting_payment", createdAt: FieldValue.serverTimestamp() });
      batch.set(db.collection("employerJobContacts").doc(jobRef.id), { ...contact, createdAt: FieldValue.serverTimestamp() });
      await batch.commit();

      const metadata = { billingType: "employer_job", jobId: jobRef.id, priceId: EMPLOYER_JOB_PRICE_ID };
      const session = await Stripe(stripeSecret.value()).checkout.sessions.create({
        mode: "payment",
        customer_email: contact.contactEmail,
        line_items: [{ price: EMPLOYER_JOB_PRICE_ID, quantity: 1 }],
        success_url: `${SITE_URL}/post-a-job.html?paid=1`,
        cancel_url: `${SITE_URL}/post-a-job.html?cancelled=1`,
        metadata,
        payment_intent_data: { metadata }
      });

      return res.status(200).json({ url: session.url });
    } catch (error) {
      if (!error.status) console.error("Employer job checkout error:", error);
      return res.status(error.status || 500).json({ error: error.status ? error.message : "Something went wrong. Please try again." });
    }
  }
);

// Called by stripeWebhook for checkout.session.completed. Returns true if handled.
async function handleEmployerJobPayment(session) {
  const { billingType, jobId } = session.metadata || {};
  if (billingType !== "employer_job") return false;
  if (!jobId) {
    console.error("Employer job payment without jobId", session.id);
    return true;
  }
  if (session.payment_status && session.payment_status !== "paid") {
    console.error(`Employer job session ${session.id} not paid (${session.payment_status})`);
    return true;
  }

  const ref = admin.firestore().collection("employerJobs").doc(jobId);
  const snap = await ref.get();
  if (!snap.exists) {
    console.error(`Employer job ${jobId} paid for but not found (session ${session.id})`);
    return true;
  }
  if (snap.data().status !== "awaiting_payment") return true;

  await ref.update({
    status: "pending_review",
    paidAt: FieldValue.serverTimestamp(),
    stripeSessionId: session.id,
    amountPaid: typeof session.amount_total === "number" ? session.amount_total / 100 : null
  });
  console.log(`Employer job ${jobId} paid; waiting for review`);
  return true;
}

module.exports = {
  createEmployerJobCheckout: exports.createEmployerJobCheckout,
  handleEmployerJobPayment,
  validateEmployerJob
};
