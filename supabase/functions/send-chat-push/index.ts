import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type WebhookBody = {
  record?: {
    id: string;
    conversation_id: string;
    sender_id: string;
    content: string | null;
    message_type?: string | null;
  };
};

type ConversationRow = {
  id: string;
  is_group: boolean;
  participant_ids: string[];
  label: string | null;
};

type SenderRow = {
  id: string;
  full_name: string | null;
};

type UserRow = {
  id: string;
  full_name: string | null;
  expo_push_token: string | null;
};

serve(async (req: Request): Promise<Response> => {
  try {
    const body = (await req.json()) as WebhookBody;
    const record = body.record;

    if (!record) {
      return new Response(JSON.stringify({ error: "Missing record" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const conversationId = record.conversation_id;
    const senderId = record.sender_id;
    const rawContent = record.content ?? "";

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const { data: conversation, error: convoError } = await supabase
      .from("conversations")
      .select("id, is_group, participant_ids, label")
      .eq("id", conversationId)
      .single<ConversationRow>();

    if (convoError || !conversation) {
      return new Response(
        JSON.stringify({
          error: convoError?.message ?? "Conversation not found",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const recipientIds = (conversation.participant_ids || []).filter(
      (id: string) => id !== senderId
    );

    if (!recipientIds.length) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "No recipients" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const { data: sender, error: senderError } = await supabase
      .from("users")
      .select("id, full_name")
      .eq("id", senderId)
      .single<SenderRow>();

    if (senderError) {
      return new Response(JSON.stringify({ error: senderError.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { data: recipients, error: recipientsError } = await supabase
      .from("users")
      .select("id, full_name, expo_push_token")
      .in("id", recipientIds);

    if (recipientsError) {
      return new Response(JSON.stringify({ error: recipientsError.message }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const validRecipients = ((recipients ?? []) as UserRow[]).filter(
      (user) => !!user.expo_push_token
    );

    if (!validRecipients.length) {
      return new Response(
        JSON.stringify({ ok: true, skipped: "No push tokens" }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const senderName = sender?.full_name || "New message";

    const bodyText = rawContent.startsWith("image:")
      ? "📷 Photo"
      : rawContent.startsWith("📎 File:")
      ? rawContent
      : rawContent || "New message";

    const pushMessages = validRecipients.map((user) => ({
      to: user.expo_push_token as string,
      sound: "default",
      title: senderName,
      body: bodyText,
      data: {
        screen: "ChatRoom",
        params: {
          conversationId,
        },
      },
    }));

    const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(pushMessages),
    });

    const expoResult = await expoResponse.json();

    return new Response(JSON.stringify({ ok: true, expoResult }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown send-chat-push error";

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});