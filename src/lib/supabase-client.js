import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./constants.js";
import { chromeStorageAdapter } from "./chrome-storage.js";

const createClient = globalThis.supabase?.createClient;

if (!createClient) {
  throw new Error("Supabase istemcisi yuklenemedi.");
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
