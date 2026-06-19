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
        mode?: 'monthly' | 'workshop';
        pathKey?: string;
        step?: number;
        lessonTitle?: string;
        lessonDescription?: string;
        lessonPrompt?: string;
        lessonXp?: number;
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

export type MonthlyChallenge = {
  id: string;
  title: string;
  description: string | null;
  theme_word: string;
  month_start: string; // ISO date
  month_end: string;   // ISO date
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
  creator_challenge_id?: string | null;
  challenge_code?: string | null;
  submission_source?: string | null;
  creator_id?: string | null;
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
