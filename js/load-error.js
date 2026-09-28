// Shared "couldn't load" message with a Try again button, for when the
// connection drops (busy venue wifi). The button reloads the page.
export function loadErrorHtml(what = "this") {
  return `<span class="load-error" role="alert"><strong>Couldn't load ${what}.</strong> <span>Check your connection and try again.</span> <button type="button" class="btn-small" data-retry-load>Try again</button></span>`;
}

// Firestore and network errors carry a code; our own validation errors don't.
export function isConnectionError(error) {
  return Boolean(error?.code) || error instanceof TypeError;
}

document.addEventListener("click", (event) => {
  if (event.target.closest("[data-retry-load]")) window.location.reload();
});
