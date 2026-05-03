// app/screens/CreateProfileScreen.tsx
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
  Animated,
  Easing,
} from 'react-native';

const Toast = Platform.OS === 'android' ? require('react-native').ToastAndroid : null;

import * as ImagePicker from 'expo-image-picker';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { CommonActions } from '@react-navigation/native';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from '../lib/supabase';
import { navigationRef } from '../navigation/navigationRef';
import { useAuth } from '../context/AuthProvider';
import { useGamification } from '../context/GamificationContext';
import AvatarCropper from '../../components/AvatarCropper';

// ---------------- THEME ----------------
const DARK_BG = '#000000';
const CARD = '#0A0A0A';
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

type DropdownOption = {
  label: string;
  value: number;
  country?: string;
};

type OnboardingStage = 'role' | 'city' | 'name' | 'image' | 'review';

const G = globalThis as any;

function resetHardToSignIn() {
  G.__OVERLOOKED_EMAIL_CONFIRM__ = false;
  G.__OVERLOOKED_RECOVERY__ = false;
  G.__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
  G.__OVERLOOKED_PASSWORD_RESET_DONE__ = false;

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    window.sessionStorage.removeItem('overlooked.allowCreateProfile');

    if (window.location.pathname !== '/signin') {
      window.location.replace('/signin');
      return;
    }
  }

  if (navigationRef.isReady()) {
    navigationRef.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [
          {
            name: 'Auth',
            params: { screen: 'SignIn' },
          },
        ],
      })
    );
  }
}

const showToast = (msg: string) => {
  if (Platform.OS === 'android' && Toast) {
    Toast.show(msg, Toast.SHORT);
  } else {
    Alert.alert(msg);
  }
};

function base64ToUint8Array(base64: string) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
  const clean = base64.replace(/=+$/, '');
  const bufferLength = Math.floor((clean.length * 3) / 4);
  const bytes = new Uint8Array(bufferLength);

  let p = 0;

  for (let i = 0; i < clean.length; i += 4) {
    const encoded1 = chars.indexOf(clean[i]);
    const encoded2 = chars.indexOf(clean[i + 1]);
    const encoded3 = chars.indexOf(clean[i + 2]);
    const encoded4 = chars.indexOf(clean[i + 3]);

    bytes[p++] = (encoded1 << 2) | (encoded2 >> 4);

    if (encoded3 !== 64 && encoded3 !== -1 && p < bytes.length) {
      bytes[p++] = ((encoded2 & 15) << 4) | (encoded3 >> 2);
    }

    if (encoded4 !== 64 && encoded4 !== -1 && p < bytes.length) {
      bytes[p++] = ((encoded3 & 3) << 6) | encoded4;
    }
  }

  return bytes;
}

function withTimeout<T = any>(promise: PromiseLike<T>, ms = 15000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          'This step took too long. Please check your internet/storage settings and try again.'
        )
      );
    }, ms);

    Promise.resolve(promise)
      .then((value: any) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: any) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

async function uploadImageToBucket(opts: {
  bucket: string;
  path: string;
  fileBody: Blob | Uint8Array;
  contentType?: string;
}) {
  const { bucket, path, fileBody, contentType } = opts;

  const { error } = await supabase.storage.from(bucket).upload(path, fileBody, {
    contentType: contentType || 'image/jpeg',
    upsert: true,
  });

  if (error) throw error;

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  if (!data?.publicUrl) throw new Error('Could not get public URL');

  return data.publicUrl;
}

async function uriToUploadBody(uri: string): Promise<Blob | Uint8Array> {
  if (!uri) {
    throw new Error('Missing image URI.');
  }

  if (Platform.OS === 'web' || uri.startsWith('blob:') || uri.startsWith('data:')) {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Could not read cropped image.');
    return await response.blob();
  }

  const fileInfo = await FileSystem.getInfoAsync(uri);
  if (!fileInfo.exists) {
    throw new Error('Cropped image file does not exist.');
  }

  const base64 = await FileSystem.readAsStringAsync(uri, {
    encoding: 'base64' as any,
  });

  if (!base64 || typeof base64 !== 'string') {
    throw new Error('Could not read cropped image.');
  }

  return base64ToUint8Array(base64);
}

async function makePreviewUri(uri: string) {
  if (!uri) return uri;

  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Could not prepare preview image.');
    const blob = await response.blob();

    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Could not prepare preview image.'));
      reader.readAsDataURL(blob);
    });
  }

  return uri;
}

const normalizeText = (text: string) => text.trim().toLowerCase();

const rankMatch = (candidate: string, query: string) => {
  const c = normalizeText(candidate);
  const q = normalizeText(query);

  if (!q) return 999;
  if (c === q) return 0;
  if (c.startsWith(q)) return 1;

  const words = c.split(/\s+/);
  if (words.includes(q)) return 2;
  if (words.some((word) => word.startsWith(q))) return 3;
  if (c.includes(q)) return 4;

  return 999;
};

export default function CreateProfileScreen() {
  const allowedCreateProfileRef = useRef(true);

  const { width } = useWindowDimensions();
  const { refreshProfile, setProfileCompleteFromSavedProfile } = useAuth();
  const { refresh: refreshGamification } = useGamification();

  const isMobile = width < 768;

  const roleSearchReq = useRef(0);
  const citySearchReq = useRef(0);

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const slideAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;

  const imageSectionOpacity = useRef(new Animated.Value(0)).current;
  const imageSectionTranslate = useRef(new Animated.Value(18)).current;

  const hasStartedSequence = useRef(false);

  const [stage, setStage] = useState<OnboardingStage>('role');

  const [fullName, setFullName] = useState('');

  const [image, setImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [croppedImageUri, setCroppedImageUri] = useState<string | null>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const [cropperOpen, setCropperOpen] = useState(false);
  const [cropSource, setCropSource] = useState<string | null>(null);

  const [mainRole, setMainRole] = useState<number | null>(null);
  const [mainRoleLabel, setMainRoleLabel] = useState<string | null>(null);

  const [cityId, setCityId] = useState<number | null>(null);
  const [cityLabel, setCityLabel] = useState<string | null>(null);
  const [selectedCountryCode, setSelectedCountryCode] = useState<string | null>(null);

  const [roleSearchModalVisible, setRoleSearchModalVisible] = useState(false);
  const [roleSearchTerm, setRoleSearchTerm] = useState('');
  const [roleItems, setRoleItems] = useState<DropdownOption[]>([]);
  const [roleSearchItems, setRoleSearchItems] = useState<DropdownOption[]>([]);
  const [isSearchingRoles, setIsSearchingRoles] = useState(false);

  const [citySearchModalVisible, setCitySearchModalVisible] = useState(false);
  const [citySearchTerm, setCitySearchTerm] = useState('');
  const [cityItems, setCityItems] = useState<DropdownOption[]>([]);
  const [isSearchingCities, setIsSearchingCities] = useState(false);

  const [saving, setSaving] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    const checkSession = async () => {
      const {
        data: { user },
        error,
      } = await supabase.auth.getUser();

      if (!mounted) return;

      if (error || !user?.id) {
        console.log('🚫 CreateProfile blocked: no authenticated user.');
        resetHardToSignIn();
      }
    };

    checkSession();

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!allowedCreateProfileRef.current) return;
    fetchCreativeRoles();
  }, []);

  useEffect(() => {
    if (!allowedCreateProfileRef.current) return;
    if (hasStartedSequence.current) return;
    hasStartedSequence.current = true;

    const timer = setTimeout(() => {
      openRoleSelector();
    }, 900);

    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!allowedCreateProfileRef.current) return;

    if (stage === 'image' || stage === 'review') {
      imageSectionOpacity.setValue(0);
      imageSectionTranslate.setValue(18);

      Animated.parallel([
        Animated.timing(imageSectionOpacity, {
          toValue: 1,
          duration: 1800,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(imageSectionTranslate, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start();
    }
  }, [stage, imageSectionOpacity, imageSectionTranslate]);

  const animateStageChange = (nextStage: OnboardingStage, cb?: () => void) => {
    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 1400,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(slideAnim, {
        toValue: -10,
        duration: 1400,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 0.985,
        duration: 1400,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setStage(nextStage);
      cb?.();

      fadeAnim.setValue(0);
      slideAnim.setValue(10);
      scaleAnim.setValue(1.01);

      setTimeout(() => {
        Animated.parallel([
          Animated.timing(fadeAnim, {
            toValue: 1,
            duration: 1600,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(slideAnim, {
            toValue: 0,
            duration: 1600,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(scaleAnim, {
            toValue: 1,
            duration: 1600,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
        ]).start();
      }, 350);
    });
  };

  const openRoleSelector = () => {
    setRoleSearchTerm('');
    setRoleSearchItems([]);
    setIsSearchingRoles(false);
    setRoleSearchModalVisible(true);
  };

  const openCitySelector = () => {
    setCitySearchTerm('');
    setCityItems([]);
    setIsSearchingCities(false);
    setCitySearchModalVisible(true);
  };

  const fetchCreativeRoles = async () => {
    const { data, error } = await supabase.from('creative_roles').select('id, name').order('name');

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
        .limit(100);

      if (reqId !== roleSearchReq.current) return;

      if (error) {
        console.error('Role fetch error:', error.message);
        setRoleSearchItems([]);
        return;
      }

      const mapped = (data || []).map((r) => ({
        label: r.name,
        value: r.id,
      }));

      const ordered = mapped.sort((a, b) => {
        const aRank = rankMatch(a.label, q);
        const bRank = rankMatch(b.label, q);
        if (aRank !== bRank) return aRank - bRank;
        return a.label.localeCompare(b.label);
      });

      setRoleSearchItems(ordered);
    } catch (e) {
      console.error('Role fetch fatal:', e);
      if (reqId === roleSearchReq.current) setRoleSearchItems([]);
    } finally {
      if (reqId === roleSearchReq.current) setIsSearchingRoles(false);
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
        .limit(100);

      if (reqId !== citySearchReq.current) return;

      if (error) {
        console.error('City fetch error:', error.message);
        setCityItems([]);
        return;
      }

      const mapped = (data || []).map((c: any) => ({
        label: `${getFlag(c.country_code)} ${c.name}, ${c.country_code}`,
        value: c.id,
        country: c.country_code,
        rawName: c.name,
      }));

      const ordered = mapped
        .sort((a: any, b: any) => {
          const aRank = rankMatch(a.rawName, q);
          const bRank = rankMatch(b.rawName, q);

          if (aRank !== bRank) return aRank - bRank;
          return a.rawName.localeCompare(b.rawName);
        })
        .map(({ rawName, ...rest }: any) => rest);

      setCityItems(ordered);
    } catch (e) {
      console.error('City fetch fatal:', e);
      if (reqId === citySearchReq.current) setCityItems([]);
    } finally {
      if (reqId === citySearchReq.current) setIsSearchingCities(false);
    }
  }, []);

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
      allowsEditing: false,
    });

    if (result.canceled || !result.assets.length) return;

    const asset = result.assets[0];

    if (!asset?.uri) {
      Alert.alert('Image Error', 'Could not read selected image.');
      return;
    }

    setCropSource(asset.uri);
    setCropperOpen(true);
  };

  const handleAvatarCropped = async (croppedUri: string) => {
    try {
      setUploadingImage(true);

      const previewUri = await makePreviewUri(croppedUri);

      setImage(previewUri);
      setImagePreview(previewUri);
      setCroppedImageUri(croppedUri);

      // Important:
      // Do NOT upload to Supabase here.
      // The upload now happens only after the user presses Confirm & Enter.
      setImageUrl(null);

      setCropperOpen(false);
      setCropSource(null);

      animateStageChange('review');
    } catch (err: any) {
      console.error('Avatar crop error:', err);
      Alert.alert('Image Error', err?.message ?? 'Could not prepare image.');
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSubmit = async () => {
  console.log('✅ Confirm & Enter pressed');
  setSubmitStatus('Starting profile setup...');

  if (!allowedCreateProfileRef.current) {
    resetHardToSignIn();
    return;
  }

  if (!fullName.trim() || !mainRole || !cityId) {
    setSubmitStatus(null);
    Alert.alert('Missing Info', 'Please fill in your name, main role, and city.');
    return;
  }

  if (!croppedImageUri && !imageUrl) {
    setSubmitStatus(null);
    Alert.alert('Profile image required', 'Please add a profile image before continuing.');
    return;
  }

  setSaving(true);

  try {
    setSubmitStatus('Checking your account...');

    const { data: sessionData, error: userErr } = await withTimeout(
      supabase.auth.getUser(),
      12000
    );

    if (userErr) throw userErr;

    const user = sessionData.user;
    const userId = user?.id;

    if (!userId) {
      throw new Error('User not authenticated. Please sign in again.');
    }

    let finalAvatarUrl = imageUrl ? imageUrl.split('?')[0] : null;

    if (croppedImageUri && !finalAvatarUrl) {
      setUploadingImage(true);
      setSubmitStatus('Uploading profile image...');

      const fileName = `avatar_${Date.now()}.jpg`;
      const path = `user_${userId}/${fileName}`;

      const fileBody = await withTimeout(uriToUploadBody(croppedImageUri), 15000);

      const publicUrl = await withTimeout(
        uploadImageToBucket({
          bucket: 'avatars',
          path,
          fileBody,
          contentType: 'image/jpeg',
        }),
        20000
      );

      finalAvatarUrl = publicUrl;
      setImageUrl(`${publicUrl}?t=${Date.now()}`);
      setUploadingImage(false);
    }

    if (!finalAvatarUrl) {
      throw new Error('Could not prepare profile image.');
    }

    setSubmitStatus('Saving your profile...');

    const { data: savedProfile, error } = await withTimeout(
      supabase
        .from('users')
        .upsert(
  {
    id: userId,
    email: user.email,
    full_name: fullName.trim(),
    main_role_id: mainRole,
    city_id: cityId,
    avatar_url: finalAvatarUrl,
  },
  { onConflict: 'id' }
)
        .select('id, full_name, main_role_id, city_id, avatar_url')
        .maybeSingle(),
      20000
    );

    if (error) throw error;

    if (
      !savedProfile?.id ||
      !savedProfile?.full_name ||
      !savedProfile?.main_role_id ||
      !savedProfile?.city_id
    ) {
      throw new Error('Profile was saved but is incomplete.');
    }

    console.log('✅ Profile saved:', savedProfile);

    setSubmitStatus('Opening Overlooked...');

    G.__OVERLOOKED_PROFILE_JUST_COMPLETED__ = true;

    setProfileCompleteFromSavedProfile({
      id: savedProfile.id,
      full_name: savedProfile.full_name,
      main_role_id: savedProfile.main_role_id,
      city_id: savedProfile.city_id,
    });

    G.__OVERLOOKED_EMAIL_CONFIRM__ = false;
    G.__OVERLOOKED_RECOVERY__ = false;
    G.__OVERLOOKED_FORCE_NEW_PASSWORD__ = false;
    G.__OVERLOOKED_PASSWORD_RESET_DONE__ = false;

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.sessionStorage.removeItem('overlooked.allowCreateProfile');
    }

    setTimeout(() => {
      if (navigationRef.isReady()) {
        navigationRef.dispatch(
          CommonActions.reset({
            index: 0,
            routes: [
              {
                name: 'MainTabs',
                state: {
                  index: 0,
                  routes: [{ name: 'Featured' }],
                },
              },
            ],
          })
        );
      }
    }, 50);

    setTimeout(() => {
      refreshProfile()
        .catch((e: any) => {
          console.log('Background refreshProfile failed:', e?.message || e);
        })
        .finally(() => {
          setTimeout(() => {
            G.__OVERLOOKED_PROFILE_JUST_COMPLETED__ = false;
          }, 1500);
        });

      refreshGamification().catch((e: any) => {
        console.log('Background refreshGamification failed:', e?.message || e);
      });
    }, 300);

    showToast('Welcome to Overlooked!');
  } catch (err: any) {
    console.error('Create profile error:', err);

    const message =
      err?.message ||
      err?.error_description ||
      'Could not create profile. Please try again.';

    setSubmitStatus(`Error: ${message}`);

    Alert.alert('Error', message);
  } finally {
    setUploadingImage(false);
    setSaving(false);
  }
};
  const loading = saving || uploadingImage;
  const displayImage = imagePreview || image || imageUrl;

  const searchInputWebFix =
    Platform.OS === 'web'
      ? ({
          outlineWidth: 0,
          outlineStyle: 'none',
          boxShadow: 'none',
          borderColor: BORDER,
        } as any)
      : null;

  const roleStepVisible = ['role', 'city', 'name', 'image', 'review'].includes(stage);
  const cityStepVisible = ['city', 'name', 'image', 'review'].includes(stage);
  const nameStepVisible = ['name', 'image', 'review'].includes(stage);
  const imageStepVisible = ['image', 'review'].includes(stage);
  const reviewVisible = stage === 'review';

  const Wrapper = Platform.OS === 'web' ? View : KeyboardAvoidingView;
  const wrapperProps =
    Platform.OS === 'web'
      ? { style: styles.wrapper }
      : { behavior: 'padding' as const, style: styles.wrapper };

  if (!allowedCreateProfileRef.current) {
    return (
      <View style={styles.blockedWrapper}>
        <ActivityIndicator color={GOLD} />
      </View>
    );
  }

  return (
    <Wrapper {...wrapperProps}>
      <LinearGradient
        colors={['#000000', '#080808', '#0B0B0B']}
        style={StyleSheet.absoluteFillObject}
      />

      <ScrollView
        style={[
          styles.scrollView,
          Platform.OS === 'web'
            ? ({
                height: '100vh',
                overflowY: 'auto',
                overflowX: 'hidden',
              } as any)
            : null,
        ]}
        contentContainerStyle={[
          styles.container,
          Platform.OS === 'web' ? styles.containerWeb : styles.containerMobile,
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={true}
        scrollEnabled
        bounces={false}
        overScrollMode="always"
      >
        <Animated.View
          style={[
            styles.animatedWrap,
            {
              opacity: fadeAnim,
              transform: [{ translateY: slideAnim }, { scale: scaleAnim }],
            },
          ]}
        >
          <View style={[styles.card, !isMobile && styles.cardDesktop]}>
            <Text style={styles.eyebrow}>Join Overlooked</Text>
            <Text style={styles.title}>Create Your Profile</Text>
            <Text style={styles.subtitle}>
              Make a strong first impression. Add your image, choose your role, and start building
              your creative presence.
            </Text>

            <View style={styles.progressWrap}>
              <View style={styles.progressLine} />
              <View style={styles.progressRow}>
                <View style={styles.progressItem}>
                  <View style={[styles.progressDot, roleStepVisible && styles.progressDotActive]} />
                  <Text style={[styles.progressLabel, roleStepVisible && styles.progressLabelActive]}>
                    Role
                  </Text>
                </View>

                <View style={styles.progressItem}>
                  <View style={[styles.progressDot, cityStepVisible && styles.progressDotActive]} />
                  <Text style={[styles.progressLabel, cityStepVisible && styles.progressLabelActive]}>
                    Location
                  </Text>
                </View>

                <View style={styles.progressItem}>
                  <View style={[styles.progressDot, nameStepVisible && styles.progressDotActive]} />
                  <Text style={[styles.progressLabel, nameStepVisible && styles.progressLabelActive]}>
                    Name
                  </Text>
                </View>

                <View style={styles.progressItem}>
                  <View style={[styles.progressDot, imageStepVisible && styles.progressDotActive]} />
                  <Text
                    style={[styles.progressLabel, imageStepVisible && styles.progressLabelActive]}
                  >
                    Photo
                  </Text>
                </View>

                <View style={styles.progressItem}>
                  <View style={[styles.progressDot, reviewVisible && styles.progressDotActive]} />
                  <Text style={[styles.progressLabel, reviewVisible && styles.progressLabelActive]}>
                    Confirm
                  </Text>
                </View>
              </View>
            </View>

            <View style={styles.sequenceArea}>
              {roleStepVisible && (
                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>Main Role</Text>
                  <TouchableOpacity
                    style={[styles.selectButton, stage === 'role' && styles.activeSelectButton]}
                    onPress={openRoleSelector}
                    activeOpacity={0.9}
                    disabled={loading}
                  >
                    <Text style={styles.selectButtonText}>
                      {mainRoleLabel ?? 'Search your main creative role'}
                    </Text>
                    <Ionicons name="search" size={16} color={TEXT_MUTED} />
                  </TouchableOpacity>
                </View>
              )}

              {cityStepVisible && (
                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>City</Text>
                  <TouchableOpacity
                    style={[styles.selectButton, stage === 'city' && styles.activeSelectButton]}
                    onPress={openCitySelector}
                    activeOpacity={0.9}
                    disabled={loading}
                  >
                    <Text style={styles.selectButtonText}>
                      {cityLabel ?? 'Search for your city'}
                    </Text>
                    <Ionicons name="location-outline" size={16} color={TEXT_MUTED} />
                  </TouchableOpacity>
                </View>
              )}

              {nameStepVisible && (
                <View style={styles.fieldBlock}>
                  <Text style={styles.fieldLabel}>Name</Text>
                  <TextInput
                    placeholder="Your full name"
                    value={fullName}
                    onChangeText={setFullName}
                    style={[styles.input, searchInputWebFix]}
                    placeholderTextColor={TEXT_MUTED}
                    autoFocus={stage === 'name'}
                    editable={!loading}
                    onSubmitEditing={() => {
                      if (fullName.trim().length >= 2 && stage === 'name') {
                        animateStageChange('image');
                      }
                    }}
                  />

                  {stage === 'name' && (
                    <TouchableOpacity
                      onPress={() => {
                        if (!fullName.trim()) {
                          Alert.alert('Missing Info', 'Please enter your name.');
                          return;
                        }
                        animateStageChange('image');
                      }}
                      style={styles.inlineContinueButton}
                      activeOpacity={0.9}
                    >
                      <Text style={styles.inlineContinueButtonText}>Continue</Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {imageStepVisible && (
                <Animated.View
                  style={[
                    styles.heroAvatarWrap,
                    {
                      opacity: imageSectionOpacity,
                      transform: [{ translateY: imageSectionTranslate }],
                    },
                  ]}
                >
                  <TouchableOpacity
                    onPress={pickImage}
                    activeOpacity={0.92}
                    style={[
                      styles.avatarButton,
                      stage === 'image' && styles.avatarButtonActive,
                      isMobile && styles.avatarButtonMobile,
                    ]}
                    disabled={loading}
                  >
                    {displayImage ? (
                      <Image
                        source={{ uri: displayImage }}
                        style={styles.avatarImage}
                        resizeMode="cover"
                      />
                    ) : (
                      <View style={styles.avatarFallback}>
                        <Ionicons name="camera-outline" size={30} color={GOLD} />
                        <Text style={styles.avatarFallbackText}>Add Profile Image</Text>
                      </View>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={pickImage}
                    style={[styles.avatarChangeBtn, isMobile && styles.avatarChangeBtnMobile]}
                    activeOpacity={0.88}
                    disabled={loading}
                  >
                    {uploadingImage ? (
                      <ActivityIndicator color="#000" size="small" />
                    ) : (
                      <Text style={styles.avatarChangeBtnText}>
                        {displayImage ? 'Change Profile Image' : 'Upload Profile Image'}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <Text style={styles.requiredLabel}>Required</Text>

                  {!!uploadingImage && (
                    <Text style={styles.uploadingText}>Preparing your profile image...</Text>
                  )}

                  {stage === 'image' && displayImage && !uploadingImage && (
                    <TouchableOpacity
                      onPress={() => animateStageChange('review')}
                      style={styles.inlineContinueButton}
                      activeOpacity={0.9}
                    >
                      <Text style={styles.inlineContinueButtonText}>Continue</Text>
                    </TouchableOpacity>
                  )}
                </Animated.View>
              )}

              {reviewVisible && (
                <>
                  <View style={styles.reviewCard}>
                    <Text style={styles.reviewTitle}>Confirm your profile</Text>

                    {!!displayImage && (
                      <View style={styles.reviewAvatarWrap}>
                        <Image
                          source={{ uri: displayImage }}
                          style={styles.reviewAvatar}
                          resizeMode="cover"
                        />
                      </View>
                    )}

                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Name</Text>
                      <Text style={styles.reviewValue}>{fullName || '—'}</Text>
                    </View>

                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Role</Text>
                      <Text style={styles.reviewValue}>{mainRoleLabel || '—'}</Text>
                    </View>

                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Location</Text>
                      <Text style={styles.reviewValue}>{cityLabel || '—'}</Text>
                    </View>
                  </View>

                  <View style={styles.infoBox}>
                    <Text style={styles.infoBoxTitle}>Showreels and portfolio</Text>
                    <Text style={styles.infoBoxText}>
                      You can add showreels, thumbnails, and more portfolio content once your
                      account is created from your Profile page.
                    </Text>
                  </View>

                  <View style={styles.reviewActions}>
  <TouchableOpacity
    onPress={() => animateStageChange('image')}
    style={styles.backButton}
    activeOpacity={0.9}
    disabled={loading}
  >
    <Text style={styles.backButtonText}>Back</Text>
  </TouchableOpacity>

  <TouchableOpacity
    onPress={handleSubmit}
    style={[
      styles.submitButton,
      styles.submitButtonReview,
      loading && { opacity: 0.6 },
    ]}
    disabled={loading}
    activeOpacity={0.9}
  >
    {loading ? (
      <ActivityIndicator color="#000" />
    ) : (
      <Text style={styles.submitText}>Confirm & Enter</Text>
    )}
  </TouchableOpacity>
</View>

{!!submitStatus && (
  <Text style={styles.submitStatusText}>{submitStatus}</Text>
)}
                </>
              )}
            </View>
          </View>
        </Animated.View>
      </ScrollView>

      <Modal
        visible={citySearchModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setCitySearchModalVisible(false)}
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
                        setSelectedCountryCode(item.country || null);
                        setCitySearchModalVisible(false);

                        if (stage === 'city') {
                          animateStageChange('name');
                        }
                      }}
                      activeOpacity={0.8}
                    >
                      <Text style={styles.listItemText}>{item.label}</Text>
                    </TouchableOpacity>
                  )}
                  ListEmptyComponent={
                    <Text style={styles.emptyText}>
                      No cities found yet. Try a broader search like “Rome” or “Lon”.
                    </Text>
                  }
                />
              )}
            </View>

            <TouchableOpacity
              onPress={() => setCitySearchModalVisible(false)}
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
                  data={roleSearchTerm.trim().length > 0 ? roleSearchItems : roleItems}
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

                        if (stage === 'role') {
                          animateStageChange('city', () => {
                            setTimeout(() => {
                              openCitySelector();
                            }, 700);
                          });
                        }
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
        fullName={fullName || 'Your Name'}
        mainRoleName={mainRoleLabel || 'Director'}
        cityName={cityLabel || 'Your City'}
        level={50}
      />
    </Wrapper>
  );
}

const styles = StyleSheet.create({
  blockedWrapper: {
    flex: 1,
    backgroundColor: DARK_BG,
    justifyContent: 'center',
    alignItems: 'center',
  },

  wrapper: {
    flex: 1,
    backgroundColor: DARK_BG,
  },

  scrollView: {
    flex: 1,
    width: '100%',
  },

  container: {
    flexGrow: 1,
    paddingHorizontal: 18,
    alignItems: 'center',
    backgroundColor: DARK_BG,
  },

  containerWeb: {
    justifyContent: 'flex-start',
    paddingTop: 32,
    paddingBottom: 80,
  },

  containerMobile: {
    justifyContent: 'center',
    paddingTop: 18,
    paddingBottom: 18,
  },

  animatedWrap: {
    width: '100%',
    maxWidth: 620,
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
    marginBottom: 18,
    fontFamily: SYSTEM_SANS,
  },

  progressWrap: {
    marginBottom: 20,
    position: 'relative',
  },

  progressLine: {
    position: 'absolute',
    left: '10%',
    right: '10%',
    top: 5,
    height: 1,
    backgroundColor: BORDER_SOFT,
  },

  progressRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },

  progressItem: {
    alignItems: 'center',
    minWidth: 50,
  },

  progressDot: {
    width: 10,
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.18)',
    marginBottom: 8,
  },

  progressDotActive: {
    backgroundColor: GOLD,
  },

  progressLabel: {
    color: TEXT_MUTED,
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  progressLabelActive: {
    color: TEXT_IVORY,
  },

  sequenceArea: {
    minHeight: 340,
    justifyContent: 'flex-start',
  },

  heroAvatarWrap: {
    alignItems: 'center',
    marginBottom: 20,
    paddingTop: 6,
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
  },

  avatarButtonMobile: {
    width: 146,
    height: 146,
    borderRadius: 73,
    shadowColor: GOLD,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },

  avatarButtonActive: {
    borderColor: GOLD,
    shadowColor: GOLD,
    shadowOpacity: 0.18,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 4 },
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
    marginTop: 14,
    backgroundColor: GOLD,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
    minWidth: 188,
  },

  avatarChangeBtnMobile: {
    marginTop: 16,
    paddingVertical: 12,
    paddingHorizontal: 22,
    minWidth: 210,
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
    marginTop: 12,
    color: GOLD,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
  },

  uploadingText: {
    marginTop: 10,
    color: TEXT_MUTED,
    fontSize: 13,
    fontFamily: SYSTEM_SANS,
    textAlign: 'center',
  },

  fieldBlock: {
    marginBottom: 16,
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

  activeSelectButton: {
    borderColor: GOLD,
    shadowColor: GOLD,
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
  },
submitStatusText: {
  marginTop: 10,
  color: TEXT_MUTED,
  fontSize: 12,
  lineHeight: 17,
  textAlign: 'center',
  fontFamily: SYSTEM_SANS,
},
  selectButtonText: {
    color: TEXT_IVORY,
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
    flex: 1,
    paddingRight: 12,
  },

  inlineContinueButton: {
    marginTop: 12,
    alignSelf: 'flex-end',
    backgroundColor: GOLD,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },

  inlineContinueButtonText: {
    color: '#000',
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  reviewCard: {
    marginTop: 4,
    marginBottom: 16,
    backgroundColor: ELEVATED,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
  },

  reviewTitle: {
    color: TEXT_IVORY,
    fontSize: 18,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
    marginBottom: 14,
    textAlign: 'center',
  },

  reviewAvatarWrap: {
    width: 110,
    height: 110,
    borderRadius: 55,
    overflow: 'hidden',
    marginBottom: 18,
    borderWidth: 1.5,
    borderColor: GOLD,
    backgroundColor: '#151515',
  },

  reviewAvatar: {
    width: '100%',
    height: '100%',
  },

  reviewRow: {
    width: '100%',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: BORDER_SOFT,
  },

  reviewLabel: {
    color: GOLD,
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    marginBottom: 4,
  },

  reviewValue: {
    color: TEXT_IVORY,
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  infoBox: {
    marginTop: 4,
    marginBottom: 18,
    backgroundColor: ELEVATED,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 16,
    paddingHorizontal: 16,
  },

  infoBoxTitle: {
    color: GOLD,
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1.3,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    marginBottom: 8,
  },

  infoBoxText: {
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: SYSTEM_SANS,
  },

  reviewActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  backButton: {
    flex: 1,
    backgroundColor: ELEVATED,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
  },

  backButtonText: {
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 15,
    letterSpacing: 0.4,
  },

  submitButton: {
    backgroundColor: GOLD,
    width: '100%',
    paddingVertical: 15,
    borderRadius: 16,
    alignItems: 'center',
    marginTop: 4,
  },

  submitButtonReview: {
    flex: 1.6,
    marginTop: 0,
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
    lineHeight: 18,
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