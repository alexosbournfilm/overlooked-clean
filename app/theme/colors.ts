import { DARK_THEME_COLORS, LIGHT_THEME_COLORS } from '../context/ThemeContext';

export const COLORS = {
  ...DARK_THEME_COLORS,
  gradientStart: DARK_THEME_COLORS.background,
  gradientEnd: DARK_THEME_COLORS.background,
  outline: DARK_THEME_COLORS.border,
};

export const LIGHT_COLORS = {
  ...LIGHT_THEME_COLORS,
  gradientStart: LIGHT_THEME_COLORS.background,
  gradientEnd: LIGHT_THEME_COLORS.background,
  outline: LIGHT_THEME_COLORS.border,
};

export default COLORS;
