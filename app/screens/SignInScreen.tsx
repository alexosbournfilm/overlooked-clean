// app/screens/SignInScreen.tsx
// ------------------------------------------------------------
// FULL PAYWALL-FREE VERSION (UPDATED SIGN-IN LOGIC)
// + ✅ Handles email-confirm deep links (PKCE exchange) on /signin
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
  Image,
  UIManager,
} from 'react-native';
import * as Linking from 'expo-linking';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';

// NOTE: kept for your file structure stability
import { resetToMain } from '../navigation/navigationRef';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/*
 ────────────────────────────────────────────────────────────
   UI FIXES APPLIED (per your screenshots)
 ────────────────────────────────────────────────────────────
   ✅ Sign-in modal + feature/info modals are smaller + perfectly centered on mobile
   ✅ Modals never fall off-screen (maxHeight + internal scroll)
   ✅ No sideways scrolling / horizontal “white space” on mobile (RN + RN-web)
   ✅ "FILM FESTIVAL 2026" is no longer in a pill — now epic text
   ✅ Removed the “Top 2 highest voted films…Rome…” pill entirely
 ────────────────────────────────────────────────────────────
   CONTENT UPDATES (per your latest message)
 ────────────────────────────────────────────────────────────
   ✅ Monthly Film Challenge info now mentions:
      - Top 2 highest-voted films each month screen at Overlooked Film Festival 2026
      - July in Rome (exact date TBC)
   ✅ “What is OverLooked?” now mentions the movement:
      - networking, collaboration, filming, visibility, awards accessible
   ✅ Added new info cards at the bottom:
      - How do I apply for the festival?
      - Bi-weekly livestreams reacting/reviewing random submissions (spotlight all levels)
      - Workshop tools updated every Friday
 ────────────────────────────────────────────────────────────
*/

// --- THEME --------------------------------------------------
const DARK_BG = '#0D0D0D';
const DARK_ELEVATED = '#171717';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = '#A7A6A2';
const DIVIDER = '#2A2A2A';
const GOLD = '#C6A664';

const SYSTEM_SANS =
  Platform.select({ ios: 'System', android: 'Roboto', web: undefined }) || undefined;

const T = {
  bg: DARK_BG,
  card: DARK_ELEVATED,
  card2: '#111111',
  text: TEXT_IVORY,
  sub: '#D0CEC8',
  mute: TEXT_MUTED,
  accent: GOLD,
  olive: GOLD,
  border: '#2E2E2E',
};

// --- REMOVE GRAIN COMPLETELY (safe for all platforms) ---
const Grain = () => null;

// --- Typing animation text ---------------------------------
const MANIFESTO_LINES = [
  'Meet your crew this month. Make a film together.',
  'No gatekeepers. Just collaborators, jobs, and a deadline.',
  'Post a job. Apply to one. Start filming.',
  'Submit your film to the monthly challenge.',
  'The industry makes you wait. We say don’t.',
];

const FILM_HERO_URL =
  'https://images.unsplash.com/photo-1524255684952-d7185b509571?q=80&w=1600&auto=format&fit=crop';

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

// --- Feature cards -----------------------------------------
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
    subtitle: 'Top 2 screen in Rome (July)',
    icon: 'trophy',
    detail:
      'Upload a 1–15 minute film each month and climb the leaderboard. The top 2 highest-voted films every month will be screened at the Overlooked Film Festival 2026 this July in Rome (exact date yet to be decided).',
    cta: 'See this month',
    route: 'Featured',
  },
];

// --- FAQ data ----------------------------------------------
const EXTRA_FAQS = [
  // ✅ NEW — top question + capital I
  {
    title: 'Is Overlooked free?',
    body: 'Yes — it’s entirely free to join. No card details required, just an email.',
  },

  {
    title: 'How do I join my city chat?',
    body: 'Go to Location, search your city, then tap “Join City Chat”.',
  },
  {
    title: 'What counts as a valid submission?',
    body: 'A 1–15 min film made for this month. Avoid copyrighted music.',
  },
  {
    title: 'How do jobs work?',
    body: 'Apply to a job and your profile is attached automatically for the poster.',
  },
  {
    title: 'Can I vote more than once?',
    body: 'You can vote once per film, and not on your own submissions.',
  },

  // ✅ NEW — Festival application / how it works (community voting)
  {
    title: 'How do I apply for the festival?',
    body:
      'You don’t apply in the traditional way — the community decides. Each month, films are ranked by votes from real users. The top 2 highest-voted films each month will be screened at the Overlooked Film Festival 2026 in July in Rome (exact date TBC). No judges — it’s the community we build.',
  },

  // ✅ NEW — Livestreams spotlighting all levels (random picks)
  {
    title: 'Live streams (bi-weekly reactions & reviews)',
    body:
      'Every two weeks we go live reacting to and reviewing OverLooked film submissions picked at random — not just the highest-voted films. We give spotlight to all levels of filmmakers.',
  },

  // ✅ NEW — Workshop tools updated weekly
  {
    title: 'Workshop (tools updated every Friday)',
    body:
      'The Workshop is where you’ll find filmmaking tools and editing tools to level up. It updates every Friday with new tools to help improve your filmmaking journey.',
  },
];

// --- Hover/press animation ----------------------------------
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

export default function SignInScreen() {
  const navigation = useNavigation<any>();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isWide = width >= 980;
  const isPhone = width < 420;
  const isNarrowNav = width < 520;
  const isTinyNav = width < 360;

  // Helps “short phones” fit modals properly
  const isShort = height < 720;

  // Mobile nav was getting cramped/overflowing.
  const NAV_HEIGHT = isWide ? 56 : isNarrowNav ? 108 : 48;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSignIn, setShowSignIn] = useState(false);
  const [activeFeature, setActiveFeature] = useState<FeatureKey | null>(null);

  const [aboutOpen, setAboutOpen] = useState(false);
  const [whyOpen, setWhyOpen] = useState(false);
  const [openFaqs, setOpenFaqs] = useState<number[]>([]);

  const [featuresHeight, setFeaturesHeight] = useState<number>(0);
  const useSyncedHeights = isWide && featuresHeight > 0;
  const heroSyncedHeight = useSyncedHeights ? Math.max(0, featuresHeight) : undefined;

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

  // ✅ NEW: prevent double-running redirects (common cause of flashes)
  const didFinishRedirectRef = useRef(false);
  const deepLinkHandledRef = useRef<string | null>(null);

  const showError = (title: string, message: string) => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      try {
        window.alert(`${title}\n\n${message}`);
        return;
      } catch {}
    }
    Alert.alert(title, message);
  };

  /**
   * ✅ IMPORTANT CHANGE (flash fix):
   * SignInScreen should NOT reset navigation to MainTabs/CreateProfile.
   * AppNavigator owns switching between Auth/Main based on useAuth().
   *
   * This function now only:
   * - checks if a profile exists
   * - (optionally) navigates to CreateProfile INSIDE Auth stack
   * - otherwise does NOTHING and lets AppNavigator swap trees.
   */
  const finishPostAuthRedirect = async () => {
    if (didFinishRedirectRef.current) return;
    didFinishRedirectRef.current = true;

    const { data: u } = await supabase.auth.getUser();
    const userId = u?.user?.id;

    if (!userId) return;

    const { data: profile, error: profileError } = await supabase
      .from('users')
      .select('id')
      .eq('id', userId)
      .maybeSingle();

    if (profileError) {
      console.log('Profile fetch error:', profileError);
      showError('Error', 'Could not load your profile. Please try again.');
      return;
    }

    // If the user has no profile row, ensure they land on CreateProfile (AuthStack screen)
    if (!profile) {
      try {
        navigation.navigate('CreateProfile');
      } catch {}
      return;
    }

    // ✅ If profile exists: DO NOTHING.
    // AppNavigator will render MainTabs automatically once useAuth() updates.
    // (Keeping this no-op for stability)
  };

  const handleAuthDeepLink = async (url: string) => {
    try {
      if (!url || !url.includes('code=')) return;

      // ✅ Deduplicate same deep link (prevents double exchange + flicker)
      if (deepLinkHandledRef.current === url) return;
      deepLinkHandledRef.current = url;

      const { error } = await supabase.auth.exchangeCodeForSession(url);

      if (error) {
        console.log('exchangeCodeForSession error:', error);
        showError(
          'Email Confirmation',
          'Could not finish email confirmation. Please open the newest confirmation email link again.'
        );
        return;
      }

      if (Platform.OS === 'web' && typeof window !== 'undefined') {
        const clean = window.location.origin + window.location.pathname;
        window.history.replaceState({}, document.title, clean);
      }

      await finishPostAuthRedirect();
    } catch (e) {
      console.log('handleAuthDeepLink exception:', e);
    }
  };

  useEffect(() => {
    let unsub: (() => void) | undefined;
    let mounted = true;

    const init = async () => {
      // ✅ If there's already a session, don't hard-reset navigation.
      // Just make sure CreateProfile is reachable if needed.
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        if (!mounted) return;

        if (sessionData?.session?.user) {
          await finishPostAuthRedirect();
          return;
        }

        if (Platform.OS === 'web' && typeof window !== 'undefined') {
          await handleAuthDeepLink(window.location.href);
        } else {
          const initial = await Linking.getInitialURL();
          if (initial) await handleAuthDeepLink(initial);
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
    const id = setInterval(() => setCaretVisible((v) => !v), CARET_BLINK_MS);
    return () => clearInterval(id);
  }, []);

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
  }, [displayText, isDeleting, fullLine]);

  const handleSignIn = async () => {
    const trimmedEmail = email.trim();

    if (!trimmedEmail || !password) {
      showError('Sign in to continue', 'Enter your email and password.');
      return;
    }

    if (loading) return;
    setLoading(true);

    try {
      // ✅ reset redirect guard for a fresh login attempt
      didFinishRedirectRef.current = false;

      const { data, error } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password,
      });

      if (error) {
        showError('Login Error', error.message);
        return;
      }

      const userId = data?.user?.id;
      if (!userId) {
        showError('Error', 'Login failed. Please try again.');
        return;
      }

      const isConfirmed = !!data?.user?.email_confirmed_at;
      if (!isConfirmed) {
        showError(
          'Email not confirmed',
          'Please confirm your email first, then try signing in again.'
        );
        return;
      }

      setShowSignIn(false);

      // ✅ IMPORTANT: no navigation.reset() here.
      // Let AppNavigator switch trees; we only route to CreateProfile if needed.
      await finishPostAuthRedirect();

      // keep your import stable (no-op)
      void resetToMain;
    } catch (err: any) {
      console.log('SignIn exception:', err);
      showError('Login Error', 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ✅ Modal sizing helpers (prevents falling out of frame)
  const MODAL_SIDE_PAD = isPhone ? 14 : 18;
  const maxModalWidth = (cap: number) => Math.min(cap, Math.max(260, width - MODAL_SIDE_PAD * 2));
  const modalMaxHeight = Math.max(260, height - insets.top - insets.bottom - 24);

  return (
    <SafeAreaView
      style={[
        { flex: 1, backgroundColor: T.bg },
        // ✅ Prevent horizontal scroll / white space on RN-web (mobile browser)
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
        {/* BG */}
        <View style={styles.bgSolid} />
        <View style={styles.radialGlowTop} pointerEvents="none" />
        <View style={styles.radialGlowBottom} pointerEvents="none" />

        {/* TOP BAR */}
        <View
          style={[
            styles.topBarWrapper,
            { paddingTop: insets.top, height: NAV_HEIGHT + insets.top },
          ]}
        >
          <View
            style={[
              styles.topBarInner,
              isNarrowNav && styles.topBarInnerNarrow,
              isTinyNav && styles.topBarInnerTiny,
              width < 420 && { paddingHorizontal: 12 },
              { height: NAV_HEIGHT },
              // ✅ ensure no accidental horizontal overflow
              Platform.OS === 'web' ? ({ overflowX: 'hidden' } as any) : null,
            ]}
          >
            {!isNarrowNav && (
              <>
                <Pressable onPress={() => navigation.navigate('Featured')} style={styles.brandWrap}>
                  <Animated.Text
                    style={[
                      styles.brandTitle,
                      { opacity: titleOpacity, transform: [{ translateY: titleTranslate }] },
                    ]}
                  >
                    OVERLOOKED
                  </Animated.Text>
                </Pressable>

                {/* ✅ EPIC TEXT (no pill) */}
                <View style={styles.festivalCenterWrap} pointerEvents="none">
                  <Text style={styles.festivalEpicText}>FILM FESTIVAL 2026</Text>
                  <View style={styles.festivalEpicUnderline} />
                </View>

                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    onPress={() => navigation.navigate('SignUp')}
                    style={styles.primaryChip}
                  >
                    <Text style={styles.primaryChipText}>Create an account</Text>
                  </TouchableOpacity>

                  <TouchableOpacity onPress={() => setShowSignIn(true)} style={styles.textAction}>
                    <Text style={styles.textActionText}>Sign in</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}

            {isNarrowNav && (
              <>
                <View style={styles.navRowTop}>
                  <Pressable
                    onPress={() => navigation.navigate('Featured')}
                    style={styles.brandWrapNarrow}
                  >
                    <Animated.Text
                      style={[
                        styles.brandTitle,
                        styles.brandTitleNarrow,
                        { opacity: titleOpacity, transform: [{ translateY: titleTranslate }] },
                      ]}
                    >
                      OVERLOOKED
                    </Animated.Text>
                  </Pressable>
                </View>

                {/* ✅ EPIC TEXT (no pill) */}
                <View style={styles.navRowMid} pointerEvents="none">
                  <Text style={styles.festivalEpicTextNarrow}>FILM FESTIVAL 2026</Text>
                  <View style={styles.festivalEpicUnderlineNarrow} />
                </View>

                <View style={styles.navRowBottom}>
                  <View style={styles.actionsRowNarrow}>
                    <TouchableOpacity
                      onPress={() => navigation.navigate('SignUp')}
                      style={[
                        styles.primaryChip,
                        styles.primaryChipNarrow,
                        isTinyNav && styles.primaryChipTiny,
                      ]}
                    >
                      <Text style={[styles.primaryChipText, isTinyNav && styles.primaryChipTextTiny]}>
                        Create an account
                      </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      onPress={() => setShowSignIn(true)}
                      style={[styles.textAction, styles.textActionNarrow]}
                    >
                      <Text style={[styles.textActionText, isTinyNav && styles.textActionTextTiny]}>
                        Sign in
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </>
            )}
          </View>
        </View>

        {/* ---------------- MAIN SCROLL ---------------- */}
        <ScrollView
          style={[
            { flex: 1, backgroundColor: T.bg },
            // ✅ Stop web overscroll revealing white + prevent horizontal scroll on mobile web
            Platform.OS === 'web'
              ? ({ overscrollBehavior: 'none', overflowX: 'hidden' } as any)
              : null,
          ]}
          contentContainerStyle={[
            styles.scrollBody,
            {
              backgroundColor: T.bg,
              paddingTop: NAV_HEIGHT + insets.top + 18,
              paddingHorizontal: width < 420 ? 16 : 28,
              paddingBottom: 64 + Math.max(insets.bottom, 0),
              minHeight: Math.max(0, height - (NAV_HEIGHT + insets.top)),
              // ✅ hard clamp to avoid any child causing sideways scroll
              width: '100%',
              overflow: 'hidden',
            } as any,
          ]}
          keyboardShouldPersistTaps="handled"
          bounces={false}
          overScrollMode="never"
          showsVerticalScrollIndicator={false}
          directionalLockEnabled
        >
          <View
            style={[
              styles.wrap,
              !isWide && {
                flexDirection: 'column',
                flexWrap: 'nowrap',
                gap: 18,
              },
            ]}
          >
            {/* HERO SECTION */}
            <View
              style={[
                styles.heroCol,
                !isWide && {
                  flexBasis: 'auto',
                  maxWidth: '100%',
                  width: '100%',
                  alignSelf: 'stretch',
                  gap: 12,
                },
              ]}
            >
              {/* TEXT */}
              <View
                style={[
                  styles.heroIntro,
                  !isWide && {
                    alignItems: 'center',
                    maxWidth: '100%',
                    width: '100%',
                    alignSelf: 'stretch',
                  },
                ]}
              >
                <Text
                  style={[
                    styles.heroH1,
                    !isWide && {
                      textAlign: 'center',
                      fontSize: isPhone ? 22 : 24,
                      lineHeight: isPhone ? 28 : 30,
                    },
                  ]}
                >
                  Stop waiting to be discovered. Start creating.
                </Text>

                <Text
                  style={[
                    styles.heroCopy,
                    !isWide && {
                      textAlign: 'center',
                      fontSize: 14.5,
                      lineHeight: 20.5,
                    },
                  ]}
                >
                  Meet collaborators, make a film each month, get seen by the community.
                </Text>

                <View style={[styles.manifestoWrap, !isWide && { marginTop: 10 }]}>
                  <Text
                    numberOfLines={2}
                    style={[
                      styles.manifestoText,
                      !isWide && { textAlign: 'center', fontSize: 13 },
                    ]}
                  >
                    {displayText}
                    <Text style={{ opacity: caretVisible ? 1 : 0 }}>|</Text>
                  </Text>
                </View>
              </View>

              {/* HERO IMAGE */}
              <View
                style={[
                  styles.heroImage,
                  useSyncedHeights ? { height: heroSyncedHeight } : { aspectRatio: 1.8 },
                  !isWide && { marginTop: 12 },
                ]}
              >
                <Image
                  source={{ uri: FILM_HERO_URL }}
                  resizeMode="cover"
                  style={[
                    { position: 'absolute', left: 0, right: 0, width: '100%' },
                    useSyncedHeights
                      ? { top: -90, height: (heroSyncedHeight ?? 0) + 90 }
                      : { top: 0, bottom: 0, height: '100%' },
                  ]}
                />
                <View style={styles.heroOverlay} pointerEvents="none" />
              </View>
            </View>

            {/* FEATURES LIST */}
            <View
              style={[
                styles.cardCol,
                isWide ? { marginTop: 10 } : { maxWidth: '100%', width: '100%' },
              ]}
            >
              <View
                style={styles.featuresSection}
                onLayout={(e) => setFeaturesHeight(Math.round(e.nativeEvent.layout.height))}
              >
                {FEATURES.map((f, idx) => {
                  const { scale, hovered, onHoverIn, onHoverOut, onPressIn, onPressOut } =
                    useHoverScale();

                  return (
                    <Pressable
                      key={f.key}
                      onPress={() => setActiveFeature(f.key)}
                      onHoverIn={onHoverIn}
                      onHoverOut={onHoverOut}
                      onPressIn={onPressIn}
                      onPressOut={onPressOut}
                    >
                      <Animated.View
                        style={[
                          styles.featureItem,
                          idx === FEATURES.length - 1 && { borderBottomWidth: 0 },
                          { transform: [{ scale }] },
                          hovered && styles.hoveredShadow,
                        ]}
                      >
                        <View style={styles.featureNumber}>
                          <Text style={styles.featureNumberText}>{idx + 1}</Text>
                        </View>

                        <View style={styles.featureIconWrap}>
                          <Ionicons name={f.icon} size={18} color={T.olive} />
                        </View>

                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={styles.featureTitle} numberOfLines={1}>
                            {f.title}
                          </Text>
                          <Text style={[styles.featureSubtitle]} numberOfLines={1}>
                            {f.subtitle}
                          </Text>
                        </View>

                        <Ionicons
                          style={{ marginLeft: 6 }}
                          name="chevron-forward"
                          size={18}
                          color={T.olive}
                        />
                      </Animated.View>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* --- EXPANDED CARDS (About, Why, FAQ) --- */}
            <View style={[styles.fullWidthRow, !isWide && { marginTop: 4 }]}>
              <View style={[styles.collapsibleCard, styles.fullCard]}>
                <Pressable onPress={() => setAboutOpen((v) => !v)}>
                  <View style={styles.collapsibleHeaderPressFull}>
                    <View style={styles.centerRow}>
                      <View style={styles.badgeIcon}>
                        <Ionicons name="help-circle" size={18} color={T.olive} />
                      </View>
                      <Text style={styles.collapsibleTitle}>What is OverLooked?</Text>
                    </View>
                    <Ionicons
                      style={styles.chevAbs}
                      name={aboutOpen ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={T.olive}
                    />
                  </View>
                </Pressable>

                {aboutOpen && (
                  <View style={styles.aboutBody}>
                    <Text style={styles.aboutLead}>
                      OverLooked is a home for indie filmmaking — and a movement to make networking,
                      collaboration, filming, visibility, and awards more accessible. Meet collaborators,
                      build real momentum, and let the community decide what rises.
                    </Text>
                  </View>
                )}
              </View>

              <View style={[styles.collapsibleCard, styles.fullCard]}>
                <Pressable onPress={() => setWhyOpen((v) => !v)}>
                  <View style={styles.collapsibleHeaderPressFull}>
                    <View style={styles.centerRow}>
                      <View style={styles.badgeIcon}>
                        <Ionicons name="help-circle" size={18} color={T.olive} />
                      </View>
                      <Text style={styles.collapsibleTitle}>Why a monthly film challenge?</Text>
                    </View>
                    <Ionicons
                      style={styles.chevAbs}
                      name={whyOpen ? 'chevron-up' : 'chevron-down'}
                      size={18}
                      color={T.olive}
                    />
                  </View>
                </Pressable>

                {whyOpen && (
                  <View style={{ paddingHorizontal: 18, paddingBottom: 16 }}>
                    <Text style={styles.whyText}>
                      Deadlines create momentum. One month is enough to plan, shoot, edit, and publish.
                    </Text>
                  </View>
                )}
              </View>

              {EXTRA_FAQS.map((q, i) => {
                const open = openFaqs.includes(i);
                return (
                  <View key={q.title} style={[styles.collapsibleCard, styles.fullCard]}>
                    <Pressable
                      onPress={() =>
                        setOpenFaqs((p) => (p.includes(i) ? p.filter((x) => x !== i) : [...p, i]))
                      }
                    >
                      <View style={styles.collapsibleHeaderPressFull}>
                        <View style={styles.centerRow}>
                          <View style={styles.badgeIcon}>
                            <Ionicons name="help-circle" size={18} color={T.olive} />
                          </View>
                          <Text style={styles.collapsibleTitle}>{q.title}</Text>
                        </View>
                        <Ionicons
                          style={styles.chevAbs}
                          name={open ? 'chevron-up' : 'chevron-down'}
                          size={18}
                          color={T.olive}
                        />
                      </View>
                    </Pressable>

                    {open && (
                      <View style={{ paddingHorizontal: 18, paddingBottom: 16 }}>
                        <Text style={styles.aboutText}>{q.body}</Text>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          </View>
        </ScrollView>

        {/* SIGN-IN MODAL */}
        <Modal
          transparent
          visible={showSignIn}
          animationType="fade"
          onRequestClose={() => setShowSignIn(false)}
        >
          <View style={[styles.modalBackdrop, isShort && styles.modalBackdropShort]}>
            <KeyboardAvoidingView
              behavior={Platform.OS === 'ios' ? 'padding' : undefined}
              style={{ width: '100%', alignItems: 'center' }}
            >
              <View
                style={[
                  styles.authCard,
                  {
                    width: maxModalWidth(460),
                    maxHeight: modalMaxHeight,
                    alignSelf: 'center',
                    padding: isShort ? 16 : 20,
                  },
                ]}
              >
                <ScrollView
                  keyboardShouldPersistTaps="handled"
                  showsVerticalScrollIndicator={false}
                  bounces={false}
                  overScrollMode="never"
                  contentContainerStyle={{ paddingBottom: 14 }}
                >
                  <View style={styles.authHeader}>
                    <Text style={[styles.authTitle, isShort && styles.authTitleShort]}>
                      WELCOME BACK
                    </Text>
                    <Pressable onPress={() => setShowSignIn(false)} hitSlop={10}>
                      <Ionicons name="close" size={20} color={T.sub} />
                    </Pressable>
                  </View>

                  <Text style={styles.subtitle}>Sign in to join this month’s journey.</Text>

                  <View style={[styles.inputWrap, focus === 'email' && styles.inputWrapFocused]}>
                    <Ionicons name="mail" size={16} color={focus === 'email' ? T.olive : T.mute} />
                    <TextInput
                      style={styles.input}
                      placeholder="Email"
                      placeholderTextColor={T.mute}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      value={email}
                      onChangeText={setEmail}
                      returnKeyType="next"
                      onFocus={() => setFocus('email')}
                      onBlur={() => setFocus((prev) => (prev === 'email' ? null : prev))}
                    />
                  </View>

                  <View
                    style={[
                      styles.inputWrap,
                      { marginTop: 12 },
                      focus === 'password' && styles.inputWrapFocused,
                    ]}
                  >
                    <Ionicons
                      name="lock-closed"
                      size={16}
                      color={focus === 'password' ? T.olive : T.mute}
                    />
                    <TextInput
                      style={styles.input}
                      placeholder="Password"
                      placeholderTextColor={T.mute}
                      secureTextEntry
                      value={password}
                      onChangeText={setPassword}
                      returnKeyType="done"
                      onSubmitEditing={handleSignIn}
                      onFocus={() => setFocus('password')}
                      onBlur={() => setFocus((prev) => (prev === 'password' ? null : prev))}
                    />
                  </View>

                  <TouchableOpacity
                    onPress={() => {
                      setShowSignIn(false);
                      navigation.navigate('ForgotPassword');
                    }}
                    style={{ marginTop: 8 }}
                  >
                    <Text
                      style={{
                        color: T.mute,
                        fontSize: 13,
                        textDecorationLine: 'underline',
                        fontFamily: SYSTEM_SANS,
                      }}
                    >
                      Forgot password?
                    </Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.button, loading && { opacity: 0.9 }]}
                    onPress={handleSignIn}
                    disabled={loading}
                  >
                    {loading ? (
                      <ActivityIndicator color={DARK_BG} />
                    ) : (
                      <Text style={styles.buttonText}>Sign In</Text>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => {
                      setShowSignIn(false);
                      navigation.navigate('SignUp');
                    }}
                    style={{ marginTop: 16 }}
                  >
                    <Text style={styles.link}>
                      New to OverLooked?{' '}
                      <Text style={{ textDecorationLine: 'underline' }}>Create an account</Text>
                    </Text>
                  </TouchableOpacity>
                </ScrollView>
              </View>
            </KeyboardAvoidingView>
          </View>
        </Modal>

        {/* FEATURE DETAIL MODAL */}
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
// ------------------------------------------------------------
// STYLES
// ------------------------------------------------------------

const CARD_RADIUS = 16;

const styles = StyleSheet.create({
  bgSolid: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: T.bg,
  },
  radialGlowTop: {
    position: 'absolute',
    top: -140,
    left: -110,
    width: 340,
    height: 340,
    borderRadius: 340,
    backgroundColor: 'rgba(198,166,100,0.15)',
    opacity: 0.9,
  },
  radialGlowBottom: {
    position: 'absolute',
    right: -120,
    bottom: -120,
    width: 360,
    height: 360,
    borderRadius: 360,
    backgroundColor: 'rgba(198,166,100,0.08)',
    opacity: 0.9,
  },

  topBarWrapper: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(13,13,13,0.96)',
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
    // @ts-ignore — web-only blur
    backdropFilter: 'saturate(120%) blur(8px)',
    // @ts-ignore
    WebkitBackdropFilter: 'saturate(120%) blur(8px)',
  },

  topBarInnerNarrow: {
    flexDirection: 'column',
    justifyContent: 'center',
    alignItems: 'stretch',
    gap: 8,
    paddingTop: 10,
    paddingBottom: 10,
  },
  topBarInnerTiny: {
    paddingTop: 8,
    paddingBottom: 8,
  },

  navRowTop: { alignItems: 'center', justifyContent: 'center' },
  navRowMid: { alignItems: 'center', justifyContent: 'center' },
  navRowBottom: { alignItems: 'center', justifyContent: 'center' },

  brandWrap: { paddingVertical: 4, paddingRight: 8 },
  brandWrapNarrow: { paddingVertical: 0 },
  brandTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: TEXT_IVORY,
    letterSpacing: 2.2,
    fontFamily: SYSTEM_SANS,
  },
  brandTitleNarrow: {
    fontSize: 17,
    letterSpacing: 2,
  },

  festivalCenterWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '50%',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -20,
  },

  // ✅ EPIC TEXT (no pill)
  festivalEpicText: {
    color: T.text,
    fontSize: 15.5,
    fontWeight: '900',
    letterSpacing: 3.2,
    fontFamily: SYSTEM_SANS,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(198,166,100,0.35)',
    textShadowOffset: { width: 0, height: 10 },
    textShadowRadius: 18,
  },
  festivalEpicUnderline: {
    marginTop: 6,
    width: 120,
    height: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(198,166,100,0.75)',
    opacity: 0.95,
  },

  festivalEpicTextNarrow: {
    color: T.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: 3.4,
    fontFamily: SYSTEM_SANS,
    textTransform: 'uppercase',
    textShadowColor: 'rgba(198,166,100,0.35)',
    textShadowOffset: { width: 0, height: 10 },
    textShadowRadius: 18,
  },
  festivalEpicUnderlineNarrow: {
    marginTop: 6,
    width: 130,
    height: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(198,166,100,0.75)',
    opacity: 0.95,
  },

  actionsRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionsRowNarrow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: 10,
  },

  primaryChip: {
    backgroundColor: GOLD,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
  },
  primaryChipNarrow: { paddingVertical: 8, paddingHorizontal: 12 },
  primaryChipTiny: { paddingVertical: 7, paddingHorizontal: 10 },
  primaryChipText: {
    color: DARK_BG,
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 1.2,
    fontFamily: SYSTEM_SANS,
    textTransform: 'uppercase',
  },
  primaryChipTextTiny: { fontSize: 12.5, letterSpacing: 1.05 },

  textAction: { paddingVertical: 8, paddingHorizontal: 10, borderRadius: 999 },
  textActionNarrow: { paddingVertical: 8, paddingHorizontal: 12 },
  textActionText: { color: TEXT_IVORY, fontWeight: '800', fontFamily: SYSTEM_SANS },
  textActionTextTiny: { fontSize: 13 },

  scrollBody: { paddingHorizontal: 28, paddingBottom: 64 },

  wrap: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    gap: 28,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },

  heroCol: { flexGrow: 1, flexBasis: 540, maxWidth: 780, gap: 16 },
  heroIntro: { maxWidth: 680, width: '100%' },

  heroH1: {
    marginTop: 4,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '900',
    color: T.text,
    letterSpacing: 0.4,
    fontFamily: SYSTEM_SANS,
  },
  heroCopy: {
    marginTop: 10,
    fontSize: 16,
    lineHeight: 24,
    color: T.sub,
    fontFamily: SYSTEM_SANS,
  },

  manifestoWrap: { marginTop: 12 },
  manifestoText: {
    textAlign: 'left',
    color: T.mute,
    letterSpacing: 0.15,
    fontSize: 13.5,
    fontFamily: SYSTEM_SANS,
  },

  heroImage: {
    marginTop: 16,
    width: '100%',
    borderRadius: CARD_RADIUS,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: T.border,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    backgroundColor: '#111',
  },
  heroOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.38)' },

  cardCol: { flexGrow: 1, flexBasis: 420, maxWidth: 500 },

  featuresSection: {
    marginTop: 16,
    backgroundColor: T.card,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: T.border,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  featureItem: {
    paddingHorizontal: 16,
    paddingRight: 20,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: T.border,
    backgroundColor: T.card,
    minHeight: 60,
  },
  hoveredShadow: {
    shadowOpacity: 0.5,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
  },
  featureNumber: {
    width: 28,
    height: 28,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: T.border,
  },
  featureNumberText: { fontSize: 12, fontWeight: '800', color: T.text, fontFamily: SYSTEM_SANS },
  featureIconWrap: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: T.border,
  },
  featureTitle: { fontSize: 15, fontWeight: '900', color: T.text, fontFamily: SYSTEM_SANS },
  featureSubtitle: { fontSize: 12.5, color: T.sub, fontFamily: SYSTEM_SANS },

  fullWidthRow: { width: '100%', flexBasis: '100%', gap: 16, marginTop: 8 },

  collapsibleCard: {
    backgroundColor: T.card,
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    borderColor: T.border,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    overflow: 'hidden',
    width: '100%',
  },
  fullCard: { width: '100%' },

  centerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  chevAbs: { position: 'absolute', right: 18, top: '50%', marginTop: -9 },

  collapsibleHeaderPressFull: {
    paddingHorizontal: 18,
    paddingRight: 48,
    paddingVertical: 16,
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },

  badgeIcon: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1,
    borderColor: T.border,
  },
  collapsibleTitle: {
    fontSize: 17,
    fontWeight: '900',
    color: T.text,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  aboutBody: { paddingHorizontal: 18, paddingBottom: 16, width: '100%' },
  aboutLead: {
    marginTop: 2,
    color: T.sub,
    fontSize: 14.5,
    lineHeight: 21.5,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },
  aboutText: {
    color: T.sub,
    fontSize: 14,
    lineHeight: 21,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },
  whyText: {
    color: T.sub,
    fontSize: 14,
    lineHeight: 21,
    paddingTop: 2,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },

  /* Modal backdrop */
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 18,
  },
  modalBackdropShort: {
    justifyContent: 'center',
    paddingTop: 12,
    paddingBottom: 12,
  },

  /* Auth card */
  authCard: {
    backgroundColor: T.card2,
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: T.border,
  },
  authHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  authTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: T.text,
    letterSpacing: 6.5,
    fontFamily: SYSTEM_SANS,
  },
  authTitleShort: { fontSize: 16, letterSpacing: 3.5 },

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
    borderColor: T.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: Platform.OS === 'web' ? 12 : 10,
    backgroundColor: '#0C0C0C',
  },
  inputWrapFocused: {
    borderColor: T.olive,
    shadowColor: T.olive,
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
  },

  input: {
    flex: 1,
    paddingVertical: 2,
    color: T.text,
    fontSize: 15,
    fontFamily: SYSTEM_SANS,
    outlineStyle: 'none',
  },

  button: {
    backgroundColor: T.accent,
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    marginTop: 14,
    borderWidth: 1,
    borderColor: T.accent,
  },
  buttonText: {
    color: DARK_BG,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 2,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },

  link: { textAlign: 'center', color: T.text, fontWeight: '800', fontFamily: SYSTEM_SANS },

  modalCard: {
    backgroundColor: T.card2,
    borderRadius: CARD_RADIUS,
    padding: 18,
    borderWidth: 1,
    borderColor: T.border,
  },
  modalHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
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
  modalButtonsRow: { flexDirection: 'row', gap: 10, justifyContent: 'flex-end', marginTop: 16 },
  modalSecondary: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: T.border,
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
  },
  modalPrimaryText: { color: DARK_BG, fontWeight: '900', letterSpacing: 1.2, fontFamily: SYSTEM_SANS },
});
