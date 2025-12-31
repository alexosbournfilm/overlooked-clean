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
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { decode } from 'html-entities';
import { COLORS as THEME_COLORS } from '../theme/colors';
import { supabase, XP_VALUES, type UserTier } from '../lib/supabase';
import { useGamification } from '../context/GamificationContext';
import { getCurrentUserTierOrFree } from '../lib/membership';
import { UpgradeModal } from '../../components/UpgradeModal';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});


/* ────────────────────────────────────────────────────────────
   Cinematic noir base (gold accents, fewer cards)
   ──────────────────────────────────────────────────────────── */
const GOLD = '#C6A664';

const T = {
  bg: '#0B0B0B',
  surface: '#111111',
  text: '#FFFFFF',
  sub: '#C9C9C9',
  mute: '#9A9A1A',
  accent: '#FFFFFF',
  line: '#1A1A1A',
};
T.mute = '#9A9A9A'; // keep original mute

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
  textOnPrimary: '#000000',
  border: '#1E1E1E',
  borderSoft: '#1A1A1A',
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
  const bg = anim.interpolate({ inputRange: [0, 1], outputRange: ['#171717', '#1E1E1E'] });
  const border = anim.interpolate({ inputRange: [0, 1], outputRange: ['#232323', '#2B2B2B'] });

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
            backgroundColor: '#0F0F0F',
            borderWidth: 1,
            borderColor: COLORS.border,
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
}> = ({ name, text, weight = '400' }) => (
  <View style={styles.iconText}>
    <Ionicons name={name} size={16} color={T.sub} style={{ marginRight: 6 }} />
    <Text style={[styles.jobMeta, { fontWeight: weight }]}>{text}</Text>
  </View>
);

/* -------------------------------------------
   Screen
-------------------------------------------- */
export default function JobsScreen() {
  const navigation = useNavigation();
  const { show, ToastView } = useToast();

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
    });
  }, [navigation, show]);

  /* ---------- Initial loads ---------- */
  useEffect(() => {
    void fetchRoles();
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

  const fetchRoles = async () => {
    const { data, error } = await supabase.from('creative_roles').select('id, name').order('name');
    if (error) {
      console.error(error);
      show('Could not load roles', 'error');
    } else setRoles(data || []);
  };

  const fetchJobs = useCallback(
    async (mode: 'init' | 'refresh' | 'silent' = 'silent') => {
      // Only fetch global jobs for Paid/Free tabs
      if (activeTab === 'my') return;

      if (mode === 'init' && jobs.length === 0) setIsLoadingInit(true);
      if (mode === 'refresh') setIsRefreshing(true);

      let query = supabase
        .from('jobs')
        .select(`*, users(id, full_name), cities(name, country_code), creative_roles(name)`)
        .eq('type', activeTab === 'paid' ? 'Paid' : 'Free')
        .eq('is_closed', false)
        .order('xp', { foreignTable: 'users', ascending: false })
.order('created_at', { ascending: false });

      if (filterCity?.value) query = query.eq('city_id', filterCity.value);
      if (filterRole?.value) query = query.eq('role_id', filterRole.value);
      if (!includeRemote) query = query.eq('remote', false);

      const { data, error } = await query;

      if (error) {
        console.error(error);
        setJobs([]);
        show('Could not fetch jobs', 'error');
      } else {
        setJobs((data as JobRow[]) || []);
      }

      if (mode === 'init') setIsLoadingInit(false);
      if (mode === 'refresh') setIsRefreshing(false);
    },
    [activeTab, filterCity?.value, filterRole?.value, includeRemote, jobs.length, show]
  );

  const fetchMyJobs = useCallback(async () => {
    try {
      setLoadingMyJobs(true);

      const {
        data: { user },
        error: authErr,
      } = await supabase.auth.getUser();

      if (authErr || !user) {
        if (authErr) console.error(authErr);
        setMyJobs([]);
        setLoadingMyJobs(false);
        return;
      }

      const { data: myJobsData, error: jobsErr } = await supabase
        .from('jobs')
        .select('*, users(id, full_name), cities(name, country_code), creative_roles(name)')
        .eq('user_id', user.id)
        .eq('is_closed', false) // only open jobs in MY JOBS
        .order('xp', { foreignTable: 'users', ascending: false })
.order('created_at', { ascending: false });

      if (jobsErr) {
        console.error(jobsErr);
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
  .select(`id, job_id, applicant:users(id, full_name, xp)`)
  .in('job_id', jobIds)
  .order('xp', { foreignTable: 'users', ascending: false });

      if (appsErr) {
        console.error(appsErr);
        show('Could not load applicants.', 'error');
      }

      const appsByJob: Record<number, Applicant[]> = {};

      (appsData || []).forEach((row: any) => {
        const jobId = row.job_id as number;
        const applicant = row.applicant as Applicant | null;
        if (!jobId || !applicant) return;
        if (!appsByJob[jobId]) appsByJob[jobId] = [];
        appsByJob[jobId].push(applicant);
      });

      const withApplicants: MyJob[] = baseJobs.map((j) => ({
        ...j,
        applicants: appsByJob[j.id] || [],
      }));

      setMyJobs(withApplicants);
    } catch (e: any) {
      console.error('fetchMyJobs error', e?.message ?? e);
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
          if (authErr) console.error(authErr);
          show('Please sign in to manage your jobs.', 'info');
          return;
        }

        const { error } = await supabase
          .from('jobs')
          .update({ is_closed: true })
          .eq('id', jobId)
          .eq('user_id', user.id);

        if (error) {
          console.error(error);
          show('Could not close job.', 'error');
          return;
        }

        // Remove from local MY JOBS list so it disappears immediately
        setMyJobs((prev) => prev.filter((j) => j.id !== jobId));

        show('Job closed. It will no longer appear to applicants.', 'success');
      } catch (e: any) {
        console.error('handleCloseJob error', e?.message ?? e);
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
        console.error(error);
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

  const prioritizeCityMatches = (
    list: { id: number; name: string; country_code: string }[],
    term: string
  ) => {
    const q = term.trim().toLowerCase();
    return list.sort((a, b) => {
      const A = a.name.toLowerCase();
      const B = b.name.toLowerCase();
      const score = (s: string) => (s === q ? 0 : s.startsWith(q) ? 1 : 2);
      const cmp = score(A) - score(B);
      return cmp !== 0 ? cmp : A.localeCompare(B);
    });
  };

  const fetchCities = useCallback(
    async (search: string) => {
      const q = search.trim();
      if (!q || q.length < 2) {
        setCityItems([]);
        return;
      }
      setSearchingCities(true);
      const { data, error } = await supabase
        .from('cities')
        .select('id, name, country_code')
        .ilike('name', `%${q}%`)
        .limit(50);
      setSearchingCities(false);
      if (error) {
        console.error(error);
        show('City search failed', 'error');
      } else if (data) {
        const prioritized = prioritizeCityMatches(data, q);
        setCityItems(
          prioritized.map((c) => ({
            value: c.id,
            label: `${c.name}, ${c.country_code}`,
            country: c.country_code,
          })) as CityOption[]
        );
      }
    },
    [show]
  );

  const fetchFilterCities = useCallback(
    async (search: string) => {
      const q = search.trim();
      if (!q || q.length < 2) {
        setCityFilterItems([]);
        return;
      }
      setSearchingFilterCities(true);
      const { data, error } = await supabase
        .from('cities')
        .select('id, name, country_code')
        .ilike('name', `%${q}%`)
        .limit(50);
      setSearchingFilterCities(false);
      if (error) {
        console.error(error);
        show('City search failed', 'error');
      } else if (data) {
        const prioritized = prioritizeCityMatches(data, q);
        setCityFilterItems(
          prioritized.map((c) => ({
            value: c.id,
            label: `${c.name}, ${c.country_code}`,
            country: c.country_code,
          })) as CityOption[]
        );
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
        console.error(error);
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
    const user = (await supabase.auth.getUser()).data.user;
    if (!user || !formData.role_id || (!formData.city && !formData.remote)) {
      show(
        formData.remote ? 'Please select a role.' : 'Please select a role and a city.',
        'error'
      );
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
      console.error(error);
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
      console.error(error);
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
      show('Please log in to apply.', 'info');
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
      console.error(checkErr);
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
      console.error(insertErr);
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
      }, 0);
    } else {
      // @ts-ignore
      navigation.navigate('Profile', { user: userObj });
    }
  };

  /* ----------------------------- renderers --------------------------------- */
  const renderRoleItem = useCallback(
    ({ item }: { item: RoleOption }) => (
      <TouchableOpacity
        style={styles.listPickerItem}
        onPress={() => {
          setFormData((prev) => ({ ...prev, role_id: item.value }));
          setJobRoleOverlayVisible(false);
        }}
        activeOpacity={0.85}
      >
        <Text style={styles.listPickerText}>{item.label}</Text>
      </TouchableOpacity>
    ),
    []
  );

  const renderCityItem = useCallback(
    ({ item }: { item: CityOption }) => (
      <TouchableOpacity
        style={styles.listPickerItem}
        onPress={() => {
          setFormData((prev) => ({ ...prev, city: item }));
          setJobCityOverlayVisible(false);
        }}
        activeOpacity={0.85}
      >
        <Text style={styles.listPickerText}>{item.label}</Text>
      </TouchableOpacity>
    ),
    []
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
          activeOpacity={0.85}
          style={styles.jobRow}
        >
          <View style={styles.jobRowMain}>
            <Text style={styles.jobTitle}>
              {decode(job.creative_roles?.name || 'Job')}
            </Text>
            <Text style={styles.payText}>{rateText}</Text>

            {job.description ? (
              <Text numberOfLines={2} style={styles.jobDescription}>
                {decode(job.description)}
              </Text>
            ) : null}

            <View style={styles.metaRow}>
              {!job.remote ? (
                <IconText
                  name="location-outline"
                  text={job.cities?.name || 'Unknown'}
                />
              ) : (
                <IconText name="globe-outline" text="Remote" />
              )}

              <View style={styles.dot} />

              <View style={styles.iconText}>
                <Ionicons
                  name="person-outline"
                  size={16}
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
                  <Text style={styles.posterName}>
                    {job.users?.full_name || 'View Profile'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.dot} />
              <IconText
                name="time-outline"
                text={postedAgo || '—'}
              />
              {job.time ? (
                <>
                  <View style={styles.dot} />
                  <IconText
                    name="calendar-outline"
                    text={job.time}
                  />
                </>
              ) : null}
            </View>
          </View>
        </TouchableOpacity>
      );
    },
    []
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
          <View style={styles.jobRowMain}>
            <Text style={styles.jobTitle}>
              {decode(job.creative_roles?.name || 'Job')}
            </Text>
            <Text style={styles.payText}>{rateText}</Text>

            {job.description ? (
              <Text numberOfLines={3} style={styles.jobDescription}>
                {decode(job.description)}
              </Text>
            ) : null}

            <View style={styles.metaRow}>
              {!job.remote ? (
                <IconText
                  name="location-outline"
                  text={job.cities?.name || 'Unknown'}
                />
              ) : (
                <IconText name="globe-outline" text="Remote" />
              )}

              <View style={styles.dot} />
              <IconText
                name="time-outline"
                text={postedAgo || '—'}
              />
              {job.time ? (
                <>
                  <View style={styles.dot} />
                  <IconText
                    name="calendar-outline"
                    text={job.time}
                  />
                </>
              ) : null}
            </View>

            <View style={styles.applicantSummaryRow}>
              <Ionicons
                name="people-outline"
                size={16}
                color={T.sub}
                style={{ marginRight: 6 }}
              />
              {hasApplicants ? (
                <Text style={styles.applicantSummaryText}>
                  {job.applicants.length} applicant
                  {job.applicants.length !== 1 ? 's' : ''}
                </Text>
              ) : (
                <Text style={styles.applicantSummaryText}>
                  No applicants yet.
                </Text>
              )}
            </View>

            {hasApplicants && (
              <View style={styles.applicantList}>
                {job.applicants.slice(0, 4).map((a) => (
                  <TouchableOpacity
                    key={a.id}
                    style={styles.applicantPill}
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
                    <Text style={styles.applicantPillText}>
                      {a.full_name || 'View profile'}
                    </Text>
                  </TouchableOpacity>
                ))}
                {job.applicants.length > 4 && (
                  <Text style={styles.applicantMoreText}>
                    +{job.applicants.length - 4} more
                  </Text>
                )}
              </View>
            )}

            {/* Close Job action */}
            <View style={styles.myJobActionsRow}>
              <TouchableOpacity
                style={styles.closeJobButton}
                onPress={() => handleCloseJob(job.id)}
                activeOpacity={0.9}
              >
                <Ionicons
                  name="lock-closed-outline"
                  size={14}
                  color="#000"
                  style={{ marginRight: 6 }}
                />
                <Text style={styles.closeJobButtonText}>
                  Close Job
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );
    },
    [navigation, handleCloseJob]
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
        {/* Gamification helper text only (bubble removed) */}
        {!gamifyLoading && (
          <View style={styles.levelBannerWrap}>
            <Text style={styles.levelHint}>
              Post roles & apply through Overlooked to climb your level and unlock new titles.
            </Text>
          </View>
        )}

        {/* Category-style text tabs */}
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
                style={styles.categoryTap}
                onPress={() => setActiveTab(tab)}
                activeOpacity={0.92}
              >
                <Text
                  style={[
                    styles.categoryText,
                    active && styles.categoryTextActive,
                  ]}
                >
                  {label}
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

        {/* Minimal filters (hidden when in MY JOBS since they don't apply) */}
        {activeTab !== 'my' && (
          <View style={styles.filtersInline}>
            <TouchableOpacity
              onPress={() => setCityFilterModalVisible(true)}
              style={styles.filterLink}
              activeOpacity={0.9}
            >
              <Ionicons
                name="location-outline"
                size={16}
                color={T.sub}
              />
              <Text style={styles.filterLinkText}>
                {filterCity?.label || 'City'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => setRoleFilterModalVisible(true)}
              style={styles.filterLink}
              activeOpacity={0.9}
            >
              <Ionicons
                name="briefcase-outline"
                size={16}
                color={T.sub}
              />
              <Text style={styles.filterLinkText}>
                {filterRole?.label || 'Role'}
              </Text>
            </TouchableOpacity>

            <View
              style={[
                styles.filterLink,
                { paddingHorizontal: 0 },
              ]}
            >
              <Text style={styles.filterToggleLabel}>
                Remote
              </Text>
              <CustomToggle
                value={includeRemote}
                onChange={(v) => setIncludeRemote(v)}
                size="sm"
              />
            </View>

            {anyFilterActive ? (
              <TouchableOpacity
                onPress={clearFilters}
                style={styles.clearInline}
                activeOpacity={0.9}
              >
                <Ionicons
                  name="close-circle-outline"
                  size={16}
                  color={T.sub}
                />
                <Text style={styles.clearInlineText}>
                  Clear
                </Text>
              </TouchableOpacity>
            ) : null}
          </View>
        )}

        <View style={styles.listDivider} />
      </View>
    ),
    [
      activeTab,
      filterCity,
      filterRole,
      includeRemote,
      anyFilterActive,
      gamifyLoading,
    ]
  );

  /* -------------------------------- render --------------------------------- */
  const listData = activeTab === 'my' ? myJobs : jobs;

  return (
    <View style={styles.container}>
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
          <View style={{ paddingVertical: 32 }}>
            {activeTab === 'my' ? (
              // Stable, non-glitchy empty state for MY JOBS
              <Text
                style={[
                  styles.jobDescription,
                  {
                    textAlign: 'center',
                    marginTop: 8,
                  },
                ]}
              >
                You haven&apos;t posted any jobs yet. Use &quot;Post a Job&quot; below to share an opportunity.
              </Text>
            ) : isLoadingInit ? (
              <ActivityIndicator
                size="large"
                color={T.accent}
              />
            ) : (
              <Text
                style={[
                  styles.jobDescription,
                  {
                    textAlign: 'center',
                    marginTop: 8,
                  },
                ]}
              >
                No jobs match these filters yet.
              </Text>
            )}
          </View>
        }
        contentContainerStyle={{ paddingBottom: 120 }}
        refreshing={activeTab === 'my' ? loadingMyJobs : isRefreshing}
        onRefresh={() => {
          if (activeTab === 'my') {
            void fetchMyJobs();
          } else {
            void fetchJobs('refresh');
          }
        }}
        showsVerticalScrollIndicator={false}
        removeClippedSubviews={Platform.OS !== 'web'}
        ItemSeparatorComponent={() => (
          <View style={styles.rowDivider} />
        )}
      />

      {/* Post a Job */}
      <TouchableOpacity
        style={styles.postButton}
        onPress={() => setJobFormVisible(true)}
        activeOpacity={0.92}
      >
        <Ionicons
          name="add"
          size={18}
          color="#000"
        />
        <Text style={styles.postButtonText}>
          Post a Job
        </Text>
      </TouchableOpacity>

      {/* Post Job Modal */}
      <Modal
        visible={jobFormVisible}
        animationType={
          Platform.OS === 'web' ? 'none' : 'slide'
        }
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
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>
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
                    style={styles.categoryTap}
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
                        active && styles.categoryTextActive,
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
              contentContainerStyle={{ paddingBottom: 140 }}
              keyboardShouldPersistTaps="always"
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.label}>Role</Text>
              <TouchableOpacity
                style={styles.input}
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
                      color: formData.role_id ? T.text : T.mute,
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

              <Text style={styles.label}>Description</Text>
              <TextInput
                style={[styles.input, { minHeight: 84 }]}
                placeholder="Short, clear description"
                placeholderTextColor={T.mute}
                value={formData.description}
                onChangeText={(text) =>
                  setFormData({ ...formData, description: text })
                }
                multiline
              />

              <Text style={styles.label}>City</Text>
              <TouchableOpacity
                style={styles.input}
                onPress={() => {
                  Keyboard.dismiss();
                  setCityItems([]);
                  setCitySearchTerm('');
                  setJobCityOverlayVisible(true);
                }}
                activeOpacity={0.92}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Ionicons name="location-outline" size={16} color={T.sub} />
                  <Text
                    style={{
                      color: formData.city ? T.text : T.mute,
                      marginLeft: 8,
                    }}
                  >
                    {formData.city?.label || 'Search for your city'}
                  </Text>
                </View>
              </TouchableOpacity>

              <View style={styles.remoteRow}>
                <Text style={styles.remoteLabel}>Remote</Text>
                <CustomToggle
                  value={formData.remote}
                  onChange={(val) =>
                    setFormData({ ...formData, remote: val })
                  }
                />
              </View>
              {!formData.city && formData.remote ? (
                <Text style={styles.remoteHint}>
                  City is optional for remote roles.
                </Text>
              ) : null}

              {formData.type === 'Paid' && (
                <>
                  <Text style={styles.label}>Currency</Text>
                  <TouchableOpacity
                    style={styles.input}
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

                  <Text style={styles.label}>Pay Type</Text>
                  <TouchableOpacity
                    style={styles.input}
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

                  <Text style={styles.label}>Amount</Text>
                  <TextInput
                    style={styles.input}
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

              <Text style={styles.label}>Time</Text>
              <TextInput
                style={styles.input}
                placeholder="e.g. 3-day shoot"
                placeholderTextColor={T.mute}
                value={formData.time}
                onChangeText={(t) =>
                  setFormData({ ...formData, time: t })
                }
              />
            </ScrollView>

            {/* Inline City Search */}
            {jobCityOverlayVisible && (
              <View style={styles.inlineOverlay}>
                <View style={styles.inlineSheet}>
                  <Text style={styles.modalTitle}>Search City</Text>
                  <TextInput
                    placeholder="Start typing…"
                    placeholderTextColor={T.mute}
                    value={citySearchTerm}
                    onChangeText={(text) => {
                      setCitySearchTerm(text);
                      void fetchCities(text);
                    }}
                    style={styles.searchInput}
                    autoFocus
                  />
                  <FlatList
                    data={cityItems}
                    keyExtractor={cityKey}
                    keyboardShouldPersistTaps="handled"
                    renderItem={renderCityItem}
                    style={{ maxHeight: '70%' as any }}
                    removeClippedSubviews={false}
                    windowSize={10}
                    initialNumToRender={10}
                  />
                  {searchingCities && (
                    <ActivityIndicator style={{ marginTop: 8 }} />
                  )}
                  <TouchableOpacity
                    onPress={() => setJobCityOverlayVisible(false)}
                    style={styles.closeModalButton}
                    activeOpacity={0.92}
                  >
                    <Text style={styles.closeModalText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Inline Role Search */}
            {jobRoleOverlayVisible && (
              <View style={styles.inlineOverlay}>
                <View style={styles.inlineSheet}>
                  <Text style={styles.modalTitle}>Search Role</Text>
                  <TextInput
                    placeholder="Start typing…"
                    placeholderTextColor={T.mute}
                    value={roleSearchTerm}
                    onChangeText={(t) => setRoleSearchTerm(t)}
                    style={styles.searchInput}
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
                    style={styles.closeModalButton}
                    activeOpacity={0.92}
                  >
                    <Text style={styles.closeModalText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Inline Currency Picker */}
            {currencyOverlayVisible && (
              <View style={styles.inlineOverlay}>
                <View style={styles.inlineSheet}>
                  <Text style={styles.modalTitle}>Select Currency</Text>
                  <FlatList
                    data={currencyItems}
                    keyExtractor={(v) => v}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={styles.listPickerItem}
                        onPress={() => {
                          setFormData((p) => ({
                            ...p,
                            currency: item,
                          }));
                          setCurrencyOverlayVisible(false);
                        }}
                        activeOpacity={0.9}
                      >
                        <Text style={styles.listPickerText}>{item}</Text>
                      </TouchableOpacity>
                    )}
                  />
                  <TouchableOpacity
                    onPress={() => setCurrencyOverlayVisible(false)}
                    style={styles.closeModalButton}
                    activeOpacity={0.92}
                  >
                    <Text style={styles.closeModalText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Inline Rate Picker */}
            {rateOverlayVisible && (
              <View style={styles.inlineOverlay}>
                <View style={styles.inlineSheet}>
                  <Text style={styles.modalTitle}>Select Pay Type</Text>
                  <FlatList
                    data={rateItems}
                    keyExtractor={(v) => v}
                    renderItem={({ item }) => (
                      <TouchableOpacity
                        style={styles.listPickerItem}
                        onPress={() => {
                          setFormData((p) => ({
                            ...p,
                            rate: item,
                          }));
                          setRateOverlayVisible(false);
                        }}
                        activeOpacity={0.9}
                      >
                        <Text style={styles.listPickerText}>{item}</Text>
                      </TouchableOpacity>
                    )}
                  />
                  <TouchableOpacity
                    onPress={() => setRateOverlayVisible(false)}
                    style={styles.closeModalButton}
                    activeOpacity={0.92}
                  >
                    <Text style={styles.closeModalText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Sticky footer */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerGhost]}
                onPress={() => setJobFormVisible(false)}
                activeOpacity={0.9}
              >
                <Text style={styles.footerGhostText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.footerBtn, styles.footerPrimary]}
                onPress={handlePostJob}
                activeOpacity={0.9}
              >
                <Text style={styles.footerPrimaryText}>Submit Job</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* City Filter Modal */}
            {/* City Filter Modal */}
      <Modal
        visible={cityFilterModalVisible}
        animationType={Platform.OS === 'web' ? 'none' : 'slide'}
        onRequestClose={() => setCityFilterModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Filter by City</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Type at least 2 letters…"
            placeholderTextColor={T.mute}
            value={cityFilterSearchTerm}
            autoFocus
            onChangeText={(t) => {
              setCityFilterSearchTerm(t);
              void fetchFilterCities(t);
            }}
          />
          {searchingFilterCities && (
            <ActivityIndicator style={{ marginTop: 10 }} />
          )}
          <FlatList
            data={cityFilterItems}
            keyExtractor={(i) => String(i.value)}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.listPickerItem}
                onPress={() => {
                  setFilterCity(item);
                  setCityFilterModalVisible(false);
                }}
                activeOpacity={0.9}
              >
                <Text style={styles.listPickerText}>{item.label}</Text>
              </TouchableOpacity>
            )}
            removeClippedSubviews={false}
            windowSize={10}
            initialNumToRender={12}
          />
          <TouchableOpacity
            onPress={() => setCityFilterModalVisible(false)}
            style={styles.closeModalButton}
            activeOpacity={0.92}
          >
            <Text style={styles.closeModalText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Role Filter Modal */}
      <Modal
        visible={roleFilterModalVisible}
        animationType={Platform.OS === 'web' ? 'none' : 'slide'}
        onRequestClose={() => setRoleFilterModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Filter by Role</Text>
          <TextInput
            style={styles.searchInput}
            placeholder="Start typing a role…"
            placeholderTextColor={T.mute}
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
                style={styles.listPickerItem}
                onPress={() => {
                  setFilterRole(item);
                  setRoleFilterModalVisible(false);
                }}
                activeOpacity={0.9}
              >
                <Text style={styles.listPickerText}>{item.label}</Text>
              </TouchableOpacity>
            )}
            removeClippedSubviews={false}
            windowSize={10}
            initialNumToRender={12}
          />
          <TouchableOpacity
            onPress={() => setRoleFilterModalVisible(false)}
            style={styles.closeModalButton}
            activeOpacity={0.92}
          >
            <Text style={styles.closeModalText}>Close</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Job Detail / Apply Modal */}
      <Modal
        visible={!!selectedJob}
        animationType={Platform.OS === 'web' ? 'none' : 'slide'}
        onRequestClose={() => setSelectedJob(null)}
      >
        <View style={styles.modalContainer}>
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
                      // @ts-ignore
                      navigation.navigate('Profile', { user: u });
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
    </View>
  );
}

/* ────────────────────────────────────────────────────────────
   Styles — flatter, noir, gamified helper text
   ──────────────────────────────────────────────────────────── */
const RADIUS = 8;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: T.bg },

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
    borderRadius: RADIUS,
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

  /* Gamification copy */
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

  /* Category tabs */
  categoryTabsRow: {
    marginTop: 2,
    flexDirection: 'row',
    alignSelf: 'center',
    gap: 26,
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingBottom: 6,
  },
  categoryTap: { alignItems: 'center' },
  categoryText: {
    color: '#CFCFCF',
    fontFamily: SYSTEM_SANS,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontSize: 13,
    fontWeight: '800',
  },
  categoryTextActive: { color: GOLD },
  categoryUnderline: {
    marginTop: 6,
    height: 3,
    width: 60,
    backgroundColor: GOLD,
    borderRadius: 2,
  },

  /* Filters row */
  filtersInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  filterLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  filterLinkText: {
    color: T.sub,
    fontSize: 13,
    textDecorationLine: 'underline',
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
  },
  filterToggleLabel: {
    color: T.sub,
    fontSize: 13,
    marginRight: 6,
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
  },
  clearInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 4,
  },
  clearInlineText: {
    color: T.sub,
    fontSize: 13,
    textDecorationLine: 'underline',
    fontFamily: SYSTEM_SANS,
    fontWeight: '600',
  },
  listDivider: {
    height: 1,
    backgroundColor: T.line,
    marginTop: 4,
  },

  /* Job Row */
  jobRow: {
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'transparent',
  },
  rowDivider: {
    height: 1,
    backgroundColor: T.line,
    marginLeft: 16,
  },
  jobRowMain: {},

  jobTitle: {
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1,
    color: T.text,
    textTransform: 'uppercase',
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
    marginTop: 6,
    lineHeight: 18,
    fontFamily: SYSTEM_SANS,
  },

  /* Meta row */
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    columnGap: 12,
    marginTop: 8,
  },
  iconText: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 3,
    height: 3,
    borderRadius: 1.5,
    backgroundColor: '#ffffff22',
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

  /* Post Job button */
  postButton: {
  position: 'absolute',
  bottom: 32,
  left: 16,
  right: 16,
  backgroundColor: GOLD,      // ✅ match Challenge gold button
  padding: 14,
  borderRadius: RADIUS,
  alignItems: 'center',
  flexDirection: 'row',
  justifyContent: 'center',
  gap: 8,
  borderWidth: 1,
  borderColor: '#000000',     // ✅ same “gold button” border style as Challenge
},
  postButtonText: {
    color: '#000',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  /* Modal base */
  modalContainer: {
    flex: 1,
    backgroundColor: T.bg,
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  modalTitle: {
    fontSize: 16,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    textAlign: 'center',
    marginBottom: 8,
    color: T.text,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  label: {
    fontSize: 11,
    fontWeight: '800',
    marginTop: 10,
    marginBottom: 6,
    color: T.text,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  input: {
    backgroundColor: '#121212',
    padding: 12,
    borderRadius: RADIUS,
    marginBottom: 12,
    borderColor: COLORS.border,
    borderWidth: 1,
    color: T.text,
    fontFamily: SYSTEM_SANS,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS,
    padding: 14,
    fontSize: 16,
    color: T.text,
    backgroundColor: '#121212',
    marginBottom: 8,
    fontFamily: SYSTEM_SANS,
  },

    submitButton: {
  backgroundColor: GOLD,      // ✅ match Challenge gold button
  padding: 14,
  borderRadius: RADIUS,
  alignItems: 'center',
  borderWidth: 1,
  borderColor: '#000000',     // ✅ same gold button border style as Challenge
},
  submitText: {
    color: '#000',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 1,
  },
  cancelText: {
    color: T.accent,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    letterSpacing: 0.4,
  },

  /* List picker */
  listPickerItem: {
    paddingVertical: 12,
    borderBottomColor: '#1A1A1A',
    borderBottomWidth: 1,
  },
  listPickerText: {
    fontSize: 16,
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
    backgroundColor: T.bg,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    gap: 10,
  },
  footerBtn: {
    flex: 1,
    padding: 14,
    borderRadius: RADIUS,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerGhost: {
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  footerGhostText: {
    color: T.accent,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  footerPrimary: {
  backgroundColor: GOLD,   // ✅ gold like Challenge
  borderWidth: 1,
  borderColor: '#000000',  // ✅ same border feel as Challenge buttons
},
footerPrimaryText: {
  color: '#0B0B0B',        // ✅ dark text like Challenge
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
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  inlineSheet: {
    backgroundColor: T.bg,
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 24 : 20,
    borderRadius: RADIUS,
    width: '100%',
    maxWidth: 640,
    maxHeight: '75%',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  closeModalButton: {
    marginTop: 14,
    padding: 12,
    borderRadius: RADIUS,
    alignItems: 'center',
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  closeModalText: {
    fontSize: 16,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    color: T.text,
    letterSpacing: 0.4,
  },

  /* Remote row */
  remoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#121212',
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  remoteLabel: {
    fontSize: 13,
    color: T.text,
    textTransform: 'uppercase',
    letterSpacing: 0.2,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },
  remoteHint: {
    fontSize: 12,
    color: T.sub,
    marginTop: -4,
    marginBottom: 8,
    marginLeft: 4,
    fontFamily: SYSTEM_SANS,
  },

  /* Job detail key/value */
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
    backgroundColor: T.surface,
    borderRadius: RADIUS,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.border,
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
    lineHeight: 20,
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
    marginTop: 10,
  },
  applicantSummaryText: {
    fontSize: 12,
    color: T.sub,
    fontFamily: SYSTEM_SANS,
  },
  applicantList: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 6,
  },
  applicantPill: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GOLD,
    backgroundColor: '#111111',
  },
  applicantPillText: {
    fontSize: 11,
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },
  applicantMoreText: {
    fontSize: 11,
    color: T.sub,
    marginTop: 4,
    marginLeft: 2,
    fontFamily: SYSTEM_SANS,
  },

  /* My Jobs actions */
  myJobActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    marginTop: 12,
  },
  closeJobButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: GOLD,
    borderRadius: RADIUS,
    borderWidth: 1,
    borderColor: GOLD,
  },
  closeJobButtonText: {
    fontSize: 11,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    letterSpacing: 0.6,
    color: '#000',
    textTransform: 'uppercase',
  },
});
