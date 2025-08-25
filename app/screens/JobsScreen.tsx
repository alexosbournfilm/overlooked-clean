import React, { useEffect, useLayoutEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  KeyboardAvoidingView,
  Keyboard,
} from 'react-native';
import { COLORS } from '../theme/colors';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { supabase } from '../lib/supabase';
import { decode } from 'html-entities';
import DropDownPicker from 'react-native-dropdown-picker';

type CityOption = {
  label: string;
  value: number;
  country: string;
};

type RoleOption = {
  label: string;
  value: number;
};

// Helper: format "time ago" from an ISO timestamp
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

export default function JobsScreen() {
  const navigation = useNavigation();
  const [activeTab, setActiveTab] = useState<'paid' | 'free'>('paid');
  const [jobs, setJobs] = useState<any[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);

  // Role data for Post Job modal
  const [roles, setRoles] = useState<any[]>([]);
  const [roleOpen, setRoleOpen] = useState(false);

  // Post Job state
  const [jobFormVisible, setJobFormVisible] = useState(false);

  // Inline city overlay shown *inside* the Post Job modal
  const [jobCityOverlayVisible, setJobCityOverlayVisible] = useState(false);

  // (Kept) Full-screen city modal state (not used for Post Job anymore, but kept for parity)
  const [citySearchModalVisible, setCitySearchModalVisible] = useState(false);

  // Shared city search states
  const [citySearchTerm, setCitySearchTerm] = useState('');
  const [cityItems, setCityItems] = useState<CityOption[]>([]);
  const [searchingCities, setSearchingCities] = useState(false);

  const [formData, setFormData] = useState<any>({
    role_id: null,
    description: '',
    city: null as CityOption | null,
    type: 'Paid',
    currency: '£',
    rate: 'Flat Rate',
    amount: '',
    time: '',
  });

  const [selectedJob, setSelectedJob] = useState<any>(null);
  const [applyLoading, setApplyLoading] = useState(false);

  // Filters
  const [filterCity, setFilterCity] = useState<CityOption | null>(null);
  const [filterRole, setFilterRole] = useState<RoleOption | null>(null);

  const [cityFilterModalVisible, setCityFilterModalVisible] = useState(false);
  const [cityFilterSearchTerm, setCityFilterSearchTerm] = useState('');
  const [cityFilterItems, setCityFilterItems] = useState<CityOption[]>([]);
  const [searchingFilterCities, setSearchingFilterCities] = useState(false);

  const [roleFilterModalVisible, setRoleFilterModalVisible] = useState(false);
  const [roleFilterSearchTerm, setRoleFilterSearchTerm] = useState('');
  const [roleFilterItems, setRoleFilterItems] = useState<RoleOption[]>([]);
  const [searchingFilterRoles, setSearchingFilterRoles] = useState(false);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Jobs',
      headerTitleAlign: 'center',
      headerRight: () => (
        <TouchableOpacity style={{ marginRight: 16 }} onPress={() => alert('Settings')}>
          <Ionicons name="settings-outline" size={22} color={COLORS.textPrimary} />
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  // Fetch roles once
  useEffect(() => {
    fetchRoles();
  }, []);

  // Core job fetcher (memoized so realtime listener can call it)
  const fetchJobs = useCallback(async () => {
    setLoadingJobs(true);
    let query = supabase
      .from('jobs')
      .select(`*, users(id, full_name), cities(name, country_code), creative_roles(name)`)
      .eq('type', activeTab === 'paid' ? 'Paid' : 'Free')
      .eq('is_closed', false) // ✅ only show OPEN jobs
      .order('created_at', { ascending: false });

    if (filterCity?.value) query = query.eq('city_id', filterCity.value);
    if (filterRole?.value) query = query.eq('role_id', filterRole.value);

    const { data, error } = await query;

    if (error) {
      console.error(error);
      setJobs([]);
    } else {
      setJobs(data || []);
    }
    setLoadingJobs(false);
  }, [activeTab, filterCity, filterRole]);

  // Initial + whenever tabs/filters change
  useEffect(() => {
    fetchJobs();
  }, [fetchJobs]);

  // Realtime: refresh list on any jobs change so "Close Job" removes it immediately
  useEffect(() => {
    const channel = supabase
      .channel('jobs-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs' },
        (_payload) => {
          fetchJobs();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchJobs]);

  const fetchRoles = async () => {
    const { data, error } = await supabase.from('creative_roles').select('*').order('name');
    if (error) console.error(error);
    else setRoles(data || []);
  };

  // Navigate to profile
  const goToProfile = (userObj?: { id: string; full_name?: string }) => {
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

  // Flag -> emoji
  const getFlag = (cc: string) =>
    cc
      .toUpperCase()
      .split('')
      .map((c) => String.fromCodePoint(127397 + c.charCodeAt(0)))
      .join('');

  // City search (shared for overlay & legacy modal)
  const fetchCities = useCallback(async (search: string) => {
    if (!search || search.trim().length < 2) {
      setCityItems([]);
      return;
    }
    setSearchingCities(true);
    const { data, error } = await supabase
      .from('cities')
      .select('id, name, country_code')
      .ilike('name', `%${search.trim()}%`)
      .limit(50);

    setSearchingCities(false);
    if (error) console.error(error);
    else if (data) {
      setCityItems(
        data.map((c) => ({
          value: c.id,
          label: `${getFlag(c.country_code)} ${c.name}, ${c.country_code}`,
          country: c.country_code,
        }))
      );
    }
  }, []);

  // City search for Filter modal
  const fetchFilterCities = useCallback(async (search: string) => {
    if (!search || search.length < 2) {
      setCityFilterItems([]);
      return;
    }
    setSearchingFilterCities(true);
    const { data, error } = await supabase
      .from('cities')
      .select('id, name, country_code')
      .ilike('name', `%${search}%`)
      .limit(50);
    setSearchingFilterCities(false);

    if (error) console.error(error);
    else if (data) {
      setCityFilterItems(
        data.map((c) => ({
          value: c.id,
          label: `${getFlag(c.country_code)} ${c.name}, ${c.country_code}`,
          country: c.country_code,
        }))
      );
    }
  }, []);

  // Role search for Filter modal
  const fetchFilterRoles = useCallback(async (search: string) => {
    if (!search || search.length < 1) {
      setRoleFilterItems([]);
      return;
    }
    setSearchingFilterRoles(true);
    const { data, error } = await supabase
      .from('creative_roles')
      .select('id, name')
      .ilike('name', `%${search}%`)
      .order('name')
      .limit(50);
    setSearchingFilterRoles(false);

    if (error) console.error(error);
    else if (data) {
      setRoleFilterItems(
        data.map((r) => ({
          value: r.id,
          label: r.name,
        }))
      );
    }
  }, []);

  const handlePostJob = async () => {
    const user = (await supabase.auth.getUser()).data.user;
    if (!user || !formData.role_id || !formData.city) {
      return Alert.alert('Error', 'Please select role and city.');
    }

    const payload = {
      role_id: formData.role_id,
      description: formData.description,
      city_id: formData.city.value,
      type: formData.type,
      currency: formData.type === 'Paid' ? formData.currency : null,
      rate: formData.type === 'Paid' ? formData.rate : null,
      amount: formData.type === 'Paid' ? formData.amount : null,
      time: formData.time,
      user_id: user.id,
      // is_closed defaults to false in DB; no need to set here.
    };

    const { error } = await supabase.from('jobs').insert(payload);
    if (error) {
      console.error(error);
      Alert.alert('Error', 'Failed to post job.');
    } else {
      setJobFormVisible(false);
      resetForm();
      // No need to manually fetch — realtime sub will pick it up, but do it anyway for snappiness:
      fetchJobs();
    }
  };

  // Apply
  const handleApply = async () => {
    if (!selectedJob) return;
    const me = (await supabase.auth.getUser()).data.user;
    if (!me) return Alert.alert('Please log in to apply.');

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
      applied_at: new Date().toISOString(),
    });

    setApplyLoading(false);

    if (insertErr) {
      console.error(insertErr);
      Alert.alert('Error', 'Could not apply.');
    } else {
      Alert.alert('Success', 'Application sent.');
      setSelectedJob(null);
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
    });

  const anyFilterActive = useMemo(() => !!(filterCity || filterRole), [filterCity, filterRole]);
  const clearFilters = () => {
    setFilterCity(null);
    setFilterRole(null);
  };

  // Open the inline city picker overlay *inside* Post Job modal
  const openCityOverlayInJobForm = () => {
    setRoleOpen(false);
    Keyboard.dismiss();
    setCityItems([]);
    setCitySearchTerm('');
    setJobCityOverlayVisible(true);
  };

  // Render job card
  const renderJob = useCallback(
    ({ item: job }: { item: any }) => {
      const postedAgo = formatTimeAgo(job.created_at);
      return (
        <TouchableOpacity
          style={[styles.jobCard, styles.focusless]}
          onPress={() => setSelectedJob(job)}
          activeOpacity={0.9}
        >
          <Text style={styles.jobTitle}>{decode(job.creative_roles?.name || 'Job')}</Text>
          {job.description ? (
            <Text style={styles.jobDescription}>{decode(job.description)}</Text>
          ) : null}

          <Text style={styles.jobMeta}>
            📍 {job.cities?.name}
            {' • '}👤{' '}
            <Text
              style={styles.userLink}
              onPress={(e: any) => {
                e?.stopPropagation?.();
                goToProfile(job.users);
              }}
            >
              {job.users?.full_name || 'View Profile'}
            </Text>{' '}
            •{' '}
            {job.type === 'Paid'
              ? `💰 ${job.currency ?? ''}${job.amount ?? ''}${job.rate ? ` / ${job.rate}` : ''}`
              : 'Free / Collab'}
            {postedAgo ? ` • ⏱️ Posted ${postedAgo}` : ''}
          </Text>

          {job.time ? <Text style={styles.jobMeta}>🕒 Time: {job.time}</Text> : null}
        </TouchableOpacity>
      );
    },
    [goToProfile]
  );

  // List header (tabs + filters)
  const ListHeader = useMemo(
    () => (
      <View>
        <View style={styles.tabRow}>
          {['paid', 'free'].map((tab) => (
            <TouchableOpacity
              key={tab}
              style={[styles.tabButton, styles.focusless, activeTab === tab && styles.activeTab]}
              onPress={() => setActiveTab(tab as 'paid' | 'free')}
            >
              <Text style={[styles.tabText, activeTab === tab && styles.activeTabText]}>
                {tab === 'paid' ? 'Paid Jobs' : 'Free / Collab'}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterInput, styles.focusless]}
            onPress={() => setCityFilterModalVisible(true)}
            activeOpacity={0.85}
          >
            <Text style={{ color: filterCity ? COLORS.textPrimary : COLORS.textSecondary }}>
              {filterCity?.label || 'Filter by city'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterInput, styles.focusless]}
            onPress={() => setRoleFilterModalVisible(true)}
            activeOpacity={0.85}
          >
            <Text style={{ color: filterRole ? COLORS.textPrimary : COLORS.textSecondary }}>
              {filterRole?.label || 'Filter by role'}
            </Text>
          </TouchableOpacity>
        </View>

        {anyFilterActive ? (
          <TouchableOpacity onPress={clearFilters} style={[styles.clearBtn, styles.focusless]} activeOpacity={0.85}>
            <Text style={styles.clearBtnText}>Clear filters</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    ),
    [activeTab, filterCity, filterRole, anyFilterActive]
  );

  return (
    <View style={styles.container}>
      {loadingJobs ? (
        <ActivityIndicator size="large" color={COLORS.primary} style={{ flex: 1 }} />
      ) : (
        <FlatList
          data={jobs}
          keyExtractor={(j) => String(j.id)}
          renderItem={renderJob}
          ListHeaderComponent={ListHeader}
          ListEmptyComponent={
            <Text style={[styles.jobDescription, { textAlign: 'center', marginTop: 16 }]}>
              No jobs match these filters yet.
            </Text>
          }
          contentContainerStyle={{ paddingBottom: 120 }}
          refreshing={loadingJobs}
          onRefresh={fetchJobs}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Post a Job */}
      <TouchableOpacity style={[styles.postButton, styles.focusless]} onPress={() => setJobFormVisible(true)}>
        <Text style={styles.postButtonText}>＋ Post a Job</Text>
      </TouchableOpacity>

      {/* Post Job Modal */}
      <Modal
        visible={jobFormVisible}
        animationType="slide"
        onRequestClose={() => setJobFormVisible(false)}
      >
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <View style={styles.modalContainer}>
            <Text style={styles.modalTitle}>Post a New Job</Text>

            <ScrollView
              contentContainerStyle={{ paddingBottom: 140 }}
              keyboardShouldPersistTaps="always"
            >
              <Text style={styles.label}>Role</Text>
              <View style={{ zIndex: 3000 }}>
                <DropDownPicker
                  open={roleOpen}
                  value={formData.role_id}
                  items={roles.map((r) => ({ label: r.name, value: r.id }))}
                  setOpen={setRoleOpen}
                  setValue={(callback) => {
                    const selected =
                      typeof callback === 'function' ? callback(formData.role_id) : callback;
                    setFormData({ ...formData, role_id: selected });
                  }}
                  setItems={() => {}}
                  placeholder="Select role"
                  listMode="MODAL"
                  modalTitle="Select a role"
                  modalProps={{
                    animationType: 'slide',
                    presentationStyle: 'fullScreen',
                  }}
                  searchable
                  searchPlaceholder="Search roles…"
                  zIndex={3000}
                  zIndexInverse={1000}
                  containerStyle={{ marginBottom: 12 }}
                  style={[styles.dropdown, styles.focusless]}
                  dropDownContainerStyle={{ borderColor: COLORS.border, borderWidth: 1, borderRadius: 12 }}
                />
              </View>

              <TextInput
                style={[styles.input, styles.focusless]}
                placeholder="Job Description"
                placeholderTextColor={COLORS.textSecondary}
                value={formData.description}
                onChangeText={(text) => setFormData({ ...formData, description: text })}
                multiline
              />

              <Text style={styles.label}>City</Text>
              <TouchableOpacity
                style={[styles.input, styles.focusless]}
                onPress={openCityOverlayInJobForm}
                activeOpacity={0.85}
              >
                <Text style={{ color: formData.city ? COLORS.textPrimary : COLORS.textSecondary }}>
                  {formData.city?.label || 'Search for your city'}
                </Text>
              </TouchableOpacity>

              {/* Free/Paid */}
              <View style={styles.toggleRow}>
                {['Free', 'Paid'].map((t) => (
                  <TouchableOpacity
                    key={t}
                    style={[styles.toggleButton, styles.focusless, formData.type === t && styles.activeToggle]}
                    onPress={() => setFormData({ ...formData, type: t })}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.toggleText}>{t}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {formData.type === 'Paid' && (
                <>
                  <TextInput
                    style={[styles.input, styles.focusless]}
                    placeholder="Currency (e.g. £,$)"
                    placeholderTextColor={COLORS.textSecondary}
                    value={formData.currency}
                    onChangeText={(c) => setFormData({ ...formData, currency: c })}
                  />
                  <TextInput
                    style={[styles.input, styles.focusless]}
                    placeholder="Rate (Flat Rate, Per Day)"
                    placeholderTextColor={COLORS.textSecondary}
                    value={formData.rate}
                    onChangeText={(r) => setFormData({ ...formData, rate: r })}
                  />
                  <TextInput
                    style={[styles.input, styles.focusless]}
                    placeholder="Amount"
                    placeholderTextColor={COLORS.textSecondary}
                    keyboardType="numeric"
                    value={formData.amount}
                    onChangeText={(a) => setFormData({ ...formData, amount: a })}
                  />
                </>
              )}

              <TextInput
                style={[styles.input, styles.focusless]}
                placeholder="Time (e.g. 3-day shoot)"
                placeholderTextColor={COLORS.textSecondary}
                value={formData.time}
                onChangeText={(t) => setFormData({ ...formData, time: t })}
              />
            </ScrollView>

            {/* INLINE City Search Overlay inside Post Job Modal */}
            {jobCityOverlayVisible && (
              <View style={styles.inlineOverlay}>
                <View style={styles.inlineSheet}>
                  <Text style={styles.modalTitle}>Search for your city</Text>
                  <TextInput
                    placeholder="Start typing..."
                    placeholderTextColor="#aaa"
                    value={citySearchTerm}
                    onChangeText={(text) => {
                      setCitySearchTerm(text);
                      fetchCities(text);
                    }}
                    style={[styles.searchInput, styles.focusless]}
                    autoFocus
                  />
                  {searchingCities ? (
                    <ActivityIndicator style={{ marginTop: 20 }} />
                  ) : (
                    <FlatList
                      data={cityItems}
                      keyExtractor={(item) => String(item.value)}
                      keyboardShouldPersistTaps="handled"
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          style={[styles.cityItem, styles.focusless]}
                          onPress={() => {
                            setFormData({ ...formData, city: item });
                            setJobCityOverlayVisible(false);
                          }}
                        >
                          <Text style={styles.cityText}>{item.label}</Text>
                        </TouchableOpacity>
                      )}
                      style={{ maxHeight: '70%' }}
                    />
                  )}
                  <TouchableOpacity
                    onPress={() => setJobCityOverlayVisible(false)}
                    style={[styles.closeModalButton, styles.focusless]}
                    activeOpacity={0.9}
                  >
                    <Text style={styles.closeModalText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Sticky footer */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                style={[styles.footerBtn, styles.footerGhost, styles.focusless]}
                onPress={() => setJobFormVisible(false)}
                activeOpacity={0.9}
              >
                <Text style={styles.footerGhostText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.footerBtn, styles.footerPrimary, styles.focusless]}
                onPress={handlePostJob}
                activeOpacity={0.9}
              >
                <Text style={styles.footerPrimaryText}>Submit Job</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* (Kept) Full-screen City Search Modal — not used by Post Job anymore */}
      <Modal
        visible={citySearchModalVisible}
        animationType="slide"
        onRequestClose={() => setCitySearchModalVisible(false)}
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
            style={[styles.searchInput, styles.focusless]}
            autoFocus
          />
          {searchingCities ? (
            <ActivityIndicator style={{ marginTop: 20 }} />
          ) : (
            <FlatList
              data={cityItems}
              keyExtractor={(item) => String(item.value)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.cityItem, styles.focusless]}
                  onPress={() => {
                    setFormData({ ...formData, city: item });
                    setCitySearchModalVisible(false);
                  }}
                >
                  <Text style={styles.cityText}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          )}
          <TouchableOpacity
            onPress={() => setCitySearchModalVisible(false)}
            style={[styles.closeModalButton, styles.focusless]}
            activeOpacity={0.9}
          >
            <Text style={styles.closeModalText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* City Filter Modal */}
      <Modal
        visible={cityFilterModalVisible}
        animationType="slide"
        onRequestClose={() => setCityFilterModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Filter by city</Text>
          <TextInput
            style={[styles.searchInput, styles.focusless]}
            placeholder="Type at least 2 letters..."
            placeholderTextColor={COLORS.textSecondary}
            value={cityFilterSearchTerm}
            autoFocus
            onChangeText={(t) => {
              setCityFilterSearchTerm(t);
              fetchFilterCities(t);
            }}
          />
          {searchingFilterCities ? (
            <ActivityIndicator style={{ marginTop: 20 }} />
          ) : (
            <FlatList
              data={cityFilterItems}
              keyExtractor={(item) => String(item.value)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.cityItem, styles.focusless]}
                  onPress={() => {
                    setFilterCity(item);
                    setCityFilterModalVisible(false);
                  }}
                >
                  <Text style={styles.cityText}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          )}
          <TouchableOpacity
            onPress={() => setCityFilterModalVisible(false)}
            style={[styles.closeModalButton, styles.focusless]}
            activeOpacity={0.9}
          >
            <Text style={styles.closeModalText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Role Filter Modal */}
      <Modal
        visible={roleFilterModalVisible}
        animationType="slide"
        onRequestClose={() => setRoleFilterModalVisible(false)}
      >
        <View style={styles.modalContainer}>
          <Text style={styles.modalTitle}>Filter by role</Text>
          <TextInput
            style={[styles.searchInput, styles.focusless]}
            placeholder="Start typing a role…"
            placeholderTextColor={COLORS.textSecondary}
            value={roleFilterSearchTerm}
            autoFocus
            onChangeText={(t) => {
              setRoleFilterSearchTerm(t);
              fetchFilterRoles(t);
            }}
          />
          {searchingFilterRoles ? (
            <ActivityIndicator style={{ marginTop: 20 }} />
          ) : (
            <FlatList
              data={roleFilterItems}
              keyExtractor={(item) => String(item.value)}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.cityItem, styles.focusless]}
                  onPress={() => {
                    setFilterRole(item);
                    setRoleFilterModalVisible(false);
                  }}
                >
                  <Text style={styles.cityText}>{item.label}</Text>
                </TouchableOpacity>
              )}
            />
          )}
          <TouchableOpacity
            onPress={() => setRoleFilterModalVisible(false)}
            style={[styles.closeModalButton, styles.focusless]}
            activeOpacity={0.9}
          >
            <Text style={styles.closeModalText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      {/* Job Detail / Apply */}
      <Modal visible={!!selectedJob} animationType="slide" onRequestClose={() => setSelectedJob(null)}>
        <View style={styles.modalContainer}>
          {selectedJob && (
            <>
              <Text style={styles.jobTitle}>{decode(selectedJob.creative_roles?.name || 'Job')}</Text>
              {selectedJob.description ? (
                <Text style={styles.jobDescription}>{decode(selectedJob.description)}</Text>
              ) : null}
              <Text style={styles.jobMeta}>
                📍 {selectedJob.cities?.name} • 👤{' '}
                <Text style={styles.userLink} onPress={() => goToProfile(selectedJob.users)}>
                  {selectedJob.users?.full_name || 'View Profile'}
                </Text>
              </Text>
              <Text style={{ marginTop: 12, fontWeight: '600', color: COLORS.textPrimary }}>
                {selectedJob.type === 'Paid'
                  ? `💰 ${selectedJob.currency ?? ''}${selectedJob.amount ?? ''}${
                      selectedJob.rate ? ` / ${selectedJob.rate}` : ''
                    }`
                  : 'Free / Collab'}
              </Text>
              {selectedJob.time ? (
                <Text style={{ marginTop: 8, fontWeight: '500', color: COLORS.textSecondary }}>
                  🕒 Time: {selectedJob.time}
                </Text>
              ) : null}
              {/* Posted time in modal */}
              {selectedJob.created_at ? (
                <Text style={{ marginTop: 8, fontWeight: '500', color: COLORS.textSecondary }}>
                  ⏱️ Posted {formatTimeAgo(selectedJob.created_at)}
                </Text>
              ) : null}

              <TouchableOpacity
                style={[styles.submitButton, styles.focusless]}
                onPress={handleApply}
                disabled={applyLoading}
                activeOpacity={0.9}
              >
                {applyLoading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>Apply</Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setSelectedJob(null)} style={{ marginTop: 12 }}>
                <Text style={styles.cancelText}>Close</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // Remove blue focus rings on web
  focusless: {
    outlineWidth: 0,
    outlineColor: 'transparent',
  },

  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 16,
    paddingTop: 50,
  },
  tabRow: {
    flexDirection: 'row',
    marginBottom: 12,
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.card,
  },
  tabButton: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
  },
  activeTab: {
    backgroundColor: COLORS.primary,
  },
  tabText: {
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  activeTabText: {
    color: COLORS.textOnPrimary,
    fontWeight: '600',
  },

  // Filters
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 8,
  },
  filterInput: {
    flex: 1,
    backgroundColor: COLORS.card,
    borderRadius: 10,
    padding: 12,
    borderColor: COLORS.border,
    borderWidth: 1,
  },
  clearBtn: {
    alignSelf: 'flex-end',
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: COLORS.mutedCard,
  },
  clearBtnText: {
    color: COLORS.textPrimary,
    fontWeight: '600',
  },

  jobCard: {
    backgroundColor: COLORS.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.08,
    shadowRadius: 5,
    elevation: 3,
  },
  jobTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.textPrimary,
  },
  jobDescription: {
    fontSize: 14,
    color: COLORS.textSecondary,
    marginVertical: 8,
  },
  jobMeta: {
    fontSize: 13,
    color: COLORS.textSecondary,
  },
  userLink: {
    color: COLORS.primary,
    textDecorationLine: 'underline',
    fontWeight: '600',
  },
  postButton: {
    position: 'absolute',
    bottom: 40,
    left: 16,
    right: 16,
    backgroundColor: COLORS.primary,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.1,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 4,
  },
  postButtonText: {
    color: COLORS.textOnPrimary,
    fontWeight: '600',
    fontSize: 16,
  },

  // Modal base
  modalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 60 : 40,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 16,
    color: COLORS.textPrimary,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 6,
    color: COLORS.textPrimary,
  },
  input: {
    backgroundColor: COLORS.card,
    padding: 12,
    borderRadius: 10,
    marginBottom: 12,
    borderColor: COLORS.border,
    borderWidth: 1,
    color: COLORS.textPrimary,
  },

  // DropDownPicker control styling (match inputs)
  dropdown: {
    backgroundColor: COLORS.card,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 10,
  },

  // Matches LocationScreen search input spacing/shape
  searchInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.card,
    marginBottom: 8,
  },

  toggleRow: {
    flexDirection: 'row',
    marginBottom: 16,
  },
  toggleButton: {
    flex: 1,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  activeToggle: {
    backgroundColor: COLORS.primary,
  },
  toggleText: {
    color: COLORS.textPrimary,
    fontWeight: '500',
  },
  submitButton: {
    backgroundColor: COLORS.primary,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitText: {
    color: COLORS.textOnPrimary,
    fontWeight: '600',
    fontSize: 16,
  },
  cancelText: {
    color: COLORS.primary,
    textAlign: 'center',
    fontWeight: '500',
  },
  cityItem: {
    paddingVertical: 12,
    borderBottomColor: COLORS.border,
    borderBottomWidth: 1,
  },
  cityText: {
    fontSize: 16,
    color: COLORS.textPrimary,
  },

  // Sticky footer
  modalFooter: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    padding: 16,
    paddingBottom: Platform.OS === 'ios' ? 28 : 16,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    flexDirection: 'row',
    gap: 10,
  },
  footerBtn: {
    flex: 1,
    padding: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  footerGhost: {
    backgroundColor: COLORS.card,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  footerGhostText: {
    color: COLORS.primary,
    fontWeight: '700',
  },
  footerPrimary: {
    backgroundColor: COLORS.primary,
  },
  footerPrimaryText: {
    color: COLORS.textOnPrimary,
    fontWeight: '700',
  },

  // Inline overlay (now used!)
  inlineOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.25)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  inlineSheet: {
    backgroundColor: COLORS.background,
    padding: 20,
    paddingTop: Platform.OS === 'ios' ? 24 : 20,
    borderRadius: 16,
    width: '100%',
    maxWidth: 640,
    maxHeight: '75%',
    shadowColor: COLORS.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
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
});
