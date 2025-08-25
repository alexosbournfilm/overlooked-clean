import React, { useLayoutEffect, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  TextInput,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { COLORS } from '../theme/colors';
import { supabase } from '../lib/supabase';
import { formatDistanceToNow } from 'date-fns';

export default function ChatsScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [loadingCityChat, setLoadingCityChat] = useState(false);
  const [loadingChats, setLoadingChats] = useState(true);
  const [chats, setChats] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  // Small helper for flags (expects ISO 3166-1 alpha-2)
  const getFlagUri = (countryCode?: string | null) => {
    if (!countryCode) return null;
    // FlagCDN requires lowercase alpha-2
    return `https://flagcdn.com/w80/${String(countryCode).toLowerCase()}.png`;
  };

  // ---- GOOD fetch (participant-scoped + correct ordering) ----
  const fetchUserChats = async () => {
    try {
      setLoadingChats(true);

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        console.error('Error fetching user:', userError?.message);
        return;
      }
      const userId = userData.user.id;

      const { data: conversations, error } = await supabase
        .from('conversations')
        .select(
          'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at'
        )
        .contains('participant_ids', [userId])
        .order('last_message_sent_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching conversations:', error.message);
        return;
      }

      // Build a unique list of "peer" user IDs for 1-1/chats (the other participant)
      const peerIdsSet = new Set<string>();
      // Collect city IDs for city groups so we can show city name + flag
      const cityIdsSet = new Set<number>();

      (conversations ?? []).forEach((c) => {
        if (!c.is_group) {
          const other = (c.participant_ids || []).find((pid: string) => pid !== userId);
          if (other) peerIdsSet.add(other);
        } else if (c.is_city_group && typeof c.city_id === 'number') {
          cityIdsSet.add(c.city_id);
        }
      });

      const peerIds = Array.from(peerIdsSet);
      const cityIds = Array.from(cityIdsSet);

      // Batch fetch peer user profiles
      let peerMap: Record<string, { id: string; full_name: string; avatar_url: string | null }> = {};
      if (peerIds.length) {
        const { data: peers, error: peersErr } = await supabase
          .from('users')
          .select('id, full_name, avatar_url')
          .in('id', peerIds);
        if (!peersErr && peers) {
          peers.forEach((u) => {
            peerMap[u.id] = {
              id: u.id,
              full_name: u.full_name,
              avatar_url: u.avatar_url ?? null,
            };
          });
        }
      }

      // Batch fetch cities for city groups (⚠️ use "name", not "city")
      let cityMap: Record<
        number,
        { id: number; name: string; country_code: string | null }
      > = {};
      if (cityIds.length) {
        const { data: cities, error: citiesErr } = await supabase
          .from('cities')
          .select('id, name, country_code')
          .in('id', cityIds);

        if (!citiesErr && cities) {
          cities.forEach((ct) => {
            cityMap[ct.id] = { id: ct.id, name: ct.name, country_code: ct.country_code ?? null };
          });
        }
      }

      // Enhance with last message + typing + derived title/avatar for 1-1
      const chatsWithMetadata = await Promise.all(
        (conversations ?? []).map(async (conv) => {
          let lastContent = conv.last_message_content as string | null;
          let lastTime = conv.last_message_sent_at as string | null;

          if (!lastContent || !lastTime) {
            const { data: messages } = await supabase
              .from('messages')
              .select('content, sent_at, sender_id')
              .eq('conversation_id', conv.id)
              .order('sent_at', { ascending: false })
              .limit(1);

            const lastMessage = messages?.[0];
            lastContent = lastContent || lastMessage?.content || 'No messages yet';
            lastTime = lastTime || lastMessage?.sent_at || null;
          }

          // Typing indicator (any other user typing)
          const { data: userData2 } = await supabase.auth.getUser();
          const me = userData2?.user?.id;
          const { data: typingData } = await supabase
            .from('typing_indicators')
            .select('user_id')
            .eq('conversation_id', conv.id)
            .neq('user_id', me as string)
            .maybeSingle();
          const isTyping = typingData !== null;

          // Derive WhatsApp-style title & avatar for 1-1
          let derivedTitle: string | undefined;
          let peerUser:
            | { id: string; full_name: string; avatar_url: string | null }
            | undefined;

          // For city groups, attach city + country
          let cityInfo:
            | { name: string | undefined; country_code: string | null; flagUri: string | null }
            | undefined;

          if (!conv.is_group) {
            const otherId = (conv.participant_ids || []).find((pid: string) => pid !== me);
            if (otherId) {
              peerUser = peerMap[otherId];
              derivedTitle = peerUser?.full_name || 'Conversation';
            } else {
              derivedTitle = 'Conversation';
            }
          } else if (conv.is_city_group && typeof conv.city_id === 'number') {
            const c = cityMap[conv.city_id];
            const cityName = c?.name;
            const flagUri = getFlagUri(c?.country_code ?? null);
            cityInfo = { name: cityName, country_code: c?.country_code ?? null, flagUri };
          }

          return {
            ...conv,
            lastMessage: lastContent || 'No messages yet',
            lastMessageTime: lastTime || conv.created_at,
            isTyping,
            derivedTitle, // for 1-1 display
            peerUser,     // for avatar + header in ChatRoom
            cityInfo,     // for city group display (name + flag)
          };
        })
      );

      setChats(chatsWithMetadata);
    } finally {
      setLoadingChats(false);
    }
  };

  useLayoutEffect(() => {
    navigation.getParent()?.setOptions({
      title: 'Chats',
      headerTitleAlign: 'center',
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.navigate('Settings')}>
          <Ionicons
            name="settings-outline"
            size={22}
            color={COLORS.textPrimary}
            style={{ marginRight: 16 }}
          />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  // Initial load uses the GOOD fetch
  useEffect(() => {
    fetchUserChats();
  }, []);

  // Realtime listeners keep the list fresh (messages + conversation updates)
  useEffect(() => {
    let convoChannel: any;
    let msgChannel: any;

    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Any change to conversations (joins, leaves, last message updates)
      convoChannel = supabase
        .channel('realtime-conversations')
        .on(
          'postgres_changes',
          { event: '*', schema: 'public', table: 'conversations' },
          () => {
            fetchUserChats();
          }
        )
        .subscribe();

      // New messages bump ordering quickly
      msgChannel = supabase
        .channel('realtime-messages')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'messages' },
          () => {
            fetchUserChats();
          }
        )
        .subscribe();
    })();

    return () => {
      if (convoChannel) supabase.removeChannel(convoChannel);
      if (msgChannel) supabase.removeChannel(msgChannel);
    };
  }, []);

  // Join flows (ID-first; legacy label kept)
  useEffect(() => {
    if (route.params?.groupChatCityId) {
      handleJoinCityById(route.params.groupChatCityId);
    } else if (route.params?.groupChatCity) {
      handleGroupChatJoinLegacy(route.params.groupChatCity);
    }
  }, [route.params]);

  // NEW (recommended): join by city ID using the join_city_group RPC
  const handleJoinCityById = async (cityId: number) => {
    try {
      setLoadingCityChat(true);

      const { data: auth } = await supabase.auth.getUser();
      if (!auth?.user) throw new Error('You must be signed in.');

      const { data: conversationId, error } = await supabase.rpc(
        'join_city_group',
        { city_id_input: cityId }
      );
      if (error) throw error;

      const { data: convo, error: convoErr } = await supabase
        .from('conversations')
        .select(
          'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at'
        )
        .eq('id', conversationId)
        .single();
      if (convoErr) throw convoErr;

      navigation.navigate('ChatRoom', { conversation: convo });
    } catch (e: any) {
      console.error(e);
      Alert.alert('Couldn’t join city chat', String(e?.message ?? e));
    } finally {
      setLoadingCityChat(false);
    }
  };

  // Legacy label-based flow (kept so older callers don’t crash)
  const handleGroupChatJoinLegacy = async (cityLabel: string) => {
    try {
      setLoadingCityChat(true);

      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        throw new Error(userError?.message || 'Not signed in');
      }

      const user = userData.user;
      const label = cityLabel.toLowerCase();

      const { data: existingChats, error: findErr } = await supabase
        .from('conversations')
        .select(
          'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at'
        )
        .eq('is_group', true)
        .eq('label', label)
        .limit(1);

      if (findErr) throw findErr;

      let chat = existingChats?.[0];

      if (!chat) {
        const { data: newChat, error: insertError } = await supabase
          .from('conversations')
          .insert([
            {
              is_group: true,
              is_city_group: false,
              participant_ids: [user.id],
              label,
            },
          ])
          .select(
            'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at'
          )
          .single();

        if (insertError) throw insertError;
        chat = newChat;
      } else if (!(chat.participant_ids || []).includes(user.id)) {
        const updatedParticipants = Array.from(
          new Set([...(chat.participant_ids || []), user.id])
        );

        const { data: updated, error: updateError } = await supabase
          .from('conversations')
          .update({ participant_ids: updatedParticipants })
          .eq('id', chat.id)
          .select(
            'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at'
          )
          .single();

        if (updateError) throw updateError;
        chat = updated;
      }

      navigation.navigate('ChatRoom', { conversation: chat });
    } catch (e: any) {
      console.error(e);
      Alert.alert('Couldn’t join group chat', String(e?.message ?? e));
    } finally {
      setLoadingCityChat(false);
    }
  };

  const renderItem = ({ item }: any) => {
    const showTyping = item.isTyping;
    const timeAgo = item.lastMessageTime
      ? formatDistanceToNow(new Date(item.lastMessageTime), { addSuffix: true })
      : '';

    // Titles:
    // - 1-1: derivedTitle
    // - City group: city name
    // - Other groups: existing label with "Group: " prefix
    const title = item.is_group
      ? item.is_city_group
        ? (item.cityInfo?.name || item.label || 'City')
        : item.label
        ? `Group: ${item.label}`
        : 'Group Chat'
      : item.derivedTitle || 'Conversation';

    // Avatars:
    // - 1-1: peer avatar
    // - City group: circular country flag
    const avatarUri = !item.is_group
      ? item?.peerUser?.avatar_url || 'https://i.pravatar.cc/100'
      : item.is_city_group
      ? (item.cityInfo?.flagUri || undefined)
      : undefined;

    // Member count (WhatsApp-style): based on participant_ids length
    const memberCount = Array.isArray(item.participant_ids) ? item.participant_ids.length : 0;

    return (
      <TouchableOpacity
        style={styles.chatCard}
        onPress={() =>
          navigation.navigate('ChatRoom', {
            conversation: item,
            peerUser: item.peerUser,
          })
        }
      >
        <View style={styles.leftRow}>
          {/* 1-1 or City Group avatar */}
          {(!item.is_group || item.is_city_group) && avatarUri && (
            <Image source={{ uri: avatarUri }} style={styles.avatar} />
          )}
          <View>
            <Text style={styles.chatName}>{title}</Text>
            <Text style={styles.chatMessage}>
              {showTyping ? 'Typing...' : item.lastMessage}
            </Text>
          </View>
        </View>

        <View style={styles.rightMeta}>
          {item.is_group && (
            <View style={styles.memberPill}>
              <Ionicons name="people-outline" size={14} color={COLORS.textSecondary} />
              <Text style={styles.memberPillText}>{memberCount}</Text>
            </View>
          )}
          <Text style={styles.timeText}>{timeAgo}</Text>
          <View style={styles.dot} />
        </View>
      </TouchableOpacity>
    );
  };

  const filteredChats = chats.filter((chat) => {
    // Compose a normalized title for searching
    const normalizedTitle = chat.is_group
      ? (chat.is_city_group
          ? (chat.cityInfo?.name || chat.label || '')
          : (chat.label ?? 'group chat'))
      : (chat.derivedTitle?.toLowerCase?.() || 'conversation');

    return normalizedTitle.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <View style={styles.container}>
      {loadingCityChat && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Loading group chat...</Text>
        </View>
      )}

      <TextInput
        placeholder="Search chats..."
        placeholderTextColor={COLORS.textSecondary}
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
      />

      {loadingChats ? (
        <ActivityIndicator
          size="large"
          color={COLORS.primary}
          style={{ marginTop: 20 }}
        />
      ) : (
        <FlatList
          data={filteredChats}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingTop: 8 }}
          ListEmptyComponent={
            <Text style={styles.emptyText}>No chats found.</Text>
          }
          onRefresh={fetchUserChats}
          refreshing={loadingChats}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: 16,
  },
  searchInput: {
    height: 40,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginTop: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    color: COLORS.textPrimary,
  },
  chatCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: COLORS.card,
    padding: 16,
    borderRadius: 12,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 10,
  },
  chatName: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },
  chatMessage: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginTop: 4,
    maxWidth: 220,
  },
  timeText: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginTop: 6,
    marginBottom: 6,
    textAlign: 'right',
  },
  rightMeta: {
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
  },
  memberPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  memberPillText: {
    marginLeft: 4,
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  loadingOverlay: {
    position: 'absolute',
    zIndex: 10,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: COLORS.background + 'CC',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: COLORS.textPrimary,
    fontWeight: '600',
  },
  emptyText: {
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 40,
  },
});
