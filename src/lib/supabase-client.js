import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./constants.js";
import { chromeStorageAdapter } from "./chrome-storage.js";

const supabaseGlobal =
  globalThis.supabase ||
  globalThis.window?.supabase ||
  globalThis.self?.supabase ||
  (typeof supabase !== "undefined" ? supabase : null);

const createClient = supabaseGlobal?.createClient;

if (!createClient) {
  throw new Error("Supabase istemcisi yuklenemedi. Vendor scripti veya popup HTML baglantisini kontrol et.");
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
    storage: chromeStorageAdapter,
    flowType: "pkce",
  },
});
