import { supabase } from "./supabase";

export async function sendPushNotification(
  recipientId: string,
  message: string
) {
  try {
    // 1. Get recipient push token
    const { data, error } = await supabase
      .from("users")
      .select("expo_push_token")
      .eq("id", recipientId)
      .single();

    if (error || !data?.expo_push_token) {
      console.log("❌ No push token found");
      return;
    }

    const token = data.expo_push_token;

    // 2. Send to Expo
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to: token,
        sound: "default",
        title: "New message",
        body: message,
      }),
    });

    console.log("✅ Push sent");
  } catch (err) {
    console.log("❌ Push error:", err);
  }
}