// "Have a trial code?" boxes (pricing.html, login.html): send people to the
// free trial sign-up with their code filled in (trial.html, functions/trials.js).
document.querySelectorAll("form[data-redeem-code]").forEach((form) => {
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const input = form.querySelector("input");
    const code = input.value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, "");
    const message = form.querySelector(".redeem-code-message");
    if (code.length < 3) {
      if (message) message.textContent = "Type the code you were given.";
      input.focus();
      return;
    }
    window.location.href = `join.html?code=${encodeURIComponent(code)}`;
  });
});
