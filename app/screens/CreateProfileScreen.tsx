// screens/CreateProfileScreen.tsx
import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  FlatList,
  Image,
  useWindowDimensions,
} from 'react-native';

const Toast = Platform.OS === 'android' ? require('react-native').ToastAndroid : null;

import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import { decode } from 'base64-arraybuffer';
import { Upload } from 'tus-js-client';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CommonActions } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { navigationRef } from '../navigation/navigationRef';
import { useAuth } from '../context/AuthProvider';
import { useGamification } from '../context/GamificationContext';

// ---------------- THEME ----------------
const DARK_BG = '#000000';
const CARD = '#0A0A0A';
const CARD_ALT = '#0E0E0E';
const ELEVATED = '#111111';
const TEXT_IVORY = '#F5F2EA';
const TEXT_MUTED = '#A7A6A2';
const BORDER = 'rgba(255,255,255,0.10)';
const BORDER_SOFT = 'rgba(255,255,255,0.06)';
const GOLD = '#C6A664';

const SYSTEM_SANS = Platform.select({
  ios: 'Avenir Next',
  android: 'sans-serif',
  web: undefined,
  default: undefined,
});

const ONE_GB = 1024 * 1024 * 1024;
const SHOWREEL_BUCKET = 'portfolios';

type DropdownOption = {
  label: string;
  value: number;
  country?: string;
};

const SHOWREEL_CATEGORIES = [
  'Acting',
  'Editing',
  'Directing',
  'Sound',
  'Cinematography',
  'All-in-one Filmmaker',
] as const;

type ShowreelCategory = typeof SHOWREEL_CATEGORIES[number];

const sanitizeFileName = (name: string) => name.replace(/[^\w.\-]+/g, '_').slice(-120);

const showToast = (msg: string) => {
  if (Platform.OS === 'android' && Toast) {
    Toast.show(msg, Toast.SHORT);
  } else {
    Alert.alert(msg);
  }
};

async function getResumableEndpoint(bucket = SHOWREEL_BUCKET) {
  const { data } = supabase.storage.from(bucket).getPublicUrl('__probe__');
  const url = new URL(data.publicUrl);
  return `${url.protocol}//${url.host}/storage/v1/upload/resumable`;
}

async function uploadResumableToBucket(opts: {
  userId: string;
  fileBlob?: Blob | File | null;
  localUri?: string | null;
  onProgress?: (pct: number) => void;
  onPhase?: (label: string) => void;
  objectName?: string;
  bucket?: string;
  contentType?: string;
}): Promise<{ path: string; contentType: string }> {
  const {
    userId,
    fileBlob,
    localUri,
    onProgress,
    onPhase,
    objectName = `user_${userId}/${Date.now()}_showreel`,
    bucket = SHOWREEL_BUCKET,
    contentType,
  } = opts;

  onPhase?.('Preparing showreel…');

  let file: Blob;
  let type = contentType || 'video/mp4';

  if (fileBlob) {
    file = fileBlob as Blob;
    // @ts-ignore
    if ((fileBlob as any)?.type) type = (fileBlob as any).type as string;
  } else if (localUri) {
    const resp = await fetch(localUri);
    file = await resp.blob();
    // @ts-ignore
    if ((file as any)?.type) type = (file as any).type as string;
  } else {
    throw new Error('No file selected');
  }

  const ext = '.mp4';
  type = 'video/mp4';
  const finalObjectName = `${objectName}${ext}`;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session) throw new Error('Not signed in');

  const endpoint = await getResumableEndpoint(bucket);

  return new Promise<{ path: string; contentType: string }>((resolve, reject) => {
    const upload = new Upload(file, {
      endpoint,
      retryDelays: [0, 2000, 5000, 10000, 20000],
      chunkSize: 6 * 1024 * 1024,
      uploadDataDuringCreation: true,
      removeFingerprintOnSuccess: true,
      headers: {
        authorization: `Bearer ${session.access_token}`,
        'x-upsert': 'true',
      },
      metadata: {
        bucketName: bucket,
        objectName: finalObjectName,
        contentType: type,
        cacheControl: '3600',
      },
      onProgress: (sent, total) => {
        if (!total) return;
        const pct = Math.max(0, Math.min(100, Math.round((sent / total) * 100)));
        onProgress?.(pct);
      },
      onError: (err) => reject(err),
      onSuccess: () => resolve({ path: finalObjectName, contentType: type }),
    });

    onPhase?.('Uploading showreel…');
    upload.findPreviousUploads().then((prev) => {
      if (prev.length) upload.resumeFromPreviousUpload(prev[0]);
      upload.start();
    });
  });
}

export default function CreateProfileScreen() {
  const { width } = useWindowDimensions();
  const { profileComplete, refreshProfile } = useAuth();
  const { refresh: refreshGamification } = useGamification();

  const isMobile = width < 768;

  // ---------------- FORM STATE ----------------
  const [fullName, setFullName] = useState('');

  const [image, setImage] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [mainRole, setMainRole] = useState<number | null>(null);
  const [mainRoleLabel, setMainRoleLabel] = useState<string | null>(null);

  const [cityId, setCityId] = useState<number | null>(null);
  const [cityLabel, setCityLabel] = useState<string | null>(null);

  const [roleSearchModalVisible, setRoleSearchModalVisible] = useState(false);
  const [roleSearchTerm, setRoleSearchTerm] = useState('');
  const [roleItems, setRoleItems] = useState<DropdownOption[]>([]);
  const [roleSearchItems, setRoleSearchItems] = useState<DropdownOption[]>([]);
  const [isSearchingRoles, setIsSearchingRoles] = useState(false);

  const [searchModalVisible, setSearchModalVisible] = useState(false);
  const [citySearchTerm, setCitySearchTerm] = useState('');
  const [cityItems, setCityItems] = useState<DropdownOption[]>([]);
  const [isSearchingCities, setIsSearchingCities] = useState(false);

  // optional showreel
  const [selectedShowreelCategory, setSelectedShowreelCategory] =
    useState<ShowreelCategory>('Acting');
  const [showreelName, setShowreelName] = useState('');
  const [pendingShowreelAsset, setPendingShowreelAsset] = useState<any | null>(null);
  const [showreelPreviewLabel, setShowreelPreviewLabel] = useState<string | null>(null);
  const [showreelUploading, setShowreelUploading] = useState(false);
  const [showreelProgress, setShowreelProgress] = useState(0);
  const [showreelStatus, setShowreelStatus] = useState('');
  const [showreelPublicUrl, setShowreelPublicUrl] = useState<string | null>(null);
  const [showreelPath, setShowreelPath] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

  // ---------------------------------------------------------
  // FETCH CREATIVE ROLES
  // ---------------------------------------------------------
  useEffect(() => {
    fetchCreativeRoles();
  }, []);

  const fetchCreativeRoles = async () => {
    const { data, error } = await supabase
      .from('creative_roles')
      .select('id, name')
      .order('name');

    if (error) {
      console.error('Error fetching roles:', error.message);
      return;
    }

    if (data) {
      setRoleItems(data.map((r) => ({ label: r.name, value: r.id })));
    }
  };

  // ---------------------------------------------------------
  // ROLE SEARCH
  // ---------------------------------------------------------
  const fetchSearchRoles = useCallback(async (text: string) => {
    if (!text.trim()) {
      setRoleSearchItems([]);
      return;
    }

    setIsSearchingRoles(true);

    const { data, error } = await supabase
      .from('creative_roles')
      .select('id, name')
      .ilike('name', `%${text.trim()}%`)
      .order('name')
      .limit(50);

    setIsSearchingRoles(false);

    if (error) {
      console.error('Role fetch error:', error.message);
      setRoleSearchItems([]);
      return;
    }

    setRoleSearchItems((data || []).map((r) => ({ label: r.name, value: r.id })));
  }, []);

  // ---------------------------------------------------------
  // FLAG UTILS
  // ---------------------------------------------------------
  const getFlag = (countryCode: string) => {
    return countryCode
      .toUpperCase()
      .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
  };

  // ---------------------------------------------------------
  // CITY SEARCH
  // ---------------------------------------------------------
  const fetchCities = useCallback(async (text: string) => {
    if (!text || text.trim().length < 1) {
      setCityItems([]);
      return;
    }

    setIsSearchingCities(true);

    const query = text.trim();

    const { data, error } = await supabase
      .from('cities')
      .select('id, name, country_code')
      .ilike('name', `%${query}%`)
      .limit(80);

    setIsSearchingCities(false);

    if (error) {
      console.error('City fetch error:', error.message);
      return;
    }

    if (!data) return;

    const exactMatches = data.filter((c) => c.name.toLowerCase() === query.toLowerCase());
    const prefixMatches = data.filter(
      (c) =>
        c.name.toLowerCase().startsWith(query.toLowerCase()) &&
        c.name.toLowerCase() !== query.toLowerCase()
    );
    const containsMatches = data.filter(
      (c) =>
        c.name.toLowerCase().includes(query.toLowerCase()) &&
        !c.name.toLowerCase().startsWith(query.toLowerCase()) &&
        c.name.toLowerCase() !== query.toLowerCase()
    );

    const ordered = [...exactMatches, ...prefixMatches, ...containsMatches];

    setCityItems(
      ordered.map((c) => ({
        label: `${getFlag(c.country_code)} ${c.name}, ${c.country_code}`,
        value: c.id,
        country: c.country_code,
      }))
    );
  }, []);

  // ---------------------------------------------------------
  // IMAGE UPLOAD
  // ---------------------------------------------------------
  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please allow access to your photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.8,
      base64: true,
      allowsEditing: true,
      aspect: [1, 1],
    });

    if (result.canceled || !result.assets.length) return;

    const asset = result.assets[0];
    const base64 = asset.base64;
    const uri = asset.uri;

    if (!base64) {
      Alert.alert('Upload Error', 'Could not read image data.');
      return;
    }

    setUploadingImage(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) throw new Error('User not authenticated');

      let ext = uri.split('.').pop();
      if (!ext || ext.length > 5) ext = 'jpg';

      const fileName = `user_${user.id}/${Date.now()}_avatar.${ext}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(fileName, decode(base64), {
          contentType: 'image/*',
          upsert: true,
        });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(fileName);

      if (!urlData?.publicUrl) throw new Error('Could not get avatar URL');

      setImage(uri);
      setImageUrl(urlData.publicUrl);
    } catch (err: any) {
      Alert.alert('Upload Error', err?.message ?? 'Could not upload image.');
    } finally {
      setUploadingImage(false);
    }
  };

  // ---------------------------------------------------------
  // OPTIONAL SHOWREEL
  // ---------------------------------------------------------
  const pickShowreel = async () => {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['video/mp4'],
        multiple: false,
        copyToCacheDirectory: true,
      });

      if (result.canceled || !result.assets?.length) return;

      const asset: any = result.assets[0];
      const name = (asset.name || '').toLowerCase();
      const mime = (asset.mime_type || asset.mimeType || '').toLowerCase() || 'video/mp4';
      const size = asset.size ?? asset.fileSize ?? asset.bytes ?? null;

      const isMp4 = name.endsWith('.mp4') || mime === 'video/mp4';

      if (!isMp4) {
        Alert.alert('MP4 only', 'Please select an .mp4 video.');
        return;
      }

      if (size && size > ONE_GB) {
        Alert.alert('Too large', 'Please select a video that is 1 GB or less.');
        return;
      }

      setPendingShowreelAsset(asset);
      setShowreelPreviewLabel(asset.name || 'Selected showreel');
      if (!showreelName.trim()) {
        const fallbackName = (asset.name || '').replace(/\.mp4$/i, '').trim();
        setShowreelName(fallbackName || 'My Showreel');
      }
    } catch (e: any) {
      Alert.alert('Showreel Error', e?.message ?? 'Could not select showreel.');
    }
  };

  const removeShowreel = () => {
    setPendingShowreelAsset(null);
    setShowreelPreviewLabel(null);
    setShowreelProgress(0);
    setShowreelStatus('');
    setShowreelPublicUrl(null);
    setShowreelPath(null);
  };

  const ensureShowreelUploaded = async (userId: string) => {
    if (!pendingShowreelAsset) return { publicUrl: null, path: null };
    if (showreelPublicUrl && showreelPath) {
      return { publicUrl: showreelPublicUrl, path: showreelPath };
    }

    setShowreelUploading(true);
    setShowreelProgress(0);
    setShowreelStatus('Preparing showreel…');

    try {
      const asset: any = pendingShowreelAsset;

      const { path } = await uploadResumableToBucket({
        userId,
        fileBlob: Platform.OS === 'web' ? ((asset.file as File | Blob | null) ?? undefined) : undefined,
        localUri: Platform.OS !== 'web' ? (asset.uri as string) : undefined,
        onProgress: (pct) => setShowreelProgress(pct),
        onPhase: (label) => setShowreelStatus(label),
        objectName: `user_${userId}/${Date.now()}_${sanitizeFileName(
          (asset.name || showreelName || 'showreel').replace(/\.mp4$/i, '')
        )}`,
        bucket: SHOWREEL_BUCKET,
      });

      const { data: pub } = supabase.storage.from(SHOWREEL_BUCKET).getPublicUrl(path);
      const publicUrl = pub.publicUrl;

      setShowreelPublicUrl(publicUrl);
      setShowreelPath(path);

      return { publicUrl, path };
    } catch (e: any) {
      throw new Error(e?.message ?? 'Could not upload showreel.');
    } finally {
      setShowreelUploading(false);
    }
  };

  // ---------------------------------------------------------
  // SUBMIT PROFILE
  // ---------------------------------------------------------
  const handleSubmit = async () => {
    if (!fullName.trim() || !mainRole || !cityId) {
      Alert.alert('Missing Info', 'Please fill in your name, main role, and city.');
      return;
    }

    if (!imageUrl) {
      Alert.alert('Profile image required', 'Please add a profile image before continuing.');
      return;
    }

    setSaving(true);

    try {
      const { data: sessionData, error: userErr } = await supabase.auth.getUser();
      if (userErr) throw userErr;

      const userId = sessionData.user?.id;
      if (!userId) throw new Error('User not authenticated');

      const { data: existingUser } = await supabase
        .from('users')
        .select('id, full_name, main_role_id, city_id')
        .eq('id', userId)
        .maybeSingle();

      const beforeComplete = !!(
        existingUser?.full_name &&
        existingUser?.main_role_id &&
        existingUser?.city_id
      );

      let uploadedShowreel: { publicUrl: string | null; path: string | null } = {
        publicUrl: null,
        path: null,
      };

      if (pendingShowreelAsset) {
        uploadedShowreel = await ensureShowreelUploaded(userId);
      }

      const portfolioUrl = uploadedShowreel.publicUrl || null;

      const { data: upserted, error } = await supabase
        .from('users')
        .upsert(
          {
            id: userId,
            full_name: fullName.trim(),
            main_role_id: mainRole,
            city_id: cityId,
            avatar_url: imageUrl,
            portfolio_url: portfolioUrl,
          },
          { onConflict: 'id' }
        )
        .select('id, full_name, main_role_id, city_id')
        .maybeSingle();

      if (error) throw error;

      if (uploadedShowreel.path) {
        await supabase.from('user_showreels').upsert(
          {
            user_id: userId,
            file_path: uploadedShowreel.path,
            title: showreelName.trim() || showreelPreviewLabel || 'Showreel',
            category: selectedShowreelCategory,
            thumbnail_url: null,
            is_primary: true,
            sort_order: 0,
          },
          { onConflict: 'user_id,file_path' }
        );
      }

      const afterComplete = !!(upserted?.full_name && upserted?.main_role_id && upserted?.city_id);

      await refreshProfile();
      await refreshGamification();

      const start = Date.now();
      let gate =
        profileComplete ||
        Boolean(upserted?.full_name && upserted?.main_role_id && upserted?.city_id);

      while (!gate && Date.now() - start < 2500) {
        await new Promise((r) => setTimeout(r, 150));
        await refreshProfile();
        gate =
          profileComplete ||
          Boolean(upserted?.full_name && upserted?.main_role_id && upserted?.city_id);
      }

      showToast('Welcome to Overlooked!');

      if (gate && navigationRef.isReady()) {
        navigationRef.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [{ name: 'MainTabs', state: { index: 0, routes: [{ name: 'Featured' }] } }],
          })
        );
      }
    } catch (err: any) {
      Alert.alert('Error', err?.message ?? 'Could not create profile.');
    } finally {
      setSaving(false);
    }
  };

  const loading = saving || uploadingImage || showreelUploading;

  // ---------------------------------------------------------
  // UI
  // ---------------------------------------------------------
  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={{ flex: 1, backgroundColor: DARK_BG }}
    >
      <LinearGradient
        colors={['#000000', '#080808', '#0B0B0B']}
        style={StyleSheet.absoluteFillObject}
      />

      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        <View style={[styles.card, !isMobile && styles.cardDesktop]}>
          <Text style={styles.eyebrow}>Join Overlooked</Text>
          <Text style={styles.title}>Create Your Profile</Text>
          <Text style={styles.subtitle}>
            Make a strong first impression. Add your image, choose your role, and start building
            your creative presence.
          </Text>

          {/* AVATAR */}
          <View style={styles.heroAvatarWrap}>
            <TouchableOpacity
              onPress={pickImage}
              activeOpacity={0.9}
              style={styles.avatarButton}
              disabled={uploadingImage || saving}
            >
              {image ? (
                <Image source={{ uri: image }} style={styles.avatarImage} resizeMode="cover" />
              ) : (
                <View style={styles.avatarFallback}>
                  <Ionicons name="camera-outline" size={28} color={GOLD} />
                  <Text style={styles.avatarFallbackText}>Add Profile Image</Text>
                </View>
              )}

              <View style={styles.avatarBadge}>
                {uploadingImage ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Ionicons name="add" size={16} color="#000" />
                )}
              </View>
            </TouchableOpacity>

            <Text style={styles.requiredLabel}>Required</Text>
          </View>

          {/* NAME */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              placeholder="Your full name"
              value={fullName}
              onChangeText={setFullName}
              style={styles.input}
              placeholderTextColor={TEXT_MUTED}
            />
          </View>

          {/* ROLE */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Main Role</Text>
            <TouchableOpacity
              style={styles.selectButton}
              onPress={() => {
                setRoleSearchModalVisible(true);
                setRoleSearchTerm('');
                setRoleSearchItems([]);
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.selectButtonText}>
                {mainRoleLabel ?? 'Search your main creative role'}
              </Text>
              <Ionicons name="search" size={16} color={TEXT_MUTED} />
            </TouchableOpacity>
          </View>

          {/* CITY */}
          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>City</Text>
            <TouchableOpacity
              style={styles.selectButton}
              onPress={() => {
                setSearchModalVisible(true);
                setCitySearchTerm('');
                setCityItems([]);
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.selectButtonText}>
                {cityLabel ?? 'Search for your city'}
              </Text>
              <Ionicons name="location-outline" size={16} color={TEXT_MUTED} />
            </TouchableOpacity>
          </View>

          {/* OPTIONAL SHOWREEL */}
          <View style={styles.fieldBlock}>
            <View style={styles.optionalHeaderRow}>
              <Text style={styles.fieldLabel}>Showreel Piece</Text>
              <Text style={styles.optionalText}>Optional</Text>
            </View>

            <Text style={styles.helperTextTop}>
              Add one MP4 showreel now, or skip it and upload more later from your Profile page.
            </Text>

            {!pendingShowreelAsset ? (
              <TouchableOpacity
                onPress={pickShowreel}
                style={styles.showreelPicker}
                activeOpacity={0.9}
                disabled={loading}
              >
                <Ionicons name="videocam-outline" size={22} color={GOLD} />
                <Text style={styles.showreelPickerTitle}>Add a showreel piece</Text>
                <Text style={styles.showreelPickerSub}>MP4 only</Text>
              </TouchableOpacity>
            ) : (
              <View style={styles.showreelCard}>
                <View style={styles.showreelRowTop}>
                  <View style={styles.showreelIconWrap}>
                    <Ionicons name="film-outline" size={18} color={GOLD} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.showreelFileName} numberOfLines={1}>
                      {showreelPreviewLabel || 'Selected showreel'}
                    </Text>
                    <Text style={styles.showreelMetaText}>Ready to upload</Text>
                  </View>
                  <TouchableOpacity onPress={removeShowreel} activeOpacity={0.8}>
                    <Ionicons name="close-circle" size={22} color={TEXT_MUTED} />
                  </TouchableOpacity>
                </View>

                <View style={styles.fieldBlockInner}>
                  <Text style={styles.fieldLabelSmall}>Showreel Title</Text>
                  <TextInput
                    placeholder="e.g. Dramatic Showreel"
                    value={showreelName}
                    onChangeText={setShowreelName}
                    style={styles.inputSmall}
                    placeholderTextColor={TEXT_MUTED}
                  />
                </View>

                <View style={styles.fieldBlockInner}>
                  <Text style={styles.fieldLabelSmall}>Category</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 8, paddingRight: 4 }}
                  >
                    {SHOWREEL_CATEGORIES.map((cat) => {
                      const selected = selectedShowreelCategory === cat;
                      return (
                        <TouchableOpacity
                          key={cat}
                          onPress={() => setSelectedShowreelCategory(cat)}
                          style={[
                            styles.categoryChip,
                            selected && styles.categoryChipSelected,
                          ]}
                          activeOpacity={0.9}
                        >
                          <Text
                            style={[
                              styles.categoryChipText,
                              selected && styles.categoryChipTextSelected,
                            ]}
                          >
                            {cat}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </ScrollView>
                </View>

                {showreelUploading && (
                  <View style={styles.progressWrap}>
                    {!!showreelStatus && <Text style={styles.progressLabel}>{showreelStatus}</Text>}
                    <View style={styles.progressRail}>
                      <View
                        style={[styles.progressFill, { width: `${showreelProgress}%` }]}
                      />
                    </View>
                    <Text style={styles.progressPercent}>{showreelProgress}%</Text>
                  </View>
                )}
              </View>
            )}
          </View>

          <Text style={styles.helperText}>
            You can build on your profile later — add more details, credits, and media anytime from
            your Profile page.
          </Text>

          <TouchableOpacity
            onPress={handleSubmit}
            style={[styles.submitButton, loading && { opacity: 0.6 }]}
            disabled={loading}
            activeOpacity={0.9}
          >
            {loading ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.submitText}>Finish</Text>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* ---------------- CITY MODAL ---------------- */}
      <Modal
        visible={searchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select City</Text>

            <TextInput
              placeholder="Start typing your city..."
              placeholderTextColor={TEXT_MUTED}
              value={citySearchTerm}
              onChangeText={(text) => {
                setCitySearchTerm(text);
                fetchCities(text);
              }}
              style={styles.searchInput}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
            />

            {isSearchingCities ? (
              <ActivityIndicator style={{ marginTop: 20 }} color={GOLD} />
            ) : (
              <FlatList
                data={cityItems}
                keyExtractor={(item) => item.value.toString()}
                style={{ width: '100%', marginTop: 10 }}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.listItem}
                    onPress={() => {
                      setCityId(item.value);
                      setCityLabel(item.label);
                      setSearchModalVisible(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.listItemText}>{item.label}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>Start typing to search cities.</Text>
                }
              />
            )}

            <TouchableOpacity
              onPress={() => setSearchModalVisible(false)}
              style={styles.closeModalButton}
              activeOpacity={0.8}
            >
              <Text style={styles.closeModalText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ---------------- ROLE MODAL ---------------- */}
      <Modal
        visible={roleSearchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRoleSearchModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Select Main Role</Text>

            <TextInput
              placeholder="Start typing a role..."
              placeholderTextColor={TEXT_MUTED}
              value={roleSearchTerm}
              onChangeText={(text) => {
                setRoleSearchTerm(text);
                fetchSearchRoles(text);
              }}
              style={styles.searchInput}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
            />

            {isSearchingRoles ? (
              <ActivityIndicator style={{ marginTop: 20 }} color={GOLD} />
            ) : (
              <FlatList
                data={roleSearchItems.length > 0 ? roleSearchItems : roleItems}
                keyExtractor={(item) => item.value.toString()}
                style={{ width: '100%', marginTop: 10 }}
                keyboardShouldPersistTaps="handled"
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.listItem}
                    onPress={() => {
                      setMainRole(item.value);
                      setMainRoleLabel(item.label);
                      setRoleSearchModalVisible(false);
                    }}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.listItemText}>{item.label}</Text>
                  </TouchableOpacity>
                )}
                ListEmptyComponent={
                  <Text style={styles.emptyText}>Start typing to search roles.</Text>
                }
              />
            )}

            <TouchableOpacity
              onPress={() => setRoleSearchModalVisible(false)}
              style={styles.closeModalButton}
              activeOpacity={0.8}
            >
              <Text style={styles.closeModalText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

// ---------------------------------------------------------
// STYLES
// ---------------------------------------------------------
const styles = StyleSheet.create({
  container: {
    flexGrow: 1,
    padding: 18,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: DARK_BG,
  },

  card: {
    width: '100%',
    maxWidth: 620,
    backgroundColor: CARD,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
    padding: 22,
  },

  cardDesktop: {
    padding: 28,
  },

  eyebrow: {
    color: GOLD,
    textAlign: 'center',
    fontSize: 12,
    letterSpacing: 2.2,
    textTransform: 'uppercase',
    marginBottom: 8,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  title: {
    fontSize: 28,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 10,
    letterSpacing: 0.6,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  subtitle: {
    color: TEXT_MUTED,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 22,
    fontFamily: SYSTEM_SANS,
  },

  heroAvatarWrap: {
    alignItems: 'center',
    marginBottom: 20,
  },

  avatarButton: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: ELEVATED,
    borderWidth: 1.5,
    borderColor: 'rgba(198,166,100,0.30)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    position: 'relative',
  },

  avatarImage: {
    width: '100%',
    height: '100%',
  },

  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
  },

  avatarFallbackText: {
    color: TEXT_IVORY,
    marginTop: 8,
    fontSize: 12,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  avatarBadge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: GOLD,
    alignItems: 'center',
    justifyContent: 'center',
  },

  requiredLabel: {
    marginTop: 10,
    color: GOLD,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
  },

  fieldBlock: {
    marginBottom: 16,
  },

  fieldBlockInner: {
    marginTop: 12,
  },

  fieldLabel: {
    color: TEXT_MUTED,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.4,
    marginBottom: 8,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  fieldLabelSmall: {
    color: TEXT_MUTED,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 8,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  input: {
    width: '100%',
    backgroundColor: ELEVATED,
    borderRadius: 16,
    paddingVertical: 15,
    paddingHorizontal: 16,
    color: TEXT_IVORY,
    borderWidth: 1,
    borderColor: BORDER,
    fontFamily: SYSTEM_SANS,
    fontSize: 15,
  },

  inputSmall: {
    width: '100%',
    backgroundColor: '#121212',
    borderRadius: 14,
    paddingVertical: 13,
    paddingHorizontal: 14,
    color: TEXT_IVORY,
    borderWidth: 1,
    borderColor: BORDER,
    fontFamily: SYSTEM_SANS,
    fontSize: 14,
  },

  selectButton: {
    width: '100%',
    paddingVertical: 15,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: ELEVATED,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  selectButtonText: {
    color: TEXT_IVORY,
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
    flex: 1,
    paddingRight: 12,
  },

  optionalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  optionalText: {
    color: GOLD,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  helperTextTop: {
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 12,
    fontFamily: SYSTEM_SANS,
  },

  showreelPicker: {
    backgroundColor: CARD_ALT,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  showreelPickerTitle: {
    color: TEXT_IVORY,
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    marginTop: 10,
  },

  showreelPickerSub: {
    color: TEXT_MUTED,
    fontSize: 12,
    marginTop: 4,
    fontFamily: SYSTEM_SANS,
  },

  showreelCard: {
    backgroundColor: CARD_ALT,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 14,
  },

  showreelRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  showreelIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#121212',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
  },

  showreelFileName: {
    color: TEXT_IVORY,
    fontSize: 14,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
  },

  showreelMetaText: {
    color: TEXT_MUTED,
    fontSize: 12,
    marginTop: 2,
    fontFamily: SYSTEM_SANS,
  },

  categoryChip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: BORDER,
  },

  categoryChipSelected: {
    backgroundColor: 'rgba(198,166,100,0.16)',
    borderColor: GOLD,
  },

  categoryChipText: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  categoryChipTextSelected: {
    color: GOLD,
  },

  progressWrap: {
    marginTop: 14,
  },

  progressLabel: {
    color: TEXT_MUTED,
    fontSize: 12,
    marginBottom: 8,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  progressRail: {
    height: 6,
    borderRadius: 999,
    backgroundColor: '#131313',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
    overflow: 'hidden',
  },

  progressFill: {
    height: '100%',
    backgroundColor: GOLD,
  },

  progressPercent: {
    color: TEXT_MUTED,
    fontSize: 12,
    marginTop: 8,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  helperText: {
    width: '100%',
    textAlign: 'center',
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    marginBottom: 18,
    fontFamily: SYSTEM_SANS,
  },

  submitButton: {
    backgroundColor: GOLD,
    width: '100%',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 4,
  },

  submitText: {
    color: DARK_BG,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 0.4,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: '#000000CC',
    justifyContent: 'center',
    padding: 18,
  },

  modalCard: {
    backgroundColor: CARD,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
    maxHeight: '82%',
  },

  modalTitle: {
    fontSize: 19,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 14,
    textAlign: 'center',
    letterSpacing: 0.8,
    fontFamily: SYSTEM_SANS,
    textTransform: 'uppercase',
  },

  searchInput: {
    backgroundColor: ELEVATED,
    borderRadius: 16,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: BORDER,
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
    fontSize: 15,
  },

  listItem: {
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderColor: BORDER_SOFT,
  },

  listItemText: {
    fontSize: 15,
    color: TEXT_IVORY,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  emptyText: {
    marginTop: 24,
    textAlign: 'center',
    color: TEXT_MUTED,
    fontSize: 13,
    fontFamily: SYSTEM_SANS,
  },

  closeModalButton: {
    marginTop: 16,
    paddingVertical: 13,
    borderRadius: 14,
    backgroundColor: ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
  },

  closeModalText: {
    fontSize: 14,
    color: TEXT_MUTED,
    fontWeight: '700',
    fontFamily: SYSTEM_SANS,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
});