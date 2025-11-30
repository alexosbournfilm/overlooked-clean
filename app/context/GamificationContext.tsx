// GamificationContext.tsx
import React, {
  createContext,
  useContext,
  useEffect,
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
    try {
      setState((prev) => ({ ...prev, loading: true }));

      const {
        data: { user },
      } = await supabase.auth.getUser();

      // Not signed in → reset to defaults
      if (!user) {
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

      const { data: profile, error } = await supabase
        .from('users')
        .select('id, xp, level, level_title, banner_color')
        .eq('id', user.id)
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
    }
  };

  useEffect(() => {
    load();
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
