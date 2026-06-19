// app/screens/LocationScreen.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Modal,
  FlatList,
  ActivityIndicator,
  Platform,
  Alert,
  Image,
  RefreshControl,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthProvider';
import { useAppRefresh } from '../context/AppRefreshContext';
import { useAppTheme } from '../context/ThemeContext';
import { getFlag, parseCityQuery, searchCities } from '../lib/citySearch';
import { isMobileWebViewport } from '../utils/responsive';
import CityGlobe, { type CityGlobeLocation, type CityGlobeUser } from '../../components/CityGlobe';

const IS_WEB = Platform.OS === 'web';

/* ────────────────────────────────────────────────────────────
   Cinematic dark palette aligned with the rest of Overlooked
   ──────────────────────────────────────────────────────────── */
const DARK_BG = '#050505';
const SURFACE = '#0D0D0F';
const SURFACE_2 = '#111114';
const SURFACE_3 = '#16161A';
const INPUT_BG = '#16161A';
const TEXT_PRIMARY = '#F4EFE6';
const TEXT_SECONDARY = '#A59D90';
const TEXT_TERTIARY = '#726C61';
const BORDER = 'rgba(255,255,255,0.10)';
const BORDER_SOFT = 'rgba(255,255,255,0.06)';
const GOLD = '#C6A664';
const GOLD_DARK = '#8F7A4D';

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

/* -------------------------------------------
   Types
-------------------------------------------- */
interface DropdownOption {
  label: string;
  value: number;
  country?: string;
  name?: string;
  countryCode?: string;
  latitude?: number | null;
  longitude?: number | null;
}

type Conversation = {
  id: string;
  name?: string | null;
  is_group: boolean;
  city_id: number | null;
  participant_ids: string[] | null;
  last_message_at?: string | null;
};

type LocatedUser = CityGlobeUser & {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  level?: number | null;
  city_id?: number | string | null;
};

type JoinedUser =
  | { id: string; full_name?: string }
  | { id: string; full_name?: string }[]
  | null
  | undefined;

type JoinedCity =
  | {
      name?: string;
      country_code?: string;
      latitude?: number | null;
      longitude?: number | null;
      lat?: number | null;
      lng?: number | null;
    }
  | {
      name?: string;
      country_code?: string;
      latitude?: number | null;
      longitude?: number | null;
      lat?: number | null;
      lng?: number | null;
    }[]
  | null
  | undefined;

type JoinedRole =
  | { name?: string }
  | { name?: string }[]
  | null
  | undefined;

type LocatedJobLite = {
  id: string;
  title?: string | null;
  is_closed?: boolean | null;
  creative_roles?: JoinedRole;
};

type JobDetail = {
  id: string;
  description: string | null;
  type: string | null;
  currency: string | number | null;
  amount: string | number | null;
  rate: string | null;
  time: string | null;
  created_at: string;
  is_closed?: boolean | null;
  creative_roles?: JoinedRole;
  cities?: JoinedCity;
  users?: JoinedUser;
};

/* -------------------------------------------
   Helpers
-------------------------------------------- */
const getFirst = <T,>(v: T | T[] | null | undefined): T | undefined =>
  Array.isArray(v) ? v[0] : v ?? undefined;

const getUserFromJoin = (u: JoinedUser) => getFirst(u);
const getCityFromJoin = (c: JoinedCity) => getFirst(c);
const getRoleFromJoin = (r: JoinedRole) => getFirst(r);

const toFiniteNumber = (value: any) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

const cityOptionToGlobeLocation = (option: DropdownOption | null): CityGlobeLocation | null => {
  if (!option) return null;

  const latitude = toFiniteNumber(option.latitude);
  const longitude = toFiniteNumber(option.longitude);
  if (latitude == null || longitude == null) return null;

  return {
    name: option.name || option.label.replace(/^[^\w]+/, '').split(',')[0]?.trim() || 'City',
    countryCode: (option.countryCode || option.country || '').toUpperCase(),
    latitude,
    longitude,
  };
};

const cityRowToGlobeLocation = (row: any): CityGlobeLocation | null => {
  if (!row) return null;

  const latitude = toFiniteNumber(row.latitude);
  const longitude = toFiniteNumber(row.longitude);
  if (latitude == null || longitude == null) return null;

  return {
    name: String(row.name || 'City'),
    countryCode: String(row.country_code || '').toUpperCase(),
    latitude,
    longitude,
  };
};

const userRowToLocatedUser = (row: any, cityLookup: Map<string, CityGlobeLocation>): LocatedUser | null => {
  const cityId = row?.city_id;
  if (cityId == null) return null;

  const location = cityLookup.get(String(cityId));
  if (!location) return null;

  return {
    id: String(row.id),
    full_name: String(row.full_name || 'Overlooked member'),
    avatar_url: row.avatar_url ?? null,
    level: row.level ?? null,
    city_id: cityId,
    cityName: location.name,
    countryCode: location.countryCode,
    latitude: location.latitude,
    longitude: location.longitude,
  };
};

const userRowToSelectedCityUser = (
  row: any,
  cityId: number | string,
  location: CityGlobeLocation | null
): LocatedUser => ({
  id: String(row.id),
  full_name: String(row.full_name || 'Overlooked member'),
  avatar_url: row.avatar_url ?? null,
  level: row.level ?? null,
  city_id: row.city_id ?? cityId,
  cityName: location?.name ?? null,
  countryCode: location?.countryCode ?? null,
  latitude: location?.latitude ?? null,
  longitude: location?.longitude ?? null,
});

const IconText: React.FC<{
  name: keyof typeof Ionicons.glyphMap;
  text: string;
  bold?: boolean;
  iconColor?: string;
  textColor?: string;
  strongColor?: string;
}> = ({ name, text, bold, iconColor = TEXT_SECONDARY, textColor = TEXT_SECONDARY, strongColor = TEXT_PRIMARY }) => (
  <View style={styles.iconTextRow}>
    <Ionicons name={name} size={16} color={iconColor} style={{ marginRight: 8 }} />
    <Text style={[styles.jobMeta, { color: bold ? strongColor : textColor }, bold && styles.jobMetaStrong]}>
      {text}
    </Text>
  </View>
);

export default function LocationScreen() {
  const { colors, isLight } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const isWebMobile = isMobileWebViewport(width);
  const nativeLikeModalAnimation = IS_WEB && !isWebMobile ? 'none' : 'slide';
  const { triggerAppRefresh } = useAppRefresh();
  const DARK_BG = colors.background;
  const SURFACE = colors.card;
  const SURFACE_2 = colors.mutedCard;
  const SURFACE_3 = colors.cardAlt;
  const INPUT_BG = colors.input;
  const TEXT_PRIMARY = colors.textPrimary;
  const TEXT_SECONDARY = colors.textSecondary;
  const TEXT_TERTIARY = colors.textMuted;
  const BORDER = colors.border;
  const BORDER_SOFT = colors.border;
  const GOLD = colors.primary;
  const GOLD_DARK = isLight ? '#6F531C' : '#8F7A4D';
  const READABLE_INK = isLight ? '#050505' : TEXT_PRIMARY;
  const READABLE_MUTED = isLight ? '#4B4740' : TEXT_TERTIARY;

  const [city, setCity] = useState<DropdownOption | null>(null);
  const [selectedCityLocation, setSelectedCityLocation] = useState<CityGlobeLocation | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cityItems, setCityItems] = useState<DropdownOption[]>([]);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [citySearchTerm, setCitySearchTerm] = useState('');
  const [isSearchingCities, setIsSearchingCities] = useState(false);

  const [users, setUsers] = useState<LocatedUser[]>([]);
  const [worldUsers, setWorldUsers] = useState<LocatedUser[]>([]);
  const [jobs, setJobs] = useState<LocatedJobLite[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [joining, setJoining] = useState(false);

  const [activeTab, setActiveTab] = useState<'creatives' | 'jobs'>('creatives');

  const [jobDetailModalOpen, setJobDetailModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobDetail | null>(null);
  const [loadingSelectedJob, setLoadingSelectedJob] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);

  const navigation = useNavigation<any>();
  const { userId } = useAuth();
  const isGuest = !userId;

  const cityReqIdRef = useRef(0);
  const latestCityTermRef = useRef('');
  const citySearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveCityQuery = useMemo(() => parseCityQuery(citySearchTerm), [citySearchTerm]);

  const fetchCities = useCallback(async (search: string) => {
    const raw = (search || '').trim();
    const { cityQuery } = parseCityQuery(raw);

    latestCityTermRef.current = raw;

    if (cityQuery.length < 2) {
      setCityItems([]);
      setIsSearchingCities(false);
      return;
    }

    const myReqId = ++cityReqIdRef.current;
    setIsSearchingCities(true);

    try {
      const { data: finalData, error: finalError } = await searchCities(raw, { limit: 120 });

      if (myReqId !== cityReqIdRef.current) return;
      if (latestCityTermRef.current !== raw) return;

      if (finalError) {
        console.error('Error fetching cities:', finalError.message);
        setCityItems([]);
        return;
      }

      if (finalData) {
        setCityItems(
          finalData.map((item) => ({
            label: `${getFlag(item.country_code)} ${item.name}, ${item.country_code}`,
            value: item.id,
            country: item.country_code,
            name: item.name,
            countryCode: item.country_code,
            latitude: item.latitude ?? null,
            longitude: item.longitude ?? null,
          }))
        );
      }
    } finally {
      if (myReqId === cityReqIdRef.current && latestCityTermRef.current === raw) {
        setIsSearchingCities(false);
      }
    }
  }, []);

  const scheduleCitySearch = useCallback(
    (text: string) => {
      if (citySearchDebounceRef.current) clearTimeout(citySearchDebounceRef.current);
      citySearchDebounceRef.current = setTimeout(() => {
        void fetchCities(text);
      }, 180);
    },
    [fetchCities]
  );

  useEffect(
    () => () => {
      if (citySearchDebounceRef.current) clearTimeout(citySearchDebounceRef.current);
    },
    []
  );

  const fetchWorldwideUsers = useCallback(async () => {
    const { data: userRows, error: usersError } = await supabase
      .from('users')
      .select('id, full_name, avatar_url, level, city_id')
      .not('city_id', 'is', null)
      .limit(1000);

    if (usersError) {
      console.error('Error fetching worldwide users:', usersError.message);
      setWorldUsers([]);
      return;
    }

    const cityIds = Array.from(
      new Set(
        ((userRows || []) as LocatedUser[])
          .map((row) => row.city_id)
          .filter((id): id is number | string => id != null)
          .map((id) => String(id))
      )
    );

    if (cityIds.length === 0) {
      setWorldUsers([]);
      return;
    }

    const { data: cityRows, error: citiesError } = await supabase
      .from('cities')
      .select('id, name, country_code, latitude, longitude')
      .in('id', cityIds);

    if (citiesError) {
      console.error('Error fetching worldwide city coordinates:', citiesError.message);
      setWorldUsers([]);
      return;
    }

    const cityLookup = new Map<string, CityGlobeLocation>();
    (cityRows || []).forEach((row) => {
      const location = cityRowToGlobeLocation(row);
      if (location) cityLookup.set(String(row.id), location);
    });

    setWorldUsers(
      ((userRows || []) as LocatedUser[])
        .map((row) => userRowToLocatedUser(row, cityLookup))
        .filter((row): row is LocatedUser => !!row)
    );
  }, []);

  useEffect(() => {
    void fetchWorldwideUsers();
  }, [fetchWorldwideUsers]);

  const handleSearch = async () => {
    if (!city) return;

    setSearching(true);
    setSearched(false);

    const [usersRes, jobsRes, cityRes] = await Promise.all([
      supabase.from('users').select('id, full_name, avatar_url, level, city_id').eq('city_id', city.value),
      supabase
        .from('jobs')
        .select('id, title, is_closed, creative_roles:role_id (name)')
        .eq('city_id', city.value)
        .eq('is_closed', false),
      supabase
        .from('cities')
        .select('id, name, country_code, latitude, longitude')
        .eq('id', city.value)
        .maybeSingle(),
    ]);

    if (usersRes.error) console.error(usersRes.error.message);
    if (jobsRes.error) console.error(jobsRes.error.message);
    if (cityRes.error) console.error(cityRes.error.message);

    const selectedLocation = cityRowToGlobeLocation(cityRes.data) ?? cityOptionToGlobeLocation(city);

    setUsers(
      ((usersRes.data || []) as LocatedUser[]).map((row) =>
        userRowToSelectedCityUser(row, city.value, selectedLocation)
      )
    );
    setJobs((jobsRes.data as LocatedJobLite[]) || []);
    setSelectedCityLocation(selectedLocation);
    setSearching(false);
    setSearched(true);
    setActiveTab('creatives');
  };

    const onRefresh = useCallback(async () => {
    if (refreshing) return;

    setRefreshing(true);

    try {
      triggerAppRefresh();

      if (city) {
        await handleSearch();
      } else if (citySearchTerm.trim().length >= 2) {
        await fetchCities(citySearchTerm);
        await fetchWorldwideUsers();
      } else {
        await fetchWorldwideUsers();
      }
    } catch (e: any) {
      console.warn('Location refresh error:', e?.message || e);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, triggerAppRefresh, city, citySearchTerm, fetchCities, fetchWorldwideUsers]);

  const fetchConversationById = async (conversationId: string) => {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('id', conversationId)
      .single();

    if (error) {
      console.warn('fetchConversationById warn:', error.message);
      return null;
    }
    return data as Conversation;
  };

  const fetchExistingCityConversation = async (cityId: number) => {
    const { data, error } = await supabase
      .from('conversations')
      .select('*')
      .eq('is_group', true)
      .eq('city_id', cityId)
      .maybeSingle();

    if (error) {
      console.warn('fetchExistingCityConversation warn:', error.message);
      return null;
    }
    return (data || null) as Conversation | null;
  };

  const goToChatRoom = ({
    conversationId,
    conversation,
    isGroup = true,
  }: {
    conversationId: string;
    conversation?: Conversation | null;
    isGroup?: boolean;
  }) => {
    navigation.dispatch(
      CommonActions.navigate({
        name: 'Chats',
        params: {
          screen: 'ChatRoom',
          params: {
            conversationId,
            isGroup,
            conversation: conversation || undefined,
          },
        },
      })
    );
  };

  const joinCityChat = async () => {
    try {
      if (!city) {
        Alert.alert('Pick a city first');
        return;
      }

      setJoining(true);

      if (isGuest) {
        Alert.alert(
          'Sign in required',
          'Create an account or sign in to join your city group chat.'
        );
        navigation.navigate('Auth', { screen: 'SignIn' });
        return;
      }

      const { data: rpcResult, error: rpcError } = await supabase.rpc('join_city_group', {
        city_id_input: city.value,
      });

      if (rpcError) {
        console.error('join_city_group error:', rpcError.message);
        Alert.alert('Couldn’t join city chat', rpcError.message);
        return;
      }

      const conversationId: string =
        (typeof rpcResult === 'string' && rpcResult) ||
        (rpcResult?.conversation_id as string) ||
        (rpcResult?.id as string);

      if (!conversationId) {
        const existing = await fetchExistingCityConversation(city.value);
        if (existing?.id) {
          goToChatRoom({ conversationId: existing.id, conversation: existing, isGroup: true });
          return;
        }
        throw new Error('No conversation id returned from join_city_group');
      }

      const conversation = await fetchConversationById(conversationId);
      goToChatRoom({ conversationId, conversation: conversation ?? undefined, isGroup: true });
    } catch (e: any) {
      console.error(e);
      Alert.alert('Couldn’t join city chat', String(e?.message ?? e));
    } finally {
      setJoining(false);
    }
  };

  const goToProfile = useCallback((user?: { id: string; full_name?: string }) => {
    if (!user?.id) return;
    navigation.navigate('Profile', { user });
  }, [navigation]);

  const fetchJobDetail = useCallback(async (jobId: string) => {
    setLoadingSelectedJob(true);
    setSelectedJob(null);

    const { data, error } = await supabase
      .from('jobs')
      .select(
        `
        id, is_closed, description, type, currency, amount, rate, time, created_at,
        creative_roles:role_id (name),
        cities:city_id (name, country_code),
        users:user_id (id, full_name)
      `
      )
      .eq('id', jobId)
      .maybeSingle();

    setLoadingSelectedJob(false);

    if (error) {
      console.error('fetchJobDetail error:', error);
      Alert.alert('Error', 'Could not load job details.');
      return null;
    }
    return (data as JobDetail) ?? null;
  }, []);

  const onPressJob = async (jobRow: LocatedJobLite) => {
    setJobDetailModalOpen(true);
    const detail = await fetchJobDetail(jobRow.id);
    if (detail) setSelectedJob(detail);
  };

  const applyToSelectedJob = useCallback(async () => {
    if (!selectedJob) return;

    if (isGuest) {
      Alert.alert(
        'Sign in required',
        'Create an account or sign in to apply for jobs.'
      );
      navigation.navigate('Auth', { screen: 'SignIn' });
      return;
    }

    const { data: auth } = await supabase.auth.getUser();
    const me = auth?.user;

    if (!me) {
      Alert.alert(
        'Sign in required',
        'Create an account or sign in to apply for jobs.'
      );
      navigation.navigate('Auth', { screen: 'SignIn' });
      return;
    }

    const { data: latest, error: latestErr } = await supabase
      .from('jobs')
      .select('is_closed')
      .eq('id', selectedJob.id)
      .single();

    if (latestErr) {
      console.error(latestErr);
      return Alert.alert('Error', 'Could not verify job status.');
    }

    if (latest?.is_closed) {
      setSelectedJob((prev) => (prev ? { ...prev, is_closed: true } : prev));
      return Alert.alert('Closed', 'This job has been closed and is no longer accepting applications.');
    }

    setApplyLoading(true);

    const { data: existing, error: checkErr } = await supabase
      .from('applications')
      .select('id')
      .eq('job_id', selectedJob.id)
      .eq('applicant_id', me.id)
      .maybeSingle();

    if (checkErr) {
      setApplyLoading(false);
      console.error(checkErr);
      return Alert.alert('Error', 'Could not check existing application.');
    }

    if (existing) {
      setApplyLoading(false);
      return Alert.alert('Already applied', 'You have already applied to this job.');
    }

    const { error: insertErr } = await supabase.from('applications').insert({
      job_id: selectedJob.id,
      applicant_id: me.id,
      audition_url: null,
      message: null,
      applied_at: new Date().toISOString(),
      status: 'pending',
    });

    setApplyLoading(false);

    if (insertErr) {
      console.error(insertErr);
      Alert.alert('Error', 'Could not apply.');
    } else {
      Alert.alert('Success', 'Application sent.');
      setJobDetailModalOpen(false);
      setSelectedJob(null);
    }
  }, [selectedJob, isGuest, navigation]);

  const canShowTopActions = !!city;
  const globeCity = useMemo(
    () => selectedCityLocation ?? cityOptionToGlobeLocation(city),
    [city, selectedCityLocation]
  );
  const globeUsers = useMemo(() => {
    if (!city) return worldUsers;

    const byId = new Map<string, LocatedUser>();
    worldUsers.forEach((user) => byId.set(user.id, user));
    if (searched) users.forEach((user) => byId.set(user.id, user));
    return Array.from(byId.values());
  }, [city, searched, users, worldUsers]);

  const cityGlobeMap = (
    <View style={[styles.globeSection, searched && styles.globeSectionAfterResults]}>
      <CityGlobe
        city={globeCity}
        users={globeUsers}
        searched={searched}
        onUserPress={goToProfile}
        backgroundColor={DARK_BG}
        surfaceColor={SURFACE}
        surfaceAltColor={SURFACE_2}
        borderColor={BORDER}
        textColor={TEXT_PRIMARY}
        mutedTextColor={TEXT_SECONDARY}
        accentColor={GOLD}
      />
    </View>
  );

  return (
    <SafeAreaView style={[styles.safeArea, { backgroundColor: DARK_BG }]} edges={['top']}>
      <ScrollView
  style={[styles.screen, { backgroundColor: DARK_BG }]}
  contentContainerStyle={[
    styles.container,
    { paddingTop: insets.top > 0 ? 4 : 10, backgroundColor: DARK_BG },
  ]}
  keyboardShouldPersistTaps="handled"
  keyboardDismissMode="on-drag"
  showsVerticalScrollIndicator={false}
  refreshControl={
    Platform.OS !== 'web' ? (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor={GOLD}
        colors={[GOLD]}
        progressBackgroundColor={SURFACE}
      />
    ) : undefined
  }
>
        <View style={styles.content}>
          <View style={[styles.heroCard, { backgroundColor: SURFACE, borderColor: BORDER, shadowColor: colors.shadow }]}>
           
            <Text style={[styles.heroTitle, { color: TEXT_PRIMARY }]}>Meet creatives around you</Text>
            <Text style={[styles.heroSub, { color: TEXT_SECONDARY }]}>
              Choose your city to find people, projects, and local group chats.
            </Text>

            <TouchableOpacity
              style={[styles.cityInput, { backgroundColor: INPUT_BG, borderColor: BORDER_SOFT }]}
              onPress={() => setSearchModalVisible(true)}
              activeOpacity={0.92}
            >
              <Ionicons name="search-outline" size={18} color={city ? GOLD : TEXT_TERTIARY} />
              <Text
                style={[
                  styles.cityInputText,
                  city && styles.cityInputTextSelected,
                  { color: city ? READABLE_INK : READABLE_MUTED },
                ]}
                numberOfLines={1}
              >
                {city ? city.label : 'Select a city'}
              </Text>
              <Ionicons name="chevron-down" size={18} color={TEXT_TERTIARY} />
            </TouchableOpacity>

            <View style={styles.heroButtonsStack}>
              <TouchableOpacity
                style={[styles.searchButton, !city && styles.actionButtonDisabled]}
                onPress={handleSearch}
                activeOpacity={0.92}
                disabled={!city || searching}
              >
                {searching ? (
                  <ActivityIndicator color={colors.textOnPrimary} />
                ) : (
                  <Text style={[styles.searchButtonText, { color: colors.textOnPrimary }]}>Find creatives</Text>
                )}
              </TouchableOpacity>

              {canShowTopActions ? (
                <TouchableOpacity
                  style={[styles.joinTopButton, { backgroundColor: SURFACE_2, borderColor: BORDER }]}
                  onPress={joinCityChat}
                  disabled={joining}
                  activeOpacity={0.92}
                >
                  {joining ? (
                    <ActivityIndicator color={TEXT_PRIMARY} />
                  ) : (
                    <>
                      <Ionicons name="chatbubble-ellipses-outline" size={17} color={TEXT_PRIMARY} />
                      <Text style={[styles.joinTopButtonText, { color: TEXT_PRIMARY }]}>
                        {isGuest ? 'Sign In to Join City Chat' : 'Join City Group Chat'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {!searched ? cityGlobeMap : null}

          {searched && (
            <View style={styles.resultsWrap}>
              <View style={[styles.tabsOuter, { backgroundColor: SURFACE, borderColor: BORDER }]}>
                <View style={styles.tabsRow}>
                  {(['creatives', 'jobs'] as const).map((tab) => {
                    const active = activeTab === tab;
                    const count = tab === 'creatives' ? users.length : jobs.length;

                    return (
                      <TouchableOpacity
                        key={tab}
                        style={[
                          styles.tabButton,
                          { backgroundColor: active ? SURFACE_3 : 'transparent' },
                        ]}
                        onPress={() => setActiveTab(tab)}
                        activeOpacity={0.92}
                      >
                        <Text style={[styles.tabButtonText, { color: active ? TEXT_PRIMARY : TEXT_SECONDARY }]}>
                          {tab === 'creatives' ? 'Creatives' : 'Jobs'} ({count})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={[styles.resultsCard, { backgroundColor: SURFACE, borderColor: BORDER }]}>
                <View style={[styles.resultsHeader, { borderBottomColor: BORDER }]}>
                  <Text style={[styles.resultsTitle, { color: TEXT_PRIMARY }]}>
                    {activeTab === 'creatives' ? 'Creatives' : 'Jobs'}
                  </Text>
                  <Text style={[styles.resultsSubtitle, { color: TEXT_SECONDARY }]} numberOfLines={1}>
                    {city?.label}
                  </Text>
                </View>

                {activeTab === 'creatives' ? (
                  users.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Ionicons name="people-outline" size={20} color={TEXT_TERTIARY} />
                      <Text style={[styles.emptyTitle, { color: TEXT_PRIMARY }]}>No creatives here yet</Text>
                      <Text style={[styles.emptyText, { color: TEXT_SECONDARY }]}>Be the first to connect in this city.</Text>
                    </View>
                  ) : (
                    users.map((user, index) => {
                      const avatarUri = user.avatar_url || null;

                      return (
                        <TouchableOpacity
                          key={user.id}
                          onPress={() => goToProfile(user)}
                          activeOpacity={0.88}
                          style={[
                            styles.listRow,
                            { borderTopColor: BORDER },
                            index === 0 && styles.listRowFirst,
                            index === users.length - 1 && styles.listRowLast,
                          ]}
                        >
                          <View style={[styles.avatarWrap, { backgroundColor: SURFACE_2, borderColor: BORDER }]}>
                            {avatarUri ? (
                              <Image source={{ uri: avatarUri }} style={styles.avatar} />
                            ) : (
                              <View style={[styles.avatar, styles.fallbackAvatar, { backgroundColor: SURFACE_2 }]}>
                                <Ionicons name="person-outline" size={18} color={TEXT_SECONDARY} />
                              </View>
                            )}
                          </View>

                          <View style={styles.rowTextWrap}>
                            <Text style={[styles.rowPrimary, { color: TEXT_PRIMARY }]} numberOfLines={1}>
                              {user.full_name}
                            </Text>
                          </View>

                          <Ionicons name="chevron-forward" size={18} color={TEXT_TERTIARY} />
                        </TouchableOpacity>
                      );
                    })
                  )
                ) : jobs.length === 0 ? (
                  <View style={styles.emptyState}>
                    <Ionicons name="briefcase-outline" size={20} color={TEXT_TERTIARY} />
                    <Text style={[styles.emptyTitle, { color: TEXT_PRIMARY }]}>No jobs in this city</Text>
                    <Text style={[styles.emptyText, { color: TEXT_SECONDARY }]}>Check back later or join the local chat.</Text>
                  </View>
                ) : (
                  jobs.map((job, index) => {
                    const roleName = getRoleFromJoin(job.creative_roles)?.name;

                    return (
                      <TouchableOpacity
                        key={job.id}
                        onPress={() => onPressJob(job)}
                        activeOpacity={0.88}
                        style={[
                          styles.listRow,
                          { borderTopColor: BORDER },
                          index === 0 && styles.listRowFirst,
                          index === jobs.length - 1 && styles.listRowLast,
                        ]}
                      >
                        <View style={[styles.jobIconWrap, { backgroundColor: SURFACE_2, borderColor: BORDER }]}>
                          <Ionicons name="briefcase-outline" size={17} color={TEXT_PRIMARY} />
                        </View>

                        <View style={styles.rowTextWrap}>
                          <Text style={[styles.rowPrimary, { color: TEXT_PRIMARY }]} numberOfLines={1}>
                            {roleName || job.title || 'Job'}
                          </Text>
                        </View>

                        <Ionicons name="chevron-forward" size={18} color={TEXT_TERTIARY} />
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>

              {cityGlobeMap}
            </View>
          )}
        </View>

        <Modal
          visible={searchModalVisible}
          animationType={nativeLikeModalAnimation}
          onRequestClose={() => setSearchModalVisible(false)}
        >
          <SafeAreaView style={[styles.modalSafeArea, { backgroundColor: DARK_BG }]} edges={['top']}>
            <View style={[styles.modalShell, { backgroundColor: DARK_BG }]}>
              <View style={styles.modalHeader}>
                <Text style={[styles.modalTitle, { color: TEXT_PRIMARY }]}>Choose a city</Text>

                <TouchableOpacity
                  onPress={() => setSearchModalVisible(false)}
                  style={[styles.modalCloseIcon, { backgroundColor: SURFACE, borderColor: BORDER }]}
                  activeOpacity={0.85}
                >
                  <Ionicons name="close" size={18} color={TEXT_PRIMARY} />
                </TouchableOpacity>
              </View>

              <TextInput
                placeholder="Start typing a city..."
                placeholderTextColor={READABLE_MUTED}
                value={citySearchTerm}
                onChangeText={(text) => {
                  setCitySearchTerm(text);
                  scheduleCitySearch(text);
                }}
                style={[styles.searchInput, { backgroundColor: INPUT_BG, borderColor: BORDER, color: READABLE_INK }, WEB_NO_OUTLINE]}
                autoFocus
              />

              {isSearchingCities ? (
                <View style={styles.modalLoadingWrap}>
                  <ActivityIndicator color={GOLD} />
                </View>
              ) : (
                <FlatList
                  data={cityItems}
                  keyExtractor={(item) => item.value.toString()}
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  contentContainerStyle={styles.cityListContent}
                  renderItem={({ item, index }) => {
                    const selected = city?.value === item.value;

                    return (
                      <TouchableOpacity
                        style={[
                          styles.cityItem,
                          {
                            backgroundColor: selected ? (isLight ? '#F6ECD8' : '#0E0D09') : SURFACE,
                            borderColor: selected ? GOLD : BORDER,
                          },
                        ]}
                        onPress={() => {
                          setCity(item);
                          setSelectedCityLocation(cityOptionToGlobeLocation(item));
                          setUsers([]);
                          setJobs([]);
                          setSearched(false);
                          setActiveTab('creatives');
                          setSearchModalVisible(false);
                        }}
                        activeOpacity={0.9}
                      >
                        <View style={styles.cityItemLeft}>
                          <View
                            style={[
                              styles.radioOuter,
                              { borderColor: selected ? GOLD : TEXT_TERTIARY },
                              selected && styles.radioOuterSelected,
                            ]}
                          >
                            {selected ? <View style={styles.radioInner} /> : null}
                          </View>

                          <Text style={[styles.cityItemText, selected && styles.cityItemTextSelected, { color: READABLE_INK }]}>
                            {item.label}
                          </Text>
                        </View>

                        {index === 0 && effectiveCityQuery.cityQuery.length >= 3 ? (
                          <View
                            style={[
                              styles.bestMatchBadge,
                              {
                                backgroundColor: isLight ? '#F6ECD8' : '#18140B',
                                borderColor: isLight ? GOLD : '#3D3119',
                              },
                            ]}
                          >
                            <Text style={[styles.bestMatchText, { color: GOLD_DARK }]}>Best match</Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  }}
                  ListEmptyComponent={
                    citySearchTerm.trim().length >= 2 ? (
                      <View style={styles.emptySearchState}>
                        <Text style={[styles.emptyText, { color: TEXT_SECONDARY }]}>No matching cities found.</Text>
                      </View>
                    ) : null
                  }
                />
              )}

              <TouchableOpacity
                onPress={() => setSearchModalVisible(false)}
                style={[styles.modalCancelButton, { backgroundColor: SURFACE, borderColor: BORDER }]}
                activeOpacity={0.92}
              >
                <Text style={[styles.modalCancelText, { color: TEXT_SECONDARY }]}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>

        <Modal
          visible={jobDetailModalOpen}
          animationType={nativeLikeModalAnimation}
          transparent
          onRequestClose={() => {
            setJobDetailModalOpen(false);
            setSelectedJob(null);
          }}
        >
          <View style={[styles.dimOverlay, { backgroundColor: colors.overlay }]}>
            <View style={[styles.jobModalCard, { backgroundColor: SURFACE, borderColor: BORDER, shadowColor: colors.shadow }]}>
              {loadingSelectedJob ? (
                <View style={styles.jobLoaderWrap}>
                  <ActivityIndicator size="large" color={GOLD} />
                </View>
              ) : selectedJob ? (
                <>
                  <View style={[styles.modalHandle, { backgroundColor: BORDER }]} />

                  <Text style={[styles.jobTitleBig, { color: TEXT_PRIMARY }]}>
                    {getRoleFromJoin(selectedJob.creative_roles)?.name ?? 'Job'}
                  </Text>

                  {selectedJob.is_closed ? (
                    <View style={{ marginTop: 8 }}>
                      <IconText
                        name="alert-circle-outline"
                        text="This job is closed."
                        bold
                        iconColor={TEXT_SECONDARY}
                        textColor={TEXT_SECONDARY}
                        strongColor={TEXT_PRIMARY}
                      />
                    </View>
                  ) : null}

                  {selectedJob.description ? (
                    <Text style={[styles.jobBody, { color: TEXT_PRIMARY }]}>{selectedJob.description}</Text>
                  ) : null}

                  <View style={styles.jobInfoBlock}>
                    <IconText
                      name="location-outline"
                      iconColor={TEXT_SECONDARY}
                      textColor={TEXT_SECONDARY}
                      strongColor={TEXT_PRIMARY}
                      text={`${getCityFromJoin(selectedJob.cities)?.name ?? 'Unknown'}${
                        getCityFromJoin(selectedJob.cities)?.country_code
                          ? `, ${getCityFromJoin(selectedJob.cities)?.country_code}`
                          : ''
                      }`}
                    />

                    <View style={styles.iconTextRow}>
                      <Ionicons
                        name="person-outline"
                        size={16}
                        color={TEXT_SECONDARY}
                        style={{ marginRight: 8 }}
                      />
                      <TouchableOpacity
                        onPress={() => {
                          const poster = getUserFromJoin(selectedJob.users);
                          if (poster?.id) {
                            navigation.navigate('Profile', {
                              user: { id: poster.id, full_name: poster.full_name || 'Profile' },
                            });
                          }
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={[styles.link, { color: GOLD }]}>
                          {getUserFromJoin(selectedJob.users)?.full_name || 'View Profile'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {selectedJob.type === 'Paid' ? (
                      <IconText
                        name="cash-outline"
                        bold
                        iconColor={TEXT_SECONDARY}
                        textColor={TEXT_SECONDARY}
                        strongColor={TEXT_PRIMARY}
                        text={`${selectedJob.currency ?? ''}${selectedJob.amount ?? ''}${
                          selectedJob.rate ? ` / ${selectedJob.rate}` : ''
                        }`}
                      />
                    ) : (
                      <IconText
                        name="people-outline"
                        bold
                        text="Free / Collab"
                        iconColor={TEXT_SECONDARY}
                        textColor={TEXT_SECONDARY}
                        strongColor={TEXT_PRIMARY}
                      />
                    )}

                    {selectedJob.time ? (
                      <IconText
                        name="time-outline"
                        text={selectedJob.time}
                        iconColor={TEXT_SECONDARY}
                        textColor={TEXT_SECONDARY}
                        strongColor={TEXT_PRIMARY}
                      />
                    ) : null}
                  </View>

                  <View style={styles.applyBox}>
                    <TouchableOpacity
                      style={[styles.primaryBtn, (applyLoading || selectedJob.is_closed) && { opacity: 0.6 }]}
                      onPress={applyToSelectedJob}
                      disabled={applyLoading || !!selectedJob.is_closed}
                      activeOpacity={0.9}
                    >
                      {applyLoading ? (
                          <ActivityIndicator color={colors.textOnPrimary} />
                      ) : (
                        <Text style={[styles.primaryBtnText, { color: colors.textOnPrimary }]}>
                          {selectedJob.is_closed ? 'Closed' : isGuest ? 'Sign In to Apply' : 'Apply'}
                        </Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        setJobDetailModalOpen(false);
                        setSelectedJob(null);
                      }}
                      style={[styles.ghostBtn, { backgroundColor: SURFACE_2, borderColor: BORDER }]}
                      activeOpacity={0.9}
                    >
                      <Text style={[styles.ghostBtnText, { color: TEXT_PRIMARY }]}>Close</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <Text style={[styles.emptyText, { color: TEXT_SECONDARY }]}>Couldn’t load this job.</Text>
              )}
            </View>
          </View>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: DARK_BG,
  },

  screen: {
    flex: 1,
    backgroundColor: DARK_BG,
  },

  container: {
    flexGrow: 1,
    backgroundColor: DARK_BG,
    paddingHorizontal: 16,
    paddingBottom: 24,
  },

  content: {
    width: '100%',
    maxWidth: 960,
    alignSelf: 'center',
  },

  heroCard: {
    backgroundColor: SURFACE,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 18,
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },

  
  heroTitle: {
    marginTop: 8,
    color: TEXT_PRIMARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: 0,
  },

  heroSub: {
    marginTop: 10,
    color: TEXT_SECONDARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    paddingHorizontal: 8,
  },

  cityInput: {
    marginTop: 18,
    minHeight: 54,
    borderRadius: 17,
    backgroundColor: INPUT_BG,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  cityInputText: {
    flex: 1,
    color: TEXT_TERTIARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 15,
    fontWeight: '700',
  },

  cityInputTextSelected: {
    color: TEXT_PRIMARY,
    fontWeight: '800',
  },

  heroButtonsStack: {
    marginTop: 12,
    gap: 10,
  },

  searchButton: {
    minHeight: 52,
    borderRadius: 17,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: GOLD_DARK,
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },

  actionButtonDisabled: {
    opacity: 0.45,
  },

  searchButtonText: {
    color: DARK_BG,
    fontFamily: SYSTEM_SANS,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  joinTopButton: {
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: SURFACE_2,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 9,
  },

  joinTopButtonText: {
    color: TEXT_PRIMARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.7,
    textTransform: 'uppercase',
  },

  resultsWrap: {
    marginTop: 14,
    gap: 10,
    width: '100%',
    maxWidth: 760,
    alignSelf: 'center',
  },

  globeSection: {
    width: '100%',
    maxWidth: 940,
    alignSelf: 'center',
    marginTop: 18,
  },

  globeSectionAfterResults: {
    marginTop: 8,
  },

  tabsOuter: {
    backgroundColor: SURFACE,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    padding: 5,
  },

  tabsRow: {
    flexDirection: 'row',
  },

  tabButton: {
    flex: 1,
    minHeight: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },

  tabButtonActive: {
    backgroundColor: SURFACE_3,
  },

  tabButtonText: {
    color: TEXT_SECONDARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  tabButtonTextActive: {
    color: TEXT_PRIMARY,
  },

  resultsCard: {
    backgroundColor: SURFACE,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: BORDER,
    overflow: 'hidden',
  },

  resultsHeader: {
    alignItems: 'center',
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: BORDER,
  },

  resultsTitle: {
    color: TEXT_PRIMARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 16,
    fontWeight: '900',
    textAlign: 'center',
  },

  resultsSubtitle: {
    marginTop: 4,
    color: TEXT_SECONDARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 13,
    textAlign: 'center',
  },

  listRow: {
    minHeight: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: BORDER,
    backgroundColor: 'transparent',
  },

  listRowFirst: {
    borderTopWidth: 0,
  },

  listRowLast: {
    marginBottom: 0,
  },

  avatarWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: SURFACE_2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: BORDER,
  },

  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
  },

  fallbackAvatar: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SURFACE_2,
  },

  jobIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: SURFACE_2,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
    borderWidth: 1,
    borderColor: BORDER,
  },

  rowTextWrap: {
    flex: 1,
    justifyContent: 'center',
  },

  rowPrimary: {
    color: TEXT_PRIMARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: 0.1,
  },

  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 30,
  },

  emptyTitle: {
    marginTop: 10,
    color: TEXT_PRIMARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
  },

  emptyText: {
    marginTop: 6,
    color: TEXT_SECONDARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },

  modalSafeArea: {
    flex: 1,
    backgroundColor: DARK_BG,
  },

  modalShell: {
    flex: 1,
    backgroundColor: DARK_BG,
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 16,
  },

  modalHeader: {
    minHeight: 42,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },

  modalTitle: {
    color: TEXT_PRIMARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: -0.3,
  },

  modalCloseIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    justifyContent: 'center',
  },

  searchInput: {
    minHeight: 50,
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 15,
    paddingHorizontal: 14,
    fontSize: 15,
    color: TEXT_PRIMARY,
    backgroundColor: INPUT_BG,
    fontFamily: SYSTEM_SANS,
  },

  modalLoadingWrap: {
    paddingTop: 24,
  },

  cityListContent: {
    paddingTop: 12,
    paddingBottom: 10,
  },

  cityItem: {
    minHeight: 58,
    borderRadius: 16,
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  cityItemSelected: {
    borderColor: '#3D3119',
    backgroundColor: '#0E0D09',
  },

  cityItemLeft: {
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
    borderColor: TEXT_TERTIARY,
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

  cityItemText: {
    flex: 1,
    fontSize: 14,
    color: TEXT_PRIMARY,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  cityItemTextSelected: {
    color: TEXT_PRIMARY,
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

  modalCancelButton: {
    marginTop: 4,
    minHeight: 50,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SURFACE,
    borderWidth: 1,
    borderColor: BORDER,
  },

  modalCancelText: {
    color: TEXT_SECONDARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    fontWeight: '800',
  },

  dimOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    justifyContent: 'flex-end',
  },

  jobModalCard: {
    backgroundColor: SURFACE,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
    paddingHorizontal: 18,
    paddingBottom: 22,
    paddingTop: 12,
    maxHeight: '88%',
    borderTopWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -8 },
    elevation: 10,
  },

  modalHandle: {
    alignSelf: 'center',
    width: 44,
    height: 5,
    borderRadius: 999,
    backgroundColor: '#2A2A2A',
    marginBottom: 16,
  },

  jobLoaderWrap: {
    paddingVertical: 30,
  },

  jobTitleBig: {
    color: TEXT_PRIMARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 20,
    fontWeight: '900',
    letterSpacing: -0.2,
  },

  jobBody: {
    marginTop: 10,
    color: TEXT_PRIMARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    lineHeight: 21,
  },

  jobInfoBlock: {
    marginTop: 10,
    paddingTop: 2,
  },

  jobMeta: {
    color: TEXT_SECONDARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 13,
    lineHeight: 18,
  },

  jobMetaStrong: {
    color: TEXT_PRIMARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 13,
    fontWeight: '800',
    lineHeight: 18,
  },

  link: {
    color: GOLD,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    textDecorationLine: 'underline',
  },

  iconTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },

  applyBox: {
    marginTop: 18,
    gap: 10,
  },

  primaryBtn: {
    minHeight: 52,
    borderRadius: 16,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },

  primaryBtnText: {
    color: DARK_BG,
    fontFamily: SYSTEM_SANS,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
  },

  ghostBtn: {
    minHeight: 50,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: SURFACE_2,
    borderWidth: 1,
    borderColor: BORDER,
  },

  ghostBtnText: {
    color: TEXT_SECONDARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 13,
    fontWeight: '800',
  },
});
