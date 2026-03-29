import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./constants.js";
import { chromeStorageAdapter } from "./chrome-storage.js";

const supabaseGlobal =
  globalThis["supabase"] ||
  globalThis.window?.["supabase"] ||
  globalThis.self?.["supabase"] ||
  null;

const createClient = supabaseGlobal?.createClient;

if (!createClient) {
  throw new Error("Supabase client could not be loaded. Check the vendor script and popup HTML reference.");
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
