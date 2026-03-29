import { APP_ID } from "./constants.js";
import { track } from "./analytics.js";
import { getBestDisplayName, getCurrentUser } from "./auth.js";
import { resolveEntitlement } from "./entitlements.js";
import { supabase } from "./supabase-client.js";

function toFriendlyError(error) {
  if (error?.code === "P0001" && String(error.message || "").includes("Unknown or inactive app_id")) {
    return new Error(
      `Supabase does not have an active app entry for "${APP_ID}" yet. Add or activate this app_id in your shared project first.`,
    );
  }

  return error;
}

async function rpc(fn, args = {}) {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    throw toFriendlyError(error);
  }
  return data;
}

function enrichState(rawState, user) {
  const ownProfile = rawState.own_profile ?? null;
  const profileName = getBestDisplayName(user, ownProfile);
  const incomingRequests = (rawState.incoming_requests ?? []).map((item) => {
    return {
      id: item.id,
      userId: item.requester_id,
      displayName: item.profile?.display_name || "Sketch Party user",
      avatarUrl: item.profile?.avatar_url || null,
      status: item.status,
      createdAt: item.created_at,
    };
  });

  const outgoingRequests = (rawState.outgoing_requests ?? []).map((item) => {
    return {
      id: item.id,
      userId: item.recipient_id,
      displayName: item.profile?.display_name || "Sketch Party user",
      avatarUrl: item.profile?.avatar_url || null,
      status: item.status,
      createdAt: item.created_at,
    };
  });

  const friends = (rawState.accepted_friends ?? []).map((item) => {
    return {
      friendshipId: item.friendship_id,
      userId: item.friend_user_id,
      displayName: item.profile?.display_name || "Sketch Party user",
      avatarUrl: item.profile?.avatar_url || null,
      createdAt: item.created_at,
      online: item.visible_online === true,
      preferences: {
        extensionEnabled: item.preferences?.extension_enabled !== false,
        appearOnline: item.preferences?.appear_online !== false,
        allowSurprise: item.preferences?.allow_surprise !== false,
      },
    };
  });

  return {
    appId: APP_ID,
    user: {
      id: user.id,
      email: user.email || "",
      displayName: profileName,
      avatarUrl: ownProfile?.avatar_url || user.user_metadata?.avatar_url || null,
    },
    entitlement: resolveEntitlement(user),
    preferences: {
      extensionEnabled: rawState.preferences?.extension_enabled !== false,
      appearOnline: rawState.preferences?.appear_online !== false,
      allowSurprise: rawState.preferences?.allow_surprise !== false,
    },
    incomingRequests,
    outgoingRequests,
    friends,
    activeSessions: rawState.active_sessions ?? [],
    raw: rawState,
  };
}

async function getSocialStateInternal() {
  const user = await getCurrentUser();
  if (!user) {
    return null;
  }

  const rawState = await rpc("get_social_state", { p_app_id: APP_ID });
  const state = enrichState(rawState, user);

  await track("Loaded Social State", {
    surface: "extension",
    screen: "bootstrap",
    result: "success",
  });

  return state;
}

export async function bootstrap() {
  return getSocialStateInternal();
}

export async function getSocialState() {
  return getSocialStateInternal();
}

export async function sendFriendRequest(recipientId) {
  await rpc("send_friend_request", { p_app_id: APP_ID, p_recipient_id: recipientId });
  await track("Sent Friend Request", {
    surface: "board",
    targetUserId: recipientId,
    result: "success",
  });
  return getSocialStateInternal();
}

export async function acceptFriendRequest(requestId) {
  await rpc("accept_friend_request", { p_request_id: requestId });
  await track("Accepted Friend Request", {
    surface: "board",
    result: "success",
  });
  return getSocialStateInternal();
}

export async function rejectFriendRequest(requestId) {
  await rpc("reject_friend_request", { p_request_id: requestId });
  await track("Rejected Friend Request", {
    surface: "board",
    result: "success",
  });
  return getSocialStateInternal();
}

export async function startSession(targetUserId, mode) {
  const session = await rpc("start_session", {
    p_app_id: APP_ID,
    p_target_user_id: targetUserId,
    p_mode: mode,
  });
  await track("Started Session", {
    surface: "board",
    targetUserId,
    mode,
    result: "success",
  });
  return session;
}

export async function endSession(sessionId) {
  await rpc("end_session", { p_session_id: sessionId });
  await track("Ended Session", {
    surface: "board",
    result: "success",
  });
}

export async function setPreferences({ extensionEnabled, appearOnline, allowSurprise }) {
  await rpc("set_app_preferences", {
    p_app_id: APP_ID,
    p_extension_enabled: extensionEnabled,
    p_appear_online: appearOnline,
    p_allow_surprise: allowSurprise,
  });
  await track("Updated Preferences", {
    surface: "popup",
    result: "success",
  });
  return getSocialStateInternal();
}

export async function updateProfile(displayName) {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("No active session was found.");
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      display_name: displayName,
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", user.id);

  if (error) {
    throw error;
  }

  return getSocialStateInternal();
}
