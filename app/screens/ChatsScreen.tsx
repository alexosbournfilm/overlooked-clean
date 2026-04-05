import React, {
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TextInput,
  Alert,
  Image,
  Pressable,
  Platform,
  ImageBackground,
  Modal,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  useNavigation,
  useRoute,
  useFocusEffect,
} from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { formatDistanceToNow } from 'date-fns';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import {
  emitChatBadgeRefresh,
  subscribeChatBadgeRefresh,
} from '../lib/chatBadgeEvents';
/* ────────────────────────────────────────────────────────────
   CINEMATIC NOIR — black/white with gold accent
   ──────────────────────────────────────────────────────────── */
const GOLD = '#C6A664';
const T = {
  bg: '#000000',
  card: '#0A0A0A',
  card2: '#0E0E0E',
  text: '#FFFFFF',
  sub: '#DADADA',
  mute: '#9A9A9A',
  border: '#ffffff14',
  accent: GOLD,
  olive: GOLD,
};

const FONT_CINEMATIC =
  Platform.select({
    ios: 'Cinzel',
    android: 'Cinzel',
    default: 'Cinzel',
  }) || 'Cinzel';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

/* ---------------- Film Grain ---------------- */
const GRAIN_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIElEQVQYV2P8//8/AzGAiYGB4T8mGJgYhBmMCEwMDAwA1wQq1i3gN8QAAAAASUVORK5CYII=';

const Grain = ({ opacity = 0.06 }: { opacity?: number }) => (
  <View
    pointerEvents="none"
    style={[StyleSheet.absoluteFillObject, { opacity }]}
  >
    {Platform.OS === 'web' ? (
      // @ts-ignore
      <View
        style={
          [
            StyleSheet.absoluteFillObject as any,
            {
              backgroundImage: `url(${GRAIN_PNG})`,
              backgroundRepeat: 'repeat',
              backgroundSize: 'auto',
            },
          ] as any
        }
      />
    ) : (
      <ImageBackground
        source={{ uri: GRAIN_PNG }}
        style={StyleSheet.absoluteFillObject}
        resizeMode={'repeat' as any}
      />
    )}
  </View>
);

/* ──────────────────────────────────────────────────────────── */

type HideMap = Record<string, string>;
type SimpleUser = {
  id: string;
  full_name: string;
  avatar_url: string | null;
  level?: number | null;
};

/* Level-based ring colors */

// throttle helper
const throttle = (fn: () => void, wait: number) => {
  let last = 0;
  let timer: any = null;
  return () => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      last = now;
      fn();
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = null;
        fn();
      }, remaining);
    }
  };
};

// storage keys
const storageKeyFor = (userId: string) =>
  `OVERLOOKED_HIDE_MAP:${userId}`;
const unhideKeyFor = (userId: string) =>
  `OVERLOOKED_UNHIDE_SET:${userId}`;

export default function ChatsScreen() {
    const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const insets = useSafeAreaInsets();

  const [meId, setMeId] = useState<string | null>(null);
  const isGuest = !meId;

  const promptSignIn = (message: string) => {
    if (Platform.OS === 'web') {
      const goToSignIn = window.confirm(
        `${message}\n\nPress OK for Sign In, or Cancel for Create Account.`
      );

      if (goToSignIn) {
        navigation.navigate('Auth', { screen: 'SignIn' });
      } else {
        navigation.navigate('Auth', { screen: 'SignUp' });
      }
      return;
    }

    Alert.alert(
      'Sign in required',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign In',
          onPress: () => navigation.navigate('Auth', { screen: 'SignIn' }),
        },
        {
          text: 'Create Account',
          onPress: () => navigation.navigate('Auth', { screen: 'SignUp' }),
        },
      ]
    );
  };

  
  const [loadingCityChat, setLoadingCityChat] = useState(false);
  const [loadingChats, setLoadingChats] = useState(true);
  const [chats, setChats] = useState<any[]>([]);
  const [unreadConversationIds, setUnreadConversationIds] = useState<Set<string>>(new Set());
const unreadRequestInFlight = useRef(false);
const unreadRefreshTimeout = useRef<any>(null);
  const [search, setSearch] = useState('');

  // users search tab
  const [activeTab, setActiveTab] =
  useState<'chats' | 'contacts' | 'users'>('chats');
  const [userQuery, setUserQuery] = useState('');
  const [users, setUsers] = useState<SimpleUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(
    null
  );
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const [optionsModalVisible, setOptionsModalVisible] = useState(false);
const [selectedChat, setSelectedChat] = useState<any | null>(null);
const [newChatMenuVisible, setNewChatMenuVisible] = useState(false);

  // create group modal
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupAvatarLocalUri, setGroupAvatarLocalUri] = useState<string | null>(null);

  // ✅ WEB FIX: store base64 for web so we never fetch(uri) (prevents “Load failed”)
  const [groupAvatarBase64, setGroupAvatarBase64] = useState<string | null>(null);
  const [groupAvatarMime, setGroupAvatarMime] = useState<string | null>(null);

  const [groupMemberIds, setGroupMemberIds] = useState<Set<string>>(new Set());
  const [groupUserQuery, setGroupUserQuery] = useState('');
  const [groupUsers, setGroupUsers] = useState<SimpleUser[]>([]);
  const [loadingGroupUsers, setLoadingGroupUsers] = useState(false);

  const [hideMap, setHideMap] = useState<HideMap>({});
  const hideMapRef = useRef<HideMap>({});
  const unhideSetRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
    useEffect(() => {
    return () => {
      if (unreadRefreshTimeout.current) {
        clearTimeout(unreadRefreshTimeout.current);
      }
    };
  }, []);

  const getFlagUri = (countryCode?: string | null) => {
    if (!countryCode) return null;
    return `https://flagcdn.com/w80/${String(
      countryCode
    ).toLowerCase()}.png`;
  };

  // ✅ helper: Alert.alert is flaky on web sometimes; this makes errors always visible
  const showAlert = (title: string, message: string) => {
    if (Platform.OS === 'web') {
      // @ts-ignore
      window.alert(`${title}\n\n${message}`);
    } else {
      Alert.alert(title, message);
    }
  };

  useEffect(() => {
  let isMounted = true;

  supabase.auth.getSession().then(({ data, error }) => {
    if (error) {
      console.error('getSession error:', error.message);
      return;
    }
    if (isMounted) {
      setMeId(data.session?.user?.id ?? null);
    }
  });

  const {
    data: { subscription },
  } = supabase.auth.onAuthStateChange((_event, session) => {
    if (isMounted) {
      setMeId(session?.user?.id ?? null);
    }
  });

  return () => {
    isMounted = false;
    subscription.unsubscribe();
  };
}, []);

  // AsyncStorage helpers
  const loadLocalHides = useCallback(
    async (uid: string): Promise<HideMap> => {
      try {
        const raw = await AsyncStorage.getItem(
          storageKeyFor(uid)
        );
        return raw ? JSON.parse(raw) : {};
      } catch {
        return {};
      }
    },
    []
  );

  const saveLocalHides = useCallback(
    async (uid: string, map: HideMap) => {
      try {
        await AsyncStorage.setItem(
          storageKeyFor(uid),
          JSON.stringify(map)
        );
      } catch {}
    },
    []
  );

  const loadUnhideSet = useCallback(
    async (uid: string): Promise<Set<string>> => {
      try {
        const raw = await AsyncStorage.getItem(
          unhideKeyFor(uid)
        );
        const arr: string[] = raw ? JSON.parse(raw) : [];
        return new Set(arr);
      } catch {
        return new Set();
      }
    },
    []
  );

  const saveUnhideSet = useCallback(
    async (uid: string, set: Set<string>) => {
      try {
        await AsyncStorage.setItem(
          unhideKeyFor(uid),
          JSON.stringify(Array.from(set))
        );
      } catch {}
    },
    []
  );

  // Mark conversation active (unhide)
  const markConversationActive = useCallback(
    async (conversationId: string) => {
      let uid = meId;
      if (!uid) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        uid = session?.user?.id ?? null;
        if (mountedRef.current) setMeId(uid);
      }
      if (!uid) return;

      const cid = String(conversationId);

      const newMap = { ...hideMapRef.current };
      delete newMap[cid];
      hideMapRef.current = newMap;
      if (mountedRef.current) setHideMap(newMap);
      await saveLocalHides(uid, newMap);

      const newUnhide = new Set(unhideSetRef.current);
      newUnhide.add(cid);
      unhideSetRef.current = newUnhide;
      await saveUnhideSet(uid, newUnhide);

      try {
        await supabase
          .from('conversation_hides')
          .delete()
          .eq('user_id', uid)
          .eq('conversation_id', cid);
      } catch {}
    },
    [meId, saveLocalHides, saveUnhideSet]
  );

  // Fetch hides
  const fetchHides = useCallback(
    async (uid: string) => {
      let serverMap: HideMap = {};
      try {
        const { data } = await supabase
          .from('conversation_hides')
          .select('conversation_id, hidden_at')
          .eq('user_id', uid);
        (data || []).forEach((row: any) => {
          serverMap[row.conversation_id] = row.hidden_at;
        });
      } catch {}

      const localMap = await loadLocalHides(uid);
      const unhideSet = await loadUnhideSet(uid);

      const merged: HideMap = { ...serverMap };
      Object.keys(localMap).forEach((cid) => {
        const a = serverMap[cid];
        const b = localMap[cid];
        if (
          !a ||
          new Date(b).getTime() >
            new Date(a).getTime()
        ) {
          merged[cid] = b;
        }
      });

      unhideSet.forEach((cid) => {
        delete merged[cid];
      });

      if (mountedRef.current) {
        hideMapRef.current = merged;
        unhideSetRef.current = unhideSet;
        setHideMap(merged);
      }
    },
    [loadLocalHides, loadUnhideSet]
  );
  const fetchBlockedUsers = useCallback(async (uid: string) => {
  try {
    const { data, error } = await supabase
      .from('blocked_users')
      .select('blocked_id')
      .eq('blocker_id', uid);

    if (error) {
      console.error('Error fetching blocked users:', error.message);
      return;
    }

    setBlockedUserIds(new Set((data || []).map((row: any) => row.blocked_id)));
  } catch (e) {
    console.error('fetchBlockedUsers error:', e);
  }
}, []);

const loadUnreadConversationIds = useCallback(async (userIdParam?: string | null) => {
  const uid = userIdParam || meId;

  if (!uid) {
    setUnreadConversationIds(new Set());
    return;
  }

  if (unreadRequestInFlight.current) return;
  unreadRequestInFlight.current = true;

  try {
    const { data: conversations, error: convoError } = await supabase
      .from('conversations')
      .select('id')
      .contains('participant_ids', [uid]);

    if (convoError) {
      console.error('Unread conversations fetch error:', convoError.message);
      return;
    }

    const conversationIds = (conversations || []).map((c: any) => c.id);

    if (!conversationIds.length) {
      setUnreadConversationIds(new Set());
      return;
    }

    const { data: reads, error: readsError } = await supabase
      .from('conversation_reads')
      .select('conversation_id, last_read_at')
      .eq('user_id', uid)
      .in('conversation_id', conversationIds);

    if (readsError) {
      console.error('Unread reads fetch error:', readsError.message);
      return;
    }

    const readsMap = new Map<string, string>();
    (reads || []).forEach((row: any) => {
      readsMap.set(String(row.conversation_id), row.last_read_at);
    });

    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('conversation_id, sent_at, sender_id')
      .in('conversation_id', conversationIds)
      .neq('sender_id', uid);

    if (msgError) {
      console.error('Unread messages fetch error:', msgError.message);
      return;
    }

    const unreadIds = new Set<string>();

    (messages || []).forEach((msg: any) => {
      const cid = String(msg.conversation_id);
      const lastReadAt = readsMap.get(cid);

      if (!lastReadAt || new Date(msg.sent_at).getTime() > new Date(lastReadAt).getTime()) {
        unreadIds.add(cid);
      }
    });

    setUnreadConversationIds(unreadIds);
  } catch (e: any) {
    console.error('loadUnreadConversationIds error:', e?.message || e);
  } finally {
    unreadRequestInFlight.current = false;
  }
}, [meId]);
const queueUnreadRefresh = useCallback(() => {
  if (unreadRefreshTimeout.current) {
    clearTimeout(unreadRefreshTimeout.current);
  }

  unreadRefreshTimeout.current = setTimeout(() => {
    loadUnreadConversationIds();
  }, 250);
}, [loadUnreadConversationIds]);

  // Core fetch
  const fetchUserChats = useCallback(
    async (opts?: { showSpinner?: boolean }) => {
      try {
        if (opts?.showSpinner !== false) {
          if (mountedRef.current)
            setLoadingChats(true);
        }

        let uid = meId;
        if (!uid) {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          uid = session?.user?.id ?? null;
          if (mountedRef.current) setMeId(uid);
        }
        if (!uid) {
          if (mountedRef.current) {
            setChats([]);
            hideMapRef.current = {};
            unhideSetRef.current = new Set();
            setHideMap({});
          }
          return;
        }

                await fetchHides(uid);
        await fetchBlockedUsers(uid);
        await loadUnreadConversationIds(uid);

        const { data: conversations, error } =
          await supabase
            .from('conversations')
            .select(
              'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at,group_avatar_url,created_by'
            )
            .contains('participant_ids', [uid])
            .order('last_message_sent_at', {
              ascending: false,
              nullsFirst: false,
            })
            .order('created_at', {
              ascending: false,
            });

        if (error) {
          console.error(
            'Error fetching conversations:',
            error.message
          );
          if (mountedRef.current) setChats([]);
          return;
        }

        const peerIdsSet = new Set<string>();
        const cityIdsSet = new Set<number>();

        (conversations ?? []).forEach((c) => {
          if (!c.is_group) {
            const other = (c.participant_ids || []).find(
              (pid: string) => pid !== uid
            );
            if (other) peerIdsSet.add(other);
          } else if (
            c.is_city_group &&
            typeof c.city_id === 'number'
          ) {
            cityIdsSet.add(c.city_id);
          }
        });

        const peerIds = Array.from(peerIdsSet);
        const cityIds = Array.from(cityIdsSet);

        let peerMap: Record<
          string,
          {
            id: string;
            full_name: string;
            avatar_url: string | null;
            level?: number | null;
          }
        > = {};

        if (peerIds.length) {
          const { data: peers } = await supabase
            .from('users')
            .select(
              'id, full_name, avatar_url, level'
            )
            .in('id', peerIds);
          (peers || []).forEach((u) => {
            peerMap[u.id] = {
              id: u.id,
              full_name: u.full_name,
              avatar_url: u.avatar_url ?? null,
              level: u.level ?? null,
            };
          });
        }

        let cityMap: Record<
          number,
          {
            id: number;
            name: string;
            country_code: string | null;
          }
        > = {};

        if (cityIds.length) {
          const { data: cities } = await supabase
            .from('cities')
            .select(
              'id, name, country_code'
            )
            .in('id', cityIds);
          (cities || []).forEach((ct) => {
            cityMap[ct.id] = {
              id: ct.id,
              name: ct.name,
              country_code:
                ct.country_code ?? null,
            };
          });
        }

        const chatsWithMetadata =
          await Promise.all(
            (conversations ?? []).map(
              async (conv) => {
                let lastContent =
                  conv.last_message_content as
                    | string
                    | null;
                let lastTime =
                  conv.last_message_sent_at as
                    | string
                    | null;

                if (!lastContent || !lastTime) {
                  const { data: messages } =
                    await supabase
                      .from(
                        'messages'
                      )
                      .select(
                        'content, sent_at, sender_id'
                      )
                      .eq(
                        'conversation_id',
                        conv.id
                      )
                      .order('sent_at', {
                        ascending: false,
                      })
                      .limit(1);
                  const lastMessage =
                    messages?.[0];
                  lastContent =
                    lastContent ||
                    lastMessage?.content ||
                    'No messages yet';
                  lastTime =
                    lastTime ||
                    lastMessage?.sent_at ||
                    null;
                }

                let isTyping = false;
                if (uid) {
                  const {
                    data: typingData,
                  } = await supabase
                    .from(
                      'typing_indicators'
                    )
                    .select('user_id')
                    .eq(
                      'conversation_id',
                      conv.id
                    )
                    .neq('user_id', uid)
                    .maybeSingle();
                  isTyping = typingData !== null;
                }

                let derivedTitle:
                  | string
                  | undefined;
                let peerUser:
                  | {
                      id: string;
                      full_name: string;
                      avatar_url: string | null;
                      level?: number | null;
                    }
                  | undefined;
                let cityInfo:
                  | {
                      name:
                        | string
                        | undefined;
                      country_code: string | null;
                      flagUri: string | null;
                    }
                  | undefined;

                if (!conv.is_group) {
                  const otherId = (
                    conv.participant_ids ||
                    []
                  ).find(
                    (pid: string) =>
                      pid !== uid
                  );
                  if (otherId) {
                    const p =
                      peerMap[otherId];
                    peerUser = p;
                    derivedTitle =
                      p?.full_name ||
                      'Conversation';
                  } else {
                    derivedTitle =
                      'Conversation';
                  }
                } else if (
                  conv.is_city_group &&
                  typeof conv.city_id ===
                    'number'
                ) {
                  const c =
                    cityMap[conv.city_id];
                  const cityName =
                    c?.name;
                  const flagUri =
                    getFlagUri(
                      c?.country_code ??
                        null
                    );
                  cityInfo = {
                    name: cityName,
                    country_code:
                      c?.country_code ??
                      null,
                    flagUri,
                  };
                }

                return {
                  ...conv,
                  lastMessage:
                    lastContent ||
                    'No messages yet',
                  lastMessageTime:
                    lastTime ||
                    conv.created_at,
                  isTyping,
                  derivedTitle,
                  peerUser,
                  cityInfo,
                };
              }
            )
          );

        const map = hideMapRef.current;
        const unhide =
          unhideSetRef.current;
        const filtered =
          chatsWithMetadata.filter(
            (c) => {
              if (
                unhide.has(
                  String(c.id)
                )
              )
                return true;
              const hiddenAt =
                map[c.id];
              if (!hiddenAt)
                return true;
              const lastTs =
                new Date(
                  c.lastMessageTime ||
                    c.created_at
                ).getTime();
              const hiddenTs =
                new Date(
                  hiddenAt
                ).getTime();
              return lastTs > hiddenTs;
            }
          );

        if (mountedRef.current)
          setChats(filtered);
      } finally {
        if (
          mountedRef.current &&
          opts?.showSpinner !== false
        ) {
          setLoadingChats(false);
        }
      }
    },
        [meId, fetchHides, fetchBlockedUsers, loadUnreadConversationIds]
  );

  // initial / focus fetch
  useEffect(() => {
    fetchUserChats({ showSpinner: true });
  }, [fetchUserChats]);
    useEffect(() => {
    if (!meId) {
      setUnreadConversationIds(new Set());
      return;
    }

    loadUnreadConversationIds(meId);
  }, [meId, loadUnreadConversationIds]);

  useFocusEffect(
    useCallback(() => {
      let canceled = false;
      const t = setTimeout(() => {
        if (!canceled)
          fetchUserChats({
            showSpinner: false,
          });
      }, 100);
      return () => {
        canceled = true;
        clearTimeout(t);
      };
    }, [fetchUserChats])
  );
    useEffect(() => {
    const unsubscribe = subscribeChatBadgeRefresh(() => {
      queueUnreadRefresh();
    });

    return unsubscribe;
  }, [queueUnreadRefresh]);

  // realtime
    useEffect(() => {
    if (!meId) return;

    let convoChannel: any;
    let msgChannel: any;
    let readsChannel: any;

    const throttledRefresh = throttle(() => {
      fetchUserChats({
        showSpinner: false,
      });
      queueUnreadRefresh();
    }, 800);

    (async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) return;

      convoChannel = supabase
        .channel('realtime-conversations')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversations',
          },
          () => throttledRefresh()
        )
        .subscribe();

      msgChannel = supabase
        .channel('realtime-messages')
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
          },
          () => throttledRefresh()
        )
        .subscribe();

      readsChannel = supabase
        .channel('realtime-conversation-reads')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'conversation_reads',
            filter: `user_id=eq.${meId}`,
          },
          () => throttledRefresh()
        )
        .subscribe();
    })();

    return () => {
      if (convoChannel) supabase.removeChannel(convoChannel);
      if (msgChannel) supabase.removeChannel(msgChannel);
      if (readsChannel) supabase.removeChannel(readsChannel);
    };
  }, [meId, fetchUserChats, queueUnreadRefresh]);

  // deep-link joins
  useEffect(() => {
    if (route.params?.groupChatCityId) {
      handleJoinCityById(
        route.params.groupChatCityId
      );
    } else if (route.params?.groupChatCity) {
      handleGroupChatJoinLegacy(
        route.params.groupChatCity
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route.params]);

  // users search
  const fetchUsers = useCallback(
    async (q: string) => {
            if (isGuest) {
        if (mountedRef.current) setUsers([]);
        return;
      }
      try {
        setLoadingUsers(true);

        let query = supabase
          .from('users')
          .select(
            'id, full_name, avatar_url, level'
          )
          .order('full_name', {
            ascending: true,
          })
          .limit(30);

        if (q.trim().length > 0) {
          query = query.ilike(
            'full_name',
            `%${q.trim()}%`
          );
        } else {
          if (mountedRef.current)
            setUsers([]);
          return;
        }

        if (meId)
          query = query.neq('id', meId);

        const { data, error } =
          await query;
        if (error) {
          console.error(
            'User search error:',
            error.message
          );
          if (mountedRef.current)
            setUsers([]);
          return;
        }
        if (mountedRef.current)
          setUsers(
            (data || []) as SimpleUser[]
          );
      } finally {
        if (mountedRef.current)
          setLoadingUsers(false);
      }
    },
        [meId, isGuest]
  );
  const fetchContactUsers = useCallback(
  async (q: string) => {
    if (isGuest || !meId) {
      if (mountedRef.current) setUsers([]);
      return;
    }

    try {
      setLoadingUsers(true);

      const { data: conversations, error: convoError } = await supabase
        .from('conversations')
        .select('participant_ids,is_group')
        .contains('participant_ids', [meId]);

      if (convoError) {
        console.error('Contact search conversation error:', convoError.message);
        if (mountedRef.current) setUsers([]);
        return;
      }

      const peerIds = Array.from(
        new Set(
          (conversations || [])
            .filter((c: any) => !c.is_group)
            .flatMap((c: any) => c.participant_ids || [])
            .filter((id: string) => id !== meId)
        )
      );

      if (!peerIds.length) {
        if (mountedRef.current) setUsers([]);
        return;
      }

      let query = supabase
        .from('users')
        .select('id, full_name, avatar_url, level')
        .in('id', peerIds)
        .order('full_name', { ascending: true })
        .limit(30);

      if (q.trim().length > 0) {
        query = query.ilike('full_name', `%${q.trim()}%`);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Contact search user error:', error.message);
        if (mountedRef.current) setUsers([]);
        return;
      }

      if (mountedRef.current) {
        setUsers((data || []) as SimpleUser[]);
      }
    } finally {
      if (mountedRef.current) setLoadingUsers(false);
    }
  },
  [isGuest, meId]
);

  useEffect(() => {
  if (activeTab !== 'users' && activeTab !== 'contacts') return;

  const t = setTimeout(() => {
    if (activeTab === 'contacts') {
      fetchContactUsers(userQuery);
    } else {
      fetchUsers(userQuery);
    }
  }, 250);

  return () => clearTimeout(t);
}, [userQuery, activeTab, fetchUsers, fetchContactUsers]);

  /* ─────────────────────────────
     GROUP CHAT CREATION
     ───────────────────────────── */

  const resetGroupModal = () => {
    setGroupName('');
    setGroupAvatarLocalUri(null);
    setGroupAvatarBase64(null);
    setGroupAvatarMime(null);
    setGroupMemberIds(new Set());
    setGroupUserQuery('');
    setGroupUsers([]);
  };

    const openCreateGroup = () => {
    if (isGuest) {
      promptSignIn('Create an account or sign in to create group chats.');
      return;
    }

    resetGroupModal();
    setCreateGroupOpen(true);
  };

  const pickGroupAvatar = async () => {
        if (isGuest) {
      promptSignIn('Create an account or sign in to create group chats.');
      return;
    }
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        showAlert(
          'Permission needed',
          'Allow photo access to choose a group image.'
        );
        return;
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.85,

        // ✅ KEY: base64 makes uploads reliable on WEB (no fetch(uri))
        base64: Platform.OS === 'web',
      });

      if (res.canceled) return;

      const asset = res.assets?.[0];
      const uri = asset?.uri;
      if (uri) setGroupAvatarLocalUri(uri);

      if (Platform.OS === 'web') {
        // On web, use base64 upload to avoid “Load failed” from fetch(uri)
        const b64 = (asset as any)?.base64 || null;
        setGroupAvatarBase64(b64);
        // try to infer mime
        const mime = (asset as any)?.mimeType || 'image/jpeg';
        setGroupAvatarMime(mime);
      }
    } catch (e: any) {
      showAlert('Avatar error', String(e?.message ?? e));
    }
  };

  // Small helper for web base64 -> Uint8Array (no extra deps)
  const base64ToUint8Array = (base64: string) => {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  };

  const uploadGroupAvatar = async (uri: string) => {
    const { data: authData } = await supabase.auth.getUser();
    const uid = authData?.user?.id;
    if (!uid) throw new Error('Not signed in');

    // ✅ On WEB: upload from base64 (prevents fetch(uri) “Load failed”)
    if (Platform.OS === 'web') {
      if (!groupAvatarBase64) {
        throw new Error('Web avatar missing base64 data.');
      }

      const mime = groupAvatarMime || 'image/jpeg';
      const ext =
        mime.includes('png') ? 'png' :
        mime.includes('webp') ? 'webp' :
        'jpg';

      const filePath = `${uid}/${Date.now()}.${ext}`;
      const bytes = base64ToUint8Array(groupAvatarBase64);

      const { error: uploadError } = await supabase.storage
        .from('group_avatars')
        .upload(filePath, bytes, {
          upsert: true,
          contentType: mime,
        });

      if (uploadError) throw uploadError;

      const { data: pub } = supabase.storage
        .from('group_avatars')
        .getPublicUrl(filePath);

      return pub.publicUrl;
    }

    // ✅ Native: your existing blob upload (works fine)
    const ext = uri.split('.').pop()?.toLowerCase() || 'jpg';
    const filePath = `${uid}/${Date.now()}.${ext}`;

    let resp: Response;
    try {
      resp = await fetch(uri);
    } catch (e: any) {
      // This is where “Load failed” was coming from on web — native should rarely hit this.
      throw new Error(e?.message || 'Failed to load image for upload.');
    }

    const blob = await resp.blob();

    const { error: uploadError } = await supabase.storage
      .from('group_avatars')
      .upload(filePath, blob, {
        upsert: true,
        contentType: ext === 'png' ? 'image/png' : 'image/jpeg',
      });

    if (uploadError) throw uploadError;

    const { data: pub } = supabase.storage
      .from('group_avatars')
      .getPublicUrl(filePath);

    return pub.publicUrl;
  };

  const fetchGroupUsers = useCallback(async (q: string) => {
        if (isGuest) {
      setGroupUsers([]);
      return;
    }
    try {
      setLoadingGroupUsers(true);

      let query = supabase
        .from('users')
        .select('id, full_name, avatar_url, level')
        .order('full_name', { ascending: true })
        .limit(30);

      if (q.trim().length > 0) {
        query = query.ilike('full_name', `%${q.trim()}%`);
      } else {
        setGroupUsers([]);
        return;
      }

      if (meId) query = query.neq('id', meId);

      const { data, error } = await query;
      if (error) throw error;

      setGroupUsers((data || []) as SimpleUser[]);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoadingGroupUsers(false);
    }
    }, [meId, isGuest]);

  useEffect(() => {
    if (!createGroupOpen) return;
    const t = setTimeout(() => {
      fetchGroupUsers(groupUserQuery);
    }, 250);
    return () => clearTimeout(t);
  }, [groupUserQuery, createGroupOpen, fetchGroupUsers]);

  const toggleMember = (id: string) => {
        if (isGuest) {
      promptSignIn('Create an account or sign in to add people to a group.');
      return;
    }
    setGroupMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createGroupChat = async () => {
        if (isGuest) {
      promptSignIn('Create an account or sign in to create group chats.');
      return;
    }
    try {
      if (!groupName.trim()) {
        showAlert('Group name needed', 'Enter a name for the group.');
        return;
      }

      const { data: authData } = await supabase.auth.getUser();
      const uid = authData?.user?.id;
      if (!uid) throw new Error('Not signed in');

      const members = Array.from(groupMemberIds);
      if (members.length < 1) {
        showAlert('Add members', 'Select at least 1 person to create a group.');
        return;
      }

      setCreatingGroup(true);

      let avatarUrl: string | null = null;

      // ✅ IMPORTANT: avatar upload should NEVER block group creation.
      // If it fails, we continue without the avatar and show a message.
      if (groupAvatarLocalUri) {
        try {
          avatarUrl = await uploadGroupAvatar(groupAvatarLocalUri);
        } catch (e: any) {
          console.error('Group avatar upload failed:', e);
          avatarUrl = null;
          showAlert(
            'Group photo failed',
            `The group will be created without a photo.\n\n${String(e?.message ?? e)}`
          );
        }
      }

      const participantIds = Array.from(new Set([uid, ...members]));

      const { data: convo, error } = await supabase
        .from('conversations')
        .insert([
          {
            is_group: true,
            is_city_group: false,
            label: groupName.trim(),
            participant_ids: participantIds,
            group_avatar_url: avatarUrl,
            created_by: uid,
            last_message_content: null,
            last_message_sent_at: null,
          },
        ])
        .select('id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at,group_avatar_url,created_by')
        .single();

      if (error) throw error;

      setCreateGroupOpen(false);

      await markConversationActive(String(convo.id));

      // If your ChatRoom is in a nested stack and this doesn’t navigate,
      // tell me your navigator names and I’ll adjust the navigate call.
      navigation.navigate('ChatRoom', { conversation: convo });

      // refresh list quickly
      fetchUserChats({ showSpinner: false });
    } catch (e: any) {
      console.error(e);
      showAlert('Could not create group', String(e?.message ?? e));
    } finally {
      setCreatingGroup(false);
    }
  };

  // join flows
  const handleJoinCityById = async (
    cityId: number
  ) => {
        if (isGuest) {
      promptSignIn('Create an account or sign in to join city chats.');
      return;
    }
    try {
      setLoadingCityChat(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.user)
        throw new Error(
          'You must be signed in.'
        );

      const {
        data: conversationId,
        error,
      } = await supabase.rpc(
        'join_city_group',
        { city_id_input: cityId }
      );
      if (error) throw error;

      await markConversationActive(
        String(conversationId)
      );

      const {
        data: convo,
        error: convoErr,
      } = await supabase
        .from('conversations')
        .select(
          'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at,group_avatar_url,created_by'
        )
        .eq('id', conversationId)
        .single();
      if (convoErr) throw convoErr;

      navigation.navigate(
        'ChatRoom',
        { conversation: convo }
      );
    } catch (e: any) {
      console.error(e);
      showAlert(
        'Couldn’t join city chat',
        String(e?.message ?? e)
      );
    } finally {
      setLoadingCityChat(false);
    }
  };

  const handleGroupChatJoinLegacy =
    async (cityLabel: string) => {
            if (isGuest) {
        promptSignIn('Create an account or sign in to join group chats.');
        return;
      }
      try {
        setLoadingCityChat(true);
        const {
          data: { session },
          error: userError,
        } = await supabase.auth.getSession();
        if (userError || !session?.user)
          throw new Error(
            userError?.message ||
              'Not signed in'
          );

        const user = session.user;
        const label = cityLabel.toLowerCase();

        const {
          data: existingChats,
        } = await supabase
          .from('conversations')
          .select(
            'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at,group_avatar_url,created_by'
          )
          .eq('is_group', true)
          .eq('label', label)
          .limit(1);

        let chat =
          existingChats?.[0];

        if (!chat) {
          const {
            data: newChat,
            error: insertError,
          } = await supabase
            .from(
              'conversations'
            )
            .insert([
              {
                is_group: true,
                is_city_group: false,
                participant_ids: [
                  user.id,
                ],
                label,
                last_message_content:
                  null,
                last_message_sent_at:
                  null,
              },
            ])
            .select(
              'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at,group_avatar_url,created_by'
            )
            .single();
          if (insertError)
            throw insertError;
          chat = newChat;
        } else if (
          !(
            chat.participant_ids || []
          ).includes(user.id)
        ) {
          const updatedParticipants =
            Array.from(
              new Set([
                ...(chat.participant_ids ||
                  []),
                user.id,
              ])
            );
          const {
            data: updated,
            error: updateError,
          } = await supabase
            .from(
              'conversations'
            )
            .update({
              participant_ids:
                updatedParticipants,
            })
            .eq('id', chat.id)
            .select(
              'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at,group_avatar_url,created_by'
            )
            .single();
          if (updateError)
            throw updateError;
          chat = updated;
        }

        await markConversationActive(
          String(chat.id)
        );

        navigation.navigate(
          'ChatRoom',
          { conversation: chat }
        );
      } catch (e: any) {
        console.error(e);
        showAlert(
          'Couldn’t join group chat',
          String(e?.message ?? e)
        );
      } finally {
        setLoadingCityChat(false);
      }
    };

    const leaveGroupChat = async (chat: any) => {
  try {
    setDeletingId(chat.id);

    const { error } = await supabase.rpc('leave_group_chat', {
      conversation_id_input: chat.id,
    });

    if (error) {
      throw error;
    }

    setChats((prev) => prev.filter((c) => String(c.id) !== String(chat.id)));

    showAlert('Left group', 'You are no longer part of this group chat.');
    emitChatBadgeRefresh();
  } catch (e: any) {
    console.error('leaveGroupChat error:', e?.message || e);
    showAlert('Could not leave group', String(e?.message ?? e));
  } finally {
    setDeletingId(null);
  }
};

  // hide (delete for me)
  const removeChatForMe = async (
    chat: any
  ) => {
    try {
      setDeletingId(chat.id);

      let uid = meId;
      if (!uid) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        uid = session?.user?.id ?? null;
        if (mountedRef.current)
          setMeId(uid);
      }
      if (!uid)
        throw new Error(
          'Not signed in'
        );

      const nowIso =
        new Date().toISOString();
      const cid = String(chat.id);

      const newMap = {
        ...hideMapRef.current,
        [cid]: nowIso,
      };
      hideMapRef.current = newMap;
      setHideMap(newMap);
      setChats((prev) =>
        prev.filter(
          (c) =>
            String(c.id) !== cid
        )
      );

      const newUnhide =
        new Set(unhideSetRef.current);
      if (newUnhide.has(cid)) {
        newUnhide.delete(cid);
        unhideSetRef.current =
          newUnhide;
        await saveUnhideSet(
          uid,
          newUnhide
        );
      }

      await saveLocalHides(
        uid,
        newMap
      );

      try {
        await supabase
          .from(
            'conversation_hides'
          )
          .upsert(
            {
              user_id: uid,
              conversation_id: cid,
              hidden_at: nowIso,
            },
            {
              onConflict:
                'user_id,conversation_id',
            }
          );
      } catch {}
    } catch (e: any) {
      console.error(e);
      showAlert(
        'Couldn’t remove chat',
        String(e?.message ?? e)
      );
    } finally {
      setDeletingId(null);
    }
  };
const blockUser = async (targetUserId: string) => {
  if (!meId) return;

  try {
    const { error } = await supabase
      .from('blocked_users')
      .insert({
        blocker_id: meId,
        blocked_id: targetUserId,
      });

    if (error) {
      showAlert('Could not block user', error.message);
      return;
    }

    setBlockedUserIds((prev) => {
      const next = new Set(prev);
      next.add(targetUserId);
      return next;
    });

    showAlert('User blocked', 'You have blocked this user.');
  } catch (e: any) {
    showAlert('Could not block user', String(e?.message ?? e));
  }
};

const unblockUser = async (targetUserId: string) => {
  if (!meId) return;

  try {
    const { error } = await supabase
      .from('blocked_users')
      .delete()
      .eq('blocker_id', meId)
      .eq('blocked_id', targetUserId);

    if (error) {
      showAlert('Could not unblock user', error.message);
      return;
    }

    setBlockedUserIds((prev) => {
      const next = new Set(prev);
      next.delete(targetUserId);
      return next;
    });

    showAlert('User unblocked', 'They can message you again.');
  } catch (e: any) {
    showAlert('Could not unblock user', String(e?.message ?? e));
  }
};

const openChatOptions = (chat: any) => {
  if (chat?.is_group) {
    if (Platform.OS === 'web') {
      setSelectedChat(chat);
      setOptionsModalVisible(true);
      return;
    }

    Alert.alert(
      chat?.label || 'Group chat',
      'Do you want to leave this group chat?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Leave group',
          style: 'destructive',
          onPress: () => leaveGroupChat(chat),
        },
      ]
    );
    return;
  }

  if (!chat?.peerUser?.id) {
    removeChatForMe(chat);
    return;
  }

  const targetUserId = chat.peerUser.id;
  const isBlocked = blockedUserIds.has(targetUserId);
  const displayName = chat.peerUser.full_name || 'User';

  if (Platform.OS === 'web') {
    setSelectedChat(chat);
    setOptionsModalVisible(true);
    return;
  }

  Alert.alert(displayName, 'Choose an action', [
    {
      text: isBlocked ? 'Unblock' : 'Block',
      onPress: () =>
        isBlocked
          ? unblockUser(targetUserId)
          : blockUser(targetUserId),
    },
    {
      text: 'Delete',
      style: 'destructive',
      onPress: () => removeChatForMe(chat),
    },
    {
      text: 'Cancel',
      style: 'cancel',
    },
  ]);
};

const closeOptionsModal = () => {
  setOptionsModalVisible(false);
  setSelectedChat(null);
};

const handleWebBlockToggle = async () => {
  if (!selectedChat?.peerUser?.id) return;

  const targetUserId = selectedChat.peerUser.id;
  const isBlocked = blockedUserIds.has(targetUserId);

  closeOptionsModal();

  if (isBlocked) {
    await unblockUser(targetUserId);
  } else {
    await blockUser(targetUserId);
  }
};

const handleWebDelete = async () => {
  if (!selectedChat) return;
  const chatToDelete = selectedChat;
  closeOptionsModal();
  await removeChatForMe(chatToDelete);
};
  /* -------- row renderer: chats (with level rings) -------- */

  const renderItem = ({
    item,
  }: any) => {
    const timeAgo = item.lastMessageTime
      ? formatDistanceToNow(
          new Date(
            item.lastMessageTime
          ),
          { addSuffix: true }
        )
      : '';

    const title = item.is_group
      ? item.is_city_group
        ? item.cityInfo?.name ||
          item.label ||
          'City'
        : item.label
  ? item.label
  : 'Group chat'
      : item.derivedTitle ||
        'Conversation';

    const isDirect =
      !item.is_group;
    const isCityGroup =
      item.is_group &&
      item.is_city_group;
    const isNormalGroup =
      item.is_group &&
      !item.is_city_group;

    const avatarUri = isDirect
      ? item?.peerUser
          ?.avatar_url || undefined
      : isCityGroup
      ? item.cityInfo
          ?.flagUri || undefined
      : isNormalGroup
      ? item?.group_avatar_url || undefined
      : undefined;

    

        const memberCount =
      Array.isArray(
        item.participant_ids
      )
        ? item.participant_ids
            .length
        : 0;
    const isDeleting =
      deletingId === item.id;
    const isUnread = unreadConversationIds.has(String(item.id));
const isDirectBlocked =
  !item.is_group &&
  !!item?.peerUser?.id &&
  blockedUserIds.has(item.peerUser.id);
    return (
      <Pressable
  android_ripple={{ color: '#1A1A1A' }}
  style={({ pressed }) => [
    styles.chatCard,
    pressed && styles.chatCardPressed,
    isDeleting && {
      opacity: 0.6,
    },
  ]}
                                onPress={async () => {
  if (isDeleting) return;

  if (isGuest) {
    promptSignIn('Create an account or sign in to open chats.');
    return;
  }

  if (isDirectBlocked) {
    showAlert(
      'User blocked',
      'You have blocked this user. Unblock them to open the chat.'
    );
    return;
  }

  try {
    if (meId && item?.id) {
      await supabase
        .from('conversation_reads')
        .upsert(
          {
            user_id: meId,
            conversation_id: item.id,
            last_read_at: new Date().toISOString(),
          },
          {
            onConflict: 'user_id,conversation_id',
          }
        );

      setUnreadConversationIds((prev) => {
        const next = new Set(prev);
        next.delete(String(item.id));
        return next;
      });

      emitChatBadgeRefresh();
    }
  } catch (e: any) {
    console.error('Failed to mark read from ChatsScreen:', e?.message || e);
  }

  navigation.navigate('ChatRoom', {
    conversation: item,
    peerUser: item.peerUser,
  });

  requestAnimationFrame(() => {
    markConversationActive(String(item.id));
  });
}}
        onLongPress={() =>
          removeChatForMe(item)
        }
        disabled={isDeleting}
      >
        <View style={styles.leftRow}>
          {/* Direct chat: avatar with level ring */}
          {isDirect &&
  (avatarUri ? (
    <Image
      source={{ uri: avatarUri }}
      style={styles.avatar as any}
    />
  ) : (
    <View style={[styles.avatar, styles.fallbackAvatar]}>
      <Ionicons
        name="person-outline"
        size={20}
        color={T.sub}
      />
    </View>
  ))}

          {/* City group: flag only, no ring */}
          {isCityGroup &&
            (avatarUri ? (
              <Image
  source={{
    uri: avatarUri,
  }}
  style={styles.avatar as any}
/>
            ) : (
              <View
                style={[
                  styles.avatar,
                  styles.fallbackAvatar,
                ]}
              >
                <Ionicons
                  name="location-outline"
                  size={20}
                  color={T.sub}
                />
              </View>
            ))}

          {/* Normal group: group avatar */}
          {isNormalGroup &&
            (avatarUri ? (
              <Image
  source={{ uri: avatarUri }}
  style={styles.avatar as any}
/>
            ) : (
              <View
                style={[
                  styles.avatar,
                  styles.fallbackAvatar,
                ]}
              >
                <Ionicons
                  name="people-outline"
                  size={20}
                  color={T.sub}
                />
              </View>
            ))}

                    <View
            style={{
              flexShrink: 1,
              flex: 1,
            }}
          >
            <View style={styles.chatNameRow}>
              <Text
                style={[
                  styles.chatName,
                  isUnread && styles.chatNameUnread,
                ]}
                numberOfLines={1}
              >
                {title}
              </Text>

              {isUnread ? <View style={styles.inlineUnreadDot} /> : null}
            </View>

            <Text
              style={
                styles.chatMessage
              }
              numberOfLines={1}
            >
              {isDirectBlocked
                ? 'Blocked user'
                : item.isTyping
                ? 'Typing…'
                : item.lastMessage}
            </Text>
          </View>
        </View>

        <View style={styles.rightMeta} pointerEvents="box-none">
  <Text style={styles.timeText} numberOfLines={1}>
    {timeAgo}
  </Text>

  <Pressable
    style={styles.trashHitBox}
    onPress={(e) => {
      e.stopPropagation?.();

      if (isGuest) {
        promptSignIn('Create an account or sign in to manage chats.');
        return;
      }

      openChatOptions(item);
    }}
  >
    {isDeleting ? (
      <ActivityIndicator size="small" color={T.accent} />
    ) : (
      <Ionicons
        name="ellipsis-horizontal"
        size={16}
        color="#8A8A8A"
      />
    )}
  </Pressable>
</View>
      </Pressable>
    );
  };

  const filteredChats = chats.filter((chat) => {
  const normalizedTitle = chat.is_group
    ? chat.is_city_group
      ? chat.cityInfo?.name || chat.label || ''
      : chat.label ?? 'group chat'
    : chat.derivedTitle?.toLowerCase?.() || 'conversation';

  return normalizedTitle
    .toLowerCase()
    .includes(search.toLowerCase());
});

  /* -------- row renderer: users (with rings) -------- */

  const renderUser = ({
    item,
  }: {
    item: SimpleUser;
  }) => {
    const avatarUri =
      item.avatar_url ||
      undefined;
    

    return (
      <Pressable
  android_ripple={{ color: '#1A1A1A' }}
  style={({ pressed }) => [
    styles.userCard,
    pressed && styles.userCardPressed,
  ]}
  onPress={() => {
          if (isGuest) {
            promptSignIn('Create an account or sign in to message or view users.');
            return;
          }

          navigation.navigate('Profile', {
  user: item,
  userId: item.id,
});
        }}
      >
        {avatarUri ? (
  <Image
    source={{ uri: avatarUri }}
    style={styles.avatar as any}
  />
) : (
  <View style={[styles.avatar, styles.fallbackAvatar]}>
    <Ionicons
      name="person-outline"
      size={20}
      color={T.sub}
    />
  </View>
)}

        <Text
          style={
            styles.userName
          }
          numberOfLines={1}
        >
          {item.full_name}
        </Text>
        <Ionicons
          name="chevron-forward"
          size={18}
          color={T.sub}
        />
      </Pressable>
    );
  };

  /* -------- top search / tabs header -------- */

  const TopSearchHeader = (
  <View style={[styles.searchHeader, { paddingTop: 4 }]}>
    <View style={styles.topBar}>
  <View style={styles.topBarLeft}>
    {activeTab !== 'chats' ? (
      <Pressable
        onPress={() => {
          setActiveTab('chats');
          setUserQuery('');
        }}
        style={styles.backButton}
      >
        <Ionicons name="chevron-back" size={18} color={T.text} />
      </Pressable>
    ) : null}

    <Text style={styles.recentChatsTitle}>
      {activeTab === 'contacts'
        ? 'Search current contacts'
        : activeTab === 'users'
        ? 'New 1-to-1 chat'
        : 'Recent chats'}
    </Text>
  </View>

  <Pressable
    onPress={() => {
      if (isGuest) {
        promptSignIn('Create an account or sign in to start a new chat.');
        return;
      }
      setNewChatMenuVisible(true);
    }}
    style={styles.plusButton}
  >
    <Ionicons name="add" size={20} color={T.text} />
  </Pressable>
</View>

    

    {activeTab === 'chats' ? (
  <View style={styles.searchInputWrap}>
    <Ionicons name="search-outline" size={18} color={T.mute} />
    <TextInput
      placeholder="Search recent chats"
      placeholderTextColor={T.mute}
      style={styles.searchInputInline}
      value={search}
      onChangeText={setSearch}
      autoCorrect={false}
      autoCapitalize="none"
    />
  </View>
) : (
  <View style={styles.searchInputWrap}>
    <Ionicons name="search-outline" size={18} color={T.mute} />
    <TextInput
      onFocus={() => {
        if (isGuest) {
          promptSignIn(
            activeTab === 'contacts'
              ? 'Create an account or sign in to search current contacts.'
              : 'Create an account or sign in to start a new 1-to-1 chat.'
          );
        }
      }}
      placeholder={
        activeTab === 'contacts'
          ? 'Search current contacts'
          : 'Search all users'
      }
      placeholderTextColor={T.mute}
      style={styles.searchInputInline}
      value={userQuery}
      onChangeText={(text) => {
        if (isGuest) {
          promptSignIn(
            activeTab === 'contacts'
              ? 'Create an account or sign in to search current contacts.'
              : 'Create an account or sign in to start a new 1-to-1 chat.'
          );
          return;
        }
        setUserQuery(text);
      }}
      autoCapitalize="words"
      autoCorrect={false}
    />
  </View>
)}
  </View>
);

  /* -------- render -------- */

  return (
    <SafeAreaView
  style={[
    styles.container,
    {
      paddingTop: insets.top > 0 ? 6 : 12,
      paddingBottom: Math.max(insets.bottom, 8),
    },
  ]}
  edges={['top', 'left', 'right']}
>
      <LinearGradient
        colors={[T.bg, T.bg]}
        start={{ x: 0, y: 0 }}
        end={{ x: 0, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <Grain opacity={0.05} />

      {loadingCityChat && (
        <View
          style={
            styles.loadingOverlay
          }
        >
          <ActivityIndicator
            size="large"
            color={T.accent}
          />
          <Text
            style={
              styles.loadingText
            }
          >
            Loading group
            chat…
          </Text>
        </View>
      )}

      {TopSearchHeader}

      {activeTab ===
      'chats' ? (
        loadingChats ? (
          <ActivityIndicator
            size="large"
            color={T.accent}
            style={{
              marginTop: 20,
            }}
          />
        ) : (
          <FlatList
            data={
              filteredChats
            }
            keyExtractor={(
              item
            ) =>
              String(
                item.id
              )
            }
            renderItem={
              renderItem
            }
            contentInsetAdjustmentBehavior="automatic"
            keyboardShouldPersistTaps="handled"
            maxToRenderPerBatch={8}
updateCellsBatchingPeriod={16}
            contentContainerStyle={{
              paddingTop: 4,
              paddingBottom:
                Math.max(
                  insets.bottom +
                    12,
                  24
                ),
            }}
            ListEmptyComponent={
              <Text
                style={
                  styles.emptyText
                }
              >
                No chats
                found.
              </Text>
            }
            onRefresh={() =>
              fetchUserChats(
                {
                  showSpinner:
                    true,
                }
              )
            }
            refreshing={
              loadingChats
            }
            removeClippedSubviews
            windowSize={9}
            initialNumToRender={
              12
            }
          />
        )
      ) : (
        <FlatList
          data={users}
          keyExtractor={(
            item
          ) => item.id}
          renderItem={
            renderUser
          }
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          maxToRenderPerBatch={8}
updateCellsBatchingPeriod={16}
          contentContainerStyle={{
            paddingTop: 4,
            paddingBottom:
              Math.max(
                insets.bottom +
                  12,
                24
              ),
          }}
          ListEmptyComponent={
  loadingUsers ? null : (
    <Text style={styles.emptyText}>
      {userQuery.trim().length === 0
        ? activeTab === 'contacts'
          ? 'Start typing a name to search your chats.'
          : 'Start typing a name to search all users.'
        : activeTab === 'contacts'
        ? 'No current contacts found.'
        : 'No users found.'}
    </Text>
  )
}
          onRefresh={() =>
            fetchUsers(
              userQuery
            )
          }
          refreshing={
            loadingUsers
          }
          removeClippedSubviews
          windowSize={10}
          initialNumToRender={
            15
          }
        />
      )}

      <Modal
  visible={optionsModalVisible}
  transparent
  animationType="fade"
  onRequestClose={closeOptionsModal}
>
  <Pressable
    style={styles.modalBackdrop}
    onPress={closeOptionsModal}
  />
  <View style={styles.optionsModalCard}>
    <Text style={styles.optionsModalTitle}>
      {selectedChat?.is_group
        ? selectedChat?.label || 'Group chat'
        : selectedChat?.peerUser?.full_name || 'Chat options'}
    </Text>

    {selectedChat?.is_group ? (
      <TouchableOpacity
        style={[styles.optionsModalButton, styles.optionsDeleteButton]}
        onPress={async () => {
          const chatToLeave = selectedChat;
          closeOptionsModal();
          await leaveGroupChat(chatToLeave);
        }}
        activeOpacity={0.85}
      >
        <Text style={styles.optionsDeleteButtonText}>Leave group chat</Text>
      </TouchableOpacity>
    ) : (
      <>
        <TouchableOpacity
          style={styles.optionsModalButton}
          onPress={handleWebBlockToggle}
          activeOpacity={0.85}
        >
          <Text style={styles.optionsModalButtonText}>
            {selectedChat?.peerUser?.id &&
            blockedUserIds.has(selectedChat.peerUser.id)
              ? 'Unblock'
              : 'Block'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.optionsModalButton, styles.optionsDeleteButton]}
          onPress={handleWebDelete}
          activeOpacity={0.85}
        >
          <Text style={styles.optionsDeleteButtonText}>Delete</Text>
        </TouchableOpacity>
      </>
    )}

    <TouchableOpacity
      style={styles.optionsModalCancel}
      onPress={closeOptionsModal}
      activeOpacity={0.85}
    >
      <Text style={styles.optionsModalCancelText}>Cancel</Text>
    </TouchableOpacity>
  </View>
</Modal>

<Modal
  visible={newChatMenuVisible}
  transparent
  animationType="fade"
  onRequestClose={() => setNewChatMenuVisible(false)}
>
  <Pressable
    style={styles.modalBackdrop}
    onPress={() => setNewChatMenuVisible(false)}
  />

  <View style={styles.optionsModalCard}>
    <Text style={styles.optionsModalTitle}>Start chat</Text>

    <TouchableOpacity
      style={styles.optionsModalButton}
      onPress={() => {
        setNewChatMenuVisible(false);
        setActiveTab('users');
      }}
      activeOpacity={0.85}
    >
      <Text style={styles.optionsModalButtonText}>New 1-to-1 chat</Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={styles.optionsModalButton}
      onPress={() => {
        setNewChatMenuVisible(false);
        openCreateGroup();
      }}
      activeOpacity={0.85}
    >
      <Text style={styles.optionsModalButtonText}>New group chat</Text>
    </TouchableOpacity>

    <TouchableOpacity
      style={styles.optionsModalCancel}
      onPress={() => setNewChatMenuVisible(false)}
      activeOpacity={0.85}
    >
      <Text style={styles.optionsModalCancelText}>Cancel</Text>
    </TouchableOpacity>
  </View>
</Modal>

      {/* ───────────── Create Group Modal ───────────── */}
      <Modal
        visible={createGroupOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setCreateGroupOpen(false)}
      >
        <Pressable
          style={styles.modalBackdrop}
          onPress={() => setCreateGroupOpen(false)}
        />
        <View style={styles.modalSheet}>
          <View style={styles.sheetHandle} />

          <View style={styles.modalHeaderRow}>
            <Text style={styles.modalTitle}>Create Group</Text>
            <TouchableOpacity
              onPress={() => setCreateGroupOpen(false)}
              style={styles.modalCloseBtn}
            >
              <Ionicons name="close" size={22} color={T.text} />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: 18 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.modalLabel}>Group name</Text>
            <TextInput
              value={groupName}
              onChangeText={setGroupName}
              placeholder="e.g. London Film Crew"
              placeholderTextColor={T.mute}
              style={styles.modalInput}
              autoCapitalize="words"
            />

            <Text style={styles.modalLabel}>Group photo</Text>
            <View style={styles.avatarPickRow}>
              <TouchableOpacity
                onPress={pickGroupAvatar}
                style={styles.avatarPickBtn}
                activeOpacity={0.85}
              >
                <Ionicons name="image-outline" size={18} color={T.text} />
                <Text style={styles.avatarPickBtnText}>
                  {groupAvatarLocalUri ? 'Change photo' : 'Choose photo'}
                </Text>
              </TouchableOpacity>

              <View style={styles.avatarPreviewRing}>
                {groupAvatarLocalUri ? (
                  <Image
  source={{ uri: groupAvatarLocalUri }}
  style={styles.avatarPreview as any}
/>
                ) : (
                  <View style={[styles.avatarPreview, styles.fallbackAvatar]}>
                    <Ionicons name="people-outline" size={20} color={T.sub} />
                  </View>
                )}
              </View>
            </View>

            <Text style={styles.modalLabel}>Add members</Text>
            <TextInput
              value={groupUserQuery}
              onChangeText={setGroupUserQuery}
              placeholder="Search users…"
              placeholderTextColor={T.mute}
              style={styles.modalInput}
              autoCorrect={false}
            />
            <View style={styles.createGroupTopRow}>
  <View style={styles.selectedCountTopWrap}>
    <Text style={styles.selectedCountText}>
      Selected: {Array.from(groupMemberIds).length}
    </Text>
  </View>

  <TouchableOpacity
    onPress={createGroupChat}
    disabled={creatingGroup}
    activeOpacity={0.85}
    style={[
      styles.createBtnTop,
      creatingGroup && { opacity: 0.7 },
    ]}
  >
    {creatingGroup ? (
      <ActivityIndicator color="#000" />
    ) : (
      <>
        <Ionicons name="chatbubble-ellipses-outline" size={16} color="#000" />
        <Text style={styles.createBtnTopText}>Create Group</Text>
      </>
    )}
  </TouchableOpacity>
</View>

            {loadingGroupUsers ? (
              <ActivityIndicator
                color={T.accent}
                style={{ marginTop: 10 }}
              />
            ) : null}

            {(groupUsers || []).map((u) => {
              const selected = groupMemberIds.has(u.id);
              
              return (
                <Pressable
                  key={u.id}
                  onPress={() => toggleMember(u.id)}
                  style={[
                    styles.memberPickRow,
                    selected && { borderColor: T.olive },
                  ]}
                >
                  {u.avatar_url ? (
  <Image source={{ uri: u.avatar_url }} style={styles.avatarSmall as any} />
) : (
  <View style={[styles.avatarSmall, styles.fallbackAvatar]}>
    <Ionicons name="person-outline" size={16} color={T.sub} />
  </View>
)}

                  <Text style={styles.memberPickName} numberOfLines={1}>
                    {u.full_name}
                  </Text>

                  <View style={styles.checkCircle}>
                    {selected ? (
                      <Ionicons name="checkmark" size={16} color={T.text} />
                    ) : null}
                  </View>
                </Pressable>
              );
            })}

            
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}



const RADIUS = 16;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.bg,
    paddingHorizontal: 14,
  },
optionsModalCard: {
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: 320,
  transform: [{ translateX: -160 }, { translateY: -120 }],
  backgroundColor: '#050505',
  borderRadius: 20,
  padding: 18,
  borderWidth: 1,
  borderColor: '#151515',
},

optionsModalTitle: {
  color: T.text,
  fontSize: 18,
  fontWeight: '700',
  fontFamily: SYSTEM_SANS,
  marginBottom: 14,
  textAlign: 'center',
},

optionsModalButton: {
  backgroundColor: '#111111',
  borderRadius: 14,
  paddingVertical: 14,
  paddingHorizontal: 14,
  marginBottom: 10,
  alignItems: 'center',
  justifyContent: 'center',
},

optionsModalButtonText: {
  color: T.text,
  fontSize: 15,
  fontWeight: '700',
  fontFamily: SYSTEM_SANS,
},

optionsDeleteButton: {
  backgroundColor: '#1A1010',
  borderWidth: 1,
  borderColor: '#3A1C1C',
},

optionsDeleteButtonText: {
  color: '#FF8A8A',
  fontSize: 15,
  fontWeight: '700',
  fontFamily: SYSTEM_SANS,
},

optionsModalCancel: {
  marginTop: 4,
  alignItems: 'center',
  justifyContent: 'center',
  paddingVertical: 12,
},

optionsModalCancelText: {
  color: '#8F8F8F',
  fontSize: 14,
  fontWeight: '600',
  fontFamily: SYSTEM_SANS,
},

  /* Search header / tabs */
  searchHeader: {
  backgroundColor: 'transparent',
  paddingBottom: 12,
  paddingHorizontal: 2,
},
  topBar: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginTop: 8,
  marginBottom: 12,
},
recentChatsTitle: {
  color: T.text,
  fontSize: 16,
  fontWeight: '800',
  fontFamily: SYSTEM_SANS,
},

plusButton: {
  width: 40,
  height: 40,
  borderRadius: 12,
  backgroundColor: '#141414',
  alignItems: 'center',
  justifyContent: 'center',
  borderWidth: 1,
  borderColor: '#151515',
},

contactsShortcut: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  marginBottom: 10,
  paddingHorizontal: 2,
},

contactsShortcutText: {
  color: T.sub,
  fontSize: 13,
  fontWeight: '600',
  fontFamily: SYSTEM_SANS,
},

searchInputWrap: {
  height: 46,
  backgroundColor: '#0B0B0B',
  borderRadius: 16,
  paddingHorizontal: 14,
  borderWidth: 1,
  borderColor: '#151515',
  flexDirection: 'row',
  alignItems: 'center',
},

searchInputInline: {
  flex: 1,
  color: T.text,
  fontFamily: SYSTEM_SANS,
  fontSize: 14,
  marginLeft: 10,
},
  tabPill: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  tabPillActive: {
    backgroundColor: '#141414',
  },
  tabText: {
    color: '#8F8F8F',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 0.2,
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'none',
  },
  tabTextActive: {
    color: T.text,
  },
  topBarLeft: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
},

backButton: {
  width: 32,
  height: 32,
  borderRadius: 10,
  backgroundColor: '#141414',
  alignItems: 'center',
  justifyContent: 'center',
},

  createGroupPill: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#141414',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 2,
  },

  searchInput: {
    height: 46,
    backgroundColor: '#0B0B0B',
    borderRadius: 14,
    paddingHorizontal: 14,
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#151515',
    color: T.text,
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
  },
  createGroupTopRow: {
  marginTop: 12,
  marginBottom: 8,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
},

selectedCountTopWrap: {
  flex: 1,
},

createBtnTop: {
  height: 42,
  borderRadius: 12,
  backgroundColor: T.olive,
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'row',
  gap: 6,
  paddingHorizontal: 14,
},

createBtnTopText: {
  color: '#000',
  fontWeight: '700',
  fontFamily: SYSTEM_SANS,
  fontSize: 13,
},

  /* Chat rows */
  chatCard: {
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: '#070707',
  paddingHorizontal: 12,
  paddingVertical: 12,
  borderRadius: 16,
  marginBottom: 8,
  borderWidth: 1,
  borderColor: '#111111',
  minHeight: 76,
},
  chatCardPressed: {
  opacity: 0.88,
  transform: [{ scale: 0.995 }],
},
  leftRow: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  flex: 1,
  paddingRight: 10,
},

  avatarRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 2,
    backgroundColor: '#050505',
  },
  avatar: {
  width: 48,
  height: 48,
  borderRadius: 24,
  backgroundColor: '#111',
},
  fallbackAvatar: {
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
  },

    chatNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 3,
    maxWidth: '100%',
  },

  chatName: {
    fontSize: 15,
    color: T.text,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
  },

  chatNameUnread: {
    color: GOLD,
  },

  inlineUnreadDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: '#000000',
    flexShrink: 0,
  },
  chatMessage: {
  fontSize: 13,
  color: '#9A9A9A',
  maxWidth: 220,
  flexShrink: 1,
  lineHeight: 18,
  fontFamily: SYSTEM_SANS,
  fontWeight: '400',
},
  timeText: {
  fontSize: 11,
  color: '#7D7D7D',
  marginBottom: 6,
  textAlign: 'right',
  fontFamily: SYSTEM_SANS,
},
  rightMeta: {
  alignItems: 'flex-end',
  justifyContent: 'flex-start',
  alignSelf: 'stretch',
  paddingLeft: 8,
  minWidth: 58,
},
  memberPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: '#111111',
    marginBottom: 8,
  },
  memberPillText: {
    marginLeft: 4,
    fontSize: 11,
    color: '#CFCFCF',
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
  },

  trashHitBox: {
  alignSelf: 'flex-end',
  padding: 4,
  borderRadius: 10,
  backgroundColor: 'transparent',
},

  /* Loading overlay */
  loadingOverlay: {
    position: 'absolute',
    zIndex: 10,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000000cc',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: T.text,
    fontWeight: '700',
    letterSpacing: 0.2,
    fontFamily: SYSTEM_SANS,
    textTransform: 'none',
    fontSize: 14,
  },

  emptyText: {
    color: '#7F7F7F',
    textAlign: 'center',
    marginTop: 40,
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    lineHeight: 20,
  },

  /* user search items */
  userCard: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 12,
  backgroundColor: '#070707',
  borderWidth: 1,
  borderColor: '#111111',
  borderRadius: 16,
  paddingHorizontal: 12,
  paddingVertical: 12,
  marginBottom: 8,
  minHeight: 72,
},
  userName: {
  flex: 1,
  fontSize: 15,
  fontWeight: '700',
  color: T.text,
  fontFamily: SYSTEM_SANS,
},
  userCardPressed: {
  opacity: 0.88,
  transform: [{ scale: 0.995 }],
},

  /* Modal styles */
  modalBackdrop: {
    flex: 1,
    backgroundColor: '#00000088',
  },
  modalSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '82%',
    backgroundColor: '#050505',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: '#151515',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  sheetHandle: {
    width: 42,
    height: 5,
    backgroundColor: '#2A2A2A',
    borderRadius: 999,
    alignSelf: 'center',
    marginVertical: 8,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  modalTitle: {
    fontSize: 18,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 0,
    color: T.text,
    letterSpacing: 0,
    textTransform: 'none',
  },
  modalCloseBtn: {
    padding: 8,
    borderRadius: 12,
    backgroundColor: '#101010',
  },
  modalLabel: {
    marginTop: 14,
    marginBottom: 8,
    fontSize: 12,
    fontWeight: '600',
    color: '#B5B5B5',
    letterSpacing: 0,
    textTransform: 'none',
    fontFamily: SYSTEM_SANS,
  },
  modalInput: {
    height: 46,
    backgroundColor: '#0B0B0B',
    borderRadius: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#151515',
    color: T.text,
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
  },

  avatarPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  avatarPickBtn: {
    flex: 1,
    height: 46,
    borderRadius: 14,
    backgroundColor: '#0B0B0B',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#151515',
  },
  avatarPickBtnText: {
    color: T.text,
    fontWeight: '600',
    letterSpacing: 0,
    fontFamily: SYSTEM_SANS,
    textTransform: 'none',
    fontSize: 13,
  },
  avatarPreviewRing: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: '#151515',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#101010',
  },
  avatarPreview: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },

  memberPickRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#151515',
    backgroundColor: '#0B0B0B',
  },
  avatarRingSmall: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarSmall: {
  width: 36,
  height: 36,
  borderRadius: 18,
  backgroundColor: '#111',
  alignItems: 'center',
  justifyContent: 'center',
  marginRight: 10,
},
  memberPickName: {
    flex: 1,
    color: T.text,
    fontWeight: '600',
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    textTransform: 'none',
    letterSpacing: 0,
  },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#141414',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedCountRow: {
    marginTop: 12,
    alignItems: 'flex-end',
  },
  selectedCountText: {
    color: '#8B8B8B',
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
  },
  

  createBtn: {
    marginTop: 16,
    height: 48,
    borderRadius: 14,
    backgroundColor: T.olive,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  createBtnText: {
    color: '#000',
    fontWeight: '700',
    letterSpacing: 0,
    textTransform: 'none',
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
  },
});