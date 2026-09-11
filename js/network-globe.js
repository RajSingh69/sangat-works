const DEFAULT_MARKERS = [
  { label: "London", lat: 51.5072, lng: -0.1276, weight: 3 },
  { label: "Birmingham", lat: 52.4862, lng: -1.8904, weight: 3 },
  { label: "Manchester", lat: 53.4808, lng: -2.2426, weight: 2 },
  { label: "Leeds", lat: 53.8008, lng: -1.5491, weight: 2 },
  { label: "Glasgow", lat: 55.8642, lng: -4.2518, weight: 2 },
  { label: "Bristol", lat: 51.4545, lng: -2.5879, weight: 1 }
];

function normaliseOptions(options = {}) {
  return {
    dotColor: options.dotColor || "rgba(192, 213, 232, 0.58)",
    arcColor: options.arcColor || "rgba(235, 111, 24, 0.42)",
    markerColor: options.markerColor || "#e9974d",
    glowColor: options.glowColor || "rgba(235, 111, 24, 0.11)",
    typeStyles: {
      decorative: { color: "rgba(169, 197, 222, 0.28)", particle: "rgba(225, 237, 247, 0.75)", width: 0.7, speed: 0.18 },
      connection: { color: "rgba(74, 180, 216, 0.58)", particle: "rgba(199, 240, 255, 0.95)", width: 1.15, speed: 0.34 },
      project: { color: "rgba(235, 145, 52, 0.62)", particle: "rgba(255, 224, 176, 0.95)", width: 1.2, speed: 0.3 },
      skill: { color: "rgba(61, 177, 137, 0.56)", particle: "rgba(199, 246, 226, 0.92)", width: 1.05, speed: 0.26 },
      business: { color: "rgba(127, 164, 236, 0.52)", particle: "rgba(218, 229, 255, 0.9)", width: 0.95, speed: 0.22 }
    },
    autoRotateSpeed: Number(options.autoRotateSpeed ?? 0.0022),
    markers: Array.isArray(options.markers) && options.markers.length ? options.markers : DEFAULT_MARKERS,
    connections: Array.isArray(options.connections) ? options.connections : [],
    reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches
  };
}

function latLngToVector(lat, lng, radius) {
  const phi = (90 - lat) * Math.PI / 180;
  const theta = (lng + 180) * Math.PI / 180;
  return {
    x: -radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta)
  };
}

function rotatePoint(point, rotationX, rotationY) {
  const cosY = Math.cos(rotationY);
  const sinY = Math.sin(rotationY);
  const x1 = point.x * cosY - point.z * sinY;
  const z1 = point.x * sinY + point.z * cosY;
  const cosX = Math.cos(rotationX);
  const sinX = Math.sin(rotationX);
  return {
    x: x1,
    y: point.y * cosX - z1 * sinX,
    z: point.y * sinX + z1 * cosX
  };
}

function project(point, centerX, centerY, radius) {
  const perspective = radius * 3;
  const scale = perspective / (perspective - point.z);
  return {
    x: centerX + point.x * scale,
    y: centerY + point.y * scale,
    scale,
    visible: point.z > -radius * 0.86
  };
}

function getMarkerConnections(markers, explicitConnections) {
  if (explicitConnections.length) return explicitConnections;
  const hubConnections = markers.slice(1, 8).map((marker, index) => ({ from: 0, to: index + 1, type: "decorative" }));
  const crossConnections = markers.slice(0, 7).map((marker, index) => ({ from: index, to: (index + 2) % markers.length, type: "decorative" }));
  return [...hubConnections, ...crossConnections].filter((connection) => connection.from !== connection.to);
}

export function initSangatNetworkGlobe(canvasOrContainer, options = {}) {
  const canvas = canvasOrContainer instanceof HTMLCanvasElement
    ? canvasOrContainer
    : canvasOrContainer?.querySelector("canvas");

  if (!canvas) return { destroy() {} };

  const ctx = canvas.getContext("2d");
  const settings = normaliseOptions(options);
  let width = 0;
  let height = 0;
  let radius = 0;
  let rotationX = -0.18;
  let rotationY = 0.2;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let frameId = 0;
  let destroyed = false;
  let dots = [];
  let startTime = performance.now();

  function buildDots() {
    dots = [];
    const rings = 13;
    for (let latIndex = 1; latIndex < rings; latIndex += 1) {
      const lat = -75 + latIndex * (150 / rings);
      const count = Math.max(12, Math.round(Math.cos(lat * Math.PI / 180) * 34));
      for (let i = 0; i < count; i += 1) {
        const lng = (360 / count) * i;
        dots.push(latLngToVector(lat, lng, radius));
      }
    }
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    width = Math.max(260, rect.width || 360);
    height = Math.max(260, rect.height || 360);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    radius = Math.min(width, height) * 0.36;
    buildDots();
  }

  function drawArc(projectedA, projectedB, progress, type = "decorative") {
    const style = settings.typeStyles[type] || settings.typeStyles.decorative;
    const midX = (projectedA.x + projectedB.x) / 2;
    const midY = (projectedA.y + projectedB.y) / 2 - radius * 0.22;
    ctx.strokeStyle = style.color || settings.arcColor;
    ctx.lineWidth = style.width || 0.9;
    ctx.beginPath();
    ctx.moveTo(projectedA.x, projectedA.y);
    ctx.quadraticCurveTo(midX, midY, projectedB.x, projectedB.y);
    ctx.stroke();

    if (!settings.reducedMotion) {
      const t = progress % 1;
      const x = (1 - t) * (1 - t) * projectedA.x + 2 * (1 - t) * t * midX + t * t * projectedB.x;
      const y = (1 - t) * (1 - t) * projectedA.y + 2 * (1 - t) * t * midY + t * t * projectedB.y;
      ctx.fillStyle = style.particle || "#fff5df";
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function render(time) {
    if (destroyed) return;
    if (!settings.reducedMotion && !dragging) rotationY += settings.autoRotateSpeed;

    const centerX = width / 2;
    const centerY = height / 2;
    const elapsed = (time - startTime) / 1000;
    ctx.clearRect(0, 0, width, height);

    const gradient = ctx.createRadialGradient(centerX, centerY, radius * 0.3, centerX, centerY, radius * 1.25);
    gradient.addColorStop(0, "rgba(255,255,255,0.13)");
    gradient.addColorStop(0.45, "rgba(35,104,161,0.24)");
    gradient.addColorStop(0.78, "rgba(18,60,105,0.20)");
    gradient.addColorStop(1, "rgba(235,111,24,0.10)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius * 1.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(214,229,242,0.32)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.stroke();

    dots.forEach((dot) => {
      const rotated = rotatePoint(dot, rotationX, rotationY);
      const projected = project(rotated, centerX, centerY, radius);
      if (!projected.visible) return;
      ctx.globalAlpha = Math.min(0.92, Math.max(0.22, (rotated.z + radius) / (radius * 1.85)));
      ctx.fillStyle = settings.dotColor;
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, 1.35 * projected.scale, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    const markerPoints = settings.markers.map((marker) => {
      const point = latLngToVector(marker.lat, marker.lng, radius);
      const rotated = rotatePoint(point, rotationX, rotationY);
      return { marker, rotated, projected: project(rotated, centerX, centerY, radius) };
    });

    getMarkerConnections(settings.markers, settings.connections).forEach((connection, index) => {
      const a = markerPoints[connection.from];
      const b = markerPoints[connection.to];
      if (!a || !b || !a.projected.visible || !b.projected.visible) return;
      drawArc(a.projected, b.projected, elapsed * ((settings.typeStyles[connection.type]?.speed) || 0.22) + index * 0.18, connection.type);
    });

    markerPoints.forEach(({ marker, projected, rotated }, index) => {
      if (!projected.visible) return;
      const pulse = settings.reducedMotion ? 0 : Math.sin(elapsed * 2.2 + index) * 1.2;
      const markerRadius = 4 + Number(marker.weight || 1) * 0.7;
      ctx.globalAlpha = Math.min(1, Math.max(0.28, (rotated.z + radius) / (radius * 1.8)));
      ctx.fillStyle = settings.glowColor;
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, markerRadius + 6 + pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = settings.markerColor;
      ctx.beginPath();
      ctx.arc(projected.x, projected.y, markerRadius, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    frameId = requestAnimationFrame(render);
  }

  function pointerDown(event) {
    dragging = true;
    canvas.setPointerCapture?.(event.pointerId);
    lastX = event.clientX;
    lastY = event.clientY;
  }

  function pointerMove(event) {
    if (!dragging) return;
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    rotationY += dx * 0.006;
    rotationX = Math.max(-0.85, Math.min(0.85, rotationX + dy * 0.006));
    lastX = event.clientX;
    lastY = event.clientY;
  }

  function pointerUp(event) {
    dragging = false;
    canvas.releasePointerCapture?.(event.pointerId);
  }

  resize();
  window.addEventListener("resize", resize);
  canvas.addEventListener("pointerdown", pointerDown);
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerup", pointerUp);
  canvas.addEventListener("pointercancel", pointerUp);
  frameId = requestAnimationFrame(render);

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener("resize", resize);
      canvas.removeEventListener("pointerdown", pointerDown);
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerup", pointerUp);
      canvas.removeEventListener("pointercancel", pointerUp);
    }
  };
}

export const UK_REGION_COORDINATES = {
  london: { lat: 51.5072, lng: -0.1276, label: "London" },
  birmingham: { lat: 52.4862, lng: -1.8904, label: "Birmingham" },
  coventry: { lat: 52.4068, lng: -1.5197, label: "Coventry" },
  leicester: { lat: 52.6369, lng: -1.1398, label: "Leicester" },
  wolverhampton: { lat: 52.5862, lng: -2.1288, label: "Wolverhampton" },
  leeds: { lat: 53.8008, lng: -1.5491, label: "Leeds" },
  manchester: { lat: 53.4808, lng: -2.2426, label: "Manchester" },
  bradford: { lat: 53.7950, lng: -1.7594, label: "Bradford" },
  glasgow: { lat: 55.8642, lng: -4.2518, label: "Glasgow" },
  edinburgh: { lat: 55.9533, lng: -3.1883, label: "Edinburgh" },
  bristol: { lat: 51.4545, lng: -2.5879, label: "Bristol" },
  cardiff: { lat: 51.4816, lng: -3.1791, label: "Cardiff" },
  slough: { lat: 51.5105, lng: -0.5950, label: "Slough" },
  southall: { lat: 51.5111, lng: -0.3759, label: "Southall" },
  woking: { lat: 51.3168, lng: -0.5600, label: "Woking" }
};

export function getRegionKeyForTown(town = "") {
  const cleanTown = String(town || "").trim().toLowerCase();
  if (!cleanTown) return "";
  return Object.keys(UK_REGION_COORDINATES).find((name) => cleanTown.includes(name)) || "";
}

export function markersFromPublicProfiles(profiles = []) {
  const counts = new Map();
  profiles.forEach((profile) => {
    const key = getRegionKeyForTown(profile.town);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });

  return [...counts.entries()].map(([key, count]) => ({
    ...UK_REGION_COORDINATES[key],
    weight: Math.min(5, Math.max(1, count)),
    count
  }));
}


export function attachScrollResponsiveGlobe(globeElement, anchors = []) {
  if (!globeElement || !anchors.length) return { destroy() {} };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const smallScreen = window.matchMedia("(max-width: 760px)").matches;
  if (reducedMotion || smallScreen) return { destroy() {} };

  let frameId = 0;
  let latestY = window.scrollY;
  let destroyed = false;

  function readAnchor(anchor) {
    const rect = anchor.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    const viewportCenter = window.innerHeight / 2;
    const distance = Math.abs(center - viewportCenter);
    const influence = Math.max(0, 1 - distance / Math.max(window.innerHeight * 0.78, 1));
    return {
      influence,
      x: Number(anchor.dataset.globeX || 0),
      y: Number(anchor.dataset.globeY || 0),
      scale: Number(anchor.dataset.globeScale || 1),
      opacity: Number(anchor.dataset.globeOpacity || 1)
    };
  }

  function update() {
    frameId = 0;
    if (destroyed) return;

    const states = anchors.map(readAnchor);
    const total = states.reduce((sum, state) => sum + state.influence, 0) || 1;
    const blended = states.reduce((acc, state) => {
      const weight = state.influence / total;
      acc.x += state.x * weight;
      acc.y += state.y * weight;
      acc.scale += state.scale * weight;
      acc.opacity += state.opacity * weight;
      return acc;
    }, { x: 0, y: 0, scale: 0, opacity: 0 });

    globeElement.style.setProperty("--globe-scroll-x", `${blended.x}vw`);
    globeElement.style.setProperty("--globe-scroll-y", `${blended.y}px`);
    globeElement.style.setProperty("--globe-scroll-scale", blended.scale.toFixed(3));
    globeElement.style.setProperty("--globe-scroll-opacity", blended.opacity.toFixed(3));
  }

  function requestUpdate() {
    latestY = window.scrollY;
    if (!frameId) frameId = requestAnimationFrame(update);
  }

  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate);
  requestUpdate();

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(frameId);
      window.removeEventListener("scroll", requestUpdate);
      window.removeEventListener("resize", requestUpdate);
    }
  };
}
export function fallbackUkMarkers() {
  return DEFAULT_MARKERS;
}
