import React, { useCallback, useState, useLayoutEffect, useEffect, useRef } from 'react';
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
  Animated,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useGamification } from '../context/GamificationContext';
import { useMonthlyStreak } from '../lib/useMonthlyStreak';
import { supabase } from '../lib/supabase';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { emitChatBadgeRefresh } from '../lib/chatBadgeEvents';
import { useAppRefresh } from '../context/AppRefreshContext';
import { reportContent, ReportReason } from '../utils/reportContent';
import { blockUser } from '../utils/blockUser';
import { validateSafeText } from '../utils/moderation';
import ReportContentModal from '../../components/ReportContentModal';
import { useAppTheme } from '../context/ThemeContext';
import { useInAppNotifications } from '../context/InAppNotificationsContext';
/* ------------------------------- Noir palette ------------------------------- */
const DARK_BG = '#050505';
const ELEVATED = '#0D0D0F';
const ELEVATED_2 = '#111114';
const BORDER = 'rgba(255,255,255,0.10)';
const TEXT = '#F4EFE6';
const SUBTLE = '#8F8578';
const GOLD = '#C6A664';
const BUBBLE_IN = '#111114';
const BUBBLE_OUT = GOLD;

type ChatComposerProps = {
  mutedColor: string;
  backgroundColor: string;
  borderColor: string;
  inputBackgroundColor: string;
  textColor: string;
  sendingImage: boolean;
  disabled: boolean;
  isBlockedByPeer: boolean;
  haveIBlockedPeer: boolean;
  bottomInset: number;
  onAttach: () => void;
  onSend: (text: string) => Promise<boolean>;
  onTyping: (text: string) => void;
};

const ChatComposer = React.memo(function ChatComposer({
  mutedColor,
  backgroundColor,
  borderColor,
  inputBackgroundColor,
  textColor,
  sendingImage,
  disabled,
  isBlockedByPeer,
  haveIBlockedPeer,
  bottomInset,
  onAttach,
  onSend,
  onTyping,
}: ChatComposerProps) {
  const [draft, setDraft] = useState('');

  const handleChange = useCallback(
    (text: string) => {
      setDraft(text);
      onTyping(text);
    },
    [onTyping]
  );

  const submit = useCallback(async () => {
    const text = draft.trim();
    if (!text || disabled) return;

    const sent = await onSend(text);
    if (sent) setDraft('');
  }, [disabled, draft, onSend]);

  const handleWebKeyPress = useCallback(
    (e: any) => {
      if (Platform.OS !== 'web') return;
      const key = e?.nativeEvent?.key;
      const shift = !!e?.nativeEvent?.shiftKey;
      const isComposing = !!e?.nativeEvent?.isComposing;
      if (key === 'Enter' && !shift) {
        if (isComposing) return;
        if (typeof e?.preventDefault === 'function') e.preventDefault();
        void submit();
      }
    },
    [submit]
  );

  return (
    <View
      style={[
        styles.inputBar,
        {
          backgroundColor,
          borderTopColor: borderColor,
          paddingBottom: Math.max(10, bottomInset || 0),
        },
      ]}
    >
      <TouchableOpacity
        onPress={onAttach}
        style={styles.iconBtn}
        disabled={sendingImage || disabled}
      >
        {sendingImage ? (
          <ActivityIndicator color={textColor} />
        ) : (
          <Ionicons name="attach" size={22} color={mutedColor} />
        )}
      </TouchableOpacity>

      <TextInput
        value={draft}
        onChangeText={handleChange}
        placeholder={
          isBlockedByPeer
            ? "You can't message this user"
            : haveIBlockedPeer
            ? 'Unblock this user to message them'
            : 'Type a message...'
        }
        placeholderTextColor={mutedColor}
        style={[
          styles.input,
          { backgroundColor: inputBackgroundColor, borderColor, color: textColor },
        ]}
        multiline={Platform.OS === 'web'}
        blurOnSubmit={false}
        onKeyPress={handleWebKeyPress}
        editable={!disabled}
        autoCorrect
        autoCapitalize="sentences"
        returnKeyType="send"
        onSubmitEditing={() => {
          if (Platform.OS !== 'web') void submit();
        }}
        {...(Platform.OS === 'web' ? ({ tabIndex: 0 } as any) : {})}
      />

      <TouchableOpacity
        onPress={() => void submit()}
        style={[styles.sendBtn, disabled && { opacity: 0.5 }]}
        disabled={disabled}
      >
        <Ionicons name="send" size={18} color="#000" />
      </TouchableOpacity>
    </View>
  );
});

/* ------------------------------- sizing ------------------------------------ */
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const BUBBLE_MAX_WIDTH = Math.min(460, Math.floor(SCREEN_W * 0.78));
const CHAT_INITIAL_MESSAGE_LIMIT = 120;
const MESSAGE_BOTTOM_THRESHOLD = 96;

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
  is_removed?: boolean | null;
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
  const { colors } = useAppTheme();
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const insets = useSafeAreaInsets();
  const { triggerAppRefresh } = useAppRefresh();
  const { markMessageNotificationsRead } = useInAppNotifications();
  const DARK_BG = colors.background;
  const ELEVATED = colors.card;
  const ELEVATED_2 = colors.mutedCard;
  const BORDER = colors.border;
  const TEXT = colors.textPrimary;
  const SUBTLE = colors.textMuted;
  const GOLD = colors.primary;
  const BUBBLE_IN = colors.cardAlt;
  const BUBBLE_OUT = colors.primary;

  const [refreshing, setRefreshing] = useState(false);

  const {
    conversation: routeConversation,
    conversationId: routeConversationId,
    peerUser: routePeerUser,
    currentUserId: routeCurrentUserId,
    userId: routeLegacyUserId,
  } = route.params || {};
    const routePeerUserId = routePeerUser?.id ?? null;

  const [conversation, setConversation] = useState<Conversation | null>(
    routeConversation ?? null
  );
  const [peerUser, setPeerUser] = useState<PeerUser | null>(
    routePeerUser ?? null
  );
  const [messages, setMessages] = useState<Message[]>([]);
  const [userId, setUserId] = useState<string | null>(
    routeCurrentUserId ?? routeLegacyUserId ?? null
  );
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [sendingImage, setSendingImage] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const keyboardOffsetAnim = useRef(new Animated.Value(0)).current;
  const [hasMoreMessages, setHasMoreMessages] = useState(true);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);

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
const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
const [reportTargetMessage, setReportTargetMessage] = useState<Message | null>(null);
const [reportReason, setReportReason] = useState<ReportReason>('Harassment or bullying');
const [reportDetails, setReportDetails] = useState('');
const [reportSubmitting, setReportSubmitting] = useState(false);

  const [loadState, setLoadState] =
    useState<LoadState>(() =>
      routeConversation?.id ? 'ready' : 'checking'
    );

      const flatListRef = useRef<FlatList>(null);
const initialBottomScrollConversationRef = useRef<string | null>(null);
const shouldStickToBottomRef = useRef(true);
const typingTimeoutRef =
  useRef<ReturnType<typeof setTimeout> | null>(null);
const lastTypingSignalRef = useRef(0);
const messagesRef = useRef<Message[]>([]);

  const messageChannelRef = useRef<any>(null);
  const typingChannelRef = useRef<any>(null);
  const convoChannelRef = useRef<any>(null);
  const userIdRef = useRef<string | null>(null);
  const blockedUserIdsRef = useRef<Set<string>>(new Set());
  const userLookupRef = useRef<Record<string, { id: string; full_name: string }>>({});

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    if (routeCurrentUserId || routeLegacyUserId) {
      setUserId(routeCurrentUserId ?? routeLegacyUserId);
    }
  }, [routeCurrentUserId, routeLegacyUserId]);

  useEffect(() => {
    blockedUserIdsRef.current = blockedUserIds;
  }, [blockedUserIds]);

  useEffect(() => {
    userLookupRef.current = userLookup;
  }, [userLookup]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  const appendMessage = useCallback((row: any) => {
    if (!row?.id || row.is_removed) return;
    if (blockedUserIdsRef.current.has(row.sender_id)) return;

    const knownSender = userLookupRef.current[row.sender_id];
    const nextMessage: Message = {
      ...row,
      sender: row.sender
        ? Array.isArray(row.sender)
          ? row.sender[0] ?? null
          : row.sender
        : knownSender ?? null,
    };

    setMessages((prev) => {
      if (prev.some((message) => message.id === nextMessage.id)) return prev;
      return [...prev, nextMessage].sort(
        (a, b) => new Date(a.sent_at).getTime() - new Date(b.sent_at).getTime()
      );
    });
  }, []);

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

      void markMessageNotificationsRead(conversation.id);
      emitChatBadgeRefresh();
    });
}, [loadState, conversation?.id, userId, markMessageNotificationsRead]);

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

        void markMessageNotificationsRead(conversation.id);
        emitChatBadgeRefresh();
      });
  }, [loadState, conversation?.id, userId, markMessageNotificationsRead])
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
      .from('user_blocks')
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

  const fetchBlockedUsers = async (uid: string) => {
    const { data, error } = await supabase
      .from('user_blocks')
      .select('blocked_id')
      .eq('blocker_id', uid);

    if (error) {
      console.error('fetchBlockedUsers error:', error.message);
      return new Set<string>();
    }

    const ids = new Set<string>((data || []).map((row: any) => row.blocked_id).filter(Boolean));
    setBlockedUserIds(ids);
    return ids;
  };

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
    backgroundColor: DARK_BG,
  },
  headerShadowVisible: false,
  headerTintColor: TEXT,
  contentStyle: {
    backgroundColor: DARK_BG,
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
        <View style={[styles.headerAvatar, styles.headerAvatarFallback, { backgroundColor: ELEVATED_2 }]}>
          <Ionicons name="person-outline" size={16} color={SUBTLE} />
        </View>
      )}
      <Text style={[styles.headerTitleText, { color: TEXT }]} numberOfLines={1}>
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
              style={[styles.headerTitleText, { color: TEXT }]}
              numberOfLines={1}
            >
              {conversation.is_city_group
                ? cityMeta.name ||
                  'City Group'
                : conversation.label ||
                  'Group Chat'}
            </Text>
            <Text style={[styles.memberCountText, { color: SUBTLE }]}>
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
    backgroundColor: DARK_BG,
  },
  headerShadowVisible: false,
  headerTintColor: TEXT,
  contentStyle: {
    backgroundColor: DARK_BG,
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

  initialBottomScrollConversationRef.current = null;
  shouldStickToBottomRef.current = true;
  setHasMoreMessages(true);
  fetchUserAndMessages();
  setupRealtime(conversation.id);

  return () => {
    if (messageChannelRef.current) {
      supabase.removeChannel(messageChannelRef.current);
      messageChannelRef.current = null;
    }
    if (typingChannelRef.current) {
      supabase.removeChannel(typingChannelRef.current);
      typingChannelRef.current = null;
    }
    if (convoChannelRef.current) {
      supabase.removeChannel(convoChannelRef.current);
      convoChannelRef.current = null;
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [loadState, conversation?.id]);

  const fetchUserAndMessages = async () => {
    const activeConversation = conversation;
    const convId = activeConversation?.id;
    if (!convId) return;

    const knownUserId =
      userIdRef.current || routeCurrentUserId || routeLegacyUserId || null;
    const userRequest = knownUserId
      ? Promise.resolve({ data: { user: { id: knownUserId } } } as any)
      : supabase.auth.getUser();

    const messagesRequest = supabase
      .from('messages')
      .select(
        'id, conversation_id, sender_id, content, message_type, sent_at, delivered, is_removed, sender:users!messages_sender_id_fkey(id, full_name)'
      )
      .eq('conversation_id', convId)
      .order('sent_at', { ascending: false })
      .limit(CHAT_INITIAL_MESSAGE_LIMIT);

    const [{ data: userData }, { data, error }] = await Promise.all([
      userRequest,
      messagesRequest,
    ]);

    const uid = userData?.user?.id || knownUserId;
    if (!uid) return;
    setUserId(uid);

    if (error || !data) {
      if (error) console.error('Failed to fetch chat messages:', error.message);
      return;
    }
    setHasMoreMessages((data as any[]).length === CHAT_INITIAL_MESSAGE_LIMIT);

    const normalizedAll: Message[] = (data as any[])
      .slice()
      .reverse()
      .map((row: any) => ({
        ...row,
        sender: Array.isArray(row.sender)
          ? row.sender[0] ?? null
          : row.sender ?? null,
      }))
      .filter((row: Message) => !row.is_removed);

    setMessages(normalizedAll);

    const [blockedIds, participantsResult] = await Promise.all([
      fetchBlockedUsers(uid),
      activeConversation?.participant_ids?.length
        ? supabase
            .from('users')
            .select('id, full_name')
            .in('id', activeConversation.participant_ids)
        : Promise.resolve({ data: [] } as any),
    ]);

    const normalized = blockedIds.size
      ? normalizedAll.filter((row: Message) => !blockedIds.has(row.sender_id))
      : normalizedAll;

    if (normalized.length !== normalizedAll.length) {
      setMessages(normalized);
    }

    const fromMsgs: Record<string, { id: string; full_name: string }> = {};

    for (const m of normalized) {
      if (m.sender?.id) {
        fromMsgs[m.sender.id] = {
          id: m.sender.id,
          full_name: m.sender.full_name,
        };
      }
    }

    (participantsResult?.data || []).forEach((u: any) => {
      fromMsgs[u.id] = {
        id: u.id,
        full_name: u.full_name,
      };
    });

    setUserLookup(fromMsgs);

    void supabase
      .from('conversation_reads')
      .upsert(
        {
          user_id: uid,
          conversation_id: convId,
          last_read_at: new Date().toISOString(),
        },
        {
          onConflict: 'user_id,conversation_id',
        }
      )
      .then(({ error: readError }) => {
        if (readError) {
          console.error('Failed to mark conversation read:', readError.message);
          return;
        }
        void markMessageNotificationsRead(convId);
        emitChatBadgeRefresh();
      });
  };

  const loadOlderMessages = async () => {
    const convId = conversation?.id;
    const oldestMessage = messagesRef.current[0];
    if (!convId || !oldestMessage || loadingOlderMessages || !hasMoreMessages) return;

    setLoadingOlderMessages(true);
    try {
      const { data, error } = await supabase
        .from('messages')
        .select(
          'id, conversation_id, sender_id, content, message_type, sent_at, delivered, is_removed, sender:users!messages_sender_id_fkey(id, full_name)'
        )
        .eq('conversation_id', convId)
        .lt('sent_at', oldestMessage.sent_at)
        .order('sent_at', { ascending: false })
        .limit(CHAT_INITIAL_MESSAGE_LIMIT);

      if (error || !data) {
        if (error) console.error('Failed to load older messages:', error.message);
        return;
      }

      setHasMoreMessages((data as any[]).length === CHAT_INITIAL_MESSAGE_LIMIT);

      const normalized: Message[] = (data as any[])
        .slice()
        .reverse()
        .map((row: any) => ({
          ...row,
          sender: Array.isArray(row.sender)
            ? row.sender[0] ?? null
            : row.sender ?? null,
        }))
        .filter(
          (row: Message) =>
            !row.is_removed && !blockedUserIdsRef.current.has(row.sender_id)
        );

      if (!normalized.length) return;

      setMessages((prev) => {
        const existingIds = new Set(prev.map((message) => message.id));
        const older = normalized.filter((message) => !existingIds.has(message.id));
        return older.length ? [...older, ...prev] : prev;
      });

      setUserLookup((prev) => {
        const next = { ...prev };
        normalized.forEach((message) => {
          if (message.sender?.id) {
            next[message.sender.id] = {
              id: message.sender.id,
              full_name: message.sender.full_name,
            };
          }
        });
        return next;
      });
    } finally {
      setLoadingOlderMessages(false);
    }
  };

  const onRefresh = async () => {
  if (!conversation?.id) return;

  setRefreshing(true);

  try {
    if (messagesRef.current.length && hasMoreMessages) {
      await loadOlderMessages();
      return;
    }

    triggerAppRefresh();

    await Promise.allSettled([
      fetchUserAndMessages(),
      conversation.is_group ? refreshMembers() : Promise.resolve(),
    ]);

    if (userId) {
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
      await markMessageNotificationsRead(conversation.id);
    }

    emitChatBadgeRefresh();
  } finally {
    setRefreshing(false);
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
    
    async (payload) => {
  appendMessage((payload as any)?.new);
  if (userIdRef.current) {
    void markMessageNotificationsRead(convId);
  }
  shouldStickToBottomRef.current = true;
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

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      flatListRef.current?.scrollToEnd({
        animated,
      });
    });
  }, []);

  const handleMessageScroll = useCallback((event: any) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom =
      contentSize.height - (contentOffset.y + layoutMeasurement.height);
    shouldStickToBottomRef.current =
      distanceFromBottom < MESSAGE_BOTTOM_THRESHOLD;
  }, []);

  const handleMessageContentSizeChange = useCallback(() => {
    const convId = conversation?.id ?? null;
    const needsInitialBottom =
      !!convId && initialBottomScrollConversationRef.current !== convId;

    if (needsInitialBottom) {
      initialBottomScrollConversationRef.current = convId;
      scrollToBottom(false);
      return;
    }

    if (shouldStickToBottomRef.current) {
      scrollToBottom(true);
    }
  }, [conversation?.id, scrollToBottom]);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const onKeyboardMove = (event: any, visible: boolean) => {
      try {
        Keyboard.scheduleLayoutAnimation?.(event);
      } catch {}
      setKeyboardVisible(visible);
      const keyboardHeight =
        Platform.OS === 'android' && visible
          ? Math.max(0, event?.endCoordinates?.height ?? 0)
          : 0;

      Animated.timing(keyboardOffsetAnim, {
        toValue: keyboardHeight,
        duration:
          typeof event?.duration === 'number'
            ? Math.max(140, Math.min(event.duration, 280))
            : visible
            ? 190
            : 170,
        useNativeDriver: true,
      }).start();

      shouldStickToBottomRef.current = true;
      setTimeout(() => scrollToBottom(true), Platform.OS === 'ios' ? 40 : 80);
    };

    const showSub = Keyboard.addListener(showEvent, (event) =>
      onKeyboardMove(event, true)
    );
    const hideSub = Keyboard.addListener(hideEvent, (event) =>
      onKeyboardMove(event, false)
    );

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, [keyboardOffsetAnim, scrollToBottom]);

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

  const notifyRecipients = async (_messageText: string) => {
    // Supabase triggers send native push notifications for inserted messages.
  };

  const sendMessage = async (rawText: string) => {
  if (conversation?.is_group === false && isBlockedByPeer) {
    Alert.alert('Cannot message user', "You can't message this user.");
    return false;
  }

  if (conversation?.is_group === false && haveIBlockedPeer) {
    Alert.alert('User blocked', 'Unblock this user to send messages.');
    return false;
  }

  const text = rawText.trim();

  if (
    !text ||
    !userId ||
    !conversation?.id
  )
    return false;
    const moderationError = validateSafeText(text);
    if (moderationError) {
      Alert.alert('Content Not Allowed', moderationError);
      return false;
    }
    const { data: insertedMessage, error } =
      await supabase
        .from('messages')
        .insert({
          conversation_id:
            conversation.id,
          sender_id: userId,
          content: text,
          delivered: true,
          message_type: 'text',
        })
        .select('id, conversation_id, sender_id, content, message_type, sent_at, delivered, is_removed')
        .single();
    if (error) {
      Alert.alert(
        'Failed to send',
        error.message
      );
      return false;
    }
    appendMessage(insertedMessage);
    shouldStickToBottomRef.current = true;
    scrollToBottom(true);

    void updateConversationLastMessage(conversation.id, text);
    void notifyRecipients(text);
    void supabase
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
      .then(() => {
        void markMessageNotificationsRead(conversation.id);
        emitChatBadgeRefresh();
      });

    return true;
  };

  const reportMessage = (item: Message) => {
    if (!userId) return;
    setReportTargetMessage(item);
    setReportReason('Harassment or bullying');
    setReportDetails('');
  };

  const submitMessageReport = async () => {
    if (!reportTargetMessage) return;

    const detailsError = validateSafeText(reportDetails);
    if (detailsError) {
      Alert.alert('Content Not Allowed', detailsError);
      return;
    }

    setReportSubmitting(true);
    try {
      const ok = await reportContent({
        reportedUserId: reportTargetMessage.sender_id,
        contentType: 'message',
        contentId: reportTargetMessage.id,
        reason: reportReason,
        details: reportDetails.trim() || null,
      });

      if (ok) {
        setReportTargetMessage(null);
        setReportDetails('');
      }
    } finally {
      setReportSubmitting(false);
    }
  };

  const blockMessageSender = async (item: Message) => {
    if (!userId || item.sender_id === userId) return;

    const confirmed =
      Platform.OS === 'web'
        ? window.confirm(
            'Block this user?\n\nThey won’t be able to interact with you, and their content will be removed from your feed.'
          )
        : await new Promise<boolean>((resolve) => {
            Alert.alert(
              'Block this user?',
              'They won’t be able to interact with you, and their content will be removed from your feed.',
              [
                { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
                { text: 'Block', style: 'destructive', onPress: () => resolve(true) },
              ]
            );
          });

    if (!confirmed) return;

    const ok = await blockUser({
      blockedUserId: item.sender_id,
      reason: 'Blocked from Chat message',
      showAlert: true,
    });

    if (!ok) return;

    setBlockedUserIds((prev) => {
      const next = new Set(prev);
      next.add(item.sender_id);
      return next;
    });
    setMessages((prev) => prev.filter((m) => m.sender_id !== item.sender_id));
    if (conversation?.is_group === false) setHaveIBlockedPeer(true);
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
        const { data: insertedImageMessage, error } =
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
            })
            .select('id, conversation_id, sender_id, content, message_type, sent_at, delivered, is_removed')
            .single();
        setSendingImage(false);
        if (error) {
          Alert.alert(
            'Image send failed',
            error.message
          );
          return;
        }
        appendMessage(insertedImageMessage);
        shouldStickToBottomRef.current = true;
        scrollToBottom(true);
        void updateConversationLastMessage(conversation.id, '[Photo]');
        void notifyRecipients('Sent you a photo');
        void supabase
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
          .then(() => {
            void markMessageNotificationsRead(conversation.id);
            emitChatBadgeRefresh();
          });
      } else {
        const fileName =
          asset.name ||
          'file';
        const content = `📎 File: ${fileName}`;
        const { data: insertedFileMessage, error } =
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
            })
            .select('id, conversation_id, sender_id, content, message_type, sent_at, delivered, is_removed')
            .single();
        if (error) {
          Alert.alert(
            'File send failed',
            error.message
          );
          return;
        }
        appendMessage(insertedFileMessage);
        shouldStickToBottomRef.current = true;
        scrollToBottom(true);
        void updateConversationLastMessage(conversation.id, content);
        void notifyRecipients(content);
        void supabase
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
          .then(() => {
            void markMessageNotificationsRead(conversation.id);
            emitChatBadgeRefresh();
          });
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

  const handleTyping = useCallback(
    (text: string) => {
      if (!text.trim() || !conversation?.id || !typingChannelRef.current || !userId) return;

      const now = Date.now();
      if (now - lastTypingSignalRef.current < 900) return;
      lastTypingSignalRef.current = now;

      typingChannelRef.current.send({
        type: 'broadcast',
        event: 'typing',
        payload: {
          sender: userId,
        },
      });
    },
    [conversation?.id, userId]
  );

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

    if (blockedUserIds.has(item.sender_id)) return null;

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
                ? [styles.imageOutgoing, { backgroundColor: BUBBLE_OUT, borderColor: GOLD }]
                : [styles.imageIncoming, { backgroundColor: ELEVATED, borderColor: BORDER }],
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
                ? [styles.outgoing, { backgroundColor: BUBBLE_OUT, borderColor: GOLD }]
                : [styles.incoming, { backgroundColor: ELEVATED, borderColor: BORDER }],
            ]}
          >
            <Text
              style={[
                styles.messageText,
                { color: isOwn ? colors.textOnPrimary : TEXT },
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
const ChatKeyboardContainer = Platform.OS === 'ios' ? KeyboardAvoidingView : View;
const chatKeyboardContainerProps =
  Platform.OS === 'ios'
    ? {
        behavior: 'padding' as const,
        keyboardVerticalOffset: 0,
      }
    : {};
  return (
        <ChatKeyboardContainer
      style={[styles.container, { backgroundColor: DARK_BG }]}
      {...chatKeyboardContainerProps}
    >
      {!isScreenReady ? (
  <View style={[styles.loaderWrap, { backgroundColor: DARK_BG }]}>
    <ActivityIndicator color={TEXT} />
  </View>
) : (
  <>
        <FlatList
  ref={flatListRef}
  data={messages}
  renderItem={renderItem}
  keyExtractor={(item) => item.id}
  contentContainerStyle={{
    padding: 16,
    paddingTop: 8,
    paddingBottom: Platform.OS === 'android' && keyboardVisible ? 82 : 12,
  }}
  onLayout={() => scrollToBottom(false)}
  onContentSizeChange={handleMessageContentSizeChange}
  onScroll={handleMessageScroll}
  scrollEventThrottle={64}
  removeClippedSubviews={Platform.OS !== 'ios'}
  initialNumToRender={12}
  maxToRenderPerBatch={8}
  windowSize={7}
  updateCellsBatchingPeriod={16}
  automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
  keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
  keyboardShouldPersistTaps="handled"
  refreshControl={
    <RefreshControl
      refreshing={refreshing || loadingOlderMessages}
      onRefresh={onRefresh}
      tintColor={GOLD}
      progressBackgroundColor={ELEVATED}
    />
  }
/>

    {typingUser && (
      <Text style={[styles.typingText, { color: SUBTLE }]}>Someone is typing…</Text>
    )}

    <Animated.View
      style={[
        styles.composerLift,
        Platform.OS === 'android'
          ? {
              transform: [
                {
                  translateY: keyboardOffsetAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, -1],
                  }),
                },
              ],
            }
          : null,
      ]}
    >
      <ChatComposer
        mutedColor={SUBTLE}
        backgroundColor={DARK_BG}
        borderColor={BORDER}
        inputBackgroundColor={ELEVATED}
        textColor={TEXT}
        sendingImage={sendingImage}
        disabled={messagingDisabled}
        isBlockedByPeer={isBlockedByPeer}
        haveIBlockedPeer={haveIBlockedPeer}
        bottomInset={Platform.OS === 'web' || keyboardVisible ? 0 : insets.bottom}
        onAttach={sendFile}
        onSend={sendMessage}
        onTyping={handleTyping}
      />
    </Animated.View>
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
      <ReportContentModal
        visible={!!reportTargetMessage}
        selectedReason={reportReason}
        details={reportDetails}
        submitting={reportSubmitting}
        onReasonChange={setReportReason}
        onDetailsChange={setReportDetails}
        onClose={() => {
          if (!reportSubmitting) setReportTargetMessage(null);
        }}
        onSubmit={submitMessageReport}
      />
    </ChatKeyboardContainer>
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
  messageSafetyRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
    marginLeft: 8,
  },
  messageSafetyBtn: {
    paddingVertical: 2,
    paddingHorizontal: 2,
  },
  messageSafetyText: {
    color: SUBTLE,
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
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
  composerLift: {
    width: '100%',
    zIndex: 5,
    elevation: 5,
  },

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
