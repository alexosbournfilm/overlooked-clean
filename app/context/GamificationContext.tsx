// GamificationContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from 'react';
import { supabase } from '../lib/supabase';

export type CreativeCalendarDay = {
  date: string;
  label: string;
  active: boolean;
  actions: string[];
};

export type CreativeActionSummary = {
  action_type: string;
  action_date?: string | null;
  points?: number | null;
  source_type?: string | null;
  source_id?: string | null;
  created_at?: string | null;
  metadata?: Record<string, any> | null;
};

type GamificationState = {
  loading: boolean;
  userId: string | null;
  xp: number;
  level: number;
  levelTitle: string;
  bannerColor: string;
  nextLevel: number;
  currentLevelMinXp: number;
  nextLevelMinXp: number;
  progress: number;
  creativeMomentumScore: number;
  creativeMomentumLevel: string;
  currentCreativeStreak: number;
  bestCreativeStreak: number;
  weeklyGoal: number;
  weeklyActions: number;
  challengesEntered: number;
  submissionsMade: number;
  activeCreativeWeeks: number;
  weekCalendar: CreativeCalendarDay[];
  recentCreativeActions: CreativeActionSummary[];
  nextSuggestedAction: string;
  refresh: () => Promise<void>;
};

const GamificationContext = createContext<GamificationState | undefined>(
  undefined,
);

const DEFAULT_CREATIVE_STATE = {
  creativeMomentumScore: 0,
  creativeMomentumLevel: 'Getting Started',
  currentCreativeStreak: 0,
  bestCreativeStreak: 0,
  weeklyGoal: 5,
  weeklyActions: 0,
  challengesEntered: 0,
  submissionsMade: 0,
  activeCreativeWeeks: 0,
  weekCalendar: [] as CreativeCalendarDay[],
  recentCreativeActions: [] as CreativeActionSummary[],
  nextSuggestedAction: 'Complete one creative action today.',
};

function looksLikeMissingColumnError(error: any) {
  const message = String(error?.message || '').toLowerCase();
  return (
    (message.includes('column') &&
      (message.includes('does not exist') || message.includes('could not find'))) ||
    (message.includes('schema cache') && message.includes('column'))
  );
}

function withTimeout<T = any>(promise: PromiseLike<T>, ms = 8000): Promise<any> {
  return new Promise((resolve, reject) => {
    const id = setTimeout(() => reject(new Error('Request timed out')), ms);

    Promise.resolve(promise)
      .then((value: any) => {
        clearTimeout(id);
        resolve(value);
      })
      .catch((error: any) => {
        clearTimeout(id);
        reject(error);
      });
  });
}

function normalizeCalendarDay(row: any): CreativeCalendarDay | null {
  if (!row?.date) return null;

  return {
    date: String(row.date),
    label: String(row.label || ''),
    active: Boolean(row.active),
    actions: Array.isArray(row.actions) ? row.actions.map(String) : [],
  };
}

function normalizeCreativeState(raw: any, profile?: any) {
  const weeklyGoal = Number(raw?.weekly_goal ?? 5) || 5;
  const weeklyActions = Math.max(0, Number(raw?.weekly_actions ?? 0) || 0);
  const currentCreativeStreak = Math.max(
    0,
    Number(raw?.current_streak ?? profile?.current_creative_streak ?? 0) || 0
  );
  const bestCreativeStreak = Math.max(
    0,
    Number(raw?.best_streak ?? profile?.best_creative_streak ?? currentCreativeStreak) || 0
  );
  const creativeMomentumScore = Math.max(
    0,
    Number(raw?.momentum_score ?? profile?.creative_momentum_score ?? 0) || 0
  );
  const creativeMomentumLevel =
    String(raw?.momentum_level || profile?.creative_momentum_level || '').trim() ||
    DEFAULT_CREATIVE_STATE.creativeMomentumLevel;
  const weekCalendar = Array.isArray(raw?.week_calendar)
    ? raw.week_calendar.map(normalizeCalendarDay).filter(Boolean)
    : DEFAULT_CREATIVE_STATE.weekCalendar;

  const recentCreativeActions = Array.isArray(raw?.recent_actions)
    ? raw.recent_actions
    : DEFAULT_CREATIVE_STATE.recentCreativeActions;

  return {
    creativeMomentumScore,
    creativeMomentumLevel,
    currentCreativeStreak,
    bestCreativeStreak,
    weeklyGoal,
    weeklyActions,
    challengesEntered: Math.max(0, Number(raw?.challenges_entered ?? 0) || 0),
    submissionsMade: Math.max(0, Number(raw?.submissions_made ?? 0) || 0),
    activeCreativeWeeks: Math.max(
      0,
      Number(raw?.active_weeks ?? profile?.active_creative_weeks ?? 0) || 0
    ),
    weekCalendar,
    recentCreativeActions,
    nextSuggestedAction:
      weeklyActions >= weeklyGoal
        ? 'Your craft is building. Keep going.'
        : currentCreativeStreak > 0
        ? 'Submit, vote, or complete a prompt to keep your streak alive.'
        : 'Complete one creative action today.',
  };
}

export const GamificationProvider = ({ children }: { children: ReactNode }) => {
  const [state, setState] = useState<GamificationState>({
    loading: true,
    userId: null,
    xp: 0,
    level: 1,
    levelTitle: 'Background Pixel',
    bannerColor: '#FFEDE4',
    nextLevel: 2,
    currentLevelMinXp: 0,
    nextLevelMinXp: 500,
    progress: 0,
    ...DEFAULT_CREATIVE_STATE,
    refresh: async () => {},
  });

  const inFlightRef = useRef(false);
  const lastLoadedUserIdRef = useRef<string | null>(null);
  const mountedRef = useRef(false);

  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const computeProgress = (xp: number, level: number) => {
    const safeLevel = level > 0 ? level : 1;

    const currentLevelMinXp = (safeLevel - 1) * 500;
    const nextLevel = safeLevel + 1;
    const nextLevelMinXp = (nextLevel - 1) * 500;

    const span = nextLevelMinXp - currentLevelMinXp || 1;
    const raw = (xp - currentLevelMinXp) / span;

    const progress = Math.max(0, Math.min(1, raw));

    return {
      nextLevel,
      currentLevelMinXp,
      nextLevelMinXp,
      progress,
    };
  };

  const load = async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      if (mountedRef.current) {
        setState((prev) => ({ ...prev, loading: true }));
      }

      const { data: sessionData } = await withTimeout(
        supabase.auth.getSession(),
        8000
      );

      const uid = sessionData?.session?.user?.id ?? null;

      if (!uid) {
        lastLoadedUserIdRef.current = null;

        if (mountedRef.current) {
          setState((prev) => ({
            ...prev,
            loading: false,
            userId: null,
            xp: 0,
            level: 1,
            levelTitle: 'Background Pixel',
            bannerColor: '#FFEDE4',
            nextLevel: 2,
            currentLevelMinXp: 0,
            nextLevelMinXp: 500,
            progress: 0,
            ...DEFAULT_CREATIVE_STATE,
          }));
        }

        return;
      }

      const currentState = stateRef.current;

      if (
        lastLoadedUserIdRef.current === uid &&
        currentState.userId === uid &&
        !currentState.loading
      ) {
        if (mountedRef.current) {
          setState((prev) => ({ ...prev, loading: false }));
        }

        return;
      }

      let profileResult = await withTimeout(
        supabase
          .from('users')
          .select(
            [
              'id',
              'xp',
              'level',
              'level_title',
              'banner_color',
              'current_creative_streak',
              'best_creative_streak',
              'active_creative_weeks',
              'creative_momentum_score',
              'creative_momentum_level',
            ].join(', ')
          )
          .eq('id', uid)
          .single(),
        8000
      );

      if (profileResult?.error && looksLikeMissingColumnError(profileResult.error)) {
        profileResult = await withTimeout(
          supabase
            .from('users')
            .select('id, xp, level, level_title, banner_color')
            .eq('id', uid)
            .single(),
          8000
        );
      }

      const { data: profile, error } = profileResult;

      if (error || !profile) {
        console.log('Gamification load error', error);

        if (mountedRef.current) {
          setState((prev) => ({ ...prev, loading: false }));
        }

        return;
      }

      const xp = profile.xp ?? 0;
      const level = profile.level ?? 1;
      const levelTitle = profile.level_title || 'Background Pixel';
      const bannerColor = profile.banner_color || '#FFEDE4';

      const derived = computeProgress(xp, level);
      let creativeState = normalizeCreativeState(null, profile);

      try {
        const { data: consistency, error: consistencyError } = await withTimeout(
          supabase.rpc('refresh_creative_consistency', {
            p_user_id: profile.id,
          }),
          8000
        );

        if (!consistencyError && consistency) {
          creativeState = normalizeCreativeState(consistency, profile);
        } else if (consistencyError) {
          console.log('Creative consistency load error', consistencyError.message);
        }
      } catch (consistencyFatal: any) {
        console.log('Creative consistency load fatal', consistencyFatal?.message || consistencyFatal);
      }

      lastLoadedUserIdRef.current = profile.id;

      if (mountedRef.current) {
        setState({
          loading: false,
          userId: profile.id,
          xp,
          level,
          levelTitle,
          bannerColor,
          nextLevel: derived.nextLevel,
          currentLevelMinXp: derived.currentLevelMinXp,
          nextLevelMinXp: derived.nextLevelMinXp,
          progress: derived.progress,
          ...creativeState,
          refresh: load,
        });
      }
    } catch (e: any) {
      console.log('Gamification load fatal', e?.message || e);

      if (mountedRef.current) {
        setState((prev) => ({ ...prev, loading: false }));
      }
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    mountedRef.current = true;

    load();

    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (
        event === 'SIGNED_IN' ||
        event === 'SIGNED_OUT' ||
        event === 'USER_UPDATED'
      ) {
        lastLoadedUserIdRef.current = null;
        load();
      }
    });

    return () => {
      mountedRef.current = false;

      try {
        (sub as any)?.subscription?.unsubscribe?.();
      } catch {}
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <GamificationContext.Provider value={{ ...state, refresh: load }}>
      {children}
    </GamificationContext.Provider>
  );
};

export const useGamification = () => {
  const ctx = useContext(GamificationContext);

  if (!ctx) {
    throw new Error('useGamification must be used within GamificationProvider');
  }

  return ctx;
};
