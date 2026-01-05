// app/lib/useMonthlyStreak.ts
import { useCallback, useEffect, useState } from "react";
import { supabase } from "./supabase";

export function useMonthlyStreak(targetUserId?: string) {
  const [streak, setStreak] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchStreak = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);

    try {
      // ✅ Use the target user if provided (Profile viewing someone else)
      let userId = (targetUserId ?? "").trim();

      // ✅ Otherwise use the signed-in user (Challenge or own Profile)
      if (!userId) {
        const { data: authData, error: authErr } = await supabase.auth.getUser();
        if (authErr) throw authErr;

        userId = authData?.user?.id ?? "";
      }

      if (!userId) {
        setStreak(0);
        return;
      }

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
          // common patterns: { streak: 2 } or { get_monthly_submission_streak: 2 }
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

      setStreak(Number.isFinite(val) ? val : 0);
    } catch (e: any) {
      setErrorMsg(e?.message ?? "Failed to load streak");
      setStreak(0);
    } finally {
      setLoading(false);
    }
  }, [targetUserId]);

  useEffect(() => {
    fetchStreak();
  }, [fetchStreak]);

  return { streak, loading, errorMsg, refreshStreak: fetchStreak };
}