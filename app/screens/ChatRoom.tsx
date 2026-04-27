import React, { useState, useLayoutEffect, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Alert,
  Image,
  Modal,
  Pressable,
  ActivityIndicator,
  Dimensions,
  RefreshControl,
  BackHandler,
  Keyboard,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useGamification } from '../context/GamificationContext';
import { useMonthlyStreak } from '../lib/useMonthlyStreak';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { emitChatBadgeRefresh } from '../lib/chatBadgeEvents';
import { sendPushNotification } from '../lib/sendPush';
/* ------------------------------- Noir palette ------------------------------- */
const DARK_BG = '#000000';
const ELEVATED = '#000000';
const ELEVATED_2 = '#000000';
const BORDER = '#111111';
const TEXT = '#EDEBE6';
const SUBTLE = '#8F8F8F';
const GOLD = '#C6A664';
const BUBBLE_IN = '#111111';   // or '#0D0D0D'
const BUBBLE_OUT = GOLD;

/* ------------------------------- sizing ------------------------------------ */
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const BUBBLE_MAX_WIDTH = Math.min(460, Math.floor(SCREEN_W * 0.78));

type Conversation = {
  id: string;
  is_group: boolean;
  is_city_group?: boolean;
  participant_ids: string[];
  city_id?: number | null;
  label?: string;
  last_message_content?: string | null;
  last_message_sent_at?: string | null;
  created_at?: string | null;

  // ✅ ADDED: support custom group chats
  group_avatar_url?: string | null;
  created_by?: string | null;
};

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string; // text OR "image:<url>"
  sent_at: string;
  delivered?: boolean;
  message_type?: 'text' | 'system' | 'media';
  sender?: { id: string; full_name: string } | null;
};

/* include level so we can color the ring */
type PeerUser = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  level?: number | null;
};

type Member = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  level?: number | null;
};

const hideKeyFor = (userId: string) => `OVERLOOKED_HIDE_MAP:${userId}`;
const unhideKeyFor = (userId: string) => `OVERLOOKED_UNHIDE_SET:${userId}`;



/* ------------------ keep chats visible after opening ------------------ */
async function markConversationActive(conversationId: string) {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const uid = session?.user?.id;
  if (!uid) return;

  const cid = String(conversationId);
  try {
    const raw = await AsyncStorage.getItem(hideKeyFor(uid));
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    if (map[cid]) {
      delete map[cid];
      await AsyncStorage.setItem(hideKeyFor(uid), JSON.stringify(map));
    }
  } catch {}
  try {
    const raw = await AsyncStorage.getItem(unhideKeyFor(uid));
    const arr: string[] = raw ? JSON.parse(raw) : [];
    if (!arr.includes(cid)) {
      arr.push(cid);
      await AsyncStorage.setItem(unhideKeyFor(uid), JSON.stringify(arr));
    }
  } catch {}
  try {
    await supabase
      .from('conversation_hides')
      .delete()
      .eq('user_id', uid)
      .eq('conversation_id', cid);
  } catch {}
}

type LoadState = 'idle' | 'checking' | 'ready' | 'missing';

export default function ChatRoom() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();

  const {
    conversation: routeConversation,
    conversationId: routeConversationId,
    peerUser: routePeerUser,
  } = route.params || {};
    const routePeerUserId = routePeerUser?.id ?? null;

  const [conversation, setConversation] = useState<Conversation | null>(
    routeConversation ?? null
  );
  const [peerUser, setPeerUser] = useState<PeerUser | null>(
    routePeerUser ?? null
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [sendingImage, setSendingImage] = useState(false);

  const [imagePreviewUrl, setImagePreviewUrl] =
    useState<string | null>(null);
  const [imageModalVisible, setImageModalVisible] =
    useState(false);

  const [userLookup, setUserLookup] = useState<
    Record<string, { id: string; full_name: string }>
  >({});
  const [cityMeta, setCityMeta] = useState<{
    name: string | null;
    flagUri: string | null;
  }>({ name: null, flagUri: null });

  const [membersVisible, setMembersVisible] =
    useState(false);
  const [membersLoading, setMembersLoading] =
    useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersRefreshing, setMembersRefreshing] =
    useState(false);
    const [isBlockedByPeer, setIsBlockedByPeer] = useState(false);
const [haveIBlockedPeer, setHaveIBlockedPeer] = useState(false);

  const [loadState, setLoadState] =
    useState<LoadState>(() =>
      routeConversation?.id ? 'ready' : 'checking'
    );

      const flatListRef = useRef<FlatList>(null);
const typingTimeoutRef =
  useRef<ReturnType<typeof setTimeout> | null>(null);

const [keyboardHeight, setKeyboardHeight] = useState(0);

  const messageChannelRef = useRef<any>(null);
  const typingChannelRef = useRef<any>(null);
  const convoChannelRef = useRef<any>(null);

  const isWeb = Platform.OS === 'web';
  const getFlagUri = (code?: string | null) =>
    code
      ? `https://flagcdn.com/w80/${String(
          code
        ).toLowerCase()}.png`
      : null;

          
  /* --------------------------- bootstrap convo --------------------------- */
  useEffect(() => {
  const nextId: string | null =
    (routeConversationId as string | undefined) ??
    (routeConversation?.id as string | undefined) ??
    null;

  let cancelled = false;

  const bootstrapConversation = async () => {
    if (routeConversation && routeConversation.id) {
      if (!cancelled) {
        setConversation(routeConversation as Conversation);
        if (routePeerUser) setPeerUser(routePeerUser);
        setLoadState('ready');
      }
      return;
    }

    if (nextId) {
      if (conversation?.id === nextId) {
        if (routePeerUser) setPeerUser(routePeerUser);
        if (loadState !== 'ready') setLoadState('ready');
        return;
      }

      if (!cancelled) {
        setMessages([]);
        setPeerUser(routePeerUser ?? null);
        setLoadState('checking');
      }

      const { data, error } = await supabase
        .from('conversations')
        .select(
          'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at,group_avatar_url,created_by'
        )
        .eq('id', nextId)
        .single();

      if (cancelled) return;

      if (error || !data) {
        setLoadState('missing');
        return;
      }

      setConversation(data as Conversation);
      setLoadState('ready');
      return;
    }

    // If opened from Profile with only peerUser, find existing DM
    if (routePeerUserId) {
      if (!cancelled) {
        setMessages([]);
        setPeerUser(routePeerUser ?? null);
        setLoadState('checking');
      }

      const { data: meData } = await supabase.auth.getUser();
      const myId = meData?.user?.id;

      if (!myId) {
        if (!cancelled) setLoadState('missing');
        return;
      }

      const { data: conversationsData, error } = await supabase
        .from('conversations')
        .select(
          'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at,group_avatar_url,created_by'
        )
        .eq('is_group', false)
        .contains('participant_ids', [myId, routePeerUserId]);

      if (cancelled) return;

      if (error) {
        setLoadState('missing');
        return;
      }

      const existingDm = (conversationsData || []).find(
        (c: any) =>
          Array.isArray(c.participant_ids) &&
          c.participant_ids.length === 2 &&
          c.participant_ids.includes(myId) &&
          c.participant_ids.includes(routePeerUserId)
      );

      if (existingDm) {
        setConversation(existingDm as Conversation);
        setLoadState('ready');
        return;
      }

      // Create DM if none exists
      const { data: createdDm, error: createError } = await supabase
        .from('conversations')
        .insert([
          {
            is_group: false,
            is_city_group: false,
            participant_ids: [myId, routePeerUserId],
            label: null,
            last_message_content: null,
            last_message_sent_at: null,
          },
        ])
        .select(
          'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at,group_avatar_url,created_by'
        )
        .single();

      if (cancelled) return;

      if (createError || !createdDm) {
        setLoadState('missing');
        return;
      }

      setConversation(createdDm as Conversation);
      setLoadState('ready');
      return;
    }

    if (!cancelled) {
      setLoadState('missing');
    }
  };

  bootstrapConversation();

  return () => {
    cancelled = true;
  };
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [routeConversationId, routeConversation, routePeerUser]);

  useEffect(() => {
    if (loadState === 'missing') {
      navigation.replace('ChatsHome' as never);
      setTimeout(() => {
        try {
          Alert.alert(
            'Chat not available',
            'That conversation could not be opened.'
          );
        } catch {}
      }, 250);
    }
  }, [loadState, navigation]);

  useEffect(() => {
  if (loadState !== 'ready' || !conversation?.id || !userId) return;

  markConversationActive(conversation.id);

  supabase
    .from('conversation_reads')
    .upsert(
      {
        user_id: userId,
        conversation_id: conversation.id,
        last_read_at: new Date().toISOString(),
      },
      {
        onConflict: 'user_id,conversation_id',
      }
    )
    .then(({ error }) => {
      if (error) {
        console.error('Failed to mark conversation read:', error.message);
        return;
      }

      emitChatBadgeRefresh();
    });
}, [loadState, conversation?.id, userId]);

useFocusEffect(
  React.useCallback(() => {
    if (loadState !== 'ready' || !conversation?.id || !userId) return;

    supabase
      .from('conversation_reads')
      .upsert(
        {
          user_id: userId,
          conversation_id: conversation.id,
          last_read_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,conversation_id',
        }
      )
      .then(({ error }) => {
        if (error) {
          console.error('Failed to mark conversation read on focus:', error.message);
          return;
        }

        emitChatBadgeRefresh();
      });
  }, [loadState, conversation?.id, userId])
);

useFocusEffect(
  React.useCallback(() => {
    const onBackPress = () => {
  if (navigation.canGoBack()) {
    navigation.goBack();
  } else {
    navigation.navigate('ChatsHome' as never);
  }
  return true;
};

    if (Platform.OS === 'android') {
      const subscription = BackHandler.addEventListener(
        'hardwareBackPress',
        onBackPress
      );

      return () => subscription.remove();
    }

    return undefined;
  }, [navigation])
);

  /* ------------------------------ peer / city ----------------------------- */
  // Load peer with level & avatar if DM
  useEffect(() => {
    (async () => {
      if (loadState !== 'ready') return;
      if (!conversation || conversation.is_group)
        return;

      // If we already have a peer with a level, we're good
      if (peerUser?.id && peerUser.level !== undefined)
        return;

      const { data: meData } =
        await supabase.auth.getUser();
      const meId = meData?.user?.id;
      const otherId =
        conversation.participant_ids?.find(
          (pid) => pid !== meId
        );
      if (!otherId) return;

      const { data: userRow } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, level')
        .eq('id', otherId)
        .single();

      if (userRow) {
        setPeerUser({
          id: userRow.id,
          full_name: userRow.full_name,
          avatar_url: userRow.avatar_url ?? null,
          level: userRow.level ?? null,
        });
      }
    })();
  }, [loadState, conversation, peerUser?.id]);

  useEffect(() => {
  (async () => {
    if (loadState !== 'ready') return;
    if (!conversation || conversation.is_group) {
      setIsBlockedByPeer(false);
      setHaveIBlockedPeer(false);
      return;
    }

    const { data: meData } = await supabase.auth.getUser();
    const myId = meData?.user?.id;
    if (!myId) return;

    const otherId = conversation.participant_ids?.find((pid) => pid !== myId);
    if (!otherId) return;

    await checkBlockStatus(myId, otherId);
  })();
}, [loadState, conversation?.id, conversation?.is_group, conversation?.participant_ids]);

  useEffect(() => {
    (async () => {
      if (loadState !== 'ready') return;
      if (
        !conversation?.is_group ||
        !conversation.is_city_group ||
        !conversation.city_id
      ) {
        setCityMeta({
          name: null,
          flagUri: null,
        });
        return;
      }
      const { data: city } =
        await supabase
          .from('cities')
          .select('name, country_code')
          .eq('id', conversation.city_id)
          .single();
      setCityMeta({
        name: city?.name ?? null,
        flagUri: getFlagUri(
          city?.country_code ?? null
        ),
      });
    })();
  }, [
    loadState,
    conversation?.id,
    conversation?.is_group,
    conversation?.is_city_group,
    conversation?.city_id,
  ]);

  const checkBlockStatus = async (myId: string, otherId: string) => {
  try {
    const { data, error } = await supabase
      .from('blocked_users')
      .select('blocker_id, blocked_id')
      .or(
        `and(blocker_id.eq.${otherId},blocked_id.eq.${myId}),and(blocker_id.eq.${myId},blocked_id.eq.${otherId})`
      );

    if (error) {
      console.error('Block status error:', error.message);
      return;
    }

    const rows = data || [];

    const blockedByThem = rows.some(
      (r: any) => r.blocker_id === otherId && r.blocked_id === myId
    );

    const blockedByMe = rows.some(
      (r: any) => r.blocker_id === myId && r.blocked_id === otherId
    );

    setIsBlockedByPeer(blockedByThem);
    setHaveIBlockedPeer(blockedByMe);
  } catch (e) {
    console.error('checkBlockStatus error:', e);
  }
};

  useEffect(() => {
    const showEvent =
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent =
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      if (Platform.OS === 'android') {
        setKeyboardHeight(e.endCoordinates?.height || 0);
      }
    });

    const hideSub = Keyboard.addListener(hideEvent, () => {
      if (Platform.OS === 'android') {
        setKeyboardHeight(0);
      }
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  /* ------------------------------- header UI ------------------------------ */
  const goBackToChats = () => {
  navigation.navigate('ChatsHome' as never);
};
  const openPeerProfile = async () => {
    if (peerUser?.id) {
      navigation.navigate('Profile', {
        user: {
          id: peerUser.id,
          full_name: peerUser.full_name,
        },
      });
      return;
    }
    const { data: meData } =
      await supabase.auth.getUser();
    const meId = meData?.user?.id;
    const otherId =
      conversation?.participant_ids?.find(
        (pid) => pid !== meId
      );
    if (otherId) {
      const { data: u } = await supabase
        .from('users')
        .select('id, full_name')
        .eq('id', otherId)
        .single();
      if (u) {
        navigation.navigate('Profile', {
          user: {
            id: u.id,
            full_name: u.full_name,
          },
        });
      }
    }
  };

  const openMembers = async () => {
    if (
      !conversation?.is_group ||
      !conversation?.participant_ids?.length
    )
      return;
    setMembersVisible(true);
    setMembersLoading(true);
    try {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, level')
        .in(
          'id',
          conversation.participant_ids
        )
        .order('full_name');
      setMembers((data || []) as Member[]);
    } catch (e: any) {
      Alert.alert(
        'Unable to load members',
        e?.message || 'Please try again.'
      );
    } finally {
      setMembersLoading(false);
    }
  };

  const refreshMembers = async () => {
    if (!conversation?.participant_ids?.length)
      return;
    setMembersRefreshing(true);
    try {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, level')
        .in(
          'id',
          conversation.participant_ids
        )
        .order('full_name');
      setMembers((data || []) as Member[]);
    } finally {
      setMembersRefreshing(false);
    }
  };

  useLayoutEffect(() => {
    if (loadState !== 'ready' || !conversation)
      return;

    const headerLeft = () => (
  <TouchableOpacity
    onPress={goBackToChats}
    style={{
      paddingHorizontal: Platform.OS === 'ios' ? 2 : 8,
      paddingVertical: 4,
    }}
  >
    <Ionicons
      name="chevron-back"
      size={24}
      color={TEXT}
    />
  </TouchableOpacity>
);

    // Direct 1:1
    if (!conversation.is_group) {
      const name =
        peerUser?.full_name ||
        'Conversation';
      const avatarUri =
        peerUser?.avatar_url || null;
           navigation.setOptions({
  headerStyle: {
    backgroundColor: '#000000',
  },
  headerShadowVisible: false,
  headerTintColor: TEXT,
  contentStyle: {
    backgroundColor: '#000000',
  },
  headerLeft,
  headerTitleAlign: 'center',
  headerTitle: () => (
    <TouchableOpacity
      onPress={openPeerProfile}
      activeOpacity={0.85}
      style={styles.headerTitleRow}
    >
      {avatarUri ? (
        <Image source={{ uri: avatarUri }} style={styles.headerAvatar} />
      ) : (
        <View style={[styles.headerAvatar, styles.headerAvatarFallback]}>
          <Ionicons name="person-outline" size={16} color={SUBTLE} />
        </View>
      )}
      <Text style={styles.headerTitleText} numberOfLines={1}>
        {name}
      </Text>
    </TouchableOpacity>
  ),
});
    } else {
      // Group
      const memberCount =
        Array.isArray(
          conversation.participant_ids
        )
          ? conversation
              .participant_ids
              .length
          : 0;

      const TitleRow = () => (
        <TouchableOpacity
          onPress={openMembers}
          activeOpacity={0.85}
          style={
            styles.headerTitleRow
          }
        >
          {/* ✅ ADDED: normal group avatar (non-city) */}
          {!conversation.is_city_group && conversation.group_avatar_url ? (
            <Image
              source={{ uri: conversation.group_avatar_url }}
              style={styles.headerAvatar}
            />
          ) : null}

          {/* existing city group flag behavior (unchanged) */}
          {conversation.is_city_group &&
          cityMeta.flagUri ? (
            <Image
              source={{
                uri: cityMeta.flagUri,
              }}
              style={
                styles.headerAvatar
              }
            />
          ) : null}

          <View
            style={{
              flexDirection:
                'row',
              alignItems:
                'center',
            }}
          >
            <Text
              style={
                styles.headerTitleText
              }
              numberOfLines={1}
            >
              {conversation.is_city_group
                ? cityMeta.name ||
                  'City Group'
                : conversation.label ||
                  'Group Chat'}
            </Text>
            <Text
              style={
                styles.memberCountText
              }
            >
              {'  •  '}
              {memberCount}
            </Text>
          </View>
        </TouchableOpacity>
      );

      const headerRight = () => (
  <TouchableOpacity
    onPress={openMembers}
    style={{
      paddingHorizontal: Platform.OS === 'ios' ? 2 : 8,
      paddingVertical: 4,
    }}
  >
          <Ionicons
            name="people-outline"
            size={22}
            color={TEXT}
          />
        </TouchableOpacity>
      );

      navigation.setOptions({
  headerStyle: {
    backgroundColor: '#000000',
  },
  headerShadowVisible: false,
  headerTintColor: TEXT,
  contentStyle: {
    backgroundColor: '#000000',
  },
  headerLeft,
  headerRight,
  headerTitleAlign: 'center',
  headerTitle: () => <TitleRow />,
});
    }
  }, [
  navigation,
  loadState,
  conversation?.id,
  conversation?.is_group,
  conversation?.is_city_group,
  conversation?.label,
  conversation?.group_avatar_url,
  conversation?.participant_ids,
  peerUser?.id,
  peerUser?.full_name,
  peerUser?.avatar_url,
  peerUser?.level,
  cityMeta.name,
  cityMeta.flagUri,
  ]);

  /* -------------------------- messages + realtime ------------------------- */
  useEffect(() => {
  if (loadState !== 'ready' || !conversation?.id) return;

  let active = true;

  const timer = setTimeout(() => {
    if (!active) return;
    fetchUserAndMessages();
    setupRealtime(conversation.id);
  }, 80);

  return () => {
    active = false;
    clearTimeout(timer);

    if (messageChannelRef.current) {
      supabase.removeChannel(messageChannelRef.current);
    }
    if (typingChannelRef.current) {
      supabase.removeChannel(typingChannelRef.current);
    }
    if (convoChannelRef.current) {
      supabase.removeChannel(convoChannelRef.current);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [loadState, conversation?.id]);

  const fetchUserAndMessages = async () => {
    const { data: userData } =
      await supabase.auth.getUser();
    if (!userData?.user) return;
    setUserId(userData.user.id);

    const { data, error } =
      await supabase
        .from('messages')
        .select(
          'id, conversation_id, sender_id, content, message_type, sent_at, delivered, sender:users!messages_sender_id_fkey(id, full_name)'
        )
        .eq(
          'conversation_id',
          conversation!.id
        )
        .order('sent_at', {
          ascending: true,
        });

    if (!error && data) {
      const normalized: Message[] =
  (data as any[]).map(
    (row: any) => ({
      ...row,
      sender: Array.isArray(
        row.sender
      )
        ? row.sender[0] ??
          null
        : row.sender ?? null,
    })
  );

const reversed = [...normalized].reverse();

setMessages(reversed);

const fromMsgs: Record<
  string,
  { id: string; full_name: string }
> = {};
for (const m of reversed)

      
        if (m.sender?.id)
          fromMsgs[m.sender.id] = {
            id: m.sender.id,
            full_name:
              m.sender
                .full_name,
          };

      if (
        conversation
          ?.participant_ids
          ?.length
      ) {
        const {
          data: participants,
        } = await supabase
          .from('users')
          .select('id, full_name')
          .in(
            'id',
            conversation.participant_ids
          );
        (participants || []).forEach(
          (u) =>
            (fromMsgs[u.id] = {
              id: u.id,
              full_name:
                u.full_name,
            })
        );
      }

            setUserLookup(fromMsgs);

      if (userData?.user?.id && conversation?.id) {
  await supabase.from('conversation_reads').upsert(
    {
      user_id: userData.user.id,
      conversation_id: conversation.id,
      last_read_at: new Date().toISOString(),
    },
    {
      onConflict: 'user_id,conversation_id',
    }
  );
}
    }
  };

  const setupRealtime = (convId: string) => {
    const messageChannel =
      supabase
        .channel(`chat-room-${convId}`)
        .on(
  'postgres_changes',
  {
    event: 'INSERT',
    schema: 'public',
    table: 'messages',
    filter: `conversation_id=eq.${convId}`,
  },
    
    async () => {
  await fetchUserAndMessages();
  scrollToBottom(true);
  emitChatBadgeRefresh();
}
)
        .subscribe();
    messageChannelRef.current =
      messageChannel;

    const typingChannel =
      supabase
        .channel(`typing-${convId}`)
        .on(
          'broadcast',
          { event: 'typing' },
          (payload) => {
            const sender =
              payload
                .payload
                ?.sender as
                | string
                | null;
            if (
              sender &&
              sender !== userId
            ) {
              setTypingUser(sender);
              if (
                typingTimeoutRef.current
              )
                clearTimeout(
                  typingTimeoutRef.current
                );
              typingTimeoutRef.current =
                setTimeout(
                  () =>
                    setTypingUser(
                      null
                    ),
                  2000
                );
            }
          }
        )
        .subscribe();
    typingChannelRef.current =
      typingChannel;

    const convoChannel =
      supabase
        .channel(
          `convo-${convId}`
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'conversations',
            filter: `id=eq.${convId}`,
          },
          (payload) =>
            setConversation(
              (prev) =>
                prev
                  ? {
                      ...prev,
                      ...(payload.new as any),
                    }
                  : (payload.new as any)
            )
        )
        .subscribe();
    convoChannelRef.current =
      convoChannel;
  };

      const scrollToBottom = (animated = true) =>
  flatListRef.current?.scrollToOffset({
    offset: 0,
    animated,
  });

  const updateConversationLastMessage = async (
    convId: string,
    content: string
  ) => {
    await supabase
      .from('conversations')
      .update({
        last_message_content:
          content,
        last_message_sent_at:
          new Date().toISOString(),
      })
      .eq('id', convId);
  };

  /* -------------------------------- sending -------------------------------- */

  const notifyRecipients = async (messageText: string) => {
  if (!conversation?.participant_ids?.length || !userId) return;

  const recipientIds = conversation.participant_ids.filter(
    (id) => id !== userId
  );

  for (const recipientId of recipientIds) {
    await sendPushNotification(recipientId, messageText);
  }
};

  const sendMessage = async () => {
  if (conversation?.is_group === false && isBlockedByPeer) {
    Alert.alert('Cannot message user', "You can't message this user.");
    return;
  }

  if (conversation?.is_group === false && haveIBlockedPeer) {
    Alert.alert('User blocked', 'Unblock this user to send messages.');
    return;
  }

  if (
    !input.trim() ||
    !userId ||
    !conversation?.id
  )
    return;
    const text = input.trim();
    setInput('');
    const { error } =
      await supabase
        .from('messages')
        .insert({
          conversation_id:
            conversation.id,
          sender_id: userId,
          content: text,
          delivered: true,
          message_type: 'text',
        });
    if (error) {
      Alert.alert(
        'Failed to send',
        error.message
      );
      return;
    }
    await updateConversationLastMessage(
  conversation.id,
  text
);

await notifyRecipients(text);

await supabase.from('conversation_reads').upsert(
  {
    user_id: userId,
    conversation_id: conversation.id,
    last_read_at: new Date().toISOString(),
  },
  {
    onConflict: 'user_id,conversation_id',
  }
);

await fetchUserAndMessages();
scrollToBottom(true);
emitChatBadgeRefresh();
  };

  const uploadImageAndGetUrl = async (
    uri: string,
    mimeType?: string | null
  ) => {
    const ext = (mimeType?.split(
      '/'
    )[1] || 'jpg').split(';')[0];
    const filePath = `${conversation!.id}/${userId}/${Date.now()}.${ext}`;
    const res = await fetch(uri);
    const blob = await res.blob();
    const {
      error: uploadError,
    } = await supabase.storage
      .from('chat-uploads')
      .upload(filePath, blob, {
        upsert: true,
        contentType:
          mimeType ||
          'image/jpeg',
      });
    if (uploadError) throw uploadError;
    const { data: pub } =
      supabase.storage
        .from('chat-uploads')
        .getPublicUrl(filePath);
    return pub.publicUrl;
  };

  const sendFile = async () => {
  if (conversation?.is_group === false && isBlockedByPeer) {
    Alert.alert('Cannot message user', "You can't message this user.");
    return;
  }

  if (conversation?.is_group === false && haveIBlockedPeer) {
    Alert.alert('User blocked', 'Unblock this user to send messages.');
    return;
  }

  try {
      const result =
        await DocumentPicker.getDocumentAsync(
          {
            multiple: false,
            copyToCacheDirectory: true,
          }
        );
      if (
        !result.assets ||
        result.assets.length === 0
      )
        return;
      if (
        !userId ||
        !conversation?.id
      )
        return;

      const asset =
        result.assets[0];
      const isImage = (
        asset.mimeType || ''
      ).startsWith('image/');

      if (isImage) {
        setSendingImage(true);
        const publicUrl =
          await uploadImageAndGetUrl(
            asset.uri,
            asset.mimeType
          );
        const content =
          `image:${publicUrl}`;
        const { error } =
          await supabase
            .from(
              'messages'
            )
            .insert({
              conversation_id:
                conversation.id,
              sender_id:
                userId,
              content,
              delivered: true,
              message_type:
                'media',
            });
        setSendingImage(false);
        if (error) {
          Alert.alert(
            'Image send failed',
            error.message
          );
          return;
        }
        await updateConversationLastMessage(
  conversation.id,
  '[Photo]'
);
await notifyRecipients('Sent you a photo');

await supabase.from('conversation_reads').upsert(
  {
    user_id: userId,
    conversation_id: conversation.id,
    last_read_at: new Date().toISOString(),
  },
  {
    onConflict: 'user_id,conversation_id',
  }
);

await fetchUserAndMessages();
scrollToBottom(true);
emitChatBadgeRefresh();
      } else {
        const fileName =
          asset.name ||
          'file';
        const content = `📎 File: ${fileName}`;
        const { error } =
          await supabase
            .from(
              'messages'
            )
            .insert({
              conversation_id:
                conversation.id,
              sender_id:
                userId,
              content,
              delivered: true,
              message_type:
                'text',
            });
        if (error) {
          Alert.alert(
            'File send failed',
            error.message
          );
          return;
        }
        await updateConversationLastMessage(
  conversation.id,
  content
);
await notifyRecipients(content);

await supabase.from('conversation_reads').upsert(
  {
    user_id: userId,
    conversation_id: conversation.id,
    last_read_at: new Date().toISOString(),
  },
  {
    onConflict: 'user_id,conversation_id',
  }
);

await fetchUserAndMessages();
scrollToBottom(true);
emitChatBadgeRefresh();
      }
    } catch (e: any) {
      setSendingImage(false);
      Alert.alert(
        'Attachment error',
        e?.message ||
          'Unable to send attachment.'
      );
    }
  };

  const handleTyping = (text: string) => {
  setInput(text);

  if (!text.trim() || !conversation?.id || !typingChannelRef.current) return;

  typingChannelRef.current.send({
    type: 'broadcast',
    event: 'typing',
    payload: {
      sender: userId,
    },
  });
};

  // Web: Enter send, Shift+Enter newline
  const handleWebKeyPress = (e: any) => {
    if (Platform.OS !== 'web') return;
    const key =
      e?.nativeEvent?.key;
    const shift =
      !!e?.nativeEvent
        ?.shiftKey;
    const isComposing =
      !!e?.nativeEvent
        ?.isComposing;
    if (key === 'Enter' && !shift) {
      if (isComposing) return;
      if (
        typeof e?.preventDefault ===
        'function'
      )
        e.preventDefault();
      sendMessage();
    }
  };

  /* ------------------------------- rendering ------------------------------- */
  const isImageMessage = (content: string) =>
    content.startsWith('image:');
  const extractImageUrl = (content: string) =>
    content.replace(/^image:/, '');
  const openImage = (url: string) => {
    setImagePreviewUrl(url);
    setImageModalVisible(true);
  };

  const goToSenderProfile = (
    senderId: string
  ) => {
    const display =
      userLookup[senderId];
    if (!display) return;
    navigation.navigate(
      'Profile',
      {
        user: {
          id: display.id,
          full_name:
            display.full_name,
        },
      }
    );
  };

  const renderSystemMessage = (
    text: string
  ) => (
    <View
      style={
        styles.systemMsgWrap
      }
    >
      <Text
        style={
          styles.systemMsgText
        }
      >
        {text}
      </Text>
    </View>
  );

  const renderItem = ({
    item,
  }: {
    item: Message;
  }) => {
    if (
      item.message_type ===
      'system'
    )
      return renderSystemMessage(
        item.content
      );

    const isOwn =
      item.sender_id ===
      userId;
    const showName =
      conversation?.is_group &&
      !isOwn;

    const imageMsg =
      isImageMessage(
        item.content
      );
    const imageUrl = imageMsg
      ? extractImageUrl(
          item.content
        )
      : null;

    const senderDisplay =
      item.sender?.full_name ||
      userLookup[
        item.sender_id
      ]?.full_name;

    const webTextFix =
      Platform.OS === 'web'
        ? ({
            wordBreak:
              'break-word',
            whiteSpace:
              'pre-wrap',
          } as any)
        : null;

    return (
      <View
        style={[
          styles.messageWrapper,
          isOwn
            ? styles.right
            : styles.left,
        ]}
      >
        {!isOwn &&
          showName &&
          senderDisplay && (
            <TouchableOpacity
              onPress={() =>
                goToSenderProfile(
                  item.sender_id
                )
              }
            >
              <Text
                style={
                  styles.senderName
                }
              >
                {
                  senderDisplay
                }
              </Text>
            </TouchableOpacity>
          )}

        {imageMsg ? (
          <TouchableOpacity
            activeOpacity={
              0.88
            }
            onPress={() =>
              openImage(
                imageUrl!
              )
            }
            style={[
              styles.imageBubble,
              isOwn
                ? styles.imageOutgoing
                : styles.imageIncoming,
            ]}
          >
            <Image
              source={{
                uri: imageUrl!,
              }}
              style={
                styles.chatImage
              }
              resizeMode="cover"
            />
            {isOwn &&
              item.delivered && (
                <Text
                  style={
                    styles.deliveredOnImage
                  }
                >
                  ✓
                </Text>
              )}
          </TouchableOpacity>
        ) : (
          <View
            style={[
              styles.messageBubble,
              isOwn
                ? styles.outgoing
                : styles.incoming,
            ]}
          >
            <Text
              style={[
                styles.messageText,
                isOwn && {
                  color:
                    '#000',
                },
                webTextFix as any,
              ]}
            >
              {item.content}
            </Text>
            {isOwn &&
              item.delivered && (
                <Text
                  style={
                    styles.delivered
                  }
                >
                  ✓
                </Text>
              )}
          </View>
        )}
      </View>
    );
  };

  const messagingDisabled =
  conversation?.is_group === false && (isBlockedByPeer || haveIBlockedPeer);
const isScreenReady = loadState === 'ready' && !!conversation?.id;
  return (
        <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
    >
      {!isScreenReady ? (
  <View style={styles.loaderWrap}>
    <ActivityIndicator color={TEXT} />
  </View>
) : (
  <>
        <FlatList
  ref={flatListRef}
  data={messages}
  renderItem={renderItem}
  keyExtractor={(item) => item.id}
  inverted
  contentContainerStyle={{ padding: 16, paddingTop: 8, paddingBottom: 12 }}
  removeClippedSubviews={Platform.OS !== 'ios'}
  initialNumToRender={12}
  maxToRenderPerBatch={8}
  windowSize={7}
  updateCellsBatchingPeriod={16}
  keyboardShouldPersistTaps="handled"
/>

    {typingUser && (
      <Text style={styles.typingText}>Someone is typing…</Text>
    )}

       <View
      style={[
        styles.inputBar,
        Platform.OS === 'android' && keyboardHeight > 0
          ? { marginBottom: keyboardHeight }
          : null,
      ]}
    >
      <TouchableOpacity
  onPress={sendFile}
  style={styles.iconBtn}
  disabled={sendingImage || messagingDisabled}
>
        {sendingImage ? (
          <ActivityIndicator color={TEXT} />
        ) : (
          <Ionicons name="attach" size={22} color={SUBTLE} />
        )}
      </TouchableOpacity>

      <TextInput
  value={input}
  onChangeText={handleTyping}
  placeholder={
    isBlockedByPeer
      ? "You can't message this user"
      : haveIBlockedPeer
      ? 'Unblock this user to message them'
      : 'Type a message…'
  }
  placeholderTextColor={SUBTLE}
  style={styles.input}
  multiline={Platform.OS === 'web'}
  onKeyPress={handleWebKeyPress}
  editable={!messagingDisabled}
  {...(Platform.OS === 'web' ? ({ tabIndex: 0 } as any) : {})}
/>

      <TouchableOpacity
  onPress={sendMessage}
  style={[styles.sendBtn, messagingDisabled && { opacity: 0.5 }]}
  disabled={messagingDisabled}
>
  <Ionicons name="send" size={18} color="#000" />
</TouchableOpacity>
    </View>
  </>
)}

      {/* Full-screen image preview */}
      <Modal
        visible={imageModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() =>
          setImageModalVisible(
            false
          )
        }
      >
        <View
          style={
            styles.modalBackdrop
          }
        >
          <Pressable
            style={
              styles.modalBackdrop
            }
            onPress={() =>
              setImageModalVisible(
                false
              )
            }
          >
            {imagePreviewUrl ? (
              <Image
                source={{
                  uri: imagePreviewUrl,
                }}
                style={
                  styles.previewImage
                }
                resizeMode="contain"
              />
            ) : null}
          </Pressable>
          <View
            style={
              styles.modalCloseBar
            }
          >
            <TouchableOpacity
              onPress={() =>
                setImageModalVisible(
                  false
                )
              }
              style={
                styles.closeBtn
              }
            >
              <Ionicons
                name="close"
                size={24}
                color={TEXT}
              />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

            {/* Members sheet */}
      <Modal
        visible={membersVisible && !!conversation}
        transparent
        animationType="slide"
        onRequestClose={() =>
          setMembersVisible(false)
        }
      >
        <Pressable
          style={
            styles.sheetBackdrop
          }
          onPress={() =>
            setMembersVisible(
              false
            )
          }
        />
        <View
          style={styles.sheet}
        >
          <View
            style={
              styles.sheetHandle
            }
          />
          <View
            style={
              styles.sheetHeaderRow
            }
          >
            <Text
  style={styles.sheetTitle}
>
  {conversation?.is_city_group
    ? cityMeta.name || 'City Members'
    : conversation?.label || 'Group Members'}
</Text>

<Text
  style={styles.sheetCount}
>
  {Array.isArray(conversation?.participant_ids)
    ? conversation?.participant_ids.length
    : 0}{' '}
  members
</Text>
          </View>

          {membersLoading ? (
            <View
              style={
                styles.membersLoadingWrap
              }
            >
              <ActivityIndicator
                color={
                  TEXT
                }
              />
              <Text
                style={
                  styles.loadingText
                }
              >
                Loading
                members…
              </Text>
            </View>
          ) : (
            <FlatList
              data={
                members
              }
              keyExtractor={(m) =>
                m.id
              }
              refreshControl={
                <RefreshControl
                  refreshing={
                    membersRefreshing
                  }
                  onRefresh={
                    refreshMembers
                  }
                  tintColor={
                    TEXT
                  }
                />
              }
              ItemSeparatorComponent={() => (
                <View
                  style={
                    styles.separator
                  }
                />
              )}
              contentContainerStyle={{
                paddingBottom:
                  18,
              }}
                            renderItem={({ item }) => {
                return (
                  <TouchableOpacity
                    onPress={() => {
                      setMembersVisible(false);
                      navigation.navigate('Profile', {
                        user: {
                          id: item.id,
                          full_name: item.full_name,
                        },
                      });
                    }}
                    style={styles.memberRow}
                    activeOpacity={0.85}
                  >
                    {item.avatar_url ? (
                      <Image
                        source={{ uri: item.avatar_url }}
                        style={styles.memberAvatar}
                      />
                    ) : (
                      <View
                        style={[
                          styles.memberAvatar,
                          { backgroundColor: ELEVATED },
                        ]}
                      />
                    )}

                    <Text
                      style={styles.memberName}
                      numberOfLines={1}
                    >
                      {item.full_name}
                    </Text>

                    <Ionicons
                      name="chevron-forward"
                      size={18}
                      color={SUBTLE}
                      style={{ marginLeft: 'auto' }}
                    />
                  </TouchableOpacity>
                );
              }}


               
              ListEmptyComponent={
                <View
                  style={
                    styles.membersEmpty
                  }
                >
                  <Text
                    style={
                      styles.membersEmptyText
                    }
                  >
                    No members
                    found.
                  </Text>
                </View>
              }
            />
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

/* --------------------------------- styles --------------------------------- */
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: DARK_BG,
  },
  loaderWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: DARK_BG,
  },

  // Header bits
  headerTitleRow: {
  flexDirection: 'row',
  alignItems: 'center',
  maxWidth: Platform.OS === 'ios' ? 170 : 260,
  flexShrink: 1,
},

    headerAvatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    marginRight: 8,
  },
  headerAvatarFallback: {
  backgroundColor: '#000000',
  alignItems: 'center',
  justifyContent: 'center',
},
  headerTitleText: {
  fontSize: 15,
  fontWeight: '800',
  color: TEXT,
  flexShrink: 1,
},
  memberCountText: {
    fontSize: 13,
    fontWeight: '800',
    color: SUBTLE,
  },

  // System message chip
  systemMsgWrap: {
  alignSelf: 'center',
  backgroundColor: '#0A0A0A',
  borderRadius: 14,
  paddingVertical: 6,
  paddingHorizontal: 12,
  marginVertical: 8,
  borderWidth: 0,
},
  systemMsgText: {
    fontSize: 12,
    color: SUBTLE,
  },

  messageWrapper: {
  marginTop: 10,
},
  senderName: {
    fontSize: 12,
    color: SUBTLE,
    marginLeft: 8,
    marginBottom: 2,
  },

  // Bubbles
  messageBubble: {
    maxWidth: BUBBLE_MAX_WIDTH,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 18,
    borderWidth: 1,
  },
  incoming: {
  backgroundColor: '#111111',
  borderColor: '#111111',
  alignSelf: 'flex-start',
},
  outgoing: {
    backgroundColor: BUBBLE_OUT,
    borderColor: GOLD,
    alignSelf: 'flex-end',
  },

  // Image bubbles
  imageBubble: {
    maxWidth: BUBBLE_MAX_WIDTH,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1,
  },
  imageIncoming: {
  alignSelf: 'flex-start',
  backgroundColor: '#111111',
  borderColor: '#111111',
},
  imageOutgoing: {
    alignSelf: 'flex-end',
    backgroundColor: BUBBLE_OUT,
    borderColor: GOLD,
  },
  chatImage: {
    width: Math.min(
      320,
      Math.floor(SCREEN_W * 0.7)
    ),
    height: Math.min(
      320,
      Math.floor(SCREEN_W * 0.7)
    ),
  },

  right: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  left: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },

  messageText: {
    color: TEXT,
    fontSize: 15,
    lineHeight: 20,
    flexShrink: 1,
  },
  delivered: {
    fontSize: 10,
    color: '#000',
    marginTop: 4,
    textAlign: 'right',
    opacity: 0.75,
  },
  deliveredOnImage: {
    position: 'absolute',
    right: 8,
    bottom: 6,
    fontSize: 12,
    color: '#000',
  },

  typingText: {
    fontSize: 12,
    color: SUBTLE,
    paddingHorizontal: 16,
    paddingBottom: 6,
  },

  // Composer
  inputBar: {
  flexDirection: 'row',
  alignItems: 'center',
  paddingHorizontal: 10,
  paddingVertical: 10,
  backgroundColor: DARK_BG,
  borderTopWidth: 0, // remove line if you want it to fully blend
},
  iconBtn: {
    padding: 6,
  },
  input: {
  flex: 1,
  backgroundColor: '#0A0A0A',
  color: TEXT,
  borderRadius: 999,
  paddingHorizontal: 16,
  paddingVertical: Platform.OS === 'ios' ? 12 : 10,
  marginHorizontal: 8,
  borderWidth: 1,
  borderColor: '#111111',
  fontSize: 16,
  ...(Platform.OS === 'web'
    ? ({
        outlineStyle: 'none',
        boxShadow: 'none',
      } as any)
    : {}),
},
  sendBtn: {
    backgroundColor: GOLD,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GOLD,
  },

  // Preview modal
  modalBackdrop: {
    flex: 1,
    backgroundColor:
      'rgba(0,0,0,0.92)',
    justifyContent:
      'center',
    alignItems: 'center',
  },
  previewImage: {
    width: Math.floor(
      SCREEN_W * 0.92
    ),
    height: Math.floor(
      SCREEN_H * 0.7
    ),
  },
  modalCloseBar: {
    position: 'absolute',
    top: 40,
    right: 16,
  },
  closeBtn: {
    padding: 8,
  },

  // Members sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor:
      'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: Math.floor(
      SCREEN_H * 0.65
    ),
    backgroundColor: DARK_BG,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 12,
    paddingHorizontal: 12,
    paddingTop: 6,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: {
      width: 0,
      height: -6,
    },
    elevation: 12,
    borderTopWidth: 1,
    borderTopColor: BORDER,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    backgroundColor: '#333',
    borderRadius: 999,
    alignSelf: 'center',
    marginVertical: 8,
  },
  sheetHeaderRow: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  sheetTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: TEXT,
    letterSpacing: 0.3,
  },
  sheetCount: {
    marginTop: 2,
    fontSize: 12,
    color: SUBTLE,
  },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  
    memberAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: ELEVATED,
    marginRight: 10,
  },
  memberName: {
    fontSize: 15,
    color: TEXT,
    maxWidth: SCREEN_W - 130,
  },
  separator: {
    height: 1,
    backgroundColor: BORDER,
    marginLeft: 52,
    opacity: 0.6,
  },

  membersLoadingWrap: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 8,
    color: SUBTLE,
  },
  membersEmpty: {
    paddingVertical: 28,
    alignItems: 'center',
  },
  membersEmptyText: {
    color: SUBTLE,
  },
});