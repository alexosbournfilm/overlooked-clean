// app/lib/useMonthlyStreak.ts
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "../context/AuthProvider";
import {
  clearPersistedAuthSessionIfInvalidRefreshToken,
  isInvalidRefreshTokenError,
} from "./authSession";

/**
 * Instant streak rendering:
 * - Use AuthProvider first to get uid without triggering auth recovery.
 * - Show cached value instantly (module cache) while fetching a fresh value.
 */

// Simple in-memory cache (survives screen changes in a single app session)
const STREAK_CACHE: Record<string, { streak: number; ts: number }> = {};
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes (adjust if you want)

export function useCreativeStreak(targetUserId?: string) {
  const { ready: authReady, userId: signedInUserId } = useAuth();

  const [streak, setStreak] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const lastUserIdRef = useRef<string>("");

  const resolveUserId = useCallback(async (): Promise<string | null> => {
    // ✅ Use the target user if provided (Profile viewing someone else)
    let userId = (targetUserId ?? "").trim();
    if (userId) return userId;

    // Prefer AuthProvider's already-recovered user id so this hook does not
    // trigger Supabase auth recovery while app startup is still settling.
    userId = (signedInUserId ?? "").trim();
    if (userId) return userId;

    if (!authReady) return null;

    // Fallback for unusual call sites where AuthProvider has no user yet.
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error) {
        await clearPersistedAuthSessionIfInvalidRefreshToken(error);
        return "";
      }

      const uid = data?.session?.user?.id ?? "";
      if (uid) return uid;
    } catch (e) {
      await clearPersistedAuthSessionIfInvalidRefreshToken(e);
      // ignore, fallback below
    }

    // ✅ Fallback: getUser() can be slower because it may hit the network
    try {
      const { data: authData, error } = await supabase.auth.getUser();
      if (error) {
        await clearPersistedAuthSessionIfInvalidRefreshToken(error);
        return "";
      }

      return authData?.user?.id ?? "";
    } catch (e) {
      await clearPersistedAuthSessionIfInvalidRefreshToken(e);
      return "";
    }
  }, [authReady, signedInUserId, targetUserId]);

  const fetchStreak = useCallback(async () => {
    setErrorMsg(null);

    // Resolve uid early
    const userId = await resolveUserId();

    if (userId === null) {
      setLoading(true);
      return;
    }

    lastUserIdRef.current = userId;

    if (!userId) {
      setStreak(0);
      setLoading(false);
      return;
    }

    // ✅ Instant render: use cached streak immediately if fresh
    const cached = STREAK_CACHE[userId];
    const isFresh = cached && Date.now() - cached.ts < CACHE_TTL_MS;

    if (isFresh) {
      setStreak(cached.streak);
      // We still fetch in the background, but don't block UI
      setLoading(false);
    } else {
      // No fresh cache, but still stop "minute-long loading" ASAP:
      // show whatever cache we have (even stale) instead of a dash
      if (cached) setStreak(cached.streak);
      setLoading(false);
    }

    // Background refresh (doesn't flip loading back on)
    try {
      const { data, error } = await supabase.rpc("get_monthly_submission_streak", {
        p_user_id: userId,
      });

      if (error) throw error;

      // RPC might return number OR array OR string depending on SQL function style
      let val = 0;

      if (typeof data === "number") val = data;
      else if (typeof data === "string") val = parseInt(data, 10) || 0;
      else if (Array.isArray(data)) {
        const row = data[0];
        if (typeof row === "number") val = row;
        else if (row && typeof row === "object") {
          const anyRow: any = row;
          val =
            (typeof anyRow?.streak === "number" ? anyRow.streak : null) ??
            (typeof anyRow?.get_monthly_submission_streak === "number"
              ? anyRow.get_monthly_submission_streak
              : null) ??
            0;
        }
      } else if (data && typeof data === "object") {
        const anyData: any = data;
        val =
          (typeof anyData?.streak === "number" ? anyData.streak : null) ??
          (typeof anyData?.get_monthly_submission_streak === "number"
            ? anyData.get_monthly_submission_streak
            : null) ??
          0;
      }

      const next = Number.isFinite(val) ? val : 0;

      // Avoid setting state if user changed while we were fetching
      if (lastUserIdRef.current !== userId) return;

      STREAK_CACHE[userId] = { streak: next, ts: Date.now() };
      setStreak(next);
    } catch (e: any) {
      if (isInvalidRefreshTokenError(e)) {
        await clearPersistedAuthSessionIfInvalidRefreshToken(e);
        if (!STREAK_CACHE[userId]) setStreak(0);
        return;
      }

      // Don’t overwrite a visible cached streak with 0 unless we truly have nothing
      if (!STREAK_CACHE[userId]) setStreak(0);
      setErrorMsg(e?.message ?? "Failed to load streak");
    }
  }, [resolveUserId]);

  useEffect(() => {
    fetchStreak();
  }, [fetchStreak]);

  return { streak, loading, errorMsg, refreshStreak: fetchStreak };
}

export const useMonthlyStreak = useCreativeStreak;
