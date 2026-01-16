// app/navigation/MainTabs.tsx
import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TabActions, useNavigation, useFocusEffect } from '@react-navigation/native';
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
  AppState,
  AppStateStatus,
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

import { SettingsModalProvider } from '../context/SettingsModalContext';
import SettingsButton from '../../components/SettingsButton';
import SettingsModal from '../../components/SettingsModal';
import type { BottomTabNavigationOptions } from '@react-navigation/bottom-tabs';

import { useMonthlyStreak } from '../lib/useMonthlyStreak';

// NOTE: keeping this import because your file already has it.
import { useGamification } from '../context/GamificationContext';

import { UpgradeModal } from '../../components/UpgradeModal';

const Tab = createBottomTabNavigator();

/* ------------------------------- palette ------------------------------- */
const DARK_BG = '#0D0D0D';
const DARK_ELEVATED = '#171717';
const TEXT_IVORY = '#EDEBE6';
const TEXT_MUTED = '#A7A6A2';
const DIVIDER = '#2A2A2A';
const GOLD = '#C6A664';

const OFFER_ACCENT = '#2ED47A';
const OFFER_STRIP_BG = 'rgba(46,212,122,0.12)';
const OFFER_STRIP_BORDER = 'rgba(46,212,122,0.20)';

/* ------------------------------- fonts --------------------------------- */
const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

/* ------------------------------- helpers ------------------------------- */

function getOfferRemaining() {
  const end = new Date(2026, 0, 31, 23, 59, 59); // Jan 31, 2026
  const now = new Date();
  const ms = end.getTime() - now.getTime();

  if (ms <= 0) {
    return { expired: true, short: 'Offer ended', long: 'Offer ended' };
  }

  const totalMinutes = Math.floor(ms / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);

  const short = days > 0 ? `${days}d ${hours}h left` : `${hours}h left`;
  const long = `Ends Jan 31 • ${short}`;

  return { expired: false, short, long };
}

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
  const scale = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;

  const to = (s: number, y: number, dur: number) => {
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
  };

  return (
    <Pressable
      accessibilityLabel={accessibilityLabel}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={onPress}
      onHoverIn={() => {
        if (Platform.OS === 'web') to(1.03, -1.5, 140);
      }}
      onHoverOut={() => {
        if (Platform.OS === 'web') to(1.0, 0, 160);
      }}
      onPressIn={() => to(0.98, 0, 90)}
      onPressOut={() => to(1.0, 0, 140)}
      style={style}
    >
      <Animated.View style={{ transform: [{ translateY: lift }, { scale }] }}>{children}</Animated.View>
    </Pressable>
  );
});

/* ------------------------ Smooth Tab Transitions ----------------------- */
/**
 * PERF: Keep the same visual effect, but:
 * - On WEB: no JS timing animation
 * - On NATIVE: still animate after interactions
 */
const TabTransition = memo(function TabTransition({ children }: { children: React.ReactNode }) {
  const scrimOpacity = useRef(new Animated.Value(0)).current;

  useFocusEffect(
    useCallback(() => {
      scrimOpacity.setValue(Platform.OS === 'web' ? 0.12 : 0.18);

      if (Platform.OS === 'web') {
        const id = setTimeout(() => {
          try {
            scrimOpacity.setValue(0);
          } catch {}
        }, 0);

        return () => {
          try {
            clearTimeout(id);
          } catch {}
        };
      }

      const task = InteractionManager.runAfterInteractions(() => {
        Animated.timing(scrimOpacity, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      });

      return () => {
        try {
          // @ts-ignore
          task?.cancel?.();
        } catch {}
      };
    }, [scrimOpacity])
  );

  return (
    <View style={{ flex: 1, backgroundColor: DARK_BG, overflow: 'hidden' }}>
      {children}
      <Animated.View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFillObject,
          {
            backgroundColor: DARK_BG,
            opacity: scrimOpacity,
          },
        ]}
      />
    </View>
  );
});

/* --------------------------- Top Bar elements -------------------------- */

function BrandWordmark({ compact }: { compact?: boolean }) {
  return (
    <View style={styles.brandWrap}>
      <Text style={[styles.brandTitle, compact && styles.brandTitleCompact]}>OVERLOOKED</Text>
    </View>
  );
}

/* ---------------------- STREAK Progress Bar --------------------- */

type TopBarStreakProgressProps = {
  variant: 'wide' | 'compact';
  compactUI?: boolean;
};

const TopBarStreakProgress = memo(function TopBarStreakProgress({
  variant,
  compactUI,
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

  // ✨ shimmer sweep (web only)
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

  return (
    <View style={[styles.streakWrap, isWide ? styles.streakWrapWide : styles.streakWrapCompact]}>
      <View
        style={[
          styles.streakBarOuter,
          isWide && styles.streakBarOuterWide,
          compactUI && styles.streakBarOuterCompactUI,
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

        {/* ✅ CHANGED: tighten text + reserve center space so nothing overlaps */}
        <View style={[styles.streakBarOverlay, compactUI && { paddingHorizontal: 10 }]}>
          <View style={styles.streakSidesRow}>
            <View style={styles.streakLeftGroup}>
              <Text
                style={[
                  styles.streakBarLeft,
                  compactUI && { fontSize: 8, letterSpacing: 0.75 },
                ]}
              >
                STREAK
              </Text>
            </View>

            <Text style={[styles.streakBarRight, compactUI && { fontSize: 8 }]}>Year {yearLabel}</Text>
          </View>

          <View
            pointerEvents="none"
            style={[
              styles.streakCenterAbs,
              // ✅ more padding on compact so center text can't collide with STREAK / Year
              compactUI && { paddingHorizontal: 64 },
            ]}
          >
            <Text
              style={[styles.streakBarCenter, compactUI && { fontSize: 8 }]}
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
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.lbOverlay}>
        <View style={[styles.lbCard, { width: '100%', maxWidth: maxCardWidth, maxHeight: maxCardHeight, alignSelf: 'center' }]}>
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
  onOpenUpgrade: () => void;
  onOpenLeaderboard: () => void;
};

const TopBar = memo(function TopBar({ topOffset, navHeight, onOpenUpgrade, onOpenLeaderboard }: TopBarProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= 980;
  const isPhone = width < 420;
  const isTiny = width < 360;

  const [offerCountdown, setOfferCountdown] = useState(() => getOfferRemaining());

  useEffect(() => {
    const tick = () => setOfferCountdown(getOfferRemaining());
    tick();
    const id = setInterval(tick, 60 * 1000);
    return () => clearInterval(id);
  }, []);

  const bannerHeight = isPhone ? 22 : 34;
  const wrapperHeight = bannerHeight + navHeight + (isWide ? 0 : 30);

  const saleText = offerCountdown.expired
    ? `NEW YEAR’S PRO SALE • OFFER ENDED`
    : `NEW YEAR’S PRO SALE • ${offerCountdown.long}`;

  const compactUI = !isWide;

  return (
    <View style={[styles.topBarWrapper, { height: wrapperHeight, top: topOffset }]}>
      <HoverPress
        onPress={onOpenUpgrade}
        style={[styles.saleBanner, { height: bannerHeight }]}
        hitSlop={6}
        accessibilityLabel="Open upgrade"
      >
        <View style={[styles.saleBannerInner, { height: bannerHeight, paddingHorizontal: isPhone ? 10 : 14 }]}>
          <View style={[styles.saleDot, isPhone && { width: 6, height: 6 }]} />
          <View pointerEvents="none" style={[styles.saleBannerCenterAbs, { paddingHorizontal: isPhone ? 24 : 36 }]}>
            <Text
              style={[
                styles.saleBannerText,
                isPhone && styles.saleBannerTextCompact,
                isTiny && styles.saleBannerTextTiny,
              ]}
              numberOfLines={1}
            >
              {saleText}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={isPhone ? 13 : 16} color="rgba(237,235,230,0.88)" />
        </View>
      </HoverPress>

      <View style={[styles.topBarInner, { height: navHeight, paddingHorizontal: isPhone ? 10 : 14 }]}>
        <HoverPress style={{ borderRadius: 10 }} accessibilityLabel="Overlooked">
          <BrandWordmark compact={compactUI} />
        </HoverPress>

        {isWide && (
          <View pointerEvents="box-none" style={[styles.centerSlotAbs, { paddingHorizontal: 220 }]}>
            <HoverPress
              accessibilityLabel="Streak"
              style={{
                borderRadius: 999,
                width: '100%',
                maxWidth: 600,
                alignSelf: 'center',
              }}
            >
              <TopBarStreakProgress variant="wide" compactUI={compactUI} />
            </HoverPress>
          </View>
        )}

        <View style={[styles.rightTools, { gap: isPhone ? 6 : 10 }]}>
          <HoverPress onPress={onOpenLeaderboard} hitSlop={6} accessibilityLabel="View leaderboard">
            <View style={[styles.leaderboardBtn, isPhone && styles.leaderboardBtnPhone, compactUI && styles.leaderboardBtnCompact]}>
              <Ionicons name="trophy-outline" size={isPhone ? 15 : 16} color={GOLD} />
              {!isPhone && (
                <Text style={[styles.leaderboardBtnText, compactUI && styles.leaderboardBtnTextCompact]} numberOfLines={1}>
                  LEADERBOARD
                </Text>
              )}
            </View>
          </HoverPress>

          <HoverPress disabled>
            <View style={[styles.settingsChipSmall, isPhone && styles.settingsChipSmallPhone, compactUI && styles.settingsChipSmallCompact]}>
              <View style={{ transform: [{ scale: isPhone ? 0.58 : compactUI ? 0.74 : 0.9 }] }}>
                <SettingsButton absolute={false} />
              </View>
            </View>
          </HoverPress>
        </View>
      </View>

      {!isWide && (
        <View style={[styles.topBarInnerStreakRow, { paddingHorizontal: isPhone ? 10 : 14 }]}>
          <HoverPress
            accessibilityLabel="Streak"
            style={{
              borderRadius: 999,
              width: '100%',
              // ✅ CHANGED: slightly longer on mobile
              maxWidth: isPhone ? 420 : 520,
              alignSelf: 'center',
            }}
          >
            <TopBarStreakProgress variant="compact" compactUI />
          </HoverPress>
        </View>
      )}
    </View>
  );
});

/* ---------------------- Screen wrapper --------------------- */

function withTabTransition(Component: React.ComponentType<any>) {
  const Wrapped = function Wrapped(props: any) {
    return (
      <TabTransition>
        <Component {...props} />
      </TabTransition>
    );
  };
  return Wrapped;
}

const FeaturedWrapped = withTabTransition(FeaturedScreen);
const JobsWrapped = withTabTransition(JobsScreen);
const ChallengeWrapped = withTabTransition(ChallengeScreen);
const LocationWrapped = withTabTransition(LocationScreen);
const ProfileWrapped = withTabTransition(ProfileScreen);
const WorkshopWrapped = withTabTransition(WorkshopScreen);
const ChatsWrapped = withTabTransition(ChatsStack);

/* ------------------------ Animated Tab Bar Button --------------------- */

const TabBarButton = memo(function TabBarButton(props: any) {
  const { children, onPress, accessibilityState } = props;
  const selected = !!accessibilityState?.selected;

  const scale = useRef(new Animated.Value(1)).current;
  const lift = useRef(new Animated.Value(0)).current;

  const to = (s: number, y: number, dur: number) => {
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
  };

  return (
    <Pressable
      {...props}
      onPress={onPress}
      onHoverIn={() => {
        if (Platform.OS === 'web') to(1.06, -2, 130);
      }}
      onHoverOut={() => {
        if (Platform.OS === 'web') to(1.0, 0, 150);
      }}
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

export default function MainTabs() {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const isPhone = width < 420;
  const isTiny = width < 360;

  const [showLeaderboard, setShowLeaderboard] = useState(false);
  const [showUpgrade, setShowUpgrade] = useState(false);

  // ✅ FIX: manage Supabase auth refresh with app lifecycle so backgrounding doesn't break session
  useEffect(() => {
    // Start immediately on mount
    try {
      supabase.auth.startAutoRefresh();
    } catch {}

    // Native: pause refresh when app backgrounds; resume when active
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      try {
        if (state === 'active') {
          supabase.auth.startAutoRefresh();
        } else {
          supabase.auth.stopAutoRefresh();
        }
      } catch {}
    });

    return () => {
      try {
        sub.remove();
      } catch {}
      try {
        supabase.auth.stopAutoRefresh();
      } catch {}
    };
  }, []);

  // ✅ Web: pause refresh when tab hidden; resume when visible
  useEffect(() => {
    if (Platform.OS !== 'web') return;

    const onVisibility = () => {
      try {
        if (document.visibilityState === 'visible') {
          supabase.auth.startAutoRefresh();
        } else {
          supabase.auth.stopAutoRefresh();
        }
      } catch {}
    };

    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

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

  const NAV_HEIGHT = width >= 980 ? 56 : isPhone ? 40 : 44;
  const topOffset = width >= 980 ? 0 : Platform.OS === 'ios' ? Math.max((insets.top || 0) - 4, 0) : 0;

  const contentTopPadding = (isPhone ? 22 : 34) + NAV_HEIGHT + (width >= 980 ? 0 : 30);

  const TABBAR_HEIGHT = isPhone ? 54 : 56;

  const screenOptions = useCallback(
    ({ route }: any): BottomTabNavigationOptions =>
      ({
        headerShown: false,
        sceneContainerStyle: { backgroundColor: DARK_BG },

        tabBarActiveTintColor: GOLD,
        tabBarInactiveTintColor: TEXT_MUTED,
        tabBarShowLabel: false,

        tabBarStyle: {
          backgroundColor: DARK_ELEVATED,
          borderTopWidth: 0,
          height: TABBAR_HEIGHT,
          paddingTop: isTiny ? 5 : 6,
          paddingBottom: Platform.OS === 'ios' ? (isPhone ? 10 : 12) : 8,
          shadowColor: '#000',
          shadowOpacity: 0.3,
          shadowOffset: { width: 0, height: -4 },
          shadowRadius: 6,
          elevation: 10,
        },

        tabBarItemStyle: {
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 0,
        },

        lazy: true,
        lazyPreloadDistance: 1,
        detachInactiveScreens: Platform.OS !== 'web',
        freezeOnBlur: Platform.OS !== 'web',
        unmountOnBlur: false,

        tabBarButton: (props: any) => <TabBarButton {...props} />,

        tabBarIcon: ({ color }: { color: string; focused: boolean }) => {
          let icon: keyof typeof Ionicons.glyphMap = 'ellipse';
          let label = route.name;

          switch (route.name) {
            case 'Featured':
              icon = 'star-outline';
              label = 'Featured';
              break;
            case 'Jobs':
              icon = 'briefcase-outline';
              label = 'Jobs';
              break;
            case 'Challenge':
              icon = 'trophy-outline';
              label = 'Challenge';
              break;
            case 'Workshop':
              icon = 'cube-outline';
              label = 'Workshop';
              break;
            case 'Location':
              icon = 'location-outline';
              label = 'Location';
              break;
            case 'Chats':
              icon = 'chatbubble-ellipses-outline';
              label = 'Chats';
              break;
            case 'Profile':
              icon = 'person-outline';
              label = 'Profile';
              break;
          }

          // ✅ icons ONLY everywhere (no labels, no pills)
          return (
            <View style={styles.tabIconOnly}>
              <Ionicons name={icon} size={isTiny ? 20 : 22} color={color} />
            </View>
          );
        },
      } as BottomTabNavigationOptions),
    [TABBAR_HEIGHT, isPhone, isTiny]
  );

  return (
    <SettingsModalProvider>
      <View style={{ flex: 1, backgroundColor: DARK_BG, overflow: 'hidden' }}>
        <TopBar
          topOffset={topOffset}
          navHeight={NAV_HEIGHT}
          onOpenUpgrade={() => setShowUpgrade(true)}
          onOpenLeaderboard={() => setShowLeaderboard(true)}
        />

        <SafeAreaView
          style={[styles.safeArea, { paddingTop: contentTopPadding }]}
          edges={['left', 'right', 'bottom']}
        >
          <Tab.Navigator screenOptions={screenOptions}>
            <Tab.Screen name="Featured" component={FeaturedWrapped} />
            <Tab.Screen name="Jobs" component={JobsWrapped} />
            <Tab.Screen name="Challenge" component={ChallengeWrapped} />
            <Tab.Screen name="Workshop" component={WorkshopWrapped} />
            <Tab.Screen name="Location" component={LocationWrapped} />

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
                tabPress: (e) => {
                  e.preventDefault();
                  navigation.dispatch(TabActions.jumpTo('Profile', undefined));
                },
              })}
            />
          </Tab.Navigator>
        </SafeAreaView>

        <SettingsModal />
        <LeaderboardModal visible={showLeaderboard} onClose={() => setShowLeaderboard(false)} />
        <UpgradeModal visible={showUpgrade} onClose={() => setShowUpgrade(false)} context={undefined} />
      </View>
    </SettingsModalProvider>
  );
}

/* -------------------------------- Styles -------------------------------- */

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: DARK_BG,
  },

  /* ✅ icons only tab */
  tabIconOnly: {
    alignItems: 'center',
    justifyContent: 'center',
  },

  topBarWrapper: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: 'rgba(13,13,13,0.96)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: DIVIDER,
    zIndex: 20,
  },

  saleBanner: {
    paddingHorizontal: 0,
    backgroundColor: OFFER_STRIP_BG,
    borderBottomWidth: 1,
    borderBottomColor: OFFER_STRIP_BORDER,
  },
  saleBannerInner: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  saleDot: {
    width: 9,
    height: 9,
    borderRadius: 99,
    backgroundColor: OFFER_ACCENT,
    opacity: 0.95,
  },
  saleBannerCenterAbs: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saleBannerText: {
    fontSize: 14.5,
    fontWeight: '900',
    letterSpacing: 1.0,
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
    textTransform: 'uppercase',
  },
  saleBannerTextCompact: {
    fontSize: 10.2,
    letterSpacing: 0.5,
  },
  saleBannerTextTiny: {
    fontSize: 9.4,
    letterSpacing: 0.35,
  },

  topBarInner: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    position: 'relative',
  },

  topBarInnerStreakRow: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    paddingTop: 4,
    paddingBottom: 6,
  },

  brandWrap: {
    paddingVertical: 4,
    paddingRight: 8,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: TEXT_IVORY,
    letterSpacing: 2.2,
    fontFamily: SYSTEM_SANS,
  },
  brandTitleCompact: {
    fontSize: 13,
    letterSpacing: 1.4,
  },

  centerSlotAbs: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },

  rightTools: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
  },

  leaderboardBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 7,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(198,166,100,0.10)',
    borderWidth: StyleSheet.hairlineWidth,
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
    paddingVertical: 6,
    paddingHorizontal: 9,
    gap: 6,
    maxWidth: 120,
  },
  leaderboardBtnText: {
    fontSize: 10,
    fontWeight: '900',
    letterSpacing: 1.2,
    color: GOLD,
    textTransform: 'uppercase',
    fontFamily: SYSTEM_SANS,
    flexShrink: 1,
  },
  leaderboardBtnTextCompact: {
    fontSize: 8.5,
    letterSpacing: 0.9,
  },

  settingsChipSmall: {
    backgroundColor: '#2B2B2B',
    borderRadius: 999,
    padding: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3A3A3A',
  },
  settingsChipSmallPhone: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
    padding: 0,
  },
  settingsChipSmallCompact: {
    padding: 2.5,
  },

  /* ------------------ STREAK ------------------ */
  streakWrap: { paddingVertical: 2, width: '100%' },
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
    alignItems: 'center',
  },
  streakBarOuter: {
    width: '100%',
    height: 28,
    borderRadius: 999,
    backgroundColor: '#1F1F1F',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#333333',
  },
  streakBarOuterWide: { width: '100%' },
  streakBarOuterCompactUI: {
    height: 20,
  },
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
    height: '55%',
    backgroundColor: 'rgba(255,255,255,0.10)',
    opacity: 0.20,
  },

  streakShimmer: {
    position: 'absolute',
    top: -8,
    bottom: -8,
    width: 140,
    backgroundColor: 'rgba(255,255,255,0.12)',
    opacity: 0.20,
  },

  streakBarOverlay: {
    flex: 1,
    position: 'relative',
    paddingHorizontal: 18,
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
    fontSize: 10,
    fontWeight: '900',
    color: TEXT_IVORY,
    letterSpacing: 1.2,
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
    fontSize: 10,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
    opacity: 0.92,
  },

  streakBarRight: {
    marginLeft: 'auto',
    textAlign: 'right',
    fontSize: 10,
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
  },
  lbCard: {
    borderRadius: 18,
    backgroundColor: '#050505',
    borderWidth: 1,
    borderColor: DIVIDER,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 14,
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
  lbScrollContent: { paddingBottom: 4 },
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
