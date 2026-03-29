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

  overlayContext.beginPath();
  overlayContext.arc(center.x, center.y, baseRadius * 0.22, 0, Math.PI * 2);
  overlayContext.fillStyle = hexToRgba("#ffffff", 0.16);
  overlayContext.fill();

  for (let index = 0; index < 10; index += 1) {
    const angle = (Math.PI * 2 * index) / 10 + ((segment.seed || 0) * 0.35);
    const radius = baseRadius * (0.75 + ((index % 4) * 0.17));
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;

    overlayContext.beginPath();
    overlayContext.moveTo(center.x, center.y);
    overlayContext.lineTo(x, y);
    overlayContext.stroke();

    overlayContext.beginPath();
    overlayContext.moveTo(center.x + Math.cos(angle) * (radius * 0.34), center.y + Math.sin(angle) * (radius * 0.34));
    overlayContext.lineTo(center.x + Math.cos(angle + 0.12) * (radius * 0.46), center.y + Math.sin(angle + 0.12) * (radius * 0.46));
    overlayContext.strokeStyle = hexToRgba("#ffffff", 0.22);
    overlayContext.stroke();
    overlayContext.strokeStyle = hexToRgba(segment.color, 0.92);
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

function drawInkSlap(segment) {
  const center = pagePoint(segment.to);
  const splashRadius = Math.max(26, segment.size * 4.2);
  const droplets = 8;

  overlayContext.save();
  overlayContext.fillStyle = hexToRgba(segment.color, 0.92);
  overlayContext.strokeStyle = hexToRgba("#ffffff", 0.12);
  overlayContext.lineWidth = Math.max(1, segment.size * 0.24);

  overlayContext.beginPath();
  for (let index = 0; index < 18; index += 1) {
    const angle = (Math.PI * 2 * index) / 18;
    const wobble = splashRadius * (0.84 + (Math.sin(angle * 3 + (segment.seed || 0)) * 0.22));
    const x = center.x + Math.cos(angle) * wobble;
    const y = center.y + Math.sin(angle) * wobble;
    if (index === 0) {
      overlayContext.moveTo(x, y);
    } else {
      overlayContext.lineTo(x, y);
    }
  }
  overlayContext.closePath();
  overlayContext.fill();
  overlayContext.stroke();

  for (let index = 0; index < droplets; index += 1) {
    const angle = ((Math.PI * 2) / droplets) * index + (segment.seed || 0) * 0.45;
    const distance = splashRadius * (1.3 + ((index % 3) * 0.28));
    const radius = Math.max(4, segment.size * (0.58 + ((index % 2) * 0.22)));
    overlayContext.beginPath();
    overlayContext.arc(
      center.x + Math.cos(angle) * distance,
      center.y + Math.sin(angle) * distance,
      radius,
      0,
      Math.PI * 2,
    );
    overlayContext.fill();
  }

  overlayContext.restore();
}

function drawConfetti(segment) {
  const center = pagePoint(segment.to);
  const colors = ["#ef6a48", "#ffd05b", "#4d83ff", "#ff5b7c", "#35b56a", "#ffffff"];
  const pieces = 20;

  overlayContext.save();
  for (let index = 0; index < pieces; index += 1) {
    const angle = ((Math.PI * 2) / pieces) * index + ((segment.seed || 0) * 0.25);
    const distance = Math.max(26, segment.size * 5.4) * (0.55 + ((index % 5) * 0.13));
    const x = center.x + Math.cos(angle) * distance;
    const y = center.y + Math.sin(angle) * distance;
    const width = Math.max(6, segment.size * 1);
    const height = Math.max(9, segment.size * 1.7);

    overlayContext.save();
    overlayContext.translate(x, y);
    overlayContext.rotate(angle + (index % 3) * 0.4);
    overlayContext.fillStyle = colors[index % colors.length];
    overlayContext.fillRect(-width / 2, -height / 2, width, height);
    overlayContext.restore();
  }

  overlayContext.beginPath();
  overlayContext.arc(center.x, center.y, Math.max(4, segment.size * 0.9), 0, Math.PI * 2);
  overlayContext.fillStyle = hexToRgba("#ffffff", 0.58);
  overlayContext.fill();
  overlayContext.restore();
}

function drawZap(segment) {
  const start = pagePoint(segment.from);
  const end = pagePoint(segment.to);
  const steps = 7;

  overlayContext.save();
  overlayContext.shadowBlur = 22;
  overlayContext.shadowColor = hexToRgba("#fff7bf", 0.9);
  overlayContext.strokeStyle = hexToRgba("#fff4ad", 0.98);
  overlayContext.lineWidth = Math.max(2, segment.size * 0.85);
  overlayContext.beginPath();
  overlayContext.moveTo(start.x, start.y);

  for (let index = 1; index < steps; index += 1) {
    const progress = index / steps;
    const sway = (index % 2 === 0 ? -1 : 1) * segment.size * 7;
    const x = start.x + ((end.x - start.x) * progress) + sway;
    const y = start.y + ((end.y - start.y) * progress);
    overlayContext.lineTo(x, y);
  }

  overlayContext.lineTo(end.x, end.y);
  overlayContext.stroke();
  overlayContext.restore();
}

function drawHeartburst(segment) {
  const center = pagePoint(segment.to);
  const hearts = 7;

  overlayContext.save();
  overlayContext.fillStyle = hexToRgba(segment.color, 0.95);

  for (let index = 0; index < hearts; index += 1) {
    const angle = (Math.PI * 2 * index) / hearts;
    const distance = segment.size * 7 + ((index % 2) * 12);
    const x = center.x + Math.cos(angle) * distance;
    const y = center.y + Math.sin(angle) * distance;
    const size = Math.max(10, segment.size * 2);

    overlayContext.beginPath();
    overlayContext.moveTo(x, y + size * 0.2);
    overlayContext.bezierCurveTo(x - size, y - size * 0.8, x - size * 1.4, y + size * 0.65, x, y + size * 1.35);
    overlayContext.bezierCurveTo(x + size * 1.4, y + size * 0.65, x + size, y - size * 0.8, x, y + size * 0.2);
    overlayContext.fill();
  }

  overlayContext.restore();
}

function drawBullet(segment) {
  drawCrack({ ...segment, size: segment.size * 0.9 });

  const center = pagePoint(segment.to);
  overlayContext.save();
  overlayContext.fillStyle = hexToRgba("#1f1a16", 0.95);
  overlayContext.beginPath();
  overlayContext.arc(center.x, center.y, Math.max(5, segment.size * 0.9), 0, Math.PI * 2);
  overlayContext.fill();
  overlayContext.restore();
}

function drawStickman(segment) {
  const center = pagePoint(segment.to);
  const scale = Math.max(18, segment.size * 2.8);

  overlayContext.save();
  overlayContext.strokeStyle = hexToRgba(segment.color, 0.96);
  overlayContext.lineWidth = Math.max(2, segment.size * 0.7);
  overlayContext.beginPath();
  overlayContext.arc(center.x, center.y - scale * 1.25, scale * 0.42, 0, Math.PI * 2);
  overlayContext.moveTo(center.x, center.y - scale * 0.8);
  overlayContext.lineTo(center.x, center.y + scale * 0.65);
  overlayContext.moveTo(center.x - scale * 0.82, center.y - scale * 0.18);
  overlayContext.lineTo(center.x + scale * 0.84, center.y - scale * 0.52);
  overlayContext.moveTo(center.x, center.y + scale * 0.65);
  overlayContext.lineTo(center.x - scale * 0.76, center.y + scale * 1.55);
  overlayContext.moveTo(center.x, center.y + scale * 0.65);
  overlayContext.lineTo(center.x + scale * 0.9, center.y + scale * 1.48);
  overlayContext.stroke();
  overlayContext.restore();
}

function drawStickerSlap(segment) {
  const center = pagePoint(segment.to);
  const width = Math.max(86, segment.size * 12.5);
  const height = Math.max(64, segment.size * 9.6);
  const tilt = Math.sin(segment.seed || 0) * 0.18;

  overlayContext.save();
  overlayContext.translate(center.x, center.y);
  overlayContext.rotate(tilt);

  overlayContext.fillStyle = hexToRgba("#000000", 0.16);
  overlayContext.beginPath();
  overlayContext.roundRect(-width / 2 + 6, -height / 2 + 8, width, height, 22);
  overlayContext.fill();

  overlayContext.fillStyle = hexToRgba("#fffdf8", 0.99);
  overlayContext.strokeStyle = hexToRgba(segment.color, 0.92);
  overlayContext.lineWidth = Math.max(3, segment.size * 0.46);
  overlayContext.beginPath();
  overlayContext.roundRect(-width / 2, -height / 2, width, height, 22);
  overlayContext.fill();
  overlayContext.stroke();

  overlayContext.fillStyle = hexToRgba(segment.color, 0.14);
  overlayContext.beginPath();
  overlayContext.roundRect(-width / 2 + 9, -height / 2 + 9, width - 18, height - 18, 16);
  overlayContext.fill();

  overlayContext.fillStyle = hexToRgba(segment.color, 0.95);
  overlayContext.font = `700 ${Math.max(20, segment.size * 2.5)}px "Trebuchet MS", sans-serif`;
  overlayContext.textAlign = "center";
  overlayContext.textBaseline = "middle";
  overlayContext.fillText("NICE", 0, -4);

  overlayContext.fillStyle = hexToRgba("#ffd05b", 0.96);
  for (let index = 0; index < 3; index += 1) {
    const sparkleX = -width * 0.22 + (index * width * 0.22);
    const sparkleY = height * 0.28;
    overlayContext.beginPath();
    overlayContext.moveTo(sparkleX, sparkleY - 8);
    overlayContext.lineTo(sparkleX + 3, sparkleY - 2.4);
    overlayContext.lineTo(sparkleX + 8, sparkleY);
    overlayContext.lineTo(sparkleX + 3, sparkleY + 2.4);
    overlayContext.lineTo(sparkleX, sparkleY + 8);
    overlayContext.lineTo(sparkleX - 3, sparkleY + 2.4);
    overlayContext.lineTo(sparkleX - 8, sparkleY);
    overlayContext.lineTo(sparkleX - 3, sparkleY - 2.4);
    overlayContext.closePath();
    overlayContext.fill();
  }

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
  } else if (segment.effect === "inkslap") {
    drawInkSlap(segment);
  } else if (segment.effect === "confetti") {
    drawConfetti(segment);
  } else if (segment.effect === "zap") {
    drawZap(segment);
  } else if (segment.effect === "heartburst") {
    drawHeartburst(segment);
  } else if (segment.effect === "bullet") {
    drawBullet(segment);
  } else if (segment.effect === "stickman") {
    drawStickman(segment);
  } else if (segment.effect === "stickerslap") {
    drawStickerSlap(segment);
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
