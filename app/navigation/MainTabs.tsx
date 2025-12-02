// app/navigation/MainTabs.tsx
import React, { memo, useEffect, useRef, useState } from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TabActions, useNavigation } from '@react-navigation/native';
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
import { useGamification } from '../context/GamificationContext';

const Tab = createBottomTabNavigator();

/* ------------------------------- palette ------------------------------- */
const DARK_BG = '#0D0D0D';
const DARK_ELEVATED = '#171717';
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

const VOTES_PER_MONTH = 10;

function normalizeIsoRange(start: string, end: string) {
  const mkStart = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? `${s}T00:00:00.000Z`
      : new Date(s).toISOString();
  const mkEnd = (s: string) =>
    /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? `${s}T23:59:59.999Z`
      : new Date(s).toISOString();
  return {
    startIso: new Date(mkStart(start)).toISOString(),
    endIso: new Date(mkEnd(end)).toISOString(),
  };
}

async function fetchCurrentChallenge() {
  const { error: finalizeErr } = await supabase.rpc(
    'finalize_last_month_winner_if_needed'
  );
  if (finalizeErr) {
    console.warn(
      'finalize_last_month_winner_if_needed failed:',
      finalizeErr.message
    );
  }

  const { data, error } = await supabase
    .from('monthly_challenges')
    .select('theme_word, winner_submission_id, month_start, month_end')
    .order('month_start', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.warn('Failed to fetch current challenge:', error.message);
  }

  return (
    (data as
      | {
          theme_word: string | null;
          winner_submission_id: string | null;
          month_start: string;
          month_end: string;
        }
      | null) ?? null
  );
}

async function countUserVotesInRange(
  uid: string,
  range: { start: string; end: string }
) {
  try {
    const { startIso, endIso } = normalizeIsoRange(range.start, range.end);

    const attempt = async (tsCol: 'created_at' | 'voted_at') =>
      supabase
        .from('user_votes')
        .select('user_id', { count: 'exact', head: true })
        .eq('user_id', uid)
        .gte(tsCol, startIso)
        .lt(tsCol, endIso);

    let { count, error } = await attempt('created_at');
    if (error) {
      const retry = await attempt('voted_at');
      count = retry.count ?? 0;
      if (retry.error) {
        console.warn(
          'Failed to count monthly votes (header):',
          retry.error.message
        );
        return 0;
      }
    }

    return count ?? 0;
  } catch (e: any) {
    console.warn(
      'Failed to count monthly votes (header):',
      e?.message || String(e)
    );
    return 0;
  }
}

/* --------------------------- Top Bar elements -------------------------- */

function BrandWordmark() {
  return (
    <Pressable style={styles.brandWrap}>
      <Text style={styles.brandTitle}>OVERLOOKED</Text>
    </Pressable>
  );
}

/**
 * Votes left indicator
 */
const TopBarVotesKicker = memo(function TopBarVotesKicker() {
  const [loading, setLoading] = useState(true);
  const [left, setLeft] = useState<number>(VOTES_PER_MONTH);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const authSubRef = useRef<{ unsubscribe: () => void } | null>(null);

  useEffect(() => {
    let mounted = true;

    const setupForUser = async (uid: string | null) => {
      try {
        channelRef.current?.unsubscribe();
      } catch {
        // ignore
      }
      channelRef.current = null;

      if (!mounted) return;

      if (!uid) {
        setLeft(VOTES_PER_MONTH);
        setLoading(false);
        return;
      }

      setLoading(true);

      const challenge = await fetchCurrentChallenge();
      if (!mounted) return;

      if (!challenge) {
        setLeft(VOTES_PER_MONTH);
        setLoading(false);
        return;
      }

      const used = await countUserVotesInRange(uid, {
        start: challenge.month_start,
        end: challenge.month_end,
      });

      if (!mounted) return;

      setLeft(Math.max(0, VOTES_PER_MONTH - used));
      setLoading(false);

      try {
        const ch = supabase
          .channel(`votes-kicker-${uid}`)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'user_votes',
              filter: `user_id=eq.${uid}`,
            },
            async () => {
              if (!mounted) return;
              const fresh = await countUserVotesInRange(uid, {
                start: challenge.month_start,
                end: challenge.month_end,
              });
              if (!mounted) return;
              setLeft(Math.max(0, VOTES_PER_MONTH - fresh));
            }
          )
          .subscribe();

        channelRef.current = ch;
      } catch (err) {
        console.warn('votes kicker realtime failed:', (err as any)?.message);
      }
    };

    const bootstrap = async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id ?? null;
        await setupForUser(uid);
      } catch (err) {
        console.warn('getUser failed (votes kicker):', (err as any)?.message);
        if (mounted) {
          setLeft(VOTES_PER_MONTH);
          setLoading(false);
        }
      }
    };

    bootstrap();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (!mounted) return;
        const uid = session?.user?.id ?? null;
        setupForUser(uid);
      }
    );

    authSubRef.current =
      (authListener as any)?.subscription ?? (authListener as any) ?? null;

    return () => {
      mounted = false;
      try {
        channelRef.current?.unsubscribe();
      } catch {
        // ignore
      }
      try {
        authSubRef.current?.unsubscribe();
      } catch {
        // ignore
      }
    };
  }, []);

  return (
    <View style={styles.kickerRow}>
      <Text style={styles.kickerLabel}>VOTES LEFT</Text>
      <Text style={styles.kickerDot}>·</Text>
      <Text style={styles.kickerNumber}>{loading ? '—' : left}</Text>
      <Text style={styles.kickerTotal}>/ {VOTES_PER_MONTH}</Text>
    </View>
  );
});

/* --------------------------- Leaderboard Modal ------------------------- */

type LeaderboardTab = 'monthly' | 'allTime' | 'city' | 'category';
type CategoryType = 'film' | 'acting' | 'music';

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
  category?: string | null;
  submissions_count?: number | null;
};

type LeaderboardModalProps = {
  visible: boolean;
  onClose: () => void;
};

const LeaderboardModal = memo(function LeaderboardModal({
  visible,
  onClose,
}: LeaderboardModalProps) {
  const navigation = useNavigation<any>();

  const [activeTab, setActiveTab] = useState<LeaderboardTab>('monthly');
  const [activeCategory, setActiveCategory] = useState<CategoryType>('film');
  const [loading, setLoading] = useState(false);
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [userCityId, setUserCityId] = useState<number | null>(null);
  const [userCityName, setUserCityName] = useState<string | null>(null);

  const handlePressEntry = (entry: LeaderboardEntry) => {
    navigation.navigate('Profile', {
      userId: entry.user_id,
    });
    onClose();
  };

  // Grab user's city when modal opens
  useEffect(() => {
    if (!visible) return;

    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        const uid = data?.user?.id;
        if (!uid) return;

        const { data: userRow, error: userErr } = await supabase
          .from('users')
          .select('city_id')
          .eq('id', uid)
          .maybeSingle();

        if (userErr) {
          console.warn('Failed to fetch user city:', userErr.message);
          return;
        }

        if (userRow?.city_id != null) {
          setUserCityId(userRow.city_id as number);

          const { data: cityRow } = await supabase
            .from('cities')
            .select('name')
            .eq('id', userRow.city_id)
            .maybeSingle();

          if (cityRow?.name) setUserCityName(cityRow.name);
        }
      } catch (e: any) {
        console.warn(
          'Error bootstrapping leaderboard city:',
          e?.message || String(e)
        );
      }
    })();
  }, [visible]);

  const load = async (tabOverride?: LeaderboardTab) => {
    if (!visible) return;

    const tab = tabOverride || activeTab;
    setLoading(true);
    setError(null);

    try {
      if (tab === 'monthly') {
        const { data, error: err } = await supabase
          .from('leaderboard_monthly_current')
          .select('*')
          .order('rank', { ascending: true })
          .limit(100);
        if (err) throw err;
        setEntries((data || []) as LeaderboardEntry[]);
      } else if (tab === 'allTime') {
        const { data, error: err } = await supabase
          .from('leaderboard_all_time')
          .select('*')
          .order('rank', { ascending: true })
          .limit(100);
        if (err) throw err;
        setEntries((data || []) as LeaderboardEntry[]);
      } else if (tab === 'city') {
        if (!userCityId) {
          setEntries([]);
          setError('Set your city in your profile to see your local leaderboard.');
        } else {
          const { data, error: err } = await supabase
            .from('leaderboard_city_all_time')
            .select('*')
            .eq('city_id', userCityId)
            .order('rank', { ascending: true })
            .limit(100);
          if (err) throw err;
          setEntries((data || []) as LeaderboardEntry[]);
        }
      } else if (tab === 'category') {
        const { data, error: err } = await supabase
          .from('leaderboard_category_submissions')
          .select('*')
          .eq('category', activeCategory)
          .order('rank', { ascending: true })
          .limit(100);
        if (err) throw err;
        setEntries((data || []) as LeaderboardEntry[]);
      }
    } catch (e: any) {
      console.warn('Leaderboard fetch error:', e?.message || String(e));
      setError('Could not load leaderboard.');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!visible) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, activeTab, activeCategory, userCityId]);

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
    } else if (activeTab === 'category') {
      primaryValue =
        typeof item.submissions_count === 'number' ? item.submissions_count : 0;
      label = 'Submissions';
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
        key={`${item.user_id}-${item.rank}-${activeTab}-${activeCategory}`}
        style={[styles.lbRow, isTop3 && styles.lbRowTop]}
        onPress={() => handlePressEntry(item)}
      >
        <View style={styles.lbRankWrap}>
          <Text style={[styles.lbRankText, isTop3 && styles.lbRankTextTop]}>
            {item.rank}
          </Text>
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

          {activeTab === 'category' && item.category && (
            <Text style={styles.lbSubCity} numberOfLines={1}>
              {item.category.toUpperCase()}
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
        <View style={styles.lbCard}>
          {/* Header */}
          <View style={styles.lbHeader}>
            <Text style={styles.lbTitle}>Leaderboard</Text>
            <Pressable onPress={onClose} hitSlop={10} style={styles.lbCloseBtn}>
              <Ionicons name="close" size={18} color={TEXT_MUTED} />
            </Pressable>
          </View>

          {/* Tabs */}
          <View style={styles.lbTabs}>
            <Pressable
              onPress={() => setActiveTab('monthly')}
              style={[styles.lbTab, activeTab === 'monthly' && styles.lbTabActive]}
            >
              <Text
                style={[
                  styles.lbTabText,
                  activeTab === 'monthly' && styles.lbTabTextActive,
                ]}
              >
                This Month
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setActiveTab('allTime')}
              style={[styles.lbTab, activeTab === 'allTime' && styles.lbTabActive]}
            >
              <Text
                style={[
                  styles.lbTabText,
                  activeTab === 'allTime' && styles.lbTabTextActive,
                ]}
              >
                All Time
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setActiveTab('city')}
              style={[styles.lbTab, activeTab === 'city' && styles.lbTabActive]}
            >
              <Text
                style={[
                  styles.lbTabText,
                  activeTab === 'city' && styles.lbTabTextActive,
                ]}
              >
                My City
              </Text>
            </Pressable>

            <Pressable
              onPress={() => setActiveTab('category')}
              style={[styles.lbTab, activeTab === 'category' && styles.lbTabActive]}
            >
              <Text
                style={[
                  styles.lbTabText,
                  activeTab === 'category' && styles.lbTabTextActive,
                ]}
              >
                Categories
              </Text>
            </Pressable>
          </View>

          {/* Category sub-tabs */}
          {activeTab === 'category' && (
            <View style={styles.lbCategoryTabs}>
              {(['film', 'acting', 'music'] as CategoryType[]).map((cat) => (
                <Pressable
                  key={cat}
                  onPress={() => setActiveCategory(cat)}
                  style={[
                    styles.lbCategoryTab,
                    activeCategory === cat && styles.lbCategoryTabActive,
                  ]}
                >
                  <Text
                    style={[
                      styles.lbCategoryText,
                      activeCategory === cat && styles.lbCategoryTextActive,
                    ]}
                  >
                    {cat.toUpperCase()}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}

          {/* Content */}
          <View style={styles.lbBody}>
            {loading && (
              <View style={styles.lbLoadingWrap}>
                <ActivityIndicator size="small" color={GOLD} />
                <Text style={styles.lbLoadingText}>
                  Fetching who&apos;s actually doing the work...
                </Text>
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
                  No data yet for this view. Make something. Post something. Vote on
                  something.
                </Text>
              </View>
            )}

            {!loading && !error && entries.length > 0 && (
              <ScrollView
                style={styles.lbScroll}
                contentContainerStyle={styles.lbScrollContent}
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

/* ---------------------- XP Progress (from context) --------------------- */

type TopBarXpProgressProps = {
  variant: 'wide' | 'compact';
  onOpenLeaderboard?: () => void;
};

const TopBarXpProgress = memo(function TopBarXpProgress({
  variant,
  onOpenLeaderboard,
}: TopBarXpProgressProps) {
  const gamification = useGamification();
  const {
    loading,
    xp,
    level,
    levelTitle,
    currentLevelMinXp,
    nextLevelMinXp,
    progress,
  } = gamification;

  const refreshGamification: (() => Promise<void> | void) | null =
    (gamification as any).refresh ||
    (gamification as any).reload ||
    (gamification as any).refetch ||
    null;

  const [ready, setReady] = useState(false);
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
  }, [loading, xp, level, progress, levelTitle, ready, progressAnim]);

  if (loading || !ready) return null;

  const isMax =
    !nextLevelMinXp ||
    nextLevelMinXp <= currentLevelMinXp ||
    (level || 1) >= 50;

  const gained = Math.max(0, (xp || 0) - currentLevelMinXp);
  const span = Math.max(1, (nextLevelMinXp || currentLevelMinXp) - currentLevelMinXp);

  // Minimal width so XP label never cramps against the left
  const widthInterpolated = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['10%', '100%'],
  });

  const nextLevelLabel = isMax ? 'MAX' : `Lv ${(level || 1) + 1}`;

  return (
    <>
      <View
        style={[
          styles.xpWrap,
          isWide ? styles.xpWrapWide : styles.xpWrapCompact,
        ]}
      >
        {onOpenLeaderboard && (
          <View
            style={[
              styles.leaderboardLinkRow,
              isWide
                ? styles.leaderboardLinkRowWide
                : styles.leaderboardLinkRowCompact,
            ]}
          >
            <Pressable onPress={onOpenLeaderboard} hitSlop={8}>
              <Text style={styles.leaderboardLinkText}>VIEW LEADERBOARD</Text>
            </Pressable>
          </View>
        )}

        <View
          style={[styles.xpBarOuter, isWide && styles.xpBarOuterWide]}
        >
          <Animated.View
            style={[
              styles.xpBarFill,
              { width: widthInterpolated },
            ]}
          />
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
                transform: [
                  {
                    translateY: gainTranslate,
                  },
                ],
              },
            ]}
          >
            <Text style={styles.xpGainText}>{gainLabel}</Text>
          </Animated.View>
        )}
      </View>

      {/* Level up micro-modal */}
      <Modal visible={showLevelModal} transparent animationType="none">
        <Animated.View
          style={[
            styles.levelModalOverlay,
            { opacity: modalOpacity },
          ]}
        >
          <Animated.View
            style={[
              styles.levelModalCard,
              {
                transform: [
                  {
                    scale: modalScale,
                  },
                ],
              },
            ]}
          >
            <Text style={styles.levelModalKicker}>LEVEL UP</Text>
            <Text style={styles.levelModalLevel}>
              Lv {lvlFrom} ➜ <Text style={{ color: GOLD }}>Lv {lvlTo}</Text>
            </Text>
            <Text style={styles.levelModalTitle}>{lvlTitleText}</Text>
            <Text style={styles.levelModalHint}>
              Keep creating. Keep getting seen.
            </Text>
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
};

const TopBar = memo(function TopBar({ topOffset, navHeight }: TopBarProps) {
  const { width } = useWindowDimensions();
  const isWide = width >= 980;
  const [showLeaderboard, setShowLeaderboard] = useState(false);

  const wrapperHeight = isWide ? navHeight : navHeight + 24;

  return (
    <>
      <View
        style={[
          styles.topBarWrapper,
          {
            height: wrapperHeight,
            top: topOffset,
          },
        ]}
      >
        <View
          style={[
            styles.topBarInner,
            { height: navHeight },
          ]}
        >
          <BrandWordmark />

          {isWide ? (
            <>
              <View style={styles.xpCenterSlot}>
                <TopBarXpProgress
                  variant="wide"
                  onOpenLeaderboard={() => setShowLeaderboard(true)}
                />
              </View>
              <View style={styles.rightTools}>
                <TopBarVotesKicker />
                <View style={{ width: 12 }} />
                <View style={styles.settingsChip}>
                  <SettingsButton absolute={false} />
                </View>
              </View>
            </>
          ) : (
            <>
              <View style={{ flex: 1 }} />
              <View style={styles.rightTools}>
                <TopBarVotesKicker />
                <View style={{ width: 8 }} />
                <View style={styles.settingsChip}>
                  <SettingsButton absolute={false} />
                </View>
              </View>
            </>
          )}
        </View>

        {!isWide && (
          <View style={styles.topBarInnerXpRow}>
            <TopBarXpProgress
              variant="compact"
              onOpenLeaderboard={() => setShowLeaderboard(true)}
            />
          </View>
        )}
      </View>

      <LeaderboardModal
        visible={showLeaderboard}
        onClose={() => setShowLeaderboard(false)}
      />
    </>
  );
});

function withTopBar(Component: React.ComponentType<any>) {
  const Wrapped = function Wrapped(props: any) {
    const { width } = useWindowDimensions();
    const insets = useSafeAreaInsets();

    const NAV_HEIGHT = width >= 980 ? 56 : 46;
    const topOffset =
      width >= 980
        ? 0
        : Platform.OS === 'ios'
        ? Math.max((insets.top || 0) - 4, 0)
        : 0;

    const contentTopPadding = NAV_HEIGHT + (width >= 980 ? 0 : 26);

    return (
      <View
        style={{
          flex: 1,
          backgroundColor: DARK_BG,
        }}
      >
        <TopBar topOffset={topOffset} navHeight={NAV_HEIGHT} />
        <SafeAreaView
          style={[
            styles.safeArea,
            {
              paddingTop: contentTopPadding,
            },
          ]}
        >
          <Component {...props} />
        </SafeAreaView>
      </View>
    );
  };
  return Wrapped;
}

const FeaturedWrapped = withTopBar(FeaturedScreen);
const JobsWrapped = withTopBar(JobsScreen);
const ChallengeWrapped = withTopBar(ChallengeScreen);
const LocationWrapped = withTopBar(LocationScreen);
const ProfileWrapped = withTopBar(ProfileScreen);
const WorkshopWrapped = withTopBar(WorkshopScreen);

/* --------------------------------- Tabs -------------------------------- */

export default function MainTabs() {
  return (
    <SettingsModalProvider>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: GOLD,
          tabBarInactiveTintColor: TEXT_MUTED,
          tabBarStyle: {
            backgroundColor: DARK_ELEVATED,
            borderTopWidth: 0,
            height: 52,
            paddingTop: 4,
            paddingBottom: Platform.OS === 'ios' ? 10 : 6,
            shadowColor: '#000',
            shadowOpacity: 0.3,
            shadowOffset: {
              width: 0,
              height: -4,
            },
            shadowRadius: 6,
            elevation: 10,
          },
          tabBarLabelStyle: {
            fontSize: 10,
            letterSpacing: 0.7,
            textTransform: 'uppercase',
            fontWeight: '800',
            fontFamily: SYSTEM_SANS,
          },
          tabBarItemStyle: {
            paddingVertical: 0,
          },
          lazy: false,
          detachInactiveScreens: false,
          unmountOnBlur: false,
          tabBarIcon: ({ color }) => {
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
            return <Ionicons name={icon} size={20} color={color} />;
          },
        })}
      >
        <Tab.Screen name="Featured" component={FeaturedWrapped} />
        <Tab.Screen name="Jobs" component={JobsWrapped} />
        <Tab.Screen name="Challenge" component={ChallengeWrapped} />
        <Tab.Screen name="Workshop" component={WorkshopWrapped} />
        <Tab.Screen name="Location" component={LocationWrapped} />
        <Tab.Screen
          name="Chats"
          component={ChatsStack}
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
              navigation.dispatch(
                TabActions.jumpTo('Profile', undefined)
              );
            },
          })}
        />
      </Tab.Navigator>

      <SettingsModal />
    </SettingsModalProvider>
  );
}

/* -------------------------------- Styles -------------------------------- */

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: DARK_BG,
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
  topBarInner: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  topBarInnerXpRow: {
    width: '100%',
    maxWidth: 1200,
    alignSelf: 'center',
    paddingHorizontal: 16,
    paddingTop: 2,
  },
  brandWrap: {
    paddingVertical: 6,
    paddingRight: 8,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '900',
    color: TEXT_IVORY,
    letterSpacing: 2.2,
    fontFamily: SYSTEM_SANS,
  },
  rightTools: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  settingsChip: {
    backgroundColor: '#2B2B2B',
    borderRadius: 999,
    padding: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#3A3A3A',
  },
  kickerRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  kickerLabel: {
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },
  kickerDot: {
    marginHorizontal: 6,
    fontSize: 11,
    fontWeight: '900',
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },
  kickerNumber: {
    fontSize: 15,
    fontWeight: '900',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },
  kickerTotal: {
    fontSize: 13,
    fontWeight: '800',
    color: TEXT_MUTED,
    marginLeft: 2,
    fontFamily: SYSTEM_SANS,
  },
  xpCenterSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  xpWrap: {
    paddingVertical: 2,
  },
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
  leaderboardLinkRow: {
    marginBottom: 2,
  },
  leaderboardLinkRowWide: {
    alignItems: 'center',
  },
  leaderboardLinkRowCompact: {
    alignItems: 'flex-start',
  },
  leaderboardLinkText: {
    fontSize: 9,
    letterSpacing: 1.5,
    fontWeight: '800',
    color: GOLD,
    textTransform: 'uppercase',
    opacity: 0.9,
    fontFamily: SYSTEM_SANS,
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
  xpBarOuterWide: {
    width: '100%',
  },
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
  },
  levelModalCard: {
    paddingVertical: 22,
    paddingHorizontal: 26,
    borderRadius: 18,
    backgroundColor: '#050505',
    borderWidth: 1,
    borderColor: GOLD,
    alignItems: 'center',
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
  /* Leaderboard modal */
  lbOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  lbCard: {
    maxHeight: '82%',
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
  lbTabActive: {
    backgroundColor: GOLD,
  },
  lbTabText: {
    fontSize: 9,
    fontWeight: '700',
    color: TEXT_MUTED,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontFamily: SYSTEM_SANS,
  },
  lbTabTextActive: {
    color: '#050505',
  },
  lbCategoryTabs: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 2,
    marginBottom: 2,
  },
  lbCategoryTab: {
    paddingVertical: 2,
    paddingHorizontal: 8,
    borderRadius: 999,
    marginHorizontal: 4,
    backgroundColor: '#111111',
  },
  lbCategoryTabActive: {
    backgroundColor: GOLD,
  },
  lbCategoryText: {
    fontSize: 8,
    fontWeight: '700',
    color: TEXT_MUTED,
    letterSpacing: 0.8,
    fontFamily: SYSTEM_SANS,
  },
  lbCategoryTextActive: {
    color: '#050505',
  },
  lbBody: {
    flex: 1,
    marginTop: 4,
  },
  lbLoadingWrap: {
    alignItems: 'center',
    paddingVertical: 18,
  },
  lbLoadingText: {
    marginTop: 6,
    fontSize: 9,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },
  lbEmptyWrap: {
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 10,
  },
  lbEmptyText: {
    fontSize: 9,
    color: TEXT_MUTED,
    textAlign: 'center',
    fontFamily: SYSTEM_SANS,
  },
  lbScroll: {
    flex: 1,
  },
  lbScrollContent: {
    paddingBottom: 4,
  },
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
  lbRowTop: {
    borderColor: GOLD,
    backgroundColor: '#141414',
  },
  lbRankWrap: {
    width: 26,
    alignItems: 'center',
  },
  lbRankText: {
    fontSize: 12,
    fontWeight: '900',
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },
  lbRankTextTop: {
    color: GOLD,
  },
  lbCrownDot: {
    marginTop: 1,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: GOLD,
  },
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
  lbAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
  },
  lbAvatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#202020',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lbAvatarFallbackText: {
    fontSize: 10,
    fontWeight: '800',
    color: GOLD,
    fontFamily: SYSTEM_SANS,
  },
  lbInfo: {
    flex: 1,
  },
  lbName: {
    fontSize: 11,
    fontWeight: '800',
    color: TEXT_IVORY,
    fontFamily: SYSTEM_SANS,
  },
  lbSub: {
    fontSize: 8,
    color: TEXT_MUTED,
    marginTop: 1,
    fontFamily: SYSTEM_SANS,
  },
  lbSubCity: {
    fontSize: 7,
    color: TEXT_MUTED,
    marginTop: 1,
    fontFamily: SYSTEM_SANS,
  },
  lbXpWrap: {
    alignItems: 'flex-end',
    marginLeft: 6,
  },
  lbXpValue: {
    fontSize: 11,
    fontWeight: '900',
    color: GOLD,
    fontFamily: SYSTEM_SANS,
  },
  lbXpLabel: {
    fontSize: 7,
    color: TEXT_MUTED,
    fontFamily: SYSTEM_SANS,
  },
});
