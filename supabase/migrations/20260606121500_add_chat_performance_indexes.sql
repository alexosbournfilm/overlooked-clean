create index if not exists conversations_participant_ids_gin_idx
  on public.conversations using gin (participant_ids);

create index if not exists conversations_last_message_sent_at_idx
  on public.conversations (last_message_sent_at desc nulls last, created_at desc);

create index if not exists messages_conversation_sent_at_idx
  on public.messages (conversation_id, sent_at desc);

create index if not exists messages_unread_scan_idx
  on public.messages (conversation_id, sender_id, sent_at desc);

create index if not exists conversation_reads_user_conversation_idx
  on public.conversation_reads (user_id, conversation_id);

create index if not exists user_blocks_blocker_blocked_idx
  on public.user_blocks (blocker_id, blocked_id);
