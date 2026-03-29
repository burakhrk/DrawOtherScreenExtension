function hashSeed(input) {
  let hash = 2166136261;
  const safe = String(input || "sketch-party");
  for (let index = 0; index < safe.length; index += 1) {
    hash ^= safe.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function pick(seed, values, shift = 0) {
  return values[(seed >> shift) % values.length];
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function getSketchPartyAvatarDataUrl(seedInput, label = "Sketch Party user") {
  const seed = hashSeed(seedInput);
  const background = pick(seed, ["#FFF2BF", "#FFD7CF", "#DCE8FF", "#E1F6E7", "#F3E0FF", "#FFEBD2"], 2);
  const accent = pick(seed, ["#EF6A48", "#4C74FF", "#26A95D", "#7A4DFF", "#FF5B7C", "#FF9A2F"], 6);
  const skin = pick(seed, ["#FBE8D8", "#F7DCC7", "#EFCAB0", "#E4BA97"], 10);
  const hair = pick(seed, ["#5E4637", "#7A5A45", "#B85C2B", "#E0B14F", "#8A6550"], 14);
  const faceShape = (seed >> 3) % 3;
  const eyeMode = (seed >> 5) % 2;
  const mouthMode = (seed >> 7) % 3;
  const accessoryMode = (seed >> 9) % 5;
  const hasConfetti = (seed >> 11) % 2 === 0;

  const face = faceShape === 0
    ? `<ellipse cx="46" cy="49" rx="24" ry="26" fill="${skin}"/>`
    : faceShape === 1
      ? `<rect x="23" y="25" width="46" height="50" rx="22" fill="${skin}"/>`
      : `<path d="M46 24c14 0 25 11 25 24 0 17-10 29-25 29S21 65 21 48c0-13 11-24 25-24Z" fill="${skin}"/>`;

  const hairShape = faceShape === 0
    ? `<path d="M24 34c4-11 12-17 22-17 11 0 19 6 22 17-7-4-14-6-22-6s-15 2-22 6Z" fill="${hair}"/>`
    : faceShape === 1
      ? `<path d="M24 33c5-10 12-16 22-16 10 0 18 6 22 16-7-3-14-5-22-5s-15 2-22 5Z" fill="${hair}"/>`
      : `<path d="M23 34c4-10 13-17 23-17 11 0 19 7 23 17-8-4-15-6-23-6s-15 2-23 6Z" fill="${hair}"/>`;

  const eyes = eyeMode === 0
    ? `
      <circle cx="38" cy="46" r="3.2" fill="#201D17"/>
      <circle cx="54" cy="46" r="3.2" fill="#201D17"/>
      <circle cx="37.1" cy="45.2" r="1" fill="#FFFFFF" opacity="0.95"/>
      <circle cx="53.1" cy="45.2" r="1" fill="#FFFFFF" opacity="0.95"/>
    `
    : `
      <path d="M34 46c3-3 7-3 10 0" stroke="#201D17" stroke-width="2.8" stroke-linecap="round" fill="none"/>
      <path d="M48 46c3-3 7-3 10 0" stroke="#201D17" stroke-width="2.8" stroke-linecap="round" fill="none"/>
    `;

  const mouth = mouthMode === 0
    ? `<path d="M39 57c4 4 10 4 14 0" stroke="#201D17" stroke-width="3" stroke-linecap="round" fill="none"/>`
    : mouthMode === 1
      ? `<path d="M40 58c4-2 8-2 12 0" stroke="#201D17" stroke-width="3" stroke-linecap="round" fill="none"/>`
      : `<ellipse cx="46" cy="57" rx="4.7" ry="3" fill="#201D17"/>`;

  const accessory = accessoryMode === 0
    ? `<path d="M34 19 46 8 58 19v3H34v-3Z" fill="${accent}"/><path d="M46 8v13" stroke="#FFFDF7" stroke-width="2.4" stroke-linecap="round"/><circle cx="46" cy="7" r="3" fill="#FFFDF7"/>`
    : accessoryMode === 1
      ? `<circle cx="36" cy="45" r="7" fill="none" stroke="${accent}" stroke-width="3"/><circle cx="56" cy="45" r="7" fill="none" stroke="${accent}" stroke-width="3"/><path d="M43 45h6" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>`
      : accessoryMode === 2
        ? `<path d="M31 26c7-6 23-6 30 0" stroke="${accent}" stroke-width="4" stroke-linecap="round" fill="none"/>`
        : accessoryMode === 3
          ? `<path d="M31 22h30l-4 7H35l-4-7Z" fill="${accent}"/><circle cx="46" cy="20" r="3" fill="#FFFDF7"/>`
          : `<path d="M35 63c3 4 20 4 23 0" stroke="#201D17" stroke-width="2.5" stroke-linecap="round" fill="none"/><path d="M37 63c2 2 4 4 6 4M55 63c-2 2-4 4-6 4" stroke="#201D17" stroke-width="2.5" stroke-linecap="round"/>`;

  const confetti = hasConfetti
    ? `
      <circle cx="17" cy="18" r="4" fill="${accent}" opacity="0.34"/>
      <circle cx="73" cy="20" r="3" fill="#FFFDF7" opacity="0.92"/>
      <rect x="70" y="67" width="8" height="8" rx="2" fill="${accent}" opacity="0.28" transform="rotate(16 74 71)"/>
    `
    : "";

  const initials = escapeXml(
    label
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "SP",
  );

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 92 92" role="img" aria-label="${escapeXml(label)}">
      <rect width="92" height="92" rx="26" fill="${background}"/>
      <rect x="6" y="6" width="80" height="80" rx="22" fill="#FFF9F0" opacity="0.78"/>
      ${confetti}
      <circle cx="72" cy="18" r="9" fill="${accent}" opacity="0.16"/>
      <circle cx="18" cy="74" r="10" fill="${accent}" opacity="0.1"/>
      <ellipse cx="46" cy="63" rx="29" ry="20" fill="#FFF8EE"/>
      ${hairShape}
      ${face}
      ${eyes}
      ${mouth}
      ${accessory}
      <circle cx="35" cy="53" r="2.8" fill="#F6A5AF" opacity="0.45"/>
      <circle cx="57" cy="53" r="2.8" fill="#F6A5AF" opacity="0.45"/>
      <text x="46" y="82" text-anchor="middle" font-size="11" font-weight="800" fill="#201D17" opacity="0.68">${initials}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
