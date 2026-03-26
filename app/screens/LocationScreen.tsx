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
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { Ionicons } from '@expo/vector-icons';

const IS_WEB = Platform.OS === 'web';

/* ────────────────────────────────────────────────────────────
   Minimal palette (keeps your dark aesthetic but “ChatGPT-home” layout)
   ──────────────────────────────────────────────────────────── */
const DARK_BG = '#000000';
const DARK_ELEVATED = '#141414';
const DARK_PILL = '#111111';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = '#A7A6A2';
const DIVIDER = '#2A2A2A';
const GOLD = '#C6A664';

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
  currency: string | null;
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

const getLevelRingColor = (level?: number | null): string => {
  if (!level || level < 25) return '#FFFFFF';
  if (level < 50) return '#C0C0C0';
  return '#FFD700';
};

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
    <Ionicons name={name} size={16} color={TEXT_MUTED} style={{ marginRight: 8 }} />
    <Text style={[styles.jobMeta, bold && styles.jobMetaStrong]}>{text}</Text>
  </View>
);

export default function LocationScreen() {
  const insets = useSafeAreaInsets();

  const [city, setCity] = useState<DropdownOption | null>(null);
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

      const { data: auth } = await supabase.auth.getUser();
      const userId = auth?.user?.id;
      if (!userId) {
        Alert.alert('You need to be signed in to join the city chat.');
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

    const { data: auth } = await supabase.auth.getUser();
    const me = auth?.user;
    if (!me) return Alert.alert('Please log in to apply.');

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
  }, [selectedJob]);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.container, { paddingTop: insets.top > 0 ? 6 : 12 }]}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.hero}>
          <Text style={styles.heroTitle}>What’s your city?</Text>
          <Text style={styles.heroSub}>
            Search your city to find creatives, jobs, and join the local group chat.
          </Text>

          <TouchableOpacity
            style={styles.cityPill}
            onPress={() => setSearchModalVisible(true)}
            activeOpacity={0.92}
          >
            <Ionicons name="search-outline" size={18} color={city ? GOLD : TEXT_MUTED} />
            <Text style={[styles.cityPillText, city && styles.cityPillTextSelected]} numberOfLines={1}>
              {city ? city.label : 'Type a city… (e.g. Rome, IT)'}
            </Text>
          </TouchableOpacity>

          {city ? (
            <TouchableOpacity style={styles.primaryPillBtn} onPress={handleSearch} activeOpacity={0.92}>
              {searching ? (
                <ActivityIndicator color={DARK_BG} />
              ) : (
                <Text style={styles.primaryPillBtnText}>Search</Text>
              )}
            </TouchableOpacity>
          ) : null}
        </View>

        {searched && (
          <View style={styles.resultsSection}>
            <View style={styles.tabsRow}>
              {(['creatives', 'jobs'] as const).map((tab) => {
                const active = activeTab === tab;
                const count = tab === 'creatives' ? users.length : jobs.length;
                return (
                  <TouchableOpacity
                    key={tab}
                    style={[styles.tabBtn, active && styles.tabBtnActive]}
                    onPress={() => setActiveTab(tab)}
                    activeOpacity={0.92}
                  >
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>
                      {tab === 'creatives' ? 'Creatives' : 'Jobs'}
                      {typeof count === 'number' ? ` (${count})` : ''}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            <View style={styles.card}>
              <Text style={styles.sectionTitle}>
                {activeTab === 'creatives' ? 'Creatives' : 'Jobs'} in {city?.label}
              </Text>

              {activeTab === 'creatives' ? (
                users.length === 0 ? (
                  <Text style={styles.emptyText}>No creatives here yet.</Text>
                ) : (
                  users.map((user) => {
                    const avatarUri = user.avatar_url || null;
                    const ringColor = getLevelRingColor(user.level);

                    return (
                      <TouchableOpacity
                        key={user.id}
                        onPress={() => goToProfile(user)}
                        activeOpacity={0.85}
                        style={styles.row}
                      >
                        <View style={[styles.avatarRing, { borderColor: ringColor }]}>
                          {avatarUri ? (
                            <Image source={{ uri: avatarUri }} style={styles.avatar} />
                          ) : (
                            <View style={[styles.avatar, styles.fallbackAvatar]}>
                              <Ionicons name="person-outline" size={18} color={TEXT_MUTED} />
                            </View>
                          )}
                        </View>

                        <Text style={styles.rowPrimary} numberOfLines={1}>
                          {user.full_name}
                        </Text>

                        <Ionicons name="chevron-forward" size={18} color={TEXT_MUTED} />
                      </TouchableOpacity>
                    );
                  })
                )
              ) : jobs.length === 0 ? (
                <Text style={styles.emptyText}>No jobs in this city yet.</Text>
              ) : (
                jobs.map((job) => {
                  const roleName = getRoleFromJoin(job.creative_roles)?.name;
                  return (
                    <TouchableOpacity
                      key={job.id}
                      onPress={() => onPressJob(job)}
                      activeOpacity={0.85}
                      style={styles.row}
                    >
                      <Ionicons
                        name="briefcase-outline"
                        size={18}
                        color={TEXT_MUTED}
                        style={{ marginRight: 10 }}
                      />
                      <Text style={styles.rowPrimary} numberOfLines={1}>
                        {roleName || job.title || 'Job'}
                      </Text>
                      <Ionicons name="chevron-forward" size={18} color={TEXT_MUTED} />
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            <TouchableOpacity
              style={styles.joinPillBtn}
              onPress={joinCityChat}
              disabled={joining}
              activeOpacity={0.92}
            >
              {joining ? (
                <ActivityIndicator color={TEXT_IVORY} />
              ) : (
                <Text style={styles.joinPillBtnText}>Join City Group Chat</Text>
              )}
            </TouchableOpacity>
          </View>
        )}

        <Modal
          visible={searchModalVisible}
          animationType={IS_WEB ? 'none' : 'slide'}
          onRequestClose={() => setSearchModalVisible(false)}
        >
          <SafeAreaView style={styles.modalSafeArea} edges={['top']}>
            <View style={styles.modalContainer}>
              <Text style={styles.modalTitle}>Search your city</Text>

              <TextInput
                placeholder="Start typing..."
                placeholderTextColor={TEXT_MUTED}
                value={citySearchTerm}
                onChangeText={(text) => {
                  setCitySearchTerm(text);
                  void fetchCities(text);
                }}
                style={[styles.searchInput, WEB_NO_OUTLINE]}
                autoFocus
              />

              {isSearchingCities ? (
                <ActivityIndicator style={{ marginTop: 20 }} color={GOLD} />
              ) : (
                <FlatList
                  data={cityItems}
                  keyExtractor={(item) => item.value.toString()}
                  keyboardShouldPersistTaps="handled"
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
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                          {selected ? (
                            <Ionicons name="checkmark-outline" size={16} color={GOLD} />
                          ) : null}
                          <Text style={[styles.cityItemText, selected && { color: GOLD }]}>
                            {item.label}
                          </Text>
                        </View>

                        {index === 0 && effectiveCityQuery.cityQuery.length >= 3 ? (
                          <View style={styles.bestMatchPill}>
                            <Text style={styles.bestMatchText}>BEST MATCH</Text>
                          </View>
                        ) : null}
                      </TouchableOpacity>
                    );
                  }}
                />
              )}

              <TouchableOpacity
                onPress={() => setSearchModalVisible(false)}
                style={styles.closeModalButton}
                activeOpacity={0.92}
              >
                <Text style={styles.closeModalText}>Cancel</Text>
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
                <View style={{ paddingVertical: 20 }}>
                  <ActivityIndicator size="large" color={GOLD} />
                </View>
              ) : selectedJob ? (
                <>
                  <Text style={styles.jobTitleBig}>
                    {getRoleFromJoin(selectedJob.creative_roles)?.name ?? 'Job'}
                  </Text>

                  {selectedJob.is_closed ? (
                    <View style={{ marginTop: 6 }}>
                      <IconText name="alert-circle-outline" text="This job is closed." bold />
                    </View>
                  ) : null}

                  {selectedJob.description ? (
                    <Text style={styles.jobBody}>{selectedJob.description}</Text>
                  ) : null}

                  <View style={{ marginTop: 8 }}>
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
                        color={TEXT_MUTED}
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
                  </View>

                  <View style={{ marginTop: 6 }}>
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
                        <ActivityIndicator color={TEXT_IVORY} />
                      ) : (
                        <Text style={styles.primaryBtnText}>
                          {selectedJob.is_closed ? 'Closed' : 'Apply'}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>

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
    backgroundColor: DARK_BG,
    padding: 16,
    paddingBottom: 28,
    flexGrow: 1,
  },

  hero: {
    alignItems: 'center',
    paddingTop: 22,
    paddingBottom: 18,
  },
  heroTitle: {
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
    fontSize: 28,
    fontWeight: '900',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  heroSub: {
    marginTop: 10,
    maxWidth: 720,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 10,
  },

  cityPill: {
    marginTop: 18,
    width: '100%',
    maxWidth: 760,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: DARK_PILL,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
  },
  cityPillText: {
    flex: 1,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },
  cityPillTextSelected: {
    color: GOLD,
    fontWeight: '900',
  },

  primaryPillBtn: {
    marginTop: 12,
    width: '100%',
    maxWidth: 340,
    paddingVertical: 12,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GOLD,
  },
  primaryPillBtnText: {
    color: DARK_BG,
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  resultsSection: {
    marginTop: 10,
  },

  tabsRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
    marginBottom: 12,
    flexWrap: 'wrap',
  },
  tabBtn: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: DARK_PILL,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
  },
  tabBtnActive: {
    borderColor: GOLD,
  },
  tabText: {
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  tabTextActive: {
    color: GOLD,
  },

  card: {
    backgroundColor: DARK_ELEVATED,
    borderRadius: 16,
    padding: 14,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 10,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  emptyText: {
    color: TEXT_MUTED,
    fontStyle: 'italic',
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#232323',
  },
  rowPrimary: {
    flex: 1,
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.2,
  },

  avatarRing: {
    width: 38,
    height: 38,
    borderRadius: 19,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: '#101010',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#111',
  },
  fallbackAvatar: {
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
  },

  joinPillBtn: {
    marginTop: 12,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 520,
    backgroundColor: DARK_ELEVATED,
    paddingVertical: 14,
    borderRadius: 999,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
  },
  joinPillBtnText: {
    color: TEXT_IVORY,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  modalSafeArea: {
    flex: 1,
    backgroundColor: DARK_BG,
  },

  modalContainer: {
    flex: 1,
    backgroundColor: DARK_BG,
    padding: 20,
    paddingTop: 20,
  },
  modalTitle: {
    fontSize: 12,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 12,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 2.0,
    fontFamily: SYSTEM_SANS,
  },

  searchInput: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
    borderRadius: 14,
    padding: 12,
    fontSize: 14,
    color: TEXT_IVORY,
    backgroundColor: DARK_PILL,
    fontFamily: SYSTEM_SANS,
  },

  cityItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomColor: DIVIDER,
    borderBottomWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cityItemSelected: {
    backgroundColor: DARK_PILL,
  },
  cityItemText: {
    fontSize: 14,
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  bestMatchPill: {
    marginLeft: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: GOLD,
    backgroundColor: DARK_PILL,
  },
  bestMatchText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: GOLD,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  closeModalButton: {
    marginTop: 16,
    padding: 12,
    borderRadius: 999,
    alignItems: 'center',
    backgroundColor: DARK_ELEVATED,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
  },
  closeModalText: {
    fontSize: 12,
    fontWeight: '900',
    color: TEXT_MUTED,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  dimOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.66)',
    justifyContent: 'flex-end',
  },
  jobModalCard: {
    backgroundColor: DARK_BG,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    maxHeight: '88%',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -6 },
    elevation: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
  },
  jobTitleBig: {
    fontSize: 16,
    fontWeight: '900',
    color: TEXT_IVORY,
    letterSpacing: 0.8,
    fontFamily: SYSTEM_SANS,
    textTransform: 'uppercase',
  },
  jobBody: {
    fontSize: 14,
    color: TEXT_IVORY,
    marginTop: 8,
    lineHeight: 20,
    fontFamily: SYSTEM_SANS,
  },
  jobMeta: {
    fontSize: 13,
    color: TEXT_MUTED,
    marginTop: 4,
    fontFamily: SYSTEM_SANS,
  },
  jobMetaStrong: {
    fontSize: 13,
    color: TEXT_IVORY,
    fontWeight: '900',
    marginTop: 4,
    fontFamily: SYSTEM_SANS,
  },
  link: {
    color: GOLD,
    fontWeight: '900',
    textDecorationLine: 'underline',
    fontFamily: SYSTEM_SANS,
  },
  iconTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 6,
  },
  applyBox: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: DIVIDER,
  },
  primaryBtn: {
    backgroundColor: DARK_ELEVATED,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
  },
  primaryBtnText: {
    color: TEXT_IVORY,
    fontWeight: '900',
    fontSize: 12,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  ghostBtn: {
    backgroundColor: DARK_PILL,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: DIVIDER,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  ghostBtnText: {
    color: TEXT_MUTED,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
    fontSize: 12,
  },
});