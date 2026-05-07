import { supabase } from "./supabase";

export async function sendPushNotification(
  recipientId: string,
  message: string,
  senderId?: string
) {
  try {
    if (!recipientId) return;

    // Safety check: never send a push to the sender.
    if (senderId && recipientId === senderId) {
      console.log("⏭️ Skipped push: recipient is sender");
      return;
    }

    const { data, error } = await supabase
      .from("users")
      .select("expo_push_token")
      .eq("id", recipientId)
      .single();

    if (error || !data?.expo_push_token) {
      console.log("❌ No push token found for recipient");
      return;
    }

    const token = data.expo_push_token;

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
        data: {
          recipientId,
          senderId,
        },
      }),
    });

    console.log("✅ Push sent to recipient:", recipientId);
  } catch (err) {
    console.log("❌ Push error:", err);
  }
}