// screens/CreateProfileScreen.tsx
import React, { useEffect, useState, useCallback, useRef } from 'react';
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
import { Upload } from 'tus-js-client';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CommonActions } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { navigationRef } from '../navigation/navigationRef';
import { useAuth } from '../context/AuthProvider';
import { useGamification } from '../context/GamificationContext';
import AvatarCropper from '../../components/AvatarCropper';

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
const THUMB_BUCKET = 'thumbnails';

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
const addBuster = (url?: string | null) =>
  url ? `${url}${/\?/.test(url) ? '&' : '?'}t=${Date.now()}` : null;

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

async function uploadBlobToBucket(opts: {
  bucket: string;
  path: string;
  blob: Blob;
  contentType?: string;
}) {
  const { bucket, path, blob, contentType } = opts;

  const { error } = await supabase.storage.from(bucket).upload(path, blob, {
    contentType: contentType || blob.type || undefined,
    upsert: true,
  });

  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not get public URL');

  return data.publicUrl;
}

export default function CreateProfileScreen() {
  const { width } = useWindowDimensions();
  const { profileComplete, refreshProfile } = useAuth();
  const { refresh: refreshGamification } = useGamification();

  const isMobile = width < 768;

  const roleSearchReq = useRef(0);
  const citySearchReq = useRef(0);

  // ---------------- FORM STATE ----------------
  const [fullName, setFullName] = useState('');

  const [image, setImage] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);

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

  // showreel thumbnail
  const [showreelThumbAsset, setShowreelThumbAsset] = useState<any | null>(null);
  const [showreelThumbPreview, setShowreelThumbPreview] = useState<string | null>(null);
  const [showreelThumbUploading, setShowreelThumbUploading] = useState(false);

  const [saving, setSaving] = useState(false);

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

  const fetchSearchRoles = useCallback(async (text: string) => {
    const q = text.trim();
    const reqId = ++roleSearchReq.current;

    if (!q) {
      setRoleSearchItems([]);
      setIsSearchingRoles(false);
      return;
    }

    setIsSearchingRoles(true);

    try {
      const { data, error } = await supabase
        .from('creative_roles')
        .select('id, name')
        .ilike('name', `%${q}%`)
        .order('name')
        .limit(50);

      if (reqId !== roleSearchReq.current) return;

      if (error) {
        console.error('Role fetch error:', error.message);
        setRoleSearchItems([]);
        return;
      }

      setRoleSearchItems((data || []).map((r) => ({ label: r.name, value: r.id })));
    } catch (e) {
      console.error('Role fetch fatal:', e);
      if (reqId === roleSearchReq.current) {
        setRoleSearchItems([]);
      }
    } finally {
      if (reqId === roleSearchReq.current) {
        setIsSearchingRoles(false);
      }
    }
  }, []);

  const getFlag = (countryCode: string) => {
    return countryCode
      .toUpperCase()
      .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
  };

  const fetchCities = useCallback(async (text: string) => {
    const q = text.trim();
    const reqId = ++citySearchReq.current;

    if (!q) {
      setCityItems([]);
      setIsSearchingCities(false);
      return;
    }

    setIsSearchingCities(true);

    try {
      const { data, error } = await supabase
        .from('cities')
        .select('id, name, country_code')
        .ilike('name', `%${q}%`)
        .limit(80);

      if (reqId !== citySearchReq.current) return;

      if (error) {
        console.error('City fetch error:', error.message);
        setCityItems([]);
        return;
      }

      if (!data) {
        setCityItems([]);
        return;
      }

      const exactMatches = data.filter((c) => c.name.toLowerCase() === q.toLowerCase());
      const prefixMatches = data.filter(
        (c) =>
          c.name.toLowerCase().startsWith(q.toLowerCase()) &&
          c.name.toLowerCase() !== q.toLowerCase()
      );
      const containsMatches = data.filter(
        (c) =>
          c.name.toLowerCase().includes(q.toLowerCase()) &&
          !c.name.toLowerCase().startsWith(q.toLowerCase()) &&
          c.name.toLowerCase() !== q.toLowerCase()
      );

      const ordered = [...exactMatches, ...prefixMatches, ...containsMatches];

      setCityItems(
        ordered.map((c) => ({
          label: `${getFlag(c.country_code)} ${c.name}, ${c.country_code}`,
          value: c.id,
          country: c.country_code,
        }))
      );
    } catch (e) {
      console.error('City fetch fatal:', e);
      if (reqId === citySearchReq.current) {
        setCityItems([]);
      }
    } finally {
      if (reqId === citySearchReq.current) {
        setIsSearchingCities(false);
      }
    }
  }, []);

  // PROFILE IMAGE - SAME CROPPER FLOW AS PROFILE SCREEN
  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Permission required', 'Please allow access to your photos.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 1,
      base64: false,
    });

    if (result.canceled || !result.assets.length) return;

    const asset = result.assets[0];
    setCropSource(asset.uri);
    setCropperOpen(true);
  };

  const handleAvatarCropped = async (croppedUri: string) => {
    try {
      setUploadingImage(true);

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user?.id) throw new Error('User not authenticated');

      const fileName = `${Date.now()}_avatar.jpg`;
      const path = `user_${user.id}/${fileName}`;

      const response = await fetch(croppedUri);
      const blob = await response.blob();

      const publicUrl = await uploadBlobToBucket({
        bucket: 'avatars',
        path,
        blob,
        contentType: 'image/jpeg',
      });

      setImage(croppedUri);
      setImageUrl(publicUrl);
    } catch (err: any) {
      Alert.alert('Upload Error', err?.message ?? 'Could not upload image.');
    } finally {
      setUploadingImage(false);
      setCropperOpen(false);
      setCropSource(null);
    }
  };

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
      setShowreelPublicUrl(null);
      setShowreelPath(null);

      if (!showreelName.trim()) {
        const fallbackName = (asset.name || '').replace(/\.mp4$/i, '').trim();
        setShowreelName(fallbackName || 'My Showreel');
      }
    } catch (e: any) {
      Alert.alert('Showreel Error', e?.message ?? 'Could not select showreel.');
    }
  };

  const pickShowreelThumbnail = async () => {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permission required', 'Please allow access to your photos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.9,
        base64: false,
        allowsEditing: true,
        aspect: [16, 9],
      });

      if (result.canceled || !result.assets.length) return;

      const asset: any = result.assets[0];
      setShowreelThumbAsset(asset);

      if (Platform.OS === 'web' && asset?.file) {
        const previewUrl = URL.createObjectURL(asset.file as File);
        setShowreelThumbPreview(previewUrl);
      } else {
        setShowreelThumbPreview(asset.uri);
      }
    } catch (e: any) {
      Alert.alert('Thumbnail Error', e?.message ?? 'Could not select thumbnail.');
    }
  };

  const removeShowreel = () => {
    setPendingShowreelAsset(null);
    setShowreelPreviewLabel(null);
    setShowreelProgress(0);
    setShowreelStatus('');
    setShowreelPublicUrl(null);
    setShowreelPath(null);
    setShowreelThumbAsset(null);
    setShowreelThumbPreview(null);
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

  const uploadShowreelThumbnail = async (userId: string, filePath: string) => {
    if (!showreelThumbAsset) return null;

    setShowreelThumbUploading(true);

    try {
      let blob: Blob;

      if (Platform.OS === 'web' && showreelThumbAsset?.file) {
        blob = showreelThumbAsset.file as Blob;
      } else {
        const response = await fetch(showreelThumbAsset.uri);
        blob = await response.blob();
      }

      const safeBase = sanitizeFileName(filePath.split('/').pop() || 'showreel');
      const thumbPath = `showreels/${userId}/${safeBase}_${Date.now()}.jpg`;

      const publicUrl = await uploadBlobToBucket({
        bucket: THUMB_BUCKET,
        path: thumbPath,
        blob,
        contentType: blob.type || 'image/jpeg',
      });

      return publicUrl;
    } catch (e: any) {
      throw new Error(e?.message ?? 'Could not upload showreel thumbnail.');
    } finally {
      setShowreelThumbUploading(false);
    }
  };

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

      let uploadedShowreel: { publicUrl: string | null; path: string | null } = {
        publicUrl: null,
        path: null,
      };

      let uploadedThumbUrl: string | null = null;

      if (pendingShowreelAsset) {
        uploadedShowreel = await ensureShowreelUploaded(userId);

        if (uploadedShowreel.path && showreelThumbAsset) {
          uploadedThumbUrl = await uploadShowreelThumbnail(userId, uploadedShowreel.path);
        }
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
        const { error: showreelErr } = await supabase.from('user_showreels').upsert(
          {
            user_id: userId,
            file_path: uploadedShowreel.path,
            title: showreelName.trim() || showreelPreviewLabel || 'Showreel',
            category: selectedShowreelCategory,
            thumbnail_url: uploadedThumbUrl,
            is_primary: true,
            sort_order: 0,
          },
          { onConflict: 'user_id,file_path' }
        );

        if (showreelErr) throw showreelErr;
      }

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

  const loading = saving || uploadingImage || showreelUploading || showreelThumbUploading;

  const searchInputWebFix =
    Platform.OS === 'web'
      ? ({
          outlineWidth: 0,
          outlineStyle: 'none',
          boxShadow: 'none',
          borderColor: BORDER,
        } as any)
      : null;

  const roleDataToShow =
    roleSearchTerm.trim().length > 0 ? roleSearchItems : roleItems;

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
            </TouchableOpacity>

            <TouchableOpacity
              onPress={pickImage}
              style={styles.avatarChangeBtn}
              activeOpacity={0.85}
              disabled={uploadingImage || saving}
            >
              {uploadingImage ? (
                <ActivityIndicator color="#000" size="small" />
              ) : (
                <Text style={styles.avatarChangeBtnText}>
                  {image ? 'Change Profile Image' : 'Upload Profile Image'}
                </Text>
              )}
            </TouchableOpacity>

            <Text style={styles.requiredLabel}>Required</Text>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Name</Text>
            <TextInput
              placeholder="Your full name"
              value={fullName}
              onChangeText={setFullName}
              style={[styles.input, searchInputWebFix]}
              placeholderTextColor={TEXT_MUTED}
            />
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>Main Role</Text>
            <TouchableOpacity
              style={styles.selectButton}
              onPress={() => {
                setRoleSearchModalVisible(true);
                setRoleSearchTerm('');
                setRoleSearchItems([]);
                setIsSearchingRoles(false);
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.selectButtonText}>
                {mainRoleLabel ?? 'Search your main creative role'}
              </Text>
              <Ionicons name="search" size={16} color={TEXT_MUTED} />
            </TouchableOpacity>
          </View>

          <View style={styles.fieldBlock}>
            <Text style={styles.fieldLabel}>City</Text>
            <TouchableOpacity
              style={styles.selectButton}
              onPress={() => {
                setSearchModalVisible(true);
                setCitySearchTerm('');
                setCityItems([]);
                setIsSearchingCities(false);
              }}
              activeOpacity={0.9}
            >
              <Text style={styles.selectButtonText}>
                {cityLabel ?? 'Search for your city'}
              </Text>
              <Ionicons name="location-outline" size={16} color={TEXT_MUTED} />
            </TouchableOpacity>
          </View>

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
                    style={[styles.inputSmall, searchInputWebFix]}
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

                <View style={styles.fieldBlockInner}>
                  <Text style={styles.fieldLabelSmall}>Showreel Thumbnail</Text>

                  {!showreelThumbPreview ? (
                    <TouchableOpacity
                      onPress={pickShowreelThumbnail}
                      style={styles.thumbnailPicker}
                      activeOpacity={0.9}
                      disabled={loading}
                    >
                      <Ionicons name="image-outline" size={20} color={GOLD} />
                      <Text style={styles.thumbnailPickerTitle}>Add Thumbnail</Text>
                      <Text style={styles.thumbnailPickerSub}>Optional cover image</Text>
                    </TouchableOpacity>
                  ) : (
                    <View style={styles.thumbnailCard}>
                      <Image
                        source={{ uri: addBuster(showreelThumbPreview) || showreelThumbPreview }}
                        style={styles.thumbnailImage}
                        resizeMode="cover"
                      />
                      <View style={styles.thumbnailActions}>
                        <TouchableOpacity
                          onPress={pickShowreelThumbnail}
                          style={styles.thumbnailActionBtn}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.thumbnailActionText}>Change</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          onPress={() => {
                            setShowreelThumbAsset(null);
                            setShowreelThumbPreview(null);
                          }}
                          style={styles.thumbnailActionBtnGhost}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.thumbnailActionTextGhost}>Remove</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  )}
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

      <Modal
        visible={searchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSearchModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCardFixed}>
            <Text style={styles.modalTitle}>Select City</Text>

            <TextInput
              placeholder="Start typing your city..."
              placeholderTextColor={TEXT_MUTED}
              value={citySearchTerm}
              onChangeText={(text) => {
                setCitySearchTerm(text);
                fetchCities(text);
              }}
              style={[styles.searchInput, searchInputWebFix]}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
            />

            <View style={styles.modalResultsArea}>
              {isSearchingCities ? (
                <View style={styles.modalLoadingWrap}>
                  <ActivityIndicator color={GOLD} />
                </View>
              ) : (
                <FlatList
                  data={cityItems}
                  keyExtractor={(item) => item.value.toString()}
                  style={styles.resultsList}
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
            </View>

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

      <Modal
        visible={roleSearchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setRoleSearchModalVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCardFixed}>
            <Text style={styles.modalTitle}>Select Main Role</Text>

            <TextInput
              placeholder="Start typing a role..."
              placeholderTextColor={TEXT_MUTED}
              value={roleSearchTerm}
              onChangeText={(text) => {
                setRoleSearchTerm(text);
                fetchSearchRoles(text);
              }}
              style={[styles.searchInput, searchInputWebFix]}
              autoFocus
              autoCorrect={false}
              autoCapitalize="none"
            />

            <View style={styles.modalResultsArea}>
              {isSearchingRoles ? (
                <View style={styles.modalLoadingWrap}>
                  <ActivityIndicator color={GOLD} />
                </View>
              ) : (
                <FlatList
                  data={roleSearchTerm.trim().length > 0 ? roleDataToShow : roleItems}
                  keyExtractor={(item) => item.value.toString()}
                  style={styles.resultsList}
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
            </View>

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

      <AvatarCropper
        visible={cropperOpen}
        imageUri={cropSource || undefined}
        onCancel={() => {
          setCropperOpen(false);
          setCropSource(null);
        }}
        onCropped={handleAvatarCropped}
        fullName={fullName || ''}
        mainRoleName={mainRoleLabel || ''}
        cityName={cityLabel || ''}
        level={1}
      />
    </KeyboardAvoidingView>
  );
}

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

  avatarChangeBtn: {
    marginTop: 12,
    backgroundColor: GOLD,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  avatarChangeBtnText: {
    color: '#000',
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
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

  thumbnailPicker: {
    backgroundColor: '#121212',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 16,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  thumbnailPickerTitle: {
    color: TEXT_IVORY,
    fontSize: 14,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    marginTop: 8,
  },

  thumbnailPickerSub: {
    color: TEXT_MUTED,
    fontSize: 12,
    marginTop: 4,
    fontFamily: SYSTEM_SANS,
  },

  thumbnailCard: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#121212',
  },

  thumbnailImage: {
    width: '100%',
    height: 160,
    backgroundColor: '#000',
  },

  thumbnailActions: {
    flexDirection: 'row',
    gap: 10,
    padding: 12,
  },

  thumbnailActionBtn: {
    flex: 1,
    backgroundColor: 'rgba(198,166,100,0.16)',
    borderWidth: 1,
    borderColor: GOLD,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },

  thumbnailActionBtnGhost: {
    flex: 1,
    backgroundColor: '#111111',
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
  },

  thumbnailActionText: {
    color: GOLD,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  thumbnailActionTextGhost: {
    color: TEXT_IVORY,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
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

  modalCardFixed: {
    width: '100%',
    maxWidth: 620,
    height: 460,
    alignSelf: 'center',
    backgroundColor: CARD,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    padding: 18,
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

  modalResultsArea: {
    flex: 1,
    minHeight: 0,
    marginTop: 10,
  },

  modalLoadingWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  resultsList: {
    width: '100%',
    flex: 1,
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