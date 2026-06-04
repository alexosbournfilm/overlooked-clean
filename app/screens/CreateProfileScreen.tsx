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
const DARK_BG = '#FFF5EC';
const CARD = 'rgba(255,252,246,0.96)';
const ELEVATED = '#FFFDF8';
const TEXT_IVORY = '#241817';
const TEXT_MUTED = '#846E66';
const BORDER = 'rgba(125,74,63,0.16)';
const BORDER_SOFT = 'rgba(125,74,63,0.10)';
const GOLD = '#D8A84E';
const CORAL = '#F45B6A';
const CORAL_DARK = '#D94C5C';

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

type OnboardingStage = 'profile' | 'role' | 'city' | 'links' | 'reasons' | 'goals' | 'review';

type OnboardingStepMeta = {
  key: OnboardingStage;
  label: string;
  title: string;
  subtitle: string;
};

const ONBOARDING_STEPS: OnboardingStepMeta[] = [
  {
    key: 'profile',
    label: 'Profile',
    title: 'Let people recognise you',
    subtitle: 'Start with your name and a profile picture that feels like you.',
  },
  {
    key: 'role',
    label: 'Roles',
    title: 'What do you create?',
    subtitle: 'Choose your main creative role, then add any side roles you want people to know.',
  },
  {
    key: 'city',
    label: 'Place',
    title: 'Where are you based?',
    subtitle: 'Your city helps Overlooked surface local creatives, projects, and jobs.',
  },
  {
    key: 'links',
    label: 'Links',
    title: 'Add a link if you have one',
    subtitle: 'A portfolio or YouTube link is optional. You can always add showreels later.',
  },
  {
    key: 'reasons',
    label: 'Why',
    title: 'Why are you joining Overlooked?',
    subtitle: 'Pick as many as fit. This helps shape your feed and suggestions.',
  },
  {
    key: 'goals',
    label: 'Goals',
    title: 'What are your creative goals?',
    subtitle: 'Choose the goals you want Overlooked to quietly keep you moving toward.',
  },
  {
    key: 'review',
    label: 'Finish',
    title: 'Ready to begin',
    subtitle: 'Check the basics, then step into Overlooked.',
  },
];

const JOINING_REASON_OPTIONS = [
  'Improve my filmmaking craft',
  'Practise acting',
  'Build confidence on camera',
  'Share my creative work',
  'Meet other creatives nearby',
  'Find actors for my films',
  'Find filmmakers to collaborate with',
  'Join local creative projects',
  'Get feedback on my work',
  'Build a portfolio',
  'Enter monthly film challenges',
  'Find paid creative work',
  'Find unpaid passion projects',
  'Grow my audience',
  'Learn from other creatives',
  'Stay consistent creatively',
  'Make short films regularly',
  'Practise writing scripts',
  'Practise directing',
  'Practise cinematography',
  'Practise editing',
  'Practise producing',
  'Build a creative network',
  'Be discovered for opportunities',
  'Support other creatives',
  'Collaborate with people in my city',
];

const CREATIVE_GOAL_OPTIONS = [
  'Make 1 film per month',
  'Make 2 films per month',
  'Make 3 films per month',
  'Submit to every monthly Overlooked challenge',
  'Practise 1 acting monologue per week',
  'Practise 3 monologues per week',
  'Write 1 short script per month',
  'Film 1 scene per week',
  'Meet 1 new creative per month',
  'Collaborate with a local team',
  'Build a complete acting showreel',
  'Build a filmmaking portfolio',
  'Get my first paid creative job',
  'Get more acting experience',
  'Direct my first short film',
  'Produce my first short film',
  'Improve my editing skills',
  'Improve my camera skills',
  'Improve my screenwriting',
  'Improve my directing',
  'Grow my confidence',
  'Post my work consistently',
  'Get feedback every month',
  'Join or create a local film group',
  'Build a long-term creative team',
  'Prepare for auditions',
  'Become more disciplined creatively',
];

const DEFAULT_NOTIFICATION_PREFERENCES = {
  direct_messages: true,
  group_messages: true,
  followed_submissions: true,
  submission_comments: true,
  submission_votes: true,
  city_jobs: true,
  city_creatives: true,
  job_applications: true,
  comment_replies: true,
  challenge_reminders: true,
  challenge_results: true,
};

const G = globalThis as any;

function resetHardToSignIn() {
  console.log('🚫 CreateProfile wanted to reset to SignIn, but hard reset is disabled here.');

  /**
   * IMPORTANT:
   * Do NOT clear create-profile flags here.
   * Do NOT sign out here.
   * Do NOT navigation.reset here.
   *
   * AppNavigator/AuthProvider are responsible for invalid-session routing.
   * CreateProfileScreen should not kick users out while auth is still settling.
   */
}

function createProfileIsAllowedByFlow() {
  if (
    G.__OVERLOOKED_EMAIL_CONFIRM__ === true ||
    G.__OVERLOOKED_MANUAL_SIGN_IN__ === true ||
    G.__OVERLOOKED_CREATE_PROFILE_ALLOWED__ === true
  ) {
    return true;
  }

  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    return (
      window.sessionStorage.getItem('overlooked.allowCreateProfile') === 'true' ||
      window.sessionStorage.getItem('overlooked.manualSignIn') === 'true' ||
      window.sessionStorage.getItem('overlooked.createProfileAllowed') === 'true'
    );
  }

  return false;
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
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
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

const OPTIONAL_PROFILE_COLUMNS = new Set([
  'side_roles',
  'portfolio_url',
  'youtube_url',
  'joining_reasons',
  'creative_goals',
  'notification_preferences',
]);

function extractMissingColumnName(message: string) {
  const m1 = message.match(/could\s+not\s+find\s+the\s+'([^']+)'\s+column/i);
  if (m1?.[1]) return m1[1];

  const m2 = message.match(/column\s+"([^"]+)"/i);
  if (m2?.[1]) return m2[1];

  const m3 = message.match(/column\s+([a-zA-Z0-9_]+\.[a-zA-Z0-9_]+)\s+does\s+not\s+exist/i);
  if (m3?.[1]) return m3[1].split('.').pop() || null;

  return null;
}

async function upsertProfileRobust(payload: Record<string, any>) {
  let working = { ...payload };

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const result = await withTimeout(
      supabase
        .from('users')
        .upsert(working, { onConflict: 'id' })
        .select('id, full_name, main_role_id, city_id, avatar_url')
        .maybeSingle(),
      20000
    );

    if (!result.error) return result;

    const message = String(result.error.message || '');
    const missingColumn = extractMissingColumnName(message);

    if (!missingColumn || !OPTIONAL_PROFILE_COLUMNS.has(missingColumn)) {
      return result;
    }

    if (Object.prototype.hasOwnProperty.call(working, missingColumn)) {
      delete working[missingColumn];
      continue;
    }

    return result;
  }

  throw new Error('Could not save profile after retrying optional onboarding fields.');
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

  /**
   * Mobile can display local file URIs directly.
   */
  if (Platform.OS !== 'web') {
    return uri;
  }

  /**
   * Web fix:
   * If AvatarCropper already gives us a base64/data image, use it directly.
   */
  if (uri.startsWith('data:image')) {
    return uri;
  }

  /**
   * Web fix:
   * Convert blob/object URLs into a stable base64 preview.
   * This makes the profile image show immediately on the review screen,
   * before the Supabase upload happens.
   */
  try {
    const response = await fetch(uri);

    if (!response.ok) {
      console.log('Preview fetch failed, falling back to original URI.');
      return uri;
    }

    const blob = await response.blob();

    return await new Promise<string>((resolve) => {
      const reader = new FileReader();

      reader.onloadend = () => {
        const result = String(reader.result || uri);
        resolve(result);
      };

      reader.onerror = () => {
        console.log('Preview FileReader failed, falling back to original URI.');
        resolve(uri);
      };

      reader.readAsDataURL(blob);
    });
  } catch (err) {
    console.log('makePreviewUri web fallback:', err);
    return uri;
  }
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
const ProfilePreviewImage = ({
  uri,
  style,
}: {
  uri: string;
  style: any;
}) => {
  if (Platform.OS === 'web') {
    return React.createElement('img', {
      src: uri,
      style: {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        display: 'block',
      },
      onError: (e: any) => {
        console.log('Web profile preview image failed:', e);
      },
    });
  }

  return (
    <Image
      key={uri}
      source={{ uri }}
      style={style}
      resizeMode="cover"
      onError={(e) => {
        console.log('Native profile preview image failed:', e?.nativeEvent);
      }}
    />
  );
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

  const [stage, setStage] = useState<OnboardingStage>('profile');

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
  const [sideRoles, setSideRoles] = useState<string[]>([]);

  const [cityId, setCityId] = useState<number | null>(null);
  const [cityLabel, setCityLabel] = useState<string | null>(null);
  const [selectedCountryCode, setSelectedCountryCode] = useState<string | null>(null);
  const [portfolioUrl, setPortfolioUrl] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [joiningReasons, setJoiningReasons] = useState<string[]>([]);
  const [creativeGoals, setCreativeGoals] = useState<string[]>([]);

  const [roleSearchModalVisible, setRoleSearchModalVisible] = useState(false);
  const [roleSearchTerm, setRoleSearchTerm] = useState('');
  const [roleItems, setRoleItems] = useState<DropdownOption[]>([]);
const [roleSearchItems, setRoleSearchItems] = useState<DropdownOption[]>([]);
const [isLoadingRoles, setIsLoadingRoles] = useState(false);
const [isSearchingRoles, setIsSearchingRoles] = useState(false);
const [roleLoadError, setRoleLoadError] = useState<string | null>(null);

  const [citySearchModalVisible, setCitySearchModalVisible] = useState(false);
  const [citySearchTerm, setCitySearchTerm] = useState('');
  const [cityItems, setCityItems] = useState<DropdownOption[]>([]);
  const [isSearchingCities, setIsSearchingCities] = useState(false);

  const [saving, setSaving] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<string | null>(null);

  useEffect(() => {
  let mounted = true;

  const checkSession = async () => {
    /**
     * CreateProfile should only be entered through allowed flows.
     * But do not kick the user out from this screen.
     * AppNavigator handles invalid routes.
     */
    if (!createProfileIsAllowedByFlow()) {
      console.log('⚠️ CreateProfile opened without allowed flag. Waiting, not resetting.');
    }

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      const { data, error } = await supabase.auth.getUser();

      if (!mounted) return;

      const user = data?.user ?? null;

      if (user?.id) {
        console.log('✅ CreateProfile authenticated user found:', user.id);
        allowedCreateProfileRef.current = true;
        return;
      }

      console.log(
        `⏳ CreateProfile waiting for auth session... attempt ${attempt}`,
        error?.message || ''
      );

      await new Promise((resolve) => setTimeout(resolve, 500));
    }

    /**
     * Still do NOT reset here.
     * Show blocked/loading state if needed, but don't navigate away.
     */
    if (!mounted) return;

    console.log('⚠️ CreateProfile could not find user after retry. Staying put.');
    allowedCreateProfileRef.current = true;
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

    if (stage === 'profile' || stage === 'review') {
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
  setRoleLoadError(null);
  setIsSearchingRoles(false);
  setRoleSearchModalVisible(true);

  // Important on mobile:
  // If the first role fetch failed or returned empty, retry when the modal opens.
  if (roleItems.length === 0) {
    fetchCreativeRoles();
  }
};

  const openCitySelector = () => {
    setCitySearchTerm('');
    setCityItems([]);
    setIsSearchingCities(false);
    setCitySearchModalVisible(true);
  };

  const fetchCreativeRoles = async () => {
  if (isLoadingRoles) return;

  setIsLoadingRoles(true);
  setRoleLoadError(null);

  let lastError: any = null;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const { data, error } = await withTimeout(
        supabase
          .from('creative_roles')
          .select('id, name')
          .order('name', { ascending: true }),
        9000
      );

      if (error) throw error;

      const mapped = (data || [])
        .filter((r: any) => r?.id && r?.name)
        .map((r: any) => ({
          label: r.name,
          value: r.id,
        }));

      setRoleItems(mapped);
      setRoleSearchItems(mapped);
      setRoleLoadError(null);
      setIsLoadingRoles(false);
      return;
    } catch (err: any) {
      lastError = err;
      console.log(`Role load attempt ${attempt} failed:`, err?.message || err);
      await sleep(700);
    }
  }

  setIsLoadingRoles(false);
  setRoleItems([]);
  setRoleSearchItems([]);
  setRoleLoadError(
    lastError?.message || 'Could not load roles. Please check your connection and try again.'
  );
};

  const fetchSearchRoles = useCallback(
  async (text: string) => {
    const q = text.trim();
    const reqId = ++roleSearchReq.current;

    if (!q) {
      setRoleSearchItems(roleItems);
      setIsSearchingRoles(false);
      setRoleLoadError(null);
      return;
    }

    /**
     * Mobile reliability fix:
     * Search the roles already loaded into memory first.
     * This means the dropdown responds instantly and does not depend
     * on a fresh Supabase request for every typed letter.
     */
    const localMatches = roleItems
      .filter((item) => normalizeText(item.label).includes(normalizeText(q)))
      .sort((a, b) => {
        const aRank = rankMatch(a.label, q);
        const bRank = rankMatch(b.label, q);

        if (aRank !== bRank) return aRank - bRank;
        return a.label.localeCompare(b.label);
      });

    setRoleSearchItems(localMatches);

    if (localMatches.length > 0) {
      setIsSearchingRoles(false);
      setRoleLoadError(null);
      return;
    }

    /**
     * Backup search:
     * Only ask Supabase if the local list has no matches.
     */
    setIsSearchingRoles(true);
    setRoleLoadError(null);

    try {
      const { data, error } = await withTimeout(
        supabase
          .from('creative_roles')
          .select('id, name')
          .ilike('name', `%${q}%`)
          .order('name', { ascending: true })
          .limit(100),
        9000
      );

      if (reqId !== roleSearchReq.current) return;

      if (error) throw error;

      const mapped = (data || [])
        .filter((r: any) => r?.id && r?.name)
        .map((r: any) => ({
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
    } catch (e: any) {
      console.error('Role fetch fatal:', e?.message || e);

      if (reqId === roleSearchReq.current) {
        setRoleLoadError(e?.message || 'Role search is taking too long. Please try again.');
        setRoleSearchItems([]);
      }
    } finally {
      if (reqId === roleSearchReq.current) {
        setIsSearchingRoles(false);
      }
    }
  },
  [roleItems]
);

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

    /**
     * Web/mobile preview fix:
     * Set the raw cropped URI immediately so the review screen has
     * something to show straight away.
     */
    setImage(croppedUri);
    setImagePreview(croppedUri);
    setCroppedImageUri(croppedUri);
    setImageUrl(null);

    setCropperOpen(false);
    setCropSource(null);

    /**
     * Then prepare the safest preview version.
     * On web this becomes a stable base64 image.
     * On mobile it stays as the local file URI.
     */
    const previewUri = await makePreviewUri(croppedUri);

    setImage(previewUri);
    setImagePreview(previewUri);

    /**
     * Stay on the current onboarding step. The wizard controls the journey.
     */
  } catch (err: any) {
    console.error('Avatar crop error:', err);

    /**
     * Final fallback:
     * Even if preview conversion fails, still allow the user to see/use
     * the original cropped image URI.
     */
    if (croppedUri) {
      setImage(croppedUri);
      setImagePreview(croppedUri);
      setCroppedImageUri(croppedUri);
      setImageUrl(null);
      setCropperOpen(false);
      setCropSource(null);
      return;
    }

    Alert.alert('Image Error', err?.message ?? 'Could not prepare image.');
  } finally {
    setUploadingImage(false);
  }
};

  const currentStepIndex = Math.max(
    0,
    ONBOARDING_STEPS.findIndex((item) => item.key === stage)
  );
  const currentStep = ONBOARDING_STEPS[currentStepIndex] ?? ONBOARDING_STEPS[0];
  const isFirstStep = currentStepIndex === 0;
  const isLastStep = currentStepIndex === ONBOARDING_STEPS.length - 1;

  const sideRoleOptions = roleItems
    .filter((item) => item.value !== mainRole)
    .slice(0, 18)
    .map((item) => item.label);

  const toggleSelection = (
    value: string,
    setter: React.Dispatch<React.SetStateAction<string[]>>
  ) => {
    setter((prev) =>
      prev.includes(value) ? prev.filter((item) => item !== value) : [...prev, value]
    );
  };

  const validateStage = () => {
    if (stage === 'profile') {
      if (!fullName.trim()) {
        Alert.alert('Missing name', 'Please add your name so people know who they are meeting.');
        return false;
      }

      if (!croppedImageUri && !imageUrl && !imagePreview && !image) {
        Alert.alert('Profile image required', 'Please add a profile image before continuing.');
        return false;
      }
    }

    if (stage === 'role' && !mainRole) {
      Alert.alert('Choose your role', 'Please choose your main creative role.');
      return false;
    }

    if (stage === 'city' && !cityId) {
      Alert.alert('Choose your city', 'Please choose your city or nearest creative base.');
      return false;
    }

    return true;
  };

  const goToStep = (index: number) => {
    const next = ONBOARDING_STEPS[index];
    if (!next || next.key === stage) return;
    animateStageChange(next.key);
  };

  const goBack = () => {
    if (isFirstStep || saving || uploadingImage) return;
    goToStep(currentStepIndex - 1);
  };

  const goNext = () => {
    if (saving || uploadingImage) return;
    if (!validateStage()) return;

    if (isLastStep) {
      void handleSubmit();
      return;
    }

    goToStep(currentStepIndex + 1);
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

let sessionUser: any = null;
let lastAuthError: any = null;

for (let attempt = 1; attempt <= 10; attempt += 1) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();

  if (sessionError) {
    lastAuthError = sessionError;
  }

  if (sessionData?.session?.user?.id) {
    sessionUser = sessionData.session.user;
    break;
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError) {
    lastAuthError = userError;
  }

  if (userData?.user?.id) {
    sessionUser = userData.user;
    break;
  }

  setSubmitStatus(`Checking your account... ${attempt}/10`);
  await new Promise((resolve) => setTimeout(resolve, 500));
}

const user = sessionUser;
const userId = user?.id;

if (!userId) {
  console.log('CreateProfile submit auth missing:', lastAuthError?.message || lastAuthError);

  setSubmitStatus(
    'Your account session is still loading. Please wait a moment, then press Confirm & Enter again.'
  );

  Alert.alert(
    'Session still loading',
    'Your account is not fully ready yet. Please wait a few seconds, then press Confirm & Enter again.'
  );

  /**
   * Important:
   * Do NOT clear create-profile flags here.
   * Do NOT send the user back to Sign In here.
   * This was causing the broken flow on web.
   */
  return;
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

    const cleanPortfolioUrl = portfolioUrl.trim();
    const cleanYoutubeUrl = youtubeUrl.trim();

    const { data: savedProfile, error } = await upsertProfileRobust({
      id: userId,
      email: user.email ?? '',
      full_name: fullName.trim(),
      main_role_id: mainRole,
      city_id: cityId,
      avatar_url: finalAvatarUrl,
      side_roles: sideRoles.length ? sideRoles : null,
      portfolio_url: cleanPortfolioUrl || null,
      youtube_url: cleanYoutubeUrl || null,
      joining_reasons: joiningReasons,
      creative_goals: creativeGoals,
      notification_preferences: DEFAULT_NOTIFICATION_PREFERENCES,
    });

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
G.__OVERLOOKED_MANUAL_SIGN_IN__ = false;
G.__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;

if (Platform.OS === 'web' && typeof window !== 'undefined') {
  window.sessionStorage.removeItem('overlooked.allowCreateProfile');
  window.sessionStorage.removeItem('overlooked.manualSignIn');
  window.sessionStorage.removeItem('overlooked.createProfileAllowed');
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

  const Wrapper = Platform.OS === 'web' ? View : KeyboardAvoidingView;
  const wrapperProps =
    Platform.OS === 'web'
      ? { style: styles.wrapper }
      : { behavior: 'padding' as const, style: styles.wrapper };

  // Do not block-render CreateProfile during auth settling.
// AppNavigator is responsible for invalid routing.

  return (
    <Wrapper {...wrapperProps}>
      <LinearGradient
        colors={['#FFF6EF', '#FDE7DE', '#FFFDF8']}
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
            <Text style={styles.title}>{currentStep.title}</Text>
            <Text style={styles.subtitle}>{currentStep.subtitle}</Text>

            <View style={styles.progressWrap}>
              <Text style={styles.progressCount}>
                Step {currentStepIndex + 1} of {ONBOARDING_STEPS.length}
              </Text>
              <View style={styles.progressSegments}>
                {ONBOARDING_STEPS.map((item, index) => (
                  <View
                    key={item.key}
                    style={[
                      styles.progressSegment,
                      index <= currentStepIndex && styles.progressSegmentActive,
                    ]}
                  />
                ))}
              </View>
              <View style={styles.progressLabelRow}>
                <Text style={styles.progressLabelActive}>{currentStep.label}</Text>
                <Text style={styles.progressLabel}>{ONBOARDING_STEPS[currentStepIndex + 1]?.label ?? 'Done'}</Text>
              </View>
            </View>

            <View style={styles.sequenceArea}>
              {stage === 'profile' && (
                <>
                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Name</Text>
                    <TextInput
                      placeholder="Your full name"
                      value={fullName}
                      onChangeText={setFullName}
                      style={[styles.input, searchInputWebFix]}
                      placeholderTextColor={TEXT_MUTED}
                      autoFocus
                      editable={!loading}
                      returnKeyType="next"
                    />
                  </View>

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
    styles.avatarButtonActive,
    isMobile && styles.avatarButtonMobile,
  ]}
  disabled={loading}
>
  {displayImage ? (
    <ProfilePreviewImage
      uri={displayImage}
      style={styles.avatarImage}
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
                </Animated.View>
                </>
              )}

              {stage === 'role' && (
                <>
                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Main creative role</Text>
                    <TouchableOpacity
                      style={[styles.selectButton, styles.activeSelectButton]}
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

                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Optional side roles</Text>
                    <View style={styles.chipGrid}>
                      {sideRoleOptions.map((role) => {
                        const selected = sideRoles.includes(role);
                        return (
                          <TouchableOpacity
                            key={role}
                            onPress={() => toggleSelection(role, setSideRoles)}
                            style={[styles.choicePill, selected && styles.choicePillSelected]}
                            activeOpacity={0.86}
                            disabled={loading}
                          >
                            <Ionicons
                              name={selected ? 'checkmark-circle' : 'add-circle-outline'}
                              size={16}
                              color={selected ? CORAL : TEXT_MUTED}
                            />
                            <Text
                              style={[
                                styles.choicePillText,
                                selected && styles.choicePillTextSelected,
                              ]}
                            >
                              {role}
                            </Text>
                          </TouchableOpacity>
                        );
                      })}
                    </View>
                    {!sideRoleOptions.length ? (
                      <Text style={styles.helperText}>Roles are loading. You can skip this for now.</Text>
                    ) : null}
                  </View>
                </>
              )}

              {stage === 'city' && (
                <>
                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>City / country</Text>
                    <TouchableOpacity
                      style={[styles.selectButton, styles.activeSelectButton]}
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

                  <View style={styles.infoBox}>
                    <Text style={styles.infoBoxTitle}>Local discovery</Text>
                    <Text style={styles.infoBoxText}>
                      Your location helps Overlooked recommend nearby creatives, local projects,
                      city jobs, and useful collaborations.
                    </Text>
                  </View>
                </>
              )}

              {stage === 'links' && (
                <>
                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>Portfolio link</Text>
                    <TextInput
                      placeholder="https://your-portfolio.com"
                      value={portfolioUrl}
                      onChangeText={setPortfolioUrl}
                      style={[styles.input, searchInputWebFix]}
                      placeholderTextColor={TEXT_MUTED}
                      editable={!loading}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                    />
                  </View>

                  <View style={styles.fieldBlock}>
                    <Text style={styles.fieldLabel}>YouTube link</Text>
                    <TextInput
                      placeholder="https://youtube.com/@yourchannel"
                      value={youtubeUrl}
                      onChangeText={setYoutubeUrl}
                      style={[styles.input, searchInputWebFix]}
                      placeholderTextColor={TEXT_MUTED}
                      editable={!loading}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="url"
                    />
                  </View>
                </>
              )}

              {stage === 'reasons' && (
                <View style={styles.multiSelectWrap}>
                  {JOINING_REASON_OPTIONS.map((reason) => {
                    const selected = joiningReasons.includes(reason);
                    return (
                      <TouchableOpacity
                        key={reason}
                        onPress={() => toggleSelection(reason, setJoiningReasons)}
                        style={[styles.optionCard, selected && styles.optionCardSelected]}
                        activeOpacity={0.88}
                        disabled={loading}
                      >
                        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                          {selected ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                        </View>
                        <Text
                          style={[
                            styles.optionCardText,
                            selected && styles.optionCardTextSelected,
                          ]}
                        >
                          {reason}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {stage === 'goals' && (
                <View style={styles.multiSelectWrap}>
                  {CREATIVE_GOAL_OPTIONS.map((goal) => {
                    const selected = creativeGoals.includes(goal);
                    return (
                      <TouchableOpacity
                        key={goal}
                        onPress={() => toggleSelection(goal, setCreativeGoals)}
                        style={[styles.optionCard, selected && styles.optionCardSelected]}
                        activeOpacity={0.88}
                        disabled={loading}
                      >
                        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
                          {selected ? <Ionicons name="checkmark" size={14} color="#fff" /> : null}
                        </View>
                        <Text
                          style={[
                            styles.optionCardText,
                            selected && styles.optionCardTextSelected,
                          ]}
                        >
                          {goal}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              )}

              {stage === 'review' && (
                <>
                  <View style={styles.reviewCard}>
                    <Text style={styles.reviewTitle}>Confirm your profile</Text>

                    {!!displayImage && (
                      <View style={styles.reviewAvatarWrap}>
                        <ProfilePreviewImage uri={displayImage} style={styles.reviewAvatar} />
                      </View>
                    )}

                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Name</Text>
                      <Text style={styles.reviewValue}>{fullName || '-'}</Text>
                    </View>

                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Main role</Text>
                      <Text style={styles.reviewValue}>{mainRoleLabel || '-'}</Text>
                    </View>

                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Side roles</Text>
                      <Text style={styles.reviewValue}>
                        {sideRoles.length ? sideRoles.join(', ') : 'Not added'}
                      </Text>
                    </View>

                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Location</Text>
                      <Text style={styles.reviewValue}>{cityLabel || '-'}</Text>
                    </View>

                    <View style={styles.reviewRow}>
                      <Text style={styles.reviewLabel}>Setup choices</Text>
                      <Text style={styles.reviewValue}>
                        {joiningReasons.length} reasons · {creativeGoals.length} goals
                      </Text>
                    </View>
                  </View>
                </>
              )}
            </View>

            <View style={styles.reviewActions}>
              <TouchableOpacity
                onPress={goBack}
                style={[styles.backButton, isFirstStep && styles.backButtonDisabled]}
                activeOpacity={0.9}
                disabled={loading || isFirstStep}
              >
                <Text style={[styles.backButtonText, isFirstStep && styles.backButtonTextDisabled]}>
                  Back
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={goNext}
                style={[
                  styles.submitButton,
                  styles.submitButtonReview,
                  loading && { opacity: 0.6 },
                ]}
                disabled={loading}
                activeOpacity={0.9}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.submitText}>{isLastStep ? 'Finish' : 'Next'}</Text>
                )}
              </TouchableOpacity>
            </View>

            {!!submitStatus && <Text style={styles.submitStatusText}>{submitStatus}</Text>}
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
  {isLoadingRoles || (isSearchingRoles && roleSearchItems.length === 0) ? (
    <View style={styles.modalLoadingWrap}>
      <ActivityIndicator color={GOLD} size="large" />
      <Text style={styles.loadingText}>Loading roles...</Text>
    </View>
  ) : roleLoadError ? (
    <View style={styles.modalLoadingWrap}>
      <Text style={styles.emptyText}>{roleLoadError}</Text>

      <TouchableOpacity
        onPress={fetchCreativeRoles}
        style={styles.retryButton}
        activeOpacity={0.85}
      >
        <Text style={styles.retryButtonText}>Try Again</Text>
      </TouchableOpacity>
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
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.listItemText}>{item.label}</Text>
        </TouchableOpacity>
      )}
      ListEmptyComponent={
        <Text style={styles.emptyText}>
          {roleSearchTerm.trim().length > 0
            ? 'No matching roles found. Try a broader search like “actor”, “editor”, or “director”.'
            : 'Roles are loading. If nothing appears, tap Try Again.'}
        </Text>
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
    shadowColor: CORAL,
    shadowOpacity: 0.14,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
  },

  cardDesktop: {
    padding: 28,
  },

  eyebrow: {
    color: CORAL_DARK,
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

  progressCount: {
    color: TEXT_MUTED,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },

  progressSegments: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 10,
  },

  progressSegment: {
    flex: 1,
    height: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(125,74,63,0.12)',
  },

  progressSegmentActive: {
    backgroundColor: CORAL,
  },

  progressLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
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
    backgroundColor: CORAL,
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
    minHeight: 380,
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
  borderColor: 'rgba(244,91,106,0.30)',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'hidden',
  position: 'relative',
},

  avatarButtonMobile: {
    width: 146,
    height: 146,
    borderRadius: 73,
    shadowColor: CORAL,
    shadowOpacity: 0.16,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },

  avatarButtonActive: {
    borderColor: CORAL,
    shadowColor: CORAL,
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
    backgroundColor: CORAL,
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
    color: '#fff',
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },

  requiredLabel: {
    marginTop: 12,
    color: CORAL_DARK,
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

  helperText: {
    color: TEXT_MUTED,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: SYSTEM_SANS,
    marginTop: 8,
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
    borderColor: CORAL,
    shadowColor: CORAL,
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

  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  choicePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'rgba(255,255,255,0.58)',
  },

  choicePillSelected: {
    borderColor: 'rgba(244,91,106,0.42)',
    backgroundColor: 'rgba(244,91,106,0.12)',
  },

  choicePillText: {
    color: TEXT_MUTED,
    fontSize: 13,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
  },

  choicePillTextSelected: {
    color: TEXT_IVORY,
  },

  multiSelectWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  optionCard: {
    width: '100%',
    minHeight: 54,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: BORDER,
    backgroundColor: 'rgba(255,255,255,0.62)',
    paddingVertical: 12,
    paddingHorizontal: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  optionCardSelected: {
    borderColor: 'rgba(244,91,106,0.48)',
    backgroundColor: 'rgba(244,91,106,0.12)',
  },

  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: 'rgba(125,74,63,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFDF8',
  },

  checkboxSelected: {
    borderColor: CORAL,
    backgroundColor: CORAL,
  },

  optionCardText: {
    flex: 1,
    color: TEXT_IVORY,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: SYSTEM_SANS,
    fontWeight: '800',
  },

  optionCardTextSelected: {
    color: CORAL_DARK,
  },

  inlineContinueButton: {
    marginTop: 12,
    alignSelf: 'flex-end',
    backgroundColor: CORAL,
    borderRadius: 999,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },

  inlineContinueButtonText: {
    color: '#fff',
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
  borderColor: CORAL,
  backgroundColor: '#F8E7DF',
  position: 'relative',
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
    color: CORAL_DARK,
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
    color: CORAL_DARK,
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

  backButtonDisabled: {
    opacity: 0.42,
  },

  backButtonText: {
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 15,
    letterSpacing: 0.4,
  },

  backButtonTextDisabled: {
    color: TEXT_MUTED,
  },

  submitButton: {
    backgroundColor: CORAL,
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
    color: '#fff',
    fontFamily: SYSTEM_SANS,
    fontWeight: '900',
    fontSize: 16,
    letterSpacing: 0.4,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(36,24,23,0.45)',
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

  loadingText: {
  marginTop: 12,
  color: TEXT_MUTED,
  fontSize: 13,
  fontFamily: SYSTEM_SANS,
  textAlign: 'center',
},

retryButton: {
  marginTop: 16,
  backgroundColor: CORAL,
  borderRadius: 999,
  paddingVertical: 11,
  paddingHorizontal: 18,
  alignItems: 'center',
  justifyContent: 'center',
},

retryButtonText: {
  color: '#fff',
  fontSize: 12,
  fontFamily: SYSTEM_SANS,
  fontWeight: '900',
  textTransform: 'uppercase',
  letterSpacing: 0.7,
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
