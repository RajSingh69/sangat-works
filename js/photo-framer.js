/*
  Super-admin tool to frame a member's photo inside the card shape.
  Drag to move, slider (or mouse wheel) to zoom, arrow keys to nudge.
  onSave receives { x, y, zoom } and should persist it; errors are shown in the dialog.
*/

import { DEFAULT_FRAMING, escapeHtml, photoFramingStyle } from "./directory-card.js";

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = value => Math.round(value * 10) / 10;

export function openPhotoFramer({ imageUrl, title = "", framing = DEFAULT_FRAMING, onSave }) {
  const state = { ...DEFAULT_FRAMING, ...framing };

  const backdrop = document.createElement("div");
  backdrop.className = "photo-framer-backdrop";
  backdrop.innerHTML = `
    <div class="photo-framer" role="dialog" aria-modal="true" aria-labelledby="photoFramerTitle">
      <h2 id="photoFramerTitle">Adjust card photo</h2>
      <p>${escapeHtml(title)}<br>Drag the photo to position it. Use the slider to zoom. This is exactly how the card will look.</p>
      <div class="photo-framer-stage" tabindex="0" aria-label="Photo position. Use arrow keys to move.">
        <img src="${escapeHtml(imageUrl)}" alt="" draggable="false">
      </div>
      <label class="photo-framer-zoom">
        <span>Zoom</span>
        <input type="range" min="1" max="3" step="0.05" value="${state.zoom}">
        <output>${Math.round(state.zoom * 100)}%</output>
      </label>
      <p class="photo-framer-status" role="status"></p>
      <div class="photo-framer-actions">
        <button type="button" class="is-reset">Reset</button>
        <button type="button" class="is-cancel">Cancel</button>
        <button type="button" class="is-primary">Save</button>
      </div>
    </div>
  `;

  const stage = backdrop.querySelector(".photo-framer-stage");
  const image = stage.querySelector("img");
  const zoomInput = backdrop.querySelector('input[type="range"]');
  const zoomOutput = backdrop.querySelector("output");
  const status = backdrop.querySelector(".photo-framer-status");
  const saveButton = backdrop.querySelector(".is-primary");

  function render() {
    image.style.cssText = photoFramingStyle(state);
    zoomInput.value = state.zoom;
    zoomOutput.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  // Makes the photo follow the pointer 1:1. With object-fit: cover, object-position p%
  // and scale(z) about the same point, one % of p moves the photo by
  // (frame - z * displayed) / 100 pixels, where displayed is the covered image size.
  function moveBy(dxPixels, dyPixels) {
    const rect = stage.getBoundingClientRect();
    const naturalW = image.naturalWidth || rect.width;
    const naturalH = image.naturalHeight || rect.height;
    const coverScale = Math.max(rect.width / naturalW, rect.height / naturalH);
    const overflowX = state.zoom * naturalW * coverScale - rect.width;
    const overflowY = state.zoom * naturalH * coverScale - rect.height;

    if (overflowX > 0.5) state.x = round(clamp(state.x - (dxPixels * 100) / overflowX, 0, 100));
    if (overflowY > 0.5) state.y = round(clamp(state.y - (dyPixels * 100) / overflowY, 0, 100));
    render();
  }

  let drag = null;
  stage.addEventListener("pointerdown", event => {
    drag = { x: event.clientX, y: event.clientY };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add("is-dragging");
  });
  stage.addEventListener("pointermove", event => {
    if (!drag) return;
    moveBy(event.clientX - drag.x, event.clientY - drag.y);
    drag = { x: event.clientX, y: event.clientY };
  });
  const endDrag = () => {
    drag = null;
    stage.classList.remove("is-dragging");
  };
  stage.addEventListener("pointerup", endDrag);
  stage.addEventListener("pointercancel", endDrag);

  stage.addEventListener("wheel", event => {
    event.preventDefault();
    state.zoom = Math.round(clamp(state.zoom - event.deltaY * 0.0015, 1, 3) * 100) / 100;
    render();
  }, { passive: false });

  stage.addEventListener("keydown", event => {
    const step = event.shiftKey ? 5 : 1;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (!moves[event.key]) return;
    event.preventDefault();
    state.x = clamp(state.x - moves[event.key][0], 0, 100);
    state.y = clamp(state.y - moves[event.key][1], 0, 100);
    render();
  });

  zoomInput.addEventListener("input", () => {
    state.zoom = Number(zoomInput.value);
    render();
  });

  function close() {
    document.removeEventListener("keydown", onEscape);
    backdrop.remove();
  }

  function onEscape(event) {
    if (event.key === "Escape") close();
  }

  backdrop.querySelector(".is-reset").addEventListener("click", () => {
    Object.assign(state, DEFAULT_FRAMING);
    render();
  });
  backdrop.querySelector(".is-cancel").addEventListener("click", close);
  backdrop.addEventListener("click", event => {
    if (event.target === backdrop) close();
  });
  document.addEventListener("keydown", onEscape);

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    status.classList.remove("is-error");
    status.textContent = "Saving...";
    try {
      await onSave({ x: round(state.x), y: round(state.y), zoom: Math.round(state.zoom * 100) / 100 });
      close();
    } catch (error) {
      console.error("Could not save photo framing:", error);
      status.classList.add("is-error");
      status.textContent = "Couldn't save. Only super admins can change card photos.";
      saveButton.disabled = false;
    }
  });

  document.body.appendChild(backdrop);
  render();
  stage.focus();
}
