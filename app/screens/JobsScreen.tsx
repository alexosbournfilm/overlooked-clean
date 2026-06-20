// app/screens/JobsScreen.tsx
import React,
{
  useEffect,
  useLayoutEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import
{
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
  Animated,
  Easing,
  FlatList,
  Image,
  ScrollView,
  Alert,
  Linking,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBottomTabBarHeight } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { decode } from 'html-entities';
import { COLORS as THEME_COLORS } from '../theme/colors';
import { supabase, XP_VALUES, type UserTier } from '../lib/supabase';
import { useGamification } from '../context/GamificationContext';
import { getCurrentUserTierOrFree } from '../lib/membership';
import { UpgradeModal } from '../../components/UpgradeModal';
import { useAppRefresh } from '../context/AppRefreshContext';
import { reportContent, ReportReason } from '../utils/reportContent';
import { blockUser } from '../utils/blockUser';
import { validateMultipleSafeTexts, validateSafeText } from '../utils/moderation';
import ReportContentModal from '../../components/ReportContentModal';
import { useAppTheme } from '../context/ThemeContext';
import { isMobileWebViewport } from '../utils/responsive';
import SmoothModal from '../../components/SmoothModal';
import { getFlag, parseCityQuery, searchCities } from '../lib/citySearch';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});
const WEB_NO_OUTLINE =
  Platform.OS === 'web'
    ? ({ outlineStyle: 'none', outlineWidth: 0 } as any)
    : null;

const logJobsIssue = (label: string, error?: unknown) => {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;

  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error
        ? String((error as { message?: unknown }).message)
        : error;

  console.log(label, message);
};



/* ────────────────────────────────────────────────────────────
   Cinematic noir base (gold accents, fewer cards)
   ──────────────────────────────────────────────────────────── */
const GOLD = '#C6A664';
const GOLD_SOFT = 'rgba(198,166,100,0.16)';
const GOLD_LINE = 'rgba(198,166,100,0.28)';
const CREATOR_CHALLENGE_MAX_DAYS = 10;
const CREATOR_CHALLENGE_MAX_MS = CREATOR_CHALLENGE_MAX_DAYS * 24 * 60 * 60 * 1000;
const CREATOR_CHALLENGE_VISIBILITY_GRACE_MS = 48 * 60 * 60 * 1000;

const CHALLENGE_CATEGORY_OPTIONS = [
  'Acting',
  'Directing',
  'Writing',
  'Cinematography',
  'Editing',
  'Sound',
  'Production Design',
  'Music',
  'VFX',
  'Animation',
  'Documentary',
  'Drama',
  'Comedy',
  'Horror',
  'Thriller',
  'Experimental',
  'No-Dialogue',
  'Monologue',
] as const;

const REACTION_PLATFORM_OPTIONS = ['Instagram', 'TikTok', 'YouTube'] as const;

const T = {
  bg: '#050505',
  surface: '#0D0D0F',
  surface2: '#111114',
  surface3: '#16161A',
  text: '#F4EFE6',
  sub: '#D8D2C8',
  mute: '#9F927F',
  accent: GOLD,
  line: 'rgba(255,255,255,0.10)',
  lineSoft: 'rgba(255,255,255,0.07)',
  glow: 'rgba(198,166,100,0.08)',
};

const FONT_CINEMATIC = SYSTEM_SANS;

const FONT_CATEGORY =
  Platform.select({
    ios: 'Avenir Next',
    android: 'sans-serif-light',
    default: 'Avenir Next',
  }) || 'Avenir Next';

const COLORS = {
  ...THEME_COLORS,
  background: T.bg,
  card: T.surface,
  textPrimary: T.text,
  textSecondary: T.sub,
  primary: T.accent,
  textOnPrimary: '#050505',
  border: 'rgba(255,255,255,0.10)',
  borderSoft: 'rgba(255,255,255,0.07)',
};

/**
 * Smaller, platform-aware header padding.
 */
const HEADER_GAP = Platform.OS === 'web' ? 12 : 8;

/* -------------------------------------------
   Types
-------------------------------------------- */
type CityOption = { label: string; value: number; country: string };
type RoleOption = { label: string; value: number };
type ToastType = 'success' | 'info' | 'error';

type JobRow = {
  id: number;
  role_id: number | null;
  description: string | null;
  city_id: number | null;
  type: 'Paid' | 'Free';
  currency: string | null;
  rate: string | null;
  amount: string | null;
  time: string | null;
  user_id: string;
  created_at: string;
  is_closed: boolean;
  remote: boolean;
  is_removed?: boolean | null;
  removed_reason?: string | null;
  users?: { id: string; full_name?: string | null } | null;
  cities?: { name?: string | null; country_code?: string | null } | null;
  creative_roles?: { name?: string | null } | null;
};

type Applicant = {
  id: string;
  full_name?: string | null;
};

type MyJob = JobRow & {
  applicants: Applicant[];
};

type CreatorProfile = {
  id: string;
  full_name?: string | null;
  avatar_url?: string | null;
  is_creator?: boolean | null;
  creator_code?: string | null;
  creator_social_platform?: string | null;
  creator_social_url?: string | null;
};

type CreatorChallengeRow = {
  id: string;
  creator_id: string;
  title: string;
  challenge_code: string;
  category?: string | null;
  description?: string | null;
  rules?: string | null;
  required_phrase?: string | null;
  submission_type?: string | null;
  prize_description?: string | null;
  reaction_platform?: string | null;
  reaction_url?: string | null;
  reaction_description?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  status?: 'draft' | 'active' | 'ended' | 'archived' | string | null;
  submission_count?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  users?: CreatorProfile | CreatorProfile[] | null;
};

type ChallengeFormState = {
  title: string;
  category: string;
  description: string;
  rules: string;
  required_phrase: string;
  prize_description: string;
  reaction_platform: string;
  reaction_url: string;
  reaction_description: string;
  ends_at: string;
};

type UpgradeContext =
  | 'challenge'
  | 'jobs'
  | 'workshop'
  | 'extra_submission'
  | undefined;

const getCreatorProfile = (challenge: CreatorChallengeRow): CreatorProfile | null => {
  const maybe = challenge.users;
  if (!maybe) return null;
  return Array.isArray(maybe) ? maybe[0] ?? null : maybe;
};

const initialsForName = (name?: string | null) => {
  const clean = (name || '').trim();
  if (!clean) return 'OC';
  const parts = clean.split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() || '').join('') || 'OC';
};

const makeDefaultDeadlineInput = () => {
  const date = new Date();
  date.setDate(date.getDate() + CREATOR_CHALLENGE_MAX_DAYS);
  return formatLocalDateTimeInput(date);
};

const padDatePart = (n: number) => String(n).padStart(2, '0');

function formatLocalDateTimeInput(date: Date) {
  return `${date.getFullYear()}-${padDatePart(date.getMonth() + 1)}-${padDatePart(date.getDate())}T${padDatePart(date.getHours())}:${padDatePart(date.getMinutes())}`;
}

function parseLocalDeadlineDate(value: string) {
  const raw = value.trim();
  if (!raw) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T23:59:00` : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function clampChallengeDeadlineDate(date: Date, now = new Date()) {
  const min = new Date(now.getTime() + 5 * 60 * 1000);
  const max = new Date(now.getTime() + CREATOR_CHALLENGE_MAX_MS);
  if (date.getTime() < min.getTime()) return min;
  if (date.getTime() > max.getTime()) return max;
  return date;
}

function buildCalendarMonthDays(monthDate: Date) {
  const year = monthDate.getFullYear();
  const month = monthDate.getMonth();
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: Array<Date | null> = [];

  for (let i = 0; i < first.getDay(); i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(new Date(year, month, day));
  }
  while (cells.length % 7 !== 0) cells.push(null);

  return cells;
}

function isSameCalendarDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatDeadlineInputLabel(value: string) {
  const parsed = parseLocalDeadlineDate(value);
  if (!parsed) return 'Select deadline';
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(parsed);
}

function parseDelimitedList(value?: string | null) {
  return String(value || '')
    .split(/[,\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseReactionLinks(value?: string | null) {
  return parseDelimitedList(value);
}

function toggleDelimitedValue(value: string, item: string) {
  const current = parseDelimitedList(value);
  const exists = current.some((entry) => entry.toLowerCase() === item.toLowerCase());
  const next = exists
    ? current.filter((entry) => entry.toLowerCase() !== item.toLowerCase())
    : [...current, item];
  return next.join(', ');
}

const buildChallengeCode = (title: string, creatorCode?: string | null) => {
  const slug = title
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 28);
  const prefix =
    creatorCode
      ?.trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 10) || 'OC';
  return `${prefix}-${slug || 'CHALLENGE'}-${Date.now().toString(36).toUpperCase()}`;
};

const parseChallengeDeadline = (value: string) => {
  return parseLocalDeadlineDate(value)?.toISOString() ?? null;
};

const isChallengeEnded = (challenge: CreatorChallengeRow) => {
  if (challenge.status === 'ended' || challenge.status === 'archived') return true;
  if (!challenge.ends_at) return false;
  return new Date(challenge.ends_at).getTime() <= Date.now();
};

const isCreatorChallengeExpiredForListing = (
  challenge: CreatorChallengeRow,
  nowMs = Date.now()
) => {
  const endsAtMs = challenge.ends_at ? new Date(challenge.ends_at).getTime() : NaN;
  if (
    Number.isFinite(endsAtMs) &&
    endsAtMs + CREATOR_CHALLENGE_VISIBILITY_GRACE_MS <= nowMs
  ) {
    return true;
  }

  const createdAtMs = challenge.created_at ? new Date(challenge.created_at).getTime() : NaN;
  if (
    Number.isFinite(createdAtMs) &&
    createdAtMs + CREATOR_CHALLENGE_MAX_MS + CREATOR_CHALLENGE_VISIBILITY_GRACE_MS <= nowMs
  ) {
    return true;
  }

  return false;
};

const formatChallengeCountdown = (endsAt?: string | null) => {
  if (!endsAt) return 'No deadline';
  const diff = new Date(endsAt).getTime() - Date.now();
  if (diff <= 0) return 'Ended';
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h left`;
  if (hours > 0) return `${hours}h ${minutes % 60}m left`;
  return `${Math.max(1, minutes)}m left`;
};

const formatChallengeCountdownCompact = (endsAt?: string | null) =>
  formatChallengeCountdown(endsAt).replace(/\s+left$/i, '');

const formatChallengeDeadline = (endsAt?: string | null) => {
  if (!endsAt) return 'Open deadline';
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(endsAt));
  } catch {
    return endsAt;
  }
};

const formatChallengeRewardPill = (value?: string | null) => {
  const text = (value || '').trim();
  if (!text) return 'Reward TBA';
  if (/top\s*10|10\s+submissions/i.test(text)) return 'Top 10 reacted';
  return text;
};

const formatChallengeEntriesLabel = (count?: number | null) => {
  const total = count ?? 0;
  if (total <= 0) return 'Be first to enter';
  return `${total} ${total === 1 ? 'entry' : 'entries'}`;
};

const formatReactionPill = (platform?: string | null) => {
  const clean = (platform || 'Creator').trim();
  return clean;
};

const createEmptyChallengeForm = (): ChallengeFormState => ({
  title: '',
  category: '',
  description: '',
  rules: '',
  required_phrase: '',
  prize_description: '',
  reaction_platform: 'Instagram',
  reaction_url: '',
  reaction_description: '',
  ends_at: makeDefaultDeadlineInput(),
});

/* -------------------------------------------
   Toast (neutral)
-------------------------------------------- */
const useToast = () => {
  const [toast, setToast] = useState<{ visible: boolean; message: string; type: ToastType }>({
    visible: false,
    message: '',
    type: 'info',
  });
  const anim = useRef(new Animated.Value(0)).current;
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (message: string, type: ToastType = 'info', duration = 2000) => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    setToast({ visible: true, message, type });
    Animated.timing(anim, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();

    hideTimer.current = setTimeout(() => {
      Animated.timing(anim, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }).start(() => setToast((t) => ({ ...t, visible: false })));
    }, duration);
  };

  const ToastView = () => {
    if (!toast.visible) return null;

    const translateY = anim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] });
    const bg =
      toast.type === 'success' ? '#132317' : toast.type === 'error' ? '#2A1416' : '#151515';
    const border =
      toast.type === 'success' ? '#244A31' : toast.type === 'error' ? '#4A272B' : COLORS.borderSoft;

    const iconName =
      toast.type === 'success'
        ? 'checkmark-circle-outline'
        : toast.type === 'error'
        ? 'alert-circle-outline'
        : 'information-circle-outline';

    return (
      <Animated.View pointerEvents="none" style={[styles.toastContainer, { transform: [{ translateY }] }]}>
        <View style={[styles.toastInner, { backgroundColor: bg, borderColor: border }]}>
          <Ionicons name={iconName as any} size={18} color={T.text} style={{ marginRight: 8 }} />
          <Text style={styles.toastText}>{toast.message}</Text>
        </View>
      </Animated.View>
    );
  };

  return { show, ToastView };
};

/* -------------------------------------------
   Small UI
-------------------------------------------- */
const CustomToggle: React.FC<{
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  size?: 'md' | 'sm';
}> = ({ value, onChange, disabled, size = 'md' }) => {
  const { colors, isLight } = useAppTheme();
  const width = size === 'sm' ? 44 : 52;
  const height = size === 'sm' ? 24 : 28;
  const padding = 2;
  const knobSize = height - padding * 2;
  const travel = width - knobSize - padding * 2;

  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: value ? 1 : 0,
      duration: 160,
      easing: Easing.out(Easing.quad),
      useNativeDriver: false,
    }).start();
  }, [value]);

  const translateX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, travel] });
  const bg = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [
      isLight ? colors.backgroundAlt : '#171717',
      isLight ? 'rgba(198,166,100,0.28)' : '#1E1E1E',
    ],
  });
  const border = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [
      isLight ? colors.border : '#232323',
      isLight ? colors.borderStrong : '#2B2B2B',
    ],
  });

  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={() => !disabled && onChange(!value)}
      style={{ opacity: disabled ? 0.5 : 1 }}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled }}
    >
      <Animated.View
        style={{
          width,
          height,
          borderRadius: 6,
          padding,
          backgroundColor: bg as any,
          borderWidth: 1,
          borderColor: border as any,
          justifyContent: 'center',
        }}
      >
        <Animated.View
          style={{
            width: knobSize,
            height: knobSize,
            borderRadius: 4,
            transform: [{ translateX }],
            backgroundColor: value ? colors.primary : colors.card,
            borderWidth: 1,
            borderColor: value ? colors.borderStrong : colors.border,
          }}
        />
      </Animated.View>
    </TouchableOpacity>
  );
};

function formatTimeAgo(iso?: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = Math.max(0, now - then);

  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return 'just now';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.floor(day / 7);
  if (wk < 4) return `${wk}w ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr}y ago`;
}

const IconText: React.FC<{
  name: keyof typeof Ionicons.glyphMap;
  text: string;
  weight?: '400' | '600';
  accent?: boolean;
}> = ({ name, text, weight = '400', accent = false }) => {
  const { colors } = useAppTheme();
  const color = accent ? colors.primary : colors.textSecondary;

  return (
    <View style={styles.iconText}>
      <Ionicons name={name} size={15} color={color} style={{ marginRight: 6 }} />
      <Text style={[styles.jobMeta, { fontWeight: weight, color }]}>{text}</Text>
    </View>
  );
};

/* -------------------------------------------
   Screen
-------------------------------------------- */
export default function JobsScreen() {
  const { colors, isLight } = useAppTheme();
  const navigation = useNavigation();
  const { show, ToastView } = useToast();
  const { width } = useWindowDimensions();
  const tabBarHeight = useBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  const isWebMobile = isMobileWebViewport(width);
  const nativeLikeModalAnimation = Platform.OS === 'web' && !isWebMobile ? 'none' : 'slide';
  const { triggerAppRefresh } = useAppRefresh();
  const GOLD = colors.primary;
  const GOLD_SOFT = isLight ? 'rgba(168,121,34,0.07)' : 'rgba(198,166,100,0.16)';
  const GOLD_LINE = isLight ? 'rgba(168,121,34,0.18)' : 'rgba(198,166,100,0.28)';
  const T = useMemo(
    () => ({
      bg: colors.background,
      surface: colors.card,
      surface2: colors.mutedCard,
      surface3: colors.cardAlt,
      text: colors.textPrimary,
      sub: colors.textSecondary,
      mute: colors.textMuted,
      accent: colors.primary,
      line: colors.border,
      lineSoft: colors.border,
      glow: isLight ? 'rgba(168,121,34,0.05)' : 'rgba(198,166,100,0.08)',
    }),
    [colors, isLight]
  );
  const challengeTone = useMemo(
    () => ({
      bg: isLight ? '#FFFFFF' : '#050505',
      surface: isLight ? '#FFFFFF' : '#111113',
      surfaceAlt: isLight ? '#F7F7F7' : '#17171B',
      border: isLight ? '#E5E5E5' : 'rgba(214,174,96,0.22)',
      text: isLight ? '#111111' : '#F5F1E8',
      sub: isLight ? '#3F3F3F' : '#B8B1A5',
      gold: isLight ? '#CBA252' : '#D0AA5B',
      goldSoft: isLight ? 'rgba(168,121,34,0.07)' : 'rgba(208,170,91,0.14)',
      danger: isLight ? '#D8505E' : '#FF7676',
      shadow: isLight ? 'rgba(0,0,0,0.12)' : '#000',
    }),
    [isLight]
  );
  const READABLE_INK = isLight ? '#050505' : T.text;
  const READABLE_MUTED = isLight ? '#555555' : T.mute;
  const COLORS = useMemo(
    () => ({
      ...THEME_COLORS,
      background: colors.background,
      card: colors.card,
      textPrimary: colors.textPrimary,
      textSecondary: colors.textSecondary,
      primary: colors.primary,
      textOnPrimary: colors.textOnPrimary,
      border: colors.border,
      borderSoft: colors.border,
    }),
    [colors]
  );

  const promptSignIn = (message: string) => {
  if (Platform.OS === 'web') {
    const goToSignIn = window.confirm(
      `${message}\n\nPress OK for Sign In, or Cancel for Create Account.`
    );

    if (goToSignIn) {
      // @ts-ignore
      navigation.navigate('Auth', { screen: 'SignIn' });
    } else {
      // @ts-ignore
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
        onPress: () => {
          // @ts-ignore
          navigation.navigate('Auth', { screen: 'SignIn' });
        },
      },
      {
        text: 'Create Account',
        onPress: () => {
          // @ts-ignore
          navigation.navigate('Auth', { screen: 'SignUp' });
        },
      },
    ]
  );
};


  // Shared gamification context (from GamificationProvider / TopBar)
  const {
    loading: gamifyLoading,
    xp,
    level,
    levelTitle,
    bannerColor,
    refresh: refreshGamification,
  } = useGamification();

  const [opportunityTab, setOpportunityTab] = useState<'creator_challenges' | 'jobs'>('creator_challenges');
  const [challengeView, setChallengeView] = useState<'browse' | 'my'>('browse');
  const [creatorProfile, setCreatorProfile] = useState<CreatorProfile | null>(null);
  const [creatorChallenges, setCreatorChallenges] = useState<CreatorChallengeRow[]>([]);
  const [challengeLoading, setChallengeLoading] = useState<boolean>(true);
  const [challengeRefreshing, setChallengeRefreshing] = useState<boolean>(false);
  const [selectedChallenge, setSelectedChallenge] = useState<CreatorChallengeRow | null>(null);
  const [challengeFormVisible, setChallengeFormVisible] = useState<boolean>(false);
  const [challengeSubmitting, setChallengeSubmitting] = useState<boolean>(false);
  const [challengeDeleting, setChallengeDeleting] = useState<Record<string, boolean>>({});
  const [challengeForm, setChallengeForm] = useState<ChallengeFormState>(() =>
    createEmptyChallengeForm()
  );
  const [challengeCategoryPickerVisible, setChallengeCategoryPickerVisible] =
    useState<boolean>(false);
  const [deadlinePickerVisible, setDeadlinePickerVisible] = useState<boolean>(false);
  const [deadlinePickerMonth, setDeadlinePickerMonth] = useState<Date>(() => new Date());

  const selectedDeadlineDate = useMemo(() => {
    const parsed = parseLocalDeadlineDate(challengeForm.ends_at);
    return clampChallengeDeadlineDate(
      parsed || new Date(Date.now() + CREATOR_CHALLENGE_MAX_MS)
    );
  }, [challengeForm.ends_at]);

  const deadlineCalendarDays = useMemo(
    () => buildCalendarMonthDays(deadlinePickerMonth),
    [deadlinePickerMonth]
  );

  const deadlineMonthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(undefined, {
        month: 'long',
        year: 'numeric',
      }).format(deadlinePickerMonth),
    [deadlinePickerMonth]
  );

  const selectedReactionPlatforms = useMemo(
    () => parseDelimitedList(challengeForm.reaction_platform),
    [challengeForm.reaction_platform]
  );

  const setChallengeDeadlineDate = useCallback((date: Date) => {
    const clamped = clampChallengeDeadlineDate(date);
    setChallengeForm((prev) => ({ ...prev, ends_at: formatLocalDateTimeInput(clamped) }));
    setDeadlinePickerMonth(new Date(clamped.getFullYear(), clamped.getMonth(), 1));
  }, []);

  const openDeadlinePicker = useCallback(() => {
    Keyboard.dismiss();
    const parsed = parseLocalDeadlineDate(challengeForm.ends_at);
    const selected = clampChallengeDeadlineDate(
      parsed || new Date(Date.now() + CREATOR_CHALLENGE_MAX_MS)
    );
    setDeadlinePickerMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
    setDeadlinePickerVisible(true);
  }, [challengeForm.ends_at]);

  const selectChallengeDeadlineDay = useCallback(
    (day: Date) => {
      const current = parseLocalDeadlineDate(challengeForm.ends_at) || selectedDeadlineDate;
      const next = new Date(day);
      next.setHours(current.getHours(), current.getMinutes(), 0, 0);
      setChallengeDeadlineDate(next);
    },
    [challengeForm.ends_at, selectedDeadlineDate, setChallengeDeadlineDate]
  );

  const adjustChallengeDeadlineMinutes = useCallback(
    (deltaMinutes: number) => {
      const current = parseLocalDeadlineDate(challengeForm.ends_at) || selectedDeadlineDate;
      setChallengeDeadlineDate(new Date(current.getTime() + deltaMinutes * 60 * 1000));
    },
    [challengeForm.ends_at, selectedDeadlineDate, setChallengeDeadlineDate]
  );

  const setChallengeDeadlineTime = useCallback(
    (hour: number, minute: number) => {
      const current = parseLocalDeadlineDate(challengeForm.ends_at) || selectedDeadlineDate;
      const next = new Date(current);
      next.setHours(hour, minute, 0, 0);
      setChallengeDeadlineDate(next);
    },
    [challengeForm.ends_at, selectedDeadlineDate, setChallengeDeadlineDate]
  );

  const [activeTab, setActiveTab] = useState<'paid' | 'free' | 'my'>('free');
  const [jobs, setJobs] = useState<JobRow[]>([]);
  const [myJobs, setMyJobs] = useState<MyJob[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [blockedUserIds, setBlockedUserIds] = useState<Set<string>>(new Set());
  const [isLoadingInit, setIsLoadingInit] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [loadingMyJobs, setLoadingMyJobs] = useState<boolean>(false);

  const [roles, setRoles] = useState<{ id: number; name: string }[]>([]);

  // Posting
  const [jobFormVisible, setJobFormVisible] = useState<boolean>(false);
  const [jobCityOverlayVisible, setJobCityOverlayVisible] = useState<boolean>(false);
  const [jobRoleOverlayVisible, setJobRoleOverlayVisible] = useState<boolean>(false);
  const [currencyOverlayVisible, setCurrencyOverlayVisible] = useState<boolean>(false);
  const [rateOverlayVisible, setRateOverlayVisible] = useState<boolean>(false);

  const [roleSearchTerm, setRoleSearchTerm] = useState<string>('');
  const [roleItems, setRoleItems] = useState<RoleOption[]>([]);
  const roleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roleReqIdRef = useRef<number>(0);

  const [citySearchTerm, setCitySearchTerm] = useState<string>('');
  const [cityItems, setCityItems] = useState<CityOption[]>([]);
  const [searchingCities, setSearchingCities] = useState<boolean>(false);
  const citySearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [formData, setFormData] = useState<{
    role_id: number | null;
    description: string;
    city: CityOption | null;
    type: 'Paid' | 'Free';
    currency: string;
    rate: string;
    amount: string;
    time: string;
    remote: boolean;
  }>({
    role_id: null,
    description: '',
    city: null,
    type: 'Paid',
    currency: '£',
    rate: 'Flat Rate',
    amount: '',
    time: '',
    remote: false,
  });

  const [selectedJob, setSelectedJob] = useState<JobRow | null>(null);
  const [reportTargetJob, setReportTargetJob] = useState<JobRow | null>(null);
  const [reportReason, setReportReason] = useState<ReportReason>('Harassment or bullying');
  const [reportDetails, setReportDetails] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);

  // Apply state
  const [applyLoading, setApplyLoading] = useState<boolean>(false);
  const [alreadyApplied, setAlreadyApplied] = useState<boolean>(false);
  const [checkingApplied, setCheckingApplied] = useState<boolean>(false);
  const [confirmVisible, setConfirmVisible] = useState<boolean>(false);

  // Filters
  const [filterCity, setFilterCity] = useState<CityOption | null>(null);
  const [filterRole, setFilterRole] = useState<RoleOption | null>(null);
  const [includeRemote, setIncludeRemote] = useState<boolean>(true);

  const [cityFilterModalVisible, setCityFilterModalVisible] = useState<boolean>(false);
  const [cityFilterSearchTerm, setCityFilterSearchTerm] = useState<string>('');
  const [cityFilterItems, setCityFilterItems] = useState<CityOption[]>([]);
  const [searchingFilterCities, setSearchingFilterCities] = useState<boolean>(false);

  const [roleFilterModalVisible, setRoleFilterModalVisible] = useState<boolean>(false);
  const [roleFilterSearchTerm, setRoleFilterSearchTerm] = useState<string>('');
  const [roleFilterItems, setRoleFilterItems] = useState<RoleOption[]>([]);
  const [searchingFilterRoles, setSearchingFilterRoles] = useState<boolean>(false);

  // Debounce / throttles
  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const realtimeThrottleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const citySearchInputRef = useRef<TextInput | null>(null);

  const cityReqIdRef = useRef<number>(0);
const latestCityTermRef = useRef<string>('');
const cityFilterReqIdRef = useRef<number>(0);
const latestCityFilterTermRef = useRef<string>('');
const cityFilterSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const openJobCityOverlay = useCallback(() => {
    Keyboard.dismiss();
    setCityItems([]);
    setCitySearchTerm('');
    setJobCityOverlayVisible(true);
    requestAnimationFrame(() => {
      citySearchInputRef.current?.focus();
    });
  }, []);

  // Tier / upgrade modal
  const [userTier, setUserTier] = useState<UserTier>('free');
  const [upgradeVisible, setUpgradeVisible] = useState(false);
  const [upgradeContext, setUpgradeContext] = useState<UpgradeContext>('jobs');

  // Currency/Rate data
  const currencyItems = useMemo(
    () => ['£', '$', '€', 'A$', 'C$', '¥', '₹', '₩', '₦', '₺', 'R$'],
    []
  );
  const rateItems = useMemo(
    () => ['Flat Rate', 'Per Hour', 'Per Day', 'Per Week', 'Per Month'],
    []
  );

  const fetchBlockedUsers = useCallback(async (uid?: string | null) => {
    if (!uid) {
      setBlockedUserIds(new Set());
      return new Set<string>();
    }

    try {
      const { data, error } = await supabase
        .from('user_blocks')
        .select('blocked_id')
        .eq('blocker_id', uid);

      if (error) {
        if (typeof __DEV__ !== 'undefined' && __DEV__) {
          console.log('fetchBlockedUsers unavailable', error.message);
        }
        setBlockedUserIds(new Set());
        return new Set<string>();
      }

      const ids = new Set<string>((data || []).map((row: any) => row.blocked_id).filter(Boolean));
      setBlockedUserIds(ids);
      return ids;
    } catch (error) {
      const message = error instanceof Error ? error.message : error;
      if (typeof __DEV__ !== 'undefined' && __DEV__) {
        console.log('fetchBlockedUsers unavailable', message);
      }
      setBlockedUserIds(new Set());
      return new Set<string>();
    }
  }, []);

  const fetchCreatorProfile = useCallback(async (uid?: string | null) => {
    if (!uid) {
      setCreatorProfile(null);
      return null;
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, full_name, avatar_url, is_creator, creator_code, creator_social_platform, creator_social_url')
      .eq('id', uid)
      .maybeSingle();

    if (error) {
      logJobsIssue('fetchCreatorProfile unavailable', error);
      setCreatorProfile(null);
      return null;
    }

    const profile = (data as CreatorProfile | null) ?? null;
    setCreatorProfile(profile);
    return profile;
  }, []);

  const sortCreatorChallenges = useCallback((rows: CreatorChallengeRow[]) => {
    return [...rows].sort((a, b) => {
      const aEnded = isChallengeEnded(a);
      const bEnded = isChallengeEnded(b);
      if (aEnded !== bEnded) return aEnded ? 1 : -1;
      const aTime = a.ends_at ? new Date(a.ends_at).getTime() : Number.MAX_SAFE_INTEGER;
      const bTime = b.ends_at ? new Date(b.ends_at).getTime() : Number.MAX_SAFE_INTEGER;
      return aTime - bTime;
    });
  }, []);

  const hydrateCreatorChallengeCounts = useCallback(async (rows: CreatorChallengeRow[]) => {
    const challengeIds = rows.map((row) => row.id).filter(Boolean);
    if (!challengeIds.length) return rows;

    const challengeIdSet = new Set(challengeIds);
    const codeToChallengeId = new Map(
      rows
        .map((row) => [row.challenge_code, row.id] as const)
        .filter(([code]) => Boolean(code))
    );
    const submissionIdsByChallenge = new Map<string, Set<string>>(
      challengeIds.map((id) => [id, new Set<string>()])
    );

    const addSubmission = (challengeId: string | null | undefined, submissionId: string | null | undefined) => {
      if (!challengeId || !submissionId || !challengeIdSet.has(challengeId)) return;
      const bucket = submissionIdsByChallenge.get(challengeId) ?? new Set<string>();
      bucket.add(submissionId);
      submissionIdsByChallenge.set(challengeId, bucket);
    };

    let hadLiveCount = false;

    try {
      const { data, error } = await supabase
        .from('submissions')
        .select('id, creator_challenge_id')
        .in('creator_challenge_id', challengeIds)
        .eq('category', 'film')
        .or('is_removed.eq.false,is_removed.is.null');

      if (error) {
        logJobsIssue('creator challenge count by id unavailable', error);
      } else {
        hadLiveCount = true;
        ((data || []) as any[]).forEach((row) => {
          addSubmission(row.creator_challenge_id, row.id);
        });
      }
    } catch (e) {
      logJobsIssue('creator challenge count by id threw', e);
    }

    const challengeCodes = Array.from(codeToChallengeId.keys());
    if (challengeCodes.length > 0) {
      try {
        const { data, error } = await supabase
          .from('submissions')
          .select('id, challenge_code')
          .in('challenge_code', challengeCodes)
          .eq('category', 'film')
          .or('is_removed.eq.false,is_removed.is.null');

        if (error) {
          logJobsIssue('creator challenge count by code unavailable', error);
        } else {
          hadLiveCount = true;
          ((data || []) as any[]).forEach((row) => {
            addSubmission(codeToChallengeId.get(row.challenge_code), row.id);
          });
        }
      } catch (e) {
        logJobsIssue('creator challenge count by code threw', e);
      }
    }

    if (!hadLiveCount) return rows;

    return rows.map((row) => ({
      ...row,
      submission_count: submissionIdsByChallenge.get(row.id)?.size ?? 0,
    }));
  }, []);

  const fetchCreatorChallenges = useCallback(
    async (mode: 'init' | 'refresh' | 'silent' = 'silent') => {
      if (mode === 'init') setChallengeLoading(true);
      if (mode === 'refresh') setChallengeRefreshing(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id ?? currentUserId;
      if (uid && uid !== currentUserId) setCurrentUserId(uid);

      try {
        const { error: cleanupError } = await supabase.rpc('delete_expired_creator_challenges');
        if (cleanupError) logJobsIssue('delete_expired_creator_challenges unavailable', cleanupError);
      } catch (cleanupErr) {
        logJobsIssue('delete_expired_creator_challenges threw', cleanupErr);
      }

      let query = supabase
        .from('creator_challenges')
        .select(
          'id, creator_id, title, challenge_code, category, description, rules, required_phrase, submission_type, prize_description, reaction_platform, reaction_url, reaction_description, starts_at, ends_at, status, submission_count, created_at, updated_at, users:creator_id(id, full_name, avatar_url, creator_social_platform, creator_social_url)'
        )
        .order('created_at', { ascending: false });

      if (challengeView === 'my') {
        if (!uid) {
          setCreatorChallenges([]);
          setChallengeLoading(false);
          setChallengeRefreshing(false);
          return;
        }
        query = query.eq('creator_id', uid).neq('status', 'archived');
      } else {
        query = query.in('status', ['active', 'ended']);
      }

      const { data, error } = await query;

      if (error) {
        logJobsIssue('fetchCreatorChallenges unavailable', error);
        setCreatorChallenges([]);
      } else {
        const visibleRows = ((data as CreatorChallengeRow[]) || []).filter(
          (row) => !isCreatorChallengeExpiredForListing(row)
        );
        const countedRows = await hydrateCreatorChallengeCounts(visibleRows);
        const sortedRows = sortCreatorChallenges(countedRows);
        setCreatorChallenges(sortedRows);
        setSelectedChallenge((prev) =>
          prev ? sortedRows.find((row) => row.id === prev.id) ?? null : prev
        );
      }

      if (mode === 'init') setChallengeLoading(false);
      if (mode === 'refresh') setChallengeRefreshing(false);
    },
    [
      challengeView,
      currentUserId,
      hydrateCreatorChallengeCounts,
      sortCreatorChallenges,
    ]
  );

  useFocusEffect(
    useCallback(() => {
      void fetchCreatorChallenges('silent');
    }, [fetchCreatorChallenges])
  );

  /* ---------- Navigation header ---------- */
  useLayoutEffect(() => {
    // @ts-ignore
    navigation.setOptions({
      title: 'Opportunities',
      headerTitleAlign: 'center',
      headerTitleStyle: {
        fontFamily: FONT_CINEMATIC,
        fontWeight: Platform.OS === 'web' ? ('700' as any) : '700',
        letterSpacing: 0.2,
        fontSize: 16,
        color: T.text,
      },
      headerRight: () => (
        <TouchableOpacity
          style={{ marginRight: 16 }}
          onPress={() => show('Settings coming soon', 'info')}
        >
          <Ionicons name="settings-outline" size={22} color={T.text} />
        </TouchableOpacity>
      ),
      headerStyle: { backgroundColor: T.bg },
headerShadowVisible: false,
headerTintColor: T.text,
contentStyle: { backgroundColor: T.bg },
    });
  }, [navigation, show, T]);

  /* ---------- Initial loads ---------- */
  useEffect(() => {
    void fetchRoles();
    supabase.auth.getUser().then(({ data }) => {
      const uid = data.user?.id ?? null;
      setCurrentUserId(uid);
      void fetchBlockedUsers(uid);
      void fetchCreatorProfile(uid);
    });
    void fetchCreatorChallenges('init');
  }, []);

  // Load current user tier
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const tier = await getCurrentUserTierOrFree();
        if (!mounted) return;
        setUserTier(tier);
      } catch (err) {
        console.log('JobsScreen tier fetch error', (err as any)?.message || err);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
  if (jobCityOverlayVisible) {
    const timer = setTimeout(() => {
      citySearchInputRef.current?.focus();
    }, 120);

    return () => clearTimeout(timer);
  }
}, [jobCityOverlayVisible]);

  const fetchRoles = async () => {
    const { data, error } = await supabase.from('creative_roles').select('id, name').order('name');
    if (error) {
      logJobsIssue('fetchRoles unavailable', error);
      show('Could not load roles', 'error');
    } else setRoles(data || []);
  };

  const fetchJobs = useCallback(
    async (mode: 'init' | 'refresh' | 'silent' = 'silent') => {
      // Only fetch global jobs for Paid/Free tabs
      if (activeTab === 'my') return;

      if (mode === 'init' && jobs.length === 0) setIsLoadingInit(true);
      if (mode === 'refresh') setIsRefreshing(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      const uid = user?.id ?? currentUserId;
      if (uid && uid !== currentUserId) setCurrentUserId(uid);
      const blockedIds = await fetchBlockedUsers(uid);

      let query = supabase
        .from('jobs')
        .select(`*, users(id, full_name), cities(name, country_code), creative_roles(name)`)
        .eq('type', activeTab === 'paid' ? 'Paid' : 'Free')
        .eq('is_closed', false)
        .eq('is_removed', false)
        .order('created_at', { ascending: false })
.order('created_at', { ascending: false });

      if (blockedIds.size > 0) {
        query = query.not('user_id', 'in', `(${Array.from(blockedIds).join(',')})`);
      }

      if (filterCity?.value) query = query.eq('city_id', filterCity.value);
      if (filterRole?.value) query = query.eq('role_id', filterRole.value);
      if (!includeRemote) query = query.eq('remote', false);

      const { data, error } = await query;

      if (error) {
        logJobsIssue('fetchJobs unavailable', error);
        setJobs([]);
        show('Could not fetch jobs', 'error');
      } else {
        setJobs(((data as JobRow[]) || []).filter((job) => !blockedIds.has(job.user_id)));
      }

      if (mode === 'init') setIsLoadingInit(false);
      if (mode === 'refresh') setIsRefreshing(false);
    },
    [activeTab, currentUserId, fetchBlockedUsers, filterCity?.value, filterRole?.value, includeRemote, jobs.length, show]
  );

  const fetchMyJobs = useCallback(async () => {
  try {
    setLoadingMyJobs(true);

    const {
      data: { user },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !user) {
      if (authErr) logJobsIssue('fetchMyJobs auth unavailable', authErr);
      setMyJobs([]);
      setLoadingMyJobs(false);
      return;
    }

    const { data: myJobsData, error: jobsErr } = await supabase
      .from('jobs')
      .select('*, users(id, full_name), cities(name, country_code), creative_roles(name)')
      .eq('user_id', user.id)
      .eq('is_closed', false)
      .order('created_at', { ascending: false });

    if (jobsErr) {
      logJobsIssue('fetchMyJobs jobs unavailable', jobsErr);
      show('Could not load your jobs.', 'error');
      setMyJobs([]);
      setLoadingMyJobs(false);
      return;
    }

    const baseJobs = (myJobsData || []) as JobRow[];

    if (!baseJobs.length) {
      setMyJobs([]);
      setLoadingMyJobs(false);
      return;
    }

    const jobIds = baseJobs.map((j) => j.id);

    const { data: appsData, error: appsErr } = await supabase
  .from('applications')
  .select('id, job_id, applicant_id')
  .in('job_id', jobIds);

if (appsErr) {
  logJobsIssue('fetchMyJobsWithApplicants applications unavailable', appsErr);
  return;
}

const applicantIds = [
  ...new Set((appsData || []).map((a: any) => a.applicant_id).filter(Boolean)),
];

let usersMap: Record<string, { id: string; full_name?: string | null }> = {};

if (applicantIds.length) {
  const { data: usersData, error: usersErr } = await supabase
    .from('users')
    .select('id, full_name')
    .in('id', applicantIds);

  if (usersErr) {
    logJobsIssue('fetchMyJobsWithApplicants users unavailable', usersErr);
  } else {
    usersMap = Object.fromEntries(
      (usersData || []).map((u: any) => [
        u.id,
        { id: u.id, full_name: u.full_name },
      ])
    );
  }
}

const appsByJob: Record<number, { id: string; full_name?: string | null }[]> = {};

(appsData || []).forEach((row: any) => {
  const jobId = row.job_id;
  const applicantId = row.applicant_id;

  if (!jobId || !applicantId || !usersMap[applicantId]) return;

  if (!appsByJob[jobId]) appsByJob[jobId] = [];
  appsByJob[jobId].push(usersMap[applicantId]);
});

    const withApplicants: MyJob[] = baseJobs.map((j) => ({
      ...j,
      applicants: appsByJob[j.id] || [],
    }));

    setMyJobs(withApplicants);
  } catch (e: any) {
    logJobsIssue('fetchMyJobs unavailable', e);
    show('Could not load your jobs.', 'error');
    setMyJobs([]);
  } finally {
    setLoadingMyJobs(false);
  }
}, [show]);

  // Close job (MY JOBS)
  const handleCloseJob = useCallback(
    async (jobId: number) => {
      try {
        const {
          data: { user },
          error: authErr,
        } = await supabase.auth.getUser();

        if (authErr || !user) {
          if (authErr) logJobsIssue('handleCloseJob auth unavailable', authErr);
          show('Please sign in to manage your jobs.', 'info');
          return;
        }

        const { error } = await supabase
          .from('jobs')
          .update({ is_closed: true })
          .eq('id', jobId)
          .eq('user_id', user.id);

        if (error) {
          logJobsIssue('handleCloseJob unavailable', error);
          show('Could not close job.', 'error');
          return;
        }

        // Remove from local MY JOBS list so it disappears immediately
        setMyJobs((prev) => prev.filter((j) => j.id !== jobId));

        show('Job closed. It will no longer appear to applicants.', 'success');
      } catch (e: any) {
        logJobsIssue('handleCloseJob unavailable', e);
        show('Could not close job.', 'error');
      }
    },
    [show]
  );

  // Initial job load
  useEffect(() => {
    void fetchJobs('init');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    void fetchCreatorChallenges(challengeLoading ? 'init' : 'silent');
  }, [challengeView, fetchCreatorChallenges]);

  // Debounced refetch when filters/tab change for global jobs
  useEffect(() => {
    if (activeTab === 'my') return;

    if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
    fetchDebounceRef.current = setTimeout(() => {
      void fetchJobs('silent');
    }, 160);
    return () => {
      if (fetchDebounceRef.current) {
        clearTimeout(fetchDebounceRef.current);
        fetchDebounceRef.current = null;
      }
    };
  }, [activeTab, filterCity?.value, filterRole?.value, includeRemote, fetchJobs]);

  // Fetch My Jobs when switching to My Jobs tab
  useEffect(() => {
    if (activeTab === 'my') {
      void fetchMyJobs();
    }
  }, [activeTab, fetchMyJobs]);

  // Realtime subscription (throttled) for global jobs
  useEffect(() => {
    const channel = supabase
      .channel('jobs-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => {
        if (realtimeThrottleRef.current) return;
        realtimeThrottleRef.current = setTimeout(() => {
          void fetchJobs('silent');
          if (realtimeThrottleRef.current) {
            clearTimeout(realtimeThrottleRef.current);
            realtimeThrottleRef.current = null;
          }
        }, 400);
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
      if (realtimeThrottleRef.current) {
        clearTimeout(realtimeThrottleRef.current);
        realtimeThrottleRef.current = null;
      }
    };
  }, [fetchJobs]);

  useEffect(() => {
    const channel = supabase
      .channel('creator-challenges-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'creator_challenges' }, () => {
        void fetchCreatorChallenges('silent');
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'submissions' }, (payload: any) => {
        const hasChallenge =
          payload?.new?.creator_challenge_id ||
          payload?.old?.creator_challenge_id ||
          payload?.new?.challenge_code ||
          payload?.old?.challenge_code ||
          payload?.new?.submission_source === 'creator_challenge';
        if (hasChallenge) {
          void fetchCreatorChallenges('silent');
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchCreatorChallenges]);

  /* ----------------------------- search helpers ----------------------------- */
  const searchRolesSmooth = useCallback(
    async (term: string) => {
      const q = term.trim();
      if (!q) {
        setRoleItems([]);
        return;
      }
      const myReq = ++roleReqIdRef.current;
      if (!jobRoleOverlayVisible) return;

      const { data, error } = await supabase
        .from('creative_roles')
        .select('id, name')
        .ilike('name', `%${q}%`)
        .order('name')
        .limit(50);

      if (roleReqIdRef.current !== myReq) return;

      if (error) {
        logJobsIssue('searchRoles unavailable', error);
        show('Role search failed', 'error');
        return;
      }
      let next = (data || []).map((r) => ({ value: r.id, label: r.name })) as RoleOption[];
      next = next.sort((a, b) => {
        const A = a.label.toLowerCase();
        const B = b.label.toLowerCase();
        const Q = q.toLowerCase();
        const score = (s: string) => (s === Q ? 0 : s.startsWith(Q) ? 1 : 2);
        const cmp = score(A) - score(B);
        return cmp !== 0 ? cmp : A.localeCompare(B);
      });
      setRoleItems(next);
    },
    [jobRoleOverlayVisible, show]
  );

  useEffect(() => {
    if (!jobRoleOverlayVisible) return;
    if (roleDebounceRef.current) clearTimeout(roleDebounceRef.current);
    roleDebounceRef.current = setTimeout(() => {
      void searchRolesSmooth(roleSearchTerm);
    }, 140);
    return () => {
      if (roleDebounceRef.current) clearTimeout(roleDebounceRef.current);
    };
  }, [roleSearchTerm, jobRoleOverlayVisible, searchRolesSmooth]);

  const fetchCities = useCallback(
  async (search: string) => {
    const raw = (search || '').trim();
    const { cityQuery } = parseCityQuery(raw);

    latestCityTermRef.current = raw;

    if (cityQuery.length < 2) {
      setCityItems([]);
      setSearchingCities(false);
      return;
    }

    const myReqId = ++cityReqIdRef.current;
    setSearchingCities(true);

    try {
      const { data: finalData, error: finalError } = await searchCities(raw, { limit: 120 });

      if (myReqId !== cityReqIdRef.current) return;
      if (latestCityTermRef.current !== raw) return;

      if (finalError) {
        logJobsIssue('searchCities unavailable', finalError);
        show('City search failed', 'error');
        setCityItems([]);
        return;
      }

      setCityItems(
        (finalData || []).map((c) => ({
          value: c.id,
          label: `${getFlag(c.country_code)} ${c.name}, ${c.country_code}`,
          country: c.country_code,
        }))
      );
    } finally {
      if (myReqId === cityReqIdRef.current && latestCityTermRef.current === raw) {
        setSearchingCities(false);
      }
    }
  },
  [show]
);
  const fetchFilterCities = useCallback(
  async (search: string) => {
    const raw = (search || '').trim();
    const { cityQuery } = parseCityQuery(raw);

    latestCityFilterTermRef.current = raw;

    if (cityQuery.length < 2) {
      setCityFilterItems([]);
      setSearchingFilterCities(false);
      return;
    }

    const myReqId = ++cityFilterReqIdRef.current;
    setSearchingFilterCities(true);

    try {
      const { data: finalData, error: finalError } = await searchCities(raw, { limit: 120 });

      if (myReqId !== cityFilterReqIdRef.current) return;
      if (latestCityFilterTermRef.current !== raw) return;

      if (finalError) {
        logJobsIssue('searchFilterCities unavailable', finalError);
        show('City search failed', 'error');
        setCityFilterItems([]);
        return;
      }

      setCityFilterItems(
        (finalData || []).map((c) => ({
          value: c.id,
          label: `${getFlag(c.country_code)} ${c.name}, ${c.country_code}`,
          country: c.country_code,
        }))
      );
    } finally {
      if (myReqId === cityFilterReqIdRef.current && latestCityFilterTermRef.current === raw) {
        setSearchingFilterCities(false);
      }
    }
  },
  [show]
);

  const scheduleCitySearch = useCallback(
    (text: string) => {
      if (citySearchDebounceRef.current) clearTimeout(citySearchDebounceRef.current);
      citySearchDebounceRef.current = setTimeout(() => {
        void fetchCities(text);
      }, 180);
    },
    [fetchCities]
  );

  const scheduleCityFilterSearch = useCallback(
    (text: string) => {
      if (cityFilterSearchDebounceRef.current) clearTimeout(cityFilterSearchDebounceRef.current);
      cityFilterSearchDebounceRef.current = setTimeout(() => {
        void fetchFilterCities(text);
      }, 180);
    },
    [fetchFilterCities]
  );

  useEffect(
    () => () => {
      if (citySearchDebounceRef.current) clearTimeout(citySearchDebounceRef.current);
      if (cityFilterSearchDebounceRef.current) clearTimeout(cityFilterSearchDebounceRef.current);
    },
    []
  );

  const fetchFilterRoles = useCallback(
    async (search: string) => {
      const q = search.trim();
      if (!q) {
        setRoleFilterItems([]);
        return;
      }
      setSearchingFilterRoles(true);
      const { data, error } = await supabase
        .from('creative_roles')
        .select('id, name')
        .ilike('name', `%${q}%`)
        .order('name')
        .limit(50);
      setSearchingFilterRoles(false);
      if (error) {
        logJobsIssue('searchFilterRoles unavailable', error);
        show('Role search failed', 'error');
      } else if (data) {
        let next = data.map((r) => ({ value: r.id, label: r.name })) as RoleOption[];
        next = next.sort((a, b) => {
          const A = a.label.toLowerCase();
          const B = b.label.toLowerCase();
          const score = (s: string) => (s === q ? 0 : s.startsWith(q) ? 1 : 2);
          const cmp = score(A) - score(B);
          return cmp !== 0 ? cmp : A.localeCompare(B);
        });
        setRoleFilterItems(next);
      }
    },
    [show]
  );

  /* -------------------------------- actions -------------------------------- */
  const handleSubmitToChallenge = async (challenge: CreatorChallengeRow) => {
    if (isChallengeEnded(challenge)) {
      show('This creator challenge has ended.', 'info');
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      promptSignIn('Create an account or sign in to submit to this challenge.');
      return;
    }

    setSelectedChallenge(null);
    // @ts-ignore
    navigation.navigate('WorkshopSubmit', {
      mode: 'monthly',
      creatorChallengeId: challenge.id,
      challengeCode: challenge.challenge_code,
      creatorId: challenge.creator_id,
      creatorChallengeTitle: challenge.title,
      creatorChallengeRequiredPhrase: challenge.required_phrase ?? null,
      creatorChallengeEndsAt: challenge.ends_at ?? null,
    });
  };

  const openChallengeSubmissions = (challenge: CreatorChallengeRow) => {
    setSelectedChallenge(null);
    // @ts-ignore
    navigation.navigate('Featured', {
      challengeId: challenge.id,
      challengeSearch: challenge.challenge_code,
      challengeTitle: challenge.title,
      challengeSearchNonce: Date.now(),
    });
  };

  const openPostChallengeComposer = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      promptSignIn('Create an account or sign in to post a creator challenge.');
      return;
    }

    const profile = creatorProfile ?? (await fetchCreatorProfile(user.id));
    if (!profile?.is_creator) {
      show('Only approved creators can post creator challenges.', 'info');
      return;
    }

    setChallengeForm(createEmptyChallengeForm());
    setChallengeCategoryPickerVisible(false);
    setDeadlinePickerVisible(false);
    setChallengeFormVisible(true);
  };

  const openReactionUrl = async (rawUrl?: string | null) => {
    const trimmed = rawUrl?.trim();
    if (!trimmed) return;
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;

    try {
      await Linking.openURL(url);
    } catch {
      show('Could not open that link.', 'error');
    }
  };

  const handlePostChallenge = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      promptSignIn('Create an account or sign in to post a creator challenge.');
      return;
    }

    const profile = creatorProfile ?? (await fetchCreatorProfile(user.id));
    if (!profile?.is_creator) {
      show('Only approved creators can post creator challenges.', 'info');
      return;
    }

    const title = challengeForm.title.trim();
    const category = challengeForm.category.trim();
    const description = challengeForm.description.trim();
    const prize = challengeForm.prize_description.trim();
    const endsAt = parseChallengeDeadline(challengeForm.ends_at);
    const reactionPlatforms = parseDelimitedList(challengeForm.reaction_platform);
    const reactionLinks = parseReactionLinks(challengeForm.reaction_url);

    if (!title || !category || !description || !prize || !endsAt) {
      show('Add a title, category, brief, reward, and valid deadline.', 'error');
      return;
    }

    if (new Date(endsAt).getTime() <= Date.now()) {
      show('Choose a future deadline.', 'error');
      return;
    }

    if (new Date(endsAt).getTime() > Date.now() + CREATOR_CHALLENGE_MAX_MS) {
      show(`Creator challenges can run for up to ${CREATOR_CHALLENGE_MAX_DAYS} days.`, 'error');
      return;
    }

    const moderation = validateMultipleSafeTexts([
      { label: 'Challenge title', value: title },
      { label: 'Description', value: description },
      { label: 'Rules', value: challengeForm.rules },
      { label: 'Required phrase', value: challengeForm.required_phrase },
      { label: 'Reward', value: prize },
      { label: 'Reaction links', value: challengeForm.reaction_url },
    ]);

    if (!moderation.safe) {
      Alert.alert('Content Not Allowed', moderation.message || 'Please edit the challenge before posting.');
      return;
    }

    setChallengeSubmitting(true);
    const challengeCode = buildChallengeCode(title, profile.creator_code);
    const { error } = await supabase.from('creator_challenges').insert({
      creator_id: user.id,
      title,
      challenge_code: challengeCode,
      category,
      description,
      rules: challengeForm.rules.trim() || null,
      required_phrase: challengeForm.required_phrase.trim() || null,
      submission_type: 'youtube',
      prize_description: prize,
      reaction_platform: reactionPlatforms.join(', ') || profile.creator_social_platform || null,
      reaction_url: reactionLinks.join('\n') || profile.creator_social_url || null,
      reaction_description: challengeForm.reaction_description.trim() || null,
      starts_at: new Date().toISOString(),
      ends_at: endsAt,
      status: 'active',
    });
    setChallengeSubmitting(false);

    if (error) {
      logJobsIssue('postCreatorChallenge unavailable', error);
      show('Could not post challenge.', 'error');
      return;
    }

    setChallengeFormVisible(false);
    setChallengeCategoryPickerVisible(false);
    setDeadlinePickerVisible(false);
    setChallengeForm(createEmptyChallengeForm());
    setChallengeView('my');
    setOpportunityTab('creator_challenges');
    void fetchCreatorChallenges('refresh');
    show('Creator challenge posted.', 'success');
  };

  const handleRemoveChallenge = async (challenge: CreatorChallengeRow) => {
    if (!challenge?.id || challengeDeleting[challenge.id]) return;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      promptSignIn('Create an account or sign in to remove this challenge.');
      return;
    }

    if (challenge.creator_id !== user.id) {
      show('Only the creator can remove this challenge.', 'error');
      return;
    }

    const removeChallenge = async () => {
      const previousChallenges = creatorChallenges;
      setChallengeDeleting((prev) => ({ ...prev, [challenge.id]: true }));
      setCreatorChallenges((prev) => prev.filter((row) => row.id !== challenge.id));
      if (selectedChallenge?.id === challenge.id) setSelectedChallenge(null);

      try {
        const { error } = await supabase
          .from('creator_challenges')
          .delete()
          .eq('id', challenge.id)
          .eq('creator_id', user.id);

        if (error) throw error;

        triggerAppRefresh();
        show('Challenge removed.', 'success');
      } catch (e: any) {
        setCreatorChallenges(previousChallenges);
        logJobsIssue('removeCreatorChallenge unavailable', e);
        show(e?.message || 'Could not remove challenge.', 'error');
      } finally {
        setChallengeDeleting((prev) => {
          const next = { ...prev };
          delete next[challenge.id];
          return next;
        });
      }
    };

    if (Platform.OS === 'web') {
      const ok =
        typeof window !== 'undefined' &&
        window.confirm('Remove this challenge? Existing submissions will stay on Featured, but the challenge will be removed.');
      if (ok) void removeChallenge();
      return;
    }

    Alert.alert(
      'Remove challenge?',
      'Existing submissions will stay on Featured, but the challenge will be removed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void removeChallenge() },
      ]
    );
  };

  const handlePostJob = async () => {
    const {
  data: { user },
} = await supabase.auth.getUser();

if (!user) {
  promptSignIn('Create an account or sign in to post a job.');
  return;
}

if (!formData.role_id || (!formData.city && !formData.remote)) {
  show(
    formData.remote ? 'Please select a role.' : 'Please select a role and a city.',
    'error'
  );
  return;
}

    const moderation = validateMultipleSafeTexts([
      { label: 'Job description', value: formData.description },
      { label: 'Amount', value: formData.amount },
      { label: 'Timing', value: formData.time },
      { label: 'City', value: formData.city?.label },
    ]);

    if (!moderation.safe) {
      Alert.alert('Content Not Allowed', moderation.message || 'Please edit the job before posting.');
      return;
    }

    const payload: Partial<JobRow> & {
      time?: string | null;
      amount?: string | null;
      rate?: string | null;
      currency?: string | null;
    } = {
      role_id: formData.role_id,
      description: formData.description,
      city_id: formData.remote ? formData.city?.value ?? null : formData.city?.value,
      type: formData.type,
      currency: formData.type === 'Paid' ? formData.currency : null,
      rate: formData.type === 'Paid' ? formData.rate : null,
      amount: formData.type === 'Paid' ? formData.amount : null,
      time: formData.time,
      user_id: user.id,
      remote: !!formData.remote,
    };

    const { error } = await supabase.from('jobs').insert(payload);
    if (error) {
      logJobsIssue('submitJob unavailable', error);
      show('Failed to post job.', 'error');
    } else {
      setJobFormVisible(false);
      resetForm();
      void fetchJobs('silent');
      void fetchMyJobs();
      // Backend trigger awards XP; we just refresh context + message
      void refreshGamification();
      show(
        `Job posted! +${XP_VALUES.JOB_POSTED} XP`,
        'success'
      );
    }
  };

  const openJobReport = (job: JobRow) => {
    if (!currentUserId) {
      promptSignIn('Create an account or sign in to report jobs.');
      return;
    }

    setReportTargetJob(job);
    setReportReason('Harassment or bullying');
    setReportDetails('');
  };

  const submitJobReport = async () => {
    if (!reportTargetJob) return;

    const detailsError = validateSafeText(reportDetails);
    if (detailsError) {
      Alert.alert('Content Not Allowed', detailsError);
      return;
    }

    setReportSubmitting(true);
    try {
      const ok = await reportContent({
        reportedUserId: reportTargetJob.user_id,
        contentType: 'job',
        contentId: String(reportTargetJob.id),
        reason: reportReason,
        details: reportDetails.trim() || null,
      });

      if (ok) {
        setReportTargetJob(null);
        setReportDetails('');
      }
    } finally {
      setReportSubmitting(false);
    }
  };

  const blockJobPoster = async (job: JobRow) => {
    if (!currentUserId) {
      promptSignIn('Create an account or sign in to block users.');
      return;
    }

    if (job.user_id === currentUserId) {
      Alert.alert('Not Allowed', 'You cannot block yourself.');
      return;
    }

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
      blockedUserId: job.user_id,
      reason: 'Blocked from Jobs',
      showAlert: true,
    });

    if (!ok) return;

    setBlockedUserIds((prev) => {
      const next = new Set(prev);
      next.add(job.user_id);
      return next;
    });
    setJobs((prev) => prev.filter((row) => row.user_id !== job.user_id));
    if (selectedJob?.user_id === job.user_id) setSelectedJob(null);
    void fetchJobs('silent');
  };

  const checkAlreadyApplied = useCallback(async (jobId?: number) => {
    if (!jobId) {
      setAlreadyApplied(false);
      return;
    }
    setCheckingApplied(true);
    const me = (await supabase.auth.getUser()).data.user;
    if (!me) {
      setAlreadyApplied(false);
      setCheckingApplied(false);
      return;
    }
    const { data, error } = await supabase
      .from('applications')
      .select('id')
      .eq('job_id', jobId)
      .eq('applicant_id', me.id)
      .maybeSingle();

    if (error) {
      logJobsIssue('checkAlreadyApplied unavailable', error);
      setAlreadyApplied(false);
    } else {
      setAlreadyApplied(!!data);
    }
    setCheckingApplied(false);
  }, []);

  useEffect(() => {
    if (selectedJob?.id) {
      void checkAlreadyApplied(selectedJob.id);
    } else {
      setAlreadyApplied(false);
    }
  }, [selectedJob?.id, checkAlreadyApplied]);

  const handleApply = async () => {
    if (!selectedJob) return;

    // 🔒 Membership gate: Networking cannot apply for PAID jobs
    if (selectedJob.type === 'Paid' && userTier === 'free') {
      setUpgradeContext('jobs');
      setUpgradeVisible(true);
      return;
    }

    const me = (await supabase.auth.getUser()).data.user;
if (!me) {
  promptSignIn('Create an account or sign in to apply for jobs.');
  return;
}

    if (applyLoading) return;
    setApplyLoading(true);

    const { data: existing, error: checkErr } = await supabase
      .from('applications')
      .select('id')
      .eq('job_id', selectedJob.id)
      .eq('applicant_id', me.id)
      .maybeSingle();

    if (checkErr) {
      logJobsIssue('applyToJob check unavailable', checkErr);
      setApplyLoading(false);
      return show('Could not verify application status.', 'error');
    }
    if (existing) {
      setApplyLoading(false);
      setAlreadyApplied(true);
      return show("You've already applied to this job.", 'info');
    }

    const { error: insertErr } = await supabase.from('applications').insert({
      job_id: selectedJob.id,
      applicant_id: me.id,
      applied_at: new Date().toISOString(),
    });

    setApplyLoading(false);

    if (insertErr) {
      logJobsIssue('applyToJob insert unavailable', insertErr);
      show('Application failed. Please try again.', 'error');
    } else {
      setAlreadyApplied(true);
      // Backend trigger awards XP; refresh global state and echo the benefit
      void refreshGamification();
      show(
        `Application sent. +${XP_VALUES.JOB_APPLIED} XP`,
        'success',
        1800
      );
      setConfirmVisible(true);
      void fetchMyJobs(); // for posters checking applicants in My Jobs
    }
  };

  const resetForm = () =>
    setFormData({
      role_id: null,
      description: '',
      city: null,
      type: 'Paid',
      currency: '£',
      rate: 'Flat Rate',
      amount: '',
      time: '',
      remote: false,
    });

  const goToProfile = (userObj?: { id: string; full_name?: string | null }) => {
    if (!userObj?.id) return;
    if (selectedJob || selectedChallenge) {
      setSelectedJob(null);
      setSelectedChallenge(null);
      setTimeout(() => {
        // @ts-ignore
        navigation.navigate('Profile', { user: userObj });
      }, 180);
    } else {
      // @ts-ignore
      navigation.navigate('Profile', { user: userObj });
    }
  };

  const goToCreatorProfile = (challenge: CreatorChallengeRow, event?: any) => {
    event?.stopPropagation?.();
    const creator = getCreatorProfile(challenge);
    goToProfile({
      id: challenge.creator_id,
      full_name: creator?.full_name || 'Overlooked creator',
    });
  };

  /* ----------------------------- renderers --------------------------------- */
  const renderRoleItem = useCallback(
    ({ item }: { item: RoleOption }) => (
      <TouchableOpacity
        style={[styles.listPickerItem, { borderBottomColor: T.line }]}
        onPress={() => {
          setFormData((prev) => ({ ...prev, role_id: item.value }));
          setJobRoleOverlayVisible(false);
        }}
        activeOpacity={0.85}
      >
        <Text style={[styles.listPickerText, { color: READABLE_INK }]}>{item.label}</Text>
      </TouchableOpacity>
    ),
    [READABLE_INK, T.line]
  );

  
  const roleKey = useCallback((i: RoleOption) => String(i.value), []);
  const cityKey = useCallback((i: CityOption) => String(i.value), []);

  const renderCreatorAvatar = useCallback(
    (profile?: CreatorProfile | null, size = 42) => {
      const name = profile?.full_name || 'Overlooked creator';
      if (profile?.avatar_url) {
        return (
          <Image
            source={{ uri: profile.avatar_url }}
            style={[
              styles.creatorAvatar,
              {
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: GOLD_LINE,
              },
            ]}
          />
        );
      }

      return (
        <View
          style={[
            styles.creatorAvatarFallback,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              borderColor: GOLD_LINE,
              backgroundColor: GOLD_SOFT,
            },
          ]}
        >
          <Text style={[styles.creatorAvatarInitials, { color: GOLD }]}>
            {initialsForName(name)}
          </Text>
        </View>
      );
    },
    [GOLD, GOLD_LINE, GOLD_SOFT]
  );

  const renderChallenge = useCallback(
    ({ item }: { item: CreatorChallengeRow }) => {
      const challenge = item;
      const creator = getCreatorProfile(challenge);
      const ended = isChallengeEnded(challenge);
      const creatorName = creator?.full_name || 'Overlooked creator';
      const reactionPlatform =
        challenge.reaction_platform || creator?.creator_social_platform || 'Creator socials';
      const rewardText = challenge.prize_description?.trim() || 'Reward TBA';
      const entriesLabel = formatChallengeEntriesLabel(challenge.submission_count);
      const stackActions = width < 390 || challengeView === 'my';
      const deletingChallenge = !!challengeDeleting[challenge.id];

      return (
        <TouchableOpacity
          onPress={() => setSelectedChallenge(challenge)}
          activeOpacity={0.92}
          style={styles.challengeRow}
        >
          <View
            style={[
              styles.challengeCard,
              {
                backgroundColor: challengeTone.surface,
                borderColor: ended ? T.line : challengeTone.border,
                shadowColor: challengeTone.shadow,
              },
            ]}
          >
            <View style={styles.challengeBadgeRow}>
              <View
                style={[
                  styles.challengeTypeBadge,
                  {
                    backgroundColor: ended ? T.surface2 : challengeTone.goldSoft,
                    borderColor: ended ? T.line : challengeTone.border,
                  },
                ]}
              >
                <Ionicons
                  name={ended ? 'time-outline' : 'sparkles-outline'}
                  size={13}
                  color={ended ? T.mute : challengeTone.gold}
                />
                <Text
                  style={[
                    styles.challengeTypeBadgeText,
                    { color: ended ? T.mute : challengeTone.gold },
                  ]}
                >
                  {ended ? 'ENDED CHALLENGE' : 'CREATOR CHALLENGE'}
                </Text>
              </View>
              <Text style={[styles.challengeCountdownText, { color: ended ? T.mute : challengeTone.gold }]}>
                {formatChallengeCountdownCompact(challenge.ends_at)}
              </Text>
            </View>

            <Text style={[styles.challengeTitle, { color: challengeTone.text }]} numberOfLines={2}>
              {challenge.title}
            </Text>

            <View style={styles.challengeHostRow}>
              <TouchableOpacity
                onPress={(event: any) => goToCreatorProfile(challenge, event)}
                activeOpacity={0.8}
                style={styles.creatorAvatarTap}
              >
                {renderCreatorAvatar(creator, 38)}
              </TouchableOpacity>
              <View style={styles.challengeTitleBlock}>
                <View style={styles.challengeCreatorRow}>
                  <Text style={[styles.challengeCreatorPrefix, { color: challengeTone.sub }]}>Hosted by </Text>
                  <TouchableOpacity
                    onPress={(event: any) => goToCreatorProfile(challenge, event)}
                    activeOpacity={0.75}
                  >
                    <Text style={[styles.challengeCreatorLink, { color: challengeTone.gold }]} numberOfLines={1}>
                      {creatorName}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            <View
              style={[
                styles.challengeRewardCallout,
                { backgroundColor: challengeTone.goldSoft, borderColor: challengeTone.border },
              ]}
            >
              <Ionicons name="gift-outline" size={18} color={challengeTone.gold} />
              <View style={styles.challengeRewardCopy}>
                <Text style={[styles.challengeRewardLabel, { color: challengeTone.gold }]}>
                  What you can win
                </Text>
                <Text
                  style={[styles.challengeRewardText, { color: challengeTone.text }]}
                  numberOfLines={2}
                >
                  {rewardText}
                </Text>
              </View>
            </View>

            {challenge.description ? (
              <Text numberOfLines={2} style={[styles.challengeDescription, { color: challengeTone.sub }]}>
                {challenge.description}
              </Text>
            ) : null}

            <View style={styles.challengeMetaGrid}>
              <View style={[styles.challengeMetaPill, { backgroundColor: challengeTone.surfaceAlt, borderColor: T.line }]}>
                <Ionicons name="gift-outline" size={14} color={challengeTone.gold} />
                <Text style={[styles.challengeMetaText, { color: challengeTone.text }]} numberOfLines={1}>
                  {formatChallengeRewardPill(challenge.prize_description)}
                </Text>
              </View>
              <View style={[styles.challengeMetaPill, { backgroundColor: challengeTone.surfaceAlt, borderColor: T.line }]}>
                <Ionicons name="timer-outline" size={14} color={ended ? T.mute : challengeTone.gold} />
                <Text style={[styles.challengeMetaText, { color: ended ? T.mute : challengeTone.text }]} numberOfLines={1}>
                  {formatChallengeCountdownCompact(challenge.ends_at)}
                </Text>
              </View>
              <View style={[styles.challengeMetaPill, { backgroundColor: challengeTone.surfaceAlt, borderColor: T.line }]}>
                <Ionicons name="film-outline" size={14} color={challengeTone.gold} />
                <Text style={[styles.challengeMetaText, { color: challengeTone.text }]} numberOfLines={1}>
                  {entriesLabel}
                </Text>
              </View>
              <View style={[styles.challengeMetaPill, { backgroundColor: challengeTone.surfaceAlt, borderColor: T.line }]}>
                <Ionicons name="at-outline" size={14} color={challengeTone.gold} />
                <Text style={[styles.challengeMetaText, { color: challengeTone.text }]} numberOfLines={1}>
                  {formatReactionPill(reactionPlatform)}
                </Text>
              </View>
            </View>

            <View style={[styles.challengeActionsRow, stackActions && styles.challengeActionsStack]}>
              <TouchableOpacity
                onPress={() => setSelectedChallenge(challenge)}
                activeOpacity={0.9}
                style={[
                  styles.challengeSecondaryButton,
                  !isWebMobile && styles.challengeSecondaryButtonWide,
                  { backgroundColor: challengeTone.surfaceAlt, borderColor: T.line },
                ]}
              >
                <Text style={[styles.challengeSecondaryButtonText, { color: challengeTone.sub }]}>
                  View Brief
                </Text>
              </TouchableOpacity>

              {challengeView === 'my' ? (
                <>
                  <TouchableOpacity
                    onPress={() => openChallengeSubmissions(challenge)}
                    activeOpacity={0.9}
                    style={[
                      styles.challengePrimaryButton,
                      !isWebMobile && styles.challengePrimaryButtonWide,
                      { backgroundColor: challengeTone.gold, borderColor: challengeTone.border },
                    ]}
                  >
                    <Text style={[styles.challengePrimaryButtonText, { color: colors.textOnPrimary }]}>
                      View Entries
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => handleRemoveChallenge(challenge)}
                    disabled={deletingChallenge}
                    activeOpacity={0.9}
                    style={[
                      styles.challengeDangerButton,
                      { backgroundColor: challengeTone.surfaceAlt, borderColor: 'rgba(255,70,70,0.24)' },
                      deletingChallenge && { opacity: 0.58 },
                    ]}
                  >
                    <Ionicons name="trash-outline" size={14} color={challengeTone.danger} />
                    <Text style={[styles.challengeDangerButtonText, { color: challengeTone.danger }]}>
                      {deletingChallenge ? 'Removing' : 'Remove'}
                    </Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  onPress={() =>
                    ended ? openChallengeSubmissions(challenge) : handleSubmitToChallenge(challenge)
                  }
                  activeOpacity={0.9}
                  style={[
                    styles.challengePrimaryButton,
                    !isWebMobile && styles.challengePrimaryButtonWide,
                    {
                      backgroundColor: ended ? challengeTone.surfaceAlt : challengeTone.gold,
                      borderColor: ended ? T.line : challengeTone.border,
                    },
                  ]}
                >
                  <Text style={[styles.challengePrimaryButtonText, { color: ended ? T.mute : colors.textOnPrimary }]}>
                    {ended ? 'View Entries' : 'Submit to Challenge'}
                  </Text>
                </TouchableOpacity>
              )}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    [
      T,
      challengeView,
      challengeDeleting,
      colors.textOnPrimary,
      challengeTone,
      goToCreatorProfile,
      handleSubmitToChallenge,
      handleRemoveChallenge,
      isWebMobile,
      openChallengeSubmissions,
      renderCreatorAvatar,
      width,
    ]
  );

  const renderJob = useCallback(
  ({ item }: { item: JobRow }) => {
    const job = item;
    const postedAgo = formatTimeAgo(job.created_at);
    const rateText =
      job.type === 'Paid'
        ? `${job.currency ?? ''}${job.amount ?? ''}${job.rate ? ` • ${job.rate}` : ''}`
        : 'Free / Collaboration';

    return (
      <TouchableOpacity
        onPress={() => setSelectedJob(job)}
        activeOpacity={0.9}
        style={styles.jobRow}
      >
        <View
          style={[
            styles.jobCard,
            {
              backgroundColor: T.surface,
              borderColor: T.line,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <View style={styles.jobCardTopRow}>
            <View style={styles.jobCardHeaderLeft}>
              <Text style={[styles.jobTitle, { color: T.text }]}>
                {decode(job.creative_roles?.name || 'Job')}
              </Text>

              <View style={[styles.typeBadge, { backgroundColor: GOLD_SOFT, borderColor: GOLD_LINE }]}>
                <Text style={[styles.typeBadgeText, { color: GOLD }]}>
                  {job.type === 'Paid' ? 'PAID ROLE' : 'FREE / COLLAB'}
                </Text>
              </View>
            </View>

            <View style={[styles.rateBadge, { backgroundColor: T.surface2, borderColor: T.line }]}>
              <Text style={[styles.rateBadgeText, { color: T.text }]}>{rateText}</Text>
            </View>
          </View>

          {job.description ? (
            <Text numberOfLines={3} style={[styles.jobDescription, { color: T.sub }]}>
              {decode(job.description)}
            </Text>
          ) : null}

          <View style={styles.metaBlock}>
            <View style={styles.metaLine}>
              {!job.remote ? (
                <IconText
                  name="location-outline"
                  text={job.cities?.name || 'Unknown'}
                />
              ) : (
                <IconText name="globe-outline" text="Remote" accent />
              )}

              <View style={[styles.dot, { backgroundColor: T.line }]} />

              <View style={styles.iconText}>
                <Ionicons
                  name="person-outline"
                  size={15}
                  color={T.sub}
                  style={{ marginRight: 6 }}
                />
                <TouchableOpacity
                  onPress={(e: any) => {
                    e?.stopPropagation?.();
                    goToProfile(job.users || undefined);
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.posterName, { color: GOLD }]}>
                    {job.users?.full_name || 'View Profile'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.metaLine}>
              <IconText name="time-outline" text={postedAgo || '—'} />
              {job.time ? (
                <>
                  <View style={[styles.dot, { backgroundColor: T.line }]} />
                  <IconText name="calendar-outline" text={job.time} />
                </>
              ) : null}
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  },
  [GOLD, GOLD_LINE, GOLD_SOFT, T, colors.shadow, goToProfile]
);
  const renderMyJob = useCallback(
  ({ item }: { item: MyJob }) => {
    const job = item;
    const postedAgo = formatTimeAgo(job.created_at);
    const rateText =
      job.type === 'Paid'
        ? `${job.currency ?? ''}${job.amount ?? ''}${job.rate ? ` • ${job.rate}` : ''}`
        : 'Free / Collaboration';
    const hasApplicants = job.applicants && job.applicants.length > 0;

    return (
      <View style={styles.jobRow}>
        <View
          style={[
            styles.jobCard,
            {
              backgroundColor: T.surface,
              borderColor: T.line,
              shadowColor: colors.shadow,
            },
          ]}
        >
          <View style={styles.jobCardTopRow}>
            <View style={styles.jobCardHeaderLeft}>
              <Text style={[styles.jobTitle, { color: T.text }]}>
                {decode(job.creative_roles?.name || 'Job')}
              </Text>

              <View style={[styles.typeBadge, { backgroundColor: GOLD_SOFT, borderColor: GOLD_LINE }]}>
                <Text style={[styles.typeBadgeText, { color: GOLD }]}>MY LISTING</Text>
              </View>
            </View>

            <View style={[styles.rateBadge, { backgroundColor: T.surface2, borderColor: T.line }]}>
              <Text style={[styles.rateBadgeText, { color: T.text }]}>{rateText}</Text>
            </View>
          </View>

          {job.description ? (
            <Text numberOfLines={3} style={[styles.jobDescription, { color: T.sub }]}>
              {decode(job.description)}
            </Text>
          ) : null}

          <View style={styles.metaBlock}>
            <View style={styles.metaLine}>
              {!job.remote ? (
                <IconText
                  name="location-outline"
                  text={job.cities?.name || 'Unknown'}
                />
              ) : (
                <IconText name="globe-outline" text="Remote" accent />
              )}

              <View style={[styles.dot, { backgroundColor: T.line }]} />
              <IconText name="time-outline" text={postedAgo || '—'} />
              {job.time ? (
                <>
                  <View style={[styles.dot, { backgroundColor: T.line }]} />
                  <IconText name="calendar-outline" text={job.time} />
                </>
              ) : null}
            </View>
          </View>

          <View style={styles.applicantSummaryRow}>
            <Ionicons
              name="people-outline"
              size={16}
              color={T.sub}
              style={{ marginRight: 6 }}
            />
            {hasApplicants ? (
              <Text style={[styles.applicantSummaryText, { color: T.sub }]}>
                {job.applicants.length} applicant
                {job.applicants.length !== 1 ? 's' : ''}
              </Text>
            ) : (
              <Text style={[styles.applicantSummaryText, { color: T.sub }]}>
                No applicants yet.
              </Text>
            )}
          </View>

          {hasApplicants && (
            <View style={styles.applicantList}>
              {job.applicants.slice(0, 4).map((a) => (
                <TouchableOpacity
                  key={a.id}
                  style={[
                    styles.applicantPill,
                    {
                      backgroundColor: GOLD_SOFT,
                      borderColor: GOLD_LINE,
                    },
                  ]}
                  activeOpacity={0.9}
                  onPress={() => {
                    // @ts-ignore
                    navigation.navigate('Profile', {
                      user: { id: a.id, full_name: a.full_name },
                    });
                  }}
                >
                  <Ionicons
                    name="person-circle-outline"
                    size={14}
                    color={GOLD}
                    style={{ marginRight: 4 }}
                  />
                  <Text style={[styles.applicantPillText, { color: GOLD }]}>
                    {a.full_name || 'View profile'}
                  </Text>
                </TouchableOpacity>
              ))}
              {job.applicants.length > 4 && (
                <Text style={[styles.applicantMoreText, { color: T.mute }]}>
                  +{job.applicants.length - 4} more
                </Text>
              )}
            </View>
          )}

          <View style={styles.myJobActionsRow}>
            <TouchableOpacity
              style={[styles.closeJobButton, { backgroundColor: GOLD, shadowColor: colors.shadow }]}
              onPress={() => handleCloseJob(job.id)}
              activeOpacity={0.92}
            >
              <Ionicons
                name="lock-closed-outline"
                size={14}
                color={colors.textOnPrimary}
                style={{ marginRight: 6 }}
              />
              <Text style={[styles.closeJobButtonText, { color: colors.textOnPrimary }]}>
                Close Job
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  },
  [GOLD, GOLD_LINE, GOLD_SOFT, T, colors.shadow, colors.textOnPrimary, handleCloseJob, navigation]
);

  const anyFilterActive = useMemo(
    () => !!(filterCity || filterRole || includeRemote === false),
    [filterCity, filterRole, includeRemote]
  );

  const clearFilters = () => {
    setFilterCity(null);
    setFilterRole(null);
    setIncludeRemote(true);
  };

  const ListHeader = useMemo(
  () => (
    <View style={styles.listHeaderRoot}>
      <View style={styles.opportunitiesHeader}>
        <Text style={[styles.opportunitiesTitle, { color: T.text }]}>Opportunities</Text>
        <Text style={[styles.opportunitiesSubtitle, { color: T.sub }]}>
          Compete, collaborate, and get your work seen.
        </Text>
      </View>

      <View style={styles.opportunityTabsWrap}>
        <View
          style={[
            styles.opportunityTabsShell,
            {
              backgroundColor: T.surface2,
              borderColor: T.line,
            },
          ]}
        >
          {([
            { key: 'creator_challenges', label: 'CREATOR CHALLENGES' },
            { key: 'jobs', label: 'JOBS' },
          ] as const).map((tab) => {
            const active = opportunityTab === tab.key;

            return (
              <TouchableOpacity
                key={tab.key}
                style={[
                  styles.opportunitySegmentTap,
                  {
                    backgroundColor: active ? GOLD : 'transparent',
                    shadowColor: active ? GOLD : colors.shadow,
                  },
                  active && styles.opportunitySegmentTapActive,
                ]}
                onPress={() => setOpportunityTab(tab.key)}
                activeOpacity={0.92}
              >
                <Text
                  style={[
                    styles.opportunitySegmentText,
                    { color: active ? colors.textOnPrimary : T.sub },
                  ]}
                >
                  {tab.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {opportunityTab === 'creator_challenges' ? (
        <>
          {creatorProfile?.is_creator ? (
          <View style={styles.filtersInline}>
            {(['browse', 'my'] as const).map((tab) => {
              const active = challengeView === tab;
              return (
                <TouchableOpacity
                  key={tab}
                  onPress={() => setChallengeView(tab)}
                  style={[
                    styles.filterPill,
                    {
                      backgroundColor: active ? GOLD_SOFT : T.surface2,
                      borderColor: active ? GOLD_LINE : T.line,
                    },
                  ]}
                  activeOpacity={0.9}
                >
                  <Ionicons
                    name={tab === 'browse' ? 'sparkles-outline' : 'person-circle-outline'}
                    size={13}
                    color={active ? GOLD : T.sub}
                  />
                  <Text style={[styles.filterPillText, { color: active ? GOLD : T.sub }]}>
                    {tab === 'browse' ? 'All' : 'Mine'}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          ) : null}

          <View
            style={[
              styles.creatorSectionHeader,
              isWebMobile && styles.creatorSectionHeaderStack,
              !creatorProfile?.is_creator && styles.creatorSectionHeaderNoFilters,
            ]}
          >
            <View style={styles.creatorSectionCopy}>
              <Text style={[styles.creatorSectionTitle, { color: T.text }]}>Creator Challenges</Text>
              <Text style={[styles.creatorSectionSubtitle, { color: T.sub }]}>
                Enter creator-led briefs, win rewards, and get featured across Overlooked and social media.
              </Text>
              <View style={styles.creatorValueRow}>
                {['Win rewards', 'Get featured', 'Build your portfolio'].map((item) => (
                  <View
                    key={item}
                    style={[
                      styles.creatorValueChip,
                      { backgroundColor: challengeTone.goldSoft, borderColor: challengeTone.border },
                    ]}
                  >
                    <Text style={[styles.creatorValueChipText, { color: challengeTone.gold }]}>
                      {item}
                    </Text>
                  </View>
                ))}
              </View>
            </View>

            {creatorProfile?.is_creator ? (
              <TouchableOpacity
                onPress={openPostChallengeComposer}
                activeOpacity={0.9}
                style={[
                  styles.sectionPostButton,
                  isWebMobile && styles.sectionPostButtonFull,
                  {
                    backgroundColor: GOLD,
                    borderColor: GOLD_LINE,
                  },
                ]}
              >
                <Ionicons name="add" size={15} color={colors.textOnPrimary} />
                <Text style={[styles.sectionPostButtonText, { color: colors.textOnPrimary }]}>
                  Post Challenge
                </Text>
              </TouchableOpacity>
            ) : (
              <Text style={[styles.creatorApprovalNote, { color: T.mute }]}>
                Creator accounts are manually approved.
              </Text>
            )}
          </View>
        </>
      ) : (
        <>
          <View style={styles.categoryTabsWrap}>
            <View style={styles.categoryTabsRow}>
              {(['free', 'paid', 'my'] as const).map((tab) => {
                const active = activeTab === tab;
                const label =
                  tab === 'paid'
                    ? 'PAID'
                    : tab === 'free'
                    ? 'FREE'
                    : 'MY JOBS';

                return (
                  <TouchableOpacity
                    key={tab}
                    style={[
                      styles.categoryTap,
                      {
                        backgroundColor: active ? (isLight ? '#FFFFFF' : T.surface2) : T.surface2,
                        borderColor: active ? GOLD_LINE : T.line,
                        shadowColor: colors.shadow,
                      },
                      active && styles.categoryTapActive,
                    ]}
                    onPress={() => setActiveTab(tab)}
                    activeOpacity={0.92}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        { color: active ? GOLD : T.sub },
                      ]}
                    >
                      {label}
                    </Text>
                    {active ? <View style={styles.categoryUnderline} /> : null}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {activeTab !== 'my' && (
            <View style={styles.filtersInline}>
              <TouchableOpacity
                onPress={() => setCityFilterModalVisible(true)}
                style={[
                  styles.filterPill,
                  {
                    backgroundColor: filterCity ? GOLD_SOFT : T.surface2,
                    borderColor: filterCity ? GOLD_LINE : T.line,
                  },
                ]}
                activeOpacity={0.9}
              >
                <Ionicons
                  name="location-outline"
                  size={15}
                  color={filterCity ? GOLD : T.sub}
                />
                <Text
                  style={[
                    styles.filterPillText,
                    { color: filterCity ? GOLD : T.sub },
                  ]}
                >
                  {filterCity?.label || 'City'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setRoleFilterModalVisible(true)}
                style={[
                  styles.filterPill,
                  {
                    backgroundColor: filterRole ? GOLD_SOFT : T.surface2,
                    borderColor: filterRole ? GOLD_LINE : T.line,
                  },
                ]}
                activeOpacity={0.9}
              >
                <Ionicons
                  name="briefcase-outline"
                  size={15}
                  color={filterRole ? GOLD : T.sub}
                />
                <Text
                  style={[
                    styles.filterPillText,
                    { color: filterRole ? GOLD : T.sub },
                  ]}
                >
                  {filterRole?.label || 'Role'}
                </Text>
              </TouchableOpacity>

              <View
                style={[
                  styles.filterPill,
                  styles.remoteFilterPill,
                  {
                    backgroundColor: T.surface2,
                    borderColor: T.line,
                  },
                ]}
              >
                <Text style={[styles.filterToggleLabel, { color: T.sub }]}>Remote</Text>
                <CustomToggle
                  value={includeRemote}
                  onChange={(v) => setIncludeRemote(v)}
                  size="sm"
                />
              </View>

              {anyFilterActive ? (
                <TouchableOpacity
                  onPress={clearFilters}
                  style={[styles.clearPill, { backgroundColor: T.surface2, borderColor: T.line }]}
                  activeOpacity={0.9}
                >
                  <Ionicons
                    name="close-circle-outline"
                    size={15}
                    color={T.sub}
                  />
                  <Text style={[styles.clearPillText, { color: T.sub }]}>Clear</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          )}
        </>
      )}

      <View style={styles.sectionSpacer} />
    </View>
  ),
  [
    opportunityTab,
    challengeView,
    creatorProfile?.is_creator,
    activeTab,
    filterCity,
    filterRole,
    includeRemote,
    anyFilterActive,
    T,
    GOLD,
    GOLD_LINE,
    GOLD_SOFT,
    challengeTone,
    colors.shadow,
    colors.textOnPrimary,
    isLight,
    isWebMobile,
    openPostChallengeComposer,
    gamifyLoading,
    jobs.length,
    myJobs.length,
  ]
);

  /* -------------------------------- render --------------------------------- */
  const listData =
    opportunityTab === 'creator_challenges'
      ? creatorChallenges
      : activeTab === 'my'
      ? myJobs
      : jobs;
  const showPostJobButton = opportunityTab === 'jobs';

  return (
  <SafeAreaView style={[styles.safeArea, { backgroundColor: T.bg }]} edges={['top']}>
    <View
      style={[
        styles.container,
        {
          backgroundColor: T.bg,
          paddingTop: Platform.OS === 'web' ? 0 : insets.top > 0 ? 4 : 8,
        },
      ]}
    >
      <ToastView />

      <Animated.FlatList
        data={listData as any[]}
        keyExtractor={(item: any) => String(item.id)}
        renderItem={
          opportunityTab === 'creator_challenges'
            ? (renderChallenge as any)
            : activeTab === 'my'
            ? (renderMyJob as any)
            : (renderJob as any)
        }
        extraData={`${isLight ? 'light' : 'dark'}-${opportunityTab}-${activeTab}-${challengeView}`}
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
  <View style={styles.emptyWrap}>
    {opportunityTab === 'creator_challenges' ? (
      challengeLoading ? (
        <ActivityIndicator size="large" color={GOLD} />
      ) : (
        <View style={[styles.emptyCard, { backgroundColor: T.surface, borderColor: T.line }]}>
          <Ionicons name="sparkles-outline" size={28} color={GOLD} />
          <Text style={[styles.emptyTitle, { color: T.text }]}>
            {challengeView === 'my' ? 'No challenges posted yet' : 'No creator challenges yet'}
          </Text>
          <Text style={[styles.emptyText, { color: T.sub }]}>
            {challengeView === 'my'
              ? 'Post your first challenge to invite submissions from the Overlooked community.'
              : 'Approved creators will appear here when they post active challenges.'}
          </Text>
        </View>
      )
    ) : activeTab === 'my' ? (
      <View style={[styles.emptyCard, { backgroundColor: T.surface, borderColor: T.line }]}>
        <Ionicons name="briefcase-outline" size={28} color={GOLD} />
        <Text style={[styles.emptyTitle, { color: T.text }]}>No jobs posted yet</Text>
        <Text style={[styles.emptyText, { color: T.sub }]}>
          You haven&apos;t posted any jobs yet. Use &quot;Post a Job&quot; below to share an opportunity.
        </Text>
      </View>
    ) : isLoadingInit ? (
      <ActivityIndicator size="large" color={GOLD} />
    ) : (
      <View style={[styles.emptyCard, { backgroundColor: T.surface, borderColor: T.line }]}>
        <Ionicons name="sparkles-outline" size={28} color={GOLD} />
        <Text style={[styles.emptyTitle, { color: T.text }]}>Nothing here yet</Text>
        <Text style={[styles.emptyText, { color: T.sub }]}>
          No jobs match these filters right now.
        </Text>
      </View>
    )}
  </View>
}
        contentContainerStyle={{
  paddingBottom:
    opportunityTab === 'jobs'
      ? Platform.OS === 'web' && !isWebMobile
        ? 150
        : 230
      : Platform.OS === 'web' && !isWebMobile
      ? 96
      : 132,
}}
        refreshing={
          opportunityTab === 'creator_challenges'
            ? challengeRefreshing
            : activeTab === 'my'
            ? loadingMyJobs
            : isRefreshing
        }
onRefresh={() => {
  triggerAppRefresh();

  if (opportunityTab === 'creator_challenges') {
    void fetchCreatorProfile(currentUserId);
    void fetchCreatorChallenges('refresh');
  } else if (activeTab === 'my') {
    void fetchMyJobs();
  } else {
    void fetchJobs('refresh');
  }

  void refreshGamification?.();
}}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={Platform.OS !== 'web'}
        ItemSeparatorComponent={() => <View style={styles.rowSpacer} />}
      />

      {/* Post an Opportunity */}
      {showPostJobButton ? (
        <TouchableOpacity
  style={[
    styles.postButton,
    {
      backgroundColor: GOLD,
      borderColor: GOLD_LINE,
      shadowColor: colors.shadow,
      bottom: Platform.OS === 'web' && !isWebMobile ? 28 : Math.max(tabBarHeight + 14, 84),
      left: Platform.OS === 'web' && !isWebMobile ? (width - Math.min(width - 32, 1100)) / 2 : 16,
      right: Platform.OS === 'web' && !isWebMobile ? undefined : 16,
      width: Platform.OS === 'web' && !isWebMobile ? Math.min(width - 32, 1100) : undefined,
    },
  ]}
  onPress={async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      promptSignIn('Create an account or sign in to post a job.');
      return;
    }

    setJobFormVisible(true);
  }}
  activeOpacity={0.94}
>
  <View style={styles.postButtonInner}>
    <Ionicons
      name="add"
      size={18}
      color={colors.textOnPrimary}
    />
    <Text style={[styles.postButtonText, { color: colors.textOnPrimary }]}>
      Post a Job
    </Text>
  </View>
</TouchableOpacity>
      ) : null}

      {/* Post Creator Challenge Modal */}
      <SmoothModal
        visible={challengeFormVisible}
        enterOffset={96}
        frameStyle={{ backgroundColor: T.bg }}
        onRequestClose={() => {
          setChallengeCategoryPickerVisible(false);
          setDeadlinePickerVisible(false);
          setChallengeFormVisible(false);
        }}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={[styles.modalContainer, { backgroundColor: T.bg }]}>
            <View style={[styles.modalChromeLine, { backgroundColor: GOLD }]} />
            <Text style={[styles.modalTitle, { color: T.text }]}>Post Creator Challenge</Text>

            <ScrollView
              contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? 190 : 170 }}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.label, { color: T.text }]}>Title</Text>
              <TextInput
                style={[styles.input, { backgroundColor: T.surface, borderColor: T.line, color: T.text }, WEB_NO_OUTLINE]}
                placeholder="e.g. Make a 30-second scene with no dialogue"
                placeholderTextColor={T.mute}
                value={challengeForm.title}
                onChangeText={(text) => setChallengeForm((prev) => ({ ...prev, title: text }))}
              />

              <Text style={[styles.label, { color: T.text }]}>Category</Text>
              <TouchableOpacity
                onPress={() => {
                  Keyboard.dismiss();
                  setDeadlinePickerVisible(false);
                  setChallengeCategoryPickerVisible(true);
                }}
                activeOpacity={0.9}
                style={[
                  styles.formPickerButton,
                  { backgroundColor: T.surface, borderColor: T.line },
                ]}
              >
                <Ionicons name="pricetag-outline" size={17} color={GOLD} />
                <Text
                  style={[
                    styles.formPickerButtonText,
                    { color: challengeForm.category ? T.text : T.mute },
                  ]}
                  numberOfLines={1}
                >
                  {challengeForm.category || 'Select a category'}
                </Text>
                <Ionicons name="chevron-forward" size={18} color={T.mute} />
              </TouchableOpacity>

              <Text style={[styles.label, { color: T.text }]}>Challenge brief</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.textAreaInput,
                  { backgroundColor: T.surface, borderColor: T.line, color: T.text },
                  WEB_NO_OUTLINE,
                ]}
                placeholder="What should people make?"
                placeholderTextColor={T.mute}
                value={challengeForm.description}
                onChangeText={(text) => setChallengeForm((prev) => ({ ...prev, description: text }))}
                multiline
              />

              <Text style={[styles.label, { color: T.text }]}>Rules</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.textAreaInput,
                  { backgroundColor: T.surface, borderColor: T.line, color: T.text },
                  WEB_NO_OUTLINE,
                ]}
                placeholder="Length, format, content rules..."
                placeholderTextColor={T.mute}
                value={challengeForm.rules}
                onChangeText={(text) => setChallengeForm((prev) => ({ ...prev, rules: text }))}
                multiline
              />

              <Text style={[styles.label, { color: T.text }]}>Required element</Text>
              <TextInput
                style={[styles.input, { backgroundColor: T.surface, borderColor: T.line, color: T.text }, WEB_NO_OUTLINE]}
                placeholder="Optional phrase creators must include"
                placeholderTextColor={T.mute}
                value={challengeForm.required_phrase}
                onChangeText={(text) => setChallengeForm((prev) => ({ ...prev, required_phrase: text }))}
              />

              <Text style={[styles.label, { color: T.text }]}>Reward</Text>
              <TextInput
                style={[styles.input, { backgroundColor: T.surface, borderColor: T.line, color: T.text }, WEB_NO_OUTLINE]}
                placeholder="Prize, reaction, shoutout, cash..."
                placeholderTextColor={T.mute}
                value={challengeForm.prize_description}
                onChangeText={(text) => setChallengeForm((prev) => ({ ...prev, prize_description: text }))}
              />

              <Text style={[styles.label, { color: T.text }]}>Deadline</Text>
              <TouchableOpacity
                onPress={openDeadlinePicker}
                activeOpacity={0.9}
                style={[
                  styles.deadlineButton,
                  { backgroundColor: T.surface, borderColor: T.line },
                ]}
              >
                <Ionicons name="calendar-outline" size={18} color={GOLD} />
                <Text style={[styles.deadlineButtonText, { color: T.text }]}>
                  {formatDeadlineInputLabel(challengeForm.ends_at)}
                </Text>
                <Ionicons
                  name={deadlinePickerVisible ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={T.mute}
                />
              </TouchableOpacity>
              {deadlinePickerVisible ? (
                <View style={[styles.deadlinePanel, { backgroundColor: T.surface, borderColor: T.line }]}>
                  <View style={styles.deadlinePanelHeader}>
                    <TouchableOpacity
                      onPress={() =>
                        setDeadlinePickerMonth(
                          (prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1)
                        )
                      }
                      style={[styles.deadlineMonthButton, { borderColor: T.line }]}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="chevron-back" size={18} color={T.sub} />
                    </TouchableOpacity>
                    <Text style={[styles.deadlineMonthText, { color: T.text }]}>
                      {deadlineMonthLabel}
                    </Text>
                    <TouchableOpacity
                      onPress={() =>
                        setDeadlinePickerMonth(
                          (prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1)
                        )
                      }
                      style={[styles.deadlineMonthButton, { borderColor: T.line }]}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="chevron-forward" size={18} color={T.sub} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.calendarWeekRow}>
                    {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
                      <Text key={`${day}-${index}`} style={[styles.calendarWeekText, { color: T.mute }]}>
                        {day}
                      </Text>
                    ))}
                  </View>

                  <View style={styles.calendarGrid}>
                    {deadlineCalendarDays.map((day, index) => {
                      if (!day) {
                        return <View key={`blank-${index}`} style={styles.calendarCell} />;
                      }

                      const dayStart = new Date(day);
                      dayStart.setHours(0, 0, 0, 0);
                      const dayEnd = new Date(day);
                      dayEnd.setHours(23, 59, 59, 999);
                      const minDate = new Date(Date.now() + 5 * 60 * 1000);
                      const maxDate = new Date(Date.now() + CREATOR_CHALLENGE_MAX_MS);
                      const disabled =
                        dayEnd.getTime() < minDate.getTime() ||
                        dayStart.getTime() > maxDate.getTime();
                      const active = isSameCalendarDay(day, selectedDeadlineDate);

                      return (
                        <View key={day.toISOString()} style={styles.calendarCell}>
                          <TouchableOpacity
                            onPress={() => selectChallengeDeadlineDay(day)}
                            disabled={disabled}
                            style={[
                              styles.calendarDayButton,
                              {
                                backgroundColor: active ? GOLD : 'transparent',
                                borderColor: active ? GOLD_LINE : T.line,
                              },
                              disabled && styles.calendarDayDisabled,
                            ]}
                            activeOpacity={0.84}
                          >
                            <Text
                              style={[
                                styles.calendarDayText,
                                { color: active ? colors.textOnPrimary : disabled ? T.mute : T.text },
                              ]}
                            >
                              {day.getDate()}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      );
                    })}
                  </View>

                  <View style={styles.timeStepperRow}>
                    <TouchableOpacity
                      onPress={() => adjustChallengeDeadlineMinutes(-60)}
                      style={[styles.timeStepperButton, { borderColor: T.line }]}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="remove" size={17} color={T.sub} />
                    </TouchableOpacity>
                    <Text style={[styles.timeStepperValue, { color: T.text }]}>
                      {`${padDatePart(selectedDeadlineDate.getHours())}:${padDatePart(
                        selectedDeadlineDate.getMinutes()
                      )}`}
                    </Text>
                    <TouchableOpacity
                      onPress={() => adjustChallengeDeadlineMinutes(60)}
                      style={[styles.timeStepperButton, { borderColor: T.line }]}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="add" size={17} color={T.sub} />
                    </TouchableOpacity>
                  </View>

                  <View style={styles.quickTimeRow}>
                    {[
                      { label: '12:00', hour: 12, minute: 0 },
                      { label: '18:00', hour: 18, minute: 0 },
                      { label: '23:59', hour: 23, minute: 59 },
                    ].map((time) => (
                      <TouchableOpacity
                        key={time.label}
                        onPress={() => setChallengeDeadlineTime(time.hour, time.minute)}
                        style={[styles.quickTimeChip, { backgroundColor: T.surface2, borderColor: T.line }]}
                        activeOpacity={0.85}
                      >
                        <Text style={[styles.quickTimeText, { color: T.sub }]}>{time.label}</Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity
                      onPress={() => setDeadlinePickerVisible(false)}
                      style={[styles.quickTimeChip, { backgroundColor: GOLD_SOFT, borderColor: GOLD_LINE }]}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.quickTimeText, { color: GOLD }]}>Done</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ) : null}
              <Text style={[styles.helperText, { color: T.mute }]}>
                Submissions close at the deadline. The challenge remains visible for 48 hours after.
              </Text>

              <Text style={[styles.label, { color: T.text }]}>Reaction platforms</Text>
              <View style={styles.selectorWrap}>
                {REACTION_PLATFORM_OPTIONS.map((platform) => {
                  const active = selectedReactionPlatforms.some(
                    (item) => item.toLowerCase() === platform.toLowerCase()
                  );
                  return (
                    <TouchableOpacity
                      key={platform}
                      onPress={() =>
                        setChallengeForm((prev) => ({
                          ...prev,
                          reaction_platform: toggleDelimitedValue(prev.reaction_platform, platform),
                        }))
                      }
                      style={[
                        styles.selectorChip,
                        {
                          backgroundColor: active ? GOLD_SOFT : T.surface,
                          borderColor: active ? GOLD_LINE : T.line,
                        },
                      ]}
                      activeOpacity={0.9}
                    >
                      <Text style={[styles.selectorChipText, { color: active ? GOLD : T.sub }]}>
                        {platform}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.label, { color: T.text }]}>Reaction links</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.linkTextAreaInput,
                  { backgroundColor: T.surface, borderColor: T.line, color: T.text },
                  WEB_NO_OUTLINE,
                ]}
                placeholder="Add one link per line"
                placeholderTextColor={T.mute}
                value={challengeForm.reaction_url}
                onChangeText={(text) => setChallengeForm((prev) => ({ ...prev, reaction_url: text }))}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
              />

              <Text style={[styles.label, { color: T.text }]}>Reaction details</Text>
              <TextInput
                style={[
                  styles.input,
                  styles.textAreaInput,
                  { backgroundColor: T.surface, borderColor: T.line, color: T.text },
                  WEB_NO_OUTLINE,
                ]}
                placeholder="Where and how you will react to submissions"
                placeholderTextColor={T.mute}
                value={challengeForm.reaction_description}
                onChangeText={(text) => setChallengeForm((prev) => ({ ...prev, reaction_description: text }))}
                multiline
              />
            </ScrollView>

            <View style={[styles.modalFooter, { backgroundColor: T.bg, borderTopColor: T.line }]}>
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerGhost, { backgroundColor: T.surface2, borderColor: T.line }]}
                onPress={() => {
                  setChallengeCategoryPickerVisible(false);
                  setDeadlinePickerVisible(false);
                  setChallengeFormVisible(false);
                }}
                activeOpacity={0.9}
              >
                <Text style={[styles.footerGhostText, { color: T.sub }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.footerBtn, styles.footerPrimary, { backgroundColor: GOLD, borderColor: GOLD_LINE }]}
                onPress={handlePostChallenge}
                disabled={challengeSubmitting}
                activeOpacity={0.9}
              >
                {challengeSubmitting ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={[styles.footerPrimaryText, { color: colors.textOnPrimary }]}>Post Challenge</Text>
                )}
              </TouchableOpacity>
            </View>

            {challengeCategoryPickerVisible ? (
              <View style={styles.categoryPickerOverlay}>
                <TouchableOpacity
                  style={StyleSheet.absoluteFillObject}
                  activeOpacity={1}
                  onPress={() => setChallengeCategoryPickerVisible(false)}
                />
                <View
                  style={[
                    styles.categoryPickerSheet,
                    {
                      backgroundColor: T.surface,
                      borderColor: T.line,
                    },
                  ]}
                >
                  <View style={styles.categoryPickerHeader}>
                    <View>
                      <Text style={[styles.categoryPickerTitle, { color: T.text }]}>Category</Text>
                      <Text style={[styles.categoryPickerSubtitle, { color: T.mute }]}>
                        Choose where this challenge should appear.
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => setChallengeCategoryPickerVisible(false)}
                      style={[
                        styles.categoryPickerClose,
                        { backgroundColor: T.surface2, borderColor: T.line },
                      ]}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="close" size={18} color={T.sub} />
                    </TouchableOpacity>
                  </View>

                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={styles.categoryPickerGrid}
                  >
                    {CHALLENGE_CATEGORY_OPTIONS.map((category) => {
                      const active = challengeForm.category === category;
                      return (
                        <TouchableOpacity
                          key={category}
                          onPress={() => {
                            setChallengeForm((prev) => ({ ...prev, category }));
                            setChallengeCategoryPickerVisible(false);
                          }}
                          style={[
                            styles.categoryPickerOption,
                            {
                              backgroundColor: active ? GOLD_SOFT : T.surface2,
                              borderColor: active ? GOLD_LINE : T.line,
                            },
                          ]}
                          activeOpacity={0.88}
                        >
                          <Text
                            style={[
                              styles.categoryPickerOptionText,
                              { color: active ? GOLD : T.text },
                            ]}
                          >
                            {category}
                          </Text>
                          {active ? <Ionicons name="checkmark" size={17} color={GOLD} /> : null}
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>
              </View>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </SmoothModal>

      {/* Post Job Modal */}
      <SmoothModal
        visible={jobFormVisible}
        enterOffset={96}
        frameStyle={{ backgroundColor: T.bg }}
        onRequestClose={() => setJobFormVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={
            Platform.OS === 'ios'
              ? 'padding'
              : undefined
          }
        >
          <View style={[styles.modalContainer, { backgroundColor: T.bg }]}>
            <View style={[styles.modalChromeLine, { backgroundColor: GOLD }]} />
            <Text style={[styles.modalTitle, { color: T.text }]}>
              Post a New Job
            </Text>

            {/* Paid/Free tabs */}
            <View
              style={[
                styles.categoryTabsRow,
                {
                  marginTop: 6,
                  marginBottom: 2,
                },
              ]}
            >
              {(['Free', 'Paid'] as const).map((t) => {
                const active = formData.type === t;
                return (
                  <TouchableOpacity
                    key={t}
                    style={[
                      styles.categoryTap,
                      {
                        backgroundColor: active ? T.surface : T.surface2,
                        borderColor: active ? GOLD_LINE : T.line,
                      },
                    ]}
                    onPress={() =>
                      setFormData({
                        ...formData,
                        type: t,
                      })
                    }
                    activeOpacity={0.92}
                  >
                    <Text
                      style={[
                        styles.categoryText,
                        { color: active ? GOLD : T.sub },
                      ]}
                    >
                      {t.toUpperCase()}
                    </Text>
                    {active ? (
                      <View style={styles.categoryUnderline} />
                    ) : (
                      <View style={{ height: 3 }} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>

            <ScrollView
              contentContainerStyle={{ paddingBottom: Platform.OS === 'ios' ? 180 : 160 }}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
            >
              <Text style={[styles.label, { color: T.text }]}>Role</Text>
              <TouchableOpacity
                style={[styles.input, { backgroundColor: T.surface, borderColor: T.line }]}
                onPress={() => {
                  Keyboard.dismiss();
                  setRoleItems([]);
                  setRoleSearchTerm('');
                  setJobRoleOverlayVisible(true);
                  roleReqIdRef.current++;
                }}
                activeOpacity={0.92}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="briefcase-outline" size={16} color={T.sub} />
                  <Text
                    style={{
                      color: formData.role_id ? READABLE_INK : READABLE_MUTED,
                      marginLeft: 8,
                    }}
                  >
                    {formData.role_id
                      ? roles.find((r) => r.id === formData.role_id)?.name ||
                        'Selected role'
                      : 'Search for a role'}
                  </Text>
                </View>
              </TouchableOpacity>

              <Text style={[styles.label, { color: T.text }]}>Description</Text>
              <TextInput
                style={[
                  styles.input,
                  { minHeight: 84, backgroundColor: T.surface, borderColor: T.line, color: T.text },
                  WEB_NO_OUTLINE,
                ]}
                placeholder="Short, clear description"
                placeholderTextColor={T.mute}
                value={formData.description}
                onChangeText={(text) =>
                  setFormData({ ...formData, description: text })
                }
                multiline
              />

              <Text style={[styles.label, { color: T.text }]}>City</Text>
              <TouchableOpacity
                style={[styles.input, { backgroundColor: T.surface, borderColor: T.line }]}
                onPressIn={openJobCityOverlay}
                onPress={openJobCityOverlay}
                activeOpacity={0.92}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="location-outline" size={16} color={T.sub} />
                  <Text
                    style={{
                      color: formData.city ? READABLE_INK : READABLE_MUTED,
                      marginLeft: 8,
                    }}
                  >
                    {formData.city?.label || 'Search for your city'}
                  </Text>
                </View>
              </TouchableOpacity>

              <View style={[styles.remoteRow, { backgroundColor: T.surface, borderColor: T.line }]}>
                <Text style={[styles.remoteLabel, { color: T.text }]}>Remote</Text>
                <CustomToggle
                  value={formData.remote}
                  onChange={(val) =>
                    setFormData({ ...formData, remote: val })
                  }
                />
              </View>
              {!formData.city && formData.remote ? (
                <Text style={[styles.remoteHint, { color: T.mute }]}>
                  City is optional for remote roles.
                </Text>
              ) : null}

              {formData.type === 'Paid' && (
                <>
                  <Text style={[styles.label, { color: T.text }]}>Currency</Text>
                  <TouchableOpacity
                    style={[styles.input, { backgroundColor: T.surface, borderColor: T.line }]}
                    onPress={() => setCurrencyOverlayVisible(true)}
                    activeOpacity={0.92}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                    >
                      <Ionicons
                        name="cash-outline"
                        size={16}
                        color={T.sub}
                      />
                      <Text
                        style={{
                          color: T.text,
                          marginLeft: 8,
                        }}
                      >
                        {formData.currency}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <Text style={[styles.label, { color: T.text }]}>Pay Type</Text>
                  <TouchableOpacity
                    style={[styles.input, { backgroundColor: T.surface, borderColor: T.line }]}
                    onPress={() => setRateOverlayVisible(true)}
                    activeOpacity={0.92}
                  >
                    <View
                      style={{
                        flexDirection: 'row',
                        alignItems: 'center',
                      }}
                    >
                      <Ionicons
                        name="pricetag-outline"
                        size={16}
                        color={T.sub}
                      />
                      <Text
                        style={{
                          color: T.text,
                          marginLeft: 8,
                        }}
                      >
                        {formData.rate}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <Text style={[styles.label, { color: T.text }]}>Amount</Text>
                  <TextInput
                    style={[
                      styles.input,
                      { backgroundColor: T.surface, borderColor: T.line, color: T.text },
                      WEB_NO_OUTLINE,
                    ]}
                    placeholder="Amount"
                    placeholderTextColor={T.mute}
                    keyboardType="numeric"
                    value={formData.amount}
                    onChangeText={(a) =>
                      setFormData({ ...formData, amount: a })
                    }
                  />
                </>
              )}

              <Text style={[styles.label, { color: T.text }]}>Time</Text>
              <TextInput
                style={[
                  styles.input,
                  { backgroundColor: T.surface, borderColor: T.line, color: T.text },
                  WEB_NO_OUTLINE,
                ]}
                placeholder="e.g. 3-day shoot"
                placeholderTextColor={T.mute}
                value={formData.time}
                onChangeText={(t) =>
                  setFormData({ ...formData, time: t })
                }
              />
            </ScrollView>

          

            {/* Inline Role Search */}
            {jobRoleOverlayVisible && (
              <View
  style={[
    styles.inlineOverlay,
    { paddingTop: 0, justifyContent: 'flex-start' },
  ]}
>
  <View
    style={[
                    styles.inlineSheet,
      { marginTop: insets.top + 28, backgroundColor: T.surface, borderColor: T.line },
    ]}
  >
                  <View style={[styles.modalChromeLine, { backgroundColor: GOLD }]} />
                  <Text style={[styles.modalTitle, { color: T.text }]}>Search Role</Text>
                  <TextInput
                    placeholder="Start typing…"
                    placeholderTextColor={READABLE_MUTED}
                    value={roleSearchTerm}
                    onChangeText={(t) => setRoleSearchTerm(t)}
                    style={[styles.searchInput, { backgroundColor: T.surface, borderColor: T.line, color: READABLE_INK }, WEB_NO_OUTLINE]}
                    autoFocus
                  />
                  <FlatList
                    data={roleItems}
                    keyExtractor={roleKey}
                    keyboardShouldPersistTaps="handled"
                    renderItem={renderRoleItem}
                    style={{ maxHeight: '70%' as any }}
                    removeClippedSubviews={false}
                    windowSize={10}
                    initialNumToRender={12}
                  />
                  <TouchableOpacity
                    onPress={() => setJobRoleOverlayVisible(false)}
                    style={[styles.closeModalButton, { backgroundColor: T.surface2, borderColor: T.line }]}
                    activeOpacity={0.92}
                  >
                    <Text style={[styles.closeModalText, { color: T.sub }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Inline Currency Picker */}
            {currencyOverlayVisible && (
              <View
  style={[
    styles.inlineOverlay,
    { paddingTop: 0, justifyContent: 'flex-start' },
  ]}
>
  <View
    style={[
      styles.inlineSheet,
      { marginTop: insets.top + 28, backgroundColor: T.surface, borderColor: T.line },
    ]}
  >
                  <View style={[styles.modalChromeLine, { backgroundColor: GOLD }]} />
                  <Text style={[styles.modalTitle, { color: T.text }]}>Select Currency</Text>
                  <FlatList
                    data={currencyItems}
                    keyExtractor={(v) => v}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={[styles.listPickerItem, { borderBottomColor: T.line }]}
                        onPress={() => {
                          setFormData((p) => ({
                            ...p,
                            currency: item,
                          }));
                          setCurrencyOverlayVisible(false);
                        }}
                        activeOpacity={0.9}
                      >
                        <Text style={[styles.listPickerText, { color: T.text }]}>{item}</Text>
                      </TouchableOpacity>
                    )}
                  />
                  <TouchableOpacity
                    onPress={() => setCurrencyOverlayVisible(false)}
                    style={[styles.closeModalButton, { backgroundColor: T.surface2, borderColor: T.line }]}
                    activeOpacity={0.92}
                  >
                    <Text style={[styles.closeModalText, { color: T.sub }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Inline Rate Picker */}
            {rateOverlayVisible && (
              <View
  style={[
    styles.inlineOverlay,
    { paddingTop: 0, justifyContent: 'flex-start' },
  ]}
>
  <View
    style={[
      styles.inlineSheet,
      { marginTop: insets.top + 28, backgroundColor: T.surface, borderColor: T.line },
    ]}
  >
                  <View style={[styles.modalChromeLine, { backgroundColor: GOLD }]} />
                  <Text style={[styles.modalTitle, { color: T.text }]}>Select Pay Type</Text>
                  <FlatList
                    data={rateItems}
                    keyExtractor={(v) => v}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={[styles.listPickerItem, { borderBottomColor: T.line }]}
                        onPress={() => {
                          setFormData((p) => ({
                            ...p,
                            rate: item,
                          }));
                          setRateOverlayVisible(false);
                        }}
                        activeOpacity={0.9}
                      >
                        <Text style={[styles.listPickerText, { color: T.text }]}>{item}</Text>
                      </TouchableOpacity>
                    )}
                  />
                  <TouchableOpacity
                    onPress={() => setRateOverlayVisible(false)}
                    style={[styles.closeModalButton, { backgroundColor: T.surface2, borderColor: T.line }]}
                    activeOpacity={0.92}
                  >
                    <Text style={[styles.closeModalText, { color: T.sub }]}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Sticky footer */}
            <View style={[styles.modalFooter, { backgroundColor: T.bg, borderTopColor: T.line }]}>
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerGhost, { backgroundColor: T.surface2, borderColor: T.line }]}
                onPress={() => setJobFormVisible(false)}
                activeOpacity={0.9}
              >
                <Text style={[styles.footerGhostText, { color: T.sub }]}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.footerBtn, styles.footerPrimary, { backgroundColor: GOLD, borderColor: GOLD_LINE }]}
                onPress={handlePostJob}
                activeOpacity={0.9}
              >
                <Text style={[styles.footerPrimaryText, { color: colors.textOnPrimary }]}>Submit Job</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SmoothModal>

            {/* Job City Search Modal */}
      <Modal
        visible={jobCityOverlayVisible}
        animationType={nativeLikeModalAnimation}
        onRequestClose={() => setJobCityOverlayVisible(false)}
      >
        <SafeAreaView style={[styles.cityModalSafeArea, { backgroundColor: T.bg }]} edges={['top']}>
          <View style={[styles.cityModalShell, { backgroundColor: T.bg }]}>
            <View style={styles.cityModalHeader}>
              <Text style={[styles.cityModalTitle, { color: T.text }]}>Choose a city</Text>

              <TouchableOpacity
                onPress={() => setJobCityOverlayVisible(false)}
                style={[styles.cityModalCloseIcon, { backgroundColor: T.surface, borderColor: T.line }]}
                activeOpacity={0.85}
              >
                <Ionicons name="close" size={18} color={T.text} />
              </TouchableOpacity>
            </View>

            <TextInput
              ref={citySearchInputRef}
              placeholder="Start typing a city..."
              placeholderTextColor={READABLE_MUTED}
              value={citySearchTerm}
              onChangeText={(text) => {
                setCitySearchTerm(text);
                scheduleCitySearch(text);
              }}
              style={[
                styles.citySearchInput,
                { backgroundColor: T.surface, borderColor: T.line, color: READABLE_INK },
                WEB_NO_OUTLINE,
              ]}
              autoFocus
            />

            {searchingCities ? (
              <View style={styles.cityModalLoadingWrap}>
                <ActivityIndicator color={GOLD} />
              </View>
            ) : (
              <FlatList
                data={cityItems}
                keyExtractor={cityKey}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.cityListContent}
                renderItem={({ item, index }) => {
                  const selected = formData.city?.value === item.value;

                  return (
                    <TouchableOpacity
                      style={[
                        styles.cityPickerItem,
                        {
                          backgroundColor: selected ? GOLD_SOFT : T.surface,
                          borderColor: selected ? GOLD_LINE : T.line,
                        },
                      ]}
                      onPress={() => {
                        setFormData((prev) => ({ ...prev, city: item }));
                        setJobCityOverlayVisible(false);
                      }}
                      activeOpacity={0.9}
                    >
                      <View style={styles.cityPickerItemLeft}>
                        <View
                          style={[
                            styles.radioOuter,
                            selected && styles.radioOuterSelected,
                          ]}
                        >
                          {selected ? <View style={styles.radioInner} /> : null}
                        </View>

                        <Text
                          style={[
                            styles.cityPickerText,
                            selected && styles.cityPickerTextSelected,
                            { color: READABLE_INK },
                          ]}
                        >
                          {item.label}
                        </Text>
                      </View>

                      {index === 0 && parseCityQuery(citySearchTerm).cityQuery.length >= 3 ? (
                        <View style={styles.bestMatchBadge}>
                          <Text style={styles.bestMatchText}>Best match</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  citySearchTerm.trim().length >= 2 ? (
                    <View style={styles.emptySearchState}>
                      <Text style={styles.emptyText}>No matching cities found.</Text>
                    </View>
                  ) : null
                }
              />
            )}

            <TouchableOpacity
              onPress={() => setJobCityOverlayVisible(false)}
              style={[styles.cityModalCancelButton, { backgroundColor: T.surface, borderColor: T.line }]}
              activeOpacity={0.92}
            >
              <Text style={[styles.cityModalCancelText, { color: READABLE_INK }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>

   
                  {/* City Filter Modal */}
      <Modal
        visible={cityFilterModalVisible}
        animationType={nativeLikeModalAnimation}
        onRequestClose={() => setCityFilterModalVisible(false)}
      >
        <SafeAreaView style={[styles.cityModalSafeArea, { backgroundColor: T.bg }]} edges={['top']}>
          <View style={[styles.cityModalShell, { backgroundColor: T.bg }]}>
            <View style={styles.cityModalHeader}>
              <Text style={[styles.cityModalTitle, { color: T.text }]}>Choose a city</Text>

              <TouchableOpacity
                onPress={() => setCityFilterModalVisible(false)}
                style={[styles.cityModalCloseIcon, { backgroundColor: T.surface, borderColor: T.line }]}
                activeOpacity={0.85}
              >
                <Ionicons name="close" size={18} color={T.text} />
              </TouchableOpacity>
            </View>

            <TextInput
              placeholder="Start typing a city..."
              placeholderTextColor={READABLE_MUTED}
              value={cityFilterSearchTerm}
              onChangeText={(text) => {
                setCityFilterSearchTerm(text);
                scheduleCityFilterSearch(text);
              }}
              style={[
                styles.citySearchInput,
                { backgroundColor: T.surface, borderColor: T.line, color: READABLE_INK },
                WEB_NO_OUTLINE,
              ]}
              autoFocus
            />

            {searchingFilterCities ? (
              <View style={styles.cityModalLoadingWrap}>
                <ActivityIndicator color={GOLD} />
              </View>
            ) : (
              <FlatList
                data={cityFilterItems}
                keyExtractor={(item) => String(item.value)}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.cityListContent}
                renderItem={({ item, index }) => {
                  const selected = filterCity?.value === item.value;

                  return (
                    <TouchableOpacity
                      style={[
                        styles.cityPickerItem,
                        {
                          backgroundColor: selected ? GOLD_SOFT : T.surface,
                          borderColor: selected ? GOLD_LINE : T.line,
                        },
                      ]}
                      onPress={() => {
                        setFilterCity(item);
                        setCityFilterModalVisible(false);
                      }}
                      activeOpacity={0.9}
                    >
                      <View style={styles.cityPickerItemLeft}>
                        <View
                          style={[
                            styles.radioOuter,
                            selected && styles.radioOuterSelected,
                            { borderColor: selected ? GOLD : T.sub },
                          ]}
                        >
                          {selected ? <View style={[styles.radioInner, { backgroundColor: GOLD }]} /> : null}
                        </View>

                        <Text
                          style={[
                            styles.cityPickerText,
                            { color: READABLE_INK },
                            selected && { color: READABLE_INK, fontWeight: '800' },
                          ]}
                        >
                          {item.label}
                        </Text>
                      </View>

                      {index === 0 && parseCityQuery(cityFilterSearchTerm).cityQuery.length >= 3 ? (
                        <View style={[styles.bestMatchBadge, { backgroundColor: GOLD_SOFT, borderColor: GOLD_LINE }]}>
                          <Text style={[styles.bestMatchText, { color: GOLD }]}>Best match</Text>
                        </View>
                      ) : null}
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  cityFilterSearchTerm.trim().length >= 2 ? (
                    <View style={styles.emptySearchState}>
                      <Text style={[styles.emptyText, { color: T.sub }]}>No matching cities found.</Text>
                    </View>
                  ) : null
                }
              />
            )}

            <TouchableOpacity
              onPress={() => setCityFilterModalVisible(false)}
              style={[styles.cityModalCancelButton, { backgroundColor: T.surface, borderColor: T.line }]}
              activeOpacity={0.92}
            >
              <Text style={[styles.cityModalCancelText, { color: T.text }]}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </Modal>
      {/* Role Filter Modal */}
      <Modal
        visible={roleFilterModalVisible}
        animationType={nativeLikeModalAnimation}
        onRequestClose={() => setRoleFilterModalVisible(false)}
      >
        <View style={[styles.modalContainer, { backgroundColor: T.bg }]}>
          <View style={[styles.modalChromeLine, { backgroundColor: GOLD }]} />
          <Text style={[styles.modalTitle, { color: T.text }]}>Filter by Role</Text>
          <TextInput
            style={[
              styles.searchInput,
              { backgroundColor: T.surface, borderColor: T.line, color: READABLE_INK },
              WEB_NO_OUTLINE,
            ]}
            placeholder="Start typing a role…"
            placeholderTextColor={READABLE_MUTED}
            value={roleFilterSearchTerm}
            autoFocus
            onChangeText={(t) => {
              setRoleFilterSearchTerm(t);
              void fetchFilterRoles(t);
            }}
          />
          <FlatList
            data={roleFilterItems}
            keyExtractor={(i) => String(i.value)}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.listPickerItem, { borderBottomColor: T.line }]}
                onPress={() => {
                  setFilterRole(item);
                  setRoleFilterModalVisible(false);
                }}
                activeOpacity={0.9}
              >
                <Text style={[styles.listPickerText, { color: READABLE_INK }]}>{item.label}</Text>
              </TouchableOpacity>
            )}
            removeClippedSubviews={false}
            windowSize={10}
            initialNumToRender={12}
          />
          <TouchableOpacity
            onPress={() => setRoleFilterModalVisible(false)}
            style={[styles.closeModalButton, { backgroundColor: T.surface, borderColor: T.line }]}
            activeOpacity={0.92}
          >
            <Text style={[styles.closeModalText, { color: T.text }]}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Creator Challenge Detail */}
      <SmoothModal
        visible={!!selectedChallenge}
        enterOffset={96}
        frameStyle={{ backgroundColor: T.bg }}
        onRequestClose={() => setSelectedChallenge(null)}
      >
        <SafeAreaView style={[styles.cityModalSafeArea, { backgroundColor: T.bg }]} edges={['top']}>
          <View style={[styles.challengeDetailShell, { backgroundColor: T.bg }]}>
            {selectedChallenge ? (
              <>
                <View style={[styles.cityModalHeader, styles.challengeDetailTopBar]}>
                  <TouchableOpacity
                    onPress={() => setSelectedChallenge(null)}
                    style={[styles.challengeCloseIcon, { backgroundColor: T.surface, borderColor: T.line }]}
                    activeOpacity={0.9}
                  >
                    <Ionicons name="close" size={18} color={T.text} />
                  </TouchableOpacity>
                  <Text style={[styles.challengeDetailHeader, { color: challengeTone.gold }]}>Creator Challenge</Text>
                  <View style={{ width: 44 }} />
                </View>

                <ScrollView
                  style={styles.challengeDetailScroll}
                  contentContainerStyle={styles.challengeDetailContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View
                    style={[
                      styles.challengeDetailHero,
                      { backgroundColor: challengeTone.surface, borderColor: challengeTone.border },
                    ]}
                  >
                    <View style={styles.challengeDetailHeroBadgeRow}>
                      <View
                        style={[
                          styles.challengeTypeBadge,
                          { backgroundColor: challengeTone.goldSoft, borderColor: challengeTone.border },
                        ]}
                      >
                        <Ionicons name="sparkles-outline" size={13} color={challengeTone.gold} />
                        <Text style={[styles.challengeTypeBadgeText, { color: challengeTone.gold }]}>
                          CREATOR CHALLENGE
                        </Text>
                      </View>
                      <View
                        style={[
                          styles.challengeCountdownBadge,
                          {
                            backgroundColor: isChallengeEnded(selectedChallenge)
                              ? T.surface2
                              : challengeTone.goldSoft,
                            borderColor: isChallengeEnded(selectedChallenge)
                              ? T.line
                              : challengeTone.border,
                          },
                        ]}
                      >
                        <Ionicons
                          name="timer-outline"
                          size={13}
                          color={isChallengeEnded(selectedChallenge) ? T.mute : challengeTone.gold}
                        />
                        <Text
                          style={[
                            styles.challengeCountdownBadgeText,
                            { color: isChallengeEnded(selectedChallenge) ? T.mute : challengeTone.gold },
                          ]}
                        >
                          {isChallengeEnded(selectedChallenge)
                            ? 'ENDED'
                            : formatChallengeCountdownCompact(selectedChallenge.ends_at).toUpperCase()}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.challengeDetailHeroTopRow}>
                      <TouchableOpacity
                        onPress={() => goToCreatorProfile(selectedChallenge)}
                        activeOpacity={0.8}
                        style={styles.creatorAvatarTap}
                      >
                        {renderCreatorAvatar(getCreatorProfile(selectedChallenge), 52)}
                      </TouchableOpacity>
                      <View style={styles.challengeTitleBlock}>
                        <Text style={[styles.challengeDetailTitle, { color: challengeTone.text }]}>
                          {selectedChallenge.title}
                        </Text>
                        <View style={styles.challengeCreatorRow}>
                          <Text style={[styles.challengeCreatorPrefix, { color: challengeTone.sub }]}>Hosted by </Text>
                          <TouchableOpacity
                            onPress={() => goToCreatorProfile(selectedChallenge)}
                            activeOpacity={0.75}
                          >
                            <Text style={[styles.challengeCreatorLink, { color: challengeTone.gold }]} numberOfLines={1}>
                              {getCreatorProfile(selectedChallenge)?.full_name || 'Overlooked creator'}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    </View>

                    <View style={[styles.challengeDetailStatsRow, isWebMobile && styles.challengeDetailStatsStack]}>
                      <View style={[styles.challengeStatBox, { backgroundColor: challengeTone.surfaceAlt, borderColor: T.line }]}>
                        <Text style={[styles.challengeStatLabel, { color: challengeTone.gold }]}>Deadline</Text>
                        <Text style={[styles.challengeStatValue, { color: challengeTone.text }]}>
                          {formatChallengeDeadline(selectedChallenge.ends_at)}
                        </Text>
                      </View>
                      <View style={[styles.challengeStatBox, { backgroundColor: challengeTone.surfaceAlt, borderColor: T.line }]}>
                        <Text style={[styles.challengeStatLabel, { color: challengeTone.gold }]}>Entries</Text>
                        <Text style={[styles.challengeStatValue, { color: challengeTone.text }]}>
                          {formatChallengeEntriesLabel(selectedChallenge.submission_count)}
                        </Text>
                      </View>
                    </View>
                  </View>

                  <View style={[styles.challengeDetailSection, { backgroundColor: challengeTone.surface, borderColor: T.line }]}>
                    <Text style={[styles.challengeDetailSectionTitle, { color: challengeTone.gold }]}>Challenge brief</Text>
                    <Text style={[styles.challengeDetailBody, { color: challengeTone.sub }]}>
                      {selectedChallenge.description || 'No challenge brief added yet.'}
                    </Text>
                  </View>

                  <View style={[styles.challengeDetailSection, { backgroundColor: challengeTone.surface, borderColor: T.line }]}>
                    <Text style={[styles.challengeDetailSectionTitle, { color: challengeTone.gold }]}>Rules</Text>
                    <Text style={[styles.challengeDetailBody, { color: challengeTone.sub }]}>
                      {selectedChallenge.rules || 'Follow the brief and submit original work.'}
                    </Text>
                  </View>

                  <View style={[styles.challengeDetailSection, { backgroundColor: challengeTone.surface, borderColor: T.line }]}>
                    <Text style={[styles.challengeDetailSectionTitle, { color: challengeTone.gold }]}>Required element</Text>
                    <Text style={[styles.challengeDetailBody, { color: challengeTone.sub }]}>
                      {selectedChallenge.required_phrase || 'No required phrase.'}
                    </Text>
                  </View>

                  <View
                    style={[
                      styles.challengeDetailSection,
                      styles.challengeRewardDetailSection,
                      { backgroundColor: challengeTone.goldSoft, borderColor: challengeTone.border },
                    ]}
                  >
                    <View style={styles.challengeDetailSectionHeaderRow}>
                      <Ionicons name="gift-outline" size={17} color={challengeTone.gold} />
                      <Text style={[styles.challengeDetailSectionTitle, { color: challengeTone.gold, marginBottom: 0 }]}>
                        What you can win
                      </Text>
                    </View>
                    <Text style={[styles.challengeDetailBody, { color: challengeTone.text }]}>
                      {selectedChallenge.prize_description || 'Reward TBA.'}
                    </Text>
                  </View>

                  <View style={[styles.challengeDetailSection, { backgroundColor: challengeTone.surface, borderColor: T.line }]}>
                    <Text style={[styles.challengeDetailSectionTitle, { color: challengeTone.gold }]}>
                      Where your work can be seen
                    </Text>
                    <View style={[styles.challengeReactionPill, { backgroundColor: challengeTone.surfaceAlt, borderColor: T.line }]}>
                      <Ionicons name="at-outline" size={15} color={challengeTone.gold} />
                      <Text style={[styles.challengeReactionPillText, { color: challengeTone.text }]}>
                        {formatReactionPill(
                          selectedChallenge.reaction_platform ||
                            getCreatorProfile(selectedChallenge)?.creator_social_platform ||
                            'Creator'
                        )}
                      </Text>
                    </View>
                    {selectedChallenge.reaction_description ? (
                      <Text style={[styles.challengeDetailBody, { color: challengeTone.sub, marginTop: 10 }]}>
                        {selectedChallenge.reaction_description}
                      </Text>
                    ) : null}
                    {(() => {
                      const links = parseReactionLinks(
                        selectedChallenge.reaction_url ||
                          getCreatorProfile(selectedChallenge)?.creator_social_url
                      );
                      if (!links.length) return null;

                      return (
                        <View style={styles.challengeLinksList}>
                          {links.map((link, index) => (
                            <TouchableOpacity
                              key={`${link}-${index}`}
                              activeOpacity={0.75}
                              onPress={() => openReactionUrl(link)}
                              style={styles.challengeLinkRow}
                            >
                              <Ionicons name="link-outline" size={15} color={challengeTone.gold} />
                              <Text style={[styles.challengeDetailLink, { color: challengeTone.gold }]} numberOfLines={1}>
                                {link}
                              </Text>
                            </TouchableOpacity>
                          ))}
                        </View>
                      );
                    })()}
                  </View>

                </ScrollView>

                <View
                  style={[
                    styles.modalFooter,
                    styles.challengeActionBar,
                    {
                      backgroundColor: T.bg,
                      borderTopColor: challengeTone.border,
                      shadowColor: challengeTone.shadow,
                    },
                  ]}
                >
                  {selectedChallenge.creator_id === currentUserId ? (
                    <TouchableOpacity
                      style={[
                        styles.footerBtn,
                        styles.challengeDetailActionButton,
                        styles.footerDanger,
                        !isWebMobile && styles.challengeFooterDanger,
                        { backgroundColor: T.surface2, borderColor: 'rgba(255,70,70,0.24)' },
                        challengeDeleting[selectedChallenge.id] && { opacity: 0.58 },
                      ]}
                      onPress={() => handleRemoveChallenge(selectedChallenge)}
                      disabled={!!challengeDeleting[selectedChallenge.id]}
                      activeOpacity={0.9}
                    >
                      <Ionicons name="trash-outline" size={14} color={challengeTone.danger} />
                      <Text style={[styles.footerDangerText, { color: challengeTone.danger }]}>
                        {challengeDeleting[selectedChallenge.id] ? 'Removing' : 'Remove'}
                      </Text>
                    </TouchableOpacity>
                  ) : null}

                  <TouchableOpacity
                    style={[
                      styles.footerBtn,
                      styles.challengeDetailActionButton,
                      styles.footerGhost,
                      !isWebMobile && styles.challengeFooterSecondary,
                      { backgroundColor: T.surface2, borderColor: T.line },
                    ]}
                    onPress={() => openChallengeSubmissions(selectedChallenge)}
                    activeOpacity={0.9}
                  >
                    <Text style={[styles.footerGhostText, { color: T.sub }]}>View Entries</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[
                      styles.footerBtn,
                      styles.challengeDetailActionButton,
                      styles.footerPrimary,
                      !isWebMobile && styles.challengeFooterPrimary,
                      {
                        backgroundColor: isChallengeEnded(selectedChallenge)
                          ? T.surface2
                          : challengeTone.gold,
                        borderColor: isChallengeEnded(selectedChallenge)
                          ? T.line
                          : challengeTone.border,
                      },
                      isChallengeEnded(selectedChallenge) && { opacity: 0.72 },
                    ]}
                    onPress={() => handleSubmitToChallenge(selectedChallenge)}
                    disabled={isChallengeEnded(selectedChallenge)}
                    activeOpacity={0.9}
                  >
                    <Text
                      style={[
                        styles.footerPrimaryText,
                        { color: isChallengeEnded(selectedChallenge) ? T.mute : colors.textOnPrimary },
                      ]}
                    >
                      {isChallengeEnded(selectedChallenge) ? 'Challenge Ended' : 'Submit to this Challenge'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : null}
          </View>
        </SafeAreaView>
      </SmoothModal>

      {/* Job Detail / Apply Modal */}
      <Modal
  visible={!!selectedJob}
  transparent
  animationType="fade"
  onRequestClose={() => setSelectedJob(null)}
>
        <View style={styles.detailModalOverlay}>
  <View style={styles.detailModalCard}>
    {selectedJob && (
      <>
              <Text
                style={[styles.modalTitle, { marginBottom: 4 }]}
              >
                {decode(selectedJob.creative_roles?.name || 'Job')}
              </Text>

              <Text style={styles.keyValue}>
                <Text style={styles.keyLabel}>Pay: </Text>
                <Text style={styles.keyValueText}>
                  {selectedJob.type === 'Paid'
                    ? `${selectedJob.currency ?? ''}${selectedJob.amount ?? ''}${
                        selectedJob.rate ? ` • ${selectedJob.rate}` : ''
                      }`
                    : 'Free / Collaboration'}
                </Text>
              </Text>

              <Text style={styles.keyValue}>
                <Text style={styles.keyLabel}>Location: </Text>
                <Text style={styles.keyValueText}>
                  {selectedJob.remote
                    ? 'Remote'
                    : selectedJob.cities?.name || 'Unknown'}
                </Text>
              </Text>

              {selectedJob.description ? (
                <Text
                  style={[
                    styles.jobDescription,
                    { marginTop: 8 },
                  ]}
                >
                  {decode(selectedJob.description)}
                </Text>
              ) : null}

              <View
                style={[
                  styles.metaRow,
                  { marginTop: 8 },
                ]}
              >
                <Ionicons
                  name="person-outline"
                  size={16}
                  color={T.sub}
                  style={{ marginRight: 6 }}
                />
                <TouchableOpacity
                  onPress={() => {
                    const u = selectedJob.users || undefined;
                    if (u?.id) {
                      goToProfile(u);
                    }
                  }}
                  activeOpacity={0.8}
                >
                  <Text style={styles.posterName}>
                    {selectedJob.users?.full_name || 'View Profile'}
                  </Text>
                </TouchableOpacity>
              </View>
              

              {selectedJob.time ? (
                <View
                  style={[
                    styles.metaRow,
                    { marginTop: 8 },
                  ]}
                >
                  <IconText
                    name="calendar-outline"
                    text={selectedJob.time}
                  />
                </View>
              ) : null}

              {selectedJob.created_at ? (
                <View
                  style={[
                    styles.metaRow,
                    { marginTop: 8 },
                  ]}
                >
                  <IconText
                    name="time-outline"
                    text={`Posted ${formatTimeAgo(selectedJob.created_at)}`}
                  />
                </View>
              ) : null}

              <View style={styles.safetyActionsRow}>
                <TouchableOpacity
                  style={styles.safetyActionButton}
                  onPress={() => openJobReport(selectedJob)}
                  activeOpacity={0.85}
                >
                  <Ionicons name="flag-outline" size={15} color={T.sub} />
                  <Text style={styles.safetyActionText}>Report</Text>
                </TouchableOpacity>

                {selectedJob.user_id !== currentUserId ? (
                  <TouchableOpacity
                    style={[styles.safetyActionButton, styles.safetyDangerButton]}
                    onPress={() => blockJobPoster(selectedJob)}
                    activeOpacity={0.85}
                  >
                    <Ionicons name="ban-outline" size={15} color="#FF8A8A" />
                    <Text style={[styles.safetyActionText, { color: '#FF8A8A' }]}>Block User</Text>
                  </TouchableOpacity>
                ) : null}
              </View>

              <Text style={styles.safetyCopy}>
                We review objectionable content reports within 24 hours.
              </Text>

              <TouchableOpacity
                style={[
                  styles.submitButton,
                  {
                    marginTop: 16,
                    opacity:
                      checkingApplied || alreadyApplied
                        ? 0.7
                        : 1,
                  },
                ]}
                onPress={handleApply}
                disabled={
                  applyLoading ||
                  checkingApplied ||
                  alreadyApplied
                }
                activeOpacity={0.92}
              >
                {applyLoading || checkingApplied ? (
                  <ActivityIndicator color="#000" />
                ) : alreadyApplied ? (
                  <Text style={styles.submitText}>
                    Already applied
                  </Text>
                ) : (
                  <Text style={styles.submitText}>
                    Apply
                  </Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setSelectedJob(null)}
                style={{ marginTop: 12 }}
              >
                <Text style={styles.cancelText}>Close</Text>
              </TouchableOpacity>
                  </>
    )}
  </View>
</View>
</Modal>

      {/* Success Confirmation Modal */}
      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={styles.confirmOverlay}>
          <View style={styles.confirmCard}>
            <Ionicons
              name="checkmark-circle"
              size={48}
              color={T.accent}
              style={{
                alignSelf: 'center',
                marginBottom: 8,
              }}
            />
            <Text style={styles.confirmTitle}>
              Success
            </Text>
            <Text style={styles.confirmText}>
              Application sent. Your profile was shared with the poster.
            </Text>

            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerPrimary]}
                onPress={() => setConfirmVisible(false)}
                activeOpacity={0.92}
              >
                <Text style={styles.footerPrimaryText}>
                  OK
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Tier / Upgrade Modal */}
<UpgradeModal
  visible={upgradeVisible}
  context={upgradeContext}
  onClose={() => setUpgradeVisible(false)}
  onSelectPro={() => {
    setUpgradeVisible(false);
    show('Pro upgrade flow coming soon.', 'info');
  }}
/>
      <ReportContentModal
        visible={!!reportTargetJob}
        selectedReason={reportReason}
        details={reportDetails}
        submitting={reportSubmitting}
        onReasonChange={setReportReason}
        onDetailsChange={setReportDetails}
        onClose={() => {
          if (!reportSubmitting) setReportTargetJob(null);
        }}
        onSubmit={submitJobReport}
      />
        </View>
  </SafeAreaView>
  );
}

/* ────────────────────────────────────────────────────────────
   Styles — flatter, noir, gamified helper text
   ──────────────────────────────────────────────────────────── */
const RADIUS = 8;

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: T.bg,
  },
  container: {
    flex: 1,
    backgroundColor: T.bg,
  },

  /* Toast */
  toastContainer: {
    position: 'absolute',
    top: 8,
    left: 12,
    right: 12,
    zIndex: 9999,
  },
  toastInner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 1,
  },
  toastText: {
    color: T.text,
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
    flexShrink: 1,
  },

  /* Optional old gamification spacing */
  levelBannerWrap: {
    paddingHorizontal: 16,
    paddingTop: 4,
    paddingBottom: 2,
  },
  levelHint: {
    color: T.sub,
    fontSize: 10,
    marginTop: 3,
    marginLeft: 2,
    fontFamily: SYSTEM_SANS,
  },

  /* Hero */
  heroWrap: {
    paddingHorizontal: 16,
  },
  heroCard: {
    backgroundColor: T.surface2,
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: T.lineSoft,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  heroTopRow: {
  flexDirection: 'row',
  justifyContent: 'center',
  alignItems: 'center',
  marginBottom: 14,
},
  heroEyebrowPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: T.lineSoft,
  },
  heroEyebrow: {
    color: GOLD,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  heroStatsPill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: T.lineSoft,
  },
  heroStatsText: {
    color: T.sub,
    fontSize: 11,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
  },
  heroTitle: {
    color: T.text,
    fontSize: 20,
    lineHeight: 27,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
    marginBottom: 8,
  },
  heroSubtitle: {
    color: T.sub,
    fontSize: 13,
    lineHeight: 20,
    fontFamily: SYSTEM_SANS,
  },
  sectionSpacer: {
    height: 10,
  },

  listHeaderRoot: {
    paddingTop: Platform.OS === 'web' ? 4 : 12,
    alignItems: 'center',
  },

  opportunitiesHeader: {
    width: '100%',
    maxWidth: 1000,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 16,
  },

  opportunitiesTitle: {
    fontFamily: SYSTEM_SANS,
    fontSize: Platform.OS === 'web' ? 36 : 29,
    lineHeight: Platform.OS === 'web' ? 41 : 34,
    fontWeight: '800',
    letterSpacing: 0,
    textAlign: 'center',
  },

  opportunitiesSubtitle: {
    marginTop: 7,
    maxWidth: 600,
    fontFamily: SYSTEM_SANS,
    fontSize: Platform.OS === 'web' ? 15 : 14,
    lineHeight: 21,
    fontWeight: '600',
    textAlign: 'center',
  },

  opportunityTabsWrap: {
    width: '100%',
    paddingHorizontal: 16,
    alignItems: 'center',
  },

  opportunityTabsShell: {
    width: '90%',
    maxWidth: 420,
    height: 44,
    padding: 4,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 4,
  },

  opportunitySegmentTap: {
    flex: 1,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },

  opportunitySegmentTapActive: {
    shadowOpacity: Platform.OS === 'web' ? 0.06 : 0.04,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },

  opportunitySegmentText: {
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  /* Category tabs */
  categoryTabsWrap: {
    paddingHorizontal: 16,
    marginTop: 18,
    width: '100%',
    alignItems: 'center',
  },
  categoryTabsRow: {
  flexDirection: 'row',
  alignSelf: 'center',
  justifyContent: 'center',
  alignItems: 'center',
  gap: 8,
},
categoryTap: {
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: 82,
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 8,
  backgroundColor: T.surface2,
  borderWidth: 1,
  borderColor: T.lineSoft,
},
  categoryTapActive: {
    backgroundColor: GOLD_SOFT,
    borderColor: GOLD_LINE,
  },
  categoryText: {
    color: '#D0CCC4',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontSize: 12,
    fontWeight: '700',
  },
  categoryTextActive: {
    color: GOLD,
  },
  
  categoryUnderline: {
    marginTop: 6,
    height: 2,
    width: 26,
    backgroundColor: GOLD,
    borderRadius: 999,
  },
  detailModalOverlay: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.6)',
  justifyContent: 'center',
  alignItems: 'center',
  paddingHorizontal: 20,
},

detailModalCard: {
  width: '100%',
  maxWidth: 460,
  backgroundColor: T.surface2,
  borderRadius: 12,
  paddingHorizontal: 20,
  paddingVertical: 22,
  borderWidth: 1,
  borderColor: T.lineSoft,
  shadowColor: '#000',
  shadowOpacity: 0.12,
  shadowRadius: 12,
  shadowOffset: { width: 0, height: 5 },
  elevation: 2,
},

  /* Filters */
  filtersInline: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  flexWrap: 'wrap',
  paddingHorizontal: 16,
  paddingTop: 12,
  paddingBottom: 16,
},
filterPill: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minHeight: 32,
  paddingHorizontal: 12,
  paddingVertical: 6,
  borderRadius: 10,
  backgroundColor: T.surface2,
  borderWidth: 1,
  borderColor: T.lineSoft,
},
  filterPillActive: {
    backgroundColor: GOLD_SOFT,
    borderColor: GOLD_LINE,
  },
  filterPillText: {
    color: T.sub,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },
  filterPillTextActive: {
    color: GOLD,
  },
  remoteFilterPill: {
  minWidth: 108,
  paddingHorizontal: 12,
},
  filterToggleLabel: {
    color: T.sub,
    fontSize: 12.5,
    marginRight: 8,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },
  clearPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: T.lineSoft,
  },
  clearPillText: {
    color: T.sub,
    fontSize: 12.5,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },
  listDivider: {
    height: 1,
    backgroundColor: T.line,
    marginTop: 8,
  },

  opportunityTap: {
    minWidth: 136,
  },

  creatorSectionHeader: {
    width: '100%',
    maxWidth: 1000,
    paddingHorizontal: 16,
    marginBottom: 16,
    flexDirection: Platform.OS === 'web' ? 'row' : 'column',
    alignItems: Platform.OS === 'web' ? 'center' : 'stretch',
    justifyContent: 'space-between',
    gap: 12,
  },

  creatorSectionHeaderStack: {
    flexDirection: 'column',
    alignItems: 'stretch',
  },

  creatorSectionHeaderNoFilters: {
    marginTop: 16,
  },

  creatorSectionCopy: {
    flex: 1,
    minWidth: 0,
  },

  creatorSectionTitle: {
    fontFamily: SYSTEM_SANS,
    fontSize: Platform.OS === 'web' ? 23 : 21,
    lineHeight: Platform.OS === 'web' ? 28 : 25,
    fontWeight: '700',
    letterSpacing: 0,
  },

  creatorSectionSubtitle: {
    marginTop: 4,
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  creatorValueRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  creatorValueChip: {
    minHeight: 28,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    justifyContent: 'center',
  },
  creatorValueChipText: {
    fontFamily: SYSTEM_SANS,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  sectionPostButton: {
    minHeight: Platform.OS === 'web' ? 40 : 44,
    borderRadius: Platform.OS === 'web' ? 10 : 12,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    alignSelf: Platform.OS === 'web' ? 'auto' : 'stretch',
  },

  sectionPostButtonFull: {
    alignSelf: 'stretch',
  },

  sectionPostButtonText: {
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },

  creatorApprovalNote: {
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    alignSelf: Platform.OS === 'web' ? 'center' : 'flex-start',
  },

  /* Creator challenges */
  challengeRow: {
    width: '100%',
    maxWidth: 1000,
    alignSelf: 'center',
    paddingHorizontal: 16,
  },

  challengeCard: {
    backgroundColor: T.surface2,
    borderRadius: 10,
    paddingHorizontal: Platform.OS === 'web' ? 22 : 16,
    paddingVertical: Platform.OS === 'web' ? 22 : 16,
    borderWidth: 1,
    borderColor: GOLD_LINE,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  challengeBadgeRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  challengeTypeBadge: {
    alignSelf: 'flex-start',
    minHeight: 28,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  challengeTypeBadgeText: {
    fontFamily: SYSTEM_SANS,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  challengeCountdownText: {
    flexShrink: 0,
    fontFamily: SYSTEM_SANS,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  challengeHostRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  creatorAvatarTap: {
    flexShrink: 0,
  },
  creatorAvatar: {
    borderWidth: 1,
    backgroundColor: T.surface3,
  },
  creatorAvatarFallback: {
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  creatorAvatarInitials: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 0.7,
  },
  challengeTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  challengeTitle: {
    fontSize: Platform.OS === 'web' ? 21 : 19,
    lineHeight: Platform.OS === 'web' ? 24 : 22,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 0,
  },
  challengeCreatorRow: {
    marginTop: 5,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  challengeCreatorPrefix: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
  },
  challengeCreatorLink: {
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
  },
  challengeDescription: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
    fontFamily: SYSTEM_SANS,
    maxWidth: 750,
  },
  challengeRewardCallout: {
    marginTop: 14,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 13,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  challengeRewardCopy: {
    flex: 1,
    minWidth: 0,
  },
  challengeRewardLabel: {
    fontFamily: SYSTEM_SANS,
    fontSize: 10,
    lineHeight: 13,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    marginBottom: 3,
  },
  challengeRewardText: {
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    lineHeight: 19,
    fontWeight: '700',
  },
  challengeMetaGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 14,
  },
  challengeMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 30,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  challengeMetaText: {
    fontSize: 12,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
    maxWidth: 190,
  },
  challengeActionsRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 16,
  },
  challengeActionsStack: {
    flexDirection: 'column',
  },
  challengeSecondaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeSecondaryButtonWide: {
    flex: 0.36,
  },
  challengeSecondaryButtonText: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  challengePrimaryButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengePrimaryButtonWide: {
    flex: 0.64,
  },
  challengePrimaryButtonText: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  challengeDangerButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 10,
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 6,
  },
  challengeDangerButtonText: {
    fontSize: 12,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  challengeDetailShell: {
    flex: 1,
    paddingHorizontal: Platform.OS === 'web' ? 32 : 16,
    paddingTop: 8,
    alignItems: 'center',
  },
  challengeDetailHeader: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  challengeDetailTopBar: {
    width: '100%',
    maxWidth: 1000,
  },
  challengeCloseIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: T.surface2,
    borderWidth: 1,
    borderColor: T.lineSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  challengeDetailContent: {
    width: '100%',
    maxWidth: 1000,
    alignItems: 'stretch',
    paddingTop: 20,
    paddingBottom: 132,
  },
  challengeDetailScroll: {
    width: '100%',
    maxWidth: 1000,
  },
  challengeDetailHero: {
    borderRadius: 10,
    padding: Platform.OS === 'web' ? 22 : 18,
    borderWidth: 1,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 1,
  },
  challengeDetailHeroBadgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    marginBottom: 16,
  },
  challengeCountdownBadge: {
    minHeight: 28,
    borderRadius: 7,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  challengeCountdownBadgeText: {
    fontFamily: SYSTEM_SANS,
    fontSize: 10,
    lineHeight: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  challengeDetailHeroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  challengeDetailTitle: {
    fontSize: Platform.OS === 'web' ? 32 : 26,
    lineHeight: Platform.OS === 'web' ? 35 : 29,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 0,
    marginTop: 4,
  },
  challengeDetailStatsRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  challengeDetailStatsStack: {
    flexDirection: 'column',
  },
  challengeStatBox: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  challengeStatLabel: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 7,
  },
  challengeStatValue: {
    fontSize: 16,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
  },
  challengeDetailSection: {
    width: '100%',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
    marginBottom: 10,
  },
  challengeRewardDetailSection: {
    borderRadius: 10,
    paddingVertical: 18,
  },
  challengeDetailSectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  challengeDetailSectionTitle: {
    fontSize: 10,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: 8,
  },
  challengeDetailBody: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
  },
  challengeDetailLink: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
  },
  challengeLinksList: {
    marginTop: 10,
    gap: 8,
  },
  challengeLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    minHeight: 24,
  },
  challengeReactionPill: {
    alignSelf: 'flex-start',
    minHeight: 34,
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  challengeReactionPillText: {
    fontFamily: SYSTEM_SANS,
    fontSize: 13,
    fontWeight: '700',
  },
  challengeActionBar: {
    justifyContent: 'center',
    paddingHorizontal: Platform.OS === 'web' ? 32 : 16,
    maxWidth: Platform.OS === 'web' ? 1064 : undefined,
    alignSelf: 'center',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 4,
  },
  challengeFooterSecondary: {
    flex: 0.38,
  },
  challengeFooterPrimary: {
    flex: 0.62,
  },
  challengeFooterDanger: {
    flex: 0.26,
  },
  challengeDetailActionButton: {
    minHeight: Platform.OS === 'web' ? 46 : 48,
    borderRadius: Platform.OS === 'web' ? 10 : 12,
    paddingVertical: 12,
  },

  /* Jobs list */
  jobRow: {
    paddingHorizontal: 16,
  },
  rowSpacer: {
    height: 12,
  },
  rowDivider: {
    height: 12,
  },
  jobRowMain: {},

  jobCard: {
    backgroundColor: T.surface2,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: T.lineSoft,
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  },
  jobCardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
  },
  jobCardHeaderLeft: {
    flex: 1,
    paddingRight: 4,
  },
  jobTitle: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: T.text,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
    marginBottom: 8,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: T.lineSoft,
  },
  typeBadgeText: {
    color: GOLD,
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  rateBadge: {
    maxWidth: '48%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_LINE,
  },
  rateBadgeText: {
    color: '#E6D6B0',
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '700',
    textAlign: 'right',
    fontFamily: SYSTEM_SANS,
  },
  payText: {
    marginTop: 2,
    color: T.sub,
    fontSize: 13,
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
  },
  jobDescription: {
    fontSize: 13,
    color: T.sub,
    marginTop: 12,
    lineHeight: 20,
    fontFamily: SYSTEM_SANS,
  },

  /* Meta */
  metaBlock: {
    marginTop: 14,
    gap: 8,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 8,
    marginTop: 8,
  },
  metaLine: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 10,
    rowGap: 8,
  },
  iconText: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 4,
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  jobMeta: {
    fontSize: 12.5,
    color: T.sub,
    fontFamily: SYSTEM_SANS,
  },
  posterName: {
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
    letterSpacing: 0.3,
  },

  /* Empty state */
  emptyWrap: {
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  emptyCard: {
    backgroundColor: T.surface2,
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 24,
    borderWidth: 1,
    borderColor: T.lineSoft,
    alignItems: 'center',
  },
  emptyTitle: {
    color: T.text,
    fontSize: 15,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
    marginTop: 10,
    marginBottom: 6,
  },
  emptyText: {
    color: T.sub,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  /* Post button */
  postButton: {
    position: 'absolute',
    left: 16,
    right: 16,
    borderRadius: 10,
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: '#8F7441',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  postButtonInner: {
    paddingVertical: 15,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  postButtonText: {
    color: '#0B0B0B',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },

    cityModalSafeArea: {
    flex: 1,
    backgroundColor: T.bg,
  },

  cityModalShell: {
    flex: 1,
    backgroundColor: T.bg,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 16,
  },

  cityModalHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  cityModalTitle: {
    color: T.text,
    fontFamily: SYSTEM_SANS,
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: 0,
  },

  cityModalCloseIcon: {
    width: 34,
    height: 34,
    borderRadius: 8,
    backgroundColor: T.surface2,
    borderWidth: 1,
    borderColor: T.lineSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },

  citySearchInput: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: T.lineSoft,
    borderRadius: 10,
    paddingHorizontal: 14,
    fontSize: 15,
    color: T.text,
    backgroundColor: T.surface3,
    fontFamily: SYSTEM_SANS,
  },

  cityModalLoadingWrap: {
    paddingTop: 24,
  },

  cityListContent: {
    paddingTop: 12,
    paddingBottom: 10,
  },

  cityPickerItem: {
    minHeight: 58,
    borderRadius: 10,
    backgroundColor: T.surface2,
    borderWidth: 1,
    borderColor: T.lineSoft,
    paddingHorizontal: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  cityPickerItemSelected: {
    borderColor: '#3D3119',
    backgroundColor: '#0E0D09',
  },

  cityPickerItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    paddingRight: 10,
  },

  radioOuter: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    borderColor: T.mute,
    alignItems: 'center',
    justifyContent: 'center',
  },

  radioOuterSelected: {
    borderColor: GOLD,
  },

  radioInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: GOLD,
  },

  cityPickerText: {
    flex: 1,
    fontSize: 14,
    color: T.text,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  cityPickerTextSelected: {
    color: T.text,
    fontWeight: '800',
  },

  bestMatchBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: '#18140B',
    borderWidth: 1,
    borderColor: '#3D3119',
  },

  bestMatchText: {
    fontSize: 10,
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },

  emptySearchState: {
    paddingVertical: 24,
    alignItems: 'center',
  },

  cityModalCancelButton: {
    marginTop: 4,
    minHeight: 50,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: T.surface2,
    borderWidth: 1,
    borderColor: T.lineSoft,
  },

  cityModalCancelText: {
    color: T.sub,
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    fontWeight: '700',
  },

  categoryPickerOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
    elevation: 30,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    backgroundColor: 'rgba(0,0,0,0.58)',
  },
  categoryPickerSheet: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '72%',
    alignSelf: 'center',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 18,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  categoryPickerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    marginBottom: 12,
  },
  categoryPickerTitle: {
    fontFamily: SYSTEM_SANS,
    fontSize: 17,
    lineHeight: 21,
    fontWeight: '800',
  },
  categoryPickerSubtitle: {
    marginTop: 3,
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '700',
  },
  categoryPickerClose: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryPickerGrid: {
    gap: 8,
    paddingBottom: 4,
  },
  categoryPickerOption: {
    minHeight: 46,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  categoryPickerOptionText: {
    flex: 1,
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    lineHeight: 18,
    fontWeight: '700',
  },

  /* Modal base */
  modalContainer: {
  position: 'relative',
  flex: 1,
  backgroundColor: T.bg,
  padding: 20,
  paddingTop: Platform.OS === 'ios' ? 90 : 40,
},
  modalChromeLine: {
    alignSelf: 'center',
    width: 42,
    height: 4,
    borderRadius: 999,
    backgroundColor: GOLD,
    opacity: 0.9,
    marginBottom: 14,
  },
  modalTitle: {
    fontSize: 16,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
    color: T.text,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },
  modalTabsRow: {
    marginTop: 6,
    marginBottom: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: '700',
    marginTop: 12,
    marginBottom: 8,
    color: '#EEE4CF',
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  input: {
    backgroundColor: T.surface3,
    padding: 14,
    borderRadius: 10,
    marginBottom: 12,
    borderColor: T.lineSoft,
    borderWidth: 1,
    color: T.text,
    fontFamily: SYSTEM_SANS,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  formPickerButton: {
    minHeight: 50,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  formPickerButtonText: {
    flex: 1,
    fontFamily: SYSTEM_SANS,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  textAreaInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  linkTextAreaInput: {
    minHeight: 84,
    textAlignVertical: 'top',
  },
  selectorWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 12,
  },
  selectorChip: {
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorChipText: {
    fontFamily: SYSTEM_SANS,
    fontSize: 13,
    lineHeight: 16,
    fontWeight: '700',
  },
  deadlineButton: {
    minHeight: 50,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  deadlineButtonText: {
    flex: 1,
    fontFamily: SYSTEM_SANS,
    fontSize: 15,
    lineHeight: 20,
    fontWeight: '700',
  },
  deadlinePanel: {
    borderRadius: 10,
    borderWidth: 1,
    padding: 12,
    marginTop: -4,
    marginBottom: 12,
  },
  deadlinePanelHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  deadlineMonthButton: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deadlineMonthText: {
    flex: 1,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    fontWeight: '700',
  },
  calendarWeekRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  calendarWeekText: {
    flex: 1,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
    fontSize: 11,
    lineHeight: 14,
    fontWeight: '700',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: 6,
  },
  calendarCell: {
    width: '14.2857%',
    alignItems: 'center',
  },
  calendarDayButton: {
    width: 34,
    height: 34,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  calendarDayDisabled: {
    opacity: 0.36,
  },
  calendarDayText: {
    fontFamily: SYSTEM_SANS,
    fontSize: 13,
    fontWeight: '700',
  },
  timeStepperRow: {
    marginTop: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  timeStepperButton: {
    width: 36,
    height: 36,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timeStepperValue: {
    minWidth: 68,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '700',
  },
  quickTimeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
  },
  quickTimeChip: {
    minHeight: 32,
    borderRadius: 9,
    borderWidth: 1,
    paddingHorizontal: 11,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickTimeText: {
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
    fontWeight: '700',
  },
  helperText: {
    marginTop: -4,
    marginBottom: 8,
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
    lineHeight: 17,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: T.lineSoft,
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: T.text,
    backgroundColor: T.surface3,
    marginBottom: 10,
    fontFamily: SYSTEM_SANS,
  },

  submitButton: {
    backgroundColor: GOLD,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#8F7441',
  },
  submitText: {
    color: '#0B0B0B',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 1,
  },
  cancelText: {
    color: T.sub,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  /* Picker */
  listPickerItem: {
    paddingVertical: 14,
    borderBottomColor: T.lineSoft,
    borderBottomWidth: 1,
  },
  listPickerText: {
    fontSize: 15,
    color: T.text,
    fontFamily: SYSTEM_SANS,
  },

  /* Footer */
  modalFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    backgroundColor: '#050505',
    borderTopWidth: 1,
    borderTopColor: T.lineSoft,
    flexDirection: 'row',
    gap: 10,
  },
  footerBtn: {
    flex: 1,
    padding: 15,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerGhost: {
    backgroundColor: T.surface3,
    borderWidth: 1,
    borderColor: T.lineSoft,
  },
  footerGhostText: {
    color: T.sub,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  footerPrimary: {
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: '#8F7441',
  },
  footerPrimaryText: {
    color: '#0B0B0B',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  footerDanger: {
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
  },
  footerDangerText: {
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    letterSpacing: 0.5,
  },

  /* Inline overlays */
 inlineOverlay: {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
  backgroundColor: 'rgba(0,0,0,0.58)',
  alignItems: 'center',
  paddingHorizontal: 16,
},
  inlineSheet: {
  backgroundColor: '#050505',
  padding: 20,
  paddingTop: 28,
  borderRadius: 12,
  width: '100%',
  maxWidth: 640,
  maxHeight: '72%',
  borderWidth: 1,
  borderColor: T.lineSoft,
},
  closeModalButton: {
    marginTop: 14,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: T.surface3,
    borderWidth: 1,
    borderColor: T.lineSoft,
  },
  closeModalText: {
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    color: T.text,
    letterSpacing: 0.5,
  },

  /* Remote row */
  remoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: T.surface3,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: T.lineSoft,
  },
  remoteLabel: {
    fontSize: 12.5,
    color: T.text,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
  },
  remoteHint: {
    fontSize: 12,
    color: T.sub,
    marginTop: -4,
    marginBottom: 8,
    marginLeft: 4,
    fontFamily: SYSTEM_SANS,
  },

  /* Job detail */
  detailHeroCard: {
    backgroundColor: T.surface2,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: T.lineSoft,
    marginTop: 6,
  },
  detailTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 10,
    marginBottom: 10,
  },
  keyValue: {
    color: T.sub,
    marginTop: 6,
    fontSize: 14,
    fontFamily: SYSTEM_SANS,
  },
  keyLabel: {
    color: T.sub,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
  },
  keyValueText: {
    color: T.sub,
    fontFamily: SYSTEM_SANS,
  },
  safetyActionsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 14,
  },
  safetyActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: T.lineSoft,
    backgroundColor: T.surface3,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  safetyDangerButton: {
    borderColor: 'rgba(255,138,138,0.35)',
  },
  safetyActionText: {
    color: T.sub,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    textTransform: 'uppercase',
  },
  safetyCopy: {
    marginTop: 8,
    color: T.mute,
    fontSize: 12,
    lineHeight: 17,
    fontFamily: SYSTEM_SANS,
  },

  /* Confirm modal */
  confirmOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: T.surface2,
    borderRadius: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: T.lineSoft,
  },
  confirmTitle: {
    fontSize: 16,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    color: T.text,
    textAlign: 'center',
    marginBottom: 6,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  confirmText: {
    fontSize: 14,
    color: T.sub,
    textAlign: 'center',
    lineHeight: 21,
    marginBottom: 14,
    fontFamily: SYSTEM_SANS,
  },
  confirmButtons: {
    flexDirection: 'row',
    gap: 10,
  },

  /* Applicants */
  applicantSummaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  applicantSummaryText: {
    fontSize: 12.5,
    color: T.sub,
    fontFamily: SYSTEM_SANS,
  },
  applicantList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 8,
  },
  applicantPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: GOLD_LINE,
    backgroundColor: GOLD_SOFT,
  },
  applicantPillText: {
    fontSize: 11.5,
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },
  applicantMoreText: {
    fontSize: 11.5,
    color: T.sub,
    marginTop: 4,
    marginLeft: 2,
    fontFamily: SYSTEM_SANS,
  },

  /* My Jobs actions */
  myJobActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 14,
  },
  closeJobButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: GOLD,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#8F7441',
  },
  closeJobButtonText: {
    fontSize: 11.5,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    letterSpacing: 0.5,
    color: '#000',
    textTransform: 'uppercase',
  },
});
