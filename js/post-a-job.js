/*
  Public "Post a job" page for employers who aren't members
  (functions/employer-jobs.js checks the details, saves the post and opens Stripe).
*/

import { INDUSTRY_BUCKETS } from "./industries.js";

const CHECKOUT_URL = "https://europe-west1-sangat-works.cloudfunctions.net/createEmployerJobCheckout";

const $ = id => document.getElementById(id);
const form = $("postJobForm");
const message = $("pjMessage");
const submit = $("pjSubmit");
const note = $("postJobNote");

$("pjIndustry").innerHTML = `<option value="">Choose an industry</option>${[...INDUSTRY_BUCKETS.map(bucket => bucket.name), "Other"]
  .map(name => `<option value="${name.replace(/&/g, "&amp;")}">${name.replace(/&/g, "&amp;")}</option>`).join("")}`;

const today = new Date();
const maxDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
$("pjClosing").min = today.toISOString().slice(0, 10);
$("pjClosing").max = maxDate.toISOString().slice(0, 10);

const params = new URLSearchParams(window.location.search);
if (params.get("paid") === "1") {
  note.hidden = false;
  note.innerHTML = "<strong>Thank you, your payment went through.</strong> Our team will check your post and put it live, usually within 1-2 working days. We'll be in touch if we have any questions.";
  form.hidden = true;
} else if (params.get("cancelled") === "1") {
  note.hidden = false;
  note.classList.add("is-warning");
  note.textContent = "Payment was cancelled, so your job hasn't been posted. You can try again below.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const value = id => $(id).value.trim();

  const required = [["pjCompany", "your company name"], ["pjTitle", "a job title"], ["pjIndustry", "an industry"], ["pjDescription", "a job description"], ["pjContactName", "your name"], ["pjContactEmail", "your email"]]
    .filter(([id]) => !value(id));
  if (required.length) {
    message.textContent = `Please add ${required.map(([, label]) => label).join(", ")}.`;
    $(required[0][0]).focus();
    return;
  }
  if (!value("pjApplyLink") && !value("pjApplyEmail")) {
    message.textContent = "Add a link or an email so candidates can apply.";
    $("pjApplyLink").focus();
    return;
  }

  submit.disabled = true;
  message.textContent = "Opening secure payment...";

  try {
    const response = await fetch(CHECKOUT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        companyName: value("pjCompany"),
        title: value("pjTitle"),
        industry: value("pjIndustry"),
        pay: value("pjPay"),
        location: value("pjLocation"),
        remote: $("pjRemote").checked,
        description: value("pjDescription"),
        applyLink: value("pjApplyLink"),
        applyEmail: value("pjApplyEmail"),
        closingDate: value("pjClosing"),
        contactName: value("pjContactName"),
        contactEmail: value("pjContactEmail"),
        contactPhone: value("pjContactPhone")
      })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.url) throw new Error(data.error || "Something went wrong. Please try again.");
    window.location.href = data.url;
  } catch (error) {
    message.textContent = error.message;
    submit.disabled = false;
  }
});
