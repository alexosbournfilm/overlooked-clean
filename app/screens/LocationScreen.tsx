// app/screens/LocationScreen.tsx
import React, { useCallback, useMemo, useRef, useState } from 'react';
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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthProvider';
import { useAppRefresh } from '../context/AppRefreshContext';

const IS_WEB = Platform.OS === 'web';

/* ────────────────────────────────────────────────────────────
   Cinematic dark palette aligned with the rest of Overlooked
   ──────────────────────────────────────────────────────────── */
const DARK_BG = '#000000';
const SURFACE = '#080808';
const SURFACE_2 = '#0D0D0D';
const SURFACE_3 = '#121212';
const INPUT_BG = '#0B0B0B';
const TEXT_PRIMARY = '#F3EEE4';
const TEXT_SECONDARY = '#A9A295';
const TEXT_TERTIARY = '#776F64';
const BORDER = '#181818';
const BORDER_SOFT = '#141414';
const GOLD = '#C6A664';
const GOLD_DARK = '#9C7B39';

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
}

type Conversation = {
  id: string;
  name?: string | null;
  is_group: boolean;
  city_id: number | null;
  participant_ids: string[] | null;
  last_message_at?: string | null;
};

type LocatedUser = {
  id: string;
  full_name: string;
  avatar_url?: string | null;
  level?: number | null;
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

const IconText: React.FC<{
  name: keyof typeof Ionicons.glyphMap;
  text: string;
  bold?: boolean;
}> = ({ name, text, bold }) => (
  <View style={styles.iconTextRow}>
    <Ionicons name={name} size={16} color={TEXT_SECONDARY} style={{ marginRight: 8 }} />
    <Text style={[styles.jobMeta, bold && styles.jobMetaStrong]}>{text}</Text>
  </View>
);

export default function LocationScreen() {
  const insets = useSafeAreaInsets();
  const { triggerAppRefresh } = useAppRefresh();

  const [city, setCity] = useState<DropdownOption | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [cityItems, setCityItems] = useState<DropdownOption[]>([]);
  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [citySearchTerm, setCitySearchTerm] = useState('');
  const [isSearchingCities, setIsSearchingCities] = useState(false);

  const [users, setUsers] = useState<LocatedUser[]>([]);
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

  const effectiveCityQuery = useMemo(() => parseCityQuery(citySearchTerm), [citySearchTerm]);

  const fetchCities = useCallback(async (search: string) => {
    const raw = (search || '').trim();
    const { cityQuery, countryCode } = parseCityQuery(raw);

    latestCityTermRef.current = raw;

    if (cityQuery.length < 2) {
      setCityItems([]);
      setIsSearchingCities(false);
      return;
    }

    const myReqId = ++cityReqIdRef.current;
    setIsSearchingCities(true);

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
        console.error('Error fetching cities:', finalError.message);
        setCityItems([]);
        return;
      }

      if (finalData) {
        const prioritized = prioritizeCityMatches(finalData, raw);
        setCityItems(
          prioritized.map((item) => ({
            label: `${getFlag(item.country_code)} ${item.name}, ${item.country_code}`,
            value: item.id,
            country: item.country_code,
          }))
        );
      }
    } finally {
      if (myReqId === cityReqIdRef.current && latestCityTermRef.current === raw) {
        setIsSearchingCities(false);
      }
    }
  }, []);

  const handleSearch = async () => {
    if (!city) return;

    setSearching(true);
    setSearched(false);

    const [usersRes, jobsRes] = await Promise.all([
      supabase.from('users').select('id, full_name, avatar_url, level').eq('city_id', city.value),
      supabase
        .from('jobs')
        .select('id, title, is_closed, creative_roles:role_id (name)')
        .eq('city_id', city.value)
        .eq('is_closed', false),
    ]);

    if (usersRes.error) console.error(usersRes.error.message);
    if (jobsRes.error) console.error(jobsRes.error.message);

    setUsers((usersRes.data as LocatedUser[]) || []);
    setJobs((jobsRes.data as LocatedJobLite[]) || []);
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
      }
    } catch (e: any) {
      console.warn('Location refresh error:', e?.message || e);
    } finally {
      setRefreshing(false);
    }
  }, [refreshing, triggerAppRefresh, city, citySearchTerm, fetchCities]);

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

  const goToProfile = (user?: { id: string; full_name?: string }) => {
    if (!user?.id) return;
    navigation.navigate('Profile', { user });
  };

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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
  style={styles.screen}
  contentContainerStyle={[
    styles.container,
    { paddingTop: insets.top > 0 ? 4 : 10 },
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
        progressBackgroundColor={DARK_BG}
      />
    ) : undefined
  }
>
        <View style={styles.content}>
          <View style={styles.heroCard}>
           
            <Text style={styles.heroTitle}>Find your city</Text>
            <Text style={styles.heroSub}>
              Search by city to discover creatives, local jobs, and the city group chat.
            </Text>

            <TouchableOpacity
              style={styles.cityInput}
              onPress={() => setSearchModalVisible(true)}
              activeOpacity={0.92}
            >
              <Ionicons name="search-outline" size={18} color={city ? GOLD : TEXT_TERTIARY} />
              <Text style={[styles.cityInputText, city && styles.cityInputTextSelected]} numberOfLines={1}>
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
                  <ActivityIndicator color={DARK_BG} />
                ) : (
                  <Text style={styles.searchButtonText}>Search</Text>
                )}
              </TouchableOpacity>

              {canShowTopActions ? (
                <TouchableOpacity
                  style={styles.joinTopButton}
                  onPress={joinCityChat}
                  disabled={joining}
                  activeOpacity={0.92}
                >
                  {joining ? (
                    <ActivityIndicator color={TEXT_PRIMARY} />
                  ) : (
                    <>
                      <Ionicons name="chatbubble-ellipses-outline" size={17} color={TEXT_PRIMARY} />
                      <Text style={styles.joinTopButtonText}>
                        {isGuest ? 'Sign In to Join City Chat' : 'Join City Group Chat'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              ) : null}
            </View>
          </View>

          {searched && (
            <View style={styles.resultsWrap}>
              <View style={styles.tabsOuter}>
                <View style={styles.tabsRow}>
                  {(['creatives', 'jobs'] as const).map((tab) => {
                    const active = activeTab === tab;
                    const count = tab === 'creatives' ? users.length : jobs.length;

                    return (
                      <TouchableOpacity
                        key={tab}
                        style={[styles.tabButton, active && styles.tabButtonActive]}
                        onPress={() => setActiveTab(tab)}
                        activeOpacity={0.92}
                      >
                        <Text style={[styles.tabButtonText, active && styles.tabButtonTextActive]}>
                          {tab === 'creatives' ? 'Creatives' : 'Jobs'} ({count})
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </View>

              <View style={styles.resultsCard}>
                <View style={styles.resultsHeader}>
                  <Text style={styles.resultsTitle}>
                    {activeTab === 'creatives' ? 'Creatives' : 'Jobs'}
                  </Text>
                  <Text style={styles.resultsSubtitle} numberOfLines={1}>
                    {city?.label}
                  </Text>
                </View>

                {activeTab === 'creatives' ? (
                  users.length === 0 ? (
                    <View style={styles.emptyState}>
                      <Ionicons name="people-outline" size={20} color={TEXT_TERTIARY} />
                      <Text style={styles.emptyTitle}>No creatives here yet</Text>
                      <Text style={styles.emptyText}>Be the first to connect in this city.</Text>
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
                            index === 0 && styles.listRowFirst,
                            index === users.length - 1 && styles.listRowLast,
                          ]}
                        >
                          <View style={styles.avatarWrap}>
                            {avatarUri ? (
                              <Image source={{ uri: avatarUri }} style={styles.avatar} />
                            ) : (
                              <View style={[styles.avatar, styles.fallbackAvatar]}>
                                <Ionicons name="person-outline" size={18} color={TEXT_SECONDARY} />
                              </View>
                            )}
                          </View>

                          <View style={styles.rowTextWrap}>
                            <Text style={styles.rowPrimary} numberOfLines={1}>
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
                    <Text style={styles.emptyTitle}>No jobs in this city</Text>
                    <Text style={styles.emptyText}>Check back later or join the local chat.</Text>
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
                          index === 0 && styles.listRowFirst,
                          index === jobs.length - 1 && styles.listRowLast,
                        ]}
                      >
                        <View style={styles.jobIconWrap}>
                          <Ionicons name="briefcase-outline" size={17} color={TEXT_PRIMARY} />
                        </View>

                        <View style={styles.rowTextWrap}>
                          <Text style={styles.rowPrimary} numberOfLines={1}>
                            {roleName || job.title || 'Job'}
                          </Text>
                        </View>

                        <Ionicons name="chevron-forward" size={18} color={TEXT_TERTIARY} />
                      </TouchableOpacity>
                    );
                  })
                )}
              </View>
            </View>
          )}
        </View>

        <Modal
          visible={searchModalVisible}
          animationType={IS_WEB ? 'none' : 'slide'}
          onRequestClose={() => setSearchModalVisible(false)}
        >
          <SafeAreaView style={styles.modalSafeArea} edges={['top']}>
            <View style={styles.modalShell}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Choose a city</Text>

                <TouchableOpacity
                  onPress={() => setSearchModalVisible(false)}
                  style={styles.modalCloseIcon}
                  activeOpacity={0.85}
                >
                  <Ionicons name="close" size={18} color={TEXT_PRIMARY} />
                </TouchableOpacity>
              </View>

              <TextInput
                placeholder="Start typing a city..."
                placeholderTextColor={TEXT_TERTIARY}
                value={citySearchTerm}
                onChangeText={(text) => {
                  setCitySearchTerm(text);
                  void fetchCities(text);
                }}
                style={[styles.searchInput, WEB_NO_OUTLINE]}
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
                        style={[styles.cityItem, selected && styles.cityItemSelected]}
                        onPress={() => {
                          setCity(item);
                          setSearchModalVisible(false);
                        }}
                        activeOpacity={0.9}
                      >
                        <View style={styles.cityItemLeft}>
                          <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                            {selected ? <View style={styles.radioInner} /> : null}
                          </View>

                          <Text style={[styles.cityItemText, selected && styles.cityItemTextSelected]}>
                            {item.label}
                          </Text>
                        </View>

                        {index === 0 && effectiveCityQuery.cityQuery.length >= 3 ? (
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
                onPress={() => setSearchModalVisible(false)}
                style={styles.modalCancelButton}
                activeOpacity={0.92}
              >
                <Text style={styles.modalCancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </Modal>

        <Modal
          visible={jobDetailModalOpen}
          animationType={IS_WEB ? 'none' : 'slide'}
          transparent
          onRequestClose={() => {
            setJobDetailModalOpen(false);
            setSelectedJob(null);
          }}
        >
          <View style={styles.dimOverlay}>
            <View style={styles.jobModalCard}>
              {loadingSelectedJob ? (
                <View style={styles.jobLoaderWrap}>
                  <ActivityIndicator size="large" color={GOLD} />
                </View>
              ) : selectedJob ? (
                <>
                  <View style={styles.modalHandle} />

                  <Text style={styles.jobTitleBig}>
                    {getRoleFromJoin(selectedJob.creative_roles)?.name ?? 'Job'}
                  </Text>

                  {selectedJob.is_closed ? (
                    <View style={{ marginTop: 8 }}>
                      <IconText name="alert-circle-outline" text="This job is closed." bold />
                    </View>
                  ) : null}

                  {selectedJob.description ? (
                    <Text style={styles.jobBody}>{selectedJob.description}</Text>
                  ) : null}

                  <View style={styles.jobInfoBlock}>
                    <IconText
                      name="location-outline"
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
                        <Text style={styles.link}>
                          {getUserFromJoin(selectedJob.users)?.full_name || 'View Profile'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {selectedJob.type === 'Paid' ? (
                      <IconText
                        name="cash-outline"
                        bold
                        text={`${selectedJob.currency ?? ''}${selectedJob.amount ?? ''}${
                          selectedJob.rate ? ` / ${selectedJob.rate}` : ''
                        }`}
                      />
                    ) : (
                      <IconText name="people-outline" bold text="Free / Collab" />
                    )}

                    {selectedJob.time ? <IconText name="time-outline" text={selectedJob.time} /> : null}
                  </View>

                  <View style={styles.applyBox}>
                    <TouchableOpacity
                      style={[styles.primaryBtn, (applyLoading || selectedJob.is_closed) && { opacity: 0.6 }]}
                      onPress={applyToSelectedJob}
                      disabled={applyLoading || !!selectedJob.is_closed}
                      activeOpacity={0.9}
                    >
                      {applyLoading ? (
                        <ActivityIndicator color={DARK_BG} />
                      ) : (
                        <Text style={styles.primaryBtnText}>
                          {selectedJob.is_closed ? 'Closed' : isGuest ? 'Sign In to Apply' : 'Apply'}
                        </Text>
                      )}
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => {
                        setJobDetailModalOpen(false);
                        setSelectedJob(null);
                      }}
                      style={styles.ghostBtn}
                      activeOpacity={0.9}
                    >
                      <Text style={styles.ghostBtnText}>Close</Text>
                    </TouchableOpacity>
                  </View>
                </>
              ) : (
                <Text style={styles.emptyText}>Couldn’t load this job.</Text>
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
    maxWidth: 760,
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
  },

  
  heroTitle: {
    marginTop: 8,
    color: TEXT_PRIMARY,
    fontFamily: SYSTEM_SANS,
    fontSize: 30,
    fontWeight: '900',
    textAlign: 'center',
    letterSpacing: -0.5,
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