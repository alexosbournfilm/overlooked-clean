import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from '../lib/supabase';

export type AppNotification = {
  id: string;
  user_id?: string;
  title: string;
  body?: string | null;
  notification_type?: string | null;
  data?: Record<string, any> | null;
  created_at?: string | null;
  read_at?: string | null;
};

type Ctx = {
  unreadCount: number;
  unreadNotifications: AppNotification[];
  settingsVisibleNotifications: AppNotification[];
  loading: boolean;
  refreshUnreadNotifications: () => Promise<AppNotification[]>;
  captureUnreadForSettings: () => Promise<AppNotification[]>;
  clearSettingsVisibleNotifications: () => void;
  markMessageNotificationsRead: (conversationId?: string | null) => Promise<void>;
};

const EMPTY_CTX: Ctx = {
  unreadCount: 0,
  unreadNotifications: [],
  settingsVisibleNotifications: [],
  loading: false,
  refreshUnreadNotifications: async () => [],
  captureUnreadForSettings: async () => [],
  clearSettingsVisibleNotifications: () => {},
  markMessageNotificationsRead: async () => {},
};

const InAppNotificationsContext = createContext<Ctx>(EMPTY_CTX);

function normalizeNotification(row: any): AppNotification {
  return {
    id: String(row.id),
    user_id: row.user_id,
    title: row.title || 'Notification',
    body: row.body ?? null,
    notification_type: row.notification_type ?? null,
    data: row.data && typeof row.data === 'object' ? row.data : {},
    created_at: row.created_at ?? null,
    read_at: row.read_at ?? null,
  };
}

async function setPhoneBadgeCount(count: number) {
  if (Platform.OS === 'web') return;

  try {
    await Notifications.setBadgeCountAsync(Math.max(0, count));
  } catch {}
}

export function InAppNotificationsProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadNotifications, setUnreadNotifications] = useState<AppNotification[]>([]);
  const [settingsVisibleNotifications, setSettingsVisibleNotifications] = useState<AppNotification[]>([]);
  const [loading, setLoading] = useState(false);

  const requestIdRef = useRef(0);
  const userIdRef = useRef<string | null>(null);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    let mounted = true;

    const loadSessionUser = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (mounted) setUserId(session?.user?.id ?? null);
    };

    void loadSessionUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (mounted) setUserId(session?.user?.id ?? null);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const refreshUnreadNotifications = useCallback(async () => {
    const uid = userIdRef.current;

    if (!uid) {
      setUnreadCount(0);
      setUnreadNotifications([]);
      await setPhoneBadgeCount(0);
      return [];
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);

    try {
      const { data, error, count } = await supabase
        .from('app_notifications')
        .select('id, user_id, title, body, notification_type, data, created_at, read_at', {
          count: 'exact',
        })
        .eq('user_id', uid)
        .is('read_at', null)
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) throw error;

      const rows = (data || []).map(normalizeNotification);

      if (requestId === requestIdRef.current) {
        setUnreadCount(typeof count === 'number' ? count : rows.length);
        setUnreadNotifications(rows);
      }

      return rows;
    } catch (e: any) {
      console.log('In-app notifications unavailable:', e?.message || e);

      if (requestId === requestIdRef.current) {
        setUnreadCount(0);
        setUnreadNotifications([]);
      }

      return [];
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, []);

  const markAllUnreadAsRead = useCallback(async () => {
    const uid = userIdRef.current;
    if (!uid) return;

    try {
      const { error } = await supabase
        .from('app_notifications')
        .update({ read_at: new Date().toISOString() })
        .eq('user_id', uid)
        .is('read_at', null);

      if (error) throw error;
    } catch (e: any) {
      console.log('Mark notifications read unavailable:', e?.message || e);
    }

    setUnreadCount(0);
    setUnreadNotifications([]);
    await setPhoneBadgeCount(0);
  }, []);

  const captureUnreadForSettings = useCallback(async () => {
    const rows = await refreshUnreadNotifications();
    setSettingsVisibleNotifications(rows);

    if (rows.length > 0 || unreadCount > 0) {
      await markAllUnreadAsRead();
    }

    return rows;
  }, [markAllUnreadAsRead, refreshUnreadNotifications, unreadCount]);

  const clearSettingsVisibleNotifications = useCallback(() => {
    setSettingsVisibleNotifications([]);
  }, []);

  const markMessageNotificationsRead = useCallback(
    async (conversationId?: string | null) => {
      const uid = userIdRef.current;
      if (!uid || !conversationId) return;

      try {
        const { error } = await supabase.rpc('mark_chat_notifications_read', {
          target_conversation_id: String(conversationId),
        });

        if (error) throw error;
      } catch (rpcError: any) {
        try {
          const { error } = await supabase
            .from('app_notifications')
            .update({ read_at: new Date().toISOString() })
            .eq('user_id', uid)
            .eq('notification_type', 'message')
            .is('read_at', null)
            .filter('data->params->>conversationId', 'eq', String(conversationId));

          if (error) throw error;
        } catch (fallbackError: any) {
          console.log(
            'Mark chat notifications read unavailable:',
            fallbackError?.message || rpcError?.message || fallbackError || rpcError
          );
          return;
        }
      }

      setUnreadNotifications((prev) => {
        const next = prev.filter((notice) => {
          const noticeConversationId = notice.data?.params?.conversationId;
          return String(noticeConversationId || '') !== String(conversationId);
        });
        setUnreadCount(next.length);
        void setPhoneBadgeCount(next.length);
        return next;
      });

      setSettingsVisibleNotifications((prev) =>
        prev.filter((notice) => {
          const noticeConversationId = notice.data?.params?.conversationId;
          return String(noticeConversationId || '') !== String(conversationId);
        })
      );

      void refreshUnreadNotifications();
    },
    [refreshUnreadNotifications]
  );

  useEffect(() => {
    void setPhoneBadgeCount(unreadCount);
  }, [unreadCount]);

  useEffect(() => {
    if (!userId) {
      setUnreadCount(0);
      setUnreadNotifications([]);
      setSettingsVisibleNotifications([]);
      void setPhoneBadgeCount(0);
      return;
    }

    void refreshUnreadNotifications();

    const interval = setInterval(() => {
      void refreshUnreadNotifications();
    }, 15000);

    return () => clearInterval(interval);
  }, [refreshUnreadNotifications, userId]);

  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`app-notifications-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'app_notifications',
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void refreshUnreadNotifications();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [refreshUnreadNotifications, userId]);

  useEffect(() => {
    if (Platform.OS === 'web') return;

    const appStateSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void refreshUnreadNotifications();
      }
    });

    const notificationSub = Notifications.addNotificationReceivedListener(() => {
      setTimeout(() => {
        void refreshUnreadNotifications();
      }, 450);
    });

    return () => {
      appStateSub.remove();
      notificationSub.remove();
    };
  }, [refreshUnreadNotifications]);

  const value = useMemo(
    () => ({
      unreadCount,
      unreadNotifications,
      settingsVisibleNotifications,
      loading,
      refreshUnreadNotifications,
      captureUnreadForSettings,
      clearSettingsVisibleNotifications,
      markMessageNotificationsRead,
    }),
    [
      captureUnreadForSettings,
      clearSettingsVisibleNotifications,
      loading,
      markMessageNotificationsRead,
      refreshUnreadNotifications,
      settingsVisibleNotifications,
      unreadCount,
      unreadNotifications,
    ]
  );

  return (
    <InAppNotificationsContext.Provider value={value}>
      {children}
    </InAppNotificationsContext.Provider>
  );
}

export function useInAppNotifications() {
  return useContext(InAppNotificationsContext);
}
