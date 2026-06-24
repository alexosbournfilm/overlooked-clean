import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";

export const SUPABASE_AUTH_STORAGE_KEY = "overlooked.supabase.auth";

const INVALID_REFRESH_TOKEN_MESSAGES = [
  "invalid refresh token",
  "refresh token not found",
  "refresh_token_not_found",
];

function authErrorText(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) {
    return [error.name, error.message].filter(Boolean).join(" ");
  }

  if (typeof error === "object") {
    const err = error as any;
    const parts = [
      err.name,
      err.message,
      err.code,
      err.error,
      err.error_code,
      err.error_description,
    ]
      .filter(Boolean)
      .map(String);

    if (parts.length) return parts.join(" ");

    try {
      return JSON.stringify(error);
    } catch {
      return String(error);
    }
  }

  return String(error);
}

export function isInvalidRefreshTokenError(error: unknown): boolean {
  const message = authErrorText(error).toLowerCase();

  return INVALID_REFRESH_TOKEN_MESSAGES.some((needle) =>
    message.includes(needle)
  );
}

export async function clearPersistedAuthSession() {
  try {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.localStorage) {
        const keysToRemove: string[] = [];

        for (let i = 0; i < window.localStorage.length; i += 1) {
          const key = window.localStorage.key(i);
          if (!key) continue;

          if (
            key === SUPABASE_AUTH_STORAGE_KEY ||
            key === `${SUPABASE_AUTH_STORAGE_KEY}-user` ||
            key.startsWith("sb-") ||
            key.includes("supabase") ||
            key.includes(SUPABASE_AUTH_STORAGE_KEY)
          ) {
            keysToRemove.push(key);
          }
        }

        keysToRemove.forEach((key) => window.localStorage.removeItem(key));
      }

      return;
    }

    await AsyncStorage.multiRemove([
      SUPABASE_AUTH_STORAGE_KEY,
      `${SUPABASE_AUTH_STORAGE_KEY}-user`,
    ]);
  } catch (e: any) {
    console.warn(
      "clearPersistedAuthSession error:",
      e?.message || String(e)
    );
  }
}

export async function clearPersistedAuthSessionIfInvalidRefreshToken(
  error: unknown
) {
  if (!isInvalidRefreshTokenError(error)) return false;

  await clearPersistedAuthSession();
  return true;
}

export function installSupabaseAuthConsoleFilter() {
  const isDev = typeof __DEV__ !== "undefined" ? __DEV__ : false;
  if (!isDev) return;

  const G = globalThis as any;
  if (G.__OVERLOOKED_SUPABASE_AUTH_CONSOLE_FILTER__) return;

  const originalError = console.error.bind(console);

  G.__OVERLOOKED_SUPABASE_AUTH_CONSOLE_FILTER__ = {
    originalError,
  };

  console.error = (...args: any[]) => {
    if (args.some(isInvalidRefreshTokenError)) return;
    originalError(...args);
  };
}
