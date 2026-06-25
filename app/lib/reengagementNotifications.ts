import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';

const DAY_SECONDS = 24 * 60 * 60;
const REENGAGEMENT_CHANNEL_ID = 'reengagement';

const REENGAGEMENT_NOTIFICATION_IDS = [
  'overlooked.reengagement.open',
  'overlooked.reengagement.submission',
  'overlooked.reengagement.workshop',
];

type UserProfileReminderData = {
  id: string;
  full_name?: string | null;
  main_role_id?: number | string | null;
  side_roles?: string[] | null;
  joining_reasons?: string[] | null;
  creative_goals?: string[] | null;
  notification_preferences?: Record<string, any> | null;
};

type RoleReminderCopy = {
  label: string;
  discipline: string;
  exercise: string;
  submission: string;
};

const GENERIC_COPY: RoleReminderCopy = {
  label: 'Filmmaker',
  discipline: 'craft',
  exercise: 'Open Workshop and do one focused exercise.',
  submission: 'A tiny scene, rough cut, or test still counts. Put one piece back into motion.',
};

const ROLE_COPY: Array<{ match: string[]; copy: RoleReminderCopy }> = [
  {
    match: ['actor', 'actress', 'performer'],
    copy: {
      label: 'Actor',
      discipline: 'performance',
      exercise: 'Run one monologue, self-tape, or behavior exercise today.',
      submission: 'A 30-second performance clip is enough. Post a take and keep the muscle warm.',
    },
  },
  {
    match: ['cinematographer', 'camera', 'director of photography', 'dop', 'dp'],
    copy: {
      label: 'Cinematographer',
      discipline: 'visual craft',
      exercise: 'Try one lighting, framing, or movement exercise today.',
      submission: 'A short camera test can become a real submission. Share the strongest frame.',
    },
  },
  {
    match: ['editor', 'editing'],
    copy: {
      label: 'Editor',
      discipline: 'edit rhythm',
      exercise: 'Cut one tiny sequence or rhythm exercise today.',
      submission: 'Post a short edit, trailer test, or before-and-after cut to keep momentum.',
    },
  },
  {
    match: ['writer', 'screenwriter', 'script'],
    copy: {
      label: 'Writer',
      discipline: 'story',
      exercise: 'Write one short scene or rewrite one page today.',
      submission: 'Turn a page into a filmed moment, even if it is rough.',
    },
  },
  {
    match: ['director', 'directing'],
    copy: {
      label: 'Director',
      discipline: 'direction',
      exercise: 'Block one beat, shot, or actor objective today.',
      submission: 'A small directed scene is enough. Put one choice on screen.',
    },
  },
  {
    match: ['sound', 'composer', 'music'],
    copy: {
      label: 'Sound Artist',
      discipline: 'sound world',
      exercise: 'Build one sound layer, transition, or room tone exercise today.',
      submission: 'A sound-led scene or tiny atmosphere test can still say a lot.',
    },
  },
  {
    match: ['producer', 'production'],
    copy: {
      label: 'Producer',
      discipline: 'production momentum',
      exercise: 'Move one creative task forward: schedule, cast, location, or plan.',
      submission: 'A produced micro-scene still counts. Keep the project moving.',
    },
  },
];

function cleanList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function firstName(value?: string | null) {
  const first = String(value || '').trim().split(/\s+/)[0];
  return first || 'You';
}

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function pickRoleCopy(roleName?: string | null, sideRoles: string[] = []) {
  const haystack = [roleName, ...sideRoles].filter(Boolean).map((value) => normalize(String(value)));

  for (const option of ROLE_COPY) {
    if (haystack.some((value) => option.match.some((keyword) => value.includes(keyword)))) {
      return option.copy;
    }
  }

  return {
    ...GENERIC_COPY,
    label: roleName?.trim() || GENERIC_COPY.label,
  };
}

function goalLine(goals: string[], reasons: string[]) {
  const combined = [...goals, ...reasons].map(normalize);

  if (combined.some((item) => item.includes('monologue') || item.includes('audition'))) {
    return 'You said you wanted to keep your performance practice alive.';
  }

  if (
    combined.some(
      (item) =>
        item.includes('per week') ||
        item.includes('weekly') ||
        item.includes('creative routine') ||
        item.includes('make short films')
    )
  ) {
    return 'You set a goal to create consistently.';
  }

  if (combined.some((item) => item.includes('portfolio') || item.includes('showreel'))) {
    return 'You wanted to build a body of work people can actually see.';
  }

  if (combined.some((item) => item.includes('collabor') || item.includes('network'))) {
    return 'You joined to stay close to other creatives and keep making.';
  }

  if (combined.some((item) => item.includes('confidence') || item.includes('disciplined'))) {
    return 'You wanted more creative discipline and confidence.';
  }

  return 'A small creative rep today is enough to keep the thread alive.';
}

function isOlderThan(value: string | null | undefined, days: number) {
  if (!value) return true;
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return true;
  return Date.now() - time > days * DAY_SECONDS * 1000;
}

async function hasNotificationPermission() {
  const permissions = await Notifications.getPermissionsAsync();

  return (
    permissions.granted ||
    permissions.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL
  );
}

async function ensureReengagementChannel() {
  if (Platform.OS !== 'android') return;

  await Notifications.setNotificationChannelAsync(REENGAGEMENT_CHANNEL_ID, {
    name: 'Creative reminders',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 180, 120, 180],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    sound: 'default',
  });
}

async function cancelScheduledReengagementNotifications() {
  if (Platform.OS === 'web') return;

  await Promise.all(
    REENGAGEMENT_NOTIFICATION_IDS.map((identifier) =>
      Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {})
    )
  );
}

async function latestSubmissionAt(userId: string) {
  const { data, error } = await supabase
    .from('submissions')
    .select('submitted_at')
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.log('Re-engagement submission lookup unavailable:', error.message);
    return null;
  }

  return (data as any)?.submitted_at ?? null;
}

async function latestWorkshopProgressAt(userId: string) {
  const withCreatedAt = await supabase
    .from('workshop_progress')
    .select('created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!withCreatedAt.error) return (withCreatedAt.data as any)?.created_at ?? null;

  const fallback = await supabase
    .from('workshop_progress')
    .select('step')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle();

  if (fallback.error) {
    console.log('Re-engagement workshop lookup unavailable:', fallback.error.message);
    return null;
  }

  return fallback.data ? new Date().toISOString() : null;
}

async function getRoleName(mainRoleId?: string | number | null) {
  if (!mainRoleId) return null;

  const { data, error } = await supabase
    .from('creative_roles')
    .select('name')
    .eq('id', mainRoleId)
    .maybeSingle();

  if (error) {
    console.log('Re-engagement role lookup unavailable:', error.message);
    return null;
  }

  return (data as any)?.name ?? null;
}

function triggerAfterDays(days: number) {
  return {
    type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
    seconds: Math.max(60, Math.round(days * DAY_SECONDS)),
    repeats: false,
    channelId: REENGAGEMENT_CHANNEL_ID,
  };
}

async function scheduleReminder(
  identifier: string,
  days: number,
  title: string,
  body: string,
  screen: string
) {
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: {
      title,
      body,
      sound: 'default',
      data: {
        notificationType: 'reengagement',
        screen,
      },
    },
    trigger: triggerAfterDays(days),
  });
}

export async function schedulePersonalizedReengagementNotifications(userId?: string | null) {
  if (Platform.OS === 'web' || !userId) return;

  await cancelScheduledReengagementNotifications();

  try {
    const allowed = await hasNotificationPermission();
    if (!allowed) return;

    await ensureReengagementChannel();

    const { data: profile, error } = await supabase
      .from('users')
      .select(
        'id, full_name, main_role_id, side_roles, joining_reasons, creative_goals, notification_preferences'
      )
      .eq('id', userId)
      .maybeSingle();

    if (error || !profile) {
      if (error) console.log('Re-engagement profile lookup unavailable:', error.message);
      return;
    }

    const profileData = profile as UserProfileReminderData;
    const prefs = profileData.notification_preferences ?? {};
    if (prefs.reengagement_reminders === false) return;

    const [roleName, lastSubmission, lastWorkshop] = await Promise.all([
      getRoleName(profileData.main_role_id),
      latestSubmissionAt(userId),
      latestWorkshopProgressAt(userId),
    ]);

    const sideRoles = cleanList(profileData.side_roles);
    const goals = cleanList(profileData.creative_goals);
    const reasons = cleanList(profileData.joining_reasons);
    const copy = pickRoleCopy(roleName, sideRoles);
    const name = firstName(profileData.full_name);
    const personalGoalLine = goalLine(goals, reasons);

    await scheduleReminder(
      'overlooked.reengagement.open',
      3,
      `${name}, keep your ${copy.discipline} moving`,
      `${personalGoalLine} Open Overlooked for one focused creative rep.`,
      'Featured'
    );

    if (isOlderThan(lastWorkshop, 4)) {
      await scheduleReminder(
        'overlooked.reengagement.workshop',
        4.5,
        'One exercise is enough today',
        copy.exercise,
        'Workshop'
      );
    }

    if (isOlderThan(lastSubmission, 6)) {
      await scheduleReminder(
        'overlooked.reengagement.submission',
        6.5,
        `Your next ${copy.label.toLowerCase()} piece can be small`,
        copy.submission,
        'Workshop'
      );
    }
  } catch (e: any) {
    console.log('Re-engagement notifications unavailable:', e?.message || e);
  }
}
