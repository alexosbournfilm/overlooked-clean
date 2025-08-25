// LocationScreen.tsx

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
} from 'react-native';
import { CommonActions, useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import COLORS from '../theme/colors';

/**
 * NOTE:
 * - Preserves your original layout/logic and only ADDS:
 *   • Creatives/Jobs tabs after searching (only one list visible at a time)
 *   • Small count badges in tab labels
 *   • Everything else (profile nav, job modal/apply, city chat button position) unchanged
 * - UPDATED to hide/guard closed jobs:
 *   • Search query now filters jobs with .eq('is_closed', false)
 *   • JobDetail includes is_closed; Apply disabled and safety re-check before insert
 */

interface DropdownOption {
  label: string;
  value: number;
  country?: string;
}

// Optional TS type for convenience; fine to keep in JS too.
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

/** UPDATED: include role join so we can show "Actor, Open" in the list */
type LocatedJobLite = {
  id: string;
  title?: string | null;
  is_closed?: boolean | null; // <— added for clarity (though we filter out closed ones)
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
  is_closed?: boolean | null; // <— added so we can render/guard in modal
  creative_roles?: JoinedRole; // creative_roles(name)
  cities?: JoinedCity; // cities(name, country_code)
  users?: JoinedUser; // users(id, full_name)
};

// Helpers to read possibly-array joins safely
const getFirst = <T,>(v: T | T[] | null | undefined): T | undefined =>
  Array.isArray(v) ? v[0] : v ?? undefined;

const getUserFromJoin = (u: JoinedUser) => getFirst(u);
const getCityFromJoin = (c: JoinedCity) => getFirst(c);
const getRoleFromJoin = (r: JoinedRole) => getFirst(r);

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

  // NEW — tab state
  const [activeTab, setActiveTab] = useState<'creatives' | 'jobs'>('creatives');

  // Job modal / apply state
  const [jobDetailModalOpen, setJobDetailModalOpen] = useState(false);
  const [selectedJob, setSelectedJob] = useState<JobDetail | null>(null);
  const [loadingSelectedJob, setLoadingSelectedJob] = useState(false);
  const [applyLoading, setApplyLoading] = useState(false);
  // REMOVED: const [applyMessage, setApplyMessage] = useState('');

  const navigation = useNavigation<any>();

  const fetchCities = useCallback(async (search: string) => {
    if (!search || search.trim().length < 2) return;

    setIsSearchingCities(true);

    const { data, error } = await supabase
      .from('cities')
      .select('id, name, country_code')
      .ilike('name', `%${search.trim()}%`)
      .limit(30);

    setIsSearchingCities(false);

    if (error) {
      console.error('Error fetching cities:', error.message);
      return;
    }

    if (data) {
      const formatted = data.map((item) => ({
        label: `${getFlag(item.country_code)} ${item.name}, ${item.country_code}`,
        value: item.id,
        country: item.country_code,
      }));
      setCityItems(formatted);
    }
  }, []);

  const getFlag = (countryCode: string) => {
    return countryCode
      .toUpperCase()
      .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
  };

  const handleSearch = async () => {
    if (!city) return;

    setSearching(true);
    setSearched(false);

    /** UPDATED: include role join so we can show the role name in the list */
    const [usersRes, jobsRes] = await Promise.all([
      supabase.from('users').select('id, full_name').eq('city_id', city.value),
      supabase
        .from('jobs')
        .select('id, title, is_closed, creative_roles:role_id (name)')
        .eq('city_id', city.value)
        .eq('is_closed', false), // <— HIDE CLOSED JOBS HERE
    ]);

    if (usersRes.error) console.error(usersRes.error.message);
    if (jobsRes.error) console.error(jobsRes.error.message);

    setUsers((usersRes.data as LocatedUser[]) || []);
    setJobs((jobsRes.data as LocatedJobLite[]) || []);
    setSearching(false);
    setSearched(true);

    // Reset to Creatives tab each new search (mirrors Jobs screen behavior)
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

    // Safety re-check: make sure job is still open right now
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
      message: null, // changed from applyMessage || null
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
      // REMOVED: setApplyMessage('');
    }
  }, [selectedJob]);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>Find jobs and creatives in your city</Text>

      <TouchableOpacity
        style={styles.citySelectButton}
        onPress={() => setSearchModalVisible(true)}
      >
        <Text style={styles.citySelectButtonText}>
          {city ? city.label : 'Spell your city correctly, e.g. Skyros / Skýros'}
        </Text>
      </TouchableOpacity>

      {city && (
        <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
          {searching ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.searchButtonText}>Search</Text>
          )}
        </TouchableOpacity>
      )}

      {searched && (
        <View style={styles.resultsSection}>
          {/* NEW — Tab Toggle */}
          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'creatives' && styles.tabBtnActive]}
              onPress={() => setActiveTab('creatives')}
              activeOpacity={0.9}
            >
              <Text style={[styles.tabText, activeTab === 'creatives' && styles.tabTextActive]}>
                Creatives{users.length ? ` (${users.length})` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, activeTab === 'jobs' && styles.tabBtnActive]}
              onPress={() => setActiveTab('jobs')}
              activeOpacity={0.9}
            >
              <Text style={[styles.tabText, activeTab === 'jobs' && styles.tabTextActive]}>
                Jobs{jobs.length ? ` (${jobs.length})` : ''}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Only render the active tab’s content */}
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
                    <Text style={styles.resultItem}>• {user.full_name}</Text>
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
                      {/* UPDATED: show role name first; fall back to title or "Job" */}
                      <Text style={styles.resultItem}>• {roleName || job.title || 'Job'}</Text>
                      <Text style={styles.viewLink}>Open</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>
          )}

          {/* Stays at the bottom exactly as before */}
          <TouchableOpacity
            style={styles.joinButton}
            onPress={joinCityChat}
            disabled={joining}
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
        animationType="slide"
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Search for your city</Text>
          <TextInput
            placeholder="Start typing..."
            placeholderTextColor="#aaa"
            value={citySearchTerm}
            onChangeText={(text) => {
              setCitySearchTerm(text);
              fetchCities(text);
            }}
            style={styles.searchInput}
          />
          {isSearchingCities ? (
            <ActivityIndicator style={{ marginTop: 20 }} />
          ) : (
            <FlatList
              data={cityItems}
              keyExtractor={(item) => item.value.toString()}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.cityItem}
                  onPress={() => {
                    setCity(item);
                    setSearchModalVisible(false);
                  }}
                >
                  <Text style={styles.cityItemText}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          )}
          <TouchableOpacity
            onPress={() => setSearchModalVisible(false)}
            style={styles.closeModalButton}
          >
            <Text style={styles.closeModalText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Job Details / Apply Modal */}
      <Modal
        visible={jobDetailModalOpen}
        animationType="slide"
        transparent
        onRequestClose={() => {
          setJobDetailModalOpen(false);
          setSelectedJob(null);
          // REMOVED: setApplyMessage('');
        }}
      >
        <View style={styles.dimOverlay}>
          <View style={styles.jobModalCard}>
            {loadingSelectedJob ? (
              <View style={{ paddingVertical: 20 }}>
                <ActivityIndicator size="large" color={COLORS.primary} />
              </View>
            ) : selectedJob ? (
              <>
                <Text style={styles.jobTitleBig}>
                  {getRoleFromJoin(selectedJob.creative_roles)?.name ?? 'Job'}
                </Text>

                {selectedJob.is_closed ? (
                  <Text style={[styles.jobMetaStrong, { marginTop: 6 }]}>
                    🚫 This job is closed.
                  </Text>
                ) : null}

                {selectedJob.description ? (
                  <Text style={styles.jobBody}>{selectedJob.description}</Text>
                ) : null}

                <View style={{ marginTop: 8 }}>
                  <Text style={styles.jobMeta}>
                    📍 {getCityFromJoin(selectedJob.cities)?.name ?? 'Unknown'}
                    {getCityFromJoin(selectedJob.cities)?.country_code
                      ? `, ${getCityFromJoin(selectedJob.cities)?.country_code}`
                      : ''}
                  </Text>
                  <Text style={styles.jobMeta}>
                    👤{' '}
                    <Text
                      style={styles.link}
                      onPress={() => {
                        const poster = getUserFromJoin(selectedJob.users);
                        if (poster?.id) {
                          goToProfile({ id: poster.id, full_name: poster.full_name || 'Profile' });
                        }
                      }}
                    >
                      {getUserFromJoin(selectedJob.users)?.full_name || 'View Profile'}
                    </Text>
                  </Text>
                </View>

                <View style={{ marginTop: 6 }}>
                  <Text style={styles.jobMetaStrong}>
                    {selectedJob.type === 'Paid'
                      ? `💰 ${selectedJob.currency ?? ''}${selectedJob.amount ?? ''}${
                          selectedJob.rate ? ` / ${selectedJob.rate}` : ''
                        }`
                      : 'Free / Collab'}
                  </Text>
                  {selectedJob.time ? (
                    <Text style={styles.jobMeta}>🕒 {selectedJob.time}</Text>
                  ) : null}
                </View>

                {/* Removed message/introduce-yourself UI; keep Apply button */}
                <View style={styles.applyBox}>
                  <TouchableOpacity
                    style={[
                      styles.primaryBtn,
                      (applyLoading || selectedJob.is_closed) && { opacity: 0.5 },
                    ]}
                    onPress={applyToSelectedJob}
                    disabled={applyLoading || !!selectedJob.is_closed}
                    activeOpacity={0.9}
                  >
                    {applyLoading ? (
                      <ActivityIndicator color="#fff" />
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
                    // REMOVED: setApplyMessage('');
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
    padding: 20,
    flexGrow: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 20,
    textAlign: 'center',
  },
  citySelectButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    backgroundColor: COLORS.card,
    marginBottom: 20,
  },
  citySelectButtonText: {
    color: COLORS.textPrimary,
    fontSize: 16,
    textAlign: 'center',
  },
  searchButton: {
    backgroundColor: COLORS.primary,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 20,
  },
  searchButtonText: {
    color: COLORS.textOnPrimary,
    fontWeight: '600',
    fontSize: 16,
  },

  resultsSection: {
    marginTop: 10,
  },

  // NEW — Tabs
  tabRow: {
    flexDirection: 'row',
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 4,
    marginBottom: 12,
  },
  tabBtn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    alignItems: 'center',
  },
  tabBtnActive: {
    backgroundColor: COLORS.primary,
  },
  tabText: {
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  tabTextActive: {
    color: COLORS.textOnPrimary,
  },

  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
    elevation: 2,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 10,
  },
  emptyText: {
    color: COLORS.textPrimary,
    fontStyle: 'italic',
    marginBottom: 8,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 6,
  },
  resultItem: {
    color: COLORS.textPrimary,
    marginBottom: 6,
    marginLeft: 6,
    fontSize: 15,
  },
  viewLink: {
    color: COLORS.primary,
    fontWeight: '700',
    paddingHorizontal: 8,
  },
  joinButton: {
    backgroundColor: COLORS.mutedCard,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  joinButtonText: {
    color: COLORS.textPrimary,
    fontWeight: '600',
    fontSize: 16,
  },

  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 16,
    textAlign: 'center',
  },
  searchInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.card,
  },
  cityItem: {
    padding: 14,
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
  },
  cityItemText: {
    fontSize: 16,
    color: COLORS.textPrimary,
  },
  closeModalButton: {
    marginTop: 20,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    backgroundColor: COLORS.mutedCard,
  },
  closeModalText: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
  },

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
    color: COLORS.textPrimary,
    marginTop: 4,
  },
  jobMetaStrong: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '800',
    marginTop: 8,
  },
  link: {
    color: COLORS.primary,
    fontWeight: '700',
    textDecorationLine: 'underline',
  },
  applyBox: {
    marginTop: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  applyLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginBottom: 6,
    marginLeft: 4,
  },
  applyInput: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    color: COLORS.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  primaryBtn: {
    backgroundColor: COLORS.primary,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  primaryBtnText: {
    color: COLORS.textOnPrimary || '#fff',
    fontWeight: '800',
    fontSize: 16,
  },
  ghostBtn: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: 12,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 12,
  },
  ghostBtnText: {
    color: COLORS.primary,
    fontWeight: '700',
  },
});