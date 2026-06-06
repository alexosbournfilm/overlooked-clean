import { Platform } from "react-native";
import { supabase } from "./supabase";
import { registerForPushNotificationsAsync } from "./notifications";

const DEFAULT_NOTIFICATION_PREFERENCES = {
  direct_messages: true,
  group_messages: true,
  new_supporters: true,
  followed_submissions: true,
  submission_comments: true,
  submission_votes: true,
  city_jobs: true,
  city_creatives: true,
  job_applications: true,
  comment_replies: true,
  challenge_reminders: true,
  challenge_results: true,
};

export async function registerAndSavePushToken(userId: string) {
  if (!userId) return null;
  if (Platform.OS === "web") return null;

  try {
    const token = await registerForPushNotificationsAsync();

    // Remove this same phone token from any other account first.
    // This prevents one physical phone from being linked to multiple users.
    await supabase
      .from("users")
      .update({ expo_push_token: null })
      .eq("expo_push_token", token)
      .neq("id", userId);

    const { data: existingProfile } = await supabase
      .from("users")
      .select("notification_preferences")
      .eq("id", userId)
      .maybeSingle();

    const existingPreferences = (existingProfile as any)?.notification_preferences;
    const notificationPreferences =
      existingPreferences && typeof existingPreferences === "object"
        ? existingPreferences
        : DEFAULT_NOTIFICATION_PREFERENCES;

    let { error } = await supabase
      .from("users")
      .update({
        expo_push_token: token,
        push_token_updated_at: new Date().toISOString(),
        notification_preferences: notificationPreferences,
      })
      .eq("id", userId);

    if (error && /push_token_updated_at|notification_preferences/i.test(error.message || "")) {
      const retry = await supabase
        .from("users")
        .update({ expo_push_token: token })
        .eq("id", userId);
      error = retry.error;
    }

    if (error) {
      console.log("❌ Failed to save Expo push token:", error.message);
      return null;
    }

    console.log("✅ Expo push token saved:", token);
    return token;
  } catch (error: any) {
    console.log("❌ Push registration failed:", error?.message || error);
    return null;
  }
}
