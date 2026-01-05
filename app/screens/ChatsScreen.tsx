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
  accent: '#FFFFFF',
  olive: GOLD,
};

const FONT_CINEMATIC =
  Platform.select({
    ios: 'Cinzel',
    android: 'Cinzel',
    default: 'Cinzel',
  }) || 'Cinzel';

const FONT_OBLIVION =
  Platform.select({
    ios: 'Avenir Next',
    android: 'sans-serif-light',
    default: 'Avenir Next',
  }) || 'Avenir Next';

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
const getLevelRingColor = (level?: number | null): string => {
  if (!level || level < 25) return '#FFFFFF'; // 1–24 (and unknown)
  if (level < 50) return '#C0C0C0'; // 25–49 silver
  return '#FFD700'; // 50+ gold
};

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
  const [loadingCityChat, setLoadingCityChat] = useState(false);
  const [loadingChats, setLoadingChats] = useState(true);
  const [chats, setChats] = useState<any[]>([]);
  const [search, setSearch] = useState('');

  // users search tab
  const [activeTab, setActiveTab] =
    useState<'chats' | 'users'>('chats');
  const [userQuery, setUserQuery] = useState('');
  const [users, setUsers] = useState<SimpleUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(
    null
  );

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

  // session -> meId
  useEffect(() => {
    (async () => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();
      if (error) {
        console.error('getSession error:', error.message);
        return;
      }
      if (mountedRef.current)
        setMeId(session?.user?.id ?? null);
    })();
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
    [meId, fetchHides]
  );

  // initial / focus fetch
  useEffect(() => {
    fetchUserChats({ showSpinner: true });
  }, [fetchUserChats]);

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

  // realtime
  useEffect(() => {
    if (!meId) return;

    let convoChannel: any;
    let msgChannel: any;
    const throttledRefresh = throttle(
      () =>
        fetchUserChats({
          showSpinner: false,
        }),
      800
    );

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
    })();

    return () => {
      if (convoChannel)
        supabase.removeChannel(
          convoChannel
        );
      if (msgChannel)
        supabase.removeChannel(
          msgChannel
        );
    };
  }, [meId, fetchUserChats]);

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
    [meId]
  );

  useEffect(() => {
    if (activeTab !== 'users') return;
    const t = setTimeout(() => {
      fetchUsers(userQuery);
    }, 250);
    return () => clearTimeout(t);
  }, [
    userQuery,
    activeTab,
    fetchUsers,
  ]);

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
    resetGroupModal();
    setCreateGroupOpen(true);
  };

  const pickGroupAvatar = async () => {
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
  }, [meId]);

  useEffect(() => {
    if (!createGroupOpen) return;
    const t = setTimeout(() => {
      fetchGroupUsers(groupUserQuery);
    }, 250);
    return () => clearTimeout(t);
  }, [groupUserQuery, createGroupOpen, fetchGroupUsers]);

  const toggleMember = (id: string) => {
    setGroupMemberIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const createGroupChat = async () => {
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
        ? `Group: ${item.label}`
        : 'Group Chat'
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

    const peerLevel: number | null =
      isDirect
        ? item?.peerUser
            ?.level ?? null
        : null;

    const ringColor = isDirect
      ? getLevelRingColor(
          peerLevel
        )
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

    return (
      <Pressable
        style={[
          styles.chatCard,
          isDeleting && {
            opacity: 0.6,
          },
        ]}
        onPress={async () => {
          if (isDeleting) return;
          await markConversationActive(
            String(item.id)
          );
          navigation.navigate(
            'ChatRoom',
            {
              conversation: item,
              peerUser:
                item.peerUser,
            }
          );
        }}
        onLongPress={() =>
          removeChatForMe(item)
        }
        disabled={isDeleting}
      >
        <View style={styles.leftRow}>
          {/* Direct chat: avatar with level ring */}
          {isDirect &&
            (avatarUri ||
              true) && (
              <View
                style={[
                  styles.avatarRing,
                  {
                    borderColor:
                      ringColor,
                  },
                ]}
              >
                {avatarUri ? (
                  <Image
                    source={{
                      uri: avatarUri,
                    }}
                    style={
                      styles.avatar
                    }
                  />
                ) : (
                  <View
                    style={[
                      styles.avatar,
                      styles.fallbackAvatar,
                    ]}
                  >
                    <Ionicons
                      name="person-outline"
                      size={20}
                      color={T.sub}
                    />
                  </View>
                )}
              </View>
            )}

          {/* City group: flag only, no ring */}
          {isCityGroup &&
            (avatarUri ? (
              <Image
                source={{
                  uri: avatarUri,
                }}
                style={
                  styles.avatar
                }
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
                style={styles.avatar}
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
            }}
          >
            <Text
              style={
                styles.chatName
              }
              numberOfLines={1}
            >
              {title}
            </Text>
            <Text
              style={
                styles.chatMessage
              }
              numberOfLines={1}
            >
              {item.isTyping
                ? 'Typing…'
                : item.lastMessage}
            </Text>
          </View>
        </View>

        <View
          style={styles.rightMeta}
          pointerEvents="box-none"
        >
          {item.is_group && (
            <View
              style={
                styles.memberPill
              }
            >
              <Ionicons
                name="people-outline"
                size={14}
                color={T.sub}
              />
              <Text
                style={
                  styles.memberPillText
                }
              >
                {
                  memberCount
                }
              </Text>
            </View>
          )}

          <Text
            style={styles.timeText}
            numberOfLines={1}
          >
            {timeAgo}
          </Text>

          <View
            style={
              styles.trashHitBox
            }
            onStartShouldSetResponder={() =>
              true
            }
            onResponderRelease={() =>
              removeChatForMe(
                item
              )
            }
          >
            {isDeleting ? (
              <ActivityIndicator
                size="small"
                color={
                  T.accent
                }
              />
            ) : (
              <Ionicons
                name="trash-outline"
                size={18}
                color={
                  T.sub
                }
              />
            )}
          </View>
        </View>
      </Pressable>
    );
  };

  const filteredChats =
    chats.filter((chat) => {
      const normalizedTitle =
        chat.is_group
          ? chat.is_city_group
            ? chat
                .cityInfo
                ?.name ||
              chat.label ||
              ''
            : chat.label ??
              'group chat'
          : chat
              .derivedTitle?.toLowerCase?.() ||
            'conversation';
      return normalizedTitle
        .toLowerCase()
        .includes(
          search.toLowerCase()
        );
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
    const ringColor =
      getLevelRingColor(
        item.level
      );

    return (
      <Pressable
        style={styles.userCard}
        onPress={() => {
          navigation.navigate(
            'Profile',
            {
              user: item,
              userId:
                item.id,
            }
          );
        }}
      >
        <View
          style={[
            styles.avatarRing,
            {
              borderColor:
                ringColor,
            },
          ]}
        >
          {avatarUri ? (
            <Image
              source={{
                uri: avatarUri,
              }}
              style={
                styles.avatar
              }
            />
          ) : (
            <View
              style={[
                styles.avatar,
                styles.fallbackAvatar,
              ]}
            >
              <Ionicons
                name="person-outline"
                size={20}
                color={T.sub}
              />
            </View>
          )}
        </View>

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
    <View
      style={[
        styles.searchHeader,
        { paddingTop: 4 },
      ]}
    >
      <View style={styles.tabsRow}>
        <Pressable
          onPress={() =>
            setActiveTab(
              'chats'
            )
          }
          style={[
            styles.tabPill,
            activeTab ===
              'chats' &&
              styles.tabPillActive,
          ]}
        >
          <Text
            style={[
              styles.tabText,
              activeTab ===
                'chats' &&
                styles.tabTextActive,
            ]}
          >
            CHATS
          </Text>
        </Pressable>

        <Pressable
          onPress={() =>
            setActiveTab(
              'users'
            )
          }
          style={[
            styles.tabPill,
            activeTab ===
              'users' &&
              styles.tabPillActive,
          ]}
        >
          <Text
            style={[
              styles.tabText,
              activeTab ===
                'users' &&
                styles.tabTextActive,
            ]}
          >
            SEARCH USERS
          </Text>
        </Pressable>

        {/* Create group button */}
        <Pressable
          onPress={openCreateGroup}
          style={styles.createGroupPill}
        >
          <Ionicons name="add" size={18} color={T.text} />
        </Pressable>
      </View>

      {activeTab ===
      'chats' ? (
        <TextInput
          placeholder="Search chats…"
          placeholderTextColor={
            T.mute
          }
          style={
            styles.searchInput
          }
          value={search}
          onChangeText={
            setSearch
          }
          autoCorrect={false}
          autoCapitalize="none"
        />
      ) : (
        <TextInput
          placeholder="Search users by name…"
          placeholderTextColor={
            T.mute
          }
          style={
            styles.searchInput
          }
          value={userQuery}
          onChangeText={
            setUserQuery
          }
          autoCapitalize="words"
          autoCorrect={false}
        />
      )}
    </View>
  );

  /* -------- render -------- */

  return (
    <SafeAreaView
      style={[
        styles.container,
        {
          paddingTop: 6,
          paddingBottom:
            Math.max(
              insets.bottom,
              8
            ),
        },
      ]}
      edges={['left', 'right']}
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
              <Text
                style={
                  styles.emptyText
                }
              >
                {userQuery
                  .trim()
                  .length ===
                0
                  ? 'Start typing a name to search.'
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
                    style={styles.avatarPreview}
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

            {loadingGroupUsers ? (
              <ActivityIndicator
                color={T.accent}
                style={{ marginTop: 10 }}
              />
            ) : null}

            {(groupUsers || []).map((u) => {
              const selected = groupMemberIds.has(u.id);
              const ringColor = getLevelRingColor(u.level);
              return (
                <Pressable
                  key={u.id}
                  onPress={() => toggleMember(u.id)}
                  style={[
                    styles.memberPickRow,
                    selected && { borderColor: T.olive },
                  ]}
                >
                  <View style={[styles.avatarRingSmall, { borderColor: ringColor }]}>
                    {u.avatar_url ? (
                      <Image source={{ uri: u.avatar_url }} style={styles.avatarSmall} />
                    ) : (
                      <View style={[styles.avatarSmall, styles.fallbackAvatar]}>
                        <Ionicons name="person-outline" size={16} color={T.sub} />
                      </View>
                    )}
                  </View>

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

            <View style={styles.selectedCountRow}>
              <Text style={styles.selectedCountText}>
                Selected: {Array.from(groupMemberIds).length}
              </Text>
            </View>

            <TouchableOpacity
              onPress={createGroupChat}
              disabled={creatingGroup}
              activeOpacity={0.85}
              style={[
                styles.createBtn,
                creatingGroup && { opacity: 0.7 },
              ]}
            >
              {creatingGroup ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Ionicons name="chatbubble-ellipses-outline" size={18} color="#000" />
                  <Text style={styles.createBtnText}>Create Group</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const RADIUS = 12;

// keep your styles below...
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: T.bg,
    paddingHorizontal: 16,
  },

  /* Search header / tabs */
  searchHeader: {
    backgroundColor:
      'transparent',
    paddingBottom: 8,
  },
  tabsRow: {
    flexDirection: 'row',
    backgroundColor: T.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.border,
    padding: 4,
    gap: 6,
    marginTop: 8,
    alignItems: 'center',
  },
  tabPill: {
    flex: 1,
    borderRadius: 8,
    paddingVertical: 9,
    alignItems: 'center',
    justifyContent:
      'center',
  },
  tabPillActive: {
    backgroundColor:
      '#121212',
    borderWidth: 1,
    borderColor: T.olive,
  },
  tabText: {
    color: T.sub,
    fontFamily:
      FONT_OBLIVION,
    letterSpacing: 2.5,
    fontSize: 12,
    fontWeight:
      Platform.OS ===
      'android'
        ? ('300' as any)
        : '400',
  },
  tabTextActive: {
    color: T.text,
  },

  createGroupPill: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.olive,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchInput: {
    height: 40,
    backgroundColor: T.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginTop: 8,
    borderWidth: 1,
    borderColor: T.border,
    color: T.text,
    // @ts-ignore
    outlineStyle: 'none',
  },

  /* Chat rows */
  chatCard: {
    flexDirection: 'row',
    justifyContent:
      'space-between',
    alignItems: 'center',
    backgroundColor: T.card,
    padding: 16,
    borderRadius: RADIUS,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: T.border,
  },
  leftRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    paddingRight: 76,
  },

  avatarRing: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent:
      'center',
    marginRight: 10,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor:
      '#111',
  },
  fallbackAvatar: {
    backgroundColor:
      T.card2,
    alignItems: 'center',
    justifyContent:
      'center',
    borderWidth: 1,
    borderColor: T.border,
  },

  chatName: {
    fontSize: 15,
    color: T.text,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  chatMessage: {
    fontSize: 13,
    color: T.sub,
    marginTop: 4,
    maxWidth: 240,
    flexShrink: 1,
  },
  timeText: {
    fontSize: 11,
    color: T.mute,
    marginTop: 6,
    marginBottom: 6,
    textAlign: 'right',
    letterSpacing: 0.2,
  },
  rightMeta: {
    alignItems:
      'flex-end',
    justifyContent:
      'center',
  },
  memberPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor:
      T.card2,
    marginBottom: 6,
  },
  memberPillText: {
    marginLeft: 4,
    fontSize: 12,
    color: T.sub,
  },

  trashHitBox: {
    alignSelf: 'flex-end',
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor:
      T.card2,
  },

  /* Loading overlay */
  loadingOverlay: {
    position: 'absolute',
    zIndex: 10,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor:
      '#000000cc',
    justifyContent:
      'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: T.text,
    fontWeight: '900',
    letterSpacing: 0.4,
  },

  emptyText: {
    color: T.mute,
    textAlign: 'center',
    marginTop: 40,
  },

  // user search items
  userCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: T.card,
    borderWidth: 1,
    borderColor: T.border,
    borderRadius: RADIUS,
    padding: 12,
    marginBottom: 10,
  },
  userName: {
    flex: 1,
    fontSize: 15,
    fontWeight: '800',
    color: T.text,
    letterSpacing: 0.3,
  },

  /* ───────── Modal styles ───────── */
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
    backgroundColor: T.bg,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    borderTopWidth: 1,
    borderColor: T.border,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 12,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    backgroundColor: '#333',
    borderRadius: 999,
    alignSelf: 'center',
    marginVertical: 8,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 6,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: T.text,
    letterSpacing: 0.3,
  },
  modalCloseBtn: {
    padding: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: T.card2,
  },
  modalLabel: {
    marginTop: 12,
    marginBottom: 6,
    fontSize: 12,
    color: T.sub,
    letterSpacing: 1.8,
    fontWeight: '800',
    fontFamily: FONT_OBLIVION,
  },
  modalInput: {
    height: 42,
    backgroundColor: T.card,
    borderRadius: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: T.border,
    color: T.text,
    // @ts-ignore
    outlineStyle: 'none',
  },

  avatarPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  avatarPickBtn: {
    flex: 1,
    height: 42,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: T.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  avatarPickBtnText: {
    color: T.text,
    fontWeight: '800',
    letterSpacing: 0.2,
  },
  avatarPreviewRing: {
    width: 52,
    height: 52,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: T.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.card2,
  },
  avatarPreview: {
    width: 46,
    height: 46,
    borderRadius: 23,
  },

  memberPickRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: T.card,
  },
  avatarRingSmall: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  avatarSmall: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#111',
    alignItems: 'center',
    justifyContent: 'center',
  },
  memberPickName: {
    flex: 1,
    color: T.text,
    fontWeight: '800',
  },
  checkCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: T.border,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectedCountRow: {
    marginTop: 10,
    alignItems: 'flex-end',
  },
  selectedCountText: {
    color: T.mute,
    fontSize: 12,
  },

  createBtn: {
    marginTop: 14,
    height: 46,
    borderRadius: 12,
    backgroundColor: T.olive,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderColor: T.olive,
  },
  createBtnText: {
    color: '#000',
    fontWeight: '900',
    letterSpacing: 0.3,
  },
});
