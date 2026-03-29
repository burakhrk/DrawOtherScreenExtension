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
  const background = pick(seed, ["#FFE2A8", "#FFD0C7", "#D7E5FF", "#DFF5E4", "#F6D7FF"], 2);
  const accent = pick(seed, ["#EF6A48", "#4C74FF", "#26A95D", "#7A4DFF", "#FF5B7C"], 6);
  const skin = pick(seed, ["#F6C7A1", "#E9B18A", "#D6956E", "#B97558"], 10);
  const hair = pick(seed, ["#201D17", "#5E4637", "#C85B28", "#F0D37D", "#422F24"], 14);
  const eyeOffset = 18 + (seed % 4);
  const mouthMode = seed % 3;
  const hairMode = (seed >> 3) % 4;
  const accessoryMode = (seed >> 5) % 4;
  const cheek = (seed >> 7) % 2 === 0;

  const mouth = mouthMode === 0
    ? `<path d="M39 52c4 4 10 4 14 0" stroke="#201D17" stroke-width="3.2" stroke-linecap="round" fill="none"/>`
    : mouthMode === 1
      ? `<path d="M39 54c5-2 9-2 14 0" stroke="#201D17" stroke-width="3.2" stroke-linecap="round" fill="none"/>`
      : `<ellipse cx="46" cy="54" rx="5.5" ry="3.6" fill="#201D17"/>`;

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
      ? `<path d="M28 18h36l-4 9H32l-4-9Z" fill="${accent}"/><rect x="34" y="27" width="24" height="4" rx="2" fill="#201D17" opacity="0.14"/>`
      : accessoryMode === 2
        ? `<path d="M64 18c8 0 12 5 12 11-6-1-12 0-16 3 0-6 0-10 4-14Z" fill="${accent}"/>`
        : "";

  const cheeks = cheek
    ? `<circle cx="31" cy="49" r="3.4" fill="#F8A7A9" opacity="0.55"/><circle cx="61" cy="49" r="3.4" fill="#F8A7A9" opacity="0.55"/>`
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
      ${accessory}
      ${hairShape}
      <ellipse cx="46" cy="48" rx="24" ry="26" fill="${skin}"/>
      ${cheeks}
      <circle cx="${46 - eyeOffset / 2}" cy="43" r="3.6" fill="#201D17"/>
      <circle cx="${46 + eyeOffset / 2}" cy="43" r="3.6" fill="#201D17"/>
      <circle cx="${46 - eyeOffset / 2 - 1}" cy="42" r="1.1" fill="white" opacity="0.9"/>
      <circle cx="${46 + eyeOffset / 2 - 1}" cy="42" r="1.1" fill="white" opacity="0.9"/>
      ${mouth}
      <text x="46" y="82" text-anchor="middle" font-size="11" font-weight="800" fill="#201D17" opacity="0.68">${initials}</text>
    </svg>
  `;

  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}
