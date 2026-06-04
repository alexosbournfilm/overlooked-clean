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
} from 'react-native';
import * as Linking from 'expo-linking';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';

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

  const isWide = width >= 980;
  const isPhone = width < 420;
  const isShort = height < 720;
  const isWeb = Platform.OS === 'web';

  const isNativeMobile = Platform.OS === 'ios' || Platform.OS === 'android';
  const useSimpleMobileLayout = isNativeMobile;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showSignIn, setShowSignIn] = useState(!useSimpleMobileLayout);
  const [activeFeature, setActiveFeature] = useState<FeatureKey | null>(null);

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

  const handleEnterAsGuest = () => {
    try {
      const parentNav = navigation.getParent?.();

      if (parentNav) {
        parentNav.reset({
          index: 0,
          routes: [{ name: 'MainTabs' }],
        });
        return;
      }

      navigation.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      });
    } catch (e) {
      console.log('Guest navigation error:', e);
      showError('Navigation Error', 'Could not enter as guest.');
    }
  };

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
  const webCardWidth = Math.min(560, Math.max(330, width - 56));

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

      {mobileMode && (
  <View style={[styles.mobileHeader, isWeb && styles.webHeader]}>
    <Animated.Text
      style={[
        styles.mobileBrand,
        isWeb && styles.webBrand,
        { opacity: titleOpacity, transform: [{ translateY: titleTranslate }] },
      ]}
    >
      OVERLOOKED
    </Animated.Text>

    <Text style={[styles.heroPrompt, isWeb && styles.heroPromptWeb]}>
  <Text style={styles.heroHighlight}>Meet</Text> other creatives.{'\n'}
  <Text style={styles.heroHighlight}>Share</Text> your work worldwide.
</Text>

    <Text style={[styles.mobileTitle, isWeb && styles.webTitle]}>Sign in</Text>
    <Text style={[styles.mobileSubtitle, isWeb && styles.webSubtitle]}>
      Welcome back. Get straight into your account.
    </Text>
  </View>
)}

      {!mobileMode && <Text style={styles.subtitle}>Sign in to join this month’s journey.</Text>}

       <View
  style={[
    styles.inputWrap,
    isWeb && styles.inputWrapWeb,
    isWeb && focus === 'email' && styles.inputWrapFocused,
  ]}
>
        <Ionicons name="mail" size={17} color={focus === 'email' ? T.olive : T.mute} />
        <TextInput
          ref={emailInputRef}
          style={[styles.input, isWeb && styles.inputWeb]}
          placeholder="Email"
          placeholderTextColor={T.mute}
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
    isWeb && styles.inputWrapWeb,
    { marginTop: 14 },
    isWeb && focus === 'password' && styles.inputWrapFocused,
  ]}
>
        <Ionicons
          name="lock-closed"
          size={17}
          color={focus === 'password' ? T.olive : T.mute}
        />
        <TextInput
          ref={passwordInputRef}
          style={[styles.input, isWeb && styles.inputWeb]}
          placeholder="Password"
          placeholderTextColor={T.mute}
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
        <Text style={styles.forgotText}>Forgot password?</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={[
          styles.button,
          isWeb && styles.buttonWeb,
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
          <Text style={[styles.buttonText, isWeb && styles.buttonTextWeb]}>
            Sign In
          </Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => {
          if (!mobileMode) setShowSignIn(false);
          handleEnterAsGuest();
        }}
        style={{ marginTop: 16 }}
      >
        <Text style={styles.link}>
          <Text style={{ textDecorationLine: 'underline' }}>Enter without an account</Text>
        </Text>
      </TouchableOpacity>

      <TouchableOpacity
        onPress={() => {
          if (!mobileMode) setShowSignIn(false);
          navigation.navigate('SignUp');
        }}
        style={{ marginTop: 18 }}
      >
        <Text style={styles.link}>
          New to OverLooked?{' '}
          <Text style={{ textDecorationLine: 'underline' }}>Create an account</Text>
        </Text>
      </TouchableOpacity>

      <Text style={styles.supportText}>
        For support, message overlookedsupport@gmail.com
      </Text>
    </>
  );

  return (
    <View
      style={[
        styles.authCard,
        mobileMode ? styles.authCardMobile : null,
        isWeb && mobileMode ? styles.authCardWeb : null,
        {
          width: mobileMode ? (isWeb ? webCardWidth : '100%') : maxModalWidth(460),
          maxHeight: mobileMode ? undefined : modalMaxHeight,
          alignSelf: 'center',
          padding:
            mobileMode && isWeb
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
      {isNativeMobile && mobileMode ? (
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

  if (useSimpleMobileLayout) {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: T.bg }}>
      <View style={{ flex: 1 }}>
        <View style={styles.bgSolid} />
        <View style={styles.mobileGlowTop} pointerEvents="none" />
        <View style={styles.mobileGlowBottom} pointerEvents="none" />

        <ScrollView
          style={{ flex: 1 }}
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
    return (
    <SafeAreaView
      style={[
        { flex: 1, backgroundColor: T.bg },
        Platform.OS === 'web'
          ? ({
              minHeight: '100vh',
              overflowX: 'hidden',
            } as any)
          : ({ overflow: 'hidden' } as any),
      ]}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <View style={styles.bgSolid} />
        <View style={styles.webGradientBase} pointerEvents="none" />
        <View style={styles.webGlowCenter} pointerEvents="none" />
        <View style={styles.webGlowLeft} pointerEvents="none" />
        <View style={styles.webGlowRight} pointerEvents="none" />
        <View style={styles.webSoftVignette} pointerEvents="none" />

        <ScrollView
          style={[
            { flex: 1, backgroundColor: 'transparent' },
            Platform.OS === 'web'
              ? ({ overscrollBehavior: 'none', overflowX: 'hidden' } as any)
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

  mobileContainer: {
    flex: 1,
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
  letterSpacing: -0.2,
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
    letterSpacing: -0.4,
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
    paddingVertical: 15,
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
    paddingVertical: 17,
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
    marginTop: 20,
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
