import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  ActivityIndicator,
  Alert,
} from 'react-native';
import YoutubePlayer from 'react-native-youtube-iframe';
import { useNavigation } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import COLORS from '../theme/colors';
import { Submission } from '../types';

type SortKey = 'newest' | 'oldest' | 'mostvoted' | 'leastvoted';

// Supabase can return users as an object, array, or null.
type RawSubmission = Omit<Submission, 'users'> & {
  users?: { id: string; full_name: string } | { id: string; full_name: string }[] | null;
};

const normalizeRow = (row: RawSubmission): Submission => {
  const maybe = row?.users as any;
  const user =
    maybe == null ? undefined : Array.isArray(maybe) ? (maybe[0] as any) : (maybe as any);
  return { ...row, users: user ? { id: user.id, full_name: user.full_name } : undefined };
};

// Ensures the current month's challenge exists, then returns the latest challenge
async function fetchCurrentChallenge() {
  // Make sure DB has the current month challenge created (and last month's winner finalized)
  await supabase.rpc('insert_monthly_challenge_if_not_exists');

  // Always read the latest row so both screens stay in sync
  const { data, error } = await supabase
    .from('monthly_challenges')
    .select('theme_word, winner_submission_id, month_start, month_end')
    .order('month_start', { ascending: false })
    .limit(1)
    .single();

  if (error) {
    console.warn('Failed to fetch current challenge:', error.message);
  }

  return data as
    | {
        theme_word: string | null;
        winner_submission_id: string | null;
        month_start: string;
        month_end: string;
      }
    | null;
}

const FeaturedScreen = () => {
  const navigation = useNavigation<any>();
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const [loading, setLoading] = useState(true);
  const [winner, setWinner] = useState<Submission | null>(null);
  const [theme, setTheme] = useState('');
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');

  // auth + voting state
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [votedIds, setVotedIds] = useState<Set<string>>(new Set());
  const [voteBusy, setVoteBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      const { data: auth } = await supabase.auth.getUser();
      setCurrentUserId(auth?.user?.id ?? null);
      await fetchContent(auth?.user?.id ?? null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sort, search]);

  const fetchContent = async (uid: string | null) => {
    setLoading(true);

    // --- Keep Featured in lockstep with Challenge ---
    const challenge = await fetchCurrentChallenge();

    setTheme(challenge?.theme_word || '');
    let winnerData: Submission | null = null;

    // Winner (include joined user)
    if (challenge?.winner_submission_id) {
      const { data: w } = await supabase
        .from('submissions')
        .select(
          'id, user_id, title, word, youtube_url, votes, submitted_at, is_winner, users ( id, full_name )'
        )
        .eq('id', challenge.winner_submission_id)
        .single();

      winnerData = w ? normalizeRow(w as RawSubmission) : null;
    }

    // Base query for submissions with joined user
    let query = supabase
      .from('submissions')
      .select(
        'id, user_id, title, word, youtube_url, votes, submitted_at, is_winner, users ( id, full_name )'
      );

    // Sorting
    if (sort === 'newest') query = query.order('submitted_at', { ascending: false });
    if (sort === 'oldest') query = query.order('submitted_at', { ascending: true });
    if (sort === 'mostvoted') query = query.order('votes', { ascending: false });
    if (sort === 'leastvoted') query = query.order('votes', { ascending: true });

    // Search
    if (search.trim()) query = query.ilike('title', `%${search.trim()}%`);

    const { data: subs } = await query;
    const normalized = ((subs || []) as RawSubmission[]).map(normalizeRow);

    // Fetch which of these the current user has voted for (once, in bulk)
    if (uid && normalized.length) {
      const ids = normalized.map((s) => s.id);
      const { data: myVotes } = await supabase
        .from('user_votes')
        .select('submission_id')
        .eq('user_id', uid)
        .in('submission_id', ids);

      const votedSet = new Set<string>((myVotes || []).map((r) => r.submission_id as string));
      setVotedIds(votedSet);
    } else {
      setVotedIds(new Set());
    }

    setWinner(winnerData);
    setSubmissions(normalized);
    setLoading(false);
  };

  const goToProfile = (user?: { id: string; full_name: string }) => {
    if (!user) return;
    navigation.navigate('Profile', {
      user: { id: user.id, full_name: user.full_name },
    });
  };

  const extractYouTubeId = (urlStr: string): string | undefined => {
    try {
      const url = new URL(urlStr);
      if (url.hostname.includes('youtu.be')) return url.pathname.slice(1);
      return url.searchParams.get('v') ?? undefined;
    } catch {
      return urlStr.split('v=')[1]?.split('&')[0];
    }
  };

  const toggleVote = async (s: Submission) => {
    if (!currentUserId) {
      Alert.alert('Please sign in', 'You need to be signed in to vote.');
      return;
    }
    if (s.user_id === currentUserId) {
      // Cannot vote on own film
      return;
    }
    if (voteBusy[s.id]) return;

    setVoteBusy((prev) => ({ ...prev, [s.id]: true }));
    const alreadyVoted = votedIds.has(s.id);

    try {
      if (alreadyVoted) {
        // Unvote
        const { error } = await supabase
          .from('user_votes')
          .delete()
          .eq('user_id', currentUserId)
          .eq('submission_id', s.id);
        if (error) throw error;

        // Optimistic local update
        setVotedIds((prev) => {
          const next = new Set(prev);
          next.delete(s.id);
          return next;
        });
        setSubmissions((prev) =>
          prev.map((row) => (row.id === s.id ? { ...row, votes: Math.max(0, (row.votes || 0) - 1) } : row))
        );
      } else {
        // Vote
        const { error } = await supabase
          .from('user_votes')
          .insert([{ submission_id: s.id, user_id: currentUserId }]);
        if (error) throw error;

        setVotedIds((prev) => new Set(prev).add(s.id));
        setSubmissions((prev) =>
          prev.map((row) => (row.id === s.id ? { ...row, votes: (row.votes || 0) + 1 } : row))
        );
      }
    } catch (e: any) {
      console.warn('Vote error:', e?.message || e);
      Alert.alert('Vote failed', 'Please try again.');
      // optional: hard refresh to re-sync counts
      // await fetchContent(currentUserId);
    } finally {
      setVoteBusy((prev) => ({ ...prev, [s.id]: false }));
    }
  };

  const renderVoteButton = (s: Submission) => {
    const mine = currentUserId && s.user_id === currentUserId;
    const voted = votedIds.has(s.id);
    const count = s.votes || 0;

    let label = voted ? `Voted (${count})` : `Vote (${count})`;
    if (mine) label = `Your film (${count})`;

    return (
      <TouchableOpacity
        style={[
          styles.voteButton,
          voted && !mine ? styles.voteButtonActive : null,
          mine ? styles.voteButtonDisabled : null,
        ]}
        disabled={!!mine || voteBusy[s.id]}
        onPress={() => toggleVote(s)}
      >
        <Text style={mine ? styles.voteDisabledText : styles.voteText}>
          {voteBusy[s.id] ? '...' : label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderCard = (s: Submission) => {
    const videoId = extractYouTubeId(s.youtube_url);
    const voteLabel = s.votes === 1 ? '1 vote' : `${s.votes} votes`;

    return (
      <View key={s.id} style={styles.cardWrapper}>
        <View style={styles.card}>
          <View style={styles.videoWrapper}>
            <YoutubePlayer
              height={isMobile ? 180 : 360}
              width={isMobile ? 320 : 640}
              videoId={videoId}
              webViewStyle={{ borderRadius: 12 }}
              webViewProps={{
                allowsInlineMediaPlayback: true,
                mediaPlaybackRequiresUserAction: false,
              }}
            />
          </View>

          <View style={[styles.content, { width: isMobile ? 320 : 640 }]}>
            <Text style={styles.title}>{s.title}</Text>

            {s.users?.full_name ? (
              <TouchableOpacity onPress={() => goToProfile(s.users)}>
                <Text style={styles.byline}>by {s.users.full_name}</Text>
              </TouchableOpacity>
            ) : null}

            <Text style={styles.word}>{s.word}</Text>
            <Text style={styles.meta}>{voteLabel}</Text>

            {renderVoteButton(s)}
          </View>
        </View>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container}>
      <Text style={styles.sectionTitle}>Last Month’s Winner</Text>
      {winner ? (
        renderCard(winner)
      ) : (
        <Text style={styles.noWinner}>No winner selected yet.</Text>
      )}

      <Text style={styles.sectionTitle}>This Month’s Submissions</Text>
      <Text style={styles.theme}>Theme: {theme}</Text>

      <TextInput
        placeholder="Search films..."
        style={styles.searchInput}
        value={search}
        onChangeText={setSearch}
      />

      <View style={styles.sortContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.sortRow}>
            {[
              { label: 'Newest', value: 'newest' },
              { label: 'Oldest', value: 'oldest' },
              { label: 'Most Voted', value: 'mostvoted' },
              { label: 'Least Voted', value: 'leastvoted' },
            ].map(({ label, value }) => (
              <TouchableOpacity
                key={value}
                style={[styles.sortButton, sort === (value as SortKey) && styles.activeSort]}
                onPress={() => setSort(value as SortKey)}
              >
                <Text style={sort === (value as SortKey) ? styles.activeSortText : styles.sortText}>
                  {label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 20 }} color={COLORS.primary} />
      ) : (
        <View style={styles.submissionList}>{submissions.map(renderCard)}</View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.background,
    padding: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: COLORS.textPrimary,
    marginTop: 20,
    marginBottom: 6,
    textAlign: 'center',
  },
  theme: {
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.primary,
    textAlign: 'center',
    marginBottom: 12,
  },
  noWinner: {
    textAlign: 'center',
    color: COLORS.textSecondary,
    marginBottom: 20,
  },
  searchInput: {
    backgroundColor: COLORS.card,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: COLORS.outline,
    marginBottom: 14,
    fontSize: 14,
  },
  sortContainer: {
    alignItems: 'center',
    marginBottom: 16,
  },
  sortRow: {
    flexDirection: 'row',
    gap: 8,
  },
  sortButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: COLORS.outline,
    marginRight: 6,
  },
  sortText: {
    fontSize: 12,
    color: COLORS.textSecondary,
  },
  activeSort: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  activeSortText: {
    fontSize: 12,
    color: COLORS.textOnPrimary,
  },
  submissionList: {
    gap: 20,
  },
  cardWrapper: {
    maxWidth: 720,
    width: '100%',
    alignSelf: 'center',
  },
  card: {
    backgroundColor: COLORS.card,
    borderRadius: 12,
    padding: 12,
    marginBottom: 20,
    shadowColor: COLORS.shadow,
    shadowOpacity: 0.1,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
    alignItems: 'center',
  },
  videoWrapper: {
    marginBottom: 10,
  },
  content: {
    alignItems: 'flex-start',
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  byline: {
    fontSize: 13,
    color: COLORS.primary,
    marginBottom: 4,
  },
  word: {
    fontSize: 14,
    fontWeight: '500',
    color: COLORS.primary,
    marginBottom: 2,
  },
  meta: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  voteButton: {
    marginTop: 10,
    backgroundColor: COLORS.primary,
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    width: '100%',
  },
  voteButtonActive: {
    // subtle cue it’s active; keep palette
    opacity: 0.95,
  },
  voteButtonDisabled: {
    backgroundColor: COLORS.outline,
  },
  voteText: {
    color: COLORS.textOnPrimary,
    fontWeight: '600',
    fontSize: 14,
  },
  voteDisabledText: {
    color: COLORS.textSecondary,
    fontWeight: '600',
    fontSize: 14,
  },
});

export default FeaturedScreen;
