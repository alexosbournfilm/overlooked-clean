// ProfileScreen.tsx (About title centered + bio limit + public hides count) — UPDATED with role search modal
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  useWindowDimensions,
  Modal,
  TextInput,
  Platform,
  KeyboardAvoidingView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import DropDownPicker from 'react-native-dropdown-picker';
import YoutubePlayer from 'react-native-youtube-iframe';
import { useRoute, useNavigation, useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { COLORS } from '../theme/colors';

interface ProfileData {
  id: string;
  full_name: string;
  avatar_url: string;
  portfolio_url?: string;
  main_role_id?: number;
  side_roles?: string[];
  city_id?: number;
  country_code?: string;
  bio?: string | null;
}

interface MyJob {
  id: string;
  description: string | null;
  type: string | null;        // 'Paid' | 'Free'
  currency: string | null;
  amount: string | number | null;
  rate: string | null;
  time: string | null;
  created_at: string;
  role?: { name?: string };
  city?: { name?: string; city?: string; country_code?: string };
  applicants: {
    id: string;
    applied_at: string;
    user: { id: string; full_name?: string; avatar_url?: string } | null;
  }[];
  is_closed?: boolean;
  closed_at?: string | null;
}

const MAX_WIDTH = 720;
const BIO_WORD_LIMIT = 100;

/** Simple avatar that shows a blank circle when uri is missing */
const Avatar = ({ uri, size }: { uri?: string | null; size: number }) => {
  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2 }} />;
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: '#F2F2F2',
        borderWidth: 1,
        borderColor: '#EAEAEA',
      }}
    />
  );
};

export default function ProfileScreen() {
  const route = useRoute<any>();
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const viewedUserFromObj = route.params?.user;
  const viewedUserId: string | undefined =
    route.params?.userId ?? viewedUserFromObj?.id ?? undefined;

  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [mainRoleName, setMainRoleName] = useState('');
  const [cityName, setCityName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isOwnProfile, setIsOwnProfile] = useState(false);

  const [myJobs, setMyJobs] = useState<MyJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState<boolean>(false);

  const [showEditModal, setShowEditModal] = useState(false);
  const [fullName, setFullName] = useState('');
  const [mainRole, setMainRole] = useState<number | null>(null);
  const [sideRoles, setSideRoles] = useState<string[]>([]);
  const [cityId, setCityId] = useState<number | null>(null);
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [image, setImage] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [bio, setBio] = useState<string>('');

  // (Kept) legacy dropdown-related state (unused now, safe to leave)
  const [roleOpen, setRoleOpen] = useState(false);
  const [roleItems, setRoleItems] = useState<any[]>([]);

  // City modal/search
  const [cityOpen, setCityOpen] = useState(false);
  const [cityItems, setCityItems] = useState<any[]>([]);
  const [citySearch, setCitySearch] = useState('');

  // NEW: Role search modal (matches Jobs filter UX)
  const [roleSearchModalVisible, setRoleSearchModalVisible] = useState(false);
  const [roleSearchTerm, setRoleSearchTerm] = useState('');
  const [roleSearchItems, setRoleSearchItems] = useState<{ label: string; value: number }[]>([]);
  const [searchingRoles, setSearchingRoles] = useState(false);

  const [startingChat, setStartingChat] = useState(false);
  const [closingJobId, setClosingJobId] = useState<string | null>(null);

  useEffect(() => {
    fetchCreativeRoles(); // still used to resolve names and keep parity
  }, []);

  useEffect(() => {
    fetchProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewedUserId]);

  useFocusEffect(
    useCallback(() => {
      fetchProfile();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [viewedUserId])
  );

  const fetchProfile = async () => {
    setIsLoading(true);

    const {
      data: { user: authUser },
      error: authErr,
    } = await supabase.auth.getUser();

    if (authErr || !authUser) {
      Alert.alert('Error', 'Unable to determine current user.');
      setIsLoading(false);
      return;
    }

    const targetId = viewedUserId ?? authUser.id;
    const own = targetId === authUser.id;
    setIsOwnProfile(own);

    const { data, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', targetId)
      .maybeSingle();

    if (userError || !data) {
      Alert.alert('Error loading profile');
      setIsLoading(false);
      return;
    }

    setProfile(data);
    setFullName(data.full_name);
    setMainRole(data.main_role_id ?? null);
    setSideRoles(data.side_roles ?? []);
    setCityId(data.city_id ?? null);
    setPortfolioUrl(data.portfolio_url ?? '');
    setImage(data.avatar_url ?? null);
    setBio(data.bio ?? '');

    if (data.main_role_id) {
      const { data: roleData } = await supabase
        .from('creative_roles')
        .select('name')
        .eq('id', data.main_role_id)
        .maybeSingle<{ name: string }>();
      setMainRoleName(roleData?.name ?? '');
    } else setMainRoleName('');

    if (data.city_id) {
      const { data: cityData } = await supabase
        .from('cities')
        .select('name, country_code')
        .eq('id', data.city_id)
        .maybeSingle<{ name?: string; city?: string; country_code?: string }>();
      const label = cityData?.name ?? cityData?.city;
      setCityName(label && cityData?.country_code ? `${label}, ${cityData.country_code}` : label ?? '');
    } else setCityName('');

    setIsLoading(false);

    if (own) {
      fetchMyJobsWithApplicants(authUser.id).catch((e) =>
        console.error('Failed loading jobs/applicants:', e)
      );
    } else {
      setMyJobs([]);
    }
  };

  const fetchMyJobsWithApplicants = async (ownerId: string) => {
    setLoadingJobs(true);

    const { data: jobsData, error: jobsErr } = await supabase
      .from('jobs')
      .select(
        `id, description, type, currency, amount, rate, time, created_at, is_closed, closed_at,
         creative_roles(name),
         cities(name, country_code)`
      )
      .eq('user_id', ownerId)
      .eq('is_closed', false)
      .order('created_at', { ascending: false });

    if (jobsErr) {
      console.error(jobsErr);
      setLoadingJobs(false);
      return;
    }

    const results: MyJob[] = [];
    for (const j of jobsData || []) {
      const { data: apps, error: appsErr } = await supabase
        .from('applications')
        .select(`id, applicant_id, applied_at, users(id, full_name, avatar_url)`)
        .eq('job_id', j.id)
        .order('applied_at', { ascending: false });

      if (appsErr) console.error(appsErr);

      const applicants =
        (apps || []).map((a: any) => ({
          id: a.id,
          applied_at: a.applied_at,
          user: a.users
            ? { id: a.users.id, full_name: a.users.full_name, avatar_url: a.users.avatar_url }
            : null,
        })) ?? [];

      const roleJoin = (j as any).creative_roles;
      const cityJoin = (j as any).cities;

      const roleName =
        Array.isArray(roleJoin) ? roleJoin[0]?.name : roleJoin?.name;

      const cityObj =
        Array.isArray(cityJoin) ? cityJoin[0] : cityJoin;

      results.push({
        id: j.id,
        description: (j as any).description ?? null,
        type: (j as any).type ?? null,
        currency: (j as any).currency ?? null,
        amount: (j as any).amount ?? null,
        rate: (j as any).rate ?? null,
        time: (j as any).time ?? null,
        created_at: (j as any).created_at,
        is_closed: (j as any).is_closed,
        closed_at: (j as any).closed_at ?? null,
        role: { name: roleName },
        city: { name: cityObj?.name, country_code: cityObj?.country_code },
        applicants,
      });
    }

    setMyJobs(results);
    setLoadingJobs(false);
  };

  const fetchCreativeRoles = async () => {
    const { data } = await supabase.from('creative_roles').select();
    if (data) {
      const items = data.map((role) => ({ label: role.name, value: role.id }));
      setRoleItems(items);
    }
  };

  const fetchCities = async (query: string) => {
    const { data } = await supabase
      .from('cities')
      .select('id, name, country_code')
      .ilike('name', `%${query}%`)
      .limit(30);

    if (data) {
      const formatted = data.map((c) => ({
        label: `${c.name}, ${c.country_code}`,
        value: c.id,
        country_code: c.country_code,
        name: c.name,
      }));
      setCityItems(formatted);
    }
  };

  // --- NEW: role search like Jobs filter ---
  const fetchSearchRoles = useCallback(async (search: string) => {
    if (!search || search.length < 1) {
      setRoleSearchItems([]);
      return;
    }
    setSearchingRoles(true);
    const { data, error } = await supabase
      .from('creative_roles')
      .select('id, name')
      .ilike('name', `%${search}%`)
      .order('name')
      .limit(50);
    setSearchingRoles(false);

    if (error) {
      console.error(error);
      setRoleSearchItems([]);
      return;
    }
    setRoleSearchItems(
      (data || []).map((r) => ({ value: r.id, label: r.name }))
    );
  }, []);

  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please allow media access to change your picture.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    });

    if (!result.canceled && result.assets && result.assets.length > 0) {
      const asset = result.assets[0];
      const fileName = `${Date.now()}.jpg`;
      const fileUri = asset.uri;

      try {
        const response = await fetch(fileUri);
        const blob = await response.blob();

        const { data, error } = await supabase.storage
          .from('avatars')
          .upload(fileName, blob, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (error) {
          Alert.alert('Upload failed', error.message);
          return;
        }

        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(data.path);
        setImage(urlData.publicUrl);
      } catch (err) {
        console.error('Image upload error:', err);
        Alert.alert('Upload failed', 'An unexpected error occurred.');
      }
    }
  };

  const saveProfile = async () => {
    if (!fullName || !mainRole || !cityId) {
      Alert.alert('Missing fields', 'Please complete all required fields.');
      return;
    }

    setUploading(true);

    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    const userId = authUser?.id;

    if (!userId) {
      Alert.alert('Error', 'Not authenticated');
      setUploading(false);
      return;
    }

    const trimmedBio = trimToWordLimit(bio, BIO_WORD_LIMIT);

    const { error } = await supabase
      .from('users')
      .update({
        full_name: fullName,
        avatar_url: image, // stays null if user didn't choose one
        main_role_id: mainRole,
        side_roles: sideRoles,
        city_id: cityId,
        portfolio_url: portfolioUrl,
        bio: trimmedBio,
      })
      .eq('id', userId);

    setUploading(false);

    if (error) {
      Alert.alert('Update failed', error.message);
    } else {
      setShowEditModal(false);
      fetchProfile();
    }
  };

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      Alert.alert('Logout Failed', error.message);
      return;
    }
    navigation.reset({ index: 0, routes: [{ name: 'Auth' }] });
  };

  const startOneToOneChat = async () => {
    if (!profile) return;
    try {
      setStartingChat(true);

      const {
        data: { user: me },
        error: meErr,
      } = await supabase.auth.getUser();
      if (meErr || !me) throw new Error('Not authenticated.');

      const { data: candidates, error: findErr } = await supabase
        .from('conversations')
        .select('id, participant_ids, is_group')
        .eq('is_group', false)
        .contains('participant_ids', [me.id, profile.id]);

      if (findErr) throw findErr;

      let conversationId: string | undefined = candidates?.find(
        (c: any) =>
          Array.isArray(c.participant_ids) &&
          c.participant_ids.length === 2 &&
          c.participant_ids.includes(me.id) &&
          c.participant_ids.includes(profile.id)
      )?.id;

      if (!conversationId) {
        const { data: created, error: createErr } = await supabase
          .from('conversations')
          .insert({
            is_group: false,
            is_city_group: false,
            participant_ids: [me.id, profile.id],
            label: null,
            last_message_content: null,
            last_message_sent_at: null,
          })
          .select('id')
          .single();

        if (createErr) throw createErr;
        conversationId = created.id;
      }

      navigation.navigate('Chats', {
        screen: 'ChatRoom',
        params: {
          conversationId,
          peerUser: {
            id: profile.id,
            full_name: profile.full_name,
            avatar_url: profile.avatar_url,
          },
        },
      });
    } catch (e: any) {
      Alert.alert('Could not start chat', e?.message ?? 'Unexpected error.');
    } finally {
      setStartingChat(false);
    }
  };

  const goToUserProfile = (user?: { id: string; full_name?: string; avatar_url?: string | null }) => {
    if (!user?.id) return;
    // @ts-ignore
    navigation.navigate('Profile', { user });
  };

  const toFlag = (cc?: string) => {
    if (!cc) return '🏳️';
    const code = cc.trim().toUpperCase();
    return [...code].map(c => String.fromCodePoint(127397 + c.charCodeAt(0))).join('');
  };

  const closeJob = async (jobId: string) => {
    try {
      setClosingJobId(jobId);
      const { error } = await supabase
        .from('jobs')
        .update({ is_closed: true, closed_at: new Date().toISOString() })
        .eq('id', jobId);
      if (error) throw error;

      setMyJobs((prev) => prev.filter((j) => j.id !== jobId));
    } catch (err: any) {
      Alert.alert('Error', err.message ?? 'Failed to close job.');
    } finally {
      setClosingJobId(null);
    }
  };

  const renderPortfolioCard = () => {
    if (!profile?.portfolio_url) return null;

    let videoId: string | undefined;
    try {
      const url = new URL(profile.portfolio_url);
      if (url.hostname.includes('youtu.be')) videoId = url.pathname.replace('/', '');
      else videoId = url.searchParams.get('v') ?? undefined;
    } catch {
      videoId = profile.portfolio_url.split('v=')[1]?.split('&')[0];
    }
    if (!videoId) return null;

    return (
      <View style={styles.cardWrapper}>
        <View style={styles.card}>
          <View style={styles.cardHeaderRow}>
            <Text style={styles.cardTitle}>Portfolio</Text>
            <Text style={styles.cardSubtle}>by {profile.full_name}</Text>
          </View>

          <View style={styles.videoWrapper}>
            <YoutubePlayer
              height={isMobile ? 180 : 360}
              width={isMobile ? 320 : 640}
              videoId={videoId}
              webViewStyle={{ borderRadius: 16 }}
              webViewProps={{
                allowsInlineMediaPlayback: true,
                mediaPlaybackRequiresUserAction: false,
              }}
            />
          </View>
        </View>
      </View>
    );
  };

  const renderAboutCard = () => {
    if (!profile?.bio) return null;
    return (
      <View style={styles.cardWrapper}>
        <View style={styles.card}>
          {/* Centered header */}
          <View style={styles.cardHeaderCentered}>
            <Text style={[styles.cardTitle, styles.cardTitleCentered]}>About</Text>
            {/* Removed word counter from public view */}
          </View>
          <Text style={styles.aboutText}>{profile.bio}</Text>
        </View>
      </View>
    );
  };

  const renderMyJobsSection = () => {
    if (!isOwnProfile) return null;

    return (
      <View style={styles.jobsSection}>
        <Text style={styles.sectionTitle}>My Jobs & Applications</Text>

        {loadingJobs ? (
          <ActivityIndicator size="large" color={COLORS.primary} style={{ marginTop: 16 }} />
        ) : myJobs.length === 0 ? (
          <Text style={styles.emptyText}>You haven’t posted any jobs yet.</Text>
        ) : (
          myJobs.map((job) => (
            <View key={job.id} style={styles.jobCard}>
              <View style={styles.jobHeaderRow}>
                <Text style={styles.jobHeaderText}>
                  {job.role?.name ?? 'Job'}
                </Text>
                <View style={[styles.badge, job.type === 'Paid' ? styles.badgePaid : styles.badgeFree]}>
                  <Text style={styles.badgeText}>
                    {job.type === 'Paid'
                      ? `${job.currency ?? ''}${job.amount ?? ''}${job.rate ? ` / ${job.rate}` : ''}`
                      : 'Free / Collab'}
                  </Text>
                </View>
              </View>

              {!!(job.city?.name || job.city?.city) && (
                <Text style={styles.jobSubtle}>
                  📍 {(job.city?.name || job.city?.city) as string}
                  {job.city?.country_code ? `, ${job.city.country_code}` : ''}
                </Text>
              )}
              {job.time ? <Text style={styles.jobSubtle}>🕒 {job.time}</Text> : null}
              {job.description ? (
                <Text style={styles.jobBody}>{job.description}</Text>
              ) : null}

              <View style={styles.jobActionsRow}>
                <TouchableOpacity
                  style={[styles.closeJobButton, styles.webNoOutline]}
                  onPress={() => closeJob(job.id)}
                  disabled={closingJobId === job.id}
                  activeOpacity={0.85}
                >
                  {closingJobId === job.id ? (
                    <ActivityIndicator color="#fff" />
                  ) : (
                    <Text style={styles.closeJobButtonText}>Close Job</Text>
                  )}
                </TouchableOpacity>
              </View>

              <View style={styles.applicantsBlock}>
                <Text style={styles.applicantsTitle}>Applicants</Text>
                {job.applicants.length === 0 ? (
                  <Text style={styles.emptyApplicants}>No applications yet.</Text>
                ) : (
                  job.applicants.map((a) => (
                    <TouchableOpacity
                      key={a.id}
                      style={[styles.applicantRow, styles.webNoOutline]}
                      onPress={() => a.user && goToUserProfile(a.user)}
                      activeOpacity={0.8}
                    >
                      {/* Avatar: blank circle when missing */}
                      <Avatar uri={a.user?.avatar_url ?? null} size={36} />
                      <View style={{ flex: 1, marginLeft: 10 }}>
                        <Text style={styles.applicantName}>{a.user?.full_name || 'View Profile'}</Text>
                        <Text style={styles.applicantMeta}>
                          Applied {new Date(a.applied_at).toLocaleDateString()}
                        </Text>
                      </View>
                      <Text style={styles.viewProfileLink}>View</Text>
                    </TouchableOpacity>
                  ))
                )}
              </View>
            </View>
          ))
        )}
      </View>
    );
  };

  if (isLoading) {
    return (
      <View style={[styles.container, { justifyContent: 'center' }]}>
        <ActivityIndicator size="large" color={COLORS.primary} />
      </View>
    );
  }

  if (!profile) {
    return (
      <View style={styles.container}>
        <Text style={styles.errorText}>Profile not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {/* Profile Header Card */}
      <View style={styles.headerCard}>
        <View style={styles.heroTopAccent} />
        <View style={styles.avatarRing}>
          {/* Avatar: blank circle when missing */}
          <Avatar uri={profile.avatar_url ?? null} size={112} />
        </View>

        <Text style={styles.name}>{profile.full_name}</Text>

        <View style={styles.badgeRow}>
          {!!mainRoleName && (
            <View style={[styles.softBadge, styles.emBadge]}>
              <Text style={styles.softBadgeText}>{mainRoleName}</Text>
            </View>
          )}
          {!!cityName && (
            <View style={styles.softBadge}>
              <Text style={styles.softBadgeText}>{cityName}</Text>
            </View>
          )}
        </View>

        {Array.isArray(profile.side_roles) && profile.side_roles.length > 0 && (
          <View style={styles.chipsWrap}>
            {profile.side_roles.map((r, idx) => (
              <View style={styles.chip} key={`${r}-${idx}`}>
                <Text style={styles.chipText}>{r}</Text>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* About */}
      {renderAboutCard()}

      {/* Portfolio */}
      {profile.portfolio_url ? renderPortfolioCard() : (
        <View style={[styles.cardWrapper, { marginTop: 18 }]}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Portfolio</Text>
            <Text style={styles.cardSubtle}>No portfolio uploaded.</Text>
          </View>
        </View>
      )}

      {/* Action Buttons */}
      {isOwnProfile ? (
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.buttonPrimary, styles.webNoOutline]}
            onPress={() => setShowEditModal(true)}
            activeOpacity={0.9}
          >
            <Text style={styles.buttonText}>Edit Profile</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, styles.buttonGhost, styles.webNoOutline]}
            onPress={handleLogout}
            activeOpacity={0.9}
          >
            <Text style={[styles.buttonText, styles.buttonGhostText]}>Log Out</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.buttonPrimary, styles.webNoOutline]}
            onPress={startOneToOneChat}
            disabled={startingChat}
            activeOpacity={0.9}
          >
            {startingChat ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Message</Text>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Jobs & Applications */}
      {renderMyJobsSection()}

      {/* Edit Modal */}
      <Modal visible={showEditModal} animationType="slide" transparent>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={styles.modalOverlay}
        >
          <View style={styles.modalContainer}>
            <View style={styles.modalHandle} />
            <ScrollView contentContainerStyle={{ paddingBottom: 20 }}>
              <Text style={styles.modalTitle}>Edit Profile</Text>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Full Name</Text>
                <TextInput
                  placeholder="Full Name"
                  value={fullName}
                  onChangeText={setFullName}
                  style={[styles.input, styles.webNoOutline]}
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>

              {/* Main Role — replaced with searchable modal (like Jobs filter) */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Main Role</Text>
                <TouchableOpacity
                  onPress={() => {
                    setRoleSearchTerm('');
                    setRoleSearchItems([]);
                    setRoleSearchModalVisible(true);
                  }}
                  style={[styles.cityButton, styles.webNoOutline]}
                  activeOpacity={0.9}
                >
                  <Text style={styles.cityButtonText}>
                    {mainRoleName ? mainRoleName : 'Search role'}
                  </Text>
                  <Text style={styles.cityButtonFlag}>🔎</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Side Roles</Text>
                <TextInput
                  placeholder="Side Roles (comma separated)"
                  value={sideRoles.join(', ')}
                  onChangeText={(text) => setSideRoles(text.split(',').map((s) => s.trim()))}
                  style={[styles.input, styles.webNoOutline]}
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>

              {/* City selector */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>City</Text>
                <TouchableOpacity
                  onPress={() => {
                    setCityOpen(true);
                    fetchCities(citySearch || '');
                  }}
                  style={[styles.cityButton, styles.webNoOutline]}
                  activeOpacity={0.9}
                >
                  <Text style={styles.cityButtonText}>
                    {cityName ? `${cityName.split(',')[0]}` : 'Search City'}
                  </Text>
                  <Text style={styles.cityButtonFlag}>
                    {cityName ? toFlag(cityName.split(', ')[1]) : '🔎'}
                  </Text>
                </TouchableOpacity>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>YouTube Portfolio URL</Text>
                <TextInput
                  placeholder="https://youtube.com/..."
                  value={portfolioUrl}
                  onChangeText={setPortfolioUrl}
                  style={[styles.input, styles.webNoOutline]}
                  autoCapitalize="none"
                  keyboardType="url"
                  placeholderTextColor={COLORS.textSecondary}
                />
              </View>

              {/* About / Bio */}
              <View style={styles.field}>
                <Text style={styles.fieldLabel}>About (skills, languages, etc.)</Text>
                <TextInput
                  placeholder="A brief paragraph about you..."
                  value={bio}
                  onChangeText={(t) => setBio(limitByWords(t, BIO_WORD_LIMIT))}
                  style={[styles.input, styles.webNoOutline, styles.multiline]}
                  placeholderTextColor={COLORS.textSecondary}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
                <Text style={styles.counterText}>
                  {countWords(bio)} / {BIO_WORD_LIMIT} words
                </Text>
              </View>

              <TouchableOpacity onPress={pickImage} style={[styles.imageButton, styles.webNoOutline]} activeOpacity={0.9}>
                <Text style={styles.imageButtonText}>
                  {uploading ? 'Uploading...' : image ? 'Change Profile Picture' : 'Upload Picture'}
                </Text>
              </TouchableOpacity>

              {image && (
                <View style={{ alignItems: 'center', marginBottom: 8 }}>
                  <Image source={{ uri: image }} style={styles.avatarSmall} />
                </View>
              )}

              <TouchableOpacity
                onPress={saveProfile}
                style={[styles.button, styles.buttonPrimary, styles.webNoOutline, { marginTop: 6 }]}
                activeOpacity={0.9}
              >
                <Text style={styles.buttonText}>Save Changes</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setShowEditModal(false)}
                style={[styles.button, styles.buttonGhost, styles.webNoOutline, { marginTop: 10 }]}
                activeOpacity={0.9}
              >
                <Text style={[styles.buttonText, styles.buttonGhostText]}>Cancel</Text>
              </TouchableOpacity>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>

        {/* City modal */}
        <Modal visible={cityOpen} transparent animationType="fade">
          <View style={styles.cityModalOverlay}>
            <View style={styles.cityModal}>
              <View style={styles.modalHandle} />
              <Text style={[styles.modalTitle, { marginBottom: 8 }]}>Select City</Text>
              <TextInput
                placeholder="Type a city..."
                value={citySearch}
                onChangeText={(t) => {
                  setCitySearch(t);
                  fetchCities(t);
                }}
                style={[styles.input, styles.webNoOutline, { marginBottom: 10 }]}
                placeholderTextColor={COLORS.textSecondary}
                autoFocus
              />
              <ScrollView style={{ maxHeight: 360 }}>
                {cityItems.length === 0 ? (
                  <Text style={styles.emptyText}>No matches.</Text>
                ) : (
                  cityItems.map((c: any) => (
                    <TouchableOpacity
                      key={c.value}
                      style={[styles.cityRow, styles.webNoOutline]}
                      onPress={() => {
                        setCityId(c.value);
                        setCityName(`${c.name}, ${c.country_code}`);
                        setCityOpen(false);
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.cityFlag}>{toFlag(c.country_code)}</Text>
                      <Text style={styles.cityLabel}>{c.name}</Text>
                      <Text style={styles.cityCountry}>{c.country_code}</Text>
                    </TouchableOpacity>
                  ))
                )}
              </ScrollView>

              <TouchableOpacity
                onPress={() => setCityOpen(false)}
                style={[styles.button, styles.buttonGhost, styles.webNoOutline, { marginTop: 12 }]}
                activeOpacity={0.9}
              >
                <Text style={[styles.buttonText, styles.buttonGhostText]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        {/* NEW: Role search modal (matches Jobs filter) */}
        <Modal
          visible={roleSearchModalVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setRoleSearchModalVisible(false)}
        >
          <View style={styles.cityModalOverlay}>
            <View style={styles.cityModal}>
              <View style={styles.modalHandle} />
              <Text style={[styles.modalTitle, { marginBottom: 8 }]}>Select Role</Text>
              <TextInput
                placeholder="Start typing a role…"
                placeholderTextColor={COLORS.textSecondary}
                value={roleSearchTerm}
                onChangeText={(t) => {
                  setRoleSearchTerm(t);
                  fetchSearchRoles(t);
                }}
                style={[styles.input, styles.webNoOutline, { marginBottom: 10 }]}
                autoFocus
              />
              {searchingRoles ? (
                <ActivityIndicator style={{ marginTop: 8 }} color={COLORS.primary} />
              ) : (
                <ScrollView style={{ maxHeight: 360 }}>
                  {roleSearchItems.length === 0 ? (
                    <Text style={styles.emptyText}>No matches.</Text>
                  ) : (
                    roleSearchItems.map((item) => (
                      <TouchableOpacity
                        key={item.value}
                        style={[styles.cityRow, styles.webNoOutline]}
                        onPress={() => {
                          setMainRole(item.value);
                          setMainRoleName(item.label);
                          setRoleSearchModalVisible(false);
                        }}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.cityLabel}>{item.label}</Text>
                      </TouchableOpacity>
                    ))
                  )}
                </ScrollView>
              )}

              <TouchableOpacity
                onPress={() => setRoleSearchModalVisible(false)}
                style={[styles.button, styles.buttonGhost, styles.webNoOutline, { marginTop: 12 }]}
                activeOpacity={0.9}
              >
                <Text style={[styles.buttonText, styles.buttonGhostText]}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </Modal>
    </ScrollView>
  );
}

/* ---------- helpers ---------- */
function countWords(text: string): number {
  const words = text
    ?.trim()
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean);
  return words?.length || 0;
}

function limitByWords(text: string, maxWords: number): string {
  const words = text
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (words.length <= maxWords) return text;
  return words.slice(0, maxWords).join(' ');
}

function trimToWordLimit(text: string, maxWords: number): string {
  return limitByWords(text, maxWords);
}

const styles = StyleSheet.create({
  container: {
    padding: 24,
    flexGrow: 1,
    backgroundColor: COLORS.background,
    alignItems: 'center',
  },

  /* ---------- Header Card ---------- */
  headerCard: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    backgroundColor: COLORS.card,
    borderRadius: 24,
    paddingTop: 28,
    paddingBottom: 18,
    paddingHorizontal: 18,
    alignItems: 'center',
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    borderWidth: 1,
    borderColor: COLORS.border,
    overflow: 'hidden',
  },
  heroTopAccent: {
    position: 'absolute',
    top: -60,
    width: 380,
    height: 180,
    borderRadius: 380,
    backgroundColor: '#FFF3EE',
    opacity: 0.7,
  },
  avatarRing: {
    padding: 6,
    borderRadius: 999,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#F1EAE6',
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.15,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
    marginBottom: 10,
  },
  avatar: { width: 112, height: 112, borderRadius: 56 },
  avatarSmall: { width: 84, height: 84, borderRadius: 42 },
  name: {
    fontSize: 24,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginTop: 4,
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 0.2,
  },

  /* Badges & chips */
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginBottom: 8,
  },
  softBadge: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: '#F7F4F2',
    borderWidth: 1,
    borderColor: '#EFE9E5',
  },
  emBadge: { backgroundColor: '#FFF1EC', borderColor: '#F6DAD1' },
  softBadgeText: { fontSize: 13, fontWeight: '800', color: COLORS.textPrimary },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
    marginTop: 6,
  },
  chip: {
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 10,
    backgroundColor: '#FBFBFB',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipText: { fontSize: 12, fontWeight: '700', color: COLORS.textPrimary },

  /* ---------- Cards ---------- */
  cardWrapper: {
    maxWidth: MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
    marginTop: 22,
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 20,
    padding: 16,
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  cardHeaderRow: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'baseline',
    marginBottom: 10,
  },
  // New centered header for About
  cardHeaderCentered: {
    width: '100%',
    alignItems: 'center',
    marginBottom: 10,
  },
  cardTitle: { fontSize: 18, fontWeight: '800', color: COLORS.textPrimary },
  cardTitleCentered: { textAlign: 'center' },
  cardSubtle: { fontSize: 13, color: COLORS.textSecondary },
  counterUnderTitle: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  videoWrapper: { marginTop: 6, borderRadius: 16, overflow: 'hidden' },
  aboutText: {
    fontSize: 14,
    color: COLORS.textPrimary,
    lineHeight: 21,
    width: '100%',
    textAlign: 'center',
  },

  /* ---------- Buttons ---------- */
  buttonRow: {
    width: '100%',
    maxWidth: MAX_WIDTH,
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  button: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 16,
    minWidth: 160,
    alignItems: 'center',
  },
  buttonPrimary: { backgroundColor: COLORS.primary },
  buttonGhost: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.border },
  buttonText: { color: '#fff', fontWeight: '800', letterSpacing: 0.2 },
  buttonGhostText: { color: COLORS.textPrimary, fontWeight: '800' },

  errorText: { color: COLORS.textSecondary, fontSize: 16, textAlign: 'center' },

  /* ---------- Main Modal ---------- */
  modalOverlay: {
    flex: 1,
    backgroundColor: '#00000088',
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 18,
    maxHeight: '90%',
    width: '100%',
    alignSelf: 'center',
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  modalHandle: {
    width: 44,
    height: 5,
    borderRadius: 3,
    backgroundColor: COLORS.border,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 12,
    textAlign: 'center',
  },
  field: { marginBottom: 12 },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '700',
    color: COLORS.textSecondary,
    marginBottom: 6,
    marginLeft: 4,
  },
  input: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    padding: 12,
    color: COLORS.textPrimary,
    backgroundColor: '#fff',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } : {}),
  },
  multiline: { minHeight: 96 },
  counterText: {
    marginTop: 6,
    fontSize: 12,
    color: COLORS.textSecondary,
    textAlign: 'right',
  },
  dropdown: {
    borderRadius: 14,
    borderColor: COLORS.border,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } : {}),
  },
  dropdownBox: {
    borderRadius: 14,
    borderColor: COLORS.border,
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } : {}),
  },
  imageButton: {
    backgroundColor: '#FCE6E1',
    padding: 12,
    borderRadius: 14,
    alignItems: 'center',
    marginVertical: 10,
  },
  imageButtonText: { fontWeight: '800', color: COLORS.textPrimary },

  /* ---------- City/Role Modal Button ---------- */
  cityButton: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: '#fff',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    ...(Platform.OS === 'web' ? { outlineStyle: 'none', outlineWidth: 0 } : {}),
  },
  cityButtonText: { color: COLORS.textPrimary, fontWeight: '700', fontSize: 14 },
  cityButtonFlag: { fontSize: 16 },

  /* ---------- City/Role Modal ---------- */
  cityModalOverlay: {
    flex: 1,
    backgroundColor: '#00000066',
    justifyContent: 'flex-end',
  },
  cityModal: {
    backgroundColor: COLORS.background,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 16,
    maxHeight: '85%',
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.2,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 8,
  },
  cityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  cityFlag: { fontSize: 18, marginRight: 10 },
  cityLabel: { flex: 1, fontSize: 15, color: COLORS.textPrimary, fontWeight: '700' },
  cityCountry: { fontSize: 13, color: COLORS.textSecondary },

  /* ---------- Jobs ---------- */
  jobsSection: {
    maxWidth: MAX_WIDTH,
    width: '100%',
    alignSelf: 'center',
    marginTop: 24,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: COLORS.textPrimary,
    marginBottom: 12,
    textAlign: 'left',
  },
  emptyText: { color: COLORS.textSecondary, fontSize: 14, paddingVertical: 8 },
  jobCard: {
    backgroundColor: COLORS.card,
    borderRadius: 18,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.06,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 5,
    elevation: 2,
  },
  jobHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  jobHeaderText: { fontSize: 16, fontWeight: '800', color: COLORS.textPrimary },
  jobSubtle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 4 },
  jobBody: { fontSize: 14, color: COLORS.textPrimary, marginTop: 8, lineHeight: 20 },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1 },
  badgePaid: { backgroundColor: '#FFF7F4', borderColor: COLORS.primary },
  badgeFree: { backgroundColor: '#F5F5F5', borderColor: COLORS.border },
  badgeText: { fontSize: 12, fontWeight: '800', color: COLORS.textPrimary },

  applicantsBlock: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  applicantsTitle: { fontSize: 14, fontWeight: '800', color: COLORS.textPrimary, marginBottom: 8 },
  emptyApplicants: { fontSize: 13, color: COLORS.textSecondary },
  applicantRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  applicantAvatar: { width: 36, height: 36, borderRadius: 18, marginRight: 10 },
  applicantName: { fontSize: 14, fontWeight: '800', color: COLORS.textPrimary },
  applicantMeta: { fontSize: 12, color: COLORS.textSecondary },
  viewProfileLink: { color: COLORS.primary, fontWeight: '800', marginLeft: 8 },

  jobActionsRow: { marginTop: 10, flexDirection: 'row', justifyContent: 'flex-end' },
  closeJobButton: { backgroundColor: COLORS.primary, paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10 },
  closeJobButtonText: { color: '#fff', fontWeight: '800' },

  webNoOutline: Platform.OS === 'web'
    ? ({ outlineStyle: 'none', outlineWidth: 0 } as any)
    : ({} as any),
});
