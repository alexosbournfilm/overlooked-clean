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
  Featured: undefined;
  Jobs: undefined;
  Challenge: undefined;
  Location: undefined;
  Chats: undefined;
  Profile: { user?: { id: string; full_name: string } };

  // Relaxed params to match actual navigation usage from ChatsScreen
  ChatRoom: {
    conversation?: any;
    conversationId?: string;
    peerUser?: { id: string; full_name: string; avatar_url?: string | null };
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
  submitted_at: string;

  // ✅ joined user data
  users?: {
    id: string;
    full_name: string;
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
  city?: string;
};
