create or replace function public.mark_chat_notifications_read(target_conversation_id text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.app_notifications
  set read_at = coalesce(read_at, now())
  where user_id = auth.uid()
    and read_at is null
    and notification_type = 'message'
    and data #>> '{params,conversationId}' = target_conversation_id;
$$;

revoke all on function public.mark_chat_notifications_read(text) from public;
grant execute on function public.mark_chat_notifications_read(text) to authenticated;
