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
  progress: number; // 0-1, progress within current level
  refresh: () => Promise<void>;
};

const GamificationContext = createContext<GamificationState | undefined>(
  undefined,
);

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
    refresh: async () => {},
  });

  // ✅ Speed-only: avoid duplicate loads / racey re-renders
  const inFlightRef = useRef(false);
  const lastLoadedUserIdRef = useRef<string | null>(null);

  /**
   * Compute level progress for infinite levels.
   *
   * - Each level is 500 XP apart (backend owns actual mapping).
   * - For level N, we show progress from XP at start of N up to start of N+1.
   * - For arbitrarily high levels, we just keep going (no 50 cap here).
   *
   * Note: For levels >= 50, your SQL/triggers should keep writing the same
   * level_title + banner_color; we simply display what the backend sends.
   */
  const computeProgress = (xp: number, level: number) => {
    const safeLevel = level > 0 ? level : 1;

    const currentLevelMinXp = (safeLevel - 1) * 500;
    const nextLevel = safeLevel + 1; // 🔓 infinite progression
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
    // ✅ Prevent overlapping calls (happens easily if multiple consumers refresh)
    if (inFlightRef.current) return;
    inFlightRef.current = true;

    try {
      setState((prev) => ({ ...prev, loading: true }));

      // ✅ Speed-only: use getSession first (fast + avoids extra /user call)
      // No logic change: still determines if signed-in or not.
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData?.session?.user?.id ?? null;

      // Not signed in → reset to defaults
      if (!uid) {
        lastLoadedUserIdRef.current = null;
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
        }));
        return;
      }

      // ✅ If we already loaded this uid and values exist, don’t refetch unless forced.
      // (No logic change: this just prevents duplicate identical queries.)
      if (lastLoadedUserIdRef.current === uid && state.userId === uid && !state.loading) {
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }

      const { data: profile, error } = await supabase
        .from('users')
        .select('id, xp, level, level_title, banner_color')
        .eq('id', uid)
        .single();

      if (error || !profile) {
        console.log('Gamification load error', error);
        setState((prev) => ({ ...prev, loading: false }));
        return;
      }

      const xp = profile.xp ?? 0;
      const level = profile.level ?? 1;
      const levelTitle = profile.level_title || 'Background Pixel';
      const bannerColor = profile.banner_color || '#FFEDE4';

      const derived = computeProgress(xp, level);

      lastLoadedUserIdRef.current = profile.id;

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
        refresh: load,
      });
    } catch (e) {
      console.log('Gamification load fatal', e);
      setState((prev) => ({ ...prev, loading: false }));
    } finally {
      inFlightRef.current = false;
    }
  };

  useEffect(() => {
    load();

    // ✅ Speed-only: keep gamification in sync without extra mounts/refreshes elsewhere.
    // This does NOT change behavior; it just ensures state updates happen once here
    // instead of multiple components triggering redundant loads.
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        // Clear cache so next load fetches correct user values
        lastLoadedUserIdRef.current = null;
        load();
      }
    });

    return () => {
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
