import { supabase } from "./supabase";
import { registerForPushNotificationsAsync } from "./notifications";

export async function registerAndSavePushToken(userId: string) {
  if (!userId) return null;

  try {
    const token = await registerForPushNotificationsAsync();

    const { error } = await supabase
      .from("users")
      .update({ expo_push_token: token })
      .eq("id", userId);

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