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
const GOLD = '#C6A664';

export const DARK_THEME_COLORS: AppThemeColors = {
  primary: GOLD,
  accent: GOLD,
  background: '#050505',
  backgroundAlt: '#0A0A0A',
  card: '#0D0D0F',
  cardAlt: '#16161A',
  mutedCard: '#111114',
  elevated: '#111114',
  textPrimary: '#F4EFE6',
  textSecondary: '#D8D2C8',
  textMuted: '#8F8578',
  textOnPrimary: '#050505',
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.18)',
  input: '#0F0F0F',
  overlay: 'rgba(0,0,0,0.86)',
  shadow: 'rgba(0,0,0,0.32)',
  danger: '#FF6B6B',
  success: '#72D188',
  navActive: GOLD,
  navInactive: '#8F8578',
  loader: GOLD,
};

export const LIGHT_THEME_COLORS: AppThemeColors = {
  primary: '#C9A45C',
  accent: '#9A762C',
  background: '#F8F3EA',
  backgroundAlt: '#F1E8DA',
  card: '#FFFFFF',
  cardAlt: '#EFE2CB',
  mutedCard: '#F1E8DA',
  elevated: '#FFFFFF',
  textPrimary: '#14110D',
  textSecondary: '#5F574C',
  textMuted: '#8A8073',
  textOnPrimary: '#14110D',
  border: '#DED2BF',
  borderStrong: '#CDBD9F',
  input: '#FFFFFF',
  overlay: 'rgba(20,17,13,0.34)',
  shadow: 'rgba(111,83,28,0.16)',
  danger: '#B94747',
  success: '#2F7A48',
  navActive: '#9A762C',
  navInactive: '#8A7A61',
  loader: '#C9A45C',
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
