// app/screens/LocationScreen.tsx
import React, { useCallback, useState } from 'react';
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
} from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { COLORS as THEME_COLORS } from '../theme/colors';
import { Ionicons } from '@expo/vector-icons';

/* ────────────────────────────────────────────────────────────
   Cinematic noir base (gold accents, flatter like Jobs page)
   ──────────────────────────────────────────────────────────── */
const GOLD = '#C6A664';

const T = {
  bg: '#0B0B0B',
  surface: '#111111',
  text: '#FFFFFF',
  sub: '#C9C9C9',
  mute: '#9A9A9A',
  accent: '#FFFFFF',
  line: '#1A1A1A',
  border: '#1E1E1E',
  borderSoft: '#1A1A1A',
};

/** Reduced, consistent top offset (good on web & mobile) */
const TOP_BAR_OFFSET = Platform.OS === 'web' ? 24 : 12;

/** Headline & category font families */
const FONT_CINEMATIC =
  Platform.select({ ios: 'Cinzel', android: 'Cinzel', default: 'Cinzel' }) || 'Cinzel';
const FONT_CATEGORY =
  Platform.select({ ios: 'Avenir Next', android: 'sans-serif-light', default: 'Avenir Next' }) ||
  'Avenir Next';

const COLORS = {
  ...THEME_COLORS,
  background: T.bg,
  card: T.surface,
  textPrimary: T.text,
  textSecondary: T.sub,
  primary: T.accent,
  textOnPrimary: '#000000',
  border: T.border,
  borderSoft: T.borderSoft,
};

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
};

type JoinedUser =
  | { id: string; full_name?: string }
  | { id: string; full_name?: string }[]
  | null
  | undefined;
type JoinedCity =
  | { name?: string; country_code?: string }
  | { name?: string; country_code?: string }[]
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
  creative_roles?: JoinedRole; // creative_roles(name)
};

type JobDetail = {
  id: string;
  description: string | null;
  type: string | null; // 'Paid' | 'Free'
  currency: string | null;
  amount: string | number | null;
  rate: string | null;
  time: string | null;
  created_at: string;
  is_closed?: boolean | null;
  creative_roles?: JoinedRole; // creative_roles(name)
  cities?: JoinedCity; // cities(name, country_code)
  users?: JoinedUser; // users(id, full_name)
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

/** Prioritize exact match first, then starts-with, then others */
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

/* Small icon + text helper (neutral) */
const IconText: React.FC<{
  name: keyof typeof Ionicons.glyphMap;
  text: string;
  bold?: boolean;
}> = ({ name, text, bold }) => (
  <View style={styles.iconTextRow}>
    <Ionicons name={name} size={16} color={T.sub} style={{ marginRight: 8 }} />
    <Text style={[styles.jobMeta, bold && styles.jobMetaStrong]}>{text}</Text>
  </View>
);

export default function LocationScreen() {
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

  // Category tabs
  const [activeTab, setActiveTab] = useState<'creatives' | 'jobs'>('creatives');

  // Job modal / apply state
  const [jobDetailModalOpen, setJobDetailModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobDetail | null>(null);
  const [loadingSelectedJob, setLoadingSelectedJob] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);

  const navigation = useNavigation<any>();

  const fetchCities = useCallback(async (search: string) => {
    const q = search?.trim() || '';
    if (q.length < 2) {
      setCityItems([]);
      return;
    }

    setIsSearchingCities(true);

    const { data, error } = await supabase
      .from('cities')
      .select('id, name, country_code')
      .ilike('name', `%${q}%`)
      .limit(50);

    setIsSearchingCities(false);

    if (error) {
      console.error('Error fetching cities:', error.message);
      return;
    }

    if (data) {
      const prioritized = prioritizeCityMatches(data, q);
      setCityItems(
        prioritized.map((item) => ({
          label: `${getFlag(item.country_code)} ${item.name}, ${item.country_code}`,
          value: item.id,
          country: item.country_code,
        }))
      );
    }
  }, []);

  const handleSearch = async () => {
    if (!city) return;

    setSearching(true);
    setSearched(false);

    const [usersRes, jobsRes] = await Promise.all([
      supabase.from('users').select('id, full_name').eq('city_id', city.value),
      supabase
        .from('jobs')
        .select('id, title, is_closed, creative_roles:role_id (name)')
        .eq('city_id', city.value)
        .eq('is_closed', false), // hide closed
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
    if (detail) {
      setSelectedJob(detail);
    }
  };

  const applyToSelectedJob = useCallback(async () => {
    if (!selectedJob) return;

    const { data: auth } = await supabase.auth.getUser();
    const me = auth?.user;
    if (!me) return Alert.alert('Please log in to apply.');

    // Safety re-check
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
    <ScrollView
      contentContainerStyle={[styles.container, { paddingTop: TOP_BAR_OFFSET }]}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      {/* Headline (now matches category font/weight/letter-spacing) */}
      <Text style={styles.title}>Find jobs and creatives in your city</Text>

      {/* City select — turns GOLD + Cinzel when a city is selected */}
      <TouchableOpacity
        style={styles.citySelectButton}
        onPress={() => setSearchModalVisible(true)}
        activeOpacity={0.92}
      >
        <View style={styles.citySelectInner}>
          <Ionicons name="location-outline" size={18} color={city ? GOLD : T.sub} />
          <Text
            style={[
              styles.citySelectButtonText,
              city && styles.citySelectButtonTextSelected,
            ]}
          >
            {city ? city.label : 'Spell your city correctly, e.g. Skyros / Skýros'}
          </Text>
        </View>
      </TouchableOpacity>

      {/* Softer Search button (calm fill, no harsh contrast) */}
      {city && (
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch} activeOpacity={0.92}>
          {searching ? <ActivityIndicator color={T.text} /> : <Text style={styles.searchButtonText}>Search</Text>}
        </TouchableOpacity>
      )}

      {searched && (
        <View style={styles.resultsSection}>
          {/* Category-style tabs (CREATIVES / JOBS) */}
          <View style={styles.categoryTabsRow}>
            {(['creatives', 'jobs'] as const).map((tab) => {
              const active = activeTab === tab;
              const count = tab === 'creatives' ? users.length : jobs.length;
              const label = `${tab.toUpperCase()}${count ? ` (${count})` : ''}`;
              return (
                <TouchableOpacity
                  key={tab}
                  style={styles.categoryTap}
                  onPress={() => setActiveTab(tab)}
                  activeOpacity={0.92}
                >
                  <Text style={[styles.categoryText, active && styles.categoryTextActive]}>{label}</Text>
                  {active ? <View style={styles.categoryUnderline} /> : <View style={{ height: 3 }} />}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Tab content */}
          {activeTab === 'creatives' ? (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Creatives in {city?.label}</Text>
              {users.length === 0 ? (
                <Text style={styles.emptyText}>No creatives here yet, be the first.</Text>
              ) : (
                users.map((user) => (
                  <TouchableOpacity
                    key={user.id}
                    onPress={() => goToProfile(user)}
                    activeOpacity={0.85}
                    style={styles.resultRow}
                  >
                    {/* User name in gold Cinzel */}
                    <Text style={styles.resultUserGold}>• {user.full_name}</Text>
                    <Text style={styles.viewLink}>View</Text>
                  </TouchableOpacity>
                ))
              )}
            </View>
          ) : (
            <View style={styles.card}>
              <Text style={styles.sectionTitle}>Jobs in {city?.label}</Text>
              {jobs.length === 0 ? (
                <Text style={styles.emptyText}>No jobs in this city yet.</Text>
              ) : (
                jobs.map((job) => {
                  const roleName = getRoleFromJoin(job.creative_roles)?.name;
                  return (
                    <TouchableOpacity
                      key={job.id}
                      onPress={() => onPressJob(job)}
                      activeOpacity={0.85}
                      style={styles.resultRow}
                    >
                      {/* Job role name in gold + category font */}
                      <Text style={styles.resultJobGold}>• {roleName || job.title || 'Job'}</Text>
                      <Text style={styles.viewLink}>Open</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}

          {/* Bottom CTA */}
          <TouchableOpacity
            style={styles.joinButton}
            onPress={joinCityChat}
            disabled={joining}
            activeOpacity={0.92}
          >
            {joining ? (
              <ActivityIndicator />
            ) : (
              <Text style={styles.joinButtonText}>
                {users.length === 0 && jobs.length === 0
                  ? 'Be the first — Join City Group Chat'
                  : 'Join City Group Chat'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* City Search Modal */}
      <Modal
        visible={searchModalVisible}
        animationType={Platform.OS === 'web' ? 'none' : 'slide'}
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Search for your city</Text>
          <TextInput
            placeholder="Start typing..."
            placeholderTextColor={T.mute}
            value={citySearchTerm}
            onChangeText={(text) => {
              setCitySearchTerm(text);
              void fetchCities(text);
            }}
            style={styles.searchInput}
            autoFocus
          />
        {isSearchingCities ? (
            <ActivityIndicator style={{ marginTop: 20 }} color={T.accent} />
          ) : (
            <FlatList
              data={cityItems}
              keyExtractor={(item) => item.value.toString()}
              keyboardShouldPersistTaps="handled"
              renderItem={({ item }) => {
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
                      {selected ? <Ionicons name="checkmark-outline" size={16} color={GOLD} /> : null}
                      <Text style={[styles.cityItemText, selected && { color: GOLD }]}>{item.label}</Text>
                    </View>
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
      </Modal>

      {/* Job Details / Apply Modal */}
      <Modal
        visible={jobDetailModalOpen}
        animationType={Platform.OS === 'web' ? 'none' : 'slide'}
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
                <ActivityIndicator size="large" color={T.accent} />
              </View>
            ) : selectedJob ? (
              <>
                <Text style={styles.jobTitleBig}>
                  {getRoleFromJoin(selectedJob.creative_roles)?.name ?? 'Job'}
                </Text>

                {/* Closed notice */}
                {selectedJob.is_closed ? (
                  <View style={{ marginTop: 6 }}>
                    <IconText name="alert-circle-outline" text="This job is closed." bold />
                  </View>
                ) : null}

                {selectedJob.description ? (
                  <Text style={styles.jobBody}>{selectedJob.description}</Text>
                ) : null}

                {/* Meta */}
                <View style={{ marginTop: 8 }}>
                  <IconText
                    name="location-outline"
                    text={`${getCityFromJoin(selectedJob.cities)?.name ?? 'Unknown'}${
                      getCityFromJoin(selectedJob.cities)?.country_code
                        ? `, ${getCityFromJoin(selectedJob.cities)?.country_code}`
                        : ''
                    }`}
                  />

                  {/* Person + clickable name */}
                  <View style={styles.iconTextRow}>
                    <Ionicons name="person-outline" size={16} color={T.sub} style={{ marginRight: 8 }} />
                    <TouchableOpacity
                      onPress={() => {
                        const poster = getUserFromJoin(selectedJob.users);
                        if (poster?.id) {
                          // Navigate to profile
                          // @ts-ignore
                          navigation.navigate('Profile', { user: { id: poster.id, full_name: poster.full_name || 'Profile' } });
                        }
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.link}>{getUserFromJoin(selectedJob.users)?.full_name || 'View Profile'}</Text>
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

                  {selectedJob.time ? (
                    <IconText name="time-outline" text={selectedJob.time} />
                  ) : null}
                </View>

                {/* Apply */}
                <View style={styles.applyBox}>
                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      (applyLoading || selectedJob.is_closed) && { opacity: 0.6 },
                    ]}
                    onPress={applyToSelectedJob}
                    disabled={applyLoading || !!selectedJob.is_closed}
                    activeOpacity={0.9}
                  >
                    {applyLoading ? (
                      <ActivityIndicator color={T.text} />
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
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    padding: 16,
    paddingBottom: 28,
    flexGrow: 1,
  },

  /** Title now matches category font (OBLIVION-style) */
  title: {
    fontSize: 20,
    letterSpacing: 6.5,
    color: COLORS.textPrimary,
    marginBottom: 14,
    textAlign: 'center',
    textTransform: 'uppercase',
    fontFamily: FONT_CATEGORY,
    fontWeight: Platform.OS === 'android' ? ('300' as any) : '400',
  },

  /* City select */
  citySelectButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    backgroundColor: '#121212',
    marginBottom: 12,
  },
  citySelectInner: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
  },
  citySelectButtonText: {
    color: COLORS.textSecondary,
    fontSize: 15,
    textAlign: 'center',
    fontFamily: FONT_CATEGORY,
    letterSpacing: 1.8,
  },
  citySelectButtonTextSelected: {
    color: GOLD,
    fontFamily: FONT_CINEMATIC,
    letterSpacing: 2.5,
    fontWeight: Platform.OS === 'web' ? ('700' as any) : '700',
  },

  /* Softer search button */
  searchButton: {
    backgroundColor: '#151515',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  searchButtonText: {
    color: COLORS.textPrimary,
    fontWeight: '800',
    letterSpacing: 0.6,
  },

  resultsSection: {
    marginTop: 4,
  },

  /* Category tabs (like Challenge categories) */
  categoryTabsRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    gap: 22,
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginBottom: 10,
  },
  categoryTap: { alignItems: 'center' },
  categoryText: {
    color: '#CFCFCF',
    fontFamily: FONT_CATEGORY,
    letterSpacing: 6.0,
    textTransform: 'uppercase',
    fontSize: 12.5,
    fontWeight: Platform.OS === 'android' ? ('300' as any) : '400',
  },
  categoryTextActive: { color: GOLD },
  categoryUnderline: { marginTop: 6, height: 3, width: 42, backgroundColor: GOLD, borderRadius: 2 },

  /* Cards */
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 14,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '900',
    color: COLORS.textPrimary,
    marginBottom: 8,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  emptyText: {
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginBottom: 6,
  },

  /* Rows */
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 8,
  },
  // Users: gold Cinzel
  resultUserGold: {
    color: GOLD,
    fontFamily: FONT_CINEMATIC,
    letterSpacing: 1.2,
    fontSize: 15,
  },
  // Jobs: gold category font
  resultJobGold: {
    color: GOLD,
    fontFamily: FONT_CATEGORY,
    letterSpacing: 2.5,
    textTransform: 'uppercase',
    fontSize: 13.5,
    fontWeight: Platform.OS === 'android' ? ('300' as any) : '400',
  },
  viewLink: {
    color: COLORS.primary,
    fontWeight: '700',
    paddingHorizontal: 6,
    letterSpacing: 0.2,
  },

  /* Join CTA */
  joinButton: {
    backgroundColor: '#121212',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  joinButtonText: {
    color: COLORS.textPrimary,
    fontWeight: '800',
    fontSize: 15,
    letterSpacing: 0.6,
  },

  /* Modal */
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: Platform.OS === 'web' ? ('700' as any) : '700',
    color: COLORS.textPrimary,
    marginBottom: 12,
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 2.0,
    fontFamily: FONT_CINEMATIC,
  },
  searchInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: COLORS.textPrimary,
    backgroundColor: '#121212',
  },
  cityItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
  },
  cityItemSelected: {
    backgroundColor: '#131313',
  },
  cityItemText: {
    fontSize: 15,
    color: COLORS.textPrimary,
  },
  closeModalButton: {
    marginTop: 16,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  closeModalText: {
    fontSize: 16,
    fontWeight: '800',
    color: COLORS.textPrimary,
    letterSpacing: 0.4,
  },

  /* Job modal */
  dimOverlay: {
    flex: 1,
    backgroundColor: '#00000066',
    justifyContent: 'flex-end',
  },
  jobModalCard: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    maxHeight: '88%',
    shadowColor: COLORS.shadow || '#000',
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
    borderTopWidth: 1,
    borderColor: COLORS.border,
  },
  jobTitleBig: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textPrimary,
  },
  jobBody: {
    fontSize: 14,
    color: COLORS.textPrimary,
    marginTop: 8,
    lineHeight: 20,
  },
  jobMeta: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  jobMetaStrong: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '800',
    marginTop: 4,
  },
  link: {
    color: COLORS.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  iconTextRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 4,
  },
  applyBox: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  primaryBtn: {
    backgroundColor: '#151515',
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  primaryBtnText: {
    color: COLORS.textPrimary,
    fontWeight: '800',
    fontSize: 16,
    letterSpacing: 0.6,
  },
  ghostBtn: {
    backgroundColor: '#121212',
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 12,
  },
  ghostBtnText: {
    color: COLORS.primary,
    fontWeight: '700',
  },
});
