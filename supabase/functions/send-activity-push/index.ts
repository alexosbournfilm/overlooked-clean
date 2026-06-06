import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type PreferenceKey =
  | "new_supporters"
  | "followed_submissions"
  | "submission_comments"
  | "submission_votes"
  | "city_jobs"
  | "city_creatives"
  | "job_applications"
  | "comment_replies"
  | "challenge_reminders"
  | "challenge_results";

type ActivityTarget = {
  userId: string | null | undefined;
  preferenceKey: PreferenceKey;
  title: string;
  body: string;
  data: Record<string, unknown>;
};

type UserRow = {
  id: string;
  full_name: string | null;
  expo_push_token: string | null;
  notification_preferences?: Record<string, boolean> | null;
};

type WebhookBody = {
  type?: string;
  table?: string;
  event_type?: string;
  activity_type?: string;
  notification_type?: string;
  record?: Record<string, any>;
  old_record?: Record<string, any>;
};

const jsonHeaders = { "Content-Type": "application/json" };

function isExpoPushToken(token: string | null | undefined): token is string {
  if (!token) return false;
  return token.startsWith("ExponentPushToken[") || token.startsWith("ExpoPushToken[");
}

function unique<T>(values: T[]) {
  return [...new Set(values.filter(Boolean))] as T[];
}

function allowsNotification(user: UserRow, key: PreferenceKey) {
  const prefs = user.notification_preferences ?? {};
  return prefs[key] !== false;
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function screenData(screen: string, params: Record<string, unknown> = {}) {
  return { screen, params };
}

function featuredFilmData(submissionId: unknown, extraParams: Record<string, unknown> = {}) {
  return screenData("Featured", {
    ...extraParams,
    openSubmissionId: submissionId,
    openSearchNonce: Date.now(),
  });
}

function resolveActivityType(body: WebhookBody) {
  const explicit = text(
    body.activity_type ?? body.notification_type ?? body.event_type,
    ""
  ).toLowerCase();
  if (explicit) return explicit;

  const table = text(body.table, "").toLowerCase();
  const type = text(body.type, "").toLowerCase();

  if (type === "insert" && table === "submissions") return "submission_created";
  if (type === "insert" && table === "user_supports") return "user_support_created";
  if (type === "insert" && table === "submission_comments") {
    return body.record?.parent_comment_id
      ? "submission_comment_reply_created"
      : "submission_comment_created";
  }
  if (type === "insert" && table === "user_votes") return "submission_vote_created";
  if (type === "insert" && table === "jobs") return "job_created";
  if (type === "insert" && table === "applications") return "job_application_created";
  if (type === "insert" && table === "users") return "city_creative_created";
  if (type === "insert" && table === "monthly_challenges") return "monthly_challenge_started";
  if (
    type === "update" &&
    table === "monthly_challenges" &&
    body.record?.winner_submission_id &&
    body.record?.winner_submission_id !== body.old_record?.winner_submission_id
  ) {
    return "monthly_challenge_result";
  }

  return type || "unknown";
}

async function fetchUserName(supabase: any, userId: string | null | undefined) {
  if (!userId) return "Someone";
  const { data } = await supabase
    .from("users")
    .select("full_name")
    .eq("id", userId)
    .maybeSingle();
  return text(data?.full_name, "Someone");
}

async function fetchSubmission(supabase: any, record: Record<string, any> | undefined) {
  const submissionId = record?.submission_id ?? record?.id;
  if (!submissionId) return record ?? null;

  const { data } = await supabase
    .from("submissions")
    .select("id, title, user_id")
    .eq("id", submissionId)
    .maybeSingle();

  return data ?? record ?? null;
}

async function fetchJob(supabase: any, record: Record<string, any> | undefined) {
  const jobId = record?.job_id ?? record?.id;
  if (!jobId) return record ?? null;

  const { data } = await supabase
    .from("jobs")
    .select("id, title, user_id, city_id, type")
    .eq("id", jobId)
    .maybeSingle();

  return data ?? record ?? null;
}

async function createInboxNotification(
  supabase: any,
  userId: string,
  title: string,
  body: string,
  notificationType: string,
  data: Record<string, unknown>
) {
  let notificationId: string | null = null;
  let badge: number | undefined;

  try {
    if (
      notificationType === "submission_votes" &&
      typeof data.submissionId === "string" &&
      typeof data.voterId === "string"
    ) {
      const { data: existing } = await supabase
        .from("app_notifications")
        .select("id")
        .eq("user_id", userId)
        .eq("notification_type", notificationType)
        .eq("data->>submissionId", data.submissionId)
        .eq("data->>voterId", data.voterId)
        .maybeSingle();

      if (existing?.id) {
        notificationId = existing.id;
      }
    }

    if (!notificationId) {
      const { data: inserted, error } = await supabase
        .from("app_notifications")
        .insert({
          user_id: userId,
          title,
          body,
          notification_type: notificationType,
          data,
        })
        .select("id")
        .single();

      if (error) throw error;
      notificationId = inserted?.id ?? null;
    }
  } catch (error) {
    console.log(
      "app_notifications insert skipped:",
      error instanceof Error ? error.message : error
    );
  }

  try {
    const { count, error } = await supabase
      .from("app_notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .is("read_at", null);

    if (error) throw error;
    if (typeof count === "number") badge = count;
  } catch {}

  return { notificationId, badge };
}

async function sendTargets(supabase: any, targets: ActivityTarget[]) {
  const filteredTargets = targets.filter((target) => !!target.userId);
  const recipientIds = unique(filteredTargets.map((target) => target.userId as string));

  if (!recipientIds.length) {
    return { sent: 0, skipped: "No recipients" };
  }

  const { data: users, error } = await supabase
    .from("users")
    .select("id, full_name, expo_push_token, notification_preferences")
    .in("id", recipientIds);

  if (error) throw error;

  const usersById = new Map<string, UserRow>(
    ((users ?? []) as UserRow[]).map((user) => [user.id, user])
  );

  const messages = (
    await Promise.all(
      filteredTargets.map(async (target) => {
      const user = usersById.get(target.userId as string);
      if (!user) return null;
      if (!allowsNotification(user, target.preferenceKey)) return null;

      const pushData = {
        ...target.data,
        preferenceKey: target.preferenceKey,
        notificationType: "activity",
      };
      const inbox = await createInboxNotification(
        supabase,
        user.id,
        target.title,
        target.body,
        target.preferenceKey,
        pushData
      );

      if (!isExpoPushToken(user.expo_push_token)) return null;

      return {
        to: user.expo_push_token,
        sound: "default",
        title: target.title,
        body: target.body,
        ...(typeof inbox.badge === "number" ? { badge: inbox.badge } : {}),
        data: {
          ...pushData,
          ...(inbox.notificationId ? { notificationId: inbox.notificationId } : {}),
        },
      };
    })
  ))
    .filter(Boolean);

  if (!messages.length) {
    return { sent: 0, skipped: "No valid push tokens or preferences disabled" };
  }

  const expoResponse = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      "Accept": "application/json",
      "Accept-Encoding": "gzip, deflate",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(messages),
  });

  const expoResult = await expoResponse.json();
  return { sent: messages.length, expoResult };
}

serve(async (req: Request): Promise<Response> => {
  try {
    const body = (await req.json()) as WebhookBody;
    const record = body.record ?? {};
    const activityType = resolveActivityType(body);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const targets: ActivityTarget[] = [];

    if (activityType === "user_support_created" || activityType === "new_supporter") {
      const supporterId = record.supporter_id;
      const supportedId = record.supported_id;
      const supporterName = await fetchUserName(supabase, supporterId);

      if (supportedId && supportedId !== supporterId) {
        targets.push({
          userId: supportedId,
          preferenceKey: "new_supporters",
          title: `${supporterName} supports you`,
          body: "Open their profile on Overlooked",
          data: screenData("Profile", { userId: supporterId }),
        });
      }
    }

    if (activityType === "submission_created" || activityType === "new_submission") {
      const submission = await fetchSubmission(supabase, record);
      const authorId = submission?.user_id ?? record.user_id;
      const authorName = await fetchUserName(supabase, authorId);

      const { data: supports } = await supabase
        .from("user_supports")
        .select("supporter_id")
        .eq("supported_id", authorId);

      for (const row of supports ?? []) {
        if (row.supporter_id === authorId) continue;
        targets.push({
          userId: row.supporter_id,
          preferenceKey: "followed_submissions",
          title: `${authorName} posted a new film`,
          body: text(submission?.title, "Watch it on Overlooked"),
          data: featuredFilmData(submission?.id ?? record.id),
        });
      }
    }

    if (
      activityType === "submission_comment_created" ||
      activityType === "submission_comment_reply_created" ||
      activityType === "comment_reply_created"
    ) {
      const submission = await fetchSubmission(supabase, record);
      const actorId = record.user_id;
      const actorName = await fetchUserName(supabase, actorId);
      const commentBody = text(record.comment, "New comment");

      if (submission?.user_id && submission.user_id !== actorId) {
        targets.push({
          userId: submission.user_id,
          preferenceKey: "submission_comments",
          title: `${actorName} commented on your film`,
          body: commentBody,
          data: featuredFilmData(submission.id, {
            commentId: record.id,
          }),
        });
      }

      if (record.parent_comment_id) {
        const { data: parentComment } = await supabase
          .from("submission_comments")
          .select("id, user_id")
          .eq("id", record.parent_comment_id)
          .maybeSingle();

        if (parentComment?.user_id && parentComment.user_id !== actorId) {
          targets.push({
            userId: parentComment.user_id,
            preferenceKey: "comment_replies",
            title: `${actorName} replied to your comment`,
            body: commentBody,
            data: featuredFilmData(submission?.id ?? record.submission_id, {
              commentId: record.id,
            }),
          });
        }
      }
    }

    if (activityType === "submission_vote_created" || activityType === "vote_created") {
      const submission = await fetchSubmission(supabase, record);
      const voterId = record.user_id;

      if (submission?.user_id && submission.user_id !== voterId) {
        targets.push({
          userId: submission.user_id,
          preferenceKey: "submission_votes",
          title: "Your film received a vote",
          body: text(submission.title, "Someone voted for your submission"),
          data: featuredFilmData(submission.id, {
            submissionId: submission.id,
            voterId,
          }),
        });
      }
    }

    if (activityType === "job_created" || activityType === "new_city_job") {
      const job = await fetchJob(supabase, record);
      if (job?.city_id) {
        const { data: cityUsers } = await supabase
          .from("users")
          .select("id")
          .eq("city_id", job.city_id);

        for (const user of cityUsers ?? []) {
          if (user.id === job.user_id) continue;
          targets.push({
            userId: user.id,
            preferenceKey: "city_jobs",
            title: "New creative job nearby",
            body: text(job.title, "A new job was posted in your city"),
            data: screenData("Jobs", { jobId: job.id }),
          });
        }
      }
    }

    if (activityType === "city_creative_created" || activityType === "new_city_creative") {
      if (record.city_id) {
        const newUserName = text(record.full_name, "A new creative");
        const { data: cityUsers } = await supabase
          .from("users")
          .select("id")
          .eq("city_id", record.city_id);

        for (const user of cityUsers ?? []) {
          if (user.id === record.id) continue;
          targets.push({
            userId: user.id,
            preferenceKey: "city_creatives",
            title: "New creative in your city",
            body: `${newUserName} joined Overlooked`,
            data: screenData("Location", { userId: record.id, cityId: record.city_id }),
          });
        }
      }
    }

    if (activityType === "job_application_created" || activityType === "application_created") {
      const job = await fetchJob(supabase, record);
      const applicantName = await fetchUserName(supabase, record.applicant_id);

      if (job?.user_id && job.user_id !== record.applicant_id) {
        targets.push({
          userId: job.user_id,
          preferenceKey: "job_applications",
          title: "New application received",
          body: `${applicantName} applied to ${text(job.title, "your job")}`,
          data: screenData("Jobs", { jobId: job.id, applicationId: record.id }),
        });
      }
    }

    if (
      activityType === "monthly_challenge_started" ||
      activityType === "monthly_challenge_ending"
    ) {
      const { data: users } = await supabase.from("users").select("id");
      const isEnding = activityType === "monthly_challenge_ending";
      for (const user of users ?? []) {
        targets.push({
          userId: user.id,
          preferenceKey: "challenge_reminders",
          title: isEnding ? "Monthly challenge is almost over" : "New monthly challenge",
          body: text(record.title, isEnding ? "Submit before the deadline" : "A new prompt is live"),
          data: screenData("Challenge", { challengeId: record.id }),
        });
      }
    }

    if (activityType === "monthly_challenge_result") {
      const winnerSubmission = record.winner_submission_id
        ? await fetchSubmission(supabase, { submission_id: record.winner_submission_id })
        : null;
      const winnerId = record.winner_user_id ?? winnerSubmission?.user_id ?? null;

      if (winnerId) {
        targets.push({
          userId: winnerId,
          preferenceKey: "challenge_results",
          title: "You placed in the monthly challenge",
          body: text(record.title, "Open Overlooked to see your result"),
          data: screenData("Challenge", {
            challengeId: record.id,
            submissionId: winnerSubmission?.id ?? record.winner_submission_id,
          }),
        });
      }
    }

    const result = await sendTargets(supabase, targets);

    return new Response(
      JSON.stringify({
        ok: true,
        activityType,
        targets: targets.length,
        ...result,
      }),
      { status: 200, headers: jsonHeaders }
    );
  } catch (error: unknown) {
    const message =
      error instanceof Error ? error.message : "Unknown send-activity-push error";

    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: jsonHeaders,
    });
  }
});
