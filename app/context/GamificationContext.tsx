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
  progress: number;
  refresh: () => Promise<void>;
};

const GamificationContext = createContext<GamificationState | undefined>(
  undefined,
);

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

      const { data: profile, error } = await withTimeout(
        supabase
          .from('users')
          .select('id, xp, level, level_title, banner_color')
          .eq('id', uid)
          .single(),
        8000
      );

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