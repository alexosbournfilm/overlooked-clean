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
  ScrollView,
  Alert,
  useWindowDimensions,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
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

const FONT_CINEMATIC =
  Platform.select({ ios: 'Cinzel', android: 'Cinzel', default: 'Cinzel' }) || 'Cinzel';

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

type UpgradeContext =
  | 'challenge'
  | 'jobs'
  | 'workshop'
  | 'extra_submission'
  | undefined;

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
  const GOLD_SOFT = isLight ? 'rgba(158,119,40,0.12)' : 'rgba(198,166,100,0.16)';
  const GOLD_LINE = isLight ? 'rgba(158,119,40,0.26)' : 'rgba(198,166,100,0.28)';
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
      glow: isLight ? 'rgba(158,119,40,0.08)' : 'rgba(198,166,100,0.08)',
    }),
    [colors, isLight]
  );
  const READABLE_INK = isLight ? '#050505' : T.text;
  const READABLE_MUTED = isLight ? '#4B4740' : T.mute;
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

  /* ---------- Navigation header ---------- */
  useLayoutEffect(() => {
    // @ts-ignore
    navigation.setOptions({
      title: 'Jobs',
      headerTitleAlign: 'center',
      headerTitleStyle: {
        fontFamily: FONT_CINEMATIC,
        fontWeight: Platform.OS === 'web' ? ('700' as any) : '700',
        letterSpacing: 3.8,
        fontSize: 16,
        color: T.text,
        textTransform: 'uppercase',
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
    });
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

  const getFlag = (countryCode: string) =>
  countryCode
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));

const parseCityQuery = (raw: string) => {
  const s = (raw || '').trim();
  const cleaned = s.replace(/[()]/g, '').replace(/\s+/g, ' ');
  const lower = cleaned.toLowerCase();

  const partsComma = lower
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);

  let cityPart = partsComma[0] || '';
  let countryPart = partsComma[1] || '';

  if (!countryPart) {
    const tokens = lower.split(' ').filter(Boolean);
    if (tokens.length >= 2) {
      const last = tokens[tokens.length - 1];
      if (/^[a-z]{2}$/.test(last)) {
        countryPart = last;
        cityPart = tokens.slice(0, -1).join(' ');
      }
    }
  }

  const cityQuery = (cityPart || '').trim();
  const countryCode = (countryPart || '').trim();

  return {
    cityQuery,
    countryCode: /^[a-z]{2}$/.test(countryCode) ? countryCode.toUpperCase() : '',
  };
};

const prioritizeCityMatches = (
  list: { id: number; name: string; country_code: string }[],
  rawTerm: string
) => {
  const { cityQuery, countryCode } = parseCityQuery(rawTerm);
  const q = cityQuery.trim();

  const norm = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();

  const qn = norm(q);

  const score = (row: { name: string; country_code: string }) => {
    const name = norm(row.name);
    const cc = (row.country_code || '').toUpperCase();

    const exactCity = name === qn;
    const starts = name.startsWith(qn);
    const contains = name.includes(qn);

    if (countryCode && exactCity && cc === countryCode) return 0;
    if (exactCity) return 1;
    if (countryCode && starts && cc === countryCode) return 2;
    if (starts) return 3;
    if (countryCode && contains && cc === countryCode) return 4;
    if (contains) return 5;
    return 6;
  };

  return list.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;

    if (countryCode) {
      const ac = (a.country_code || '').toUpperCase() === countryCode ? 0 : 1;
      const bc = (b.country_code || '').toUpperCase() === countryCode ? 0 : 1;
      if (ac !== bc) return ac - bc;
    }

    const an = a.name.toLowerCase();
    const bn = b.name.toLowerCase();
    if (an !== bn) return an.localeCompare(bn);
    return (a.country_code || '').localeCompare(b.country_code || '');
  });
};

  const fetchCities = useCallback(
  async (search: string) => {
    const raw = (search || '').trim();
    const { cityQuery, countryCode } = parseCityQuery(raw);

    latestCityTermRef.current = raw;

    if (cityQuery.length < 2) {
      setCityItems([]);
      setSearchingCities(false);
      return;
    }

    const myReqId = ++cityReqIdRef.current;
    setSearchingCities(true);

    try {
      const baseQuery = supabase
        .from('cities')
        .select('id, name, country_code')
        .ilike('name', `%${cityQuery}%`)
        .limit(120);

      const primary = countryCode ? await baseQuery.eq('country_code', countryCode) : await baseQuery;

      let finalData = primary.data;
      let finalError = primary.error;

      if (countryCode && (!finalData || finalData.length === 0)) {
        const fallback = await supabase
          .from('cities')
          .select('id, name, country_code')
          .ilike('name', `%${cityQuery}%`)
          .limit(120);

        finalData = fallback.data;
        finalError = fallback.error;
      }

      if (myReqId !== cityReqIdRef.current) return;
      if (latestCityTermRef.current !== raw) return;

      if (finalError) {
        logJobsIssue('searchCities unavailable', finalError);
        show('City search failed', 'error');
        setCityItems([]);
        return;
      }

      const prioritized = prioritizeCityMatches(finalData || [], raw);

      setCityItems(
        prioritized.map((c) => ({
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
    const { cityQuery, countryCode } = parseCityQuery(raw);

    latestCityFilterTermRef.current = raw;

    if (cityQuery.length < 2) {
      setCityFilterItems([]);
      setSearchingFilterCities(false);
      return;
    }

    const myReqId = ++cityFilterReqIdRef.current;
    setSearchingFilterCities(true);

    try {
      const baseQuery = supabase
        .from('cities')
        .select('id, name, country_code')
        .ilike('name', `%${cityQuery}%`)
        .limit(120);

      const primary = countryCode ? await baseQuery.eq('country_code', countryCode) : await baseQuery;

      let finalData = primary.data;
      let finalError = primary.error;

      if (countryCode && (!finalData || finalData.length === 0)) {
        const fallback = await supabase
          .from('cities')
          .select('id, name, country_code')
          .ilike('name', `%${cityQuery}%`)
          .limit(120);

        finalData = fallback.data;
        finalError = fallback.error;
      }

      if (myReqId !== cityFilterReqIdRef.current) return;
      if (latestCityFilterTermRef.current !== raw) return;

      if (finalError) {
        logJobsIssue('searchFilterCities unavailable', finalError);
        show('City search failed', 'error');
        setCityFilterItems([]);
        return;
      }

      const prioritized = prioritizeCityMatches(finalData || [], raw);

      setCityFilterItems(
        prioritized.map((c) => ({
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
    if (selectedJob) {
      setSelectedJob(null);
      setTimeout(() => {
        // @ts-ignore
        navigation.navigate('Profile', { user: userObj });
      }, 180);
    } else {
      // @ts-ignore
      navigation.navigate('Profile', { user: userObj });
    }
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
    <View style={{ paddingTop: HEADER_GAP }}>
    

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

      <View style={styles.sectionSpacer} />
    </View>
  ),
  [
    activeTab,
    filterCity,
    filterRole,
    includeRemote,
    anyFilterActive,
    gamifyLoading,
    jobs.length,
    myJobs.length,
  ]
);

  /* -------------------------------- render --------------------------------- */
  const listData = activeTab === 'my' ? myJobs : jobs;

  return (
  <SafeAreaView style={[styles.safeArea, { backgroundColor: T.bg }]} edges={['top']}>
    <View style={[styles.container, { backgroundColor: T.bg, paddingTop: insets.top > 0 ? 6 : 12 }]}>
      <ToastView />

      <Animated.FlatList
        data={listData}
        keyExtractor={(j) => String(j.id)}
        renderItem={
          activeTab === 'my'
            ? (renderMyJob as any)
            : (renderJob as any)
        }
        ListHeaderComponent={ListHeader}
        ListEmptyComponent={
  <View style={styles.emptyWrap}>
    {activeTab === 'my' ? (
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
  paddingBottom: Platform.OS === 'web' && !isWebMobile ? 150 : 230,
}}
        refreshing={activeTab === 'my' ? loadingMyJobs : isRefreshing}
onRefresh={() => {
  triggerAppRefresh();

  if (activeTab === 'my') {
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

      {/* Post a Job */}
      <TouchableOpacity
  style={[
    styles.postButton,
    {
      backgroundColor: GOLD,
      borderColor: GOLD_LINE,
      shadowColor: colors.shadow,
      bottom: Platform.OS === 'web' && !isWebMobile ? 28 : Math.max(tabBarHeight + 14, 84),
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

      {/* Post Job Modal */}
      <Modal
        visible={jobFormVisible}
        animationType={nativeLikeModalAnimation}
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
      </Modal>

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
                void fetchCities(text);
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
                void fetchFilterCities(text);
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
                            selected && { color: READABLE_INK, fontWeight: '900' },
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
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: T.lineSoft,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
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
    borderRadius: 999,
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
    borderRadius: 999,
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
    height: 18,
  },

  /* Category tabs */
  categoryTabsWrap: {
    paddingHorizontal: 16,
    marginTop: 16,
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
  borderRadius: 999,
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
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    fontSize: 12,
    fontWeight: '800',
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
  borderRadius: 24,
  paddingHorizontal: 20,
  paddingVertical: 22,
  borderWidth: 1,
  borderColor: T.lineSoft,
  shadowColor: '#000',
  shadowOpacity: 0.35,
  shadowRadius: 18,
  shadowOffset: { width: 0, height: 8 },
  elevation: 8,
},

  /* Filters */
  filtersInline: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  flexWrap: 'wrap',
  paddingHorizontal: 16,
  paddingTop: 10,
},
filterPill: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  minWidth: 86,
  paddingHorizontal: 12,
  paddingVertical: 8,
  borderRadius: 999,
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
    fontSize: 12.5,
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
    borderRadius: 999,
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
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderWidth: 1,
    borderColor: T.lineSoft,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
    elevation: 3,
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
    fontWeight: '900',
    letterSpacing: 1.2,
    color: T.text,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
    marginBottom: 8,
  },
  typeBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: T.lineSoft,
  },
  typeBadgeText: {
    color: GOLD,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  rateBadge: {
    maxWidth: '48%',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_LINE,
  },
  rateBadgeText: {
    color: '#E6D6B0',
    fontSize: 11.5,
    lineHeight: 15,
    fontWeight: '800',
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
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  /* Empty state */
  emptyWrap: {
    paddingHorizontal: 16,
    paddingVertical: 24,
  },
  emptyCard: {
    backgroundColor: T.surface2,
    borderRadius: 22,
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
    borderRadius: 18,
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: '#8F7441',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
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
    fontWeight: '900',
    fontSize: 15,
    letterSpacing: 1.2,
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
    fontWeight: '900',
    letterSpacing: -0.3,
  },

  cityModalCloseIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
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
    borderRadius: 15,
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
    borderRadius: 16,
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
    borderRadius: 999,
    backgroundColor: '#18140B',
    borderWidth: 1,
    borderColor: '#3D3119',
  },

  bestMatchText: {
    fontSize: 10,
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
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
    borderRadius: 15,
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
    fontWeight: '800',
  },

  /* Modal base */
  modalContainer: {
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
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 10,
    color: T.text,
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  modalTabsRow: {
    marginTop: 6,
    marginBottom: 10,
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 12,
    marginBottom: 8,
    color: '#EEE4CF',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  input: {
    backgroundColor: T.surface3,
    padding: 14,
    borderRadius: 16,
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
  textAreaInput: {
    minHeight: 96,
    textAlignVertical: 'top',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: T.lineSoft,
    borderRadius: 16,
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
    borderRadius: 16,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#8F7441',
  },
  submitText: {
    color: '#0B0B0B',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
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
    borderRadius: 16,
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
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  footerPrimary: {
    backgroundColor: GOLD,
    borderWidth: 1,
    borderColor: '#8F7441',
  },
  footerPrimaryText: {
    color: '#0B0B0B',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    letterSpacing: 1,
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
  borderRadius: 22,
  width: '100%',
  maxWidth: 640,
  maxHeight: '72%',
  borderWidth: 1,
  borderColor: T.lineSoft,
},
  closeModalButton: {
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
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
    borderRadius: 16,
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
    borderRadius: 22,
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
    borderRadius: 22,
    padding: 20,
    borderWidth: 1,
    borderColor: T.lineSoft,
  },
  confirmTitle: {
    fontSize: 16,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
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
    borderRadius: 999,
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
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#8F7441',
  },
  closeJobButtonText: {
    fontSize: 11.5,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    letterSpacing: 0.8,
    color: '#000',
    textTransform: 'uppercase',
  },
});
