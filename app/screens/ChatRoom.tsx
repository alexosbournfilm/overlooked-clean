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
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRoute, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../theme/colors';
import { supabase } from '../lib/supabase';

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
};

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string; // text OR "image:<url>"
  sent_at: string;
  delivered?: boolean;
  message_type?: 'text' | 'system' | 'media';
  sender?: { id: string; full_name: string } | null; // joined single row (aliased)
};

type PeerUser = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
};

type Member = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
};

// Safe numeric sizes
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const BUBBLE_MAX_WIDTH = Math.min(420, Math.floor(SCREEN_W * 0.75));

export default function ChatRoom() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();

  const {
    conversation: routeConversation,
    conversationId: routeConversationId,
    peerUser: routePeerUser,
  } = route.params || {};

  const [conversation, setConversation] = useState<Conversation | null>(routeConversation ?? null);
  const [peerUser, setPeerUser] = useState<PeerUser | null>(routePeerUser ?? null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [typingUser, setTypingUser] = useState<string | null>(null);
  const [sendingImage, setSendingImage] = useState(false);

  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [imageModalVisible, setImageModalVisible] = useState(false);

  const [userLookup, setUserLookup] = useState<Record<string, { id: string; full_name: string }>>(
    {}
  );

  // City meta for header (flag + city name)
  const [cityMeta, setCityMeta] = useState<{ name: string | null; flagUri: string | null }>({
    name: null,
    flagUri: null,
  });

  // Members modal state
  const [membersVisible, setMembersVisible] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [membersRefreshing, setMembersRefreshing] = useState(false);

  const flatListRef = useRef<FlatList>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const messageChannelRef = useRef<any>(null);
  const typingChannelRef = useRef<any>(null);
  const convoChannelRef = useRef<any>(null);

  // Helpers
  const getFlagUri = (countryCode?: string | null) =>
    countryCode ? `https://flagcdn.com/w80/${String(countryCode).toLowerCase()}.png` : null;

  // Ensure correct conversation when params change
  useEffect(() => {
    const nextId: string | null =
      (routeConversationId as string | undefined) ??
      (routeConversation?.id as string | undefined) ??
      null;

    if (!nextId) return;

    if (conversation?.id === nextId) {
      if (routePeerUser) setPeerUser(routePeerUser);
      return;
    }

    let cancelled = false;

    setMessages([]);
    setPeerUser(routePeerUser ?? null);

    (async () => {
      if (routeConversation && routeConversation.id === nextId) {
        if (!cancelled) setConversation(routeConversation as Conversation);
        return;
      }

      const { data, error } = await supabase
        .from('conversations')
        .select(
          'id,label,is_group,is_city_group,city_id,participant_ids,last_message_content,last_message_sent_at,created_at'
        )
        .eq('id', nextId)
        .single();

      if (!cancelled) {
        if (error || !data) {
          Alert.alert('Chat not found', error?.message ?? 'Unknown chat.');
          return;
        }
        setConversation(data as Conversation);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeConversationId, routeConversation, routePeerUser]);

  // Resolve peer user for 1–1 chats
  useEffect(() => {
    (async () => {
      if (!conversation || conversation.is_group) return;
      if (peerUser?.id) return;

      const { data: meData } = await supabase.auth.getUser();
      const meId = meData?.user?.id;
      if (!meId) return;

      const otherId = (conversation.participant_ids || []).find((pid) => pid !== meId);
      if (!otherId) return;

      const { data: userRow, error } = await supabase
        .from('users')
        .select('id, full_name, avatar_url')
        .eq('id', otherId)
        .single();
      if (!error && userRow) {
        setPeerUser({
          id: userRow.id,
          full_name: userRow.full_name,
          avatar_url: userRow.avatar_url ?? null,
        });
      }
    })();
  }, [conversation, peerUser?.id]);

  // Fetch city meta for city groups (name + flag)
  useEffect(() => {
    (async () => {
      if (!conversation?.is_group || !conversation.is_city_group || !conversation.city_id) {
        setCityMeta({ name: null, flagUri: null });
        return;
      }
      const { data: city } = await supabase
        .from('cities')
        .select('name, country_code')
        .eq('id', conversation.city_id)
        .single();

      const name = city?.name ?? null;
      const flagUri = getFlagUri(city?.country_code ?? null);
      setCityMeta({ name, flagUri });
    })();
  }, [conversation?.id, conversation?.is_group, conversation?.is_city_group, conversation?.city_id]);

  // Back behavior
  const goBackToChats = () => {
    if (navigation.canGoBack()) {
      navigation.goBack();
      return;
    }
    navigation.navigate('Chats' as any);
  };

  // NEW: open peer profile from header
  const openPeerProfile = async () => {
    try {
      if (peerUser?.id) {
        navigation.navigate('Profile', {
          user: { id: peerUser.id, full_name: peerUser.full_name },
        });
        return;
      }
      // Fallback: derive other participant
      const { data: meData } = await supabase.auth.getUser();
      const meId = meData?.user?.id;
      const otherId = conversation?.participant_ids?.find((pid) => pid !== meId);
      if (otherId) {
        const { data: u } = await supabase
          .from('users')
          .select('id, full_name')
          .eq('id', otherId)
          .single();
        if (u) {
          navigation.navigate('Profile', { user: { id: u.id, full_name: u.full_name } });
        }
      }
    } catch {
      // no-op
    }
  };

  // ===== Members: fetch + modal =====
  const openMembers = async () => {
    if (!conversation?.is_group || !conversation?.participant_ids?.length) return;
    setMembersVisible(true);
    setMembersLoading(true);
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, full_name, avatar_url')
        .in('id', conversation.participant_ids)
        .order('full_name', { ascending: true });

      if (error) throw error;
      setMembers((data || []) as Member[]);
    } catch (e: any) {
      Alert.alert('Unable to load members', e?.message || 'Please try again.');
    } finally {
      setMembersLoading(false);
    }
  };

  const refreshMembers = async () => {
    if (!conversation?.participant_ids?.length) return;
    setMembersRefreshing(true);
    try {
      const { data } = await supabase
        .from('users')
        .select('id, full_name, avatar_url')
        .in('id', conversation.participant_ids)
        .order('full_name', { ascending: true });
      setMembers((data || []) as Member[]);
    } finally {
      setMembersRefreshing(false);
    }
  };

  // Header
  useLayoutEffect(() => {
    if (!conversation) return;

    const headerLeft = () => (
      <TouchableOpacity
        onPress={goBackToChats}
        style={{ paddingHorizontal: 8, paddingVertical: 4 }}
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={24} color={COLORS.textPrimary} />
      </TouchableOpacity>
    );

    if (!conversation.is_group) {
      const name = peerUser?.full_name || 'Conversation';
      const avatarUri = peerUser?.avatar_url || 'https://i.pravatar.cc/100';

      navigation.setOptions({
        headerLeft,
        headerTitleAlign: 'center',
        headerTitle: () => (
          <TouchableOpacity
            onPress={openPeerProfile}
            activeOpacity={0.8}
            style={styles.headerTitleRow}
            hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
          >
            <Image source={{ uri: avatarUri }} style={styles.headerAvatar} />
            <Text style={styles.headerTitleText} numberOfLines={1}>
              {name}
            </Text>
          </TouchableOpacity>
        ),
      });
    } else {
      const memberCount = Array.isArray(conversation.participant_ids)
        ? conversation.participant_ids.length
        : 0;

      const TitleRow = () => (
        <TouchableOpacity
          onPress={openMembers}
          activeOpacity={0.85}
          style={styles.headerTitleRow}
          hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
        >
          {conversation.is_city_group && cityMeta.flagUri ? (
            <Image source={{ uri: cityMeta.flagUri }} style={styles.headerAvatar} />
          ) : null}
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <Text style={styles.headerTitleText} numberOfLines={1}>
              {conversation.is_city_group ? cityMeta.name || 'City Group' : conversation.label || 'Group Chat'}
            </Text>
            <Text style={styles.memberCountText}>  •  {memberCount}</Text>
          </View>
        </TouchableOpacity>
      );

      const headerRight = () => (
        <TouchableOpacity
          onPress={openMembers}
          style={{ paddingHorizontal: 8, paddingVertical: 4 }}
          accessibilityLabel="View members"
        >
          <Ionicons name="people-outline" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
      );

      navigation.setOptions({
        headerLeft,
        headerRight,
        headerTitleAlign: 'center',
        headerTitle: () => <TitleRow />,
      });
    }
  }, [navigation, conversation, peerUser, cityMeta]);

  // Load messages + realtime
  useEffect(() => {
    if (!conversation?.id) return;
    fetchUserAndMessages();
    setupRealtime(conversation.id);

    return () => {
      if (messageChannelRef.current) supabase.removeChannel(messageChannelRef.current);
      if (typingChannelRef.current) supabase.removeChannel(typingChannelRef.current);
      if (convoChannelRef.current) supabase.removeChannel(convoChannelRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id]);

  const fetchUserAndMessages = async () => {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return;
    setUserId(userData.user.id);

    const { data, error } = await supabase
      .from('messages')
      .select(
        'id, conversation_id, sender_id, content, message_type, sent_at, delivered, sender:users!messages_sender_id_fkey(id, full_name)'
      )
      .eq('conversation_id', conversation!.id)
      .order('sent_at', { ascending: true });

    if (!error && data) {
      // Normalize possible array join to a single object
      const normalized: Message[] = (data as any[]).map((row: any) => ({
        ...row,
        sender: Array.isArray(row.sender) ? (row.sender[0] ?? null) : (row.sender ?? null),
      }));

      setMessages(normalized);

      const fromMsgs: Record<string, { id: string; full_name: string }> = {};
      for (const m of normalized) {
        if (m.sender?.id) {
          fromMsgs[m.sender.id] = { id: m.sender.id, full_name: m.sender.full_name };
        }
      }

      if (conversation?.participant_ids?.length) {
        const { data: participants } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', conversation.participant_ids);
        if (participants) {
          for (const u of participants) {
            fromMsgs[u.id] = { id: u.id, full_name: u.full_name };
          }
        }
      }

      setUserLookup(fromMsgs);
      setTimeout(() => scrollToBottom(), 100);
    }
  };

  const setupRealtime = (convId: string) => {
    const messageChannel = supabase
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
          const newMessage = payload.new as Message;
          setMessages((prev) => [...prev, newMessage]);

          if (newMessage.sender_id && !userLookup[newMessage.sender_id]) {
            const { data: u } = await supabase
              .from('users')
              .select('id, full_name')
              .eq('id', newMessage.sender_id)
              .single();
            if (u) {
              setUserLookup((m) => ({ ...m, [u.id]: { id: u.id, full_name: u.full_name } }));
            }
          }

          scrollToBottom();
        }
      )
      .subscribe();
    messageChannelRef.current = messageChannel;

    const typingChannel = supabase
      .channel(`typing-${convId}`)
      .on('broadcast', { event: 'typing' }, (payload) => {
        const sender = payload.payload?.sender as string | null;
        if (sender && sender !== userId) {
          setTypingUser(sender);
          if (typingTimeoutRef.current) {
            clearTimeout(typingTimeoutRef.current);
          }
          typingTimeoutRef.current = setTimeout(() => {
            setTypingUser(null);
          }, 2000);
        }
      })
      .subscribe();
    typingChannelRef.current = typingChannel;

    // Keep participant_ids live for member count
    const convoChannel = supabase
      .channel(`convo-${convId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'conversations', filter: `id=eq.${convId}` },
        (payload) => {
          const updated = payload.new as Conversation;
          setConversation((prev) => (prev ? { ...prev, ...updated } : updated));
        }
      )
      .subscribe();
    convoChannelRef.current = convoChannel;
  };

  const scrollToBottom = () => {
    flatListRef.current?.scrollToEnd({ animated: true });
  };

  const updateConversationLastMessage = async (convId: string, content: string) => {
    await supabase
      .from('conversations')
      .update({
        last_message_content: content,
        last_message_sent_at: new Date().toISOString(),
      })
      .eq('id', convId);
  };

  const sendMessage = async () => {
    if (!input.trim() || !userId || !conversation?.id) return;

    const text = input.trim();
    setInput('');

    const { error } = await supabase.from('messages').insert({
      conversation_id: conversation.id,
      sender_id: userId,
      content: text,
      delivered: true,
      message_type: 'text',
    });

    if (error) {
      Alert.alert('Failed to send', error.message);
      return;
    }

    updateConversationLastMessage(conversation.id, text);
  };

  // Image upload helpers
  const uploadImageAndGetUrl = async (uri: string, mimeType?: string | null) => {
    const ext = (mimeType?.split('/')[1] || 'jpg').split(';')[0];
    const filePath = `${conversation!.id}/${userId}/${Date.now()}.${ext}`;

    const res = await fetch(uri);
    const blob = await res.blob();

    const { error: uploadError } = await supabase.storage
      .from('chat-uploads')
      .upload(filePath, blob, {
        upsert: true,
        contentType: mimeType || 'image/jpeg',
      });

    if (uploadError) throw uploadError;

    const { data: pub } = supabase.storage.from('chat-uploads').getPublicUrl(filePath);
    return pub.publicUrl;
  };

  const sendFile = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
      });
      if (!result.assets || result.assets.length === 0) return;
      if (!userId || !conversation?.id) return;

      const asset = result.assets[0];
      const isImage = (asset.mimeType || '').startsWith('image/');

      if (isImage) {
        setSendingImage(true);
        const publicUrl = await uploadImageAndGetUrl(asset.uri, asset.mimeType);
        const content = `image:${publicUrl}`;

        const { error } = await supabase.from('messages').insert({
          conversation_id: conversation.id,
          sender_id: userId,
          content,
          delivered: true,
          message_type: 'media',
        });

        setSendingImage(false);

        if (error) {
          Alert.alert('Image send failed', error.message);
          return;
        }
        updateConversationLastMessage(conversation.id, '[Photo]');
      } else {
        const fileName = asset.name || 'file';
        const content = `📎 File: ${fileName}`;
        const { error } = await supabase.from('messages').insert({
          conversation_id: conversation.id,
          sender_id: userId,
          content,
          delivered: true,
          message_type: 'text',
        });
        if (error) {
          Alert.alert('File send failed', error.message);
          return;
        }
        updateConversationLastMessage(conversation.id, content);
      }
    } catch (e: any) {
      setSendingImage(false);
      Alert.alert('Attachment error', e?.message || 'Unable to send attachment.');
    }
  };

  const handleTyping = (text: string) => {
    setInput(text);
    if (text.trim() && conversation?.id) {
      supabase.channel(`typing-${conversation.id}`).send({
        type: 'broadcast',
        event: 'typing',
        payload: { sender: userId },
      });
    }
  };

  const isImageMessage = (content: string) => content.startsWith('image:');
  const extractImageUrl = (content: string) => content.replace(/^image:/, '');

  const openImage = (url: string) => {
    setImagePreviewUrl(url);
    setImageModalVisible(true);
  };

  const goToSenderProfile = (senderId: string) => {
    const display = userLookup[senderId];
    if (!display) return;
    navigation.navigate('Profile', { user: { id: display.id, full_name: display.full_name } });
  };

  const renderSystemMessage = (text: string) => (
    <View style={styles.systemMsgWrap}>
      <Text style={styles.systemMsgText}>{text}</Text>
    </View>
  );

  const renderItem = ({ item }: { item: Message }) => {
    // System messages
    if (item.message_type === 'system') {
      return renderSystemMessage(item.content);
    }

    const isOwn = item.sender_id === userId;
    const showName = conversation?.is_group && !isOwn;

    const imageMsg = isImageMessage(item.content);
    const imageUrl = imageMsg ? extractImageUrl(item.content) : null;

    const senderDisplay = item.sender?.full_name || userLookup[item.sender_id]?.full_name;

    const webTextFix =
      Platform.OS === 'web'
        ? ({ wordBreak: 'break-word', whiteSpace: 'pre-wrap' } as any)
        : null;

    return (
      <View style={[styles.messageWrapper, isOwn ? styles.right : styles.left]}>
        {!isOwn && showName && senderDisplay && (
          <TouchableOpacity onPress={() => goToSenderProfile(item.sender_id)}>
            <Text style={styles.senderName}>{senderDisplay}</Text>
          </TouchableOpacity>
        )}

        {imageMsg ? (
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => openImage(imageUrl!)}
            style={[styles.imageBubble, isOwn ? styles.imageOutgoing : styles.imageIncoming]}
          >
            <Image source={{ uri: imageUrl! }} style={styles.chatImage} resizeMode="cover" />
            {isOwn && item.delivered && <Text style={styles.deliveredOnImage}>✓</Text>}
          </TouchableOpacity>
        ) : (
          <View style={[styles.messageBubble, isOwn ? styles.outgoing : styles.incoming]}>
            <Text style={[styles.messageText, isOwn && { color: '#fff' }, webTextFix as any]}>
              {item.content}
            </Text>
            {isOwn && item.delivered && <Text style={styles.delivered}>✓</Text>}
          </View>
        )}
      </View>
    );
  };

  if (!conversation?.id) {
    return (
      <View style={styles.centered}>
        <Text style={{ color: 'red', fontSize: 16 }}>Chat not found.</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderItem}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ padding: 16 }}
        onContentSizeChange={scrollToBottom}
      />

      {typingUser && <Text style={styles.typingText}>Someone is typing...</Text>}

      <View style={styles.inputContainer}>
        <TouchableOpacity onPress={sendFile} style={styles.icon} disabled={sendingImage}>
          {sendingImage ? (
            <ActivityIndicator />
          ) : (
            <Ionicons name="attach" size={24} color={COLORS.textPrimary} />
          )}
        </TouchableOpacity>
        <TextInput
          value={input}
          onChangeText={handleTyping}
          placeholder="Type a message..."
          style={styles.input}
        />
        <TouchableOpacity onPress={sendMessage} style={styles.sendButton}>
          <Ionicons name="send" size={20} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Full-screen image preview */}
      <Modal
        visible={imageModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImageModalVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.modalBackdrop} onPress={() => setImageModalVisible(false)}>
            {imagePreviewUrl ? (
              <Image
                source={{ uri: imagePreviewUrl }}
                style={styles.previewImage}
                resizeMode="contain"
              />
            ) : null}
          </Pressable>
          <View style={styles.modalCloseBar}>
            <TouchableOpacity onPress={() => setImageModalVisible(false)} style={styles.closeBtn}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Members sheet/modal */}
      <Modal
        visible={membersVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setMembersVisible(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setMembersVisible(false)} />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <View style={styles.sheetHeaderRow}>
            <Text style={styles.sheetTitle}>
              {conversation.is_city_group
                ? cityMeta.name || 'City Members'
                : conversation.label || 'Group Members'}
            </Text>
            <Text style={styles.sheetCount}>
              {Array.isArray(conversation.participant_ids) ? conversation.participant_ids.length : 0}{' '}
              members
            </Text>
          </View>

          {membersLoading ? (
            <View style={styles.membersLoadingWrap}>
              <ActivityIndicator />
              <Text style={styles.loadingText}>Loading members…</Text>
            </View>
          ) : (
            <FlatList
              data={members}
              keyExtractor={(m) => m.id}
              refreshControl={
                <RefreshControl
                  refreshing={membersRefreshing}
                  onRefresh={refreshMembers}
                  tintColor={COLORS.textSecondary}
                />
              }
              ItemSeparatorComponent={() => <View style={styles.separator} />}
              contentContainerStyle={{ paddingBottom: 18 }}
              renderItem={({ item }) => (
                <TouchableOpacity
                  onPress={() => {
                    setMembersVisible(false);
                    navigation.navigate('Profile', {
                      user: { id: item.id, full_name: item.full_name },
                    });
                  }}
                  style={styles.memberRow}
                  activeOpacity={0.85}
                >
                  <Image
                    source={{
                      uri: item.avatar_url || 'https://i.pravatar.cc/100',
                    }}
                    style={styles.memberAvatar}
                  />
                  <Text style={styles.memberName} numberOfLines={1}>
                    {item.full_name}
                  </Text>
                  <Ionicons
                    name="chevron-forward"
                    size={18}
                    color={COLORS.textSecondary}
                    style={{ marginLeft: 'auto' }}
                  />
                </TouchableOpacity>
              )}
              ListEmptyComponent={
                <View style={styles.membersEmpty}>
                  <Text style={styles.membersEmptyText}>No members found.</Text>
                </View>
              }
            />
          )}
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },

  // Header
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', maxWidth: 260 },
  headerAvatar: { width: 28, height: 28, borderRadius: 14, marginRight: 8 },
  headerTitleText: { fontSize: 16, fontWeight: '700', color: COLORS.textPrimary },
  memberCountText: { fontSize: 14, fontWeight: '600', color: COLORS.textSecondary },

  // System message chip
  systemMsgWrap: {
    alignSelf: 'center',
    backgroundColor: '#EFEFEF',
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 12,
    marginVertical: 8,
  },
  systemMsgText: { fontSize: 12, color: COLORS.textSecondary },

  messageWrapper: { marginBottom: 10 },
  senderName: { fontSize: 12, color: COLORS.textSecondary, marginLeft: 8, marginBottom: 2 },

  // Bubbles
  messageBubble: { maxWidth: BUBBLE_MAX_WIDTH, padding: 12, borderRadius: 18 },
  incoming: { backgroundColor: '#eee', alignSelf: 'flex-start' },
  outgoing: { backgroundColor: COLORS.primary, alignSelf: 'flex-end' },

  // Image bubbles
  imageBubble: { maxWidth: BUBBLE_MAX_WIDTH, borderRadius: 18, overflow: 'hidden' },
  imageIncoming: { alignSelf: 'flex-start', backgroundColor: '#eee' },
  imageOutgoing: { alignSelf: 'flex-end', backgroundColor: COLORS.primary },
  chatImage: { width: 240, height: 240 },

  right: { alignSelf: 'flex-end', alignItems: 'flex-end' },
  left: { alignSelf: 'flex-start', alignItems: 'flex-start' },

  messageText: { color: COLORS.textPrimary, flexShrink: 1 },
  delivered: { fontSize: 10, color: '#fff', marginTop: 4, textAlign: 'right' },
  deliveredOnImage: { position: 'absolute', right: 8, bottom: 6, fontSize: 12, color: '#fff', opacity: 0.9 },

  typingText: { fontSize: 12, color: COLORS.textSecondary, paddingHorizontal: 16, paddingBottom: 4 },
  inputContainer: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderTopWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.background,
  },
  input: {
    flex: 1,
    backgroundColor: '#f1f1f1',
    borderRadius: 25,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 12 : 8,
    marginHorizontal: 8,
    fontSize: 16,
  },
  sendButton: { backgroundColor: COLORS.primary, padding: 10, borderRadius: 20 },
  icon: { padding: 5 },

  // Preview modal
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  previewImage: { width: Math.floor(SCREEN_W * 0.92), height: Math.floor(SCREEN_H * 0.7) },
  modalCloseBar: { position: 'absolute', top: 40, right: 16 },
  closeBtn: { padding: 8 },

  // Members sheet
  sheetBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: Math.floor(SCREEN_H * 0.65),
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingBottom: 12,
    paddingHorizontal: 12,
    paddingTop: 6,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 10,
  },
  sheetHandle: {
    width: 44,
    height: 5,
    backgroundColor: '#DDD',
    borderRadius: 999,
    alignSelf: 'center',
    marginVertical: 8,
  },
  sheetHeaderRow: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  sheetTitle: { fontSize: 18, fontWeight: '700', color: COLORS.textPrimary },
  sheetCount: { marginTop: 2, fontSize: 12, color: COLORS.textSecondary },

  memberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
  },
  memberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    marginRight: 10,
    backgroundColor: '#EEE',
  },
  memberName: { fontSize: 15, color: COLORS.textPrimary, maxWidth: SCREEN_W - 130 },
  separator: {
    height: 1,
    backgroundColor: COLORS.border,
    marginLeft: 52,
    opacity: 0.6,
  },
  membersLoadingWrap: {
    paddingVertical: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: { marginTop: 8, color: COLORS.textSecondary },
  membersEmpty: { paddingVertical: 28, alignItems: 'center' },
  membersEmptyText: { color: COLORS.textSecondary },
});
