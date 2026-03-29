import { PROFILE_STORAGE_KEY } from "./constants.js";
import { getLocalObject, setLocalObject } from "./chrome-storage.js";

export const DEFAULT_RUNTIME_PREFERENCES = Object.freeze({
  extensionEnabled: true,
  appearOnline: true,
  allowSurprise: true,
});

export function normalizeRuntimePreferences(source = {}) {
  return {
    extensionEnabled: source.extensionEnabled !== false,
    appearOnline: source.appearOnline !== false,
    allowSurprise: source.allowSurprise !== false,
  };
}

export async function getStoredProfile() {
  return (await getLocalObject(PROFILE_STORAGE_KEY, {})) || {};
}

export async function updateStoredProfile(patch) {
  const current = await getStoredProfile();
  const next = {
    ...current,
    ...patch,
  };
  await setLocalObject(PROFILE_STORAGE_KEY, next);
  return next;
}

export async function getLocalPreferences() {
  const profile = await getStoredProfile();
  return normalizeRuntimePreferences(profile.preferences || DEFAULT_RUNTIME_PREFERENCES);
}

export async function saveLocalPreferences(nextPreferences) {
  const profile = await getStoredProfile();
  const currentPreferences = normalizeRuntimePreferences(profile.preferences || DEFAULT_RUNTIME_PREFERENCES);
  const mergedPreferences = normalizeRuntimePreferences({
    ...currentPreferences,
    ...nextPreferences,
  });

  if (
    currentPreferences.extensionEnabled === mergedPreferences.extensionEnabled &&
    currentPreferences.appearOnline === mergedPreferences.appearOnline &&
    currentPreferences.allowSurprise === mergedPreferences.allowSurprise
  ) {
    return mergedPreferences;
  }

  await setLocalObject(PROFILE_STORAGE_KEY, {
    ...profile,
    preferences: mergedPreferences,
  });

  return mergedPreferences;
}
