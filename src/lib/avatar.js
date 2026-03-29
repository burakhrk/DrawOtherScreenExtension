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
  const background = pick(seed, ["#FFE2A8", "#FFD0C7", "#D7E5FF", "#DFF5E4", "#F6D7FF", "#FFE6C6"], 2);
  const accent = pick(seed, ["#EF6A48", "#4C74FF", "#26A95D", "#7A4DFF", "#FF5B7C", "#FF8C2B"], 6);
  const skin = pick(seed, ["#F6C7A1", "#E9B18A", "#D6956E", "#B97558"], 10);
  const hair = pick(seed, ["#201D17", "#5E4637", "#C85B28", "#F0D37D", "#422F24"], 14);
  const eyeOffset = 18 + (seed % 4);
  const mouthMode = seed % 4;
  const hairMode = (seed >> 3) % 4;
  const accessoryMode = (seed >> 5) % 6;
  const cheek = (seed >> 7) % 2 === 0;
  const eyeMode = (seed >> 9) % 3;
  const browTilt = (seed >> 11) % 2 === 0 ? -1 : 1;
  const hasConfetti = (seed >> 13) % 2 === 0;
  const hasSticker = (seed >> 15) % 2 === 0;
  const partyBand = pick(seed, ["#201D17", "#FFFFFF", "#FFE77A", "#FBE4F5"], 17);

  const mouth = mouthMode === 0
    ? `<path d="M39 52c4 4 10 4 14 0" stroke="#201D17" stroke-width="3.2" stroke-linecap="round" fill="none"/>`
    : mouthMode === 1
      ? `<path d="M39 54c5-2 9-2 14 0" stroke="#201D17" stroke-width="3.2" stroke-linecap="round" fill="none"/>`
      : mouthMode === 2
        ? `<ellipse cx="46" cy="54" rx="5.5" ry="3.6" fill="#201D17"/>`
        : `<path d="M39 54c2 5 12 5 14 0" stroke="#201D17" stroke-width="3.2" stroke-linecap="round" fill="none"/><path d="M42 55h8v4c0 2-2 3-4 3s-4-1-4-3v-4Z" fill="#FF6B7A"/>`;

  const hairShape = hairMode === 0
    ? `<path d="M23 33c2-15 13-22 25-22 12 0 22 8 25 21-7-7-15-11-25-11-9 0-18 4-25 12Z" fill="${hair}"/>`
    : hairMode === 1
      ? `<path d="M22 36c0-14 11-25 25-25 13 0 24 8 27 21-6-5-12-8-19-8-8 0-14 3-19 7-4-3-8-4-14 5Z" fill="${hair}"/>`
      : hairMode === 2
        ? `<path d="M24 34c4-13 14-20 24-20 12 0 20 7 24 20-6-4-12-6-18-6-7 0-14 2-20 6-3-1-6-1-10 0Z" fill="${hair}"/>`
        : `<path d="M21 36c4-15 14-24 26-24 13 0 23 9 26 24-8-6-15-8-26-8-10 0-18 2-26 8Z" fill="${hair}"/>`;

  const accessory = accessoryMode === 0
    ? `<circle cx="30" cy="26" r="5" fill="${accent}"/><circle cx="62" cy="26" r="5" fill="${accent}"/><rect x="30" y="23" width="32" height="6" rx="3" fill="${accent}"/>`
    : accessoryMode === 1
      ? `<path d="M28 18h36l-4 9H32l-4-9Z" fill="${accent}"/><rect x="34" y="27" width="24" height="4" rx="2" fill="#201D17" opacity="0.14"/><circle cx="46" cy="15" r="4" fill="${partyBand}"/>`
    : accessoryMode === 2
        ? `<path d="M64 18c8 0 12 5 12 11-6-1-12 0-16 3 0-6 0-10 4-14Z" fill="${accent}"/>`
        : accessoryMode === 3
          ? `<path d="M24 24c8-11 36-11 44 0l-4 3c-8-7-28-7-36 0l-4-3Z" fill="${accent}"/><circle cx="28" cy="24" r="4" fill="${partyBand}"/><circle cx="64" cy="24" r="4" fill="${partyBand}"/>`
          : accessoryMode === 4
            ? `<path d="M32 16 46 6 60 16v3H32v-3Z" fill="${accent}"/><path d="M46 6v13" stroke="${partyBand}" stroke-width="3" stroke-linecap="round"/><circle cx="46" cy="5" r="3.5" fill="${partyBand}"/>`
            : `<path d="M30 26c5-4 27-4 32 0" stroke="${accent}" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M34 28c2 3 4 5 6 6M58 28c-2 3-4 5-6 6" stroke="${accent}" stroke-width="3" stroke-linecap="round"/>`;

  const cheeks = cheek
    ? `<circle cx="31" cy="49" r="3.4" fill="#F8A7A9" opacity="0.55"/><circle cx="61" cy="49" r="3.4" fill="#F8A7A9" opacity="0.55"/>`
    : "";

  const confetti = hasConfetti
    ? `
      <circle cx="16" cy="20" r="4" fill="${accent}" opacity="0.35"/>
      <rect x="70" y="66" width="9" height="9" rx="3" fill="${accent}" opacity="0.28" transform="rotate(18 74.5 70.5)"/>
      <path d="M14 66c4-4 8-4 12 0" stroke="${accent}" stroke-width="3" stroke-linecap="round" opacity="0.35"/>
      <path d="M72 24c3 0 6 2 8 5" stroke="${partyBand}" stroke-width="3" stroke-linecap="round" opacity="0.45"/>
    `
    : "";

  const sticker = hasSticker
    ? `<path d="M69 71c0-4 3-7 7-7v9c0 2-1 3-3 3h-8c2-1 4-3 4-5Z" fill="#FFF7E8" opacity="0.82"/>`
    : "";

  const brows = `
    <path d="M${33 - browTilt} 35c4-2 8-2 12 0" stroke="#201D17" stroke-width="3" stroke-linecap="round" fill="none"/>
    <path d="M${47 + browTilt} 35c4-2 8-2 12 0" stroke="#201D17" stroke-width="3" stroke-linecap="round" fill="none"/>
  `;

  const eyes = eyeMode === 0
    ? `
      <circle cx="${46 - eyeOffset / 2}" cy="43" r="3.6" fill="#201D17"/>
      <circle cx="${46 + eyeOffset / 2}" cy="43" r="3.6" fill="#201D17"/>
      <circle cx="${46 - eyeOffset / 2 - 1}" cy="42" r="1.1" fill="white" opacity="0.9"/>
      <circle cx="${46 + eyeOffset / 2 - 1}" cy="42" r="1.1" fill="white" opacity="0.9"/>
    `
    : eyeMode === 1
      ? `
        <path d="M${35 - eyeOffset / 4} 43c3-4 7-4 10 0" stroke="#201D17" stroke-width="3.2" stroke-linecap="round" fill="none"/>
        <path d="M${47 + eyeOffset / 4} 43c3-4 7-4 10 0" stroke="#201D17" stroke-width="3.2" stroke-linecap="round" fill="none"/>
      `
      : `
        <ellipse cx="${46 - eyeOffset / 2}" cy="43" rx="4.4" ry="2.8" fill="#FFFFFF" stroke="#201D17" stroke-width="2"/>
        <ellipse cx="${46 + eyeOffset / 2}" cy="43" rx="4.4" ry="2.8" fill="#FFFFFF" stroke="#201D17" stroke-width="2"/>
        <circle cx="${46 - eyeOffset / 2}" cy="43" r="1.8" fill="#201D17"/>
        <circle cx="${46 + eyeOffset / 2}" cy="43" r="1.8" fill="#201D17"/>
      `;

  const extraFaceDetail = accessoryMode === 5
    ? `<path d="M37 58c4-3 14-3 18 0" stroke="#201D17" stroke-width="2.8" stroke-linecap="round" fill="none"/><path d="M34 52c2 2 4 4 6 4M58 52c-2 2-4 4-6 4" stroke="#201D17" stroke-width="2.8" stroke-linecap="round"/>`
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
      <circle cx="72" cy="18" r="10" fill="${accent}" opacity="0.18"/>
      <circle cx="20" cy="76" r="12" fill="${accent}" opacity="0.12"/>
      ${confetti}
      ${sticker}
      ${accessory}
      ${hairShape}
      <ellipse cx="46" cy="48" rx="24" ry="26" fill="${skin}"/>
      ${cheeks}
      ${brows}
      ${eyes}
      ${mouth}
      ${extraFaceDetail}
      <text x="46" y="82" text-anchor="middle" font-size="11" font-weight="800" fill="#201D17" opacity="0.68">${initials}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
