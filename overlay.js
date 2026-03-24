let overlayCanvas;
let overlayContext;
let fadeTimer;

function ensureOverlay() {
  if (overlayCanvas) {
    return;
  }

  overlayCanvas = document.createElement("canvas");
  overlayCanvas.style.position = "fixed";
  overlayCanvas.style.inset = "0";
  overlayCanvas.style.width = "100vw";
  overlayCanvas.style.height = "100vh";
  overlayCanvas.style.pointerEvents = "none";
  overlayCanvas.style.zIndex = "2147483647";
  overlayCanvas.style.background = "transparent";
  document.documentElement.appendChild(overlayCanvas);
  overlayContext = overlayCanvas.getContext("2d");
  resizeOverlay();
}

function resizeOverlay() {
  if (!overlayCanvas) {
    return;
  }

  const ratio = window.devicePixelRatio || 1;
  overlayCanvas.width = Math.max(1, Math.floor(window.innerWidth * ratio));
  overlayCanvas.height = Math.max(1, Math.floor(window.innerHeight * ratio));
  overlayContext.setTransform(ratio, 0, 0, ratio, 0, 0);
  overlayContext.lineCap = "round";
  overlayContext.lineJoin = "round";
}

function hexToRgba(hex, alpha) {
  const normalized = hex.replace("#", "");
  const value = normalized.length === 3
    ? normalized.split("").map((part) => part + part).join("")
    : normalized;
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function pagePoint(segmentPoint) {
  return {
    x: (segmentPoint.x / 1000) * window.innerWidth,
    y: (segmentPoint.y / 1000) * window.innerHeight
  };
}

function drawCrack(segment) {
  const center = pagePoint(segment.to);
  const baseRadius = Math.max(36, segment.size * 7);

  overlayContext.save();
  overlayContext.strokeStyle = hexToRgba(segment.color, 0.92);
  overlayContext.lineWidth = Math.max(1, segment.size * 0.45);

  for (let index = 0; index < 10; index += 1) {
    const angle = (Math.PI * 2 * index) / 10 + ((segment.seed || 0) * 0.35);
    const radius = baseRadius * (0.75 + ((index % 4) * 0.17));
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;

    overlayContext.beginPath();
    overlayContext.moveTo(center.x, center.y);
    overlayContext.lineTo(x, y);
    overlayContext.stroke();
  }

  overlayContext.fillStyle = hexToRgba("#ffffff", 0.35);
  overlayContext.beginPath();
  overlayContext.arc(center.x, center.y, Math.max(5, segment.size), 0, Math.PI * 2);
  overlayContext.fill();
  overlayContext.restore();
}

function drawScribble(segment) {
  const center = pagePoint(segment.to);
  const radius = Math.max(22, segment.size * 4);

  overlayContext.save();
  overlayContext.strokeStyle = hexToRgba(segment.color, 0.95);
  overlayContext.lineWidth = Math.max(2, segment.size);
  overlayContext.beginPath();

  for (let index = 0; index <= 28; index += 1) {
    const angle = (Math.PI * 6 * index) / 28;
    const wobble = radius * (0.75 + Math.sin(angle * 1.9 + (segment.seed || 0)) * 0.22);
    const x = center.x + Math.cos(angle) * wobble;
    const y = center.y + Math.sin(angle) * wobble;

    if (index === 0) {
      overlayContext.moveTo(x, y);
    } else {
      overlayContext.lineTo(x, y);
    }
  }

  overlayContext.stroke();
  overlayContext.restore();
}

function drawDrip(segment) {
  const point = pagePoint(segment.to);
  const width = Math.max(10, segment.size * 2.1);
  const height = Math.max(45, segment.size * 12);

  overlayContext.save();
  overlayContext.strokeStyle = hexToRgba(segment.color, 0.96);
  overlayContext.fillStyle = hexToRgba(segment.color, 0.3);
  overlayContext.lineWidth = width;
  overlayContext.beginPath();
  overlayContext.moveTo(point.x, point.y);
  overlayContext.bezierCurveTo(
    point.x + width * 0.18,
    point.y + height * 0.3,
    point.x - width * 0.2,
    point.y + height * 0.7,
    point.x,
    point.y + height
  );
  overlayContext.stroke();

  overlayContext.beginPath();
  overlayContext.ellipse(point.x, point.y + height + width * 0.2, width, width * 1.3, 0, 0, Math.PI * 2);
  overlayContext.fill();
  overlayContext.restore();
}

function drawStroke(segment) {
  const from = pagePoint(segment.from);
  const to = pagePoint(segment.to);
  overlayContext.save();
  overlayContext.strokeStyle = hexToRgba(segment.color, 0.94);
  overlayContext.lineWidth = Math.max(2, segment.size);
  overlayContext.beginPath();
  overlayContext.moveTo(from.x, from.y);
  overlayContext.lineTo(to.x, to.y);
  overlayContext.stroke();
  overlayContext.restore();
}

function scheduleFade() {
  clearTimeout(fadeTimer);
  fadeTimer = window.setTimeout(() => {
    if (!overlayContext || !overlayCanvas) {
      return;
    }

    let alpha = 1;
    const interval = window.setInterval(() => {
      alpha -= 0.08;
      overlayCanvas.style.opacity = String(Math.max(0, alpha));

      if (alpha <= 0) {
        clearInterval(interval);
        overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        overlayCanvas.style.opacity = "1";
      }
    }, 30);
  }, 3500);
}

function drawEffect(segment) {
  ensureOverlay();
  overlayCanvas.style.opacity = "1";

  if (segment.effect === "crack") {
    drawCrack(segment);
  } else if (segment.effect === "scribble") {
    drawScribble(segment);
  } else if (segment.effect === "drip") {
    drawDrip(segment);
  } else {
    drawStroke(segment);
  }

  scheduleFade();
}

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type === "SHOW_SURPRISE_EFFECT" && message.segment) {
    drawEffect(message.segment);
  }

  if (message?.type === "CLEAR_SURPRISE_EFFECT") {
    ensureOverlay();
    overlayContext.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    overlayCanvas.style.opacity = "1";
  }
});

window.addEventListener("resize", resizeOverlay);
