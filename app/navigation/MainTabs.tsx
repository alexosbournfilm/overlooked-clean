// app/navigation/MainTabs.tsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import {
  TabActions,
  useNavigation,
  getFocusedRouteNameFromRoute,
} from '@react-navigation/native';
import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';
import {
  StyleSheet,
  View,
  Text,
  Platform,
  Pressable,
  useWindowDimensions,
  Animated,
  Easing,
  Modal,
  ScrollView,
  Image,
  ActivityIndicator,
  InteractionManager,
  
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { supabase } from '../lib/supabase';
import FeaturedScreen from '../screens/FeaturedScreen';
import JobsScreen from '../screens/JobsScreen';
import ChallengeScreen from '../screens/ChallengeScreen';
import LocationScreen from '../screens/LocationScreen';
import ChatsStack from './ChatsStack';
import ProfileScreen from '../screens/ProfileScreen';
import WorkshopScreen from '../screens/WorkshopScreen';
import WorkshopSubmitScreen from '../screens/WorkshopSubmitScreen';
import { useAuth } from '../context/AuthProvider';
import { subscribeChatBadgeRefresh } from '../lib/chatBadgeEvents';

import { SettingsModalProvider } from '../context/SettingsModalContext';
import SettingsButton from '../../components/SettingsButton';
import SettingsModal from '../../components/SettingsModal';

import { useMonthlyStreak } from '../lib/useMonthlyStreak';
import { registerAndSavePushToken } from '../lib/pushRegistration';

// NOTE: keeping this import because your file already has it.
import { useGamification } from '../context/GamificationContext';

const Tab = createBottomTabNavigator();

/* ------------------------------- palette ------------------------------- */
const DARK_BG = '#000000';
const DARK_ELEVATED = '#000000';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = '#A7A6A2';
const DIVIDER = '#2A2A2A';
const GOLD = '#C6A664';

/* ------------------------------- fonts --------------------------------- */
const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

/* ------------------------------- helpers ------------------------------- */

function withTimeout<T>(promise: Promise<T>, ms = 9000): Promise<T> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Request timed out')), ms);
    promise
      .then((v) => {
        clearTimeout(id);
        resolve(v);
      })
      .catch((e) => {
        clearTimeout(id);
        reject(e);
      });
  });
}

/* ----------------------- Smooth Hover / Press ----------------------- */

const HoverPress = memo(function HoverPress({
  children,
  style,
  onPress,
  disabled,
  hitSlop,
  accessibilityLabel,
}: {
  children: React.ReactNode;
  style?: any;
  onPress?: () => void;
  disabled?: boolean;
  hitSlop?: any;
  accessibilityLabel?: string;
}) {
  const shouldAnimate = Platform.OS === 'web';

  const scale = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;

  const to = useCallback((s: number, y: number, dur: number) => {
    if (!shouldAnimate) return;

    Animated.parallel([
      Animated.timing(scale, {
        toValue: s,
        duration: dur,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: y,
        duration: dur,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [lift, scale, shouldAnimate]);

  if (!shouldAnimate) {
    return (
      <Pressable
        accessibilityLabel={accessibilityLabel}
        disabled={disabled}
        hitSlop={hitSlop}
        onPress={onPress}
        style={style}
        android_ripple={{ color: 'rgba(255,255,255,0.06)', borderless: false }}
      >
        {children}
      </Pressable>
    );
  }

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      onHoverIn={() => to(1.03, -1.5, 140)}
      onHoverOut={() => to(1.0, 0, 160)}
      onPressIn={() => to(0.98, 0, 90)}
      onPressOut={() => to(1.0, 0, 140)}
      style={style}
    >
      <Animated.View style={{ transform: [{ translateY: lift }, { scale }] }}>
        {children}
      </Animated.View>
    </Pressable>
  );
});

/* --------------------------- Top Bar elements -------------------------- */

function BrandWordmark({ compact }: { compact?: boolean }) {
  return (
    <View style={styles.brandWrap}>
      <Text
  style={[
    styles.brandTitle,
    compact && (Platform.OS === 'web' ? styles.brandTitleCompactWeb : styles.brandTitleCompact),
  ]}
>
  OVERLOOKED
</Text>
    </View>
  );
}

/* ---------------------- STREAK Progress Bar --------------------- */

type TopBarStreakProgressProps = {
  variant: 'wide' | 'compact';
  compactUI?: boolean;
  barHeight?: number;
};

const TopBarStreakProgress = memo(function TopBarStreakProgress({
  variant,
  compactUI,
  barHeight,
}: TopBarStreakProgressProps) {
  const isWide = variant === 'wide';

  const { streak, loading } = useMonthlyStreak();
  const progressAnim = useRef(new Animated.Value(0)).current;

  const { targetMonths, yearLabel, pct, displayStreak } = useMemo(() => {
    const safe = Math.max(0, Number(streak || 0));
    const target = 12;

    const year = safe <= 0 ? 1 : Math.floor((safe - 1) / 12) + 1;
    const withinYear = safe <= 0 ? 0 : ((safe - 1) % 12) + 1;
    const fraction = target > 0 ? Math.min(1, withinYear / target) : 0;

    return {
      displayStreak: withinYear,
      targetMonths: target,
      yearLabel: year,
      pct: fraction,
    };
  }, [streak]);

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: pct,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [pct, progressAnim]);

  const widthInterpolated = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  const shimmerX = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (Platform.OS !== 'web') return;

    shimmerX.setValue(0);

    let loop: Animated.CompositeAnimation | null = null;
    let cancelled = false;

    const task = InteractionManager.runAfterInteractions(() => {
      if (cancelled) return;

      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(shimmerX, {
            toValue: 1,
            duration: 1400,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.delay(900),
        ])
      );

      loop.start();
    });

    return () => {
      cancelled = true;
      try {
        // @ts-ignore
        task?.cancel?.();
      } catch {}
      try {
        loop?.stop();
      } catch {}
    };
  }, [shimmerX]);

  const shimmerTranslate = shimmerX.interpolate({
    inputRange: [0, 1],
    outputRange: [-320, 760],
  });

  const resolvedHeight = barHeight ?? (compactUI ? 14 : 16);
  const compactText = resolvedHeight <= 22;

  return (
    <View style={[styles.streakWrap, isWide ? styles.streakWrapWide : styles.streakWrapCompact]}>
      <View
        style={[
          styles.streakBarOuter,
          isWide && styles.streakBarOuterWide,
          compactUI && styles.streakBarOuterCompactUI,
          { height: resolvedHeight },
        ]}
      >
        <Animated.View style={[styles.streakBarFill, { width: widthInterpolated }]} />
        <View pointerEvents="none" style={styles.streakGlass} />

        {Platform.OS === 'web' && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.streakShimmer,
              {
                transform: [{ translateX: shimmerTranslate }, { skewX: '-18deg' }],
              },
            ]}
          />
        )}

        <View
          style={[
            styles.streakBarOverlay,
            compactUI && { paddingHorizontal: 9 },
            compactText && { paddingHorizontal: 9 },
          ]}
        >
          <View style={styles.streakSidesRow}>
            <View style={styles.streakLeftGroup}>
              <Text
                style={[
                  styles.streakBarLeft,
                  compactUI && { fontSize: 6.8, letterSpacing: 0.7 },
                  compactText && { fontSize: 7.5, letterSpacing: 0.8 },
                ]}
              >
                STREAK
              </Text>
            </View>

            <Text
              style={[
                styles.streakBarRight,
                compactUI && { fontSize: 7.5 },
                compactText && { fontSize: 7.5 },
              ]}
            >
              Year {yearLabel}
            </Text>
          </View>

          <View
            pointerEvents="none"
            style={[
              styles.streakCenterAbs,
              compactUI && { paddingHorizontal: 52 },
              compactText && { paddingHorizontal: 52 },
            ]}
          >
            <Text
              style={[
                styles.streakBarCenter,
                compactUI && { fontSize: 7.5 },
                compactText && { fontSize: 7.5 },
              ]}
              numberOfLines={1}
            >
              {loading ? '—' : `${displayStreak}/${targetMonths}`}
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
});

/* --------------------------- Leaderboard Modal ------------------------- */

type LeaderboardTab = 'monthly' | 'allTime' | 'city';

type LeaderboardEntry = {
  user_id: string;
  full_name: string | null;
  avatar_url: string | null;
  level: number | null;
  level_title: string | null;
  banner_color: string | null;
  xp?: number | null;
  monthly_xp?: number | null;
  rank: number;
  city_id?: number | null;
  city_name?: string | null;
  country_code?: string | null;
};

type LeaderboardModalProps = {
  visible: boolean;
  onClose: () => void;
};

const LeaderboardModal = memo(function LeaderboardModal({ visible, onClose }: LeaderboardModalProps) {
  const navigation = useNavigation<any>();
  const { width, height } = useWindowDimensions();

  const isPhone = width < 420;
  const maxCardWidth = isPhone ? Math.min(width - 24, 520) : 520;
  const maxCardHeight = Math.min(height - 84, height * 0.82);

  const [activeTab, setActiveTab] = useState<LeaderboardTab>('monthly');
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [userCityId, setUserCityId] = useState<number | null>(null);
  const [userCityName, setUserCityName] = useState<string | null>(null);

  const mountedRef = useRef(false);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const safeSet = (fn: () => void) => {
    if (!mountedRef.current) return;
    fn();
  };

  const handlePressEntry = (entry: LeaderboardEntry) => {
    navigation.navigate('Profile', { userId: entry.user_id });
    onClose();
  };

  useEffect(() => {
    if (!visible) return;

    let cancelled = false;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id;
        if (!uid) return;

        const res = await withTimeout<any>(
          (supabase.from('users').select('city_id').eq('id', uid).maybeSingle() as any) as Promise<any>,
          8000
        );

        if (cancelled) return;

        const userRow = res?.data as any;
        const userErr = res?.error as any;

        if (userErr) {
          console.warn('Failed to fetch user city:', userErr.message);
          return;
        }

        if (userRow?.city_id != null) {
          safeSet(() => setUserCityId(userRow.city_id as number));

          const cityRes = await withTimeout<any>(
            (supabase.from('cities').select('name').eq('id', userRow.city_id).maybeSingle() as any) as Promise<any>,
            8000
          );

          if (cancelled) return;

          const cityRow = cityRes?.data as any;
          if (cityRow?.name) safeSet(() => setUserCityName(cityRow.name));
        } else {
          safeSet(() => {
            setUserCityId(null);
            setUserCityName(null);
          });
        }
      } catch (e: any) {
        if (!cancelled) console.warn('Error bootstrapping leaderboard city:', e?.message || String(e));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [visible]);

  const load = async (tabOverride?: LeaderboardTab) => {
    if (!visible) return;

    const tab = tabOverride || activeTab;
    safeSet(() => {
      setLoading(true);
      setError(null);
    });

    try {
      if (tab === 'monthly') {
        const res = await withTimeout<any>(
          (supabase.from('leaderboard_monthly_current').select('*').order('rank', { ascending: true }).limit(100) as any) as Promise<any>,
          9000
        );
        if (res?.error) throw res.error;
        safeSet(() => setEntries(((res?.data || []) as any[]) as LeaderboardEntry[]));
      } else if (tab === 'allTime') {
        const res = await withTimeout<any>(
          (supabase.from('leaderboard_all_time').select('*').order('rank', { ascending: true }).limit(100) as any) as Promise<any>,
          9000
        );
        if (res?.error) throw res.error;
        safeSet(() => setEntries(((res?.data || []) as any[]) as LeaderboardEntry[]));
      } else if (tab === 'city') {
        if (!userCityId) {
          safeSet(() => {
            setEntries([]);
            setError('Set your city in your profile to see your local leaderboard.');
          });
        } else {
          const res = await withTimeout<any>(
            (supabase
              .from('leaderboard_city_all_time')
              .select('*')
              .eq('city_id', userCityId)
              .order('rank', { ascending: true })
              .limit(100) as any) as Promise<any>,
            9000
          );
          if (res?.error) throw res.error;
          safeSet(() => setEntries(((res?.data || []) as any[]) as LeaderboardEntry[]));
        }
      }
    } catch (e: any) {
      console.warn('Leaderboard fetch error:', e?.message || String(e));
      safeSet(() => {
        setError(
          e?.message?.toLowerCase?.().includes('timed out')
            ? 'Leaderboard is taking too long to load.'
            : 'Could not load leaderboard.'
        );
        setEntries([]);
      });
    } finally {
      safeSet(() => setLoading(false));
    }
  };

  useEffect(() => {
    if (!visible) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, activeTab, userCityId]);

  const renderRow = (item: LeaderboardEntry) => {
    const isTop3 = item.rank <= 3;

    let primaryValue = 0;
    let label = '';

    if (activeTab === 'monthly') {
      primaryValue = typeof item.monthly_xp === 'number' ? item.monthly_xp : 0;
      label = 'XP this month';
    } else if (activeTab === 'allTime') {
      primaryValue = typeof item.xp === 'number' ? item.xp : 0;
      label = 'XP total';
    } else if (activeTab === 'city') {
      primaryValue = typeof item.xp === 'number' ? item.xp : 0;
      label = 'City XP';
    }

    const initials =
      item.full_name && item.full_name.trim().length > 0
        ? item.full_name
            .split(' ')
            .map((p) => p[0])
            .join('')
            .slice(0, 2)
            .toUpperCase()
        : '??';

    return (
      <Pressable
        key={`${item.user_id}-${item.rank}-${activeTab}`}
        style={[styles.lbRow, isTop3 && styles.lbRowTop]}
        onPress={() => handlePressEntry(item)}
      >
        <View style={styles.lbRankWrap}>
          <Text style={[styles.lbRankText, isTop3 && styles.lbRankTextTop]}>{item.rank}</Text>
          {isTop3 && <View style={styles.lbCrownDot} />}
        </View>

        <View style={styles.lbAvatarWrap}>
          {item.avatar_url ? (
            <Image source={{ uri: item.avatar_url }} style={styles.lbAvatar} />
          ) : (
            <View style={styles.lbAvatarFallback}>
              <Text style={styles.lbAvatarFallbackText}>{initials}</Text>
            </View>
          )}
        </View>

        <View style={styles.lbInfo}>
          <Text style={styles.lbName} numberOfLines={1}>
            {item.full_name || 'Unknown Creator'}
          </Text>
          <Text style={styles.lbSub} numberOfLines={1}>
            Lv {item.level || 1} · {item.level_title || 'Background Pixel'}
          </Text>

          {activeTab === 'city' && userCityName && (
            <Text style={styles.lbSubCity} numberOfLines={1}>
              {userCityName}
            </Text>
          )}
        </View>

        <View style={styles.lbXpWrap}>
          <Text style={styles.lbXpValue}>{primaryValue}</Text>
          <Text style={styles.lbXpLabel}>{label}</Text>
        </View>
      </Pressable>
    );
  };

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      statusBarTranslucent
      presentationStyle="overFullScreen"
      onRequestClose={onClose}
    >
      <View style={styles.lbOverlay}>
        <View
          style={[
            styles.lbCard,
            {
              width: '100%',
              maxWidth: maxCardWidth,
              height: maxCardHeight,
              alignSelf: 'center',
            },
          ]}
        >
          <View style={styles.lbHeader}>
            <Text style={styles.lbTitle}>Leaderboard</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.lbCloseBtn}>
              <Ionicons name="close" size={18} color={TEXT_MUTED} />
            </Pressable>
          </View>

          <View style={styles.lbTabs}>
            <Pressable
              onPress={() => setActiveTab('monthly')}
              style={[styles.lbTab, activeTab === 'monthly' && styles.lbTabActive]}
            >
              <Text style={[styles.lbTabText, activeTab === 'monthly' && styles.lbTabTextActive]}>This Month</Text>
            </Pressable>

            <Pressable
              onPress={() => setActiveTab('allTime')}
              style={[styles.lbTab, activeTab === 'allTime' && styles.lbTabActive]}
            >
              <Text style={[styles.lbTabText, activeTab === 'allTime' && styles.lbTabTextActive]}>All Time</Text>
            </Pressable>

            <Pressable
              onPress={() => setActiveTab('city')}
              style={[styles.lbTab, activeTab === 'city' && styles.lbTabActive]}
            >
              <Text style={[styles.lbTabText, activeTab === 'city' && styles.lbTabTextActive]}>My City</Text>
            </Pressable>
          </View>

          <View style={styles.lbBody}>
            {loading && (
              <View style={styles.lbLoadingWrap}>
                <ActivityIndicator size="small" color={GOLD} />
                <Text style={styles.lbLoadingText}>Fetching who&apos;s actually doing the work...</Text>
              </View>
            )}

            {!loading && error && (
              <View style={styles.lbEmptyWrap}>
                <Text style={styles.lbEmptyText}>{error}</Text>
              </View>
            )}

            {!loading && !error && entries.length === 0 && (
              <View style={styles.lbEmptyWrap}>
                <Text style={styles.lbEmptyText}>
                  No data yet for this view. Make something. Post something. Vote on something.
                </Text>
              </View>
            )}

            {!loading && !error && entries.length > 0 && (
              <ScrollView
                style={styles.lbScroll}
                contentContainerStyle={styles.lbScrollContent}
                bounces={false}
                overScrollMode="never"
                showsVerticalScrollIndicator={false}
              >
                {entries.map(renderRow)}
              </ScrollView>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
});

/* ---------------------- XP Progress (kept, unchanged) --------------------- */

type TopBarXpProgressProps = {
  variant: 'wide' | 'compact';
  onOpenLeaderboard?: () => void;
};

const TopBarXpProgress = memo(function TopBarXpProgress({ variant, onOpenLeaderboard }: TopBarXpProgressProps) {
  const gamification = useGamification();
  const { loading, xp, level, levelTitle, currentLevelMinXp, nextLevelMinXp, progress } = gamification;

  const [uid, setUid] = useState<string | null>(null);

  const refreshGamification: (() => Promise<void> | void) | null =
    (gamification as any).refresh || (gamification as any).reload || (gamification as any).refetch || null;

  const [ready, setReady] = useState(false);
  const [hydratedForUser, setHydratedForUser] = useState(false);

  const lastXpRef = useRef(0);
  const lastLevelRef = useRef(1);

  const progressAnim = useRef(new Animated.Value(0)).current;

  const [gainLabel, setGainLabel] = useState<string | null>(null);
  const gainOpacity = useRef(new Animated.Value(0)).current;
  const gainTranslate = useRef(new Animated.Value(0)).current;

  const [showLevelModal, setShowLevelModal] = useState(false);
  const [lvlFrom, setLvlFrom] = useState(1);
  const [lvlTo, setLvlTo] = useState(1);
  const [lvlTitleText, setLvlTitleText] = useState('');
  const modalOpacity = useRef(new Animated.Value(0)).current;
  const modalScale = useRef(new Animated.Value(0.9)).current;

  const isWide = variant === 'wide';

  const animateProgressTo = (pct: number) => {
    Animated.timing(progressAnim, {
      toValue: pct,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  };

  const triggerGain = (delta: number) => {
    if (delta <= 0) return;
    const label = `+${delta} XP`;
    setGainLabel(label);
    gainOpacity.setValue(0);
    gainTranslate.setValue(0);

    Animated.parallel([
      Animated.timing(gainOpacity, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(gainTranslate, {
        toValue: -14,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start(() => {
      Animated.timing(gainOpacity, {
        toValue: 0,
        duration: 260,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => setGainLabel(null));
    });
  };

  const triggerLevelUp = (from: number, to: number, newTitle: string) => {
    if (to <= from) return;

    setLvlFrom(from);
    setLvlTo(to);
    setLvlTitleText(newTitle);
    setShowLevelModal(true);

    modalOpacity.setValue(0);
    modalScale.setValue(0.9);

    Animated.parallel([
      Animated.timing(modalOpacity, {
        toValue: 1,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(modalScale, {
        toValue: 1,
        duration: 260,
        easing: Easing.out(Easing.back(1.4)),
        useNativeDriver: true,
      }),
    ]).start(() => {
      setTimeout(() => {
        Animated.timing(modalOpacity, {
          toValue: 0,
          duration: 260,
          useNativeDriver: true,
        }).start(() => setShowLevelModal(false));
      }, 1100);
    });
  };

  useEffect(() => {
    let mounted = true;

    const bootstrap = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const nextUid = data?.user?.id ?? null;
        if (mounted) setUid(nextUid);
      } catch {
        if (mounted) setUid(null);
      }
    };

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange((_evt, session) => {
      const nextUid = session?.user?.id ?? null;
      setUid(nextUid);
    });

    const subObj = (sub as any)?.subscription ?? (sub as any) ?? null;

    return () => {
      mounted = false;
      try {
        subObj?.unsubscribe?.();
      } catch {}
    };
  }, []);

  useEffect(() => {
    setReady(false);
    setHydratedForUser(false);

    setShowLevelModal(false);
    setGainLabel(null);

    lastXpRef.current = 0;
    lastLevelRef.current = 1;

    progressAnim.setValue(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid]);

  useEffect(() => {
    if (typeof refreshGamification === 'function') {
      Promise.resolve(refreshGamification()).catch((err) =>
        console.warn('Gamification refresh failed:', (err as any)?.message)
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) return;

    if (!ready) {
      lastXpRef.current = xp || 0;
      lastLevelRef.current = level || 1;
      progressAnim.setValue(progress || 0);
      setReady(true);
      setHydratedForUser(false);
      return;
    }

    if (!hydratedForUser) {
      lastXpRef.current = xp || 0;
      lastLevelRef.current = level || 1;
      animateProgressTo(progress || 0);
      setHydratedForUser(true);
      return;
    }

    const prevXp = lastXpRef.current;
    const prevLvl = lastLevelRef.current;
    const newXp = xp || 0;
    const newLvl = level || 1;

    const delta = newXp - prevXp;
    if (delta > 0) triggerGain(delta);

    if (newLvl > prevLvl) {
      const lt = levelTitle || 'Background Pixel';
      triggerLevelUp(prevLvl, newLvl, lt);
    }

    lastXpRef.current = newXp;
    lastLevelRef.current = newLvl;
    animateProgressTo(progress || 0);
  }, [loading, xp, level, progress, levelTitle, ready, hydratedForUser, progressAnim]);

  if (loading || !ready) return null;

  const isMax = !nextLevelMinXp || nextLevelMinXp <= currentLevelMinXp || (level || 1) >= 50;

  const gained = Math.max(0, (xp || 0) - currentLevelMinXp);
  const span = Math.max(1, (nextLevelMinXp || currentLevelMinXp) - currentLevelMinXp);

  const widthInterpolated = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['10%', '100%'],
  });

  const nextLevelLabel = isMax ? 'MAX' : `Lv ${(level || 1) + 1}`;

  return (
    <>
      <View style={[styles.xpWrap, isWide ? styles.xpWrapWide : styles.xpWrapCompact]}>
        {onOpenLeaderboard && (
          <View
            style={[
              styles.leaderboardLinkRow,
              isWide ? styles.leaderboardLinkRowWide : styles.leaderboardLinkRowCompact,
            ]}
          >
            <Pressable onPress={onOpenLeaderboard} hitSlop={6}>
              <Text style={styles.leaderboardLinkText}>VIEW LEADERBOARD</Text>
            </Pressable>
          </View>
        )}

        <View style={[styles.xpBarOuter, isWide && styles.xpBarOuterWide]}>
          <Animated.View style={[styles.xpBarFill, { width: widthInterpolated }]} />
          <View style={styles.xpBarOverlay}>
            <Text style={styles.xpBarLevelLeft}>Lv {level || 1}</Text>

            <Text style={styles.xpBarXpText} numberOfLines={1}>
              {isMax ? `${xp || 0} XP` : `${gained}/${span} XP`}
            </Text>

            <Text style={styles.xpBarLevelRight}>{nextLevelLabel}</Text>
          </View>
        </View>

        {gainLabel && (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.xpGainBubble,
              {
                opacity: gainOpacity,
                transform: [{ translateY: gainTranslate }],
              },
            ]}
          >
            <Text style={styles.xpGainText}>{gainLabel}</Text>
          </Animated.View>
        )}
      </View>

      <Modal visible={showLevelModal} transparent animationType="none">
        <Animated.View style={[styles.levelModalOverlay, { opacity: modalOpacity }]}>
          <Animated.View style={[styles.levelModalCard, { transform: [{ scale: modalScale }] }]}>
            <Text style={styles.levelModalKicker}>LEVEL UP</Text>
            <Text style={styles.levelModalLevel}>
              Lv {lvlFrom} ➜ <Text style={{ color: GOLD }}>Lv {lvlTo}</Text>
            </Text>
            <Text style={styles.levelModalTitle}>{lvlTitleText}</Text>
            <Text style={styles.levelModalHint}>Keep creating. Keep getting seen.</Text>
          </Animated.View>
        </Animated.View>
      </Modal>
    </>
  );
});

/* --------------------------- Composed Top Bar -------------------------- */

type TopBarProps = {
  topOffset: number;
  navHeight: number;
  topInset: number;
  onOpenUpload: () => void;
  onOpenLeaderboard: () => void;
};

const TopBar = memo(function TopBar({
  topOffset,
  navHeight,
  topInset,
  onOpenUpload,
  onOpenLeaderboard,
}: TopBarProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= 980;
  const isPhone = width < 420;
  const compactUI = !isWide;

  const controlHeight =
  Platform.OS === 'web'
    ? isWide
      ? 26
      : isPhone
        ? 24
        : 24
    : isWide
      ? 16
      : isPhone
        ? 14
        : 15;
const settingsSize =
  Platform.OS === 'web'
    ? isWide
      ? 30
      : 30
    : isPhone
      ? 30
      : 28;

  return (
    <View style={[styles.topBarWrapper, { top: topOffset, paddingTop: topInset }]}>
      <View
  style={[
    styles.topBarInner,
    {
      minHeight: navHeight,
      paddingHorizontal: isPhone ? 8 : 14,
      paddingTop: Platform.OS === 'web' ? 4 : 0,
    },
  ]}
>
        <View
  style={[
    styles.topBarRowContent,
    {
      minHeight: isPhone ? 30 : 28,
      alignItems: 'center',
    },
  ]}
>
          <View style={styles.topBarLeft}>
            <HoverPress style={{ borderRadius: 10 }} accessibilityLabel="Overlooked">
              <BrandWordmark compact={compactUI} />
            </HoverPress>
          </View>

          {isWide && (
            <View style={styles.topBarCenter}>
              <HoverPress
                accessibilityLabel="Streak"
                style={{
                  borderRadius: 999,
                  width: '100%',
                  maxWidth: 620,
                  alignSelf: 'center',
                }}
              >
                <TopBarStreakProgress variant="wide" compactUI={compactUI} barHeight={controlHeight} />
              </HoverPress>
            </View>
          )}

          <View style={[styles.rightTools, { gap: isPhone ? 5 : 10 }]}>
            <HoverPress onPress={onOpenUpload} hitSlop={6} accessibilityLabel="Upload film">
              <View
  style={[
  styles.topActionBtn,
  styles.leaderboardBtn,
  Platform.OS !== 'web' && isPhone && styles.topActionBtnPhone,
  compactUI && styles.topActionBtnCompact,
]}
>
                <Ionicons name="cloud-upload-outline" size={isPhone ? 16 : 18} color={GOLD} />
                {!(Platform.OS !== 'web' && isPhone) && (
  <Text style={[styles.uploadBtnText, compactUI && styles.uploadBtnTextCompact]} numberOfLines={1}>
    UPLOAD FILM
  </Text>
)}
              </View>
            </HoverPress>

            <HoverPress onPress={onOpenLeaderboard} hitSlop={6} accessibilityLabel="View leaderboard">
  <View
    style={[
      styles.topActionBtn,
      styles.leaderboardBtn,
      Platform.OS !== 'web' && isPhone && styles.topActionBtnPhone,
      compactUI && styles.topActionBtnCompact,
    ]}
  >
    <Ionicons name="trophy-outline" size={isPhone ? 16 : 18} color={GOLD} />
    {!(Platform.OS !== 'web' && isPhone) && (
      <Text
        style={[styles.leaderboardBtnText, compactUI && styles.leaderboardBtnTextCompact]}
        numberOfLines={1}
      >
        LEADERBOARD
      </Text>
    )}
  </View>
</HoverPress>

           {Platform.OS === 'web' ? (
  <View
    style={[
      styles.settingsChipSmall,
      compactUI && styles.settingsChipSmallCompact,
      {
        width: settingsSize,
        height: settingsSize,
        borderRadius: settingsSize / 2,
      },
    ]}
  >
    <View
      style={{
        alignItems: 'center',
        justifyContent: 'center',
        transform: [{ scale: 0.8 }],
      }}
      pointerEvents="box-none"
    >
      <SettingsButton absolute={false} />
    </View>
  </View>
) : (
  <View
    style={{
      width: settingsSize,
      height: settingsSize,
      borderRadius: settingsSize / 2,
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      backgroundColor: '#151515',
      borderWidth: 1,
      borderColor: 'rgba(255,255,255,0.10)',
      overflow: 'hidden',
      position: 'relative',
    }}
  >
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Ionicons name="settings-outline" size={isPhone ? 13 : 16} color={TEXT_IVORY} />
    </View>

    <View
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
        opacity: 0.02,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <SettingsButton absolute={false} />
    </View>
  </View>
)}
  
        </View>
      </View>
    </View>
    {!isWide && (
        <View style={[styles.topBarInnerStreakRow, { paddingHorizontal: isPhone ? 10 : 14 }]}>
          <HoverPress
            accessibilityLabel="Streak"
            style={{
              borderRadius: 999,
              width: '100%',
              alignSelf: 'stretch',
            }}
          >
           <TopBarStreakProgress variant="wide" compactUI={compactUI} barHeight={controlHeight} />
          </HoverPress>
        </View>
      )}
    </View>
  );
});

/* ---------------------- Screen wrapper --------------------- */

const FeaturedWrapped = FeaturedScreen;
const JobsWrapped = JobsScreen;
const ChallengeWrapped = ChallengeScreen;
const LocationWrapped = LocationScreen;
const ProfileWrapped = ProfileScreen;
const WorkshopWrapped = WorkshopScreen;
const WorkshopSubmitWrapped = WorkshopSubmitScreen;
const ChatsWrapped = ChatsStack;

/* ------------------------ Animated Tab Bar Button --------------------- */

const TabBarButton = memo(function TabBarButton(props: any) {
  const { children, onPress, accessibilityState } = props;
  const selected = !!accessibilityState?.selected;

  const shouldAnimate = Platform.OS === 'web';
  const scale = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;

  const to = useCallback((s: number, y: number, dur: number) => {
    if (!shouldAnimate) return;

    Animated.parallel([
      Animated.timing(scale, {
        toValue: s,
        duration: dur,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(lift, {
        toValue: y,
        duration: dur,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [lift, scale, shouldAnimate]);

  if (!shouldAnimate) {
    return (
      <Pressable
        {...props}
        onPress={onPress}
        style={[props.style, { flex: 1, opacity: selected ? 1 : 0.96 }]}
        android_ripple={{ color: 'rgba(198,166,100,0.10)', borderless: false }}
      >
        <View
          style={{
            alignItems: 'center',
            justifyContent: 'center',
            flex: 1,
          }}
        >
          {children}
        </View>
      </Pressable>
    );
  }

  return (
    <Pressable
      {...props}
      onPress={onPress}
      onHoverIn={() => to(1.06, -2, 130)}
      onHoverOut={() => to(1.0, 0, 150)}
      onPressIn={() => to(0.97, 0, 90)}
      onPressOut={() => to(1.0, 0, 140)}
      style={[props.style, { flex: 1 }]}
    >
      <Animated.View
        style={{
          transform: [{ translateY: lift }, { scale }],
          opacity: selected ? 1 : 0.96,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {children}
      </Animated.View>
    </Pressable>
  );
});

/* --------------------------------- Tabs -------------------------------- */
type WebTopBarProps = {
  onOpenUpload: () => void;
  onOpenLeaderboard: () => void;
  topInset?: number;
};

const WebTopBar = memo(function WebTopBar({
  onOpenUpload,
  onOpenLeaderboard,
  topInset = 0,
}: WebTopBarProps) {
  const { width } = useWindowDimensions();

  const isWide = width >= 980;
  const isPhone = width < 700;

  return (
    <View
      style={{
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  zIndex: 9999,
  backgroundColor: DARK_BG,
  paddingTop: topInset + 8,
}}
    >
      <View
        style={{
          width: '100%',
          maxWidth: 1200,
          alignSelf: 'center',
          paddingHorizontal: isPhone ? 8 : 14,
          paddingBottom: isWide ? 0 : 6,
        }}
      >
        <View
          style={{
            minHeight: 34,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <Text
            style={{
              color: TEXT_IVORY,
              fontSize: isPhone ? 11.5 : 18,
              fontWeight: '900',
              letterSpacing: isPhone ? 1.15 : 2.2,
            }}
          >
            OVERLOOKED
          </Text>

          {isWide && (
            <View
              style={{
                flex: 1,
                marginHorizontal: 18,
              }}
            >
              <TopBarStreakProgress variant="wide" compactUI={false} barHeight={26} />
            </View>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: isPhone ? 5 : 10}}>
            <Pressable
              onPress={onOpenUpload}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 4,
paddingHorizontal: isPhone ? 7 : 12,
                borderRadius: 999,
                backgroundColor: 'rgba(198,166,100,0.10)',
                borderWidth: 1,
                borderColor: 'rgba(198,166,100,0.30)',
              }}
            >
              <Ionicons name="cloud-upload-outline" size={isPhone ? 13 : 16}color={GOLD} />
              <Text
                style={{
                  color: GOLD,
                  fontSize: isPhone ? 6.7 : 9,
                  fontWeight: '900',
                  letterSpacing: isPhone ? 0.75 : 1.05,
                }}
              >
                UPLOAD FILM
              </Text>
            </Pressable>

            <Pressable
              onPress={onOpenLeaderboard}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingVertical: 4,
paddingHorizontal: isPhone ? 7 : 12,

                borderRadius: 999,
                backgroundColor: 'rgba(198,166,100,0.10)',
                borderWidth: 1,
                borderColor: 'rgba(198,166,100,0.30)',
              }}
            >
              <Ionicons name="trophy-outline" size={isPhone ? 13 : 16}color={GOLD} />
              <Text
                style={{
                  color: GOLD,
                  fontSize: isPhone ? 6.7 : 9,
                  fontWeight: '900',
                  letterSpacing: isPhone ? 0.75 : 1.05,
                }}
              >
                LEADERBOARD
              </Text>
            </Pressable>

            <View
              style={{
                width: isPhone ? 26 : 30,
height: isPhone ? 26 : 30,
borderRadius: isPhone ? 13 : 15,
                backgroundColor: '#151515',
                borderWidth: 1,
                borderColor: 'rgba(255,255,255,0.10)',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              <View
                style={{
                  alignItems: 'center',
                  justifyContent: 'center',
                  transform: [{ scale: 0.8 }],
                }}
                pointerEvents="box-none"
              >
                <SettingsButton absolute={false} />
              </View>
            </View>
          </View>
        </View>

        {!isWide && (
          <View style={{ paddingTop: 5 }}>
  <TopBarStreakProgress variant="wide" compactUI barHeight={18} />
</View>
        )}
      </View>
    </View>
  );
});

export default function MainTabs() {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { userId } = useAuth();
const [chatUnreadCount, setChatUnreadCount] = useState(0);
const [badgeUserId, setBadgeUserId] = useState<string | null>(null);
const navUnreadRefreshTimeout = useRef<any>(null);
const unreadRequestInFlight = useRef(false);
const unreadRefreshTimeout = useRef<any>(null);
const isGuest = !userId;
useEffect(() => {
  let mounted = true;

  const syncUser = async () => {
    const { data } = await supabase.auth.getUser();
    if (mounted) {
      setBadgeUserId(data?.user?.id ?? null);
    }
  };

  syncUser();

  const { data: authSub } = supabase.auth.onAuthStateChange((_event, session) => {
    setBadgeUserId(session?.user?.id ?? null);
  });

  return () => {
    mounted = false;
    authSub?.subscription?.unsubscribe?.();
  };
}, []);
const loadChatUnreadCount = useCallback(async () => {
  if (!badgeUserId) {
    setChatUnreadCount(0);
    return;
  }

  if (unreadRequestInFlight.current) {
    return;
  }

  unreadRequestInFlight.current = true;

  try {
    const { data: conversations, error: convoError } = await supabase
      .from('conversations')
      .select('id')
      .contains('participant_ids', [badgeUserId]);

    if (convoError) {
      console.error('Unread count conversations error:', convoError.message);
      return;
    }

    const conversationIds = (conversations || []).map((c: any) => c.id);

    if (!conversationIds.length) {
      setChatUnreadCount(0);
      return;
    }

    const { data: reads, error: readsError } = await supabase
      .from('conversation_reads')
      .select('conversation_id, last_read_at')
      .eq('user_id', badgeUserId)
      .in('conversation_id', conversationIds);

    if (readsError) {
      console.error('Unread count reads error:', readsError.message);
      return;
    }

    const readsMap = new Map<string, string>();
    (reads || []).forEach((row: any) => {
      readsMap.set(row.conversation_id, row.last_read_at);
    });

    const { data: messages, error: msgError } = await supabase
      .from('messages')
      .select('conversation_id, sent_at, sender_id')
      .in('conversation_id', conversationIds)
      .neq('sender_id', badgeUserId);

    if (msgError) {
      console.error('Unread count messages error:', msgError.message);
      return;
    }

    const unreadConversationIds = new Set<string>();

    (messages || []).forEach((msg: any) => {
      const lastReadAt = readsMap.get(msg.conversation_id);
      if (!lastReadAt || new Date(msg.sent_at).getTime() > new Date(lastReadAt).getTime()) {
        unreadConversationIds.add(msg.conversation_id);
      }
    });

    setChatUnreadCount(unreadConversationIds.size);
  } catch (e: any) {
    console.error('loadChatUnreadCount error:', e?.message || e);
  } finally {
    unreadRequestInFlight.current = false;
  }
}, [badgeUserId]);
const queueUnreadRefresh = useCallback(() => {
  if (unreadRefreshTimeout.current) {
    clearTimeout(unreadRefreshTimeout.current);
  }

  unreadRefreshTimeout.current = setTimeout(() => {
    loadChatUnreadCount();
  }, 250);
}, [loadChatUnreadCount]);
useEffect(() => {
  const unsubscribe = subscribeChatBadgeRefresh(() => {
    queueUnreadRefresh();
  });

  return unsubscribe;
}, [queueUnreadRefresh]);
    
  useEffect(() => {
  if (!badgeUserId) {
    setChatUnreadCount(0);
    return;
  }

  registerAndSavePushToken(badgeUserId);
  loadChatUnreadCount();
}, [badgeUserId, loadChatUnreadCount]);

  const isPhone = width < 420;
  const isTiny = width < 360;

  const [showLeaderboard, setShowLeaderboard] = useState(false);
const [hideTopBar, setHideTopBar] = useState(false);

const hideTopBarRef = useRef(false);

const updateHideTopBar = useCallback((next: boolean) => {
  if (hideTopBarRef.current === next) return;
  hideTopBarRef.current = next;
  setHideTopBar(next);
}, []);

const shouldHideTopBar = false;

  



  useEffect(() => {
  if (!badgeUserId) return;

  const channel = supabase
    .channel(`main-tabs-chat-badge-${badgeUserId}`)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
      },
      () => {
        queueUnreadRefresh();
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversations',
      },
      () => {
        queueUnreadRefresh();
      }
    )
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'conversation_reads',
        filter: `user_id=eq.${badgeUserId}`,
      },
      () => {
        queueUnreadRefresh();
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}, [badgeUserId, queueUnreadRefresh]);

  

  useEffect(() => {
    if (Platform.OS === 'web') {
      try {
        // @ts-ignore
        if (typeof document !== 'undefined') {
          // @ts-ignore
          document.documentElement.style.backgroundColor = DARK_BG;
          // @ts-ignore
          document.documentElement.style.overflowX = 'hidden';
          // @ts-ignore
          document.body.style.backgroundColor = DARK_BG;
          // @ts-ignore
          document.body.style.overflowX = 'hidden';
          // @ts-ignore
          document.body.style.maxWidth = '100vw';
        }
      } catch {}
    }
  }, []);

  const isWide = width >= 980;

const NAV_HEIGHT = isWide ? 40 : isPhone ? 44 : 42;
const TOPBAR_EXTRA_ROW = isWide ? 0 : 26;

const controlHeight = isWide ? 18 : isPhone ? 16 : 17;
const settingsSize = isWide ? 28 : isPhone ? 28 : 26;
const topOffset = 0;

const contentTopPadding =
  Platform.OS === 'web'
    ? NAV_HEIGHT + TOPBAR_EXTRA_ROW + 10
    : NAV_HEIGHT + TOPBAR_EXTRA_ROW;

const TABBAR_HEIGHT = isPhone ? 54 : 56;

const topBarTranslateY = useRef(new Animated.Value(0)).current;

useEffect(() => {
  const hiddenOffset = -(NAV_HEIGHT + TOPBAR_EXTRA_ROW + insets.top + 8);

  Animated.timing(topBarTranslateY, {
    toValue: shouldHideTopBar ? hiddenOffset : 0,
    duration: 180,
    easing: Easing.out(Easing.cubic),
    useNativeDriver: true,
  }).start();
}, [shouldHideTopBar, NAV_HEIGHT, TOPBAR_EXTRA_ROW, insets.top, topBarTranslateY]);
  const handleOpenUpload = useCallback(() => {
  if (isGuest) {
    navigation.navigate('Auth', { screen: 'SignIn' });
    return;
  }

  navigation.navigate('WorkshopSubmit', { mode: 'monthly' });
}, [navigation, isGuest]);

  const screenOptions = useCallback(
  ({ route }: any): any => ({
    headerShown: false,
    tabBarActiveTintColor: GOLD,
    tabBarInactiveTintColor: TEXT_MUTED,
    tabBarShowLabel: false,
    lazy: true,
    animation: 'shift',
transitionSpec: {
  animation: 'timing',
  config: {
    duration: 220,
  },
},
    tabBarStyle: {
      backgroundColor: DARK_BG,
      borderTopWidth: 1,
      borderTopColor: 'rgba(255,255,255,0.06)',
      height: TABBAR_HEIGHT,
      paddingTop: isTiny ? 5 : 6,
      paddingBottom: Platform.OS === 'ios' ? (isPhone ? 10 : 12) : 8,
      elevation: 0,
    },
    tabBarItemStyle: {
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 0,
    },
    tabBarButton: (props: any) => {
  const isChatsTab = route.name === 'Chats';

  return (
    <TabBarButton
      {...props}
      onPress={() => {
        props.onPress?.();

        if (isChatsTab) {
          setTimeout(() => {
            loadChatUnreadCount();
          }, 250);
        }
      }}
    />
  );
},
    tabBarIcon: ({ color }: { color: string; focused: boolean }) => {
  let icon: keyof typeof Ionicons.glyphMap = 'ellipse';

  switch (route.name) {
    case 'Featured':
      icon = 'star-outline';
      break;
    case 'Jobs':
      icon = 'briefcase-outline';
      break;
    case 'Challenge':
      icon = 'trophy-outline';
      break;
    case 'Workshop':
      icon = 'cube-outline';
      break;
    case 'Location':
      icon = 'location-outline';
      break;
    case 'Chats':
      icon = 'chatbubble-ellipses-outline';
      break;
    case 'Profile':
      icon = 'person-outline';
      break;
  }

  const showChatBadge = route.name === 'Chats' && chatUnreadCount > 0;
  const badgeText = chatUnreadCount > 99 ? '99+' : String(chatUnreadCount);

  return (
    <View style={styles.tabIconOnly}>
      <Ionicons name={icon} size={isTiny ? 20 : 22} color={color} />

      {showChatBadge && (
        <View style={styles.chatBadge}>
          <Text style={styles.chatBadgeText}>{badgeText}</Text>
        </View>
      )}
    </View>
  );
},
  }),
  [TABBAR_HEIGHT, isPhone, isTiny, chatUnreadCount]
);

  return (
    <SettingsModalProvider>
      <View
  style={{
    flex: 1,
    backgroundColor: DARK_BG,
    overflow: 'hidden',
    position: 'relative',
  }}
>
       

        <SafeAreaView
  style={[
    styles.safeArea,
    { paddingTop: contentTopPadding },
  ]}
  edges={['left', 'right', 'bottom']}
>
          <Tab.Navigator
  screenOptions={screenOptions}
  detachInactiveScreens={false}
>
            <Tab.Screen name="Featured" component={FeaturedWrapped} />
            <Tab.Screen name="Workshop" component={WorkshopWrapped} />
            <Tab.Screen name="Challenge" component={ChallengeWrapped} />
            <Tab.Screen name="Location" component={LocationWrapped} />
            <Tab.Screen name="Jobs" component={JobsWrapped} />

            <Tab.Screen
  name="Chats"
  component={ChatsWrapped}
  options={{
    unmountOnBlur: false,
  }}
/>

<Tab.Screen
  name="Profile"
  component={ProfileWrapped}
  listeners={({ navigation }) => ({
    tabPress: () => {
      navigation.navigate('Profile', {
        userId: undefined,
        user: undefined,
      });
    },
  })}
/>

            
          </Tab.Navigator>
        </SafeAreaView>
         {Platform.OS === 'web' ? (
  <WebTopBar
    onOpenUpload={handleOpenUpload}
    onOpenLeaderboard={() => setShowLeaderboard(true)}
  />
) : (
  <Animated.View
  pointerEvents={shouldHideTopBar ? 'none' : 'auto'}
  style={{
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 99999,
    elevation: 99999,
    transform: [{ translateY: topBarTranslateY }],
  }}
>
  <TopBar
    topOffset={topOffset}
    navHeight={NAV_HEIGHT}
    topInset={insets.top}
    onOpenUpload={handleOpenUpload}
    onOpenLeaderboard={() => {
      setShowLeaderboard(true);
    }}
  />
</Animated.View>
)}

        <SettingsModal />
        {showLeaderboard && (
  <LeaderboardModal
    visible={showLeaderboard}
    onClose={() => setShowLeaderboard(false)}
  />
)}
      </View>
    </SettingsModalProvider>
  );
}

/* -------------------------------- Styles -------------------------------- */

const styles = StyleSheet.create({
  safeArea: {
  flex: 1,
  backgroundColor: DARK_BG,
  zIndex: 0,
},

  tabIconOnly: {
  alignItems: 'center',
  justifyContent: 'center',
  position: 'relative',
},

chatBadge: {
  position: 'absolute',
  top: -6,
  right: -10,
  minWidth: 16,
  height: 16,
  borderRadius: 999,
  backgroundColor: GOLD,
  alignItems: 'center',
  justifyContent: 'center',
  paddingHorizontal: 4,
  borderWidth: 1,
  borderColor: '#000000',
},

chatBadgeText: {
  color: '#000000',
  fontSize: 9,
  fontWeight: '900',
  fontFamily: SYSTEM_SANS,
  lineHeight: 10,
},

  topBarRowContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
  },

  topBarWrapper: {
  backgroundColor: DARK_BG,
  borderBottomWidth: 0,
  borderBottomColor: 'transparent',
},

  topBarInner: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    justifyContent: 'center',
    backgroundColor: DARK_BG,
  },

  topBarLeft: {
    flexShrink: 0,
    paddingRight: 8,
    justifyContent: 'center',
  },

  topBarCenter: {
    flex: 1,
    minWidth: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },

  topBarInnerStreakRow: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    paddingTop: 4,
    paddingBottom: 0,
    backgroundColor: DARK_BG,
  },

  brandWrap: {
    paddingVertical: 0,
    paddingRight: 8,
    justifyContent: 'center',
  },

  brandTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: TEXT_IVORY,
    letterSpacing: 2.2,
    fontFamily: SYSTEM_SANS,
  },

  brandTitleCompact: {
  fontSize: 15,
  letterSpacing: 1.6,
},

  rightTools: {
  marginLeft: 'auto',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
},

  topActionBtn: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 999,
  alignSelf: 'center',
  minHeight: 28,
  overflow: 'visible',
},

  topActionBtnPhone: {
  width: 36,
  minWidth: 36,
  height: 36,
  minHeight: 36,
  paddingHorizontal: 0,
  gap: 0,
  backgroundColor: 'transparent',
  borderColor: 'transparent',
  alignItems: 'center',
  justifyContent: 'center',
  overflow: 'visible',
},

  topActionBtnCompact: {
  minHeight: 28,
  paddingHorizontal: 8,
  gap: 5,
},

  uploadBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(198,166,100,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(198,166,100,0.30)',
    maxWidth: 140,
  },

  uploadBtnPhone: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 0,
    maxWidth: 44,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },

  uploadBtnCompact: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 4,
    maxWidth: 110,
  },

  uploadBtnText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.15,
    color: GOLD,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
    flexShrink: 1,
  },

  uploadBtnTextCompact: {
    fontSize: 8,
    letterSpacing: 0.85,
  },

  leaderboardBtn: {
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 6,
  paddingVertical: 6,
  paddingHorizontal: 12,
  borderRadius: 999,
  backgroundColor: 'rgba(198,166,100,0.10)',
  borderWidth: 1,
  borderColor: 'rgba(198,166,100,0.30)',
  maxWidth: 150,
},

  leaderboardBtnPhone: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 0,
    maxWidth: 44,
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },

  leaderboardBtnCompact: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    gap: 4,
    maxWidth: 120,
  },

  leaderboardBtnText: {
    fontSize: 9,
    fontWeight: '900',
    letterSpacing: 1.15,
    color: GOLD,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
    flexShrink: 1,
  },

  leaderboardBtnTextCompact: {
    fontSize: 8,
    letterSpacing: 0.85,
  },

  settingsChipSmall: {
  backgroundColor: '#151515',
  borderRadius: 999,
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.10)',
  alignItems: 'center',
  justifyContent: 'center',
  alignSelf: 'center',
  overflow: 'hidden',
},

  settingsChipSmallPhone: {
  backgroundColor: '#151515',
  borderColor: 'rgba(255,255,255,0.10)',
},

  settingsChipSmallCompact: {
    backgroundColor: '#121212',
  },

  streakWrap: {
    paddingVertical: 0,
    width: '100%',
  },

  streakWrapWide: {
    width: '100%',
    maxWidth: 2000,
    alignItems: 'center',
    alignSelf: 'center',
  },

  streakWrapCompact: {
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
    alignItems: 'stretch',
  },

  streakBarOuter: {
    width: '100%',
    borderRadius: 999,
    backgroundColor: '#1F1F1F',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333333',
  },

  streakBarOuterWide: {
    width: '100%',
  },

  streakBarOuterCompactUI: {},

  streakBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    backgroundColor: GOLD,
  },

  streakGlass: {
  position: 'absolute',
  left: 0,
  right: 0,
  top: 0,
  height: '45%',
  backgroundColor: 'rgba(255,255,255,0.08)',
  opacity: 0.16,
},

  streakShimmer: {
    position: 'absolute',
    top: -8,
    bottom: -8,
    width: 140,
    backgroundColor: 'rgba(255,255,255,0.12)',
    opacity: 0.2,
  },

  streakBarOverlay: {
  flex: 1,
  position: 'relative',
  paddingHorizontal: 8,
},

  streakSidesRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },

  streakLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  streakBarLeft: {
  fontSize: 7,
  fontWeight: '900',
  color: TEXT_IVORY,
  letterSpacing: 0.8,
  textTransform: 'uppercase',
  fontFamily: SYSTEM_SANS,
},

  streakCenterAbs: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },

  streakBarCenter: {
  textAlign: 'center',
  fontSize: 7,
  fontWeight: '900',
  color: TEXT_IVORY,
  fontFamily: SYSTEM_SANS,
  opacity: 0.92,
},

  streakBarRight: {
  marginLeft: 'auto',
  textAlign: 'right',
  fontSize: 7,
  fontWeight: '900',
  color: TEXT_MUTED,
  fontFamily: SYSTEM_SANS,
},

  leaderboardLinkRow: { marginBottom: 1 },
  leaderboardLinkRowWide: { alignItems: 'center' },
  leaderboardLinkRowCompact: { alignItems: 'flex-start' },
  leaderboardLinkText: {
    fontSize: 8,
    letterSpacing: 1.2,
    fontWeight: '800',
    color: GOLD,
    textTransform: 'uppercase',
    opacity: 0.86,
    fontFamily: SYSTEM_SANS,
  },

  xpWrap: { paddingVertical: 2 },
  xpWrapWide: {
    width: '100%',
    maxWidth: 520,
    alignItems: 'center',
    alignSelf: 'center',
  },
  xpWrapCompact: {
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
    alignItems: 'flex-start',
  },
  xpBarOuter: {
    marginTop: 0,
    width: '100%',
    height: 12,
    borderRadius: 999,
    backgroundColor: '#222222',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333333',
  },
  xpBarOuterWide: { width: '100%' },
  xpBarFill: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    borderRadius: 999,
    backgroundColor: GOLD,
  },
  xpBarOverlay: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    justifyContent: 'space-between',
  },
  xpBarLevelLeft: {
    fontSize: 9,
    fontWeight: '800',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },
  xpBarLevelRight: {
    fontSize: 9,
    fontWeight: '800',
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },
  xpBarXpText: {
    fontSize: 9,
    fontWeight: '900',
    color: '#0D0D0D',
    fontFamily: SYSTEM_SANS,
  },
  brandTitleCompactWeb: {
  fontSize: 15,
  letterSpacing: 1.6,
},
  xpGainBubble: {
    position: 'absolute',
    right: 0,
    top: -2,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#202020',
    borderWidth: 1,
    borderColor: GOLD,
  },
  xpGainText: {
    fontSize: 10,
    fontWeight: '900',
    color: GOLD,
    fontFamily: SYSTEM_SANS,
  },

  levelModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  levelModalCard: {
    paddingVertical: 22,
    paddingHorizontal: 26,
    borderRadius: 18,
    backgroundColor: '#050505',
    borderWidth: 1,
    borderColor: GOLD,
    alignItems: 'center',
    maxWidth: 520,
    width: '100%',
  },
  levelModalKicker: {
    fontSize: 13,
    fontWeight: '900',
    letterSpacing: 2,
    color: GOLD,
    textTransform: 'uppercase',
    marginBottom: 6,
    fontFamily: SYSTEM_SANS,
  },
  levelModalLevel: {
    fontSize: 24,
    fontWeight: '900',
    color: TEXT_IVORY,
    marginBottom: 4,
    fontFamily: SYSTEM_SANS,
  },
  levelModalTitle: {
    fontSize: 14,
    fontWeight: '800',
    color: TEXT_IVORY,
    textTransform: 'uppercase',
    letterSpacing: 1.2,
    marginBottom: 4,
    fontFamily: SYSTEM_SANS,
  },
  levelModalHint: {
    fontSize: 10,
    fontWeight: '500',
    color: TEXT_MUTED,
    marginTop: 2,
    fontFamily: SYSTEM_SANS,
  },

  lbOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 16,
    zIndex: 9999,
    elevation: 9999,
  },
  lbCard: {
    borderRadius: 18,
    backgroundColor: '#050505',
    borderWidth: 1,
    borderColor: DIVIDER,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
    zIndex: 10000,
    elevation: 10000,
  },
  lbHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 4,
  },
  lbTitle: {
    fontSize: 14,
    fontWeight: '900',
    letterSpacing: 1.8,
    color: TEXT_IVORY,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
  },
  lbCloseBtn: {
    position: 'absolute',
    right: 2,
    padding: 4,
  },
  lbTabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 4,
    marginBottom: 2,
    flexWrap: 'wrap',
  },
  lbTab: {
    paddingVertical: 3,
    paddingHorizontal: 10,
    borderRadius: 999,
    marginHorizontal: 4,
    marginVertical: 2,
    backgroundColor: '#111111',
  },
  lbTabActive: { backgroundColor: GOLD },
  lbTabText: {
    fontSize: 9,
    fontWeight: '700',
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontFamily: SYSTEM_SANS,
  },
  lbTabTextActive: { color: '#050505' },
  lbBody: { flex: 1, marginTop: 4 },
  lbLoadingWrap: { alignItems: 'center', paddingVertical: 18 },
  lbLoadingText: { marginTop: 6, fontSize: 9, color: TEXT_MUTED, fontFamily: SYSTEM_SANS },
  lbEmptyWrap: { alignItems: 'center', paddingVertical: 14, paddingHorizontal: 10 },
  lbEmptyText: { fontSize: 9, color: TEXT_MUTED, textAlign: 'center', fontFamily: SYSTEM_SANS },
  lbScroll: { flex: 1 },
  lbScrollContent: { paddingBottom: 8, paddingTop: 4 },
  lbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 6,
    borderRadius: 10,
    backgroundColor: '#0D0D0D',
    marginBottom: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#222222',
  },
  lbRowTop: { borderColor: GOLD, backgroundColor: '#141414' },
  lbRankWrap: { width: 26, alignItems: 'center' },
  lbRankText: { fontSize: 12, fontWeight: '900', color: TEXT_MUTED, fontFamily: SYSTEM_SANS },
  lbRankTextTop: { color: GOLD },
  lbCrownDot: { marginTop: 1, width: 6, height: 6, borderRadius: 3, backgroundColor: GOLD },
  lbAvatarWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    overflow: 'hidden',
    marginRight: 8,
    backgroundColor: '#151515',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lbAvatar: { width: 32, height: 32, borderRadius: 16 },
  lbAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#202020',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lbAvatarFallbackText: { fontSize: 10, fontWeight: '800', color: GOLD, fontFamily: SYSTEM_SANS },
  lbInfo: { flex: 1, minWidth: 0 },
  lbName: { fontSize: 11, fontWeight: '800', color: TEXT_IVORY, fontFamily: SYSTEM_SANS },
  lbSub: { fontSize: 8, color: TEXT_MUTED, marginTop: 1, fontFamily: SYSTEM_SANS },
  lbSubCity: { fontSize: 7, color: TEXT_MUTED, marginTop: 1, fontFamily: SYSTEM_SANS },
  lbXpWrap: { alignItems: 'flex-end', marginLeft: 6 },
  lbXpValue: { fontSize: 11, fontWeight: '900', color: GOLD, fontFamily: SYSTEM_SANS },
  lbXpLabel: { fontSize: 7, color: TEXT_MUTED, fontFamily: SYSTEM_SANS },
});