import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

export type ThemeMode = 'dark' | 'light';

export type AppThemeColors = {
  primary: string;
  accent: string;
  background: string;
  backgroundAlt: string;
  card: string;
  cardAlt: string;
  mutedCard: string;
  elevated: string;
  textPrimary: string;
  textSecondary: string;
  textMuted: string;
  textOnPrimary: string;
  border: string;
  borderStrong: string;
  input: string;
  overlay: string;
  shadow: string;
  danger: string;
  success: string;
  navActive: string;
  navInactive: string;
  loader: string;
};

export type AppTheme = {
  mode: ThemeMode;
  isLight: boolean;
  colors: AppThemeColors;
};

type ThemeContextValue = AppTheme & {
  setThemeMode: (mode: ThemeMode) => Promise<void>;
  toggleThemeMode: () => Promise<void>;
};

const STORAGE_KEY = 'overlooked.themeMode';
const GOLD = '#C2A05A';

export const DARK_THEME_COLORS: AppThemeColors = {
  primary: GOLD,
  accent: GOLD,
  background: '#030303',
  backgroundAlt: '#080808',
  card: '#0B0B0D',
  cardAlt: '#101114',
  mutedCard: '#0E0E11',
  elevated: '#101114',
  textPrimary: '#F3F0EA',
  textSecondary: '#C8C1B8',
  textMuted: '#8B8378',
  textOnPrimary: '#050505',
  border: 'rgba(255,255,255,0.075)',
  borderStrong: 'rgba(255,255,255,0.14)',
  input: '#0B0B0D',
  overlay: 'rgba(0,0,0,0.86)',
  shadow: 'rgba(0,0,0,0.24)',
  danger: '#FF6B6B',
  success: '#72D188',
  navActive: GOLD,
  navInactive: '#8F8578',
  loader: GOLD,
};

export const LIGHT_THEME_COLORS: AppThemeColors = {
  primary: '#B98F3E',
  accent: '#9A762C',
  background: '#F7F3EC',
  backgroundAlt: '#EFE8DD',
  card: '#FFFFFF',
  cardAlt: '#F1E9DC',
  mutedCard: '#F4EEE5',
  elevated: '#FFFFFF',
  textPrimary: '#11100E',
  textSecondary: '#5C564F',
  textMuted: '#8A8176',
  textOnPrimary: '#14110D',
  border: '#DDD3C6',
  borderStrong: '#C8B89C',
  input: '#FFFFFF',
  overlay: 'rgba(20,17,13,0.34)',
  shadow: 'rgba(67,48,22,0.12)',
  danger: '#B94747',
  success: '#2F7A48',
  navActive: '#9A762C',
  navInactive: '#7C7164',
  loader: '#B98F3E',
};

const DEFAULT_THEME: ThemeContextValue = {
  mode: 'dark',
  isLight: false,
  colors: DARK_THEME_COLORS,
  setThemeMode: async () => {},
  toggleThemeMode: async () => {},
};

const ThemeContext = createContext<ThemeContextValue>(DEFAULT_THEME);

function normalizeThemeMode(value: string | null): ThemeMode {
  return value === 'light' ? 'light' : 'dark';
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>('dark');

  useEffect(() => {
    let cancelled = false;

    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (!cancelled) setMode(normalizeThemeMode(value));
      })
      .catch(() => {
        if (!cancelled) setMode('dark');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;

    const colors = mode === 'light' ? LIGHT_THEME_COLORS : DARK_THEME_COLORS;
    document.documentElement.style.backgroundColor = colors.background;
    document.body.style.backgroundColor = colors.background;
    document.body.style.color = colors.textPrimary;
    document.documentElement.dataset.overlookedTheme = mode;
  }, [mode]);

  const value = useMemo<ThemeContextValue>(() => {
    const colors = mode === 'light' ? LIGHT_THEME_COLORS : DARK_THEME_COLORS;

    const setThemeMode = async (nextMode: ThemeMode) => {
      setMode(nextMode);
      await AsyncStorage.setItem(STORAGE_KEY, nextMode);
    };

    const toggleThemeMode = async () => {
      await setThemeMode(mode === 'light' ? 'dark' : 'light');
    };

    return {
      mode,
      isLight: mode === 'light',
      colors,
      setThemeMode,
      toggleThemeMode,
    };
  }, [mode]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
