const PARTY_CODE_LENGTH = 5;
const PARTY_CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function normalizeUuid(value) {
  return String(value || "").trim().toLowerCase();
}

function hashUuid(value) {
  const normalized = normalizeUuid(value);
  let hash = 2166136261;

  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

export function isUuidLike(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || "").trim());
}

export function isPartyCode(value) {
  return /^[A-Z0-9]{5}$/.test(String(value || "").trim());
}

export function createPartyCode(userId) {
  let hash = hashUuid(userId);
  let output = "";

  for (let index = 0; index < PARTY_CODE_LENGTH; index += 1) {
    output += PARTY_CODE_ALPHABET[hash % PARTY_CODE_ALPHABET.length];
    hash = Math.floor(hash / PARTY_CODE_ALPHABET.length);
  }

  return output;
}

export function normalizePartyIdentifier(value) {
  return String(value || "").trim();
}
