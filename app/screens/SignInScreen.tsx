// app/screens/SignInScreen.tsx
// ------------------------------------------------------------
// MOBILE-FIRST SIGN IN
// - Native mobile: direct sign-in screen
// - Web: larger, cleaner centred sign-in card
// - Web background cleaned up to remove harsh/ring-like edges
// - Removes blue cursor/selection highlight
// - Smoother input focus + submit flow
// - IMPORTANT: CreateProfile is ONLY allowed right after a
//   genuinely fresh email confirmation / first confirmed sign-in
// ------------------------------------------------------------

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Animated,
  Easing,
  useWindowDimensions,
  Modal,
  ScrollView,
  Pressable,
  UIManager,
  Image,
  ImageStyle,
} from 'react-native';
import * as Linking from 'expo-linking';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useAppTheme } from '../context/ThemeContext';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const DARK_BG = '#050505';
const DARK_ELEVATED = '#111114';
const TEXT_IVORY = '#F4EFE6';
const TEXT_MUTED = '#A59D90';
const DIVIDER = 'rgba(255,255,255,0.10)';
const GOLD = '#C6A664';

const SYSTEM_SANS =
  Platform.select({ ios: 'System', android: 'Roboto', web: undefined }) || undefined;

const WEB_VERTICAL_SCROLL =
  Platform.OS === 'web'
    ? ({
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
      } as any)
    : null;

const T = {
  bg: DARK_BG,
  card: DARK_ELEVATED,
  card2: '#16161A',
  text: TEXT_IVORY,
  sub: '#D8D2C8',
  mute: TEXT_MUTED,
  accent: GOLD,
  olive: GOLD,
  border: 'rgba(255,255,255,0.10)',
};

const MANIFESTO_LINES = [
  'Meet your crew this month. Make a film together.',
  'No gatekeepers. Just collaborators, jobs, and a deadline.',
  'Post a job. Apply to one. Start filming.',
  'Submit your film to the monthly challenge.',
  'Learn the craft through Film Bootcamp, then put it into practice.',
  'The industry makes you wait. We say don’t.',
];

const TYPE_MIN_MS = 25;
const TYPE_MAX_MS = 90;
const DELETE_MIN_MS = 20;
const DELETE_MAX_MS = 60;
const WORD_PAUSE_MS = 140;
const PUNCT_PAUSE_MS = 220;
const HOLD_FULL_MS = 5500;
const HOLD_EMPTY_MS = 280;
const CARET_BLINK_MS = 530;
const TITLE_FADE_MS = 700;

// Only allow CreateProfile when the account was confirmed very recently.
const FRESH_CONFIRMATION_WINDOW_MS = 30 * 60 * 1000;

const OVERLOOKED_ICON = require('../../assets/overlooked-icon-new.png');
const DESKTOP_SHOWCASE_IMAGE = require('../../assets/signin/desktop-showcase.png');

const DESKTOP_SIGNIN_SHOTS = [
  {
    label: 'Share your work',
    copy: 'Post films, scenes, and exercises.',
  },
  {
    label: 'Train your craft',
    copy: 'Level up through focused creative exercises.',
  },
  {
    label: 'Build your portfolio',
    copy: 'Show your range, credits, and submissions.',
  },
] as const;

type FeatureKey = 'profile' | 'location' | 'jobs' | 'festival';

type Feature = {
  key: FeatureKey;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  detail: string;
  cta: string;
  route: string;
};

const FEATURES: Feature[] = [
  {
    key: 'profile',
    title: 'Create Your Profile',
    subtitle: 'Choose role & city',
    icon: 'person',
    detail: 'Pick your main role, add side roles, set your city, and link a portfolio.',
    cta: 'Set up my profile',
    route: 'CreateProfile',
  },
  {
    key: 'location',
    title: 'Meet Creatives Near You',
    subtitle: 'City groups & chat',
    icon: 'location',
    detail: 'Find collaborators in your city. Join the city chat and build a crew.',
    cta: 'Explore my city',
    route: 'Location',
  },
  {
    key: 'jobs',
    title: 'Post & Apply to Jobs',
    subtitle: 'Paid and free gigs',
    icon: 'briefcase',
    detail: 'Browse or post gigs. Your profile is automatically attached to applications.',
    cta: 'Open the job board',
    route: 'Jobs',
  },
  {
    key: 'festival',
    title: 'Monthly Film Challenge',
    subtitle: 'Create, submit, and get seen',
    icon: 'trophy',
    detail:
      'Upload a 1–15 minute film each month, climb the leaderboard, and grow with the community. You can also learn filmmaking craft through Film Bootcamp, then use those skills in the monthly challenge.',
    cta: 'See this month',
    route: 'Featured',
  },
];

function useHoverScale() {
  const scale = useRef(new Animated.Value(1)).current;
  const [hovered, setHovered] = useState(false);

  const to = (v: number, d = 120) =>
    Animated.timing(scale, {
      toValue: v,
      duration: d,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });

  const onHoverIn = () => {
    setHovered(true);
    if (Platform.OS === 'web') to(1.01, 140).start();
  };

  const onHoverOut = () => {
    setHovered(false);
    if (Platform.OS === 'web') to(1, 120).start();
  };

  const onPressIn = () =>
    Animated.spring(scale, {
      toValue: 0.995,
      useNativeDriver: true,
      speed: 40,
      bounciness: 0,
    }).start();

  const onPressOut = () =>
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 20,
      bounciness: 6,
    }).start();

  return { scale, hovered, onHoverIn, onHoverOut, onPressIn, onPressOut };
}

function parseAuthTypeFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const searchType = u.searchParams.get('type');
    if (searchType) return searchType;

    const hash = (u.hash || '').replace(/^#/, '');
    if (hash) {
      const hp = new URLSearchParams(hash);
      return hp.get('type');
    }
  } catch {}

  return null;
}

function isFreshlyConfirmedUser(user: any): boolean {
  const confirmedAt = user?.email_confirmed_at
    ? new Date(user.email_confirmed_at).getTime()
    : null;

  if (!confirmedAt || Number.isNaN(confirmedAt)) return false;

  const age = Date.now() - confirmedAt;
  return age >= 0 && age <= FRESH_CONFIRMATION_WINDOW_MS;
}

export default function SignInScreen() {
  const navigation = useNavigation<any>();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { colors, isLight } = useAppTheme();

  const isWide = width >= 980;
  const isPhone = width < 420;
  const isShort = height < 720;
  const isWeb = Platform.OS === 'web';
  const isDesktopWeb = isWeb && isWide;
  const isWebMobile = isWeb && !isDesktopWeb;

  const isNativeMobile = Platform.OS === 'ios' || Platform.OS === 'android';
  const useSimpleMobileLayout = isNativeMobile || isWebMobile;
  const useNativeLikeMobileLayout = useSimpleMobileLayout && !isDesktopWeb;
  const useWideWebFormStyles = isWeb && !useNativeLikeMobileLayout;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSignIn, setShowSignIn] = useState(!useSimpleMobileLayout);
  const [activeFeature, setActiveFeature] = useState<FeatureKey | null>(null);
  const [isShowcaseHovered, setIsShowcaseHovered] = useState(false);

  const titleOpacity = useRef(new Animated.Value(0)).current;
  const titleTranslate = useRef(new Animated.Value(8)).current;

  const [lineIndex, setLineIndex] = useState(
    () => Math.floor(Math.random() * MANIFESTO_LINES.length)
  );
  const fullLine = useMemo(() => MANIFESTO_LINES[lineIndex], [lineIndex]);

  const [displayText, setDisplayText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [caretVisible, setCaretVisible] = useState(true);
  const [focus, setFocus] = useState<'email' | 'password' | null>(null);

  const didFinishRedirectRef = useRef(false);
  const deepLinkHandledRef = useRef<string | null>(null);
  const allowCreateProfileOnceRef = useRef(false);

  const emailInputRef = useRef<TextInput>(null);
  const passwordInputRef = useRef<TextInput>(null);

  useEffect(() => {
    if (!isWeb || typeof document === 'undefined') return;

    try {
      document.documentElement.style.overflow = 'auto';
      document.documentElement.style.overflowX = 'hidden';
      document.documentElement.style.overflowY = 'auto';
      document.documentElement.style.touchAction = 'pan-y';
      document.body.style.overflow = 'auto';
      document.body.style.overflowX = 'hidden';
      document.body.style.overflowY = 'auto';
      document.body.style.touchAction = 'pan-y';
    } catch {}
  }, [isWeb]);

  const showError = (title: string, message: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        window.alert(`${title}\n\n${message}`);
        return;
      } catch {}
    }
    Alert.alert(title, message);
  };

  const finishPostAuthRedirect = async (opts?: { allowCreateProfile?: boolean }) => {
    if (didFinishRedirectRef.current) return;
    didFinishRedirectRef.current = true;

    const { data: u } = await supabase.auth.getUser();
    const user = u?.user;
    const userId = user?.id;

    if (!userId) {
      didFinishRedirectRef.current = false;
      return;
    }

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id, full_name, main_role_id, city_id')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.log('Profile fetch error:', profileError);

      await supabase.auth.signOut();
      allowCreateProfileOnceRef.current = false;
      didFinishRedirectRef.current = false;

      showError('Error', 'Could not load your profile. Please sign in again.');
      return;
    }

    const profileComplete = Boolean(
      profile?.id && profile?.full_name && profile?.main_role_id && profile?.city_id
    );

    if (!profileComplete) {
      const isPasswordResetFlow =
        (globalThis as any).__OVERLOOKED_FORCE_NEW_PASSWORD__ ||
        (globalThis as any).__OVERLOOKED_RECOVERY__ ||
        (globalThis as any).__OVERLOOKED_PASSWORD_RESET_DONE__;

      if (isPasswordResetFlow) {
        await supabase.auth.signOut();
        allowCreateProfileOnceRef.current = false;
        didFinishRedirectRef.current = false;

        showError(
          'Password reset complete',
          'Please sign in again with your new password.'
        );
        return;
      }

      allowCreateProfileOnceRef.current = false;

      try {
        const parentNav = navigation.getParent?.();

        if (parentNav) {
          parentNav.reset({
            index: 0,
            routes: [{ name: 'CreateProfile' }],
          });
          return;
        }

        navigation.reset({
          index: 0,
          routes: [{ name: 'CreateProfile' }],
        });
      } catch (e) {
        console.log('CreateProfile navigation error:', e);
        didFinishRedirectRef.current = false;
        showError('Navigation Error', 'Could not open profile setup.');
      }

      return;
    }

    // Complete-profile sign-ins are routed by AppNavigator after AuthProvider
    // finishes its single profile check. Avoid resetting to MainTabs here too,
    // otherwise Featured mounts twice and visibly reloads after sign-in.
    return;
  };

  const handleAuthDeepLink = async (url: string) => {
    try {
      if (!url || !url.includes('code=')) return;

      if (deepLinkHandledRef.current === url) return;
      deepLinkHandledRef.current = url;

      const authType = parseAuthTypeFromUrl(url);

      (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = false;
      (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;
      (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = true;

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.sessionStorage.removeItem('overlooked.manualSignIn');
        window.sessionStorage.removeItem('overlooked.createProfileAllowed');
      }

      const { error } = await supabase.auth.exchangeCodeForSession(url);

      if (error) {
        console.log('exchangeCodeForSession error:', error);
        showError(
          'Email Confirmation',
          'Could not finish email confirmation. Please open the newest confirmation email link again.'
        );
        return;
      }

      if (authType === 'signup' || authType === 'email_change') {
        await supabase.auth.signOut();

        allowCreateProfileOnceRef.current = false;
        didFinishRedirectRef.current = false;

        (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = false;
        (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;
        (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = false;

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          const clean = window.location.origin + window.location.pathname;
          window.history.replaceState({}, document.title, clean);

          window.sessionStorage.removeItem('overlooked.manualSignIn');
          window.sessionStorage.removeItem('overlooked.createProfileAllowed');
        }

        try {
          navigation.reset({
            index: 0,
            routes: [{ name: 'SignIn' }],
          });
        } catch (e) {
          console.log('SignIn reset after confirmation error:', e);
        }

        showError(
          'Email confirmed',
          'Your email has been confirmed. Please sign in to continue.'
        );

        return;
      }

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const clean = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, clean);
      }

      await supabase.auth.signOut();

      allowCreateProfileOnceRef.current = false;
      didFinishRedirectRef.current = false;
    } catch (e) {
      console.log('handleAuthDeepLink exception:', e);
    }
  };

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let mounted = true;

    const init = async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!mounted) return;

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          await handleAuthDeepLink(window.location.href);
        } else {
          const initial = await Linking.getInitialURL();
          if (initial) await handleAuthDeepLink(initial);
        }

        const { data: refreshedSessionData } = await supabase.auth.getSession();
        if (!mounted) return;

        const isManualSignIn =
          (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ === true ||
          (Platform.OS === 'web' &&
            typeof window !== 'undefined' &&
            window.sessionStorage.getItem('overlooked.manualSignIn') === 'true');

        if (
          refreshedSessionData?.session?.user &&
          !didFinishRedirectRef.current &&
          isManualSignIn
        ) {
          await finishPostAuthRedirect({
            allowCreateProfile: allowCreateProfileOnceRef.current,
          });
        }

        const sub = Linking.addEventListener('url', (event) => {
          void handleAuthDeepLink(event.url);
        });

        unsub = () => sub.remove();
      } catch (e) {
        console.log('SignIn init error:', e);
      }
    };

    init();

    return () => {
      mounted = false;
      if (unsub) unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (useSimpleMobileLayout) return;
    if (showSignIn) return;

    const id = setInterval(() => setCaretVisible((v) => !v), CARET_BLINK_MS);
    return () => clearInterval(id);
  }, [showSignIn, useSimpleMobileLayout]);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(titleOpacity, {
        toValue: 1,
        duration: TITLE_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(titleTranslate, {
        toValue: 0,
        duration: TITLE_FADE_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, []);

  useEffect(() => {
    if (useSimpleMobileLayout) return;
    if (showSignIn) return;

    let mounted = true;
    let timer: any;

    const rand = (a: number, b: number) =>
      Math.floor(Math.random() * (b - a + 1)) + a;

    const nextTypeDelay = (typed: string) => {
      let d = rand(TYPE_MIN_MS, TYPE_MAX_MS);
      const last = typed.slice(-1);
      if (last === ' ') d += WORD_PAUSE_MS;
      if (['.', ',', '!', '?', ';', ':'].includes(last)) d += PUNCT_PAUSE_MS;
      if (Math.random() < 0.14) d += rand(100, 320);
      return d;
    };

    const nextDeleteDelay = () => rand(DELETE_MIN_MS, DELETE_MAX_MS);

    const pickNext = (prev: number) => {
      let n = prev;
      while (n === prev) n = Math.floor(Math.random() * MANIFESTO_LINES.length);
      return n;
    };

    const tick = () => {
      if (!mounted) return;
      const current = displayText;
      const target = fullLine;

      if (!isDeleting) {
        if (current.length < target.length) {
          const next = target.slice(0, current.length + 1);
          setDisplayText(next);
          timer = setTimeout(tick, nextTypeDelay(next));
        } else {
          timer = setTimeout(() => {
            if (!mounted) return;
            setIsDeleting(true);
            timer = setTimeout(tick, nextDeleteDelay());
          }, HOLD_FULL_MS);
        }
      } else {
        if (current.length > 0) {
          const next = target.slice(0, current.length - 1);
          setDisplayText(next);
          timer = setTimeout(tick, nextDeleteDelay());
        } else {
          timer = setTimeout(() => {
            if (!mounted) return;
            setIsDeleting(false);
            setLineIndex((prev) => pickNext(prev));
          }, HOLD_EMPTY_MS);
        }
      }
    };

    timer = setTimeout(tick, TYPE_MIN_MS);

    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
    };
  }, [displayText, isDeleting, fullLine, showSignIn, useSimpleMobileLayout]);

  const handleSignIn = async () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      showError('Sign in to continue', 'Enter your email and password.');
      return;
    }

    if (loading) return;
    setLoading(true);

    (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = true;
    (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = true;

    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.sessionStorage.setItem('overlooked.manualSignIn', 'true');
      window.sessionStorage.setItem('overlooked.createProfileAllowed', 'true');
    }

    try {
      didFinishRedirectRef.current = false;
      allowCreateProfileOnceRef.current = true;

      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = false;
        (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.sessionStorage.removeItem('overlooked.manualSignIn');
          window.sessionStorage.removeItem('overlooked.createProfileAllowed');
        }

        showError('Login Error', error.message);
        return;
      }

      const user = data?.user;
      const userId = user?.id;

      if (!userId) {
        (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = false;
        (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.sessionStorage.removeItem('overlooked.manualSignIn');
          window.sessionStorage.removeItem('overlooked.createProfileAllowed');
        }

        showError('Error', 'Login failed. Please try again.');
        return;
      }

      const isConfirmed = !!user?.email_confirmed_at;

      if (!isConfirmed) {
        (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = false;
        (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.sessionStorage.removeItem('overlooked.manualSignIn');
          window.sessionStorage.removeItem('overlooked.createProfileAllowed');
        }

        await supabase.auth.signOut();

        showError(
          'Email not confirmed',
          'Please confirm your email first, then try signing in again.'
        );
        return;
      }

      const { data: existingProfile, error: existingProfileError } = await supabase
        .from('users')
        .select('id, full_name, main_role_id, city_id')
        .eq('id', userId)
        .maybeSingle();

      if (existingProfileError) {
        console.log('Manual sign-in profile check error:', existingProfileError);
        showError('Login Error', 'Could not check your profile. Please try again.');
        return;
      }

      const existingProfileComplete = Boolean(
        existingProfile?.id &&
          existingProfile?.full_name &&
          existingProfile?.main_role_id &&
          existingProfile?.city_id
      );

      if (!existingProfileComplete) {
        (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = true;
        (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = true;
        (globalThis as any).__OVERLOOKED_EMAIL_CONFIRM__ = false;

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          window.sessionStorage.setItem('overlooked.manualSignIn', 'true');
          window.sessionStorage.setItem('overlooked.createProfileAllowed', 'true');
        }

        const parentNav = navigation.getParent?.();

        if (parentNav) {
          parentNav.reset({
            index: 0,
            routes: [{ name: 'CreateProfile' }],
          });
          return;
        }

        navigation.reset({
          index: 0,
          routes: [{ name: 'CreateProfile' }],
        });

        return;
      }

      allowCreateProfileOnceRef.current = true;

      await finishPostAuthRedirect({ allowCreateProfile: true });
    } catch (err: any) {
      console.log('SignIn exception:', err);

      (globalThis as any).__OVERLOOKED_MANUAL_SIGN_IN__ = false;
      (globalThis as any).__OVERLOOKED_CREATE_PROFILE_ALLOWED__ = false;

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        window.sessionStorage.removeItem('overlooked.manualSignIn');
        window.sessionStorage.removeItem('overlooked.createProfileAllowed');
      }

      showError('Login Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const MODAL_SIDE_PAD = isPhone ? 14 : 18;
  const maxModalWidth = (cap: number) => Math.min(cap, Math.max(260, width - MODAL_SIDE_PAD * 2));
  const modalMaxHeight = Math.max(260, height - insets.top - insets.bottom - 24);

  const renderAuthForm = (mobileMode = false) => {
  const desktopFormMode = isDesktopWeb && mobileMode;
  const webCardWidth = desktopFormMode
    ? 420
    : Math.min(560, Math.max(330, width - 56));

  const FormContent = (
    <>
      {!mobileMode && (
        <View style={styles.authHeader}>
          <Text style={[styles.authTitle, isShort && styles.authTitleShort]}>
            WELCOME BACK
          </Text>
          <Pressable onPress={() => setShowSignIn(false)} hitSlop={10}>
            <Ionicons name="close" size={20} color={T.sub} />
          </Pressable>
        </View>
      )}

      {desktopFormMode && (
        <View style={styles.desktopFormHeader}>
          <Image
            source={OVERLOOKED_ICON}
            style={{
              width: 50,
              height: 50,
              marginBottom: 12,
            }}
            resizeMode="contain"
          />
          <Text style={[styles.desktopFormTitle, { color: colors.textPrimary }]}>
            Log in to Overlooked
          </Text>
          <Text style={[styles.desktopFormSubtitle, { color: colors.textSecondary }]}>
            Pick up where you left off and keep building your creative network.
          </Text>
        </View>
      )}

      {mobileMode && !desktopFormMode && (
        <View style={[styles.mobileHeader, useWideWebFormStyles && styles.webHeader]}>
          <Animated.Text
            style={[
              styles.mobileBrand,
              useWideWebFormStyles && styles.webBrand,
              {
                color: colors.textPrimary,
                opacity: titleOpacity,
                transform: [{ translateY: titleTranslate }],
              },
            ]}
          >
            OVERLOOKED
          </Animated.Text>

          <Text
            style={[
              styles.heroPrompt,
              useWideWebFormStyles && styles.heroPromptWeb,
              { color: colors.textPrimary },
            ]}
          >
            <Text style={styles.heroHighlight}>Meet</Text> other creatives.{'\n'}
            <Text style={styles.heroHighlight}>Share</Text> your work worldwide.
          </Text>

          <Text
            style={[
              styles.mobileTitle,
              useWideWebFormStyles && styles.webTitle,
              { color: colors.textPrimary },
            ]}
          >
            Sign in
          </Text>
          <Text
            style={[
              styles.mobileSubtitle,
              useWideWebFormStyles && styles.webSubtitle,
              { color: colors.textSecondary },
            ]}
          >
            Welcome back. Get straight into your account.
          </Text>
        </View>
      )}

      {!mobileMode && (
        <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
          Sign in to join this month’s journey.
        </Text>
      )}

       <View
  style={[
    styles.inputWrap,
    useWideWebFormStyles && styles.inputWrapWeb,
    {
      backgroundColor: colors.input,
      borderColor: focus === 'email' ? colors.primary : colors.border,
    },
    useWideWebFormStyles && focus === 'email' && styles.inputWrapFocused,
  ]}
>
        <Ionicons name="mail" size={17} color={focus === 'email' ? colors.primary : colors.textMuted} />
        <TextInput
          ref={emailInputRef}
          style={[styles.input, useWideWebFormStyles && styles.inputWeb, { color: colors.textPrimary }]}
          placeholder="Email"
          placeholderTextColor={colors.textMuted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          keyboardAppearance="dark"
          selectionColor={GOLD}
          cursorColor={GOLD}
          underlineColorAndroid="transparent"
          value={email}
          onChangeText={setEmail}
          onFocus={() => {
  if (isWeb) setFocus('email');
}}
onBlur={() => {
  if (isWeb) setFocus(null);
}}
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => passwordInputRef.current?.focus()}
        />
      </View>

      <View
  style={[
    styles.inputWrap,
    useWideWebFormStyles && styles.inputWrapWeb,
    { marginTop: 14 },
    {
      backgroundColor: colors.input,
      borderColor: focus === 'password' ? colors.primary : colors.border,
    },
    useWideWebFormStyles && focus === 'password' && styles.inputWrapFocused,
  ]}
>
        <Ionicons
          name="lock-closed"
          size={17}
          color={focus === 'password' ? colors.primary : colors.textMuted}
        />
        <TextInput
          ref={passwordInputRef}
          style={[styles.input, useWideWebFormStyles && styles.inputWeb, { color: colors.textPrimary }]}
          placeholder="Password"
          placeholderTextColor={colors.textMuted}
          secureTextEntry={!showPassword}
          autoCorrect={false}
          autoComplete="password"
          textContentType="password"
          keyboardAppearance="dark"
          selectionColor={GOLD}
          cursorColor={GOLD}
          underlineColorAndroid="transparent"
          value={password}
          onChangeText={setPassword}
          onFocus={() => {
  if (isWeb) setFocus('password');
}}
onBlur={() => {
  if (isWeb) setFocus(null);
}}
          returnKeyType="done"
          onSubmitEditing={handleSignIn}
        />

        <TouchableOpacity
          onPress={() => setShowPassword((prev) => !prev)}
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
        >
          <Ionicons
            name={showPassword ? 'eye-off' : 'eye'}
            size={19}
            color={T.mute}
          />
        </TouchableOpacity>
      </View>

      <TouchableOpacity
        onPress={() => {
          if (!mobileMode) setShowSignIn(false);
          navigation.navigate('ForgotPassword');
        }}
        style={{ marginTop: 12, alignSelf: mobileMode ? 'flex-start' : 'auto' }}
      >
        <Text style={[styles.forgotText, { color: T.sub }]}>Forgot password?</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.button,
          useWideWebFormStyles && styles.buttonWeb,
          loading && { opacity: 0.9 },
          mobileMode && { marginTop: 22 },
        ]}
        onPress={handleSignIn}
        disabled={loading}
        activeOpacity={0.9}
      >
        {loading ? (
          <ActivityIndicator color={DARK_BG} />
        ) : (
          <Text style={[styles.buttonText, useWideWebFormStyles && styles.buttonTextWeb]}>
            Sign In
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => {
          if (!mobileMode) setShowSignIn(false);
          navigation.navigate('SignUp');
        }}
        style={{ marginTop: 18 }}
      >
        <Text style={[styles.link, { color: T.sub }]}>
          New to OverLooked?{' '}
          <Text style={{ color: T.olive, textDecorationLine: 'underline' }}>Create an account</Text>
        </Text>
      </TouchableOpacity>

      <Text style={[styles.supportText, { color: T.sub }]}>
        For support, message overlookedsupport@gmail.com
      </Text>
    </>
  );

  return (
    <View
      style={[
        styles.authCard,
        mobileMode ? styles.authCardMobile : null,
        useWideWebFormStyles && mobileMode ? styles.authCardWeb : null,
        desktopFormMode ? styles.authCardDesktopWeb : null,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          shadowColor: colors.shadow,
        },
        {
          width: mobileMode ? (useWideWebFormStyles ? webCardWidth : '100%') : maxModalWidth(460),
          maxHeight: mobileMode ? undefined : modalMaxHeight,
          alignSelf: 'center',
          padding:
            desktopFormMode
              ? 32
              : mobileMode && useWideWebFormStyles
              ? width >= 900
                ? 36
                : 28
              : mobileMode
                ? 22
                : isShort
                  ? 16
                  : 20,
        },
      ]}
    >
      {useSimpleMobileLayout && mobileMode ? (
        FormContent
      ) : (
        <ScrollView
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
          overScrollMode="never"
          contentContainerStyle={{ paddingBottom: mobileMode ? 0 : 14 }}
        >
          {FormContent}
        </ScrollView>
      )}
    </View>
  );
};

  const renderDesktopSignInShowcase = () => (
    <View style={styles.desktopShowcase}>
      <View style={styles.desktopBrandRow}>
        <Image
          source={OVERLOOKED_ICON}
          style={{
            width: 48,
            height: 48,
          }}
          resizeMode="contain"
        />
        <Text style={[styles.desktopBrandText, { color: colors.textPrimary }]}>OVERLOOKED</Text>
      </View>

      <View style={styles.desktopShowcaseBody}>
        <Text style={[styles.desktopHeadline, { color: colors.textPrimary }]}>
          For actors and filmmakers ready{'\n'}to be seen.
        </Text>
        <Text style={[styles.desktopSubcopy, { color: colors.textSecondary }]}>
          Build your craft. Share your films. Find your crew.
        </Text>
        <Pressable
          accessibilityRole="image"
          onHoverIn={() => setIsShowcaseHovered(true)}
          onHoverOut={() => setIsShowcaseHovered(false)}
          style={styles.desktopPreviewStage}
        >
          <Image
            source={DESKTOP_SHOWCASE_IMAGE}
            resizeMode="contain"
            style={[
              styles.desktopPreviewImage,
              isShowcaseHovered ? styles.desktopPreviewImageHover : null,
            ] as ImageStyle}
          />
        </Pressable>

        <View style={styles.desktopFeatureGrid}>
          {DESKTOP_SIGNIN_SHOTS.map((item, index) => (
            <Pressable
              key={item.label}
              style={(state: any) => [
                styles.desktopFeatureTile,
                {
                  backgroundColor: state.hovered
                    ? isLight
                      ? colors.card
                      : colors.elevated
                    : isLight
                      ? colors.mutedCard
                      : colors.cardAlt,
                  borderColor: state.hovered ? colors.primary : colors.borderStrong,
                },
                state.hovered ? styles.desktopFeatureTileHover : null,
              ]}
            >
              <View style={styles.desktopFeatureNumber}>
                <Text style={styles.desktopFeatureNumberText}>{index + 1}</Text>
              </View>
              <View style={styles.desktopFeatureTextWrap}>
                <Text style={[styles.desktopFeatureTitle, { color: colors.textPrimary }]}>
                  {item.label}
                </Text>
                <Text style={[styles.desktopFeatureCopy, { color: colors.textSecondary }]}>
                  {item.copy}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );

  if (useSimpleMobileLayout) {
    return (
      <SafeAreaView
        style={[
          { flex: 1, backgroundColor: colors.background },
          isWeb
            ? ({
                minHeight: '100dvh',
                height: '100dvh',
                ...WEB_VERTICAL_SCROLL,
              } as any)
            : null,
        ]}
      >
        <View style={{ flex: 1 }}>
          <View style={[styles.bgSolid, { backgroundColor: colors.background }]} />
          {!isLight ? <View style={styles.mobileGlowTop} pointerEvents="none" /> : null}
          {!isLight ? <View style={styles.mobileGlowBottom} pointerEvents="none" /> : null}

          <ScrollView
            style={[
              { flex: 1 },
              isWeb ? WEB_VERTICAL_SCROLL : null,
            ]}
            contentContainerStyle={[
              styles.mobileContainer,
              {
                flexGrow: 1,
                paddingTop: Math.max(insets.top, 20),
                paddingBottom: Math.max(insets.bottom, 20),
              },
            ]}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="none"
            showsVerticalScrollIndicator={false}
            bounces={false}
            overScrollMode="never"
          >
            {renderAuthForm(true)}
          </ScrollView>
        </View>
      </SafeAreaView>
    );
  }

  if (isDesktopWeb) {
    return (
      <SafeAreaView
        style={[
          { flex: 1, backgroundColor: colors.background },
          {
            minHeight: '100vh',
            height: '100vh',
            ...WEB_VERTICAL_SCROLL,
          } as any,
        ]}
      >
        <View style={[styles.bgSolid, { backgroundColor: colors.background }]} />
        {!isLight ? <View style={styles.webGradientBase} pointerEvents="none" /> : null}
        {!isLight ? <View style={styles.webSoftVignette} pointerEvents="none" /> : null}

        <ScrollView
          style={[
            { flex: 1, backgroundColor: 'transparent' },
            WEB_VERTICAL_SCROLL,
          ] as any}
          contentContainerStyle={[
            styles.desktopAuthScroll,
            {
              minHeight: height,
              paddingTop: Math.max(insets.top, 34),
              paddingBottom: Math.max(insets.bottom, 28),
            },
          ]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.desktopAuthShell}>
            {renderDesktopSignInShowcase()}

            <View style={[styles.desktopDivider, { backgroundColor: colors.border }]} />

            <View style={styles.desktopAuthPanel}>
              {renderAuthForm(true)}
              <Text style={[styles.desktopFooter, { color: colors.textMuted }]}>
                Overlooked for independent creatives
              </Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }
    return (
    <SafeAreaView
      style={[
        { flex: 1, backgroundColor: colors.background },
        Platform.OS === 'web'
          ? ({
              minHeight: '100vh',
              height: '100vh',
              ...WEB_VERTICAL_SCROLL,
            } as any)
          : ({ overflow: 'hidden' } as any),
      ]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={[styles.bgSolid, { backgroundColor: colors.background }]} />
        {!isLight ? <View style={styles.webGradientBase} pointerEvents="none" /> : null}
        {!isLight ? <View style={styles.webGlowCenter} pointerEvents="none" /> : null}
        {!isLight ? <View style={styles.webGlowLeft} pointerEvents="none" /> : null}
        {!isLight ? <View style={styles.webGlowRight} pointerEvents="none" /> : null}
        {!isLight ? <View style={styles.webSoftVignette} pointerEvents="none" /> : null}

        <ScrollView
          style={[
            { flex: 1, backgroundColor: 'transparent' },
            Platform.OS === 'web'
              ? WEB_VERTICAL_SCROLL
              : null,
          ]}
          contentContainerStyle={[
            styles.webAuthScroll,
            {
              minHeight: height,
              paddingTop: Math.max(insets.top, 34),
              paddingBottom: Math.max(insets.bottom, 34),
              paddingHorizontal: width < 420 ? 18 : 32,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.webAuthShell}>
            {renderAuthForm(true)}
          </View>
        </ScrollView>

        <Modal
          transparent
          visible={!!activeFeature}
          animationType="fade"
          onRequestClose={() => setActiveFeature(null)}
        >
          <View style={styles.modalBackdrop}>
            <View
              style={[
                styles.modalCard,
                {
                  width: maxModalWidth(560),
                  maxHeight: modalMaxHeight,
                  alignSelf: 'center',
                },
              ]}
            >
              <ScrollView
                bounces={false}
                overScrollMode="never"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingBottom: 6 }}
              >
                {activeFeature &&
                  (() => {
                    const active = FEATURES.find((f) => f.key === activeFeature)!;
                    return (
                      <>
                        <View style={styles.modalHeader}>
                          <View style={styles.featureIconWrap}>
                            <Ionicons name={active.icon} size={18} color={T.olive} />
                          </View>
                          <Text style={styles.modalTitle}>{active.title}</Text>
                        </View>

                        <Text style={styles.modalDetail}>{active.detail}</Text>

                        <View
                          style={[
                            styles.modalButtonsRow,
                            isPhone && { flexDirection: 'column', alignItems: 'stretch' },
                          ]}
                        >
                          <TouchableOpacity
                            style={[styles.modalSecondary, isPhone && { width: '100%' }]}
                            onPress={() => setActiveFeature(null)}
                          >
                            <Text style={styles.modalSecondaryText}>Close</Text>
                          </TouchableOpacity>

                          <TouchableOpacity
                            style={[styles.modalPrimary, isPhone && { width: '100%' }]}
                            onPress={async () => {
                              setActiveFeature(null);
                              const { data } = await supabase.auth.getUser();
                              if (!data?.user) navigation.navigate('SignUp');
                              else navigation.navigate(active.route);
                            }}
                          >
                            <Text style={styles.modalPrimaryText}>{active.cta}</Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    );
                  })()}
              </ScrollView>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const CARD_RADIUS = 22;

const styles = StyleSheet.create({
  bgSolid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: T.bg,
  },

  // Clean mobile glows. No hard circles or ring-like edges.
  mobileGlowTop: {
    position: 'absolute',
    top: -180,
    left: -170,
    width: 420,
    height: 420,
    borderRadius: 420,
    backgroundColor: 'rgba(212,182,111,0.10)',
    opacity: 0.7,
  },
  mobileGlowBottom: {
    position: 'absolute',
    right: -190,
    bottom: -190,
    width: 450,
    height: 450,
    borderRadius: 450,
    backgroundColor: 'rgba(212,182,111,0.07)',
    opacity: 0.65,
  },

  // Web background rewritten to avoid the weird visible/rich edges.
  // The glow is soft and gradient-based, not big solid circles.
  webGradientBase: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#080808',
    // @ts-ignore - web only
    backgroundImage:
      'linear-gradient(180deg, #11100D 0%, #090909 28%, #070707 100%)',
    opacity: Platform.OS === 'web' ? 1 : 0,
  },
  webGlowCenter: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    // @ts-ignore - web only
    backgroundImage:
      'radial-gradient(circle at 50% 48%, rgba(212,182,111,0.085) 0%, rgba(212,182,111,0.035) 26%, rgba(0,0,0,0) 58%)',
    opacity: Platform.OS === 'web' ? 1 : 0,
  },
  webGlowLeft: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    // @ts-ignore - web only
    backgroundImage:
      'radial-gradient(circle at -8% 5%, rgba(212,182,111,0.14) 0%, rgba(212,182,111,0.045) 24%, rgba(0,0,0,0) 49%)',
    opacity: Platform.OS === 'web' ? 1 : 0,
  },
  webGlowRight: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    // @ts-ignore - web only
    backgroundImage:
      'radial-gradient(circle at 102% 88%, rgba(212,182,111,0.11) 0%, rgba(212,182,111,0.035) 25%, rgba(0,0,0,0) 52%)',
    opacity: Platform.OS === 'web' ? 1 : 0,
  },
  webSoftVignette: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'transparent',
    // @ts-ignore - web only
    backgroundImage:
      'radial-gradient(ellipse at center, rgba(0,0,0,0) 0%, rgba(0,0,0,0.16) 58%, rgba(0,0,0,0.54) 100%)',
    opacity: Platform.OS === 'web' ? 1 : 0,
  },

  webAuthScroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    width: '100%',
  },
  webAuthShell: {
    width: '100%',
    maxWidth: 620,
    alignSelf: 'center',
    alignItems: 'center',
    justifyContent: 'center',
  },
  desktopAuthScroll: {
    flexGrow: 1,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 48,
  },
  desktopAuthShell: {
    width: '100%',
    maxWidth: 1320,
    minHeight: 720,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 54,
  },
  desktopShowcase: {
    position: 'relative',
    width: 640,
    maxWidth: '52%',
    minHeight: 650,
    justifyContent: 'center',
  },
  desktopBrandRow: {
    position: 'absolute',
    top: -44,
    left: -12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 13,
  },
  desktopBrandIcon: {
    width: 48,
    height: 48,
  },
  desktopBrandText: {
    fontSize: 22,
    fontWeight: '900',
    letterSpacing: 4.6,
    fontFamily: SYSTEM_SANS,
  },
  desktopShowcaseBody: {
    width: '100%',
    alignItems: 'flex-start',
    justifyContent: 'center',
    transform: [{ translateY: -30 }],
  },
  desktopHeadline: {
    maxWidth: 620,
    fontSize: 35,
    lineHeight: 41,
    fontWeight: '900',
    letterSpacing: 0,
    fontFamily: SYSTEM_SANS,
  },
  desktopSubcopy: {
    maxWidth: 590,
    marginTop: 12,
    fontSize: 16,
    lineHeight: 23,
    fontWeight: '600',
    letterSpacing: 0,
    fontFamily: SYSTEM_SANS,
  },
  desktopPreviewStage: {
    position: 'relative',
    width: 610,
    height: 342,
    marginTop: 18,
    marginBottom: 14,
    alignSelf: 'center',
    zIndex: 1,
    ...(Platform.OS === 'web'
      ? {
          cursor: 'default',
        }
      : null),
  } as any,
  desktopPreviewImage: {
    width: '100%',
    height: '100%',
    ...(Platform.OS === 'web'
      ? {
          transitionProperty: 'filter, opacity, transform',
          transitionDuration: '220ms',
          transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          willChange: 'filter, transform',
          backfaceVisibility: 'hidden',
        }
      : null),
  } as any,
  desktopPreviewImageHover: {
    opacity: 1,
    ...(Platform.OS === 'web'
      ? {
          filter: 'brightness(1.08) saturate(1.08) drop-shadow(0 24px 42px rgba(20, 17, 13, 0.24))',
          transform: 'translate3d(0, -5px, 0) scale(1.018)',
        }
      : null),
  },
  desktopFeatureGrid: {
    position: 'relative',
    width: '100%',
    maxWidth: 610,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    alignSelf: 'center',
    zIndex: 2,
  },
  desktopFeatureTile: {
    width: '32%',
    height: 78,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 9,
    padding: 11,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.18)',
    backgroundColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
    ...(Platform.OS === 'web'
      ? {
          transitionProperty: 'transform, box-shadow, border-color, background-color',
          transitionDuration: '180ms',
          transitionTimingFunction: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
          cursor: 'default',
        }
      : null),
  } as any,
  desktopFeatureTileHover: {
    transform: [{ translateY: -5 }],
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    ...(Platform.OS === 'web'
      ? {
          boxShadow: '0 16px 34px rgba(20, 17, 13, 0.13)',
        }
      : null),
  } as any,
  desktopFeatureNumber: {
    width: 24,
    height: 24,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(198,166,100,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.28)',
  },
  desktopFeatureNumberText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '900',
    fontFamily: SYSTEM_SANS,
  },
  desktopFeatureTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  desktopFeatureTitle: {
    fontSize: 12.5,
    lineHeight: 15,
    fontWeight: '900',
    letterSpacing: 0,
    fontFamily: SYSTEM_SANS,
  },
  desktopFeatureCopy: {
    marginTop: 3,
    fontSize: 10.8,
    lineHeight: 14,
    fontWeight: '600',
    letterSpacing: 0,
    fontFamily: SYSTEM_SANS,
  },
  desktopDivider: {
    width: 1,
    height: 660,
    alignSelf: 'center',
    opacity: 0.8,
  },
  desktopAuthPanel: {
    width: 470,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ translateY: -8 }],
  },
  desktopFooter: {
    marginTop: 18,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  mobileContainer: {
    flexGrow: 1,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },

  mobileHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  webHeader: {
    marginBottom: 28,
  },
  mobileBrand: {
    fontSize: 22,
    fontWeight: '900',
    color: TEXT_IVORY,
    letterSpacing: 2.6,
    fontFamily: SYSTEM_SANS,
  },
  webBrand: {
    fontSize: 25,
    letterSpacing: 3.8,
  },
  heroPrompt: {
  marginTop: 18,
  fontSize: 22,
  lineHeight: 28,
  fontWeight: '800',
  color: T.text,
  textAlign: 'center',
  letterSpacing: 0,
  fontFamily: SYSTEM_SANS,
  maxWidth: 320,
},
heroPromptWeb: {
  marginTop: 20,
  fontSize: 25,
  lineHeight: 31,
  maxWidth: 390,
},
heroHighlight: {
  color: T.accent,
  fontWeight: '900',
},
  mobileTitle: {
  marginTop: 12,
  fontSize: 30,
  fontWeight: '900',
  color: T.text,
  fontFamily: SYSTEM_SANS,
},
  webTitle: {
    marginTop: 20,
    fontSize: 36,
    lineHeight: 43,
    letterSpacing: 0,
  },
  mobileSubtitle: {
    marginTop: 8,
    fontSize: 14,
    lineHeight: 20,
    color: T.sub,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },
  webSubtitle: {
    marginTop: 10,
    fontSize: 15.5,
    lineHeight: 23,
    maxWidth: 380,
  },

  authCard: {
    backgroundColor: T.card2,
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 18 },
  },
  authCardMobile: {
    width: '100%',
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 24,
    backgroundColor: '#101010',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.065)',
  },
  authCardWeb: {
    borderRadius: 26,
    backgroundColor: 'rgba(17,17,17,0.94)',
    borderColor: 'rgba(255,255,255,0.095)',
    shadowColor: '#000',
    shadowOpacity: 0.64,
    shadowRadius: 42,
    shadowOffset: { width: 0, height: 26 },
    // @ts-ignore - web only
    backdropFilter: 'blur(14px) saturate(120%)',
    // @ts-ignore - web only
    WebkitBackdropFilter: 'blur(14px) saturate(120%)',
  },
  authCardDesktopWeb: {
    borderRadius: 22,
    shadowOpacity: 0.42,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
  },
  desktopFormHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  desktopFormIcon: {
    width: 58,
    height: 58,
    marginBottom: 14,
  },
  desktopFormTitle: {
    fontSize: 22,
    lineHeight: 28,
    fontWeight: '900',
    letterSpacing: 0,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },
  desktopFormSubtitle: {
    marginTop: 8,
    maxWidth: 330,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
    letterSpacing: 0,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  authHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  authTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: T.text,
    letterSpacing: 6.5,
    fontFamily: SYSTEM_SANS,
  },
  authTitleShort: {
    fontSize: 16,
    letterSpacing: 3.5,
  },

  subtitle: {
    marginTop: 8,
    marginBottom: 14,
    color: T.sub,
    fontSize: 14,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.11)',
    borderRadius: 15,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 12 : 12,
    backgroundColor: '#0B0B0B',
  },
  inputWrapWeb: {
    borderRadius: 17,
    paddingHorizontal: 17,
    paddingVertical: 14,
    backgroundColor: 'rgba(7,7,7,0.88)',
    borderColor: 'rgba(255,255,255,0.12)',
  },
  inputWrapFocused: {
    borderColor: T.olive,
    shadowColor: T.olive,
    shadowOpacity: 0.22,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
  },

  input: {
  flex: 1,
  paddingVertical: 2,
  color: T.text,
  fontSize: 15,
  fontFamily: SYSTEM_SANS,
},
inputWeb: {
  fontSize: 16,
  lineHeight: 22,
  outlineStyle: 'none' as any,
},
  forgotText: {
    color: T.mute,
    fontSize: 13,
    textDecorationLine: 'underline',
    fontFamily: SYSTEM_SANS,
  },

  button: {
    backgroundColor: T.accent,
    paddingVertical: 15,
    borderRadius: 14,
    alignItems: 'center',
    marginTop: 14,
    borderWidth: 1,
    borderColor: T.accent,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },
  buttonWeb: {
    paddingVertical: 16,
    borderRadius: 17,
    shadowOpacity: 0.38,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },
  buttonText: {
    color: DARK_BG,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  buttonTextWeb: {
    fontSize: 15.5,
    letterSpacing: 2,
  },

  link: {
    textAlign: 'center',
    color: T.text,
    fontWeight: '800',
    fontFamily: SYSTEM_SANS,
  },

  supportText: {
    marginTop: 18,
    textAlign: 'center',
    fontSize: 13,
    lineHeight: 18,
    color: T.mute,
    fontFamily: SYSTEM_SANS,
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  modalCard: {
    backgroundColor: T.card2,
    borderRadius: CARD_RADIUS,
    padding: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.55,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 18 },
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 8,
  },
  featureIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: T.text,
    letterSpacing: 0.4,
    fontFamily: SYSTEM_SANS,
  },
  modalDetail: {
    fontSize: 14,
    lineHeight: 20,
    color: T.sub,
    marginTop: 6,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },
  modalButtonsRow: {
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'flex-end',
    marginTop: 16,
  },
  modalSecondary: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    backgroundColor: '#0C0C0C',
  },
  modalSecondaryText: {
    color: T.text,
    fontWeight: '900',
    letterSpacing: 1,
    fontFamily: SYSTEM_SANS,
  },
  modalPrimary: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: T.accent,
    borderWidth: 1,
    borderColor: T.accent,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
  },
  modalPrimaryText: {
    color: DARK_BG,
    fontWeight: '900',
    letterSpacing: 1.2,
    fontFamily: SYSTEM_SANS,
  },

  // Kept to avoid breaking old references if you restore earlier landing sections.
  topBarWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(13,13,13,0.94)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DIVIDER,
    zIndex: 20,
  },
  topBarInner: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    position: 'relative',
    // @ts-ignore
    backdropFilter: 'saturate(135%) blur(10px)',
    // @ts-ignore
    WebkitBackdropFilter: 'saturate(135%) blur(10px)',
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: TEXT_IVORY,
    letterSpacing: 2.2,
    fontFamily: SYSTEM_SANS,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
});
