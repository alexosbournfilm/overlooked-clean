import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  View,
  Text,
  Pressable,
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Linking,
  Image,
  ScrollView,
  Easing,
} from 'react-native';
import { useNavigation, CommonActions } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { useSettingsModal } from '../app/context/SettingsModalContext';
import { useAppTheme } from '../app/context/ThemeContext';
import { useAppLanguage } from '../app/context/LanguageContext';
import { AppLanguageCode } from '../app/i18n/languages';
import { AppNotification, useInAppNotifications } from '../app/context/InAppNotificationsContext';
import { supabase, FUNCTIONS_URL } from '../app/lib/supabase';
import { UpgradeModal } from './UpgradeModal';
import { unblockUser } from '../app/utils/unblockUser';
import { resetToSignIn as resetRootToSignIn } from '../app/navigation/navigationRef';

/* ------------------------------- palette -------------------------------- */
const DARK_BG = '#050505';
const DARK_CARD = '#0D0D0F';
const DARK_ELEVATED = '#111114';
const TEXT_IVORY = '#F4EFE6';
const TEXT_MUTED = '#A59D90';
const DIVIDER = 'rgba(255,255,255,0.10)';
const GOLD = '#C6A664';

/* ------------------------------- fonts ---------------------------------- */
const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

type DeleteAccountResponse = {
  ok?: boolean;
  error?: string;
  details?: string;
  message?: string;
  action?: 'cancel_external_first' | string;
  provider?: 'revenuecat' | 'stripe' | string;
  management_url?: string | null;
  store?: string | null;
  period_end?: string | null;
};

type BlockedUserRow = {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
  main_role_id?: number | null;
  role_name?: string | null;
};

type ModerationReportRow = {
  id: string;
  reporter_id?: string | null;
  reported_user_id?: string | null;
  content_type?: string | null;
  content_id?: string | null;
  reason?: string | null;
  details?: string | null;
  status?: string | null;
  created_at?: string | null;
  developer_notified?: boolean | null;
};

type ReportUserSummary = {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
};

/* ---------- helpers (unchanged) ---------- */
async function confirm(opts: {
  title: string;
  message: string;
  okText?: string;
  cancelText?: string;
  destructive?: boolean;
}): Promise<boolean> {
  const { title, message, okText = 'OK', cancelText = 'Cancel', destructive } =
    opts;

  if (Platform.OS === 'web') {
    return window.confirm(`${title}\n\n${message}`);
  }

  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: cancelText, style: 'cancel', onPress: () => resolve(false) },
        {
          text: okText,
          style: destructive ? 'destructive' : 'default',
          onPress: () => resolve(true),
        },
      ],
      { cancelable: true }
    );
  });
}

function clearAuthRoutingFlags() {
  const G = globalThis as any;
  G.__OVERLOOKED_EMAIL_CONFIRM__ = false;
  G.__OVERLOOKED_RECOVERY__ = false;
  G.__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
  G.__OVERLOOKED_PASSWORD_RESET_DONE__ = false;
  G.__OVERLOOKED_MANUAL_SIGN_IN__ = false;
  G.__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;
  G.__OVERLOOKED_PROFILE_JUST_COMPLETED__ = false;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.sessionStorage.removeItem('overlooked.allowCreateProfile');
    window.sessionStorage.removeItem('overlooked.manualSignIn');
    window.sessionStorage.removeItem('overlooked.createProfileAllowed');
  }
}

function setSigningOutFlag(active: boolean) {
  const G = globalThis as any;
  G.__OVERLOOKED_SIGNING_OUT__ = active;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    if (active) {
      window.sessionStorage.setItem('overlooked.signingOut', 'true');
    } else {
      window.sessionStorage.removeItem('overlooked.signingOut');
    }
  }
}

const withTimeout = <T,>(p: Promise<T>, ms = 15000) =>
  new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Request timed out')), ms);
    p.then((v) => {
      clearTimeout(t);
      resolve(v);
    }).catch((e) => {
      clearTimeout(t);
      reject(e);
    });
  });

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getAccessToken() {
  const { data: s1 } = await supabase.auth.getSession();
  if (s1.session?.access_token) return s1.session.access_token;

  try {
    await supabase.auth.refreshSession();
  } catch {}

  const { data: s2 } = await supabase.auth.getSession();
  return s2.session?.access_token ?? null;
}

async function callFunction(
  fnName: 'delete-account'
): Promise<{ status: number; text: string; data?: any }> {
  const token = await getAccessToken();
  if (!token) {
    return { status: 401, text: 'No active session (not signed in)' };
  }

  const url = `${FUNCTIONS_URL}/${fnName}`;
  const res = await withTimeout(
    fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    })
  );

  const text = await res.text();
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {}

  return { status: res.status, text, data };
}

async function openExternalManagementUrl(url?: string | null) {
  if (!url) return false;

  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) return false;

    await Linking.openURL(url);
    return true;
  } catch (e) {
    console.log('SettingsModal openExternalManagementUrl error', e);
    return false;
  }
}

function formatNotificationTime(value?: string | null) {
  if (!value) return '';

  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return '';

  const diffMs = Date.now() - then;
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(value).toLocaleDateString();
}

/* ---------------------- DARK THEME SECTION BUTTON ---------------------- */
function SectionButton(props: {
  title: string;
  subtitle?: string;
  onPress?: () => void;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
}) {
  const { title, subtitle, onPress, danger, loading, disabled } = props;
  const { colors } = useAppTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={loading || disabled}
      style={({ pressed }) => [
        styles.sectionButton,
        {
          backgroundColor: colors.backgroundAlt,
          borderColor: colors.border,
        },
        pressed && !disabled && { opacity: 0.7 },
        disabled && { opacity: 0.5 },
      ]}
    >
      <Text
        style={[
          styles.sectionTitle,
          { color: danger ? colors.textMuted : colors.textPrimary },
        ]}
      >
        {title}
      </Text>

      {subtitle ? (
        <Text style={[styles.sectionSubtitle, { color: colors.textMuted }]}>{subtitle}</Text>
      ) : null}

      {loading ? (
        <ActivityIndicator color={colors.loader} style={{ marginTop: 10 }} />
      ) : null}
    </Pressable>
  );
}

/* ----------------------------- MAIN MODAL ------------------------------ */
export default function SettingsModal() {
  const { isOpen, close, revealNotificationsNonce } = useSettingsModal();
  const { colors, isLight, toggleThemeMode } = useAppTheme();
  const { language, languageMeta, languages, setLanguage, t } = useAppLanguage();
  const navigation = useNavigation<any>();
  const {
    unreadCount,
    settingsVisibleNotifications,
    loading: notificationsLoading,
    captureUnreadForSettings,
    clearSettingsVisibleNotifications,
  } = useInAppNotifications();

  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const isGuest = !currentUserId;

  const [deleting, setDeleting] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [debug, setDebug] = useState<string | null>(null);
  const [blockedUsers, setBlockedUsers] = useState<BlockedUserRow[]>([]);
  const [blockedLoading, setBlockedLoading] = useState(false);
  const [unblockingId, setUnblockingId] = useState<string | null>(null);
  const [isModerator, setIsModerator] = useState(false);
  const [moderationLoading, setModerationLoading] = useState(false);
  const [moderationReports, setModerationReports] = useState<ModerationReportRow[]>([]);
  const [reportUsers, setReportUsers] = useState<Record<string, ReportUserSummary>>({});
  const [moderationActionId, setModerationActionId] = useState<string | null>(null);
  const [blockedExpanded, setBlockedExpanded] = useState(true);
  const [moderationExpanded, setModerationExpanded] = useState(false);
  const [notificationsExpanded, setNotificationsExpanded] = useState(false);
  const [openingNotifications, setOpeningNotifications] = useState(false);
  const [languageExpanded, setLanguageExpanded] = useState(false);
  const lastRevealNotificationsNonce = useRef(0);
  const profileRevealTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [showUpgrade, setShowUpgrade] = useState(false);
  const sheetProgress = useRef(new Animated.Value(0)).current;
  const [settingsRendered, setSettingsRendered] = useState(false);

  useEffect(() => {
    sheetProgress.stopAnimation();

    if (isOpen) {
      setSettingsRendered(true);
      sheetProgress.setValue(0);

      Animated.timing(sheetProgress, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
      return;
    }

    if (!settingsRendered) return;

    Animated.timing(sheetProgress, {
      toValue: 0,
      duration: 190,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setSettingsRendered(false);
    });
  }, [isOpen, settingsRendered, sheetProgress]);

  useEffect(() => {
    return () => {
      if (profileRevealTimeoutRef.current) {
        clearTimeout(profileRevealTimeoutRef.current);
        profileRevealTimeoutRef.current = null;
      }
    };
  }, []);

  React.useEffect(() => {
    if (!isOpen) return;
    setBlockedExpanded(true);
    setModerationExpanded(false);
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      setNotificationsExpanded(false);
      setLanguageExpanded(false);
      setOpeningNotifications(false);
      clearSettingsVisibleNotifications();
      return;
    }

    let cancelled = false;
    const forcedReveal = revealNotificationsNonce > lastRevealNotificationsNonce.current;
    lastRevealNotificationsNonce.current = revealNotificationsNonce;

    setOpeningNotifications(true);
    setNotificationsExpanded(forcedReveal || unreadCount > 0);

    captureUnreadForSettings()
      .then((rows) => {
        if (cancelled) return;
        setNotificationsExpanded(forcedReveal || rows.length > 0);
      })
      .finally(() => {
        if (!cancelled) setOpeningNotifications(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isOpen, revealNotificationsNonce]);

  const openNotificationActorProfile = useCallback(
    (notice: AppNotification) => {
      const actorId = notice.actor?.id || notice.actor_id;
      if (!actorId) return;

      if (profileRevealTimeoutRef.current) {
        clearTimeout(profileRevealTimeoutRef.current);
        profileRevealTimeoutRef.current = null;
      }

      navigation.navigate('Profile', { userId: actorId });

      profileRevealTimeoutRef.current = setTimeout(() => {
        profileRevealTimeoutRef.current = null;
        close();
      }, Platform.OS === 'android' ? 140 : 90);
    },
    [close, navigation]
  );

  const checkModeratorStatus = useCallback(async (uid?: string | null) => {
    if (!uid) {
      setIsModerator(false);
      return false;
    }

    try {
      const { data: rpcData, error: rpcError } = await supabase.rpc('is_moderator');
      if (!rpcError && rpcData === true) {
        setIsModerator(true);
        return true;
      }
    } catch {}

    const { data, error } = await supabase
      .from('moderators')
      .select('role')
      .eq('user_id', uid)
      .maybeSingle();

    if (error) {
      console.warn('Settings moderator status error:', error.message);
      setIsModerator(false);
      return false;
    }

    const allowed = !!data?.role;
    setIsModerator(allowed);
    return allowed;
  }, []);

  const fetchBlockedUsers = useCallback(async (uid?: string | null) => {
    if (!uid) {
      setBlockedUsers([]);
      return;
    }

    setBlockedLoading(true);

    try {
      const { data: blocks, error: blocksError } = await supabase
        .from('user_blocks')
        .select('blocked_id')
        .eq('blocker_id', uid)
        .order('created_at', { ascending: false });

      if (blocksError) {
        console.error('Settings blocked users error:', blocksError);
        setBlockedUsers([]);
        return;
      }

      const ids = (blocks || []).map((row: any) => row.blocked_id).filter(Boolean);

      if (!ids.length) {
        setBlockedUsers([]);
        return;
      }

      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, full_name, avatar_url, main_role_id')
        .in('id', ids);

      if (usersError) {
        console.error('Settings blocked profile error:', usersError);
      }

      const roleIds = [
        ...new Set(((users || []) as any[]).map((u) => u.main_role_id).filter(Boolean)),
      ];
      let roleMap: Record<number, string> = {};

      if (roleIds.length) {
        const { data: roles } = await supabase
          .from('creative_roles')
          .select('id, name')
          .in('id', roleIds);

        roleMap = Object.fromEntries((roles || []).map((r: any) => [r.id, r.name]));
      }

      const userMap = new Map(
        ((users || []) as any[]).map((u) => [
          u.id,
          {
            ...u,
            role_name: u.main_role_id ? roleMap[u.main_role_id] || null : null,
          },
        ])
      );

      setBlockedUsers(
        ids.map((id: string) => {
          const user = userMap.get(id);
          return {
            id,
            full_name: user?.full_name || 'Blocked user',
            avatar_url: user?.avatar_url || null,
            main_role_id: user?.main_role_id || null,
            role_name: user?.role_name || null,
          };
        })
      );
    } finally {
      setBlockedLoading(false);
    }
  }, []);

  const fetchModerationReports = useCallback(async () => {
    setModerationLoading(true);

    try {
      const { data, error } = await supabase
        .from('content_reports')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (error) {
        console.error('Settings moderation reports error:', error);
        setModerationReports([]);
        return;
      }

      const rows = ((data || []) as ModerationReportRow[]).filter((report) => {
        const status = String(report.status || 'pending').toLowerCase();
        return status === 'pending' || status === 'open' || status === 'new';
      });

      setModerationReports(rows);

      const userIds = Array.from(
        new Set(
          rows
            .flatMap((report) => [report.reporter_id, report.reported_user_id])
            .filter(Boolean) as string[]
        )
      );

      if (!userIds.length) {
        setReportUsers({});
        return;
      }

      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, full_name, avatar_url')
        .in('id', userIds);

      if (usersError) {
        console.warn('Settings report users error:', usersError.message);
        setReportUsers({});
        return;
      }

      setReportUsers(
        Object.fromEntries(((users || []) as ReportUserSummary[]).map((user) => [user.id, user]))
      );
    } finally {
      setModerationLoading(false);
    }
  }, []);

  React.useEffect(() => {
    let mounted = true;

    (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (mounted) {
        setCurrentUserId(user?.id ?? null);
        void fetchBlockedUsers(user?.id ?? null);
        checkModeratorStatus(user?.id ?? null).then((allowed) => {
          if (!mounted) return;
          if (allowed && moderationExpanded) {
            void fetchModerationReports();
          } else {
            setModerationReports([]);
            setReportUsers({});
          }
        });
      }
    })();

    return () => {
      mounted = false;
    };
  }, [checkModeratorStatus, fetchBlockedUsers, fetchModerationReports, isOpen, moderationExpanded]);

  const onUnblock = async (target: BlockedUserRow) => {
    const ok = await confirm({
      title: 'Unblock this user?',
      message: 'Their content may appear in your feeds again.',
      okText: 'Unblock',
      cancelText: 'Cancel',
    });
    if (!ok) return;

    try {
      setUnblockingId(target.id);
      const success = await unblockUser({ blockedUserId: target.id });

      if (!success) {
        Alert.alert('Could not unblock user', 'Please try again.');
        return;
      }

      setBlockedUsers((prev) => prev.filter((row) => row.id !== target.id));
      Alert.alert('User unblocked', 'This user has been removed from your blocked list.');
    } finally {
      setUnblockingId(null);
    }
  };

  const markReportHandled = (reportId: string) => {
    setModerationReports((prev) => prev.filter((report) => report.id !== reportId));
  };

  const resolveReport = async (report: ModerationReportRow, note = 'Reviewed in the moderation inbox.') => {
    try {
      setModerationActionId(report.id);
      const { error } = await supabase.rpc('moderator_resolve_report', {
        target_report_id: report.id,
        resolution_note: note,
      });

      if (error) {
        Alert.alert('Could not resolve report', error.message);
        return false;
      }

      markReportHandled(report.id);
      return true;
    } finally {
      setModerationActionId(null);
    }
  };

  const onResolveReport = async (report: ModerationReportRow) => {
    const ok = await confirm({
      title: 'Resolve this report?',
      message: 'This will mark the report as reviewed.',
      okText: 'Resolve',
      cancelText: 'Cancel',
    });
    if (!ok) return;

    await resolveReport(report);
  };

  const onRemoveReportedContent = async (report: ModerationReportRow) => {
    if (!report.content_type || !report.content_id) {
      Alert.alert('Missing content', 'This report does not include a content item to remove.');
      return;
    }

    const ok = await confirm({
      title: 'Remove reported content?',
      message: 'The reported item will be hidden from feeds immediately.',
      okText: 'Remove',
      cancelText: 'Cancel',
      destructive: true,
    });
    if (!ok) return;

    try {
      setModerationActionId(report.id);
      const { error } = await supabase.rpc('moderator_remove_content', {
        target_content_type: report.content_type,
        target_content_id: report.content_id,
        removal_reason: report.reason || 'Reported by user',
      });

      if (error) {
        Alert.alert('Could not remove content', error.message);
        return;
      }
    } finally {
      setModerationActionId(null);
    }

    await resolveReport(report, 'Removed reported content.');
  };

  const onBanReportedUser = async (report: ModerationReportRow) => {
    if (!report.reported_user_id) {
      Alert.alert('Missing user', 'This report does not include a user to ban.');
      return;
    }

    const ok = await confirm({
      title: 'Ban reported user?',
      message: 'This will eject the reported user from Overlooked.',
      okText: 'Ban User',
      cancelText: 'Cancel',
      destructive: true,
    });
    if (!ok) return;

    try {
      setModerationActionId(report.id);
      const { error } = await supabase.rpc('moderator_ban_user', {
        target_user_id: report.reported_user_id,
        ban_reason: report.reason || 'Reported by user',
      });

      if (error) {
        Alert.alert('Could not ban user', error.message);
        return;
      }
    } finally {
      setModerationActionId(null);
    }

    await resolveReport(report, 'Banned reported user.');
  };

  const promptSignIn = (message: string) => {
    if (Platform.OS === 'web') {
      const goToSignIn = window.confirm(
        `${message}\n\nPress OK for Sign In, or Cancel for Create Account.`
      );

      close();

      if (goToSignIn) {
        navigation.navigate('Auth', { screen: 'SignIn' });
      } else {
        navigation.navigate('Auth', { screen: 'SignUp' });
      }
      return;
    }

    Alert.alert('Sign in required', message, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign In',
        onPress: () => {
          close();
          navigation.navigate('Auth', { screen: 'SignIn' });
        },
      },
      {
        text: 'Create Account',
        onPress: () => {
          close();
          navigation.navigate('Auth', { screen: 'SignUp' });
        },
      },
    ]);
  };

  const resetToAuthSignIn = () => {
    const action = CommonActions.reset({
      index: 0,
      routes: [{ name: 'Auth', params: { screen: 'SignIn' } }],
    });

    try {
      resetRootToSignIn();
    } catch {}

    try {
      navigation.dispatch(action);
    } catch {
      navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
    }

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.history.replaceState(null, '', '/signin');
    }
  };

  const openUpgradeFromSettings = () => {
    close();

    if (Platform.OS === 'web') {
      setShowUpgrade(true);
      return;
    }

    requestAnimationFrame(() => {
      setTimeout(() => {
        setShowUpgrade(true);
      }, 150);
    });
  };

  const onSignOut = async () => {
    const ok = await confirm({
      title: 'Sign out?',
      message: 'You can sign back in anytime with your email.',
      okText: 'Sign out',
      cancelText: 'Cancel',
    });
    if (!ok) return;

    try {
      setSigningOut(true);
      setSigningOutFlag(true);
      clearAuthRoutingFlags();
      close();

      // Let the settings sheet finish its close animation before the root auth reset.
      await wait(210);

      const { error } = await supabase.auth.signOut();
      if (error) {
        setSigningOutFlag(false);
        Alert.alert('Error', error.message);
        return;
      }

      clearAuthRoutingFlags();
    } catch (e: any) {
      setSigningOutFlag(false);
      Alert.alert('Error', e?.message || 'Failed to sign out.');
    } finally {
      setSigningOut(false);
    }
  };

  const onDeleteAccount = async () => {
    const ok = await confirm({
      title: 'Delete your account?',
      message:
        'This permanently deletes your account and data. Billing is stopped immediately.',
      okText: 'Delete Account',
      cancelText: 'Keep Account',
      destructive: true,
    });
    if (!ok) return;

    try {
      setDeleting(true);
      setDebug('delete-account: preparing…');

      const { status, text, data } = await callFunction('delete-account');
      const result = (data ?? {}) as DeleteAccountResponse;

      if (status === 409 && result?.action === 'cancel_external_first') {
        const opened = await openExternalManagementUrl(result?.management_url ?? null);

        const externalMessage =
          result?.message ||
          (opened
            ? 'Your mobile subscription is still active and renewing. We opened the store management page so you can cancel it there first.'
            : 'Your mobile subscription is still active and renewing. Please cancel it first in Google Play or the App Store, then try deleting your account again.');

        setDebug(
          `delete-account blocked: external cancellation required (${result?.store || result?.provider || 'external'})`
        );

        Alert.alert('Cancel subscription first', externalMessage);
        return;
      }

      if (status >= 400) {
        setDebug(`delete-account http ${status}: ${text}`);
        Alert.alert(
          'Error',
          `Delete failed (${status}). ${result?.message || result?.error || text}`
        );
        return;
      }

      clearAuthRoutingFlags();
      await supabase.auth.signOut().catch(() => {});
      clearAuthRoutingFlags();

      if (Platform.OS === 'web') {
        try {
          // @ts-ignore
          if (typeof window !== 'undefined') (window as any).__RECOVERY__ = false;
        } catch {}

        window.location.assign('/signin');
        return;
      }

      close();
      resetToAuthSignIn();
      setTimeout(resetToAuthSignIn, 160);
    } catch (e: any) {
      setDebug(`delete-account exception: ${e?.message}`);
      Alert.alert('Error', e?.message);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Modal
        visible={settingsRendered}
        transparent
        animationType="none"
        onRequestClose={close}
      >
        <Animated.View
          style={[
            styles.backdrop,
            {
              opacity: sheetProgress,
              backgroundColor: isLight ? 'rgba(20,17,13,0.22)' : 'rgba(0,0,0,0.85)',
            },
          ]}
        >
          <Pressable style={StyleSheet.absoluteFillObject} onPress={close} />
          <Animated.View
            style={[
              styles.sheet,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                shadowColor: colors.shadow,
              },
              {
                transform: [
                  {
                    translateY: sheetProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [96, 0],
                    }),
                  },
                  {
                    scale: sheetProgress.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.985, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <View style={styles.handleWrap}>
              <View style={[styles.handle, { backgroundColor: colors.borderStrong }]} />
            </View>

            <Text style={[styles.title, { color: colors.textPrimary }]}>{t('Settings')}</Text>

            <ScrollView
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollContent}
            >
            <View
              style={[
                styles.notificationsSection,
                {
                  backgroundColor: colors.backgroundAlt,
                  borderColor: colors.border,
                },
              ]}
            >
              <Pressable
                onPress={() => setNotificationsExpanded((prev) => !prev)}
                style={({ pressed }) => [styles.collapsibleHeader, pressed && { opacity: 0.78 }]}
              >
                <View style={styles.collapsibleCopy}>
                  <View style={styles.notificationTitleRow}>
                    <Text style={[styles.blockedTitle, { color: colors.textPrimary }]}>
                      {t('Notifications')}
                    </Text>
                    {settingsVisibleNotifications.length > 0 ? (
                      <View style={[styles.notificationCountPill, { backgroundColor: colors.primary }]}>
                        <Text style={[styles.notificationCountText, { color: colors.textOnPrimary }]}>
                          {settingsVisibleNotifications.length > 99 ? '99+' : settingsVisibleNotifications.length}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.blockedSubtitle, { color: colors.textMuted }]} numberOfLines={2}>
                    {settingsVisibleNotifications.length > 0
                      ? t('New activity since you last checked.')
                      : t('No new notifications.')}
                  </Text>
                </View>

                <View style={styles.headerActions}>
                  {(openingNotifications || notificationsLoading) && settingsVisibleNotifications.length === 0 ? (
                    <ActivityIndicator color={colors.loader} size="small" />
                  ) : null}

                  <View
                    style={[
                      styles.chevronButton,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={notificationsExpanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.textMuted}
                    />
                  </View>
                </View>
              </Pressable>

              {notificationsExpanded ? (
                openingNotifications && settingsVisibleNotifications.length === 0 ? (
                  <View style={styles.blockedLoadingRow}>
                    <ActivityIndicator color={colors.loader} />
                  </View>
                ) : settingsVisibleNotifications.length === 0 ? (
                  <Text style={[styles.blockedEmpty, { color: colors.textMuted }]}>
                    {t('You are all caught up.')}
                  </Text>
                ) : (
                  <View style={styles.notificationList}>
                    {settingsVisibleNotifications.map((notice: AppNotification) => {
                      const actor =
                        notice.actor ||
                        (notice.actor_id
                          ? { id: notice.actor_id, full_name: null, avatar_url: null }
                          : null);
                      const canOpenActor = !!actor?.id;
                      const actorInitial =
                        (actor?.full_name || notice.title || 'O').trim().slice(0, 1).toUpperCase() || 'O';

                      return (
                        <View
                          key={notice.id}
                          style={[
                            styles.notificationRow,
                            {
                              backgroundColor: colors.card,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <Pressable
                            onPress={() => openNotificationActorProfile(notice)}
                            disabled={!canOpenActor}
                            accessibilityRole={canOpenActor ? 'button' : undefined}
                            accessibilityLabel={
                              canOpenActor
                                ? `Open ${actor?.full_name || notice.title || 'profile'}`
                                : undefined
                            }
                            style={({ pressed }) => [
                              styles.notificationIcon,
                              {
                                backgroundColor: isLight ? '#F6ECD8' : 'rgba(198,166,100,0.10)',
                                borderColor: isLight ? colors.borderStrong : 'rgba(198,166,100,0.24)',
                              },
                              canOpenActor && styles.notificationAvatarButton,
                              pressed && canOpenActor && { opacity: 0.72 },
                            ]}
                          >
                            {actor?.avatar_url ? (
                              <Image source={{ uri: actor.avatar_url }} style={styles.notificationAvatarImage} />
                            ) : actor ? (
                              <Text style={[styles.notificationAvatarInitial, { color: colors.primary }]}>
                                {actorInitial}
                              </Text>
                            ) : (
                              <Ionicons
                                name={
                                  notice.notification_type === 'message'
                                    ? 'chatbubble-ellipses-outline'
                                    : 'notifications-outline'
                                }
                                size={16}
                                color={colors.primary}
                              />
                            )}
                          </Pressable>

                          <View style={styles.notificationCopy}>
                            <View style={styles.notificationMetaRow}>
                              <Text style={[styles.notificationRowTitle, { color: colors.textPrimary }]} numberOfLines={2}>
                                {notice.title || t('Notification')}
                              </Text>
                              <Text style={[styles.notificationTime, { color: colors.textMuted }]} numberOfLines={1}>
                                {formatNotificationTime(notice.created_at)}
                              </Text>
                            </View>

                            {notice.body ? (
                              <Text style={[styles.notificationBody, { color: colors.textMuted }]} numberOfLines={2}>
                                {notice.body}
                              </Text>
                            ) : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )
              ) : null}
            </View>

            <View
              style={[
                styles.languageSection,
                {
                  backgroundColor: colors.backgroundAlt,
                  borderColor: colors.border,
                },
              ]}
            >
              <Pressable
                onPress={() => setLanguageExpanded((prev) => !prev)}
                style={({ pressed }) => [styles.collapsibleHeader, pressed && { opacity: 0.78 }]}
              >
                <View style={styles.collapsibleCopy}>
                  <Text style={[styles.blockedTitle, { color: colors.textPrimary }]}>
                    {t('Language')}
                  </Text>
                  <Text style={[styles.blockedSubtitle, { color: colors.textMuted }]} numberOfLines={2}>
                    {languageMeta.nativeName} · {languageMeta.englishName}
                  </Text>
                </View>

                <View
                  style={[
                    styles.chevronButton,
                    {
                      backgroundColor: colors.card,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Ionicons
                    name={languageExpanded ? 'chevron-up' : 'chevron-down'}
                    size={16}
                    color={colors.textMuted}
                  />
                </View>
              </Pressable>

              {languageExpanded ? (
                <View style={styles.languageList}>
                  <Text style={[styles.languageHelper, { color: colors.textMuted }]}>
                    {t('Choose the language used across Overlooked.')}
                  </Text>

                  {languages.map((option) => {
                    const selected = option.code === language;

                    return (
                      <Pressable
                        key={option.code}
                        onPress={() => void setLanguage(option.code as AppLanguageCode)}
                        style={({ pressed }) => [
                          styles.languageRow,
                          {
                            backgroundColor: selected
                              ? isLight
                                ? '#F6ECD8'
                                : 'rgba(198,166,100,0.12)'
                              : colors.card,
                            borderColor: selected ? colors.primary : colors.border,
                          },
                          pressed && { opacity: 0.76 },
                        ]}
                      >
                        <View style={styles.languageCopy}>
                          <Text
                            style={[
                              styles.languageNativeName,
                              styles.languageSelectorText,
                              { color: colors.textPrimary },
                            ]}
                            numberOfLines={1}
                          >
                            {option.nativeName}
                          </Text>
                          <Text
                            style={[
                              styles.languageEnglishName,
                              styles.languageSelectorText,
                              { color: colors.textMuted },
                            ]}
                            numberOfLines={1}
                          >
                            {option.englishName}
                          </Text>
                        </View>

                        {selected ? (
                          <View
                            style={[
                              styles.languageSelectedPill,
                              { backgroundColor: colors.primary },
                            ]}
                          >
                            <Ionicons name="checkmark" size={14} color={colors.textOnPrimary} />
                            <Text style={[styles.languageSelectedText, { color: colors.textOnPrimary }]}>
                              {t('Selected')}
                            </Text>
                          </View>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>

            <Pressable
              onPress={() => {
                void toggleThemeMode();
              }}
              style={({ pressed }) => [
                styles.themeToggleRow,
                {
                  backgroundColor: colors.backgroundAlt,
                  borderColor: colors.border,
                },
                pressed && { opacity: 0.82 },
              ]}
            >
              <View style={styles.themeToggleCopy}>
                <Text style={[styles.themeToggleTitle, { color: colors.textPrimary }]}>
                  {t('Light Mode')}
                </Text>
                <Text style={[styles.themeToggleSubtitle, { color: colors.textMuted }]}>
                  {isLight ? t('Light app palette is on.') : t('Switch to a light app palette.')}
                </Text>
              </View>
              <View
                style={[
                  styles.themeSwitchTrack,
                  {
                    backgroundColor: isLight ? colors.primary : colors.cardAlt,
                    borderColor: isLight ? colors.primary : colors.borderStrong,
                  },
                ]}
              >
                <View
                  style={[
                    styles.themeSwitchThumb,
                    {
                      alignSelf: isLight ? 'flex-end' : 'flex-start',
                      backgroundColor: isLight ? colors.card : colors.textSecondary,
                    },
                  ]}
                />
              </View>
            </Pressable>

            <SectionButton
              title={t('Manage membership')}
              subtitle={
                isGuest
                  ? t('Sign in to view or change your Overlooked plan.')
                  : t('View or change your Overlooked plan.')
              }
              onPress={() => {
                if (isGuest) {
                  promptSignIn(t('Sign in or create an account to manage membership.'));
                  return;
                }

                openUpgradeFromSettings();
              }}
              disabled={deleting || signingOut}
            />

            <SectionButton
              title={t('Sign out')}
              subtitle={t('Return to the login screen.')}
              onPress={onSignOut}
              loading={signingOut}
              disabled={deleting}
            />

            <View
              style={[
                styles.blockedSection,
                {
                  backgroundColor: colors.backgroundAlt,
                  borderColor: colors.border,
                },
              ]}
            >
              <Pressable
                onPress={() => setBlockedExpanded((prev) => !prev)}
                style={({ pressed }) => [styles.collapsibleHeader, pressed && { opacity: 0.78 }]}
              >
                <View style={styles.collapsibleCopy}>
                  <Text style={[styles.blockedTitle, { color: colors.textPrimary }]}>
                    {t('Blocked Users')}
                  </Text>
                  <Text style={[styles.blockedSubtitle, { color: colors.textMuted }]} numberOfLines={2}>
                    {t('Manage people you have hidden from your feeds.')}
                  </Text>
                </View>

                <View style={styles.headerActions}>
                  <Pressable
                    onPress={(event) => {
                      event.stopPropagation?.();
                      void fetchBlockedUsers(currentUserId);
                    }}
                    disabled={blockedLoading || !currentUserId}
                    style={({ pressed }) => [
                      styles.reloadIconButton,
                      {
                        backgroundColor: isLight ? '#F6ECD8' : 'rgba(198,166,100,0.08)',
                        borderColor: isLight ? colors.borderStrong : 'rgba(198,166,100,0.28)',
                      },
                      pressed && { opacity: 0.7 },
                      (!currentUserId || blockedLoading) && { opacity: 0.55 },
                    ]}
                  >
                    {blockedLoading ? (
                      <ActivityIndicator color={GOLD} size="small" />
                    ) : (
                      <Ionicons name="refresh" size={15} color={GOLD} />
                    )}
                  </Pressable>

                  <View
                    style={[
                      styles.chevronButton,
                      {
                        backgroundColor: colors.card,
                        borderColor: colors.border,
                      },
                    ]}
                  >
                    <Ionicons
                      name={blockedExpanded ? 'chevron-up' : 'chevron-down'}
                      size={16}
                      color={colors.textMuted}
                    />
                  </View>
                </View>
              </Pressable>

              {blockedExpanded ? (
                !currentUserId ? (
                  <Text style={[styles.blockedEmpty, { color: colors.textMuted }]}>
                    {t('Sign in to manage blocked users.')}
                  </Text>
                ) : blockedLoading && blockedUsers.length === 0 ? (
                  <View style={styles.blockedLoadingRow}>
                    <ActivityIndicator color={colors.loader} />
                  </View>
                ) : blockedUsers.length === 0 ? (
                  <Text style={[styles.blockedEmpty, { color: colors.textMuted }]}>
                    {t('You haven’t blocked anyone.')}
                  </Text>
                ) : (
                  <View style={styles.blockedList}>
                    {blockedUsers.map((user) => (
                      <View
                        key={user.id}
                        style={[
                          styles.blockedUserRow,
                          {
                            backgroundColor: colors.card,
                            borderColor: colors.border,
                          },
                        ]}
                      >
                        {user.avatar_url ? (
                          <Image source={{ uri: user.avatar_url }} style={styles.blockedAvatar} />
                        ) : (
                          <View
                            style={[
                              styles.blockedAvatarFallback,
                              {
                                backgroundColor: colors.backgroundAlt,
                                borderColor: colors.border,
                              },
                            ]}
                          >
                            <Text style={[styles.blockedAvatarText, { color: colors.textPrimary }]}>
                              {(user.full_name || 'U').slice(0, 1).toUpperCase()}
                            </Text>
                          </View>
                        )}

                        <View style={styles.blockedUserInfo}>
                          <Text style={[styles.blockedName, { color: colors.textPrimary }]} numberOfLines={1}>
                            {user.full_name || 'Blocked user'}
                          </Text>
                          <Text style={[styles.blockedMeta, { color: colors.textMuted }]} numberOfLines={1}>
                            {user.role_name ? `${user.role_name} • ${t('Blocked')}` : t('Blocked')}
                          </Text>
                        </View>

                        <Pressable
                          onPress={() => onUnblock(user)}
                          disabled={unblockingId === user.id}
                          style={({ pressed }) => [
                            styles.unblockButton,
                            pressed && { opacity: 0.75 },
                            unblockingId === user.id && { opacity: 0.55 },
                          ]}
                        >
                          {unblockingId === user.id ? (
                            <ActivityIndicator color={colors.textOnPrimary} size="small" />
                          ) : (
                            <Text style={[styles.unblockText, { color: colors.textOnPrimary }]}>{t('Unblock')}</Text>
                          )}
                        </Pressable>
                      </View>
                    ))}
                  </View>
                )
              ) : null}
            </View>

            {isModerator ? (
              <View
                style={[
                  styles.moderationSection,
                  {
                    backgroundColor: colors.backgroundAlt,
                    borderColor: colors.borderStrong,
                  },
                ]}
              >
                <Pressable
                  onPress={() => setModerationExpanded((prev) => !prev)}
                  style={({ pressed }) => [styles.collapsibleHeader, pressed && { opacity: 0.78 }]}
                >
                  <View style={styles.collapsibleCopy}>
                    <Text style={[styles.blockedTitle, { color: colors.textPrimary }]}>
                      {t('Moderation Inbox')}
                    </Text>
                    <Text style={[styles.blockedSubtitle, { color: colors.textMuted }]} numberOfLines={2}>
                      {t('Review reports sent by users within 24 hours.')}
                    </Text>
                  </View>

                  <View style={styles.headerActions}>
                    <Pressable
                      onPress={(event) => {
                        event.stopPropagation?.();
                        setModerationExpanded(true);
                        void fetchModerationReports();
                      }}
                      disabled={moderationLoading}
                      style={({ pressed }) => [
                        styles.reloadIconButton,
                        {
                          backgroundColor: isLight ? '#F6ECD8' : 'rgba(198,166,100,0.08)',
                          borderColor: isLight ? colors.borderStrong : 'rgba(198,166,100,0.28)',
                        },
                        pressed && { opacity: 0.7 },
                        moderationLoading && { opacity: 0.55 },
                      ]}
                    >
                      {moderationLoading ? (
                        <ActivityIndicator color={GOLD} size="small" />
                      ) : (
                        <Ionicons name="refresh" size={15} color={GOLD} />
                      )}
                    </Pressable>

                    <View
                      style={[
                        styles.chevronButton,
                        {
                          backgroundColor: colors.card,
                          borderColor: colors.border,
                        },
                      ]}
                    >
                      <Ionicons
                        name={moderationExpanded ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color={colors.textMuted}
                      />
                    </View>
                  </View>
                </Pressable>

                {moderationExpanded ? (
                  moderationLoading && moderationReports.length === 0 ? (
                    <View style={styles.blockedLoadingRow}>
                      <ActivityIndicator color={colors.loader} />
                    </View>
                  ) : moderationReports.length === 0 ? (
                    <Text style={[styles.blockedEmpty, { color: colors.textMuted }]}>{t('No open reports.')}</Text>
                  ) : (
                    <View style={styles.moderationList}>
                      {moderationReports.map((report) => {
                      const reporter = report.reporter_id ? reportUsers[report.reporter_id] : null;
                      const reported = report.reported_user_id
                        ? reportUsers[report.reported_user_id]
                        : null;
                      const busy = moderationActionId === report.id;

                      return (
                        <View
                          key={report.id}
                          style={[
                            styles.reportCard,
                            {
                              backgroundColor: colors.card,
                              borderColor: colors.border,
                            },
                          ]}
                        >
                          <View style={styles.reportTopRow}>
                            <View style={styles.reportTitleWrap}>
                              <Text style={[styles.reportReason, { color: colors.textPrimary }]} numberOfLines={2}>
                                {report.reason || 'Reported content'}
                              </Text>
                              <Text style={[styles.reportMeta, { color: colors.accent }]} numberOfLines={1}>
                                {[
                                  report.content_type || 'content',
                                  report.created_at
                                    ? new Date(report.created_at).toLocaleString()
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' • ')}
                              </Text>
                            </View>

                            {busy ? <ActivityIndicator color={colors.loader} size="small" /> : null}
                          </View>

                          <Text style={[styles.reportPeople, { color: colors.textMuted }]} numberOfLines={2}>
                            Reporter: {reporter?.full_name || report.reporter_id || 'Unknown'}
                          </Text>
                          <Text style={[styles.reportPeople, { color: colors.textMuted }]} numberOfLines={2}>
                            Reported: {reported?.full_name || report.reported_user_id || 'Unknown'}
                          </Text>

                          {report.details ? (
                            <Text
                              style={[
                                styles.reportDetails,
                                {
                                  backgroundColor: colors.backgroundAlt,
                                  borderColor: colors.border,
                                  color: colors.textPrimary,
                                },
                              ]}
                            >
                              {report.details}
                            </Text>
                          ) : null}

                          <View style={styles.reportActions}>
                            <Pressable
                              onPress={() => onResolveReport(report)}
                              disabled={busy}
                              style={({ pressed }) => [
                                styles.reportActionButton,
                                pressed && { opacity: 0.75 },
                                busy && { opacity: 0.55 },
                              ]}
                            >
                              <Text style={styles.reportActionText}>{t('Resolve')}</Text>
                            </Pressable>

                            <Pressable
                              onPress={() => onRemoveReportedContent(report)}
                              disabled={busy || !report.content_id}
                              style={({ pressed }) => [
                                styles.reportActionButton,
                                styles.reportDangerOutline,
                                pressed && { opacity: 0.75 },
                                (busy || !report.content_id) && { opacity: 0.45 },
                              ]}
                            >
                              <Text style={styles.reportDangerText}>{t('Remove')}</Text>
                            </Pressable>

                            <Pressable
                              onPress={() => onBanReportedUser(report)}
                              disabled={busy || !report.reported_user_id}
                              style={({ pressed }) => [
                                styles.reportActionButton,
                                styles.reportDangerSolid,
                                pressed && { opacity: 0.75 },
                                (busy || !report.reported_user_id) && { opacity: 0.45 },
                              ]}
                            >
                              <Text style={styles.reportDangerSolidText}>{t('Ban')}</Text>
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )) : null}
              </View>
            ) : null}

            <SectionButton
              title={t('Delete account')}
              subtitle={t('Permanently remove your account and data.')}
              onPress={onDeleteAccount}
              danger
              loading={deleting}
              disabled={signingOut}
            />

            {debug ? <Text style={styles.debugText}>{debug}</Text> : null}
            <Text style={styles.supportText}>
  {t('For support, message overlookedsupport@gmail.com')}
</Text>
            </ScrollView>

            <Pressable
              onPress={close}
              style={({ pressed }) => [
                styles.closeButton,
                {
                  backgroundColor: isLight ? colors.backgroundAlt : colors.elevated,
                  borderColor: isLight ? colors.borderStrong : colors.border,
                },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.closeText, { color: colors.textPrimary }]}>{t('Close')}</Text>
            </Pressable>
          </Animated.View>
        </Animated.View>
      </Modal>

      <UpgradeModal
        visible={showUpgrade}
        onClose={() => setShowUpgrade(false)}
        context="workshop"
      />
    </>
  );
}

/* ------------------------------- STYLES ------------------------------- */

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'flex-end',
    paddingHorizontal: 16,
    paddingBottom: 20,
  },
  sheet: {
    backgroundColor: DARK_CARD,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingVertical: 22,
    paddingHorizontal: 20,
    borderWidth: 1,
    borderColor: DIVIDER,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 18,
    elevation: 14,
    maxHeight: '88%',
  },
  scrollContent: {
    paddingBottom: 6,
  },
  handleWrap: {
    alignItems: 'center',
    marginBottom: 12,
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: 999,
    backgroundColor: DIVIDER,
  },
  title: {
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: 1.6,
    color: TEXT_IVORY,
    textAlign: 'center',
    marginBottom: 16,
    fontFamily: SYSTEM_SANS,
  },
  sectionButton: {
    backgroundColor: DARK_BG,
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: DIVIDER,
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },
  sectionSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: TEXT_MUTED,
    lineHeight: 17,
    fontFamily: SYSTEM_SANS,
  },
  themeToggleRow: {
    minHeight: 72,
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderWidth: 1,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  themeToggleCopy: {
    flex: 1,
    minWidth: 0,
  },
  themeToggleTitle: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
  },
  themeToggleSubtitle: {
    marginTop: 5,
    fontSize: 13,
    lineHeight: 17,
    fontFamily: SYSTEM_SANS,
  },
  themeSwitchTrack: {
    width: 48,
    height: 28,
    borderRadius: 999,
    borderWidth: 1,
    padding: 3,
    justifyContent: 'center',
  },
  themeSwitchThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
  },
  blockedSection: {
    backgroundColor: DARK_BG,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: DIVIDER,
    marginBottom: 12,
  },
  notificationsSection: {
    backgroundColor: DARK_BG,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: DIVIDER,
    marginBottom: 12,
  },
  languageSection: {
    backgroundColor: DARK_BG,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: DIVIDER,
    marginBottom: 12,
  },
  languageList: {
    marginTop: 12,
    gap: 8,
  },
  languageHelper: {
    fontSize: 12,
    lineHeight: 16,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
    marginBottom: 2,
  },
  languageRow: {
    minHeight: 58,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  languageCopy: {
    flex: 1,
    minWidth: 0,
  },
  languageSelectorText: {
    alignSelf: 'stretch',
    textAlign: 'left',
    writingDirection: 'ltr',
  },
  languageNativeName: {
    color: TEXT_IVORY,
    fontSize: 15,
    lineHeight: 19,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
  },
  languageEnglishName: {
    marginTop: 2,
    color: TEXT_MUTED,
    fontSize: 12,
    lineHeight: 16,
    fontFamily: SYSTEM_SANS,
  },
  languageSelectedPill: {
    minHeight: 28,
    borderRadius: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    flexShrink: 0,
  },
  languageSelectedText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
  },
  notificationTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  notificationCountPill: {
    minWidth: 20,
    height: 20,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  notificationCountText: {
    color: '#000000',
    fontSize: 10,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
  },
  notificationList: {
    gap: 10,
    marginTop: 12,
  },
  notificationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: '#0A0A0A',
    padding: 10,
  },
  notificationIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    backgroundColor: 'rgba(198,166,100,0.10)',
    borderColor: 'rgba(198,166,100,0.24)',
    flexShrink: 0,
    overflow: 'hidden',
  },
  notificationAvatarButton: {
    borderColor: 'rgba(198,166,100,0.42)',
  },
  notificationAvatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 18,
  },
  notificationAvatarInitial: {
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
  },
  notificationCopy: {
    flex: 1,
    minWidth: 0,
  },
  notificationMetaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  notificationRowTitle: {
    flex: 1,
    minWidth: 0,
    color: TEXT_IVORY,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
  },
  notificationTime: {
    color: TEXT_MUTED,
    fontSize: 11,
    lineHeight: 16,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
    flexShrink: 0,
  },
  notificationBody: {
    marginTop: 3,
    color: TEXT_MUTED,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: SYSTEM_SANS,
  },
  moderationSection: {
    backgroundColor: DARK_BG,
    borderRadius: 18,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.26)',
    marginBottom: 12,
  },
  collapsibleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  blockedHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 12,
  },
  collapsibleCopy: {
    flex: 1,
    minWidth: 0,
  },
  moderationHeaderCopy: {
    flex: 1,
    minWidth: 0,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    flexShrink: 0,
  },
  blockedTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },
  blockedSubtitle: {
    marginTop: 4,
    fontSize: 12,
    lineHeight: 16,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },
  reloadButton: {
    minHeight: 32,
    minWidth: 64,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.28)',
    backgroundColor: 'rgba(198,166,100,0.08)',
    paddingHorizontal: 12,
  },
  reloadIconButton: {
    width: 36,
    height: 36,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.28)',
    backgroundColor: 'rgba(198,166,100,0.08)',
  },
  chevronButton: {
    width: 30,
    height: 30,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  reloadText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  blockedLoadingRow: {
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  blockedEmpty: {
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 18,
    paddingVertical: 10,
    fontFamily: SYSTEM_SANS,
  },
  blockedList: {
    gap: 10,
    marginTop: 12,
  },
  blockedUserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: '#0A0A0A',
    padding: 9,
  },
  blockedAvatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: DARK_ELEVATED,
  },
  blockedAvatarFallback: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  blockedAvatarText: {
    color: TEXT_IVORY,
    fontWeight: '900',
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
  },
  blockedUserInfo: {
    flex: 1,
    minWidth: 0,
  },
  blockedName: {
    color: TEXT_IVORY,
    fontSize: 14,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
  },
  blockedMeta: {
    marginTop: 3,
    color: TEXT_MUTED,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
  },
  unblockButton: {
    minHeight: 34,
    maxWidth: 86,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GOLD,
    paddingHorizontal: 11,
    flexShrink: 0,
  },
  unblockText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  moderationList: {
    gap: 12,
    marginTop: 12,
  },
  reportCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    backgroundColor: '#0A0A0A',
    padding: 12,
  },
  reportTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 8,
  },
  reportTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  reportReason: {
    color: TEXT_IVORY,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
  },
  reportMeta: {
    marginTop: 4,
    color: GOLD,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '800',
    letterSpacing: 0.4,
    fontFamily: SYSTEM_SANS,
  },
  reportPeople: {
    color: TEXT_MUTED,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: SYSTEM_SANS,
  },
  reportDetails: {
    marginTop: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
    backgroundColor: DARK_CARD,
    padding: 10,
    color: TEXT_IVORY,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: SYSTEM_SANS,
  },
  reportActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  reportActionButton: {
    minHeight: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.28)',
    backgroundColor: 'rgba(198,166,100,0.08)',
    paddingHorizontal: 13,
  },
  reportActionText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  reportDangerOutline: {
    borderColor: 'rgba(255,113,128,0.34)',
    backgroundColor: 'rgba(255,113,128,0.08)',
  },
  reportDangerText: {
    color: '#FF7180',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  reportDangerSolid: {
    borderColor: '#FF7180',
    backgroundColor: '#FF7180',
  },
  reportDangerSolidText: {
    color: '#000',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  debugText: {
    fontSize: 11,
    color: GOLD,
    opacity: 0.85,
    marginTop: 8,
    fontFamily: SYSTEM_SANS,
  },
  supportText: {
  marginTop: 10,
  marginBottom: 4,
  textAlign: 'center',
  fontSize: 13,
  lineHeight: 18,
  color: TEXT_MUTED,
  fontFamily: SYSTEM_SANS,
},
  closeButton: {
    marginTop: 10,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: 'center',
    backgroundColor: DARK_ELEVATED,
    borderWidth: 1,
    borderColor: DIVIDER,
  },
  closeText: {
    color: TEXT_IVORY,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
  },
});
