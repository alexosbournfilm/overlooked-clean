// types.ts

// ==============================
// Navigation Types
// ==============================

export type RootStackParamList = {
  // Auth & Onboarding
  SignIn: undefined;
  SignUp: undefined;
  CheckEmail: undefined;
  CreateProfile: undefined;

  // Main App
  MainTabs: undefined;

  // Tab Screens
  Featured:
    | {
        challengeId?: string;
        challengeSearch?: string;
        challengeTitle?: string;
        challengeSearchNonce?: number;
        openShareSlug?: string;
        openSubmissionId?: string;
        openSearchNonce?: number;
      }
    | undefined;
  Jobs: undefined;
  Challenge: undefined;
  Location: undefined;
  Chats: undefined;
  WorkshopSubmit:
    | {
        mode?: 'monthly' | 'weekly' | 'workshop';
        pathKey?: string;
        step?: number;
        lessonTitle?: string;
        lessonDescription?: string;
        lessonPrompt?: string;
        lessonXp?: number;
        weeklyChallengeId?: string;
        weeklyChallengeTitle?: string;
        weeklyChallengeType?: 'acting' | 'short_film' | string;
        weeklyChallengeEndsAt?: string | null;
        creatorChallengeId?: string;
        challengeCode?: string;
        creatorId?: string;
        creatorChallengeTitle?: string;
        creatorChallengeRequiredPhrase?: string | null;
        creatorChallengeEndsAt?: string | null;
      }
    | undefined;
  Profile: { user?: { id: string; full_name: string } };

  // Relaxed params to match actual navigation usage from ChatsScreen
  ChatRoom: {
    conversation?: any;
    conversationId?: string;
    peerUser?: { id: string; full_name: string; avatar_url?: string | null };
    currentUserId?: string | null;
    userId?: string; // legacy compatibility
  };

  Settings: undefined;
};

// ==============================
// Supabase Data Types
// ==============================

export type WeeklyChallenge = {
  id: string;
  title: string;
  challenge_type: 'acting' | 'short_film';
  brief: string;
  instructions?: string | null;
  as_if?: string | null;
  monologue?: string | null;
  theme_word?: string | null;
  starts_at: string;
  ends_at: string;
  voting_ends_at?: string | null;
  submission_count?: number | null;
  vote_count?: number | null;
  winner_submission_id?: string | null;
  winner_user_id?: string | null;
  created_at?: string;
};

export type MonthlyChallenge = {
  id: string;
  title?: string;
  description?: string | null;
  theme_word?: string | null;
  month_start?: string; // ISO date
  month_end?: string;   // ISO date
  starts_at?: string;
  ends_at?: string;
  winner_submission_id?: string | null;
  created_at?: string;
};

export type Submission = {
  id: string;
  user_id: string;
  title: string;
  description?: string | null;
  youtube_url: string;
  word: string;
  votes: number;
  is_winner: boolean;
  hidden_on_profile?: boolean | null;
  submitted_at: string;
  weekly_challenge_id?: string | null;
  creator_challenge_id?: string | null;
  challenge_code?: string | null;
  submission_source?: string | null;
  creator_id?: string | null;
  creator_challenge_status?:
    | 'submitted'
    | 'viewed_by_creator'
    | 'shortlisted'
    | 'creator_pick'
    | 'top_10'
    | 'winner'
    | string
    | null;
  creator_challenges?: {
    id: string;
    title?: string | null;
    challenge_code?: string | null;
    creator_id?: string | null;
    users?: {
      id: string;
      full_name?: string | null;
      avatar_url?: string | null;
    } | null;
  } | null;

  // ✅ joined user data
  users?: {
    id: string;
    full_name: string;
    avatar_url?: string | null;
  };
};

export type UserVote = {
  id: string;
  user_id: string;
  submission_id: string;
  voted_at?: string;
};

export type CreativeRole = {
  id: number;
  name: string;
};

// DB uses "name" for the city field.
// Keep a legacy "city?" to avoid breaking old code that still references it.
export type City = {
  id: number;
  name: string;
  country_code: string;
  geoname_id?: number | null;
  ascii_name?: string | null;
  alternate_names?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  population?: number | null;
  timezone?: string | null;
  city?: string;
};
