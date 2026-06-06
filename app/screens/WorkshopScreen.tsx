import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Easing,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useIsFocused, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { giveXp, supabase, type UserTier } from '../lib/supabase';
import { useGamification } from '../context/GamificationContext';
import { useMonthlyStreak } from '../lib/useMonthlyStreak';
import { UpgradeModal } from '../../components/UpgradeModal';
import { useAppRefresh } from '../context/AppRefreshContext';
import { getCurrentUserTierOrFree } from '../lib/membership';
import { useAppTheme } from '../context/ThemeContext';
import { useAppLanguage } from '../context/LanguageContext';
import { translateTrustedText } from '../i18n/translations';

/* -------------------------------- palette -------------------------------- */
const BG = '#050505';
const PANEL = '#0D0D0F';
const PANEL_2 = '#111114';
const PANEL_3 = '#16161A';
const BORDER = '#202126';
const BORDER_SOFT = '#18191D';
const GOLD = '#C6A664';
const GOLD_SOFT = 'rgba(198,166,100,0.10)';
const GOLD_SOFT_2 = 'rgba(198,166,100,0.16)';
const GOLD_BORDER = 'rgba(198,166,100,0.30)';
const IVORY = '#F4EFE6';
const MUTED = '#A59D90';
const MUTED_2 = '#726C61';
const GREEN = '#47D66F';
const BLUE = '#6BA7FF';
const BLUE_SOFT = 'rgba(107,167,255,0.12)';
const PURPLE = '#B48CFF';
const PURPLE_SOFT = 'rgba(180,140,255,0.12)';
const RED = '#FF7E7E';
const RED_SOFT = 'rgba(255,126,126,0.12)';
const LINE = '#2A2B31';
const LOCKED = '#30323A';

const SYSTEM_SANS = Platform.select({
  ios: 'System',
  android: 'Roboto',
  web: undefined,
  default: undefined,
});

const WORKSHOP_LAST_PATH_KEY = 'overlooked.workshop.lastPath';

/* -------------------------------- types -------------------------------- */
type WorkshopPathKey =
  | 'acting'
  | 'selftape'
  | 'editing'
  | 'cinematography'
  | 'directing'
  | 'sound'
  | 'filmmaker';

type LessonKind =
  | 'drill'
  | 'scene'
  | 'constraint'
  | 'technical'
  | 'boss'
  | 'surgery'
  | 'collab'
  | 'improv';

type MissionType = 'city' | 'remote' | 'crew-up';

type LessonSeed = {
  title: string;
  subtitle: string;
  description: string;
  challenge: string;
  objective: string;
  deliverable: string;
  bonusNote?: string;
  constraints: string[];
  kind: LessonKind;
  learning: string;
};

type Lesson = {
  id: number;
  step: number;
  title: string;
  subtitle: string;
  description: string;
  challenge: string;
  objective: string;
  deliverable: string;
  bonusNote?: string;
  kind: LessonKind;
  constraints: string[];
  xp: number;
  duration: string;
  isBoss?: boolean;
  requiresSurgery?: boolean;
  missionType?: MissionType | null;
  learning: string;
};

type NodeState = 'completed' | 'current' | 'unlocked' | 'locked';

type PathMeta = {
  key: WorkshopPathKey;
  label: string;
  shortLabel: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  description: string;
};

type SurgeryFilm = {
  id: number;
  title: string;
  creator: string;
  type: string;
  hook: string;
};

type Mission = {
  id: number;
  title: string;
  description: string;
  reward: string;
  type: MissionType;
  icon: keyof typeof Ionicons.glyphMap;
};

type UserProfile = {
  id: string;
  tier: UserTier;
  full_name?: string | null;
};

/* -------------------------------- paths -------------------------------- */
const PATHS: PathMeta[] = [
  {
    key: 'filmmaker',
    label: 'All In One Filmmaker',
    shortLabel: 'Filmmaker',
    subtitle: 'Separate elite mixed path',
    icon: 'sparkles-outline',
    description:
      'A separate mixed path combining acting, directing, cinematography, editing, sound, collaboration, and community feedback.',
  },
  {
    key: 'acting',
    label: 'Acting',
    shortLabel: 'Acting',
    subtitle: 'Presence • Emotion • Subtext',
    icon: 'person-outline',
    description:
      'Performance work built around truth, emotional control, camera presence, inner life, previous circumstances, and imagination.',
  },
  {
    key: 'editing',
    label: 'Editing',
    shortLabel: 'Editing',
    subtitle: 'Rhythm • Pacing • Meaning',
    icon: 'cut-outline',
    description:
      'Editing challenges that begin with basic assembly and clarity, then move into rhythm, reaction, tension, reinterpretation, and post authorship.',
  },
  {
    key: 'cinematography',
    label: 'Cinematography',
    shortLabel: 'Cine',
    subtitle: 'Light • Frame • Movement',
    icon: 'camera-outline',
    description:
      'Visual storytelling lessons using framing, lighting, perspective, movement, withholding, and reveal.',
  },
  {
    key: 'selftape',
    label: 'Self Tape',
    shortLabel: 'Self Tape',
    subtitle: 'Auditions • Frame • Delivery',
    icon: 'phone-portrait-outline',
    description:
      'A practical course for actors learning how to shoot, perform, frame, light, edit, and submit stronger self tapes.',
  },
  {
    key: 'directing',
    label: 'Directing',
    shortLabel: 'Direct',
    subtitle: 'Blocking • Story • Control',
    icon: 'videocam-outline',
    description:
      'Scene design, blocking, intention, actor notes, power dynamics, tension, and visual control for directors.',
  },
  {
    key: 'sound',
    label: 'Sound',
    shortLabel: 'Sound',
    subtitle: 'Texture • Silence • Atmosphere',
    icon: 'mic-outline',
    description:
      'Audio-first storytelling using sound design, off-screen presence, silence, pressure, and perspective.',
  },

];

/* ---------------------------- lesson banks ---------------------------- */
const makeSeed = (
  title: string,
  subtitle: string,
  description: string,
  challenge: string,
  objective: string,
  deliverable: string,
  constraints: string[],
  kind: LessonKind = 'drill',
  bonusNote?: string,
  learning: string = ''
): LessonSeed => ({
  title,
  subtitle,
  description,
  challenge,
  objective,
  deliverable,
  constraints,
  kind,
  bonusNote,
  learning,
});
/* -------------------------------- ACTING -------------------------------- */
/* 35 unique non-boss lessons */
const ACTING_BASE: LessonSeed[] = [
  makeSeed(
    'Object Exercise',
    'Foundation',
    'Give an ordinary object a private, urgent meaning.',
    'Choose one everyday object — a mug, ring, sweater, key, ticket, notebook, or phone — and behave as if it belonged to someone you miss, fear, betrayed, or need to forgive.',
    'Train imaginative specificity, private relationship, and truthful behavior without exposition.',
    'A filmed exercise where the object clearly matters before you ever explain why.',
    [
      'Use only one object.',
      'Do not explain its history out loud.',
      'Let touch, hesitation, attention, and breath reveal its meaning.',
    ],
    'drill',
    'The audience should feel the object has history, value, and emotional charge even if they never learn the full story.',
    'Learning: This sits close to Uta Hagen-style object work. The lesson is not “show emotion”; it is to endow the object with a real private life and let attention do the storytelling. Treat the object as if its meaning changes your behaviour before it changes your face.'
  ),
  makeSeed(
    'Reactivity Drill',
    'Foundation',
    'Let another person genuinely change you in real time.',
    'Play a short partner exchange where your job is not to be interesting, but to be affected.',
    'Train responsiveness, moment-to-moment truth, and behavioral adjustment.',
    'A two-person exercise with at least 3 visible changes in your behavior.',
    [
      'Do not pre-plan reactions.',
      'Stay with the other actor.',
      'If you have no partner, record a partner track first and respond to it truthfully in one take.',
    ],
    'drill',
    undefined,
    'Learning: This is pure Meisner territory. The point is to get your attention off yourself and onto your partner’s actual behaviour. A good rep is not “performed well”; it is changed by what is really happening moment to moment.'
  ),
  makeSeed(
    'Repetition for Camera',
    'Foundation',
    'Use simple repetition to free up live response.',
    'With a scene partner, repeat a simple factual phrase and let the exchange evolve through behavior, not clever wording.',
    'Train responsiveness, presence, and truthful listening.',
    'A filmed repetition exercise where the words stay simple but the exchange becomes alive.',
    [
      'Keep the phrase simple and factual.',
      'Do not invent witty lines.',
      'If you have no partner, use a fixed recorded phrase and let your responses shift truthfully.',
    ],
    'improv',
    undefined,
    'Learning: In Meisner repetition, the words are not the art — the changing behaviour is. The phrase should stay plain so the actor cannot hide in writing, invention, or “line performance.” Let the behaviour do the rewriting.'
  ),
  makeSeed(
    'Uninflected Line Learning',
    'Foundation',
    'Strip away preset line readings so action can shape the text.',
    'Learn 4 short lines as neutrally as possible, then play them once to comfort, once to accuse, and once to seduce.',
    'Train freedom from baked-in inflection and dependence on playable action.',
    'Three short takes of the same text with clearly different actions.',
    [
      'Keep the exact same text in every take.',
      'Do not decorate the line beforehand.',
      'Let the action change the sound naturally.',
    ],
    'technical',
    'This should feel alive because of what you are doing, not because you pre-performed the line.',
    'Learning: This connects strongly to Adler’s emphasis on action. Do not ask, “How should this line sound?” Ask, “What am I doing to the other person?” Once the action is clear, the line usually finds its own shape.'
  ),
  makeSeed(
    'Independent Activity',
    'Foundation',
    'Truth gets stronger when the body has a real job to do.',
    'Do a difficult private task with real urgency while another person interrupts, questions, distracts, or needs something from you.',
    'Train concentration, justification, urgency, and truthful doing under imaginary circumstances.',
    'A scene with a clear practical task and rising pressure.',
    [
      'Choose a task that is difficult to complete.',
      'The task must matter personally.',
      'If you have no partner, let an offscreen interruption force you to keep doing the task while responding.',
    ],
    'improv',
    undefined,
    'Learning: Independent activity is central in Meisner training because it stops actors from “indicating” life and forces them to actually do something. The task should be difficult, specific, and urgent enough that concentration becomes truthful behaviour.'
  ),
  makeSeed(
    'Previous Circumstances Entrance',
    'Foundation',
    'Enter the frame with a life already happening.',
    'Begin a scene as if the most important event started before the camera rolled and you are already inside it.',
    'Train entrances, residue, and lived-in circumstance.',
    'A scene where the opening moments imply unseen history.',
    [
      'Enter already in motion.',
      'No backstory speech.',
      'The body should arrive before the explanation does.',
    ],
    'scene',
    undefined,
    'Learning: One of the great acting habits is arriving with previous circumstances already active. Don’t start at zero. Let the audience feel that the camera has caught you in the middle of a living event, not at the beginning of one.'
  ),
  makeSeed(
    'Action, Not Emotion',
    'Foundation',
    'Play a clear action instead of a vague feeling.',
    'Perform a short scene where your action is to reassure someone while privately trying to hide frightening news.',
    'Train action-based acting and stop generalized emotional playing.',
    'A close scene where the action is clear and the feeling arrives through behavior.',
    [
      'Use the line: “I’m fine, honestly.”',
      'Do not cry.',
      'Play reassurance, not sadness.',
    ],
    'drill',
    undefined,
    'Learning: This is a core correction actors need early: emotion is the result, not the task. Adler training especially pushes actors toward playable verbs. “Reassure” gives you behaviour. “Be sad” usually gives you acting.'
  ),
  makeSeed(
    'As If: Unexpected Reunion',
    'Imagination',
    'Use a precise imaginative reality.',
    'Say “I didn’t expect to see you here” as if you have just met the teacher who changed your life.',
    'Train specificity in imaginative substitution.',
    'A single-take performance built around one exact circumstance.',
    [
      'Keep the line exact.',
      'No costume tricks.',
      'The shift must come from thought and behavior.',
    ],
    'technical',
    undefined,
    'Learning: This uses the “as if” to sharpen circumstance. The lesson is precision: not “someone important,” but one exact person, one exact history, one exact consequence. Specific imagination usually creates better behaviour than broad emotional forcing.'
  ),
  makeSeed(
    'As If: Quiet Enemy',
    'Imagination',
    'Same text, opposite inner world.',
    'Say “I didn’t expect to see you here” as if the person in front of you quietly destroyed your future.',
    'Train contrast without changing text.',
    'A second take of the same line under a radically different private reality.',
    [
      'Same framing as the previous take.',
      'No added lines.',
      'Only the circumstance changes.',
    ],
    'technical',
    undefined,
    'Learning: This teaches that text is not meaning by itself; circumstance creates meaning. The exercise is strongest when the words stay identical and only the internal event changes. That forces the actor to create life underneath the line.'
  ),
  makeSeed(
    'Silent Objective',
    'Behavior',
    'Let the want live in the body.',
    'Play a moment where you need forgiveness but cannot ask for it out loud.',
    'Train silent pursuit and readable need.',
    'A silent close-up or medium-shot performance.',
    [
      'No dialogue.',
      'No music.',
      'Only behavior, focus, and breath can tell the story.',
    ],
    'drill',
    undefined,
    'Learning: Film acting often rewards economy. This challenge trains the actor to pursue an objective without verbal explanation. Think in terms of silent action: invite, soften, wait, risk, retreat, try again.'
  ),
  makeSeed(
    'One-Sided Phone Call',
    'Solo Scene',
    'Make the unseen partner feel real.',
    'Perform a one-sided call where what you hear changes your action halfway through the scene.',
    'Train imagined stimuli, listening, and tactical change.',
    'A solo scene with a clear turning point.',
    [
      'No second voice track.',
      'The unheard person must feel specific.',
      'The turn must show in behavior, not just volume.',
    ],
    'scene',
    undefined,
    'Learning: Strasberg-based sensory work can help here: don’t mime a phone call generically. Build the actual sensory and emotional conditions of the call so the other person feels present in your concentration, not just in your line pauses.'
  ),
  makeSeed(
    'Text vs Subtext',
    'Subtext',
    'Say one thing while doing another.',
    'Play the line “You should go” while your real action is to make them stay.',
    'Train contradiction between text and intention.',
    'A scene where the hidden action is readable without explanation.',
    [
      'Keep the spoken text simple.',
      'The real want must be clear.',
      'Do not overplay the contradiction.',
    ],
    'scene',
    undefined,
    'Learning: Subtext is not secret emotion floating under words — it is active intention underneath the text. The audience should feel the action beneath the line, not because you “signal subtext,” but because your behaviour keeps pursuing the opposite need.'
  ),
  makeSeed(
    'Status Shift',
    'Status',
    'Change status without announcing it.',
    'Play a scene where you begin lower in status and gradually gain control through behavior and timing.',
    'Train status play, tactical adjustment, and power movement.',
    'A scene with a visible reversal in who holds control.',
    [
      'The shift must be gradual.',
      'Do not announce the change.',
      'Use timing, eye line, and physical behavior more than words.',
    ],
    'drill',
    undefined,
    'Learning: Status is often communicated through timing, stillness, interruption, eye line, and permission-taking. A strong actor does not “play power” in the abstract; they adjust behaviour beat by beat until the room’s balance changes.'
  ),
  makeSeed(
    'Emotional Leak',
    'Pressure',
    'Stay functional while emotion escapes in cracks.',
    'Improvise a scene where you are trapped in small talk immediately after life-changing news.',
    'Train contradiction, leakage, and internal pressure.',
    'An improvised scene with escalating internal strain.',
    [
      'No shouting.',
      'Start calm.',
      'End in a different emotional state than you began.',
    ],
    'improv',
    undefined,
    'Learning: Good screen acting often lives in leakage rather than display. The craft note here is to keep functioning. Don’t “show upset” too early. Let the pressure distort rhythm, listening, breath, and focus until the cracks start appearing on their own.'
  ),
  makeSeed(
    'Character Entrance',
    'Presence',
    'Tell us who the character is the moment they arrive.',
    'Enter the scene so we instantly read status, danger, insecurity, charm, or shame.',
    'Train first-impression storytelling.',
    'An entrance-based performance.',
    [
      'Entrance within the first 10 seconds.',
      'No voiceover.',
      'Use pace, posture, rhythm, and focus.',
    ],
    'drill',
    undefined,
    'Learning: Michael Chekhov’s work is useful here: physical life can generate inner life. A precise rhythm, weight, centre, and posture can announce a character before any text arrives. Do not decorate — choose a physical logic and let it lead.'
  ),
  makeSeed(
    'Scene Recreation: Famous Close-Up',
    'Scene Study',
    'Learn precision by remaking a great screen moment.',
    'Recreate a short close-up scene from a famous film or TV performance, focusing on behavior, timing, and thought rather than imitation.',
    'Train observation, film behavior, and on-camera economy.',
    'A recreation with your own truthful life inside the scene.',
    [
      'Choose a short scene.',
      'Do not do an impression.',
      'Study silence, thought, and behavior more than voice.',
    ],
    'scene',
    undefined,
    'Learning: Scene study is most useful when it teaches observation, not mimicry. Watch how little many great film actors do — and how specific that little is. Study thought changes, not just line readings.'
  ),
  makeSeed(
    'Dual Character Scene',
    'Solo Scene',
    'Play both sides of a serious scene truthfully.',
    'Perform a two-character scene alone by recording both roles separately, giving each character a real objective and full inner life.',
    'Train contrast, specificity, and serious dual-role scene work.',
    'A two-character scene that feels like two real people, not a skit.',
    [
      'Take both roles seriously.',
      'The two characters must want different things.',
      'If possible, try finding a partner through your city chat first.',
    ],
    'technical',
    'This is not a comedy sketch exercise. Both characters should feel specific, dignified, and fully lived.',
    'Learning: The acting test here is objective and distinction, not costume change. If both roles have specific wants, rhythms, and relationships to the event, they separate naturally. If not, they collapse into “versions of you.”'
  ),
  makeSeed(
    'Fight Interpretation I',
    'Scene Interpretation',
    'Interpret confrontation through playable stakes.',
    `Perform this scene as a relationship-breaking confrontation:

INT. APARTMENT – NIGHT

JACK
You lied to me.

EMMA
I didn’t lie. I protected you.

JACK
Protected me?

EMMA
If you knew the truth, you'd already be gone.`,
    'Train scene analysis, stakes, and playable conflict.',
    'A filmed two-person scene.',
    [
      'Play the stakes, not just anger.',
      'There must be a shift by the end.',
      'Avoid generic shouting.',
    ],
    'scene',
    undefined,
    'Learning: Conflict scenes often die when actors reduce them to volume. Analyse the scene through action and stake: accuse, defend, contain, punish, keep, survive. Let the verbs carry the fight.'
  ),
  makeSeed(
    'Fight Interpretation II',
    'Scene Interpretation',
    'Same subject, different danger.',
    `Perform this as a fight where one person is more dangerous because they stay calm:

INT. GARAGE – NIGHT

NINA
Say it again.

CALEB
You heard me.

NINA
No. I want to hear how brave you sound now.

CALEB
I’m not scared of you.`,
    'Train menace, restraint, and unequal power.',
    'A scene with visible imbalance and rising pressure.',
    [
      'Do not rush the pauses.',
      'Calm can be more threatening than volume.',
      'The final line must land.',
    ],
    'scene',
    undefined,
    'Learning: Restraint can increase danger. A still, calm actor with a clear objective can dominate a loud one. This challenge teaches pressure through control rather than explosion.'
  ),
  makeSeed(
    'Dual As-If',
    'Camera Exercise',
    'Keep the text, change the life underneath it.',
    'Film the same short speech twice: once as if you are trying to win them back, once as if you are hiding the truth.',
    'Train flexibility without changing text.',
    'Two takes of the same script with completely different inner action.',
    [
      'Same script both times.',
      'Same blocking.',
      'Only the inner circumstance changes.',
    ],
    'technical',
    undefined,
    'Learning: This is a clean acting laboratory: fixed text, fixed staging, different action. It trains the actor to discover that interpretation is not decoration; it comes from what the character is doing and protecting.'
  ),
  makeSeed(
    'Memory Trigger',
    'Inner Life',
    'A small trigger detonates the scene from inside.',
    'Play a scene where an object, smell, or phrase unexpectedly triggers a painful memory mid-conversation.',
    'Train internal shifts caused by private life.',
    'A scene with a visible internal interruption.',
    [
      'The trigger must be small.',
      'Do not explain the memory.',
      'Let the body register it first.',
    ],
    'drill',
    undefined,
    'Learning: Strasberg’s sensory principles are useful here. The trigger should land first as a private sensory interruption, not as an external “acting moment.” Let the body and concentration register the hit before the text catches up.'
  ),
  makeSeed(
    'Need Without Touch',
    'Constraint',
    'Keep them there without force.',
    'Play a scene where you must stop someone leaving, but you cannot touch them or stand in the doorway.',
    'Train tactical variety and inventive pursuit.',
    'A scene built around persuasion, distraction, seduction, or vulnerability.',
    [
      'No touching.',
      'No blocking the exit.',
      'You must keep pursuing the action.',
    ],
    'constraint',
    undefined,
    'Learning: Constraints are useful because they kill lazy choices. Once brute force is removed, you discover actual tactics. The lesson is that obstacles sharpen action.'
  ),
  makeSeed(
    'Suspicion Scene',
    'Scene Interpretation',
    'Quiet suspicion can be more dangerous than overt conflict.',
    `Interpret this scene as if one character clearly knows more than the other:

INT. TRAIN STATION – DAY

LENA
You’ve been watching me.

MARK
No.

LENA
You’re a terrible liar.`,
    'Train subtext, danger, and withheld information.',
    'A scene with a slow tightening of power.',
    [
      'Keep it grounded.',
      'Do not play general villainy.',
      'Let silence do part of the work.',
    ],
    'scene',
    undefined,
    'Learning: Withheld information creates pressure. The actor’s job is not to advertise the secret, but to let the knowledge affect listening, timing, and control of space. Silence should carry part of the accusation.'
  ),
  makeSeed(
    'Apology Rejected',
    'Conflict',
    'Want forgiveness and fail to get it.',
    'Perform a scene where you apologise sincerely but realise halfway through that they will never forgive you.',
    'Train collapsing action and tactical failure in real time.',
    'A scene with a visible collapse in hope.',
    [
      'Start with hope.',
      'Let defeat arrive gradually.',
      'No self-pity theatrics.',
    ],
    'scene',
    undefined,
    'Learning: Acting gets interesting when the tactic fails. Track the moment the original action stops working and your body begins to understand it before your speech fully does.'
  ),
  makeSeed(
    'Public Mask',
    'Constraint',
    'Hide a private emergency in public.',
    'Play a private emotional crisis while trapped in a public place where you must appear normal.',
    'Train split behavior and social masking.',
    'A performance with concealed panic, grief, or humiliation.',
    [
      'No big breakdown.',
      'Public behavior must stay believable.',
      'The internal struggle must still read.',
    ],
    'constraint',
    undefined,
    'Learning: This is about dual life: the social mask and the private event. Great film acting often lives in that split. Keep the public rules intact while the private damage presses against them.'
  ),
  makeSeed(
    'Romantic Edge Scene',
    'Scene Interpretation',
    'Play domestic conflict with history underneath it.',
    `Perform this as a relationship on the edge of collapse:

INT. KITCHEN – MORNING

MAYA
You always do this.

DAN
Do what?

MAYA
Pretend everything is fine when it’s clearly not.`,
    'Train emotional history and domestic subtext.',
    'A two-person scene with an unresolved wound beneath the words.',
    [
      'Do not play general irritation.',
      'Make shared history felt.',
      'The last line must cut.',
    ],
    'scene',
    undefined,
    'Learning: Domestic scenes are rarely about the surface line. Build the years underneath it. The argument should feel older than the conversation we are watching.'
  ),
  makeSeed(
    'Objective Through Courtesy',
    'Tactics',
    'Be polite while playing ruthlessly.',
    'Play a scene where your action is to dominate, manipulate, or expose someone while staying outwardly pleasant.',
    'Train contrast between social tone and private action.',
    'A scene where danger hides inside courtesy.',
    [
      'No overt aggression.',
      'Use charm as a weapon.',
      'The action must stay active throughout.',
    ],
    'drill',
    undefined,
    'Learning: Courtesy can be a tactic. This is a strong action exercise because politeness gives the actor a surface behaviour while the true objective works underneath it.'
  ),
  makeSeed(
    'Status Loss',
    'Status',
    'Arrive in control and leave exposed.',
    'Perform a scene where you begin with authority but lose it before the end.',
    'Train descending status and unraveling control.',
    'A scene with a clear collapse in power.',
    [
      'The fall must be visible.',
      'Do not rush the collapse.',
      'Avoid cliché humiliation acting.',
    ],
    'scene',
    undefined,
    'Learning: Status loss is not just “becoming upset.” Let the audience watch the mechanics of control disappear: shorter breath, weaker interruption, less certainty in space, more reactive listening.'
  ),
  makeSeed(
    'Monologue to Someone Present',
    'Monologue',
    'A monologue is still an action on another person.',
    'Deliver a monologue directly to a specific person in the room who keeps affecting how you say it.',
    'Train active monologue behavior.',
    'A monologue with at least two tactical shifts.',
    [
      'Do not perform into emptiness.',
      'The listener must affect you.',
      'There must be at least two turns.',
    ],
    'technical',
    undefined,
    'Learning: A monologue is not a speech recital. Treat it as live action on a listener. As Adler-based training stresses, action and circumstance keep language alive.'
  ),
  makeSeed(
    'Interrogation Without Questions',
    'Improvisation',
    'Get the truth without asking directly.',
    'Improvise a scene where you need a confession but are not allowed to ask a single direct question.',
    'Train indirect tactics and pressure-building.',
    'A two-person scene with increasing control or panic.',
    [
      'No direct questions.',
      'The scene must escalate.',
      'The action must stay sharp.',
    ],
    'improv',
    undefined,
    'Learning: Banning direct questions forces stronger tactics. You must corner, bait, soothe, expose, tempt, or trap. This is useful actor training because it pushes behaviour beyond obvious writing.'
  ),
  makeSeed(
    'Protect the Lie',
    'High Stakes',
    'The lie matters more than your dignity.',
    'Play a scene where you must keep a lie alive even when the other person is almost certainly right.',
    'Train survival behavior under exposure.',
    'A scene with mounting pressure and tactical adaptation.',
    [
      'Never simply give up.',
      'Switch tactics when needed.',
      'Fear of exposure must be visible.',
    ],
    'scene',
    undefined,
    'Learning: Lies create action. The lesson here is tactical adaptation under threat: deny, distract, attack, charm, minimise, reverse blame. Let the fear of exposure shape every adjustment.'
  ),
  makeSeed(
    'Scene From Stillness',
    'Camera',
    'Do less and let the camera catch more.',
    'Play an emotionally loaded close-up with almost no movement, letting the eyes and breath do the work.',
    'Train on-camera economy.',
    'A close-up performance.',
    [
      'Keep movement minimal.',
      'No theatrical gesturing.',
      'Let the camera come to you.',
    ],
    'technical',
    undefined,
    'Learning: Screen acting often gets stronger when the actor stops manufacturing emphasis. Keep the behaviour small, specific, and alive. Trust thought, breath, and focus.'
  ),
  makeSeed(
    'Reunion Scene',
    'Scene Interpretation',
    'Simple text, heavy history.',
    `Play this as a reunion where too much history sits under too few words:

EXT. BUS STOP – EVENING

ELI
Hi.

ROSE
That’s all you’ve got?

ELI
I didn’t know what would make you stay.`,
    'Train longing, regret, and restraint.',
    'A scene where simplicity carries emotional weight.',
    [
      'Do not over-romanticise it.',
      'Let history live in the pauses.',
      'Stay truthful, not poetic.',
    ],
    'scene',
    undefined,
    'Learning: Minimal dialogue demands rich circumstance. The task is not to “make it deep,” but to allow shared history to compress the language. Let the pauses carry memory.'
  ),
  makeSeed(
    'Pleading Without Weakness',
    'Advanced Tactics',
    'Need does not have to look collapsed.',
    'Play a scene where you beg for something life-changing without losing your dignity.',
    'Train strong pleading rather than generic desperation.',
    'A scene built around controlled need.',
    [
      'No melodrama.',
      'Your pride must stay present.',
      'The stakes must feel real.',
    ],
    'drill',
    undefined,
    'Learning: Vulnerability is stronger when self-respect is still alive. This challenge teaches contradiction: need and pride together are often more moving than simple collapse.'
  ),
  makeSeed(
    'Shame Scene',
    'Advanced Emotion',
    'Shame behaves differently from grief or anger.',
    'Perform a scene where the main engine is shame rather than sadness or rage.',
    'Train quieter, more exact emotional states.',
    'A scene where shame shapes eye line, posture, and speech.',
    [
      'No weeping shortcut.',
      'Keep it specific.',
      'Let shame affect the body first.',
    ],
    'scene',
    undefined,
    'Learning: Specific emotional states alter behaviour in distinct ways. Shame often collapses gaze, compresses posture, and distorts speech differently from grief or fury. Build the physical truth of the state.'
  ),
  makeSeed(
    'Mask to Threat',
    'Turn',
    'Charm turns dangerous.',
    'Start a scene warmly and let it slowly become threatening without raising your volume much.',
    'Train tonal transformation and behavioral control.',
    'A scene with a chilling pivot.',
    [
      'The shift must be gradual.',
      'Keep volume mostly controlled.',
      'The final beat must feel earned.',
    ],
    'constraint',
    undefined,
    'Learning: Tone shifts are strongest when they are behavioural, not mechanical. Let the temperature change through attention, pace, stillness, and what the character starts permitting themselves to reveal.'
  ),
  makeSeed(
    'Caregiver Exhaustion',
    'Character Study',
    'Love and burnout at the same time.',
    'Play someone caring for another person while privately nearing emotional collapse.',
    'Train contradiction between tenderness and depletion.',
    'A scene showing compassion and fatigue together.',
    [
      'Do not villainise the person being cared for.',
      'Fatigue must live in behavior.',
      'Let compassion and resentment coexist.',
    ],
    'scene',
    undefined,
    'Learning: Contradiction makes characters human. Avoid one-note goodness or one-note bitterness. Let care, duty, resentment, guilt, and love all exist in the same body.'
  ),
  makeSeed(
    'Victory That Costs You',
    'High Stakes',
    'You get what you want and lose something human.',
    'Perform a scene where you succeed in your action, but the cost lands immediately afterward.',
    'Train aftermath and moral consequence.',
    'A scene with a visible post-victory turn.',
    [
      'The win must happen.',
      'The cost must register.',
      'Do not explain the meaning.',
    ],
    'drill',
    undefined,
    'Learning: Don’t stop acting when the objective is achieved. Often the most interesting moment is the aftermath — when the body realises what the victory cost.'
  ),
  makeSeed(
    'Dual Reality Master Take',
    'Mastery',
    'Same text, opposite actions.',
    'Film the same short scene twice: once to win them back, once to destroy their image of you forever.',
    'Train full reinterpretation of the same text.',
    'Two contrasting takes with identical dialogue.',
    [
      'Same script.',
      'Same basic blocking.',
      'Only the action changes.',
    ],
    'technical',
    undefined,
    'Learning: This is advanced action work. If the action really changes, the scene changes. If the scene stays the same, the actor is probably still relying on line reading instead of objective.'
  ),
  makeSeed(
    'No Sympathy Allowed',
    'Mastery',
    'Need something badly without playing for pity.',
    'Perform a scene where you are desperate but cannot let the other person pity you.',
    'Train pride inside vulnerability.',
    'A scene built around need, self-protection, and contradiction.',
    [
      'No begging tone.',
      'Pride must stay alive.',
      'Let vulnerability leak, do not present it.',
    ],
    'drill',
    undefined,
    'Learning: This is a mature contradiction exercise. The actor must protect dignity while still pursuing the need. That tension creates far more life than “please feel sorry for me” acting.'
  ),
  makeSeed(
    'Cold Rage',
    'Mastery',
    'Anger without explosion.',
    'Play a confrontation where anger grows colder and more dangerous instead of louder.',
    'Train contained aggression and controlled danger.',
    'A confrontation where threat increases through restraint.',
    [
      'No shouting.',
      'Use stillness and focus.',
      'The final beat must feel dangerous.',
    ],
    'scene',
    undefined,
    'Learning: Controlled aggression can be more frightening than overt rage. Keep the anger active, not suppressed. Let the danger sharpen through precision, not volume.'
  ),
  makeSeed(
    'Actor Proof Scene',
    'Mastery',
    'Show total control of action, listening, and adjustment.',
    'Take a short scene and make every beat feel specific, responsive, and alive on camera.',
    'Prove you can carry layered acting truthfully.',
    'A polished short scene or self-tape that feels fully lived.',
    [
      'Nothing generic.',
      'Every beat must have a reason.',
      'The scene must feel specific from frame one.',
    ],
    'technical',
    undefined,
    'Learning: This is the integration rep. Bring together action, circumstance, listening, adjustment, previous circumstances, and economy. The scene should feel not “well performed,” but inevitable and lived.'
  ),
];
/* ------------------------------ SELF TAPE ------------------------------ */
/* 35 unique non-boss lessons — monologue-heavy, in-depth self tape course */
const SELFTAPE_BASE: LessonSeed[] = [
  makeSeed(
    'Semi-Supine Camera Reset',
    'Foundation',
    'Release tension before filming so the camera sees thought, not panic.',
    `Actor preparation before taping:
Lie on your back with knees bent, feet flat, and head supported lightly if needed. Let the floor hold your weight. Place your hands on the side ribs and notice the ribs widening as breath enters. Do not force a “deep actor breath.” Let the breath drop. Then gently hum on an easy sound. Move from hum into the first line.

Mindset option:
Listen to one quiet instrumental track before filming. Choose music that makes you feel exposed but brave. Turn it off before recording.

MONOLOGUE:
“I keep thinking there will be a moment where I suddenly feel ready.
Like the room will change, or my hands will stop shaking, or I will become the kind of person who knows exactly what to do.
But that moment is not coming.
So this is what I have instead.
My breath.
My voice.
This small amount of courage.
And the fact that I am still here.”

As if 1:
You are recording your first serious audition after years of secretly believing you are not a real actor.

As if 2:
You are making a final video message before leaving your old life behind forever.

As if 3:
You are a young royal about to address a nation after your family has collapsed.

As if 4:
You are a criminal calmly recording a confession, but only half of it is true.

As if 5:
You are speaking to the person who humiliated you, and this is the first time you refuse to shrink.`,
    'Train breath release, camera readiness, emotional availability, and calm presence before a self tape.',
    'A self tape monologue where the actor appears relaxed, available, and alive in close-up.',
    [
      'Do the semi-supine breath release before filming.',
      'Do not force emotion; let breath make the body available.',
      'Film at least 3 as-if versions and choose the one that changes the scene most.',
    ],
    'drill',
    'The tape should feel like a human being deciding to be seen.',
    'Learning: Many bad self tapes begin with tension. Semi-supine work helps release unnecessary muscular effort before camera work. The aim is not relaxation for its own sake; the aim is readiness. A ready actor can receive, think, breathe, and change.'
  ),

  makeSeed(
    'Featured Feedback Before You Tape',
    'Foundation',
    'Train your eye by watching other creatives before judging yourself.',
    `Before recording, go to the Featured page. Watch 2 creative submissions and leave specific, useful comments.

Good comments:
“Your eyes changed before the line, which made the moment believable.”
“The tape felt honest, but the sound was slightly too low.”
“The stillness worked because the stakes were clear.”
“I understood what you wanted from the other person.”
“The final pause was powerful — do not rush it.”

Then film this solo self tape:

MONOLOGUE:
“I watched it back.
That was the mistake.
In my head, it felt different.
Braver.
Cleaner.
Like I was finally showing people what I can do.
But on the screen, I saw every little thing I hate about myself.
The blinking.
The smiling when I am scared.
The way I apologize before anyone has even criticized me.
And still, somehow, there was one second where I believed myself.
One second.
Maybe that is enough to start with.”

As if 1:
You are an actor watching your first self tape and almost deleting it.

As if 2:
You are a filmmaker watching footage of someone you love who has died.

As if 3:
You are a spy reviewing surveillance footage and realizing you were caught emotionally, not physically.

As if 4:
You are a parent watching your child perform and seeing your own fear reflected back.

As if 5:
You are a famous performer after a public failure, deciding whether to continue.`,
    'Train artistic observation, generosity, self-review, and practical self-tape improvement.',
    'A monologue tape recorded after giving feedback to other creatives on Featured.',
    [
      'Comment on 2 Featured submissions first.',
      'Your feedback must be kind, specific, and useful.',
      'After filming, write one note about your own tape as if you were helping another actor.',
    ],
    'scene',
    undefined,
    'Learning: Actors grow faster when they stop only judging themselves and start observing craft. Watching other tapes teaches what reads on camera: eyes, breath, sound, framing, stillness, and truthful shifts.'
  ),

  makeSeed(
    'Clean Frame Monologue',
    'Foundation',
    'Set the frame so the acting becomes the main event.',
    `Set up:
Use landscape framing unless instructed otherwise. Frame from just above the head to mid-chest. Keep the background clean. Put the camera at eye level or slightly above. Avoid bright windows behind you.

MONOLOGUE:
“You are looking at the wrong things.
The wall, the light, the chair, the corner of the room.
I know because I do it too.
I look for anything that proves I do not belong here.
A shadow.
A bad angle.
A stupid mark on the wall.
Anything except the person standing in front of me.
So look at me.
Not the room.
Me.”

As if 1:
You are speaking to casting through the camera and demanding they actually see your potential.

As if 2:
You are confronting a lover who keeps avoiding emotional intimacy by criticizing small things.

As if 3:
You are a prisoner being filmed for evidence, trying to control what the world notices.

As if 4:
You are a ghost trying to make one living person finally see you.

As if 5:
You are a celebrity in a documentary, furious that people only see the image, not the human being.`,
    'Train framing, background control, camera confidence, and clean audition presentation.',
    'A visually clean self tape where the frame helps the actor instead of distracting from them.',
    [
      'Remove distracting objects behind you.',
      'Keep the camera still and at a flattering height.',
      'Check the frame before doing emotional work.',
    ],
    'technical',
    'Casting should notice your face and behavior before they notice your room.',
    'Learning: Self-tape setup is not about expensive production. It is about removing obstacles. A clean frame lets casting relax and watch the actor’s thoughts, not the background.'
  ),

  makeSeed(
    'Front Light Truth Test',
    'Foundation',
    'Use light that reveals your eyes without making the tape look fake.',
    `Set up:
Place a window, lamp, or soft light in front of you or slightly to the side. Avoid standing with a bright window behind you. Film one bad version with backlight, then one clean version with front light.

MONOLOGUE:
“I used to think darkness protected me.
If no one could see my face, no one could ask what happened.
No one could tell when I was lying.
No one could see the moment I changed my mind.
But now I am tired of hiding in bad light.
So here.
Look properly.
This is my face when I tell the truth.”

As if 1:
You are confessing something to the person you betrayed.

As if 2:
You are auditioning for a role that could change your life, and you refuse to hide.

As if 3:
You are a political prisoner giving forbidden testimony.

As if 4:
You are a vampire stepping into sunlight for the first time because love matters more than survival.

As if 5:
You are an older version of yourself speaking to your younger self through a recording.`,
    'Train lighting awareness, eye visibility, and truthful close-up presence.',
    'Two lighting tests plus a final properly lit monologue tape.',
    [
      'Make sure both eyes are visible.',
      'Do not use harsh light directly under the face.',
      'Watch the tape back with the sound off and check whether the eyes still tell the story.',
    ],
    'technical',
    undefined,
    'Learning: Lighting is access. If the eyes are hidden, much of the acting is hidden. For self tapes, clear soft light usually beats dramatic shadow.'
  ),

  makeSeed(
    'Sound and Intimate Speech',
    'Foundation',
    'Speak quietly without disappearing.',
    `Sound preparation:
Turn off fans, TVs, music, washing machines, loud air conditioning, and notifications. Record a test. Listen back with headphones.

Vocal preparation:
Start with an easy hum. Let the lips buzz. Move into “mmm,” then “vvv,” then speak the first line on the same easy breath. Keep the jaw free.

MONOLOGUE:
“I am not raising my voice.
That does not mean I am not serious.
People always think pain has to get louder before it becomes real.
But mine went the other way.
It got smaller.
Quieter.
Sharper.
So listen carefully.
Because I am only going to say this once.”

As if 1:
You are warning someone you love before they make a dangerous mistake.

As if 2:
You are a villain who never needs to shout because everyone already fears you.

As if 3:
You are in a hospital corridor and must not wake the person behind the door.

As if 4:
You are being recorded secretly and need one person to understand the hidden message.

As if 5:
You are a child finally speaking calmly to a parent who always screamed.`,
    'Train clean audio, vocal ease, quiet intensity, and self-tape clarity.',
    'A self tape where every word is audible even when the performance stays intimate.',
    [
      'Listen back before submitting.',
      'Do not mumble in the name of realism.',
      'Let quiet speech stay supported by breath.',
    ],
    'technical',
    undefined,
    'Learning: Good self-tape sound allows intimate acting. The actor should not need to shout to be heard. Supported quiet speech is often more powerful than volume.'
  ),

  makeSeed(
    'Professional Slate Into Character',
    'Foundation',
    'Move from simple introduction into private circumstance.',
    `Slate:
Look into the lens and say:
“Hi, my name is [your name]. I am reading for [role]. I am based in [city/country].”

Pause. Let the slate end. Shift eyeline just beside the lens. Begin the monologue.

MONOLOGUE:
“I know I smiled when I came in.
That is habit.
I smile when I am nervous.
I smile when I am angry.
I smile when someone has hurt me so badly that if I stop smiling, the whole room will know.
So please do not mistake it for comfort.
I am not comfortable.
I am just well trained.”

As if 1:
You are an actor slating for a casting director who once rejected you cruelly.

As if 2:
You are a spouse at a dinner party, quietly confronting your partner without anyone else hearing.

As if 3:
You are a royal bride giving a private interview after realizing the marriage is a prison.

As if 4:
You are a hostage forced to appear calm on camera while sending a hidden signal.

As if 5:
You are a teacher speaking to a student who has learned to hide pain the same way you did.`,
    'Train clean slating, transition, camera discipline, and immediate character life.',
    'A professional slate followed by a monologue with a clear emotional shift.',
    [
      'Keep the slate simple and human.',
      'Do not perform the slate as the character.',
      'Let there be a real breath between slate and scene.',
    ],
    'technical',
    undefined,
    'Learning: A slate is a professional hello. The scene is private life. The actor must be able to move from one to the other without carrying awkward slate energy into the performance.'
  ),

  makeSeed(
    'One Line, Ten Worlds',
    'Foundation',
    'Use one line to prove that circumstance changes everything.',
    `Film this single line ten times:

LINE:
“You came back.”

As if 1:
You are relieved because the person returned from war.

As if 2:
You are furious because they promised never to return.

As if 3:
You are terrified because you buried them yesterday.

As if 4:
You are a detective realizing the suspect has returned to the crime scene.

As if 5:
You are a child seeing a parent who abandoned you.

As if 6:
You are a ruler seeing the traitor you secretly loved.

As if 7:
You are pretending not to care, but this is the only person you wanted to see.

As if 8:
You are a ghost and they are the first person who can hear you.

As if 9:
You are a criminal whose alibi has just collapsed.

As if 10:
You are an actor seeing your dream return after you gave it up.

After filming, choose the 3 versions that feel most different from each other.`,
    'Train imagination, playable circumstance, and extreme variation inside minimal text.',
    'Ten short takes of one line, with at least three completely different interpretations.',
    [
      'Do not change the words.',
      'Do not rely on accents or gimmicks.',
      'Let each circumstance change your body, breath, timing, and need.',
    ],
    'drill',
    undefined,
    'Learning: The line is not the performance. Circumstance is the performance. When the imagined event changes radically, the same words can become romance, horror, grief, comedy, revenge, or hope.'
  ),

  makeSeed(
    'Audition Monologue: The Missed Call',
    'Performance',
    'Play a contemporary emotional monologue with relationship history.',
    `Before filming:
Go to Featured and leave one comment on a performance where you believed the actor’s listening or stillness.

MONOLOGUE:
“I called you six times.
I know that sounds dramatic when I say it out loud.
Six.
Like I was counting.
I was counting.
The first time, I thought you were busy.
The second time, I thought your phone was dead.
The third time, I thought something terrible had happened to you.
By the fourth, I understood.
By the fifth, I hated myself for still hoping.
And by the sixth, I was not calling because I needed you anymore.
I was calling so I would remember this moment.
The moment I finally stopped waiting.”

As if 1:
You are ending a romantic relationship after years of being ignored.

As if 2:
You are speaking to a parent who never arrived when you needed them.

As if 3:
You are a soldier leaving a final voicemail before a dangerous mission.

As if 4:
You are blackmailing someone, and the calls were proof of their guilt.

As if 5:
You are in a comedy-drama and trying not to admit how pathetic the six calls make you feel.`,
    'Train emotional history, personal stakes, and controlled vulnerability in a solo self tape.',
    'A complete contemporary monologue with a clear emotional journey.',
    [
      'Comment on Featured before filming.',
      'Decide who you are speaking to before the first line.',
      'Do not rush the number sequence; each call should cost something different.',
    ],
    'scene',
    undefined,
    'Learning: A strong audition monologue has turns. The actor should not play one emotion from start to finish. Track each call as a new realization.'
  ),

  makeSeed(
    'Comedy Monologue Without Begging for Laughs',
    'Performance',
    'Let comedy come from embarrassment, not performance tricks.',
    `MONOLOGUE:
“I brought flowers to a breakup.
Yes, I hear it now.
At the time, it felt thoughtful.
Soft.
Mature, even.
I thought, if someone is going to destroy me emotionally, the least I can do is provide a nice visual.
And then you opened the door and said, ‘Are those for me?’
And I said, ‘Technically.’
Which is not a sentence a confident person says.
So now I am standing here with twelve roses, no dignity, and the strange feeling that even the flowers are disappointed in me.”

As if 1:
You are still trying to save the relationship and using humor as a last tactic.

As if 2:
You are telling the story at your own wedding to someone else years later.

As if 3:
You are a villain explaining the one heartbreak that made you ridiculous before it made you cruel.

As if 4:
You are on a first date trying to make your emotional damage sound charming.

As if 5:
You are alone in your room after the breakup, practicing the funny version because the real version hurts too much.`,
    'Train comedy self-taping through truth, timing, embarrassment, and need.',
    'A comedic monologue that stays grounded and human.',
    [
      'Do not pull faces to make it funny.',
      'Play the pain underneath the joke.',
      'Let the rhythm be conversational, not stand-up comedy unless the as-if demands it.',
    ],
    'scene',
    undefined,
    'Learning: Comedy works when the actor takes the situation seriously. The character is not trying to entertain casting; they are trying to survive embarrassment.'
  ),

  makeSeed(
    'Thriller Monologue: The Calm Warning',
    'Performance',
    'Create danger through control rather than volume.',
    `MONOLOGUE:
“You should leave now.
Not because I am angry.
Anger would be safer.
Anger makes people sloppy.
They shout, they point, they break things, they say too much.
I am not angry anymore.
I passed angry about ten minutes ago.
Now I am clear.
And clarity is a much colder room to be trapped in.
So take your coat.
Take your keys.
Take whatever version of yourself you think can still walk out of here untouched.
And leave.”

As if 1:
You are warning someone you love before you lose control.

As if 2:
You are a crime boss giving a final chance to a traitor.

As if 3:
You are a victim who has secretly become more dangerous than the abuser.

As if 4:
You are an artificial intelligence calmly explaining why humans should be afraid.

As if 5:
You are a parent speaking to the person who hurt your child.`,
    'Train contained threat, stillness, and genre control in a self tape.',
    'A thriller-style monologue where danger increases without shouting.',
    [
      'Keep the voice controlled.',
      'Use stillness as pressure.',
      'Let the final “leave” feel like the last door before violence.',
    ],
    'scene',
    undefined,
    'Learning: Threat on camera is often stronger when it is contained. The actor must know exactly what they are capable of, even if they never show it.'
  ),

  makeSeed(
    'Period Drama Monologue',
    'Performance',
    'Use formal language with real human stakes.',
    `MONOLOGUE:
“You mistake my silence for agreement.
That has been your error from the beginning.
I was silent because I was taught that a quiet woman is easier to praise.
I was silent because every room I entered had already decided the shape of my life.
I was silent because speaking would have cost me everything.
But you have spent so long admiring my restraint that you forgot restraint is not the same as obedience.
And now, at last, you shall learn the difference.”

As if 1:
You are a noblewoman refusing an arranged marriage.

As if 2:
You are a servant speaking privately to the master who underestimated you.

As if 3:
You are a queen addressing the court after betrayal.

As if 4:
You are a modern politician using old-fashioned restraint as a weapon.

As if 5:
You are speaking to your younger self, wishing you had said this years ago.`,
    'Train heightened text, status, restraint, and period-style audition performance.',
    'A period-style monologue that feels truthful rather than stiff.',
    [
      'Do not use a fake posh voice.',
      'Let the language be formal but the need be raw.',
      'Find the exact moment silence becomes power.',
    ],
    'scene',
    undefined,
    'Learning: Period work is not about sounding fancy. It is about pressure under rules. The stronger the social restraint, the more powerful the private rebellion.'
  ),

  makeSeed(
    'Music Into Character Rhythm',
    'Performance',
    'Use music privately to find the character’s emotional weather.',
    `Preparation:
Choose one piece of music that gives you the character’s rhythm. Do not use it in the final tape. Listen once before filming, then turn it off.

Choose music for one of these:
- Grief that cannot move quickly.
- Confidence that is secretly fragile.
- Revenge that feels elegant.
- Hope that feels almost embarrassing.
- Panic hidden under politeness.

MONOLOGUE:
“I had a whole speech prepared.
It was better than this.
Sharper.
Cleaner.
There was a line in the middle that would have made you feel terrible, and I was looking forward to that.
But then I saw your face.
And suddenly the speech felt like a costume.
Something I put on because the truth was too plain.
So here is the truth.
I missed you.
I hated that I missed you.
And I came here to punish you for it.”

As if 1:
You are trying to win back an ex but cannot forgive them yet.

As if 2:
You are a spy confronting the handler who abandoned you.

As if 3:
You are a child speaking to an absent parent as an adult.

As if 4:
You are a ghost appearing to the person who forgot you.

As if 5:
You are a villain realizing love made you weak.`,
    'Train private preparation, emotional rhythm, and monologue transformation through music.',
    'A monologue tape shaped by a private music choice, with no music in the final submission.',
    [
      'Use music only before recording.',
      'Let the music affect rhythm and inner temperature, not create melodrama.',
      'Film two versions with two totally different tracks.',
    ],
    'scene',
    undefined,
    'Learning: Music can help actors find rhythm, temperature, and atmosphere. But the final tape must stand without it. The music is preparation, not decoration.'
  ),

  makeSeed(
    'Voice Resonance Into Text',
    'Technical',
    'Warm the voice so emotional text stays supported.',
    `Voice preparation:
Hum gently on “mmm.”
Move the vibration from lips to chest to head without pushing.
Speak “many moving memories” slowly.
Then speak the monologue with the same ease.

MONOLOGUE:
“My voice disappears when I need it most.
In ordinary rooms, I can speak.
I can order coffee.
I can say thank you.
I can answer the phone.
But when something matters, when the words could change my life, my throat becomes a locked door.
So I am opening it slowly.
Not beautifully.
Not bravely.
Just enough to let the truth through.”

As if 1:
You are an actor who has lost confidence after a humiliating audition.

As if 2:
You are giving testimony in court against someone powerful.

As if 3:
You are confessing love to a best friend and expecting rejection.

As if 4:
You are a leader addressing frightened people after disaster.

As if 5:
You are a child in an adult body finally saying what was forbidden at home.`,
    'Train vocal resonance, supported speech, and truthful clarity in emotional self tapes.',
    'A self tape where the voice remains open and clear under pressure.',
    [
      'Do not squeeze the throat for emotion.',
      'Keep breath moving through the line.',
      'If the voice tightens, pause and return to hum.',
    ],
    'technical',
    undefined,
    'Learning: Emotional acting often tightens the voice. Voice preparation helps the actor stay available without choking the text. Support allows vulnerability to be heard.'
  ),

  makeSeed(
    'Articulation Without Overdoing It',
    'Technical',
    'Speak clearly while still sounding like a real person.',
    `Articulation preparation:
Gently warm lips, tongue, and jaw.
Say:
“Tip of the tongue, teeth, and lips.”
“Red leather, yellow leather.”
“Unique New York.”
Then speak the monologue naturally, not like a school exercise.

MONOLOGUE:
“I know exactly what you heard.
You heard the sentence.
You heard the polite version.
You heard the words arranged neatly enough that nobody could accuse me of being cruel.
But you did not hear what I meant.
So let me help you.
When I said I was happy for you, I meant I hope it keeps you awake.
When I said I understood, I meant I will remember.
And when I said goodbye, I meant do not come back.”

As if 1:
You are being polite at a wedding where your ex is marrying someone else.

As if 2:
You are a diplomat threatening war without ever raising your voice.

As if 3:
You are a best friend pretending to forgive a betrayal.

As if 4:
You are a comedy character realizing your passive aggression is not as subtle as you thought.

As if 5:
You are a villain giving someone one final socially acceptable warning.`,
    'Train diction, clarity, subtext, and clean self-tape speech.',
    'A monologue tape where every word is clear without sounding over-pronounced.',
    [
      'Warm the mouth before recording.',
      'Do not over-articulate like a robot.',
      'Let clarity serve the thought, not replace it.',
    ],
    'technical',
    undefined,
    'Learning: Articulation is not about sounding posh or artificial. It is about letting the thought arrive cleanly. In self tapes, unclear words can hide good acting.'
  ),

  makeSeed(
    'One-Person Phone Scene',
    'Audition Craft',
    'Make the unseen person real without needing another actor.',
    `Film this as a one-sided phone call. Leave space for the unheard person, but do not exaggerate the pauses.

MONOLOGUE / PHONE SCENE:
“Hi.
No, please do not hang up.
I know I said I would not call.
I meant it when I said it.
I mean most things when I say them. That is the problem.
No, I am not drunk.
I am annoyingly sober.
I just found your note.
The one behind the picture frame.
I do not know why I moved it.
Maybe some part of me knew you were still hiding there.
No, I am not angry.
I am past angry.
I am standing in the part that comes after, and I do not know what it is called.”

As if 1:
You are calling an ex after discovering they still loved you.

As if 2:
You are calling a dead person’s voicemail because you found their final letter.

As if 3:
You are calling your criminal partner after finding proof they betrayed you.

As if 4:
You are leaving a message you know will be used as evidence.

As if 5:
You are in a romantic comedy and trying very hard not to sound insane.`,
    'Train solo listening, imagined response, and phone-call realism for self tapes.',
    'A one-sided phone scene where the other person feels present.',
    [
      'Do not add a second voice track.',
      'Hear the other person specifically in your imagination.',
      'Let what you “hear” change you.',
    ],
    'scene',
    undefined,
    'Learning: Solo phone scenes test listening. The audience must feel the invisible partner through your pauses, interruptions, reactions, and changes of tactic.'
  ),

  makeSeed(
    'Offscreen Reader Optional Scene',
    'Audition Craft',
    'Turn a two-person scene into a strong solo audition piece.',
    `This can be taped with or without a reader. If alone, imagine the other lines.

SCENE:
INT. EMPTY THEATRE – NIGHT

READER
You missed your entrance.

ACTOR
I know.

READER
Everyone saw.

ACTOR
Good.

READER
Good?

ACTOR
Yes. I am tired of arriving exactly when people expect me.

READER
This is not bravery.

ACTOR
No. It is worse.
It is honesty.

If filming solo, only say the ACTOR lines and let the READER lines live silently.

As if 1:
You are an actor refusing to obey a director who has been humiliating you.

As if 2:
You are a revolutionary choosing public disgrace over obedience.

As if 3:
You are a child performer grown up, finally rejecting control.

As if 4:
You are in a dark comedy and this is the first honest mistake you have ever enjoyed.

As if 5:
You are a ghost in an abandoned theatre speaking to the role you never got to play.`,
    'Train handling sides alone, silent listening, and offscreen partner imagination.',
    'A self tape that works either with a reader or as a solo response scene.',
    [
      'If alone, do not rush the silent reader lines.',
      'Let each unheard line affect you.',
      'Keep the eyeline consistent.',
    ],
    'scene',
    undefined,
    'Learning: Many actors do not always have a reader. You can still tape well if the imagined partner is specific and the silent beats are alive.'
  ),

  makeSeed(
    'Status Flip Monologue',
    'Audition Craft',
    'Use the same words to move from powerless to powerful.',
    `MONOLOGUE:
“You think because I waited, I was weak.
That is convenient for you.
Weak people are easier to forgive.
Weak people make better stories.
You can say I was confused, emotional, young, afraid.
You can say anything except the truth.
I waited because timing matters.
I waited because rooms reveal themselves.
I waited because people like you always speak too soon.
And now I know exactly where to place the knife.”

As if 1:
You are a betrayed lover revealing emotional power.

As if 2:
You are a political strategist destroying an opponent.

As if 3:
You are a servant in a period drama who has gathered secrets for years.

As if 4:
You are a bullied student years later, now interviewing the person who hurt you.

As if 5:
You are a supernatural creature who has been pretending to be human.`,
    'Train status shift, control, and power reversal in a self tape.',
    'A monologue where the actor begins contained and ends in command.',
    [
      'Do not start powerful too early.',
      'Let the status rise line by line.',
      'Make the final image dangerous without becoming cartoonish.',
    ],
    'scene',
    undefined,
    'Learning: Status is readable through breath, stillness, timing, and permission. A strong status flip lets the audience watch power arrive.'
  ),
    makeSeed(
    'Tears Not Required',
    'Audition Craft',
    'Play grief without chasing tears.',
    `Preparation:
Before filming, sit quietly and notice what your body does when it tries not to cry. Do not force tears. Let resistance be the action.

MONOLOGUE:
“Everyone keeps asking if I cried.
As if that is the receipt.
As if grief is only real when it leaves evidence on your face.
I did not cry.
I made tea.
I folded the blanket on the chair.
I answered three emails.
I cleaned a glass that was already clean.
And then I stood in the hallway for twenty minutes because I could not remember which room I was supposed to enter.
So no.
I did not cry.
But do not tell me I did not feel it.”

As if 1:
You are grieving a parent and angry at people judging your reaction.

As if 2:
You are a detective describing the moment you found the victim, but the victim was someone you loved.

As if 3:
You are in a dark comedy, furious that grief has made you boring and practical.

As if 4:
You are an alien trying to explain human grief after experiencing it for the first time.

As if 5:
You are speaking at a funeral and refusing to perform sadness for the crowd.`,
    'Train emotional truth, grief behavior, and avoiding forced tears in self tapes.',
    'A grief monologue that feels specific without melodrama.',
    [
      'Do not try to cry.',
      'Play the resistance to crying.',
      'Let ordinary actions reveal the loss.',
    ],
    'scene',
    undefined,
    'Learning: Tears are not proof of truth. Often the fight not to cry is more moving than crying. Casting wants believable behavior, not emotional tricks.'
  ),

  makeSeed(
    'Audition Adjustment: Three Notes',
    'Audition Craft',
    'Practice taking direction by changing the whole scene.',
    `Film the monologue three times, applying a different casting note each time.

MONOLOGUE:
“I said yes because everyone was watching.
That is the embarrassing truth.
Not because I wanted it.
Not because I believed in it.
Not because my heart opened and the world made sense.
I said yes because the room went quiet, and silence has always made decisions for me.
Then everyone clapped.
And once people clap, it becomes very difficult to say, actually, I have made a terrible mistake.”

Take 1 direction:
Make it romantic drama — you said yes to a marriage proposal you regret.

Take 2 direction:
Make it political thriller — you agreed publicly to support a dangerous leader.

Take 3 direction:
Make it comedy — you accidentally agreed to be in a community musical and now cannot escape.

Take 4 direction:
Make it tragedy — your yes caused someone else’s life to collapse.

Take 5 direction:
Make it coming-of-age — this is the first time you understand your people-pleasing has consequences.`,
    'Train direction-taking, flexibility, and major tonal reinterpretation.',
    'Multiple takes of the same monologue with radically different audition notes.',
    [
      'Keep the text exactly the same.',
      'Change genre, stakes, and relationship each time.',
      'Do not just change volume or facial expression.',
    ],
    'technical',
    undefined,
    'Learning: Casting may redirect you. Good actors do not defend their first choice; they transform. The test is whether you can rebuild the scene quickly under a new note.'
  ),

  makeSeed(
    'Self Tape Editing Discipline',
    'Technical',
    'Edit simply so the performance stays central.',
    `Film this monologue and export it cleanly. No music, no filters, no montage, no dramatic color effect.

MONOLOGUE:
“I wanted to fix it in the edit.
That is what I always do.
Cut before the awkward part.
Brighten the dark bit.
Hide the silence.
Choose the take where I look better instead of the one where I am more honest.
But this time, I am leaving the silence in.
This time, I am not cutting away from the moment I get uncomfortable.
Maybe that is where the truth is.
Maybe that is the part I keep deleting.”

As if 1:
You are an actor deciding not to over-edit your audition.

As if 2:
You are a documentary subject realizing the edited version of your life is a lie.

As if 3:
You are a criminal deleting evidence but unable to delete one emotional truth.

As if 4:
You are a filmmaker apologizing for manipulating someone’s story.

As if 5:
You are speaking to your future self, asking them not to erase who you were.`,
    'Train simple editing, take selection, and professional submission habits.',
    'A cleanly edited self tape with no distracting effects.',
    [
      'Trim only the start and end.',
      'Do not add music under the scene.',
      'Choose the most truthful take, not the prettiest take.',
    ],
    'technical',
    undefined,
    'Learning: Self-tape editing should be invisible. Casting is not looking for a music video. They want a clear, honest audition that opens quickly, plays cleanly, and ends without fuss.'
  ),

  makeSeed(
    'Full Body to Close-Up Awareness',
    'Technical',
    'Understand how framing changes performance size.',
    `Film the same monologue twice: once in a wider frame, once in a close self-tape frame.

MONOLOGUE:
“I can feel the difference when you stand far away.
I become bigger.
Louder.
I start arranging myself so you understand.
But when you come close, I cannot hide inside shape anymore.
You see the thought before I polish it.
You see the fear before I turn it into a joke.
So maybe distance was never about you.
Maybe I was the one who needed it.”

As if 1:
You are speaking to a lover who finally sees through you.

As if 2:
You are an actor realizing theatre habits are too large for camera.

As if 3:
You are a suspect under interrogation as the detective moves closer.

As if 4:
You are a performer on stage slowly becoming a real person.

As if 5:
You are a ghost who becomes visible only when someone comes close enough.`,
    'Train performance scale, framing awareness, and camera economy.',
    'Two versions of the same monologue showing clear adjustment for frame size.',
    [
      'Do not perform the close-up like a stage scene.',
      'Let the wider frame use more body without becoming theatrical.',
      'Compare which thoughts read better in close-up.',
    ],
    'technical',
    undefined,
    'Learning: Frame size changes acting size. In close-up, thought is action. In wider shots, the body carries more information. A skilled actor adjusts without becoming fake.'
  ),

  makeSeed(
    'Self Tape With Props',
    'Technical',
    'Use one object only if it deepens the scene.',
    `Choose one simple object: a ring, key, mug, photograph, letter, scarf, or phone. Do not let it become busy. Let it hold private meaning.

MONOLOGUE:
“I kept it.
I know I should not have.
That would be the mature thing, apparently.
Throw it away, delete the number, burn the letter, become new.
But people who say that have never loved something they were supposed to survive.
So yes, I kept it.
Not because I want you back.
Not because I forgive you.
Because some proof should remain.
Some version of me stood here before this happened.
And she deserves evidence.”

As if 1:
The object belonged to someone who died.

As if 2:
The object proves a betrayal you are not ready to reveal.

As if 3:
The object is ridiculous and sentimental, and you hate that it still works on you.

As if 4:
The object is evidence in a crime, but you are emotionally attached to it.

As if 5:
The object is the last thing connecting you to your old identity before fame changed everything.`,
    'Train prop discipline, object meaning, and private life on camera.',
    'A self tape where one object adds emotional history without distracting.',
    [
      'Use only one object.',
      'Do not stare at it constantly.',
      'Let touch and hesitation reveal meaning.',
    ],
    'technical',
    undefined,
    'Learning: Props in self tapes should be rare and purposeful. The object must support the acting, not become decoration. The audience should feel history through behavior.'
  ),

  makeSeed(
    'The Casting Note: Less',
    'Audition Craft',
    'Do less while keeping the stakes high.',
    `Film the monologue once fully, then again with the note: “Less. Let us come to you.”

MONOLOGUE:
“I know what you want from me.
You want the big version.
The broken glass version.
The version where I finally say everything I have swallowed and the room goes silent.
I imagined that version too.
It was satisfying.
But the truth is smaller.
More humiliating.
I do not want to destroy you.
I want you to understand what you did.
And I hate that I still care whether you understand.”

As if 1:
You are confronting an ex who will never apologize.

As if 2:
You are giving testimony but trying not to seem emotional.

As if 3:
You are a villain discovering revenge did not heal anything.

As if 4:
You are in a quiet indie film where the camera catches every avoided thought.

As if 5:
You are speaking to a parent who is too old to change.`,
    'Train subtlety, self-tape restraint, and playable inner pressure.',
    'Two takes: one fuller version and one reduced version that still carries stakes.',
    [
      'Do not make “less” mean empty.',
      'Keep the objective active.',
      'Let the second take live more in thought and breath.',
    ],
    'technical',
    undefined,
    'Learning: “Do less” does not mean “feel less.” It means stop presenting the feeling. Let the camera observe the life underneath.'
  ),

  makeSeed(
    'The Casting Note: More Urgent',
    'Audition Craft',
    'Increase stakes without becoming messy.',
    `Film the monologue once naturally, then again with the note: “Make it more urgent. You are running out of time.”

MONOLOGUE:
“There is something I need to say before you leave.
No, do not do that.
Do not smile like I am being dramatic.
I have wasted too much time trying to sound reasonable.
Reasonable people lose things quietly.
I am done losing quietly.
So stay there.
Listen.
For once in your life, do not make me chase you just to be heard.”

As if 1:
The person is walking out of the relationship forever.

As if 2:
The person is about to board a plane and disappear.

As if 3:
You have information that could save their life, but they do not trust you.

As if 4:
You are in a comedy and physically trying not to chase them down the street.

As if 5:
You are a ghost with only one minute of visibility before vanishing again.`,
    'Train urgency, stakes, and controlled escalation for auditions.',
    'Two takes of the monologue: natural and urgent.',
    [
      'Urgency is not just speed.',
      'Do not sacrifice clarity.',
      'Let time pressure change breath and tactics.',
    ],
    'scene',
    undefined,
    'Learning: Urgency means something is being lost right now. It may affect pace, breath, interruption, and risk, but the actor must remain specific and understandable.'
  ),

  makeSeed(
    'The Casting Note: Hide the Truth',
    'Audition Craft',
    'Play the lie underneath the text.',
    `Film the monologue with a secret. The words sound reasonable, but the character is hiding something major.

MONOLOGUE:
“I do not know why everyone keeps asking me.
I was there, yes.
I have said that.
I was in the room, I heard the argument, I saw him leave.
That is all.
People argue every day.
People slam doors.
People say things they do not mean.
If every ugly sentence became evidence, none of us would survive.
So no, I do not know what happened after.
And I think it is cruel that you keep making me repeat it.”

As if 1:
You witnessed a crime and are protecting someone you love.

As if 2:
You committed the crime but have almost convinced yourself you did not.

As if 3:
You are innocent but hiding a different scandal that would ruin you.

As if 4:
You are a child covering for a parent.

As if 5:
You are in a courtroom drama and know the jury is beginning to doubt you.`,
    'Train subtext, secrets, and controlled lying in self tapes.',
    'A monologue where the actor’s hidden truth affects every line.',
    [
      'Decide the exact secret before filming.',
      'Do not signal the lie too obviously.',
      'Let fear of exposure change your listening and breath.',
    ],
    'scene',
    undefined,
    'Learning: A lie gives the actor action. The character must manage information, not merely “act suspicious.” A good tape lets casting sense pressure without seeing a cartoon liar.'
  ),

  makeSeed(
    'Self Tape for Vulnerability',
    'Audition Craft',
    'Be open without asking the audience for pity.',
    `MONOLOGUE:
“I need help.
There.
I said it.
And I hate how small it makes me feel.
I know it should not.
I know people say asking for help is strong, but people say many things when they are not the one standing here with nothing left to trade.
So please do not make me perform dignity.
I have been dignified all week.
I wore clean clothes.
I answered messages.
I said I was fine in three different tones.
I am not fine.
I need help.”

As if 1:
You are asking a friend for money after hiding financial collapse.

As if 2:
You are a superhero asking an ordinary person to save you.

As if 3:
You are a parent asking your child for forgiveness.

As if 4:
You are in a dark comedy and disgusted by how sincere you sound.

As if 5:
You are a leader who has never admitted weakness before.`,
    'Train vulnerability, pride, and need without melodrama.',
    'A self tape where asking for help feels difficult, specific, and truthful.',
    [
      'Do not play for pity.',
      'Keep pride alive.',
      'Let the need break through resistance gradually.',
    ],
    'scene',
    undefined,
    'Learning: Vulnerability is strongest when the character does not want to be vulnerable. The obstacle is dignity, pride, shame, or fear. Let the request cost something.'
  ),

  makeSeed(
    'Public Mask Monologue',
    'Audition Craft',
    'Hide a private emergency behind social behavior.',
    `MONOLOGUE:
“Thank you all for coming.
Really.
It means more than I can say.
The flowers are beautiful, the food is lovely, and I am sure if I stand here long enough, someone will tell me where to put my hands.
That is the strange thing about days like this.
Everyone knows what to do.
Sign the card.
Hug the family.
Say the sentence.
‘They would have loved this.’
Maybe they would have.
Maybe they would have hated it.
Maybe they would have stood in the corner making jokes because grief made them uncomfortable too.
Sorry.
I said I would keep this brief.”

As if 1:
You are giving a funeral speech and trying not to break.

As if 2:
You are at an awards ceremony thanking someone who privately destroyed you.

As if 3:
You are a politician smiling through news that your career is over.

As if 4:
You are in a comedy and the event is a disastrous office leaving party.

As if 5:
You are a murderer giving a memorial speech for your victim and almost enjoying the performance.`,
    'Train social mask, private pressure, and split behavior in self tapes.',
    'A monologue where public politeness and private truth exist at the same time.',
    [
      'Keep the public mask believable.',
      'Let the private emergency leak through cracks.',
      'Do not reveal everything too early.',
    ],
    'scene',
    undefined,
    'Learning: Screen acting often lives in dual reality. The character behaves one way for the room and another way internally. That tension creates camera life.'
  ),

  makeSeed(
    'The Apology That Fails',
    'Audition Craft',
    'Let the apology collapse in real time.',
    `MONOLOGUE:
“I practiced this differently.
In the version I practiced, I was calmer.
I said the right things in the right order.
I took responsibility.
I gave you space.
I did not ask for anything.
It was a very good apology.
You would have hated it.
Because it was still about me.
About sounding decent.
About leaving here with one small piece of myself intact.
So I am not going to do that.
I hurt you.
I knew I was hurting you.
And at the time, I chose myself anyway.”

As if 1:
You are apologizing to a lover you cheated on.

As if 2:
You are a soldier apologizing to the family of someone you could not save.

As if 3:
You are a famous actor apologizing publicly but suddenly telling the real truth.

As if 4:
You are a sibling admitting you were the favorite and used it.

As if 5:
You are a villain discovering one apology might be the only decent thing left in you.`,
    'Train apology, responsibility, shame, and truthful self-tape confession.',
    'A monologue where the actor moves from rehearsed apology into real accountability.',
    [
      'Start controlled.',
      'Let the prepared version fail.',
      'Do not beg for forgiveness.',
    ],
    'scene',
    undefined,
    'Learning: Apology scenes become powerful when the actor stops trying to be liked. Accountability is active. Shame, pride, fear, and love can all fight inside the same speech.'
  ),

  makeSeed(
    'Classic Villain Reimagined',
    'Audition Craft',
    'Play villainy through logic, not evil.',
    `MONOLOGUE:
“You keep calling it cruelty because cruelty is easier to reject.
Cruel people are monsters.
Monsters can be killed.
But what if I am not cruel?
What if I am practical?
What if every terrible thing I have done was simply the cost of building a world that survives?
You hate the blood on my hands.
Good.
Someone should.
But while you were protecting your conscience, I was protecting the future.
So judge me if you like.
Just do it from inside the city I saved.”

As if 1:
You are a revolutionary leader justifying violence.

As if 2:
You are a CEO defending a decision that ruined thousands of lives.

As if 3:
You are a fantasy ruler who sacrificed one village to save a kingdom.

As if 4:
You are a parent explaining an unforgivable choice made to protect your child.

As if 5:
You are a charming comedy villain who genuinely thinks everyone else is too sentimental.`,
    'Train complex antagonists, moral logic, and self-tape power.',
    'A villain-style monologue that feels intelligent and human.',
    [
      'Do not play “evil.”',
      'Believe your own argument.',
      'Let charm, grief, or exhaustion complicate the danger.',
    ],
    'scene',
    undefined,
    'Learning: Strong villains rarely think they are villains. They have logic, wounds, values, and justifications. The actor’s job is to make the argument dangerously believable.'
  ),

  makeSeed(
    'Romantic Lead Test',
    'Audition Craft',
    'Play love with obstacle, not softness alone.',
    `MONOLOGUE:
“I was fine before you.
That is what annoys me most.
I had systems.
Routines.
A perfectly acceptable relationship with loneliness.
Then you arrived with your questions and your stupid laugh and your terrifying ability to notice when I was lying.
And now everything has become inconveniently alive.
So no, I am not saying this because it is easy.
I am saying it because pretending not to love you has become more exhausting than whatever happens after I admit it.”

As if 1:
You are confessing love to your best friend before they marry someone else.

As if 2:
You are in a romantic comedy and furious at how obvious your feelings have become.

As if 3:
You are a spy confessing love even though it puts both of you in danger.

As if 4:
You are a period character admitting love across class boundaries.

As if 5:
You are a ghost confessing to someone who can feel you but cannot see you.`,
    'Train romantic vulnerability, charm, stakes, and self-tape intimacy.',
    'A romantic lead monologue with humor, fear, and genuine need.',
    [
      'Do not become soft from the first line.',
      'Let resistance turn into confession.',
      'Make the other person specific.',
    ],
    'scene',
    undefined,
    'Learning: Romance needs obstacle. If love is easy, the scene is flat. The actor should play the risk of saying it, not just the beauty of feeling it.'
  ),

  makeSeed(
    'Action Lead Stillness',
    'Audition Craft',
    'Show strength without posing.',
    `MONOLOGUE:
“I am not brave.
Brave is what people call you after they survive what you did.
In the moment, it is uglier than that.
It is sweat and bad decisions and the horrible understanding that no one better is coming.
So you move.
Not because you are fearless.
Because fear is standing there with you, and if you wait for it to leave, everyone dies.
That is the truth.
I was scared the whole time.
I just moved anyway.”

As if 1:
You are an action hero explaining the rescue everyone calls heroic.

As if 2:
You are a firefighter after failing to save one person.

As if 3:
You are a soldier speaking to a younger recruit who worships you.

As if 4:
You are a superhero trying to convince a child that fear is normal.

As if 5:
You are a coward who accidentally became famous for bravery and hates the lie.`,
    'Train grounded strength, action-character truth, and anti-hero vulnerability.',
    'An action/drama monologue where courage feels human rather than posed.',
    [
      'Do not perform toughness.',
      'Let fear remain present.',
      'Keep the body still enough for the camera to read honesty.',
    ],
    'scene',
    undefined,
    'Learning: Strong characters are more compelling when fear is present. Courage is not the absence of fear; it is action with fear still in the room.'
  ),

  makeSeed(
    'Coming-of-Age Self Tape',
    'Audition Craft',
    'Play discovery as it happens, not after you understand it.',
    `MONOLOGUE:
“I think I have been waiting for permission.
From you.
From them.
From some imaginary adult version of myself who arrives with better hair and a five-year plan.
But nobody is coming.
That is both the bad news and the good news.
I can keep standing here, hoping someone tells me I am allowed to want more, or I can just want it.
Messily.
Embarrassingly.
Without a guarantee.
So that is what this is.
Me wanting something out loud.”

As if 1:
You are telling your parents you are not following the life they planned.

As if 2:
You are an actor deciding to move city with no guarantee of success.

As if 3:
You are a young prince/princess refusing the throne’s expectations.

As if 4:
You are in a comedy and this speech happens after a ridiculous failure.

As if 5:
You are speaking to your future self, terrified they will be disappointed in you.`,
    'Train youthful discovery, vulnerability, and active decision-making.',
    'A coming-of-age monologue with a visible moment of self-permission.',
    [
      'Do not play the ending at the beginning.',
      'Let the confidence arrive during the speech.',
      'Keep the want specific.',
    ],
    'scene',
    undefined,
    'Learning: Coming-of-age scenes are about becoming in real time. The actor must let the thought form while speaking, not arrive already wise.'
  ),

  makeSeed(
    'Self Tape Panic Control',
    'Technical',
    'Use breath and focus when nerves hit during recording.',
    `Preparation:
Before filming, stand with soft knees. Exhale fully on “fff.” Let the next breath come in naturally. Pick one point just beside the lens. Keep the focus there.

MONOLOGUE:
“I am going to slow down.
Not because I am calm.
I am not calm.
My heart is doing something dramatic and unnecessary.
My mouth is dry.
My brain has started offering me every possible way this could go wrong.
Thank you, brain.
Very creative.
But I am going to slow down anyway.
Because the story matters more than the panic.
And the panic can come with me if it has to.”

As if 1:
You are calming yourself mid-audition.

As if 2:
You are talking yourself through a dangerous mission.

As if 3:
You are on live television after being asked a question you were not prepared for.

As if 4:
You are in a comedy and trying not to have a panic attack at a dinner party.

As if 5:
You are a doctor preparing to deliver impossible news.`,
    'Train nervous-system control, breath, focus, and self-tape recovery.',
    'A monologue where panic is present but does not destroy clarity.',
    [
      'Do not fight nerves; include them.',
      'Use the exhale to slow down.',
      'Keep the focus point steady.',
    ],
    'technical',
    undefined,
    'Learning: Nerves are not failure. They are energy. A trained actor learns to let nerves exist while still serving the scene.'
  ),

  makeSeed(
    'Callback Variation Drill',
    'Mastery',
    'Make one monologue feel like five different roles.',
    `Film this monologue five times. Each version should feel like a different casting possibility.

MONOLOGUE:
“I know how this looks.
That is the first thing people always say when they are guilty.
I know that.
I hear myself.
But knowing how something looks is not the same as knowing what happened.
You have a story already.
I can see it in your face.
You have put me in the correct little box, sealed the lid, written my name on it.
But I am still here.
Annoyingly alive.
Still speaking.
Still refusing to become convenient.”

Version 1:
Legal drama — you are falsely accused and fighting for your life.

Version 2:
Dark comedy — everyone has misunderstood something ridiculous, but the stakes are socially huge.

Version 3:
Political thriller — the accusation is part of a larger conspiracy.

Version 4:
Romantic drama — the person you love believes the worst about you.

Version 5:
Supernatural horror — they think you are human, and you are deciding whether to let them keep thinking that.`,
    'Train callback flexibility, genre shift, and self-tape adaptability.',
    'Five distinct takes of the same monologue, each suitable for a different casting tone.',
    [
      'Change the genre fully, not lightly.',
      'Keep the text identical.',
      'Let each version have different stakes, rhythm, and relationship.',
    ],
    'technical',
    undefined,
    'Learning: Callback work often asks actors to adjust quickly. The actor must be able to keep the text and rebuild the world around it.'
  ),

  makeSeed(
    'The Private Secret',
    'Mastery',
    'Let a hidden truth shape the whole tape.',
    `Choose one secret before filming. Never say it directly.

Possible secrets:
- I caused the accident.
- I am still in love with you.
- I know you are lying.
- I am leaving tonight.
- I have already made the decision.
- I am more afraid of success than failure.
- I came here to say goodbye.

MONOLOGUE:
“You keep asking what changed.
Nothing changed.
That is the problem.
The room is the same.
You are the same.
I am standing in the same place, hearing the same excuses, watching the same little performance of surprise.
And maybe yesterday I would have helped you with it.
Maybe yesterday I would have smiled and made it easier.
But something in me has stopped moving toward you.
I do not know how else to say it.
The bridge is still there.
I am just not crossing it anymore.”

As if 1:
You are ending a relationship but still love them.

As if 2:
You are firing someone who once saved your life.

As if 3:
You are a monarch cutting off a family member for the good of the kingdom.

As if 4:
You are a criminal deciding not to protect your partner anymore.

As if 5:
You are speaking to your old dream of acting after deciding to quit — or deciding not to.`,
    'Train secrets, subtext, decision, and inner life.',
    'A monologue where the hidden secret is never spoken but clearly affects everything.',
    [
      'Pick one secret and write it down before filming.',
      'Do not reveal it directly.',
      'Let the secret change the pauses and the final decision.',
    ],
    'scene',
    undefined,
    'Learning: Subtext is often a secret in action. The audience does not need the full explanation, but they should feel the pressure of something unsaid.'
  ),

  makeSeed(
    'Final Take Selection',
    'Mastery',
    'Choose the take that serves the role, not your ego.',
    `Film this monologue three times:
1. Most emotionally open.
2. Most restrained.
3. Most dangerous or surprising.

Then watch all three and choose the best audition take.

MONOLOGUE:
“I know which version you prefer.
The charming one.
The one who makes everyone comfortable.
The one who turns pain into a story people can admire.
I can do that version.
I have done that version for years.
But I do not think that is the person standing here anymore.
The person standing here is less pleasant.
More honest.
Harder to edit.
And maybe that makes me wrong for the room.
Or maybe, finally, it makes me right for it.”

As if 1:
You are choosing between being liked and being truthful in an audition.

As if 2:
You are a public figure refusing to repair your image.

As if 3:
You are a villain dropping the mask for the first time.

As if 4:
You are an actor sending a tape that feels risky but real.

As if 5:
You are speaking to casting directly, without begging them to approve of you.`,
    'Train self-review, take selection, and professional judgment.',
    'Three takes and one chosen final submission.',
    [
      'Do not automatically choose the prettiest take.',
      'Choose the take with the clearest story.',
      'Ask: which version would make casting want to see more?',
    ],
    'technical',
    undefined,
    'Learning: Self-tape mastery includes taste. The best take is not always the most emotional, attractive, or polished. It is the one that best serves the role and reveals a specific actor.'
  ),

  makeSeed(
    'Featured Community Callback',
    'Mastery',
    'Use community feedback to improve your final tape.',
    `Before filming:
Go to Featured. Watch 3 submissions. Leave 3 comments:
1. One note about performance truth.
2. One note about technical clarity.
3. One note about what made you keep watching.

Then record this final monologue.

MONOLOGUE:
“I used to think being seen meant being chosen.
That someone else had to point and say, yes, you.
You are the one.
You are allowed in the room.
But I have watched people make things with no permission.
Films in bedrooms.
Songs in kitchens.
Scenes taped against blank walls with borrowed light.
And somehow, they were still alive.
So maybe being seen starts earlier.
Maybe it starts here.
With making the thing.
With telling the truth before anyone claps.
With showing up before anyone asks.”

As if 1:
You are speaking as an actor to other unknown actors, urging them not to wait.

As if 2:
You are the founder of a creative movement inviting people into something bigger.

As if 3:
You are giving yourself one last chance before quitting.

As if 4:
You are in a film about artists building a future from nothing.

As if 5:
You are speaking directly to the person watching your tape, asking not for pity, but for attention.`,
    'Train community engagement, artistic purpose, and final self-tape confidence.',
    'A polished final monologue after giving feedback to other creatives.',
    [
      'Comment on Featured before filming.',
      'Make the speech personal without becoming sentimental.',
      'Let the final line feel like an invitation, not a plea.',
    ],
    'scene',
    undefined,
    'Learning: Self-taping can feel lonely, but acting is not only private. Watching, supporting, and learning from other creatives builds taste and confidence. A creative community makes the individual actor stronger.'
  ),

  makeSeed(
    'The No-Reader Audition',
    'Mastery',
    'Carry a full audition alone with invisible listening.',
    `Film this as if another person is in the room, but only you speak.

MONOLOGUE:
“Do not answer yet.
Please.
If you answer too quickly, I will know you have practiced.
And I cannot survive another practiced answer from you.
So just listen.
I am going to say the thing plainly, and then you can decide what kind of person you want to be.
I know.
I know about the money.
I know about the messages.
I know about Thursday.
And I know that when I ask you why, you are going to look hurt, as if the question itself is the betrayal.
So do not do that.
Not this time.
This time, respect me enough to tell the truth badly.”

As if 1:
You are confronting a partner about cheating.

As if 2:
You are a detective giving a suspect one chance to confess.

As if 3:
You are a child confronting a parent about a lifetime of lies.

As if 4:
You are a comedy character trying to conduct a serious confrontation but emotionally over-prepared.

As if 5:
You are a monarch confronting the advisor who sold out the kingdom.`,
    'Train solo scene work, invisible partner listening, and sustained objective.',
    'A self tape that feels like a two-person scene even though only the actor speaks.',
    [
      'Do not rush the moments where the other person would respond.',
      'Hear their silent reactions.',
      'Let each imagined answer change your next tactic.',
    ],
    'scene',
    undefined,
    'Learning: A monologue can still be a scene. If the other person is alive in your imagination, the tape gains listening, reaction, and tactical movement.'
  ),

  makeSeed(
    'The Transformation Take',
    'Mastery',
    'Begin as one person and end as another.',
    `MONOLOGUE:
“At first, I thought this was about getting you to understand.
That was sweet of me.
Naive, but sweet.
I prepared examples.
Evidence.
Little emotional exhibits from the museum of ways you disappointed me.
But standing here now, I realize I do not need you to understand.
Understanding would be nice.
An apology would be elegant.
A tear would be theatrical.
But none of it is necessary.
Because I did not come here to change your mind.
I came here to change mine.
And I have.”

As if 1:
You begin wanting reconciliation and end choosing freedom.

As if 2:
You begin as a victim and end as a threat.

As if 3:
You begin as a polite employee and end as someone quitting publicly.

As if 4:
You begin in romantic drama and end in revenge thriller.

As if 5:
You begin as an actor begging to be chosen and end as an artist choosing themselves.`,
    'Train transformation, beat work, and a full emotional arc in close-up.',
    'A monologue where the actor clearly changes from beginning to end.',
    [
      'Do not play the ending too early.',
      'Mark the moment the objective changes.',
      'Let the final sentence feel irreversible.',
    ],
    'scene',
    undefined,
    'Learning: Great tapes often contain a transformation. The viewer should be able to say: this person is not in the same place at the end as they were at the beginning.'
  ),

  makeSeed(
    'The Self Tape Master Scene',
    'Mastery',
    'Combine setup, voice, imagination, stillness, and bold interpretation.',
    `Full preparation:
1. Do 3 minutes of semi-supine breath release.
2. Hum gently into resonance.
3. Warm articulation with tongue, lips, and jaw.
4. Choose one piece of private music for the character’s emotional weather.
5. Turn the music off.
6. Check frame, light, sound, and eyeline.
7. Record three radically different takes.

FINAL MONOLOGUE:
“If this is the only chance I get, then I do not want to waste it pretending.
I have done that already.
I have made myself smaller for rooms that were never going to choose me.
I have laughed at jokes that cut me.
I have thanked people for scraps and called it opportunity.
I have waited outside doors that were not locked, just because no one invited me through.
But I am tired now.
Not defeated.
Tired in the way a match is tired before it becomes fire.
So look at me properly.
Not as the safe choice.
Not as the obvious one.
As the person standing here with nothing polished left to hide behind.
This is what I have.
This voice.
This body.
This life.
This take.”

As if 1:
You are an unknown actor sending the tape that could change everything.

As if 2:
You are a revolutionary speaking before the first act of rebellion.

As if 3:
You are a performer returning after public humiliation.

As if 4:
You are a young James Bond-type figure before becoming dangerous, elegant, and impossible to ignore.

As if 5:
You are speaking to every closed door in your life and deciding you no longer need permission.

As if 6:
You are a ghost, and this tape is the only proof you were ever here.

As if 7:
You are in a final audition where casting has underestimated you, and you know this is the moment they stop.`,
    'Train complete self-tape mastery: preparation, technical clarity, emotional truth, and bold personal presence.',
    'Three polished takes of a final monologue, each with a radically different interpretation.',
    [
      'Use real preparation before filming.',
      'Record at least three different as-if versions.',
      'Choose the take that feels most alive, not the one that feels safest.',
    ],
    'technical',
    'This should feel like a complete audition piece: clean, specific, emotionally alive, and impossible to ignore.',
    'Learning: Mastery is integration. Setup, light, sound, voice, body, imagination, and courage all serve one thing: a truthful actor under imaginary circumstances. The final tape should not feel like a perfect product. It should feel alive.'
  ),
];
/* -------------------------------- EDITING -------------------------------- */
/* 35 unique non-boss lessons split across 3 phases */
const EDITING_FOUNDATION: LessonSeed[] = [
  makeSeed(
    'Assemble a Tea Sequence',
    'Foundations',
    'Learn assembly using one simple everyday action.',
    'Shoot or use exactly 5 shots of one person making tea or coffee: 1) wide of the space, 2) hand reaching for kettle, 3) pouring water, 4) close-up of mug, 5) final wide or medium of them sitting down with the drink. Edit them into one clear sequence.',
    'Train basic assembly, order, and visual clarity.',
    'A sequence where the action is completely easy to follow on first watch.',
    [
      'Use exactly 5 shots.',
      'Do not add music.',
      'The audience must understand the action without text.',
    ],
    'drill',
    'This is about order and clarity, not style.',
    'Learning: This is classic assembly training. Walter Murch’s hierarchy puts emotion and story above pure continuity, but you still need basic spatial clarity first. The lesson here is simple: the audience should never waste energy decoding the action when they should be following the event.'
  ),
  makeSeed(
    'Door, Cross, Sit',
    'Flow',
    'Make one continuous action feel seamless across multiple shots.',
    'Shoot or use footage of someone opening a door, entering a room, crossing to a chair, and sitting down. Get at least 1 wide, 2 mediums, and 2 close details. Edit it so the movement feels continuous and screen direction stays clear.',
    'Train continuity, matching movement, and spatial logic.',
    'A sequence where the action plays smoothly with no confusing jump in space or direction.',
    [
      'Keep left/right screen direction consistent.',
      'Match the sitting action cleanly across cuts.',
      'Do not use effects or transitions.',
    ],
    'technical',
    undefined,
    'Learning: Continuity is less about perfection than about preserving orientation. The editor’s job is to make movement feel inevitable and readable, so the viewer stays inside the scene rather than noticing the mechanics of coverage.'
  ),
  makeSeed(
    'Choose the Best Take',
    'Selection',
    'Learn to spot the take with the clearest behavior.',
    'Record 3 takes of the same short line: “I didn’t mean to do that.” In one take play apology, in one defensiveness, and in one hidden amusement. Build a short edit using the take that creates the strongest and clearest read.',
    'Train take selection and editorial taste.',
    'A close-up performance edit built around your strongest take choice.',
    [
      'Use the same framing in all 3 takes.',
      'Choose based on truth, not just cleanliness.',
      'Be able to explain why your chosen take works best.',
    ],
    'scene',
    undefined,
    'Learning: Thelma Schoonmaker has spoken about not worshipping perfect continuity when the better performance is in another take. A strong editor learns to privilege behaviour, intention, and emotional truth over the merely neat option.'
  ),
  makeSeed(
    'Trim In and Out Points',
    'Precision',
    'Learn how entering and exiting a shot changes energy.',
    'Use a 20–40 second two-person conversation scene. Make 3 versions of the exact same scene: one with early cuts, one with late cuts, and one balanced version. Compare how each changes the feeling.',
    'Train precision and timing at the cut point.',
    'Three versions of the same short scene with noticeably different pacing.',
    [
      'Do not change shot order.',
      'Only change where each shot starts and ends.',
      'The balanced version should feel strongest and cleanest.',
    ],
    'technical',
    undefined,
    'Learning: A cut is not just about where a shot changes, but when the audience is ready for that change. Murch’s rhythm principle is useful here: tiny adjustments in in-points and out-points can completely alter tension, speed, and attention.'
  ),
  makeSeed(
    'Reaction to Bad News',
    'Emotion',
    'Learn how a reaction shot changes the story.',
    'Shoot or use a 2-person exchange where one person says, “He’s not coming.” Create version A where you cut immediately to the reaction, and version B where you delay the reaction by 1–2 beats.',
    'Train emphasis, reaction timing, and emotional interpretation.',
    'Two edits of the same scene where the meaning changes because of reaction timing.',
    [
      'Use the exact same footage in both versions.',
      'Only change reaction timing.',
      'The audience should feel a different emotional result in each cut.',
    ],
    'drill',
    undefined,
    'Learning: Editors often shape emotion by deciding when the audience is allowed to read the face. An early reaction can clarify and release; a delayed reaction can build dread, ambiguity, or surprise. Reaction timing is story timing.'
  ),
  makeSeed(
    'Room Tone Under Dialogue',
    'Sound Foundations',
    'Hide audio cuts and keep a scene sonically stable.',
    'Shoot or use a dialogue clip in one room. Record 20 seconds of empty room tone in the same space. Lay the room tone underneath your dialogue edits so the background sound remains consistent.',
    'Train basic sound continuity and clean dialogue editing.',
    'A dialogue edit with smooth audio underneath every cut.',
    [
      'Use real room tone from the same location.',
      'No dead silence between cuts.',
      'The audio bed should feel steady and natural.',
    ],
    'technical',
    undefined,
    'Learning: Clean dialogue editing depends on stable ambience. Professional dialogue editors routinely use room tone and subtle fades so edits do not leave holes or sudden texture changes in the soundtrack. Silence is rarely truly silent in a scene.'
  ),
  makeSeed(
    'J-Cut and L-Cut Basics',
    'Audio Flow',
    'Let sound lead or trail the image.',
    'Use a conversation filmed in shot/reverse-shot. Make one version where the next line begins before the image cuts (J-cut), and one where the previous line continues after the image changes (L-cut).',
    'Train split edits and dialogue flow.',
    'Two dialogue examples showing one J-cut and one L-cut clearly.',
    [
      'Use the same conversation footage for both.',
      'Keep the scene readable.',
      'The audio overlap must improve flow, not confuse it.',
    ],
    'technical',
    undefined,
    'Learning: Adobe’s editing guidance frames J-cuts and L-cuts as ways to smooth transitions and preserve continuity of attention. The lesson is not just technical overlap — it is using sound to pull the viewer emotionally into the next beat before the picture fully arrives.'
  ),
];

const EDITING_INTERMEDIATE: LessonSeed[] = [
  makeSeed(
    'Hard Cut vs Crossfade',
    'Sound Editing',
    'Hear the difference between an abrupt cut and a shaped transition.',
    'Take 2 adjacent audio clips from the same room dialogue scene and make 3 versions: a hard cut, a short crossfade, and a longer crossfade.',
    'Train crossfade judgment, transition feel, and audio smoothness.',
    'Three audio transition examples built from the same source.',
    [
      'Use the same source clips in all 3 versions.',
      'Avoid clicks, pops, or bumps.',
      'Choose the version that best supports the moment, not the fanciest one.',
    ],
    'technical',
    undefined,
    'Learning: A crossfade is not automatically better than a cut. Good editors listen for texture, consonants, breath, and room tone. The real lesson is judgment: use the least obvious solution that preserves the scene’s natural sound and emotional shape.'
  ),
  makeSeed(
    'Layer a Room Entry',
    'Sound Editing',
    'Build a believable scene out of multiple audio layers.',
    'Shoot or use a scene of someone entering a room, setting down a bag, sitting in a chair, and opening a notebook. Build the soundtrack from 4 separate layers: room tone, footsteps, bag impact, and chair/notebook detail.',
    'Train layering, prioritising detail, and avoiding muddy mixes.',
    'A scene with a fuller, more intentional soundtrack than raw production audio.',
    [
      'Use at least 4 audio layers.',
      'Each layer must add something specific.',
      'Do not let layering make the mix muddy.',
    ],
    'technical',
    undefined,
    'Learning: Good sound layering is selective, not crowded. Editors and sound teams build believable worlds by deciding which details deserve attention and which should stay background. Clarity beats quantity.'
  ),
  makeSeed(
    'Fade Shape Study',
    'Sound Editing',
    'Use fades as emotional tools, not just cleanup.',
    'Take one clip with dialogue or ambience and make 3 versions of its ending: abrupt end, short fade, and long fade. Compare which feels natural and which feels dramatic.',
    'Train fade length control and how fades change emotional tone.',
    'Three exports of the same clip with clearly different endings.',
    [
      'Change only the fade shape or length.',
      'Listen on speakers and headphones if possible.',
      'Be able to explain what each fade does to the feeling.',
    ],
    'technical',
    undefined,
    'Learning: Fade length affects tone. An abrupt cutoff can feel harsh or comic; a gentle fade can feel reflective, elegant, or emotionally suspended. Editors should hear fades as storytelling decisions, not just cleanup.'
  ),
  makeSeed(
    'Pace the Performance',
    'Emotion',
    'Shape how an actor lands through timing.',
    'Take a performance-heavy close-up moment and make 2 versions: one that cuts quickly around the actor and one that lets the actor breathe.',
    'Train sensitivity to breathing room and performance emphasis.',
    'Two edits of the same performance beat with clearly different emotional weight.',
    [
      'Do not flatten the emotion by overcutting.',
      'At least one held beat must matter.',
      'The stronger version should make the actor feel more alive, not more polished.',
    ],
    'drill',
    undefined,
    'Learning: Schoonmaker’s approach repeatedly points back to performance. Editors must know when to leave a face alone. Often the most powerful decision is to resist cutting, so thought can finish landing on screen.'
  ),
  makeSeed(
    'Genre Recut: The Message',
    'Scene Study',
    'Push the same footage into a different genre.',
    'Shoot or use one neutral scene: a person enters a room, finds a phone, reads a message, and looks up. Cut it as either a thriller, romance, comedy, or psychological drama.',
    'Train emotional authorship through rhythm, order, silence, and sound.',
    'A genre recut with a clear tonal identity.',
    [
      'No reshoots.',
      'Maximum 3 text cards if absolutely necessary.',
      'Use rhythm and sound intentionally.',
    ],
    'scene',
    undefined,
    'Learning: Editors are authors of tone. The same footage can become funny, ominous, intimate, or unsettling depending on shot duration, reveal order, silence, and sound emphasis. This is editorial point of view in action.'
  ),
  makeSeed(
    'Tension by Delay',
    'Pacing',
    'Build pressure by refusing to cut too soon.',
    'Use a scene where a hand reaches for a doorknob, opens a text, or turns toward someone offscreen. Build tension mainly by holding longer than expected before cutting.',
    'Train duration, discomfort, and release.',
    'A sequence where restraint creates noticeable pressure.',
    [
      'Hold at least one shot longer than feels safe.',
      'Do not add fake tension with loud music.',
      'The final beat must land hardest.',
    ],
    'constraint',
    undefined,
    'Learning: Tension often comes from delayed information, not added noise. Holding a shot past comfort can make the viewer lean in. The craft note is to earn the hold — it should intensify anticipation, not just slow the scene down.'
  ),
  makeSeed(
    'Parallel Pressure',
    'Structure',
    'Intercut two threads so they charge each other with meaning.',
    'Shoot or collect 2 simultaneous mini-actions: one person getting dressed to leave and another person waiting outside a door or at a bus stop. Intercut them so pressure rises with each return.',
    'Train cross-cutting logic and escalation.',
    'A sequence where intercutting creates tension or dramatic irony.',
    [
      'Use at least 2 distinct threads.',
      'The cross-cutting must build toward something.',
      'Each return should increase tension, contrast, or meaning.',
    ],
    'scene',
    undefined,
    'Learning: Parallel cutting works when each return changes the charge of the other thread. Do not simply alternate. Escalate. The audience should feel the lines converging emotionally, narratively, or both.'
  ),
  makeSeed(
    'Cut the Reveal',
    'Impact',
    'Control what the audience learns and when.',
    'Build a reveal scene around one hidden thing: a text message, ring, knife, empty chair, or face in a doorway. The cut order must control exactly when the audience gets the key information.',
    'Train suspense and payoff timing.',
    'A sequence where the reveal changes understanding.',
    [
      'Do not reveal the key information too early.',
      'The reveal must change what the audience thinks or feels.',
      'Shot order must matter.',
    ],
    'constraint',
    undefined,
    'Learning: Reveal editing is about information design. The editor controls curiosity by deciding what the viewer sees, what they suspect, and when certainty arrives. A reveal should reframe what came before it.'
  ),
  makeSeed(
    'Cut on Thought',
    'Psychology',
    'Cut with internal shifts, not just movement.',
    'Use a close-up or dialogue scene and place cuts where thought changes, not where hands move or heads turn.',
    'Train psychological editing and invisible timing.',
    'A scene that feels smarter and more emotionally exact.',
    [
      'At least 3 cuts must be motivated by thought shifts.',
      'Protect actor timing.',
      'No showy cuts.',
    ],
    'drill',
    undefined,
    'Learning: Great cutting often follows thought rather than motion. Murch’s writing and interviews point toward cuts that feel emotionally and mentally right, not just physically matched. Watch the eyes, breath, and intention shifts.'
  ),
  makeSeed(
    'Time Compression: Pack a Bag',
    'Time',
    'Condense time without losing clarity.',
    'Shoot or use a longer process of someone packing a bag to leave the house. Compress the full action into one short sequence while keeping the emotional line clear.',
    'Train ellipsis and temporal control.',
    'A compressed sequence that still feels complete.',
    [
      'The audience must never feel lost.',
      'Keep the emotional spine alive.',
      'Use compression intentionally rather than chopping randomly.',
    ],
    'technical',
    undefined,
    'Learning: Ellipsis is one of editing’s core powers. The trick is not merely removing steps, but preserving the scene’s emotional through-line so the viewer feels completion rather than absence.'
  ),
  makeSeed(
    'Time Expansion: The Key',
    'Time',
    'Make a tiny moment feel huge.',
    'Take one small action — a hand reaching for a key, unlocking a door, or opening a message — and expand it into a suspenseful beat using inserts, delay, and sound detail.',
    'Train duration, suspense, and emphasis.',
    'An expanded-time sequence built from a tiny event.',
    [
      'Do not become repetitive.',
      'Every insert must add pressure or focus.',
      'The moment must stay clear.',
    ],
    'constraint',
    undefined,
    'Learning: Time expansion works when every added beat increases focus or dread. Inserts are not decorative; they should sharpen anticipation. If an insert does not intensify the moment, it probably weakens it.'
  ),
  makeSeed(
    'Dialogue Rescue',
    'Repair',
    'Fix a weak scene in the edit.',
    'Take a flat 2-person dialogue scene and improve it through trimming, reaction choices, audio cleanup, and restructuring shot order if needed.',
    'Train rescue editing and practical problem solving.',
    'A before-and-after dialogue pass with visible improvement.',
    [
      'Do not rely on music to do the work.',
      'Use reactions intelligently.',
      'The repaired version must feel sharper and cleaner.',
    ],
    'technical',
    undefined,
    'Learning: Real editors are constantly problem-solvers. Rescue work often comes down to performance emphasis, sharper entry and exit points, reaction strategy, and sound continuity. Editing is not only design — it is repair.'
  ),
  makeSeed(
    'Montage to the Beat',
    'Montage',
    'Cut a sequence entirely to the pulse of music.',
    'Shoot or collect 12–20 shots of one person getting ready to leave the house: shoes, keys, jacket, mirror, door, stairs, street, bus stop, train, etc. Choose one song and cut the montage so the major visual changes land on the beat or on deliberate off-beat accents.',
    'Train rhythmic montage and beat-based timing.',
    'A montage with clear musical structure.',
    [
      'Use one song only.',
      'All major image changes must relate to the track’s rhythm.',
      'Do not let the montage become random just because it is fast.',
    ],
    'scene',
    undefined,
    'Learning: Rhythmic editing is not just “cut on every beat.” Good montage uses pattern, surprise, and control. A deliberate off-beat cut can be as strong as an on-beat one if it sharpens the sequence’s musical logic.'
  ),
  makeSeed(
    'Trailer Pulse',
    'Cutdown',
    'Build a teaser that feels urgent and cinematic.',
    'Take an existing short scene or short film and cut a teaser that sells tone, stakes, and curiosity without explaining everything.',
    'Train compression, hook-building, and ending impact.',
    'A teaser with a strong opening and final hook.',
    [
      'Maximum 3 text cards.',
      'End on the strongest hook, not the loudest moment.',
      'Do not explain too much.',
    ],
    'technical',
    undefined,
    'Learning: A trailer or teaser is an exercise in selective promise. The editor must sell tone and curiosity while withholding too much clarity. Hook the audience, don’t summarize for them.'
  ),
];

const EDITING_ADVANCED: LessonSeed[] = [
  makeSeed(
    'Documentary Truth Pass',
    'Nonfiction',
    'Find shape inside messy real material.',
    'Shoot or use observational footage of one real process: a market stall opening, a friend preparing food, someone setting up camera gear, a train platform, or a bus stop wait. Shape it into a short truthful scene.',
    'Train nonfiction story instincts and structural judgment.',
    'A documentary-style scene with a clear emotional centre.',
    [
      'Do not force fake drama.',
      'Clarity matters.',
      'Find the actual human beat in the material.',
    ],
    'scene',
    'A good documentary edit finds shape without flattening reality.',
    'Learning: Documentary editing is structure without fabrication. The editor’s challenge is to discover rhythm, point of view, and emotional centre inside real material without forcing it into false melodrama.'
  ),
  makeSeed(
    'Base Correction Before Style',
    'Color',
    'Correct first, stylise second.',
    'Take a short daylight scene with visible imbalance — too dark, too warm, too cool, or inconsistent exposure — and create one clean balanced correction pass before attempting any look.',
    'Train correction discipline and the difference between fixing and styling.',
    'A side-by-side neutral correction pass and a short note on what you corrected.',
    [
      'Balance exposure and colour before adding a look.',
      'Keep skin and neutrals believable.',
      'Do not jump straight into stylisation.',
    ],
    'technical',
    undefined,
    'Learning: Professional colour practice starts with correction: exposure, balance, and shot matching before mood work. A “look” sits on top of a stable image. If the base is broken, the style usually looks amateurish.'
  ),
  makeSeed(
    'Shot Match',
    'Color',
    'Different shots should feel like they belong to the same scene.',
    'Take 2 or more mismatched shots from one dialogue scene — for example a wide and 2 close-ups with different white balance or brightness — and match them into believable continuity.',
    'Train colour continuity and shot matching.',
    'A matched sequence where the shots feel unified.',
    [
      'Use at least 2 shots.',
      'Match balance before mood.',
      'The audience should stop noticing the mismatch.',
    ],
    'technical',
    undefined,
    'Learning: Colour continuity should disappear into the scene. Match first for consistency, then decide whether the sequence needs a stronger emotional bias. Invisible technical correction is often part of elegant editing.'
  ),
  makeSeed(
    'Color Grade the Emotion',
    'Color',
    'Use grading to push emotional world without losing readability.',
    'Take one close-up or dialogue scene in neutral light and create 2 versions: one warm and intimate, one cold and emotionally distant.',
    'Train emotional decision-making in colour, contrast, and temperature.',
    'Two graded versions of the same scene with clearly different emotional identities.',
    [
      'Same footage for both versions.',
      'Do not over-stylise past readability.',
      'Skin tones must stay believable unless the concept clearly demands otherwise.',
    ],
    'technical',
    undefined,
    'Learning: Colour is emotional rhetoric. Warmth, coolness, contrast, and density all influence audience feeling. The key lesson is control: push tone without losing legibility or turning the grade into the subject itself.'
  ),
  makeSeed(
    'Recreate a Famous Grade',
    'Color Study',
    'Learn by closely observing an existing visual language.',
    'Choose one short famous film scene and try to recreate its tonal balance and grading feel using your own neutral footage.',
    'Train reference analysis, taste, and look construction.',
    'A short scene inspired by a recognisable grading style plus a brief note on the reference.',
    [
      'Study a specific reference scene.',
      'Aim for emotional similarity, not exact imitation.',
      'Keep the result coherent and controlled.',
    ],
    'scene',
    undefined,
    'Learning: Referencing great work trains your eye. The point is not clone-level imitation, but learning to see how contrast, saturation, density, and colour separation create a world. Taste grows through close observation.'
  ),
  makeSeed(
    'False Lead Edit',
    'Misdirection',
    'Make the audience believe the wrong thing first.',
    'Build a scene where a viewer first reads one meaning — for example romance, comfort, safety, or honesty — and then realises they were wrong because of the edit.',
    'Train misdirection and payoff.',
    'A sequence with a strong reinterpretation beat.',
    [
      'The false reading must be believable.',
      'The reveal must reframe earlier cuts.',
      'No cheat twists.',
    ],
    'scene',
    undefined,
    'Learning: Misdirection is fair only when the first reading is honestly supported by the cut. A good reveal does not feel random; it makes the audience reinterpret the same material under a new logic.'
  ),
  makeSeed(
    'Re-Edit an Old Film',
    'Reinterpretation',
    'Transform old work through post decisions.',
    'Take one of your own older films or scenes and rebuild it to feel sadder, stranger, funnier, colder, or more urgent.',
    'Train reinterpretation and post-authorship.',
    'A before-and-after re-edit or a new cut of old footage with a clearly altered emotional effect.',
    [
      'No reshoots.',
      'Reuse existing footage only.',
      'The emotional tone must noticeably shift.',
    ],
    'drill',
    undefined,
    'Learning: Editors are not just finishers; they are interpreters. Re-editing old footage teaches how much authorship lives in selection, duration, order, and sound, even when the images stay the same.'
  ),
  makeSeed(
    'Recut an Overlooked Film',
    'Community Edit',
    'Learn by reinterpreting work from inside the platform.',
    'Take a short Overlooked student film or scene and build a new cut that changes emphasis, pace, or point of view while respecting the original material.',
    'Train editorial voice, restraint, and reinterpretation from existing community footage.',
    'A new cut of an Overlooked scene with a clear editorial argument.',
    [
      'Do not add new footage.',
      'Your new cut must have a clear reason for existing.',
      'The emotional or narrative emphasis must noticeably change.',
    ],
    'scene',
    undefined,
    'Learning: Recutting another editor or filmmaker’s material is a strong way to learn editorial argument. Your job is not to “improve” by default, but to prove a new perspective through disciplined choices.'
  ),
  makeSeed(
    'Memory Cut',
    'Subjective Edit',
    'Edit like recollection instead of objective reality.',
    'Take existing footage of a conversation, reunion, walk, or room and cut it as if it is being remembered imperfectly, emotionally, or selectively.',
    'Train subjectivity and emotional fragmentation.',
    'A sequence that feels like memory rather than plain chronology.',
    [
      'The structure does not need to be linear.',
      'The emotion must still read clearly.',
      'The approach must feel deliberate rather than random.',
    ],
    'scene',
    undefined,
    'Learning: Subjective editing often privileges emotional association over literal order. The challenge is to break chronology without losing feeling. A memory cut should feel chosen, not chaotic.'
  ),
  makeSeed(
    'Silence and Shock',
    'Contrast',
    'What you remove can hit harder than what you add.',
    'Build a moment where expected audio drops away during a key visual beat: a text reveal, eye contact, object discovery, or the moment after a slammed door.',
    'Train contrast, restraint, and sonic punctuation.',
    'A sequence where silence or sonic drop becomes the turning point.',
    [
      'The silence must be clearly motivated.',
      'Use contrast, not randomness.',
      'The key turn must land through restraint.',
    ],
    'technical',
    undefined,
    'Learning: Sound design is often strongest when subtraction creates focus. Schoonmaker and many top editors talk about using silence strategically; a drop in sound can make the viewer feel the event more sharply than added emphasis.'
  ),
  makeSeed(
    'Perspective Rebuild',
    'Point of View',
    'Make the scene belong to another character.',
    'Recut a 2-person scene so the audience now tracks a different person as the emotional centre.',
    'Train POV, emphasis, and editorial politics.',
    'A recut where the audience clearly experiences the scene through a new emotional centre.',
    [
      'The emotional centre must genuinely shift.',
      'Shot order and emphasis must support the new POV.',
      'The audience should feel the difference quickly.',
    ],
    'drill',
    undefined,
    'Learning: Point of view is one of the editor’s strongest powers. By changing what we watch, when we watch it, and whose reactions matter most, you can quietly move the whole scene into another character’s ownership.'
  ),
  makeSeed(
    'Withhold the Reaction',
    'Tension',
    'Sometimes the strongest reaction is the one you refuse to show.',
    'Cut a reveal scene so the audience waits too long for the reaction shot, creating pressure before the reaction finally lands.',
    'Train withholding, anticipation, and timing.',
    'A tension sequence where the delayed reaction changes the scene.',
    [
      'Delay with purpose.',
      'The eventual reaction must land.',
      'Do not confuse the audience.',
    ],
    'constraint',
    undefined,
    'Learning: Editors do not always need to show the face immediately. Withholding a reaction can make the viewer project, anticipate, and worry. The delayed payoff only works if the release finally feels earned.'
  ),
  makeSeed(
    'Elliptical Story Edit',
    'Structure',
    'Leave out more and trust the audience more.',
    'Tell a short scene by omitting expected steps — for example arriving, unlocking, entering, finding, leaving — and letting the audience assemble the logic.',
    'Train elegant omission and compressed storytelling.',
    'A sequence that feels complete without spelling everything out.',
    [
      'Do not become confusing.',
      'Omissions must feel intentional.',
      'The audience should still emotionally track.',
    ],
    'scene',
    undefined,
    'Learning: Elegant editing often comes from omission. Trusting the audience does not mean becoming obscure; it means removing the predictable steps while keeping the emotional and narrative line intact.'
  ),
  makeSeed(
    'Master Editor Proof',
    'Mastery',
    'Show full control of structure, feeling, sound, and finish.',
    'Build a polished mini-piece from one complete scenario — dialogue scene, action scene, montage, documentary beat, or Overlooked recut — where performance, pacing, sound design, reveal control, and finish all feel deliberate.',
    'Prove advanced editorial authorship.',
    'A refined finished short sequence that feels fully authored.',
    [
      'Everything must feel intentional.',
      'No dead sections.',
      'The final version must feel truly finished.',
    ],
    'technical',
    undefined,
    'Learning: This is the integration lesson. Bring together Murch’s priorities — emotion, story, rhythm — with practical craft: sound continuity, reaction control, reveal design, and finish. A masterful cut feels inevitable, not merely assembled.'
  ),
];
/* ----------------------------- CINEMATOGRAPHY ----------------------------- */
/* 35 unique non-boss lessons */
const CINEMATOGRAPHY_BASE: LessonSeed[] = [
  makeSeed(
    'Frame Size Study',
    'Foundations',
    'Learn what shot size does to emotion.',
    'Shoot the same simple action 4 ways: wide, medium, close-up, and extreme close-up. Use one action such as reading a text, opening a letter, unlocking a door, or picking up a ring.',
    'Train emotional control through framing distance.',
    'A comparison sequence showing how the exact same action changes across 4 frame sizes.',
    [
      'Use the exact same action each time.',
      'Keep lighting and blocking as similar as possible.',
      'Only the framing size should change the emotional effect.',
    ],
    'drill',
    'This teaches that framing distance is never neutral.',
    'Learning: Shot size is emotional grammar. A wide can create loneliness, exposure, or social geometry; a close-up can create intimacy, pressure, or subjectivity. Study how Roger Deakins, Emmanuel Lubezki, Conrad Hall, Sven Nykvist, and Harris Savides let framing distance shape feeling before the actor even speaks.'
  ),

  makeSeed(
    'Camera Height Study',
    'Foundations',
    'Learn how camera height affects status and vulnerability.',
    'Shoot the same short interaction from 3 heights: high angle, eye level, and low angle. Use one beat like someone being questioned, confronted, or asked to leave.',
    'Train psychological use of camera height.',
    'A comparison scene where camera height clearly changes the feeling of power.',
    [
      'Use the same blocking and text in all 3 versions.',
      'Only camera height should change the reading.',
      'The difference must be easy to feel on first watch.',
    ],
    'technical',
    undefined,
    'Learning: Camera height is psychological, not just practical. Gregg Toland, Gordon Willis, Caleb Deschanel, and Hoyte van Hoytema all show how perspective can quietly change status. Ask: does the frame witness, dominate, submit, or destabilise?'
  ),

  makeSeed(
    'Lens Study: Wide vs Long',
    'Lens Basics',
    'Learn how focal length changes space and pressure.',
    'Shoot the same action twice: once on the widest lens you have and once on a longer lens or tighter crop from farther away. Use one action such as walking toward camera, sitting at a table, turning after hearing something, or crossing a corridor.',
    'Train focal-length awareness, spatial distortion, and compression.',
    'A comparison showing how wider and longer lensing change the emotional feel of the same moment.',
    [
      'Keep the final subject size roughly similar in both versions if possible.',
      'Do not change the acting much.',
      'Let the lens and camera distance do the work.',
    ],
    'technical',
    undefined,
    'Learning: A lens is not only magnification. Wide lenses can make space feel unstable, intimate, exposed, or alive; longer lenses can flatten, isolate, and compress. Think about Deakins, Lubezki, Greig Fraser, Vilmos Zsigmond, and Néstor Almendros when choosing whether the world should open up or close in.'
  ),

  makeSeed(
    'Aperture Exercise: Isolate the Subject',
    'Exposure Basics',
    'Use depth of field to control what matters.',
    'Shoot one subject against a deeper background. Create one version with the deepest depth of field you can achieve and one with the shallowest depth of field you can achieve. Example: someone waiting in a hallway, sitting at a table, or standing still while people move behind them.',
    'Train creative use of aperture and depth of field.',
    'Two clips where the viewer clearly feels the difference between deep focus and shallow focus.',
    [
      'Use the same subject and background in both versions.',
      'Focus must be accurate in both clips.',
      'The change in depth of field must be clearly visible.',
    ],
    'technical',
    undefined,
    'Learning: Depth of field is an attention tool. Deep focus can create tension between planes or let the world stay alive; shallow focus can isolate obsession, fear, or longing. Gregg Toland, Deakins, and many contemporary cinematographers use depth not as decoration but as narrative hierarchy.'
  ),

  makeSeed(
    'ISO Test: Night Exterior Truth',
    'Exposure Basics',
    'Learn what higher ISO gives you and what it costs you.',
    'Shoot the same short night scene twice outside or near a dim practical source: someone checking their phone, pacing under a streetlight, lighting a cigarette, or waiting by a doorway. Film once at a lower ISO and once at a much higher ISO.',
    'Train exposure judgment, noise awareness, and low-light discipline.',
    'Two clips showing the trade-off between cleaner shadows and brighter exposure.',
    [
      'Use the same location and action in both versions.',
      'Do not change the main light source.',
      'Compare detail, shadow shape, and noise honestly.',
    ],
    'technical',
    undefined,
    'Learning: Night cinematography is a discipline of compromise. Ask what matters most: cleaner blacks, more texture, more visibility, or more mystery. Deakins, Bradford Young, and Hoyte van Hoytema all show in different ways that darkness should feel chosen, not accidental.'
  ),

  makeSeed(
    'White Balance Mood Shift',
    'Exposure Basics',
    'Learn how color temperature changes emotional tone.',
    'Shoot the same short setup 3 times: balanced normally, intentionally warmer, and intentionally cooler. Use a simple beat like someone reading a message, sitting alone at a table, or preparing to leave.',
    'Train white balance awareness and emotional color control.',
    'A comparison showing how color temperature changes the scene’s mood.',
    [
      'Keep framing and exposure as similar as possible.',
      'Only white balance should meaningfully shift the mood.',
      'Do not fix the color in post before comparing.',
    ],
    'technical',
    undefined,
    'Learning: Color temperature can make a scene feel safe, nostalgic, sterile, lonely, sick, or heightened. Vittorio Storaro’s work is a reminder that color is philosophy as much as technique. Learn to ask not just “is it correct?” but “what emotional world does this temperature build?”'
  ),

  makeSeed(
    'One Practical Light Scene',
    'Lighting',
    'Build the scene around one visible source.',
    'Shoot a scene lit only by one practical source: lamp, window, fridge light, TV, phone, or computer screen. Example scene: someone waiting for a reply, recording a voice note, or deciding whether to leave.',
    'Train discipline, motivated lighting, and contrast control.',
    'A scene where the light source clearly shapes the emotional tone.',
    [
      'Use one visible source only.',
      'No hidden fill.',
      'The scene must still feel readable enough to watch.',
    ],
    'scene',
    undefined,
    'Learning: One-source lighting teaches discipline. Think of Gordon Willis, Sven Nykvist, Conrad Hall, and Deakins: motivated light often feels stronger because it gives the scene a believable visual logic. The goal is not to make it pretty first — it is to make the source feel dramatically true.'
  ),

  makeSeed(
    'Reflections First',
    'Framing',
    'Tell the moment through reflections before direct access.',
    'Open a short scene using mirrors, windows, polished metal, phone screens, puddles, or any reflective surface before finally showing the subject directly.',
    'Train withholding, visual intrigue, and reveal timing.',
    'A scene with at least one reveal that feels earned.',
    [
      'Use at least 3 reflection-based frames.',
      'Do not show the subject directly at first.',
      'The final reveal must matter emotionally or narratively.',
    ],
    'drill',
    undefined,
    'Learning: Reflections create distance, doubling, voyeurism, and self-consciousness. Many cinematographers use them not because they look elegant, but because they turn the image into a psychological space. Think beyond “cool mirror shot” — ask what the reflection says about access, secrecy, or divided identity.'
  ),

  makeSeed(
    'No Face Emotion',
    'Constraint',
    'Tell the emotional beat without showing a full face.',
    'Build a short scene using only hands, posture, silhouette, props, movement, or framing to show feeling. Example actions: deleting a text, gripping a sink, dropping keys, folding clothes, or packing a bag.',
    'Train non-obvious visual storytelling.',
    'A scene where emotion is readable without a full-face reveal.',
    [
      'No full face allowed.',
      'Use body language and objects intentionally.',
      'Emotion must still read clearly on first watch.',
    ],
    'constraint',
    undefined,
    'Learning: Great cinematography does not always depend on faces. Bresson’s influence on image-making, still photography traditions, and the work of cinematographers like Savides, Fraser, and Nykvist remind us that posture, gesture, and objects can carry emotion with extraordinary force.'
  ),

  makeSeed(
    'Foreground Storytelling',
    'Depth',
    'Use layers, not just subjects.',
    'Frame a short scene through foreground elements like door frames, hanging clothes, glass, railings, plants, another person’s shoulder, or objects on a table.',
    'Train depth and layered composition.',
    'A scene where foreground changes the emotional meaning or power of the image.',
    [
      'Use active foreground in at least 3 shots.',
      'Do not clutter the frame randomly.',
      'Layering must add meaning, not just style.',
    ],
    'technical',
    undefined,
    'Learning: Layered composition can create surveillance, intimacy, hierarchy, or obstruction. Cinematographers often borrow from painting here: foreground, middle ground, and background create a visual argument. Study painters as much as films — they teach how space itself can become dramatic.'
  ),

  makeSeed(
    'Negative Space Pressure',
    'Composition',
    'Let emptiness create unease.',
    'Frame a character so a large empty section of the frame feels threatening, lonely, anticipatory, or emotionally loaded. Example: someone waiting for a call, hearing a noise offscreen, or standing near a doorway they are afraid to cross.',
    'Train negative space as storytelling.',
    'A scene where empty frame area carries tension.',
    [
      'Negative space must feel intentional.',
      'The audience should keep looking into the empty area.',
      'Do not explain the feeling verbally.',
    ],
    'constraint',
    undefined,
    'Learning: Negative space is one of cinema’s cleanest tension tools. It invites the viewer to search, anticipate, and project. Deakins, Ozu, Savides, and many painters show that emptiness is never empty when composition gives it pressure.'
  ),

  makeSeed(
    'Backlight Entrance',
    'Lighting',
    'Let shape and edge light reveal character.',
    'Shoot an entrance where backlight from a doorway, window, hallway, or exterior source does most of the dramatic work.',
    'Train silhouette control and subject separation.',
    'An entrance scene driven by backlight.',
    [
      'The backlight must be motivated in the space.',
      'Keep exposure intentional.',
      'The entrance should feel authored, not accidental.',
    ],
    'scene',
    undefined,
    'Learning: Backlight is powerful because it defines shape before detail. John Alton, Storaro, and many noir and neo-noir cinematographers understood that silhouette and edge can make a character feel mythic, dangerous, lonely, or unknowable before the audience reads the face.'
  ),

  makeSeed(
    'Reveal by Focus',
    'Focus',
    'A focus shift should reveal meaning, not just look pretty.',
    'Build a scene where the important reveal happens through focus: a figure in the background, a hidden object on a table, a message on a phone, or a detail in someone’s hand.',
    'Train selective attention and focus-based storytelling.',
    'A scene built around one meaningful focus pull.',
    [
      'The rack focus must change meaning.',
      'Do not use more than 2 focus shifts.',
      'Keep the shift motivated by story.',
    ],
    'technical',
    undefined,
    'Learning: Focus is a storytelling edit inside the shot. A rack focus works best when it changes the audience’s understanding, not when it merely announces itself. Treat it like a cut in thought.'
  ),

  makeSeed(
    'Movement With Meaning',
    'Camera Motion',
    'Move the camera only when the beat earns it.',
    'Shoot a short scene where the camera stays still until one clear turning point, then performs one push, drift, pan, or follow move that changes the pressure of the moment.',
    'Train meaningful camera movement rather than decorative movement.',
    'A scene with one decisive movement that matters.',
    [
      'Only one major camera move is allowed.',
      'The move must begin on a real emotional or narrative beat.',
      'Stillness before the move should matter too.',
    ],
    'scene',
    undefined,
    'Learning: Camera movement is strongest when it feels earned. Lubezki, van Hoytema, Fraser, and Deakins all show in different ways that movement changes how we inhabit time and pressure. Ask what the movement is doing emotionally, not just what it is doing physically.'
  ),

  makeSeed(
    'Handheld With Rules',
    'Camera Motion',
    'Handheld needs grammar, not chaos.',
    'Shoot a short scene handheld, but define one rule before filming: stay shoulder height only, stay behind the subject, move only when the subject moves, or keep the subject on one side of frame the whole time.',
    'Train disciplined handheld work.',
    'A scene with purposeful handheld grammar.',
    [
      'Set one handheld rule before shooting.',
      'No random wobble.',
      'The movement must feel emotionally connected to the subject.',
    ],
    'technical',
    undefined,
    'Learning: Handheld works when it has logic. Think of documentary influence, but also of cinematographers who use handheld precisely rather than messily. Give the camera a behavioural rule the way an actor gets an action.'
  ),

  makeSeed(
    'POV Frame',
    'Subjective Camera',
    'Make the frame clearly belong to one character’s experience.',
    'Shoot a short sequence from one character’s emotional point of view: jealousy at a party, suspicion in a hallway, longing across a station, or fear in an empty room.',
    'Train subjective cinematography.',
    'A sequence with a strong POV identity.',
    [
      'The audience should feel whose experience it is.',
      'Keep visual choices consistent.',
      'Do not explain the POV in dialogue.',
    ],
    'scene',
    undefined,
    'Learning: Subjective cinematography is not only literal POV shots. It can come through lens choice, distance, duration, blocking, and what the frame cares about. Wong Kar Wai’s collaborators, Lubezki, and many modern DPs use subjectivity as visual psychology.'
  ),

  makeSeed(
    'Body-Rig Panic Shot',
    'Experimental Movement',
    'Trap the audience inside the character’s body.',
    'Create one short panic or overwhelm beat using a body-mounted, chest-mounted, or improvised strapped-camera setup so the actor stays fixed while the world moves around them.',
    'Train subjective camera grammar and psychological image design.',
    'A shot where the audience feels trapped inside the character’s mental state.',
    [
      'The actor must remain the visual anchor.',
      'The shot should feel psychological, not goofy.',
      'Use the effect only for a beat where the emotion justifies it.',
    ],
    'technical',
    undefined,
    'Learning: Experimental camera setups work best when they are emotionally justified. The question is not “can I do this shot?” but “does this visual grammar express panic, dissociation, or overwhelm more clearly than a standard setup would?”'
  ),

  makeSeed(
    'Window Light Intimacy',
    'Naturalism',
    'Soft realism can still feel cinematic.',
    'Shoot a close emotional scene by a real window: someone reading a letter, recording a voice note, getting ready to leave, or trying not to cry.',
    'Train softness, shaping, and realistic intimacy.',
    'An intimate scene built around believable natural light.',
    [
      'Use only window light or a believable window-light imitation.',
      'Protect the eyes.',
      'The light must support vulnerability, not flatten the face.',
    ],
    'technical',
    undefined,
    'Learning: Window light is one of cinema’s great teachers because it encourages observation over forcing. Nykvist, Almendros, Lubezki, and Deakins all show how naturalistic light can still feel completely authored if it is shaped with sensitivity.'
  ),

  makeSeed(
    'Action Beat: Chase to Door',
    'Action',
    'Shoot speed and urgency without losing clarity.',
    'Film an action beat where a character runs toward a door, looks back, fumbles the handle, gets inside, and slams it shut. Use at least 1 wide, 2 medium shots, and 2 close details.',
    'Train readable action geography, screen direction, and pacing.',
    'A high-pressure scene where the audience always understands where the character is and what they need.',
    [
      'Keep screen direction clear.',
      'The audience must always understand where the door is in relation to the character.',
      'Use movement only when it improves urgency or clarity.',
    ],
    'scene',
    undefined,
    'Learning: In action, clarity is kindness. Great cinematographers and directors of action understand that geography must stay legible. Speed means little if the audience loses the objective.'
  ),

  makeSeed(
    'Frame the Power Shift',
    'Composition',
    'Change power through the frame itself.',
    'Shoot a 2-person scene where one person starts visually dominant and the other ends dominant. Show the shift through framing, spacing, and who controls the image.',
    'Train visual power dynamics.',
    'A scene with a visible compositional status shift.',
    [
      'Do not explain the shift in dialogue.',
      'Let framing and distance do the work.',
      'The change must be readable even with no sound.',
    ],
    'drill',
    undefined,
    'Learning: Composition can stage status. Who gets space, who gets height, who gets center, who gets light, who gets isolation — these are dramatic choices. Study paintings as well as films: power is often compositional before it is verbal.'
  ),

  makeSeed(
    'Lens for Paranoia',
    'Lens Psychology',
    'Use optics to create unease.',
    'Shoot a short paranoia scene in a corridor, stairwell, street, or empty room. Use focal length and camera distance to make the world feel either too exposed or too compressed.',
    'Train lens psychology and emotional spatial design.',
    'A scene where optics clearly support the mental state.',
    [
      'Lens choice must be intentional.',
      'Do not rely only on shaky camera.',
      'The emotional effect must come from image design, not just performance.',
    ],
    'technical',
    undefined,
    'Learning: Paranoia is often spatial. Wider lenses can make a world feel invasive or unstable; longer lenses can make it feel surveilled, flattened, and watched. Choose the optic that best externalises the inner state.'
  ),

  makeSeed(
    'Light Change as Turn',
    'Lighting',
    'Let light shift with the scene.',
    'Build a short scene where one motivated light change marks the emotional or narrative turn: blinds opening, fridge closing, TV switching off, lamp turning on, or a door opening to daylight.',
    'Train lighting as dramaturgy.',
    'A scene where light changes the beat.',
    [
      'The light shift must be motivated.',
      'The change must matter emotionally.',
      'Avoid gimmicky color changes.',
    ],
    'scene',
    undefined,
    'Learning: Light can be an event, not just a condition. Storaro especially demonstrates that color and light can carry dramatic transitions. Treat the change in light as a story beat with consequences.'
  ),

  makeSeed(
    'Claustrophobic Coverage',
    'Space',
    'Make the room feel tighter than it is.',
    'Shoot a scene in a small room, bathroom, car, or hallway where the emotional pressure increases as framing gets tighter and exits feel less available.',
    'Train spatial pressure and progressive visual tightening.',
    'A scene where the space closes in emotionally.',
    [
      'Let visual space tighten gradually.',
      'Do not only move closer randomly.',
      'Pressure must build from shot to shot.',
    ],
    'drill',
    undefined,
    'Learning: Claustrophobia is built through progression. Don’t just start tight — let the scene lose air. Coverage should feel like the world is reducing its options.'
  ),

  makeSeed(
    'Withhold the Face',
    'Withholding',
    'Delay identity while keeping the subject dramatically present.',
    'Shoot a scene where a key character is introduced only through hands, shoes, back of head, shadow, or reflection before their face is finally shown.',
    'Train partial information and reveal control.',
    'A scene with a controlled delayed face reveal.',
    [
      'No full face until it matters.',
      'The audience must still track the character clearly.',
      'The reveal must pay off.',
    ],
    'constraint',
    undefined,
    'Learning: Withholding identity can create tension, mythology, vulnerability, or curiosity. The trick is to keep the character dramatically alive before their face arrives. Partial information must still feel intentional and legible.'
  ),

  makeSeed(
    'Practical Neon Scene',
    'Stylized Lighting',
    'Use colored light boldly without losing readability.',
    'Shoot a short scene using visible colored practicals, LED strips, signs, monitor light, or a motivated colored source. Example: late-night phone call, post-party silence, or someone getting ready to leave.',
    'Train stylized realism.',
    'A scene with controlled color atmosphere.',
    [
      'Protect readability.',
      'Color must support story.',
      'Do not make it look accidental or muddy.',
    ],
    'technical',
    undefined,
    'Learning: Stylization works when it still feels governed. Think of Storaro, Christopher Doyle collaborations, Darius Khondji, and contemporary neon-driven work: color should have emotional logic, not just surface flash.'
  ),

  makeSeed(
    'Shot Sequence Without Coverage',
    'Intentional Design',
    'Commit to decisive images instead of collecting safety shots.',
    'Plan a short scene of 5–7 shots maximum and shoot only those shots. Example: someone comes home, discovers something missing, and leaves again.',
    'Train intention over safety.',
    'A scene built from a deliberate shot list.',
    [
      'No safety coverage mentality.',
      'Each shot must earn its place.',
      'The sequence must still cut together clearly.',
    ],
    'scene',
    undefined,
    'Learning: Strong cinematography starts in choice. Many great filmmakers avoid generic coverage because it weakens intention. Design images that do jobs, not just images that might be useful later.'
  ),

  makeSeed(
    'One-Take Geography',
    'Long Take',
    'Keep tension and space readable in one continuous shot.',
    'Stage and shoot a one-take scene in one room, corridor, or outdoor path where 2 people interact and the emotional dynamic changes without cutting.',
    'Train spatial clarity inside duration.',
    'A continuous-shot scene with readable geography and a clear emotional arc.',
    [
      'Geography must remain readable.',
      'The emotional arc must change.',
      'No one-take gimmick for its own sake.',
    ],
    'scene',
    undefined,
    'Learning: A long take should intensify time, not simply prove technique. Lubezki, van Hoytema, and many masters of duration use the unbroken shot to preserve behavioural truth and spatial pressure.'
  ),

  makeSeed(
    'Mirror Psychology',
    'Reflection',
    'Use reflections as emotional metaphor.',
    'Use mirrors or reflective surfaces to show divided identity, self-surveillance, vanity, fear, or emotional fracture.',
    'Train symbolic cinematography.',
    'A psychologically loaded scene built around reflection.',
    [
      'The reflection must mean something.',
      'Avoid empty prettiness.',
      'Tie it directly to character state.',
    ],
    'drill',
    undefined,
    'Learning: Mirrors are not automatically profound. They work when the image genuinely speaks to split identity, self-scrutiny, absence, vanity, or fracture. Use symbol through behaviour and framing, not through obviousness.'
  ),

  makeSeed(
    'Reveal Through Absence',
    'Withholding',
    'What is missing can land harder than what is present.',
    'Build a scene where the emotional hit comes from an absence: an empty chair, missing suitcase, no wedding ring, cleared-out room, or removed photograph.',
    'Train omission and discovery.',
    'A scene where the missing element becomes the reveal.',
    [
      'The absence must become the reveal.',
      'Do not over-explain.',
      'Build discovery visually.',
    ],
    'constraint',
    undefined,
    'Learning: Pain often enters cinema through what is no longer there. The frame can reveal loss by omission. This is where still photography, painting, and cinema meet: absence can become composition.'
  ),

  makeSeed(
    'Visual Irony',
    'Subtext',
    'Let the image quietly contradict the words.',
    'Shoot a scene where the frame undercuts what the character says or believes. Example: “I’m fine” in a wrecked room, “I trust you” through glass, or “I’m not leaving” beside a packed bag.',
    'Train visual irony.',
    'A scene with a strong image/subtext contradiction.',
    [
      'The contradiction must be readable.',
      'Do not underline it verbally.',
      'Keep it elegant.',
    ],
    'drill',
    undefined,
    'Learning: One of cinema’s strengths is that the image can argue with the dialogue. Let the frame carry subtext so the audience discovers the contradiction rather than being instructed to notice it.'
  ),

  makeSeed(
    'Low Light Truth',
    'Exposure',
    'Make darkness readable without making it muddy.',
    'Shoot a low-light night scene using one real practical source such as a bedside lamp, hallway spill, fridge light, laptop, candle, or streetlight through a window.',
    'Train exposure discipline in darkness.',
    'A low-light scene with controlled blacks and readable key information.',
    [
      'Avoid muddy darkness.',
      'Darkness must feel intentional.',
      'Protect the key information the audience needs to read.',
    ],
    'technical',
    undefined,
    'Learning: Darkness is shape, not failure. Gordon Willis, Bradford Young, Deakins, and others remind us that underexposure and mystery are meaningful only when the image still tells the story.'
  ),

  makeSeed(
    'Tension in the Wide',
    'Blocking',
    'Keep tension alive without rushing into close-ups.',
    'Shoot a tense 2-person scene mostly in wides or medium-wides: waiting for an answer, confronting someone, discovering a lie, or deciding whether to leave.',
    'Train composition and blocking under pressure.',
    'A scene where tension survives without close-up dependence.',
    [
      'Use space intelligently.',
      'Let blocking carry tension.',
      'Do not immediately cut close for every beat.',
    ],
    'scene',
    undefined,
    'Learning: Close-ups are powerful partly because they are not always necessary. Wides can hold tension if blocking, distance, and frame relationships are alive. Think like a painter staging figures in space.'
  ),

  makeSeed(
    'Image as Theme',
    'Thematic Visuals',
    'Turn a theme into visual language.',
    'Choose one theme — guilt, hunger, surveillance, loneliness, freedom, jealousy — and build a short scene where framing, light, objects, and space all reflect it.',
    'Train thematic image-making.',
    'A scene with clear thematic visuals.',
    [
      'The theme must show in images, not speech.',
      'Avoid obvious symbols only.',
      'Keep it cinematic and emotionally grounded.',
    ],
    'drill',
    undefined,
    'Learning: Theme becomes cinematic when it enters the frame repeatedly through choices of light, shape, space, and object. Painting is useful here: great painters organise theme visually long before cinema did.'
  ),

  makeSeed(
    'Silhouette Choice',
    'Shape',
    'Make shape tell the story before detail does.',
    'Build a short scene where silhouette is the clearest dramatic tool in at least 2 shots. Example: doorway hesitation, rooftop wait, corridor argument, or someone dressing to leave.',
    'Train shape-first visual storytelling.',
    'A scene using silhouette as part of the emotional design.',
    [
      'Silhouette must be clean.',
      'Shape must add meaning.',
      'Do not rely on it in every shot.',
    ],
    'technical',
    undefined,
    'Learning: Before the eye reads detail, it reads shape. John Alton, noir traditions, and many painters understood this deeply. Silhouette can make an image feel iconic, threatening, mournful, or lonely with extraordinary efficiency.'
  ),

  makeSeed(
    'Compression and Isolation',
    'Lens Choice',
    'Use optics to isolate the character from the world.',
    'Shoot a scene where focal length and background compression intensify loneliness, scrutiny, or pressure. Example: bus stop, pavement, park bench, train platform, or long corridor.',
    'Train emotional use of compression.',
    'A scene where lensing creates isolation.',
    [
      'Lens choice must be deliberate.',
      'Background should matter compositionally.',
      'The emotional effect must be felt.',
    ],
    'scene',
    undefined,
    'Learning: Compression can make the world feel crowded against the subject or flatten the distance between danger and the body. Use the lens to decide whether the world breathes around the character or presses in on them.'
  ),

  makeSeed(
    'Two Color Worlds',
    'Color Contrast',
    'Give two characters different visual worlds in the same scene.',
    'Light or frame a scene so each character feels visually aligned with a different emotional world: warm vs cold, lit vs shadowed, open vs trapped.',
    'Train contrast inside one location.',
    'A 2-person scene with strong visual duality.',
    [
      'Both worlds must be clear.',
      'Do not make it messy.',
      'The contrast must support story.',
    ],
    'technical',
    undefined,
    'Learning: Visual duality can create conflict before dialogue does. Storaro is an obvious reference for this, but so are many classical painters who set figures into opposing worlds of color and light inside the same canvas.'
  ),

  makeSeed(
    'Frame After the Action',
    'Patience',
    'Sometimes the strongest image comes just after the obvious beat.',
    'Hold a shot after the main action ends and let the aftermath become the point. Example: after the slap, after the goodbye, after the message is read, after the door closes.',
    'Train patience and aftermath imagery.',
    'A scene where the best frame happens after the expected moment.',
    [
      'Do not cut too early.',
      'The aftermath must matter.',
      'The hold must feel earned.',
    ],
    'drill',
    undefined,
    'Learning: Cinema often becomes most truthful in aftermath. Don’t always chase the action peak. Many great cinematographers and editors understand that the emotional image often comes one beat later.'
  ),

  makeSeed(
    'Reveal by Blocking',
    'Staging',
    'Let movement inside frame create the reveal.',
    'Design a shot where the reveal happens because someone enters, exits, sits down, opens a door, or shifts within the frame.',
    'Train internal reveal design.',
    'A scene where blocking, not cutting, reveals the key information.',
    [
      'Use movement inside the frame.',
      'Do not rely on an edit reveal.',
      'The reveal must change meaning immediately.',
    ],
    'scene',
    undefined,
    'Learning: Blocking is composition in time. A reveal created by movement inside the shot can feel more elegant because the frame itself becomes the storyteller. Think like theatre, painting, and cinema at once.'
  ),

  makeSeed(
    'Glass Barrier Scene',
    'Visual Subtext',
    'A barrier can become emotional architecture.',
    'Shoot a scene where glass, windows, mirrors, bus panels, or partitions emphasize emotional separation.',
    'Train environmental metaphor.',
    'A scene where transparent barriers add meaning.',
    [
      'The barrier must matter dramatically.',
      'Do not use it only decoratively.',
      'Keep the emotional read clear.',
    ],
    'scene',
    undefined,
    'Learning: Transparent barriers are powerful because they allow sight without access. This is a visual form of subtext: the characters can see, but cannot truly meet. Use architecture as psychology.'
  ),

  makeSeed(
    'Reveal the Room Slowly',
    'Worldbuilding',
    'Let the audience learn the space piece by piece.',
    'Build a scene where the room is understood gradually through details: photographs, packed boxes, dishes, toys, medicine, ashtray, open wardrobe, or a half-hidden object.',
    'Train spatial withholding and reveal.',
    'A scene with gradual environmental discovery.',
    [
      'Do not front-load everything.',
      'The reveals must feel motivated.',
      'The room should tell us something about the story.',
    ],
    'technical',
    undefined,
    'Learning: Rooms can function like portraits. Reveal the space the way a painter reveals character through environment: selectively, meaningfully, and with control over where the eye lands first.'
  ),

  makeSeed(
    'Cinematography Proof',
    'Mastery',
    'Show full visual authorship.',
    'Create one polished scene built around a specific scenario: 1) a one-room confrontation, 2) a reunion at a station or street corner, 3) a late-night discovery scene, 4) someone preparing to leave home, or 5) a silent emotional scene with no dialogue. Build it so framing, light, lensing, movement, and reveal all feel deliberate.',
    'Prove advanced cinematography control.',
    'A finished mini-scene with a strong visual identity.',
    [
      'Every image must feel chosen.',
      'No generic coverage mentality.',
      'The final look must feel authored.',
    ],
    'technical',
    undefined,
    'Learning: This is the integration rep. Bring together the lessons of cinematographers like Deakins, Storaro, Hall, Nykvist, Lubezki, Willis, van Hoytema, Fraser, Khondji, Young, and Savides — and remember that painters, photographers, architecture, theatre, and sculpture can all be part of your visual education.'
  ),
];
/* -------------------------------- DIRECTING -------------------------------- */
/* 35 unique non-boss lessons */
const DIRECTING_BASE: LessonSeed[] = [
  makeSeed(
    'Playable Verb Pass',
    'Foundations',
    'Learn to direct actors with actions, not vague emotions.',
    'Take a short 6–10 line scene. Direct it 3 times using 3 different playable actions for one actor: “to win over,” “to corner,” and “to disarm.” If you do not have a scene partner, perform both roles seriously and film each pass separately.',
    'Train the most important directing habit: giving actors playable direction instead of result direction like “be sad” or “make it intense.”',
    'Three versions of the same scene where the performance clearly changes because the note changes.',
    [
      'Use the exact same text all 3 times.',
      'Only the actor direction changes.',
      'Do not use vague notes like “more emotion.”',
    ],
    'technical',
    'If no actor is available, play both characters truthfully — not as a skit.',
    'Learning: This is one of the oldest and strongest directing principles. Elia Kazan, Mike Leigh, Sidney Lumet, and many actor-centered directors understood that actors play actions, not emotional results. “To persuade,” “to punish,” “to protect,” or “to seduce” gives behavior. “Be sad” usually gives acting.'
  ),

  makeSeed(
    'Silent Objective Scene',
    'Foundations',
    'Direct behavior before dialogue.',
    'Direct a silent scene built around one simple objective: keep them here, hide the truth, get forgiveness, stop them leaving, or make them admit something.',
    'Train clear visual direction without relying on lines.',
    'A silent scene where the audience clearly understands what one person wants.',
    [
      'No spoken dialogue.',
      'The objective must still read clearly.',
      'Use blocking, pauses, props, and eyelines to tell the story.',
    ],
    'drill',
    undefined,
    'Learning: Great directors know that dialogue is not the scene — behavior is. Ozu, Bresson, Claire Denis, Chantal Akerman, and Hirokazu Kore-eda all show that objective, rhythm, and physical action can carry story without explanatory speech.'
  ),

  makeSeed(
    'No-Inflection Line Reading',
    'Actor Technique',
    'Learn how direction creates life underneath plain text.',
    'Have an actor, or yourself, perform a short piece of dialogue in a plain neutral line-reading with minimal inflection. Then direct a second pass using only objective, circumstances, and behavior notes.',
    'Train the difference between dead recitation and directed performance.',
    'A before-and-after scene showing how direction creates life from neutral text.',
    [
      'Keep script and framing the same in both versions.',
      'Do not fix it by saying “add more emotion.”',
      'The second version must be changed through intention and behavior.',
    ],
    'technical',
    undefined,
    'Learning: This teaches a fundamental directing truth: text is not performance. Lumet, Kazan, and directors shaped by theatre rehearsal often worked from action, stakes, and circumstances. When the inner event is clear, the line usually finds its own sound.'
  ),

  makeSeed(
    'Private Note / Public Scene',
    'Actor Direction',
    'Give one actor hidden knowledge and let it shape the scene.',
    'Take a short 2-person scene. Give one performer a private note like “you already know they are lying,” “you are leaving tonight,” or “you need them to confess before the scene ends.” The other performer should not know the note.',
    'Train asymmetrical information and actor-specific direction.',
    'A short scene where hidden knowledge changes the atmosphere without being said directly.',
    [
      'Only one actor gets the secret note.',
      'Do not reveal the secret in dialogue.',
      'The audience should feel the imbalance before they can explain it.',
    ],
    'technical',
    undefined,
    'Learning: Directors like Mike Leigh and Cassavetes understood that asymmetry creates electricity. When one actor is living inside a different piece of truth, the scene often gains tension, mystery, and unpredictability without any added plot.'
  ),

  makeSeed(
    'Same Text, Two Different Scenes',
    'Scene Interpretation',
    'Direct the same writing into two completely different emotional events.',
    'Take one short scene and direct it twice: once as seduction, once as interrogation; once as grief, once as manipulation; or once as fear, once as flirtation.',
    'Train interpretation and prove the director changes meaning, not just coverage.',
    'Two distinct versions of the same scene with clearly different readings.',
    [
      'Use the exact same text both times.',
      'Change blocking, pace, silence, and actor notes.',
      'The audience must feel two different stories from the same words.',
    ],
    'scene',
    undefined,
    'Learning: This is pure directing authorship. Hitchcock, Bergman, Kubrick, Fincher, Haneke, Villeneuve, and Park Chan-wook would all shape identical words into radically different experiences because directing lives in interpretation, not just script delivery.'
  ),

  makeSeed(
    'Status Through Blocking',
    'Blocking',
    'Make power visible before it is spoken.',
    'Direct a short 2-person scene where one character starts dominant and the other ends dominant. Use standing vs sitting, control of the door, distance, crossing, and eye-line height.',
    'Train power design through physical staging.',
    'A scene with a clear status reversal.',
    [
      'Do not explain the shift in dialogue.',
      'The status change must be visible physically.',
      'Every move must mean something.',
    ],
    'drill',
    undefined,
    'Learning: Blocking is social power in motion. Kurosawa, Welles, Spielberg, Scorsese, Bong Joon Ho, and David Mamet all understand in different ways that status can be staged before it is spoken. Who occupies space? Who yields space? Who controls exits?'
  ),

  makeSeed(
    'Entrance Tells the Story',
    'Character Arrival',
    'Direct a character entrance that instantly communicates who they are.',
    'Stage one entrance and direct it 3 ways: ashamed, dangerous, charming, exhausted, grieving, or furious. Use the same door, corridor, or room entry each time.',
    'Train immediate character communication.',
    'Three entrance clips where the character meaning is clear in the first few seconds.',
    [
      'Use the same entrance path each time.',
      'Only direction, timing, posture, and environment interaction should change the read.',
      'No explanatory voiceover.',
    ],
    'drill',
    undefined,
    'Learning: Great directors know first impressions matter. Think of how Coppola, Tarantino, PTA, Almodóvar, or De Palma introduce a character: pace, silence, body, and relation to the room tell the story before exposition does.'
  ),

  makeSeed(
    'Object as Scene Engine',
    'Objects',
    'Direct a whole scene around one object whose meaning changes.',
    'Choose one object — phone, glass, ring, key, envelope, packed bag, knife, photograph, or coat — and build a scene where the object’s meaning changes over the course of the scene.',
    'Train prop-centered direction.',
    'A scene where the object becomes the emotional engine.',
    [
      'The object must matter in every beat.',
      'Its meaning must shift by the end.',
      'Do not use it as decoration.',
    ],
    'scene',
    undefined,
    'Learning: Great directors often build scenes around objects because objects concentrate desire, memory, threat, or guilt. Think of Ozu, Hitchcock, Bergman, Kieslowski, and Kore-eda: an object can become the scene’s emotional center if you direct everyone’s relation to it clearly.'
  ),

  makeSeed(
    'One Actor, Two Roles',
    'Solo Directing',
    'Direct one performer playing both sides of a serious scene.',
    'If you cannot find a partner, direct and film one actor performing both characters in a dramatic scene. Build each role with its own objective, rhythm, eye-line, and physical life.',
    'Train solo scene construction and character separation.',
    'A 2-character scene played by one performer where both characters feel specific and real.',
    [
      'Both characters must be taken completely seriously.',
      'Differentiate them through intention, not comedy.',
      'Eyelines and timing must stay believable.',
    ],
    'technical',
    'This is not a gimmick challenge. Treat both roles like proper cast characters.',
    'Learning: The directing lesson here is distinction through objective and behavior, not costume tricks. Directors working with doubling, split selves, or mirrored characters know that separation comes from inner logic, not from external gimmick alone.'
  ),

  makeSeed(
    'Watcher in the Room',
    'Pressure',
    'A silent third person should alter the whole scene.',
    'Direct a scene between 2 people while a third person watches silently. The watcher may sit, clean, smoke outside a doorway, scroll a phone, or fold clothes. Their presence must change the dynamic.',
    'Train triangulation, social pressure, and room tension.',
    'A scene where the silent watcher matters as much as the speakers.',
    [
      'The watcher speaks little or not at all.',
      'Eyelines must matter.',
      'The pressure must be visible before anyone names it.',
    ],
    'drill',
    undefined,
    'Learning: Directors like Altman, Kore-eda, Bergman, and Haneke understand that a room is rarely just a pair. A silent third body can create shame, surveillance, status pressure, or emotional distortion without saying a word.'
  ),

  makeSeed(
    'Interruption Rhythm',
    'Rhythm',
    'Direct a scene whose energy comes from interruption.',
    'Build a short scene where interruption is the engine: unfinished sentences, cut-offs, blocked exits, repeated attempts to leave, or someone refusing to let the scene settle.',
    'Train rhythm and escalation.',
    'A scene with clear pressure built through interruption.',
    [
      'The interruptions must mean something emotionally.',
      'Do not make the overlap unreadable.',
      'The scene must escalate rather than stay flat.',
    ],
    'scene',
    undefined,
    'Learning: Rhythm is one of directing’s invisible powers. Cassavetes, Lumet, Sorkin-directed work, Mike Nichols, and Scorsese all show that interruption can be used to create urgency, intimacy, chaos, or domination. Overlap must still be intelligible and purposeful.'
  ),

  makeSeed(
    'Chair Logic',
    'Blocking',
    'Use furniture to reveal social hierarchy and discomfort.',
    'Direct a scene around who sits, who stands, who circles, who leans, and who refuses to settle. Example settings: kitchen apology, bedroom confrontation, office accusation, hospital waiting room.',
    'Train directors to think physically and socially.',
    'A scene where furniture use reveals power and discomfort.',
    [
      'Every seated or standing choice must mean something.',
      'At least one shift in position must change the power.',
      'Avoid random wandering.',
    ],
    'technical',
    undefined,
    'Learning: Furniture is blocking architecture. Ozu, Bergman, Kazan, and many theatre-trained directors understood that sitting, standing, leaning, and refusing to settle are dramatic choices. If a character sits, ask why now.'
  ),

  makeSeed(
    'Conflicting Objectives',
    'Conflict',
    'Make both characters want something concrete and incompatible.',
    'Direct a 2-person scene where each character wants a different outcome: stay vs leave, confess vs avoid, forgive vs punish, tell truth vs keep peace.',
    'Train active scene conflict.',
    'A scene where both objectives stay alive from start to finish.',
    [
      'Both objectives must be specific.',
      'Avoid passive conversation.',
      'The conflict must sharpen by the end.',
    ],
    'scene',
    undefined,
    'Learning: This is basic but essential. Great dramatic directing usually begins with incompatible wants. Kazan, Lumet, Leigh, Fincher, and Asghar Farhadi all build scenes on strong opposing objectives rather than generalized mood.'
  ),

  makeSeed(
    'Subtext Under Ordinary Dialogue',
    'Subtext',
    'Direct what the scene is really about, not just what is said.',
    'Use ordinary text — making tea, discussing a taxi, talking about dinner, folding clothes, asking about tomorrow — and direct it so the real scene underneath is betrayal, jealousy, grief, fear, or desire.',
    'Train subtext direction.',
    'A scene where the hidden conflict is unmistakable.',
    [
      'The spoken text must stay ordinary.',
      'The real scene must live underneath.',
      'Do not explain the subtext aloud.',
    ],
    'scene',
    undefined,
    'Learning: Some of the best directors understand that ordinary speech can carry extraordinary pressure. Ozu, Pinter-based work, Bergman, Farhadi, and many modern naturalists let daily language hold deeper conflict. The scene is underneath the words.'
  ),

  makeSeed(
    'Opposite Notes for Each Actor',
    'Actor Direction',
    'Let contradiction generate electricity.',
    'Take a 2-person scene and give each actor a contradictory private note. Example: Actor A “comfort them,” Actor B “make them regret coming.” Or Actor A “keep peace,” Actor B “force the truth.”',
    'Train layered direction and contradiction.',
    'A scene where tension rises because each performer is living in a different strategy.',
    [
      'Each note must be playable.',
      'Do not tell both actors the same thing.',
      'The contradiction must be felt clearly.',
    ],
    'technical',
    undefined,
    'Learning: Directing gets richer when notes are individualized. Great scene directors often avoid giving both actors the same emotional instruction. Contradictory actions generate friction, surprise, and behavior that feels alive.'
  ),

  makeSeed(
    'Rehearsal Discovery Pass',
    'Process',
    'Use rehearsal to discover the real scene.',
    'Take a short scene. Rehearse it loosely first. Then rewrite your blocking and actor notes based on what actually felt alive during rehearsal before filming the real take.',
    'Train responsive directing instead of rigid pre-deciding.',
    'A filmed scene clearly improved by rehearsal discoveries.',
    [
      'Do not lock blocking too early.',
      'Keep what felt truthful in rehearsal.',
      'The final version must reflect discovery, not just original planning.',
    ],
    'drill',
    undefined,
    'Learning: Many great directors discover rather than impose. Mike Leigh, Cassavetes, Lumet, and even highly controlled filmmakers at times use rehearsal to find behavior the script alone did not reveal. Preparation matters, but rigidity can kill life.'
  ),

  makeSeed(
    'Silence as Turning Point',
    'Silence',
    'Make one silence do more work than all the dialogue around it.',
    'Direct a scene where one long silence becomes the actual turning point. Example: after “I know,” before a goodbye, after an accusation, or before someone opens the door.',
    'Train restraint and beat control.',
    'A scene structured around one decisive silence.',
    [
      'The silence must be earned.',
      'Do not fill it with pointless fidgeting.',
      'The room must feel changed after the silence.',
    ],
    'drill',
    undefined,
    'Learning: Bergman, Ozu, Antonioni, Haneke, and Villeneuve all understand the force of silence. Silence is not empty time; it is a container for pressure, thought, shame, or decision. Direct the silence as precisely as the line.'
  ),

  makeSeed(
    'Scene Reinterpretation I: Hidden Power',
    'Scene Interpretation',
    'Turn one short script into a power struggle without changing the words.',
    `Direct this short scene without watching any reference version.

INT. WAITING ROOM – NIGHT

ELIAS
You came.

MARA
You said it mattered.

ELIAS
It does.

MARA
Then stop talking like I still have time.

Direct Version A as seduction.
Direct Version B as interrogation.`,
    'Train interpretation, actor notes, blocking, and tonal authorship.',
    'Two filmed versions of the same scene with clearly different meanings.',
    [
      'Do not change the dialogue.',
      'Change the meaning through direction only.',
      'Use different blocking, pace, distance, and actor notes in each version.',
    ],
    'scene',
    undefined,
    'Learning: This is where direction becomes viewpoint. Hitchcock, Fincher, Park Chan-wook, Claire Denis, and Almodóvar could turn the same text into seduction, danger, pity, or threat through staging and rhythm alone.'
  ),

  makeSeed(
    'Fear Without Monster',
    'Suspense',
    'Direct suspense without relying on spectacle.',
    'Create a suspense scene where the threat is mostly implied: a sound outside the door, someone approaching, a missing item, a power cut, or a person who should not be there.',
    'Train tension without showing too much.',
    'A suspense scene built around expectation and dread.',
    [
      'Do not over-show the threat.',
      'Use performance and blocking to build fear.',
      'Keep the audience leaning forward.',
    ],
    'scene',
    undefined,
    'Learning: Hitchcock’s lessons on suspense still matter: what the audience anticipates can be more powerful than what they see. Spielberg, Friedkin, Kiyoshi Kurosawa, and modern suspense directors often build dread from implied presence, not spectacle.'
  ),

  makeSeed(
    'One-Room Escalation',
    'Architecture',
    'Make a small space grow dramatically.',
    'Direct a scene in one room where tension escalates through blocking, rhythm, and shifting objectives. Example: kitchen breakup, dressing-room accusation, rehearsal-room betrayal.',
    'Train limitation-based scene growth.',
    'A one-room scene that does not feel static.',
    [
      'One room only.',
      'Each beat must intensify or pivot.',
      'Avoid repetitive staging.',
    ],
    'technical',
    undefined,
    'Learning: Great directors can turn limited space into dramatic advantage. Think of Lumet, Polanski, Bergman, and many chamber-drama filmmakers: when the room cannot expand, pressure must.'
  ),

  makeSeed(
    'Directing for the Cut',
    'Coverage Strategy',
    'Shoot with editorial purpose instead of collecting random coverage.',
    'Plan a short scene knowing exactly where the edit should bite hardest. Decide beforehand which line, look, movement, or silence deserves the close-up or the cut.',
    'Train coverage as storytelling rather than safety.',
    'A scene where the coverage clearly supports the final emotional cut points.',
    [
      'Every angle must have a reason.',
      'Do not collect generic wide-medium-close coverage.',
      'Know where the emotional cuts belong before you shoot.',
    ],
    'technical',
    undefined,
    'Learning: Directors like Hitchcock, Fincher, PTA, Soderbergh, and the Coens often shoot with the cut already in mind. Coverage is not insurance first — it is editorial argument.'
  ),

  makeSeed(
    'Ensemble Pressure',
    'Ensemble',
    'Direct 3 or more people so the whole room stays alive.',
    'Direct a scene with at least 3 on-screen people where tension exists even when only 2 are talking. Give background behavior to everyone that affects the dynamic.',
    'Train ensemble staging.',
    'An ensemble scene where every body in the room matters.',
    [
      'Use every actor intentionally.',
      'Background behavior must mean something.',
      'The room dynamic must stay alive at all times.',
    ],
    'scene',
    undefined,
    'Learning: Altman, Renoir, Scorsese, Bong Joon Ho, and Anderson-style ensemble work remind directors that a room does not go dead just because one person speaks. Every body contributes to social weather.'
  ),

  makeSeed(
    'Direct the Camera Operator',
    'Collaboration',
    'Communicate emotional intention to camera, not just actors.',
    'Work with a cinematographer, or direct your own camera, on a scene where the frame strategy changes with the emotional beat: distance, angle, movement, stillness, or withholding.',
    'Train collaboration between directing and camera.',
    'A scene where camera choices clearly support your scene interpretation.',
    [
      'The camera strategy must change with the scene beats.',
      'Do not use movement just because it looks nice.',
      'Every frame choice must support the emotional read.',
    ],
    'technical',
    undefined,
    'Learning: Great directing is collaborative design. Kubrick, Spielberg, Kurosawa, Villeneuve, Fincher, and many others understood that camera is not coverage machinery; it is part of the scene’s thought process.'
  ),

  makeSeed(
    'Contradictory Scene Surface',
    'Interpretation',
    'Direct a scene where behavior and text are in conflict.',
    'Create a scene where the dialogue is polite but the actual behavior is punishing, where the words are calm but the room feels dangerous, or where the text sounds romantic but the scene is really about control.',
    'Train tonal contradiction.',
    'A scene where the surface and the truth clearly clash.',
    [
      'Do not explain the contradiction aloud.',
      'The audience must feel the real scene underneath.',
      'Keep it truthful, not theatrical.',
    ],
    'scene',
    undefined,
    'Learning: Many of the best directors understand tonal contradiction. Polite words with dangerous behavior, calm rooms with violent subtext, tenderness mixed with control — these contradictions often create the most alive scenes.'
  ),

  makeSeed(
    'Scene Reinterpretation II: Abandonment',
    'Scene Interpretation',
    'Direct a text as two completely different endings.',
    `Direct this short scene without reference.

INT. SMALL KITCHEN – MORNING

MAYA
You’re up early.

ROWAN
Couldn’t sleep.

MAYA
You packed.

ROWAN
I folded things.

MAYA
That’s not better.

Version A: direct it as a breakup.
Version B: direct it as two people hiding from something outside.`,
    'Train interpretive authorship and scene architecture.',
    'Two different versions of the same scene with totally different stakes.',
    [
      'Use the exact same dialogue both times.',
      'Change the scene through blocking, pauses, props, and actor notes.',
      'The audience must understand the reinterpretation without explanation.',
    ],
    'scene',
    undefined,
    'Learning: This is a directing laboratory. Different directors reveal themselves most clearly in how they assign stakes to the same material. One text can become intimate, political, fearful, absurd, or tragic depending on interpretation.'
  ),

  makeSeed(
    'Misdirect the Audience',
    'Interpretation',
    'Make the audience read the scene one way first, then realize they were wrong.',
    'Direct a short scene where the viewer initially thinks one person is guilty, vulnerable, in love, or in control, then slowly realizes the truth is different.',
    'Train directorial misdirection.',
    'A scene with a later reinterpretation beat.',
    [
      'The first read must be believable.',
      'The second read must feel earned.',
      'Do not cheat the audience.',
    ],
    'scene',
    undefined,
    'Learning: Hitchcock is the obvious influence here, but many directors use honest misdirection. The first reading must be fully supported, and the second must deepen the scene rather than merely “trick” the audience.'
  ),

  makeSeed(
    'Shot Design as Opinion',
    'Visual Direction',
    'Your directing view should exist in the shot plan itself.',
    'Take a short scene and design a shot sequence that reflects your interpretation: boxed-in close-ups, withheld faces, wide humiliation, creeping approach, trapped over-shoulders, or a static frame that refuses relief.',
    'Train total-scene authorship.',
    'A finished scene where the shot design clearly reflects your view of the material.',
    [
      'Every frame must point the same way.',
      'Do not stage it neutrally.',
      'The visual plan should reveal your interpretation before dialogue explains it.',
    ],
    'technical',
    undefined,
    'Learning: Direction is opinion. Directors like Hitchcock, Kubrick, Fincher, Wong Kar Wai, Kieslowski, and Haneke all prove that shot design can itself contain the interpretation. Don’t neutralize the scene visually and hope the actors do the rest.'
  ),

  makeSeed(
    'Directing Shame',
    'Subtle Emotion',
    'Direct a scene whose engine is shame, not anger.',
    'Build a scene where shame shapes posture, pace, eye-line, silence, and physical distance. Example: being found out, returning something, being seen after failure, asking for help.',
    'Train subtle emotional orchestration.',
    'A scene where shame is the dominant emotional force.',
    [
      'Keep it specific and quiet.',
      'Do not over-explain.',
      'Let body language carry the weight.',
    ],
    'scene',
    undefined,
    'Learning: Shame is highly physical and often anti-performative. Bergman, Farhadi, Leigh, and many intimate directors understand that shame is often more about collapse of gaze, hesitation, distance, and timing than open display.'
  ),

  makeSeed(
    'Space as Power',
    'Blocking',
    'Change power by changing physical distance.',
    'Direct a scene where shrinking distance increases control, or increased distance becomes the victory. Build the scene around who approaches, who retreats, and who stops moving first.',
    'Train spatial storytelling.',
    'A scene where the power dynamic is clear from spacing alone.',
    [
      'Track distance carefully.',
      'Do not explain the power shift in dialogue.',
      'The space must tell the story.',
    ],
    'drill',
    undefined,
    'Learning: Distance is one of directing’s cleanest power tools. Kurosawa, Spielberg, Bergman, and many classical directors understand that a step forward, a refusal to step back, or a held distance can become the scene’s argument.'
  ),

  makeSeed(
    'Offscreen Character Pressure',
    'Presence',
    'Someone not in frame can still dominate the scene.',
    'Direct a scene where an unseen person strongly affects everyone on screen: someone upstairs, someone outside the door, someone on the phone, someone expected to arrive, or someone who has just left the room.',
    'Train offscreen dramatic presence.',
    'A scene where the unseen character matters heavily.',
    [
      'The offscreen person must shape behavior.',
      'Do not show them directly.',
      'The pressure must be clear even without seeing them.',
    ],
    'scene',
    undefined,
    'Learning: Directors like Hitchcock, Ozu, Haneke, and horror or suspense masters know that offscreen space is active dramatic territory. The unseen person can dominate the room if everyone behaves in relation to them.'
  ),

  makeSeed(
    'Scene Begins Late',
    'Structure',
    'Drop the audience into pressure immediately.',
    'Direct a scene that starts after the expected beginning. Skip the warm-up. The emotional event is already underway when the camera starts.',
    'Train late-entry scene design.',
    'A scene that feels alive from frame one.',
    [
      'Do not over-explain the missing beginning.',
      'The audience should catch up fast.',
      'The tension must already exist in the first shot.',
    ],
    'technical',
    undefined,
    'Learning: Many strong directors enter scenes late because life rarely begins at the cleanest explanatory point. Lumet, Fincher, PTA, and many sharp screen storytellers trust the audience to catch up to pressure already in motion.'
  ),

  makeSeed(
    'Scene Ends Early',
    'Structure',
    'Leave before the expected explanation.',
    'Direct a scene that cuts away at the strongest point instead of explaining the aftermath. End on the look, the breath, the object, the exit, or the silence that contains the scene.',
    'Train ending judgment.',
    'A scene with a bold, well-chosen endpoint.',
    [
      'Do not linger too long.',
      'The audience should still feel complete.',
      'End on the strongest beat, not after it.',
    ],
    'constraint',
    undefined,
    'Learning: Ending too late is one of the easiest directing mistakes. Directors from Ozu to Fincher to the Coens often leave on the charged image or unresolved beat, trusting the audience to carry the scene forward internally.'
  ),

  makeSeed(
    'Public Mask / Private Emergency',
    'Behavior',
    'Direct the split between social behavior and inner collapse.',
    'Create a scene in a public place — hallway, café, street corner, shop, train platform — where one character must appear normal while privately falling apart.',
    'Train social masking on screen.',
    'A scene where public behavior and private truth coexist.',
    [
      'The public mask must stay believable.',
      'The private crisis must still read.',
      'Do not let it become melodramatic.',
    ],
    'drill',
    undefined,
    'Learning: Great social scenes often depend on split behavior. Directors like Leigh, Kore-eda, Farhadi, and many modern realists understand that pressure becomes richer when the character must obey public rules while privately breaking.'
  ),

  makeSeed(
    'Directing the Reveal Beat',
    'Tension',
    'A reveal is not just information — it is timing and aftermath.',
    'Direct a scene built around one reveal. It could be a phone showing a message, a found object, a wrong name, a hidden bag, or a sentence like “I already knew.” Stage the reactions as carefully as the reveal itself.',
    'Train reveal orchestration.',
    'A reveal scene where the timing of who knows what matters.',
    [
      'The reveal must change the room.',
      'Reaction timing must matter.',
      'Do not rush the aftermath.',
    ],
    'scene',
    undefined,
    'Learning: Great reveal scenes are not about the line or object alone. Hitchcock, Fincher, Villeneuve, and many precise directors understand that the room after the reveal is as important as the reveal itself.'
  ),

  makeSeed(
    'Interpretation Proof Scene',
    'Mastery',
    'Take a short script and make it unmistakably yours.',
    'Choose or write a short 8–16 line scene and direct it so nobody could mistake it for a neutral reading. Every blocking choice, note, prop, and camera choice should point toward one strong interpretation.',
    'Prove you can turn text into viewpoint.',
    'A polished short scene with a distinct directorial identity.',
    [
      'Make a strong choice.',
      'Avoid playing it neutral.',
      'Everything should feel guided.',
    ],
    'drill',
    undefined,
    'Learning: This is where directors separate themselves. Strong directing is not coverage plus performance; it is viewpoint. The scene should feel shaped by your reading, not merely recorded.'
  ),

  makeSeed(
    'Directing Master Proof',
    'Mastery',
    'Show full control of actors, blocking, rhythm, and interpretation.',
    'Create a finished scene where objectives, actor notes, power shifts, shot design, and pacing all work together. Include at least one silence, one blocking shift, and one clear reinterpretation choice.',
    'Prove advanced directing control.',
    'A polished mini-scene with clear authorship.',
    [
      'No generic coverage collection.',
      'The turn must land.',
      'The whole scene must feel directed, not merely captured.',
    ],
    'technical',
    undefined,
    'Learning: This is the integration rep. Bring together lessons from Kazan, Lumet, Hitchcock, Bergman, Kurosawa, Ozu, Cassavetes, Kubrick, Coppola, Scorsese, Spielberg, Fincher, PTA, Bong, Villeneuve, Farhadi, Haneke, Denis, Almodóvar, Leigh, Nichols, and others: objectives, behavior, rhythm, space, point of view, and consequence.'
  ),

  makeSeed(
    'Directing the Final Image',
    'Mastery',
    'Build the entire scene toward one final image that contains the meaning.',
    'Direct a short scene where the final frame is clearly the strongest image in the piece: empty chair, open door, packed bag, hand not taken, person left alone in the frame, object left behind, or a face finally revealed.',
    'Train directors to build toward a decisive visual ending.',
    'A scene with a final shot that feels earned and memorable.',
    [
      'The ending image must be planned before you shoot.',
      'Everything before it should build toward it.',
      'Do not let the scene fade out weakly.',
    ],
    'technical',
    undefined,
    'Learning: Many great directors build scenes toward one final visual sentence. Think of Bergman, Ozu, Hitchcock, Spielberg, Coppola, Fincher, and Villeneuve: the last image can contain the scene’s meaning more powerfully than extra dialogue ever could.'
  ),
];
/* -------------------------------- SOUND -------------------------------- */
/* 35 unique non-boss lessons */
const SOUND_BASE: LessonSeed[] = [
  makeSeed(
    'Clean Dialogue First',
    'Foundation',
    'Before style, make speech clean and watchable.',
    'Take a dialogue clip you shot yourself — even just one person saying 4 to 6 lines in a quiet room — and make the dialogue sound clean, even, and easy to follow from start to finish.',
    'Train the first rule of sound post: the audience must understand the words before they admire the sound design.',
    'A dialogue clip with consistent clarity and level.',
    [
      'Use room tone underneath any dialogue edits.',
      'Remove obvious background distractions if possible.',
      'The voice must stay natural, not over-processed.'
    ],
    'technical',
    'If the dialogue is unclear, nothing built on top of it will matter.',
    'Learning: This is the foundation of professional sound post. However imaginative the design becomes, speech clarity usually comes first because story and performance ride on intelligibility. Clean dialogue is not “boring” sound work — it is what makes every later sound choice matter.'
  ),
  makeSeed(
    'Room Tone Stitch',
    'Foundation',
    'Make invisible dialogue edits by filling the air.',
    'Record 20–30 seconds of room tone in one location, then cut together a short 3-line dialogue exchange and use that room tone underneath every edit so the background does not jump or disappear.',
    'Train one of the most basic professional habits in post: using room tone to hide cuts and preserve continuity.',
    'A dialogue scene with smooth, invisible background continuity.',
    [
      'Use one location only.',
      'The background sound must not disappear between lines.',
      'No music allowed.'
    ],
    'technical',
    undefined,
    'Learning: Real rooms are never empty. Professional dialogue editing depends on continuous air, hum, and subtle environmental texture so cuts do not “hole-punch” the soundtrack. Room tone is one of the least glamorous but most essential habits in post.'
  ),
  makeSeed(
    'L-Cut the Argument',
    'Dialogue Flow',
    'Let emotion spill over the cut.',
    'Film or find a short argument scene, then rebuild it using at least 3 L-cuts so one person’s line continues briefly over the other person’s reaction shot.',
    'Train smoother dramatic dialogue editing through split edits.',
    'An argument scene that feels more fluid and emotionally alive after the re-edit.',
    [
      'Use at least 3 L-cuts.',
      'Every overlap must improve rhythm or tension.',
      'Do not let the overlap confuse who is speaking.'
    ],
    'technical',
    undefined,
    'Learning: Split edits are not just technical polish. They are emotional steering. When sound carries across the picture cut, the audience often experiences reaction and line as one flowing dramatic event instead of two separated pieces.'
  ),
  makeSeed(
    'J-Cut the Entrance',
    'Dialogue Flow',
    'Let the next moment arrive through sound first.',
    'Build a short sequence where we hear the next location, person, TV, club, train, or threat before we cut to it. Use at least 2 J-cuts to pull the audience forward.',
    'Train anticipatory audio and smoother scene transitions.',
    'A sequence where sound leads the audience into the next image.',
    [
      'Use at least 2 J-cuts.',
      'The audience must understand the geography of the transition.',
      'Do not use the J-cut just for decoration.'
    ],
    'technical',
    undefined,
    'Learning: Sound can lead the eye. A good J-cut makes the next image feel inevitable before it appears. This is one of the cleanest ways to create continuity, anticipation, or dread without visually forcing the transition.'
  ),
  makeSeed(
    'Foley a Mug Scene',
    'Foley',
    'Make ordinary objects feel cinematic.',
    'Film or use a short close-up scene of someone making tea or coffee: mug placed down, spoon stirring, cupboard opening, kettle pouring, chair movement, breath, cloth. Strip the original production sound if needed and rebuild the entire scene with fresh foley.',
    'Train sync, detail, and tactile realism.',
    'A domestic sequence rebuilt almost entirely from foley.',
    [
      'Include at least 8 separate synced sounds.',
      'No music allowed.',
      'The final scene should feel richer than the raw audio.'
    ],
    'drill',
    undefined,
    'Learning: Ben Burtt’s work is a reminder that memorable sound often begins with concrete, tactile recorded sources. Foley makes the physical world legible and sensuous. Tiny sounds — ceramic, cloth, metal, breath — can make ordinary action feel alive and cinematic.'
  ),
  makeSeed(
    'Footstep Character',
    'Character',
    'Build a person through the way they move.',
    'Create 3 different sets of footsteps crossing the same space: one confident, one exhausted, one frightened. You can show the person or keep them offscreen, but the audience must hear the difference in character.',
    'Train performance through sound detail.',
    'A comparison or sequence where footsteps clearly imply emotional state.',
    [
      'Use the same floor or surface if possible.',
      'Change rhythm, weight, pace, and texture.',
      'Do not rely on music to explain the difference.'
    ],
    'drill',
    undefined,
    'Learning: Sound can perform character. Weight, tempo, hesitation, drag, heel pressure, and surface interaction all create psychology. A strong sound artist treats footsteps as behavior, not generic background noise.'
  ),
  makeSeed(
    'Cut the Music on the Realisation',
    'Music Dynamics',
    'Let the absence of music become the punch.',
    'Build a short dramatic scene with music already playing underneath. At the exact moment a character realises something painful, humiliating, or dangerous, cut the music completely instead of fading it out.',
    'Train dramatic subtraction and timing.',
    'A scene where the music stop creates the emotional impact.',
    [
      'The music must already be established before the cut.',
      'Do not fade the music out.',
      'The silence or near-silence after the cut must feel intentional.'
    ],
    'scene',
    undefined,
    'Learning: One of the strongest sound principles is subtraction. Sound design is not only about what you add, but what you remove. A music stop can force the audience to confront the naked event more directly than a swelling cue ever could.'
  ),
  makeSeed(
    'End the Song Mid-Line',
    'Source Music',
    'Interrupt comfort with a hard stop.',
    'Use a scene with diegetic music coming from a radio, speaker, headphones, TV, or car. Cut the song off halfway through a lyric or musical phrase at the most awkward or dramatic moment.',
    'Train source-music interruption as storytelling.',
    'A scene where cutting the music mid-phrase changes the emotional temperature instantly.',
    [
      'The music must clearly come from within the scene.',
      'The cut-off point must feel dramatic, not random.',
      'The room tone after the stop must still feel alive.'
    ],
    'scene',
    undefined,
    'Learning: Source music can function like a character in the room. Interrupting it mid-thought can feel brutal, embarrassing, funny, or threatening depending on context. The stop should alter the social or emotional atmosphere immediately.'
  ),
  makeSeed(
    'Club Bathroom Perspective',
    'Perspective',
    'Make the same song feel physically located in space.',
    'Build a short sequence that starts near loud music — party, club, rehearsal room, car outside a venue — then move into a bathroom, hallway, stairwell, or side room where the same song becomes distant, muffled, and bass-heavy.',
    'Train EQ, filtering, level, and perspective shifts.',
    'A sequence where one song clearly changes with location.',
    [
      'The music must sound full in one place and filtered in another.',
      'Use EQ or muffling, not just lower volume.',
      'The audience should always understand where they are.'
    ],
    'technical',
    undefined,
    'Learning: Perspective sound is architecture. Volume alone is not enough; filtering, reflections, bass carry, and loss of detail help the audience understand walls, doors, distance, and material space. Good sound perspective makes geography feel physical.'
  ),
  makeSeed(
    'Breath as Score',
    'Intimacy',
    'Replace music with the body.',
    'Take a close emotional scene — crying held back, panic rising, someone preparing to confess something — and build it so breath, mouth noise, clothing movement, and tiny body sounds carry the emotional tension instead of score.',
    'Train intimacy and body-led sound design.',
    'A scene where body sound replaces underscore.',
    [
      'No music allowed.',
      'Keep the breaths natural, not theatrical.',
      'At least 4 subtle body sounds must be audible.'
    ],
    'scene',
    undefined,
    'Learning: Randy Thom often emphasizes that sound should serve story and feeling, not behave like decorative wallpaper. Body sound can become the score when the audience needs access to vulnerability, panic, secrecy, or proximity.'
  ),
  makeSeed(
    'Phone Speaker Reality',
    'Processing',
    'Make clean sound feel like a device, not a clean recording.',
    'Record a short voicemail, speakerphone call, or video message and process it so it genuinely sounds like it is coming through a phone speaker in a room.',
    'Train EQ, bandwidth limiting, and source realism.',
    'A scene where device audio feels believable and physically placed.',
    [
      'Use one device type only.',
      'Do not just make it “bad quality.”',
      'The device sound must still be understandable.'
    ],
    'technical',
    undefined,
    'Learning: Source realism is specific. A phone speaker, laptop, intercom, and cheap TV do not all fail in the same way. Good processing is about believable bandwidth, resonance, and placement, not simply degrading the sound.'
  ),
  makeSeed(
    'Old Radio / Old Film Voice',
    'Processing',
    'Make a voice feel historically or physically limited.',
    'Take a clean line of dialogue and make it sound like it is coming from an old radio, old TV broadcast, tape recorder, security camera speaker, or damaged archive reel.',
    'Train source-specific processing choices.',
    'A processed line or exchange with convincing character.',
    [
      'Choose only one source format.',
      'The processing must fit that source specifically.',
      'Avoid making it muddy beyond comprehension.'
    ],
    'technical',
    undefined,
    'Learning: Texture is storytelling. Historical or limited playback has its own frequency shape, distortion, instability, and mechanical identity. Choose one playback logic and build toward it precisely rather than making the sound generically “old.”'
  ),
  makeSeed(
    'Crowd From Nothing',
    'Worldbuilding',
    'Create a room full of people who were never filmed.',
    'Take a simple one- or two-person café, bar, classroom, restaurant, or house-party scene and build a believable crowd around it using walla, chairs, cutlery, glasses, laughter, footsteps, and distant speech.',
    'Train crowd layering and social-space realism.',
    'A scene that feels populated without becoming muddy.',
    [
      'Use at least 5 crowd or room layers.',
      'Dialogue must remain understandable.',
      'The crowd must feel like a place, not generic noise.'
    ],
    'scene',
    undefined,
    'Learning: A crowd is not one sound. It is a moving social bed of many layers, distances, and textures. Good worldbuilding uses selective detail so the place feels populated without smothering the dramatic focus.'
  ),
  makeSeed(
    'Threat Off Screen',
    'Suspense',
    'Let danger live just outside the frame.',
    'Create a short suspense scene where the main threat is never fully shown. Use footsteps, a door handle, a bag drop, breathing, distant metal movement, or a repeated offscreen noise to build dread.',
    'Train offscreen tension and sound-led fear.',
    'A suspense scene driven mainly by sound.',
    [
      'The threat cannot be fully shown.',
      'Use one repeated sound motif.',
      'Escalate the motif across the scene.'
    ],
    'scene',
    undefined,
    'Learning: Offscreen sound is one of the strongest suspense tools because it forces the audience to imagine what they cannot see. Repeated motifs, delayed confirmation, and sharpened listening can build dread more effectively than explicit showing.'
  ),
  makeSeed(
    'Outside the Flat',
    'Offscreen Pressure',
    'Let the world outside invade the room.',
    'Build an interior scene where sounds from outside the room or flat slowly reshape the emotional reality inside: neighbours fighting, police sirens, a party downstairs, a car alarm, a protest, or someone arriving.',
    'Train pressure from beyond the frame.',
    'An interior scene transformed by exterior sound.',
    [
      'The exterior sound must evolve or escalate.',
      'Keep the interior and exterior relationship clear.',
      'The outside sound must change the behaviour inside.'
    ],
    'drill',
    undefined,
    'Learning: Sound lets the world press inward. Exterior events can function like invisible scene partners, altering mood, urgency, shame, fear, or distraction inside the room without requiring visual expansion.'
  ),
  makeSeed(
    'Sonic Reveal',
    'Reveal',
    'Let sound get there before image.',
    'Create a scene where the audience first understands the reveal through audio before the picture confirms it: keys that should not be there, a hospital machine, a voice in another room, a train arriving, a gun being loaded, or a child laughing in an empty house.',
    'Train audio-led revelation.',
    'A scene where the reveal lands through sound first.',
    [
      'The reveal must be legible.',
      'Do not confirm it visually too quickly.',
      'The image should either confirm or deepen the sound.'
    ],
    'technical',
    undefined,
    'Learning: Sound can reveal faster than picture because it reaches the audience before they can visually verify. This makes it a powerful tool for dread, shock, recognition, and anticipation.'
  ),
  makeSeed(
    'The Lie Changes the Room',
    'Subtext',
    'Use sound to make dishonesty feel different.',
    'Build a short two-line or three-line dialogue scene where a character lies. At the lie, alter the sonic world subtly: room tone narrows, a fridge hum appears louder, clock ticks emerge, air feels thinner, or an exterior noise suddenly feels invasive.',
    'Train psychological sound design without obvious gimmicks.',
    'A scene where the lie changes how the room feels.',
    [
      'The change must be subtle, not horror-movie obvious.',
      'The audience should feel the shift even if they cannot name it.',
      'Tie the sound change to a specific line.'
    ],
    'drill',
    undefined,
    'Learning: Psychological sound design often works best below the level of conscious naming. A slight change in perspective, ambience, or focus can make dishonesty or danger felt without announcing itself as an “effect.”'
  ),
  makeSeed(
    'Object Motif',
    'Pattern',
    'Turn one repeated sound into story.',
    'Choose one object sound — lighter flick, key turn, pill bottle, glass clink, shoe squeak, train announcement, lift ding — and repeat it at least 3 times across a scene so its meaning changes each time.',
    'Train motif-building and emotional repetition.',
    'A scene built around one evolving repeated sound.',
    [
      'Use the same object or source each time.',
      'Each repetition must mean something different.',
      'The final repetition should land hardest.'
    ],
    'constraint',
    undefined,
    'Learning: Motif is one of the cleanest ways to turn sound into structure. Repetition alone is not enough; the meaning of the repeated sound must evolve with story context, emotional pressure, or character understanding.'
  ),
  makeSeed(
    'Memory Through Sound',
    'Memory',
    'Let sound behave like recollection.',
    'Create a present-day scene interrupted by sound fragments from memory: children in a garden, a tube announcement, hospital monitor beeps, a football crowd, church bells, a parent calling from another room. The fragments should feel linked to one emotional event.',
    'Train associative and memory-based sound design.',
    'A scene where memory reshapes the present through audio.',
    [
      'Use no more than 4 memory fragments.',
      'The fragments must feel connected, not random collage.',
      'The present scene must stay emotionally readable.'
    ],
    'constraint',
    undefined,
    'Learning: Memory in sound often behaves associatively rather than literally. Fragments, textures, and recurring sonic traces can interrupt the present in ways that feel emotional and subjective rather than expository.'
  ),
  makeSeed(
    'Two Hearing Worlds',
    'POV',
    'Let two people hear the same room differently.',
    'Create a short two-character scene where the sound perspective shifts between them: one hears the room clearly, the other hears it narrowed, bass-heavy, ringing, distant, or hyper-detailed because of panic, attraction, shame, rage, or dissociation.',
    'Train comparative subjective sound.',
    'A scene with at least 2 distinct hearing perspectives.',
    [
      'Both perspectives must feel clearly different.',
      'The switch points must be motivated by emotion.',
      'The audience must never get lost in the geography.'
    ],
    'technical',
    undefined,
    'Learning: Subjective sound is perspective design. Walter Murch’s work repeatedly points toward the idea that sound perspective can move with experience, not just objective space. Let the audience hear the room through feeling.'
  ),
  makeSeed(
    'Crowd Isolation',
    'Focus',
    'Find one human thread inside chaos.',
    'Take a crowded scene — canteen, corridor, train platform, pub, house party — and shape the mix so one voice, laugh, breath, chant, or phrase rises above everything else at exactly the right emotional moment.',
    'Train selective focus inside layered ambience.',
    'A crowd scene with one clearly dominant emotional detail.',
    [
      'The crowd must still feel full.',
      'One element must cut through at the key moment.',
      'Do not bury the main dialogue.'
    ],
    'scene',
    undefined,
    'Learning: Mix focus works like lens focus. In a crowded sound field, the mixer decides what the audience should emotionally notice. A single isolated detail can suddenly make a huge environment feel painfully personal.'
  ),
  makeSeed(
    'Make It Sound Like a Club Bathroom',
    'Acoustic Space',
    'Use filtering and reflections to create location.',
    'Take any piece of music or dialogue and make it sound like it is being heard from inside a nightclub bathroom, corridor, stairwell, or smoking area while the party continues outside.',
    'Train space-making through filtering, reverb, and muffled source bleed.',
    'An audio scene with a clearly believable architectural space.',
    [
      'The main source must feel outside the room, not inside it.',
      'Use reverb and filtering intentionally.',
      'The space must be guessable without explanation.'
    ],
    'technical',
    undefined,
    'Learning: Architectural realism comes from multiple cues together: frequency loss, wall absorption, reflections, door leakage, and source distance. Build the room through several clues, not one trick.'
  ),
  makeSeed(
    'Make It Sound Like an Old Cinema',
    'Texture',
    'Give audio a historical playback identity.',
    'Take a short music cue or spoken line and make it sound like it is being heard in an old cinema, village hall screening, damaged archive projection, or worn film reel environment.',
    'Train tonal shaping and playback texture.',
    'A processed cue or scene with a distinct old-film playback feel.',
    [
      'Keep the creative choice specific.',
      'Add character without making it impossible to hear.',
      'The texture must feel deliberate, not broken by accident.'
    ],
    'technical',
    undefined,
    'Learning: Playback environments have histories. Old projection, worn speakers, room reflections, and medium damage all shape sound differently. Build a specific exhibition identity instead of a vague retro effect.'
  ),
  makeSeed(
    'Dialogue Under Pressure',
    'Balance',
    'Let the world compete without winning.',
    'Mix a dialogue scene where environmental sound matters — train passing, dishes, traffic, rain, children, warehouse hum, football crowd, or club bleed — but the words still stay understandable.',
    'Train balancing speech against aggressive environment.',
    'A scene where both dialogue and world feel important.',
    [
      'Dialogue must remain understandable.',
      'The environment must still feel active.',
      'The pressure source must change the mood of the scene.'
    ],
    'technical',
    undefined,
    'Learning: Good balancing is not simply “make the voice louder.” It is about spectral space, perspective, timing, and narrative priority. The world should compete enough to create pressure but not enough to destroy comprehension.'
  ),
  makeSeed(
    'No-Music Suspense',
    'Suspense',
    'Build tension honestly.',
    'Create a suspense scene with zero music and no cheap stingers. Use only breath, footsteps, surfaces, doors, distant sounds, silence, and timing.',
    'Train tension-building through pure sound design.',
    'A suspense scene with no score at all.',
    [
      'No music.',
      'No jump-scare sting.',
      'The tension must still rise clearly.'
    ],
    'constraint',
    undefined,
    'Learning: This is a strong discipline exercise. Without score, every surface, pause, breath, and offscreen sound has to earn its dramatic place. Suspense should come from listening, not rescue by music.'
  ),
  makeSeed(
    'Music Against the Scene',
    'Contrast',
    'Make the wrong music become the right choice.',
    'Take a serious, tense, or heartbreaking scene and score it with music that seems emotionally opposite at first. Then shape entry point, level, and stop point so the contrast becomes revealing or disturbing rather than comic.',
    'Train counterpoint between music and image.',
    'A scene where contrasting music deepens the meaning.',
    [
      'Do not make it parody.',
      'Use at least one exact moment where the music changes level or stops.',
      'The contrast must add meaning, not undermine the scene.'
    ],
    'scene',
    undefined,
    'Learning: Counterpoint is one of the most sophisticated music uses in film sound. Opposed music can create irony, distance, cruelty, denial, or tragic complexity, but it must reveal more than it cancels.'
  ),
  makeSeed(
    'Source Music Becomes Score',
    'Music Perspective',
    'Blur the line between heard and felt music.',
    'Start a scene with music clearly coming from a radio, TV, speaker, band rehearsal, headphones, or car. As the emotional intensity rises, let that same cue grow into full score.',
    'Train transitions between diegetic and non-diegetic music.',
    'A scene where source music transforms into emotional underscore.',
    [
      'The source must be established clearly first.',
      'The transition into score must feel smooth and motivated.',
      'The emotional reason for the shift must be obvious.'
    ],
    'scene',
    undefined,
    'Learning: Moving from source music into score can shift the audience from objective hearing into emotional alignment. Done well, it feels like the room turning into feeling rather than a track merely getting louder.'
  ),
  makeSeed(
    'Rhythmic Dread',
    'Pattern',
    'Let repetition become terror.',
    'Build a suspense sequence around one repeated rhythm: train wheels, dripping tap, flickering fluorescent buzz, washing machine, basketball bounce, neighbour knocking, heel clicks, or elevator thud.',
    'Train escalation through repeated sonic pattern.',
    'A sequence where repetition becomes oppressive.',
    [
      'Use one main rhythm source.',
      'The rhythm must evolve across the scene.',
      'Do not rely on jump scares.'
    ],
    'technical',
    undefined,
    'Learning: Rhythm can become dread when it repeats with increasing emotional charge. The pattern should not stay static; its context, intensity, or spacing should evolve so the audience starts to fear its return.'
  ),
  makeSeed(
    'Silence After Violence',
    'Aftermath',
    'The silence after the event is part of the event.',
    'Build the aftermath of an unseen fight, crash, collapse, or violent confrontation using debris, breath, ringing ears, cloth, footsteps, glass, distant sirens, or stunned room tone.',
    'Train restraint and aftermath sound design.',
    'An aftermath scene where the emotional weight lives in what remains.',
    [
      'Do not show the violence itself in full.',
      'Let aftermath sounds carry the scene.',
      'The silence must feel earned, not empty.'
    ],
    'scene',
    undefined,
    'Learning: Aftermath is often more emotionally potent than impact. Debris, ringing, air, unstable breath, and damaged quiet can communicate shock, guilt, numbness, or disbelief with more force than replaying the event.'
  ),
  makeSeed(
    'Mono vs Space',
    'Spatial Design',
    'Make one moment feel trapped, then open.',
    'Take one short beat — a confession, a realisation, a breath before danger, a phone call — and build two versions: one that feels sonically trapped and narrow, and one that feels open and spacious.',
    'Train width, space, and perceived acoustic depth.',
    'Two contrasting versions of the same moment.',
    [
      'Use the same core material in both versions.',
      'The spatial difference must be obvious.',
      'Both versions must remain clean and understandable.'
    ],
    'technical',
    undefined,
    'Learning: Space is emotional. A narrow, centered, dry sound can feel trapped or interior; a wider, deeper one can feel relieving, exposed, cinematic, or lonely. Spatial design changes psychology.'
  ),
  makeSeed(
    'Whisper Pressure',
    'Intimacy',
    'Quiet can feel more invasive than shouting.',
    'Create a scene where whispered or nearly whispered lines become more intense than loud dialogue would be. Build the intimacy with breath, proximity, room hush, and vocal detail.',
    'Train low-level intensity and close-mic pressure.',
    'A scene built around quiet but dangerous or intimate sound.',
    [
      'Whispers must stay intelligible.',
      'Do not flatten the whole mix to one level.',
      'The quiet should feel active, not weak.'
    ],
    'technical',
    undefined,
    'Learning: Low level does not mean low intensity. A whisper can feel invasive because it forces attention closer. The craft challenge is preserving detail, intelligibility, and dynamic life without letting quiet become dull.'
  ),
  makeSeed(
    'Make Them Somewhere Else',
    'Worldbuilding',
    'Change the location using sound alone.',
    'Take a simple static visual — even a close-up of someone sitting still — and make it sound like they are in one of these places: hospital waiting room, football stadium tunnel, late-night train station, school corridor, church, warehouse, dressing room, or prison visiting area.',
    'Train location-building without visual help.',
    'One unchanged visual transformed into a believable new place through sound.',
    [
      'You cannot change the image.',
      'Use ambience, reflections, and detail specific to the place.',
      'The audience should be able to guess the location from sound alone.'
    ],
    'drill',
    undefined,
    'Learning: This is one of the purest sound-worldbuilding exercises. Sound alone can define architecture, social density, institution, danger, and class of place. Specificity is everything.'
  ),
  makeSeed(
    'Sound Theme Build',
    'Theme',
    'Turn an idea into a sound language.',
    'Choose one theme — guilt, surveillance, loneliness, desire, exposure, envy, home, or hunger — and design a short scene where the sound world reflects that theme through repetition, texture, distance, or interruption.',
    'Train thematic sound authorship.',
    'A scene with a coherent sonic concept.',
    [
      'The theme must shape multiple sound choices.',
      'Avoid random “cool” effects.',
      'The emotional meaning must stay grounded.'
    ],
    'scene',
    undefined,
    'Learning: Theme in sound comes from consistency of logic. Repeated textures, interrupted comfort, invasive details, distant worlds, or recurring motifs can turn an abstract idea into a recognizable sonic language.'
  ),
  makeSeed(
    'Make the Crowd Think They Saw Something',
    'Misdirection',
    'Use sound to imply an event that may not be real.',
    'Build a scene where the audience initially believes something happened offscreen because of the sound design — a crash, a body falling, a kiss, a slap, police arriving, a scream — and then discovers they misread it.',
    'Train sonic misdirection and reinterpretation.',
    'A scene where the first sonic reading is wrong but believable.',
    [
      'The false reading must feel plausible.',
      'The reveal must reframe the earlier sound.',
      'Do not cheat with information the audience never had.'
    ],
    'scene',
    undefined,
    'Learning: Fair misdirection depends on the audience genuinely hearing enough to form a plausible interpretation. The later correction should deepen the scene, not make the prior sound feel dishonest.'
  ),
  makeSeed(
    'Last Sound Wins',
    'Ending',
    'Let the final sound become the final image.',
    'Build a scene where the ending lands because of one last sound: a key turn, voicemail beep, stadium roar cutting out, tube doors closing, a laugh in another room, a kettle boiling over, or sudden dead silence.',
    'Train ending design through audio punctuation.',
    'A scene with a memorable final sonic beat.',
    [
      'The final sound must feel earned.',
      'Do not use a random sting.',
      'The ending must grow from the scene before it.'
    ],
    'constraint',
    undefined,
    'Learning: Endings often live in punctuation. A final sound can function like the last shot, carrying irony, dread, tenderness, absence, or unresolved pressure. It should feel inevitable once it arrives.'
  ),
  makeSeed(
    'Sound Design Proof',
    'Mastery',
    'Show total control of dialogue, world, perspective, and music.',
    'Create a polished scene that includes: clean dialogue, room tone continuity, at least one split edit, at least one perspective shift, one worldbuilding layer set, and one deliberate music choice or deliberate refusal of music.',
    'Prove advanced sound-post authorship in one finished sequence.',
    'A fully designed scene where every sonic choice feels intentional.',
    [
      'Dialogue must remain clear throughout.',
      'Every major sound layer must have a reason to be there.',
      'The final scene must feel mixed, not merely assembled.'
    ],
    'technical',
    undefined,
    'Learning: This is the integration rep. Bring together dialogue discipline, perspective, worldbuilding, motif, subtraction, and musical judgment. A mature soundtrack feels designed from one point of view rather than accumulated from disconnected tricks.'
  ),
];

/* ------------------------------- FILMMAKER ------------------------------- */
/* 35 unique non-boss lessons */
const FILMMAKER_ROTATION: LessonSeed[] = [
  makeSeed(
    'Word to World',
    'Foundation',
    'Build a whole film language from one word.',
    'Choose one word — for example: “late,” “forgive,” “hunger,” “watching,” “home,” or “replaceable.” Write a 1–2 sentence premise, then make a short where that word shapes the performance, frame choices, sound, and final image.',
    'Train full-film authorship from a single conceptual seed.',
    'A short film where one word clearly drives the entire piece.',
    [
      'The word must affect more than dialogue.',
      'At least 3 departments must clearly reflect the word.',
      'The final image must feel connected to the original word.'
    ],
    'scene',
    'A strong short often begins with a precise central idea, not a pile of random cool shots.',
    'Learning: This is the heart of multi-hyphenate filmmaking: one central idea should spread across writing, acting, directing, cinematography, sound, and editing. When you study multiple departments, you get better at turning one thought into one coherent film instead of six disconnected choices.'
  ),
  makeSeed(
    'Object Exercise Film',
    'Performance + Film Language',
    'Turn the acting object exercise into a full cinematic short.',
    'Choose a personal object with emotional charge — ring, jacket, letter, watch, old phone, key, photograph. Build a short film where the object changes the behaviour of the character before they ever explain why it matters.',
    'Train the fusion of acting inner life, close visual attention, and restrained storytelling.',
    'A short film where the object becomes the emotional engine.',
    [
      'The object must appear in the first 10 seconds.',
      'Do not explain its full meaning in dialogue.',
      'Use at least one close-up where the object changes the scene.'
    ],
    'scene',
    undefined,
    'Learning: Studying acting helps you understand how private meaning changes behaviour; studying cinematography helps you understand when the object needs visual emphasis; studying editing helps you know when to hold or cut away from it. Multi-role filmmaking teaches you how emotional meaning travels across departments.'
  ),
  makeSeed(
    'One Room, Full Film',
    'Foundation',
    'Prove you can make one room feel like a complete film.',
    'Make a short in one room only: bedroom, kitchen, hallway, garage, classroom, bathroom, office. The film must still have a beginning, escalation, and clear ending image.',
    'Train limitation-driven filmmaking and structural discipline.',
    'A complete one-room short with a turn.',
    [
      'One room only.',
      'There must be a turn or reveal.',
      'Sound and framing must stop the room feeling visually dead.'
    ],
    'technical',
    undefined,
    'Learning: One-room filmmaking forces respect for every craft. Writing must be sharper, acting must carry more weight, blocking must create progression, sound must open the world beyond the walls, and editing must prevent visual repetition. Limits often expose what each department is actually doing.'
  ),
  makeSeed(
    'Performance-Led Short',
    'Actor-Centred',
    'Let the actor carry the piece and make every other department serve them.',
    'Build a short around one emotional action: hiding panic, trying to keep dignity, trying not to cry, trying to leave without being stopped, pretending to be fine. The performance should be the main reason the film works.',
    'Train alignment around acting rather than decorative filmmaking.',
    'A short film where performance is clearly the centre of gravity.',
    [
      'One actor must dominate the emotional arc.',
      'Do not let flashy cutting overpower the acting.',
      'At least one shot must stay long enough to watch behaviour change.'
    ],
    'drill',
    undefined,
    'Learning: Learning acting makes you a better director because you stop giving empty notes and start understanding action, obstacle, timing, listening, and vulnerability. It also makes you a better editor because you begin to recognize when a behavioural shift is worth protecting instead of cutting around.'
  ),
  makeSeed(
    'Image-Led Short',
    'Visual Storytelling',
    'Tell the story mainly through frame, light, and withholding.',
    'Create a short where the audience understands the story mostly from images: reflections, silhouettes, negative space, blocked reveals, distance changes, or camera height shifts.',
    'Train image-first authorship.',
    'A short film where visual design is the main storytelling engine.',
    [
      'Minimal exposition.',
      'At least 3 shots must carry story without dialogue.',
      'The visual idea must feel consistent, not random.'
    ],
    'technical',
    undefined,
    'Learning: When you study cinematography, you learn that directing is not only telling actors what to do. Frame size, lens choice, angle, distance, movement, shape, and light are all forms of interpretation. A filmmaker who understands image can make even simple writing feel authored.'
  ),
  makeSeed(
    'Sound-Led Short',
    'Sound Story',
    'Build the film around sound perspective and sonic meaning.',
    'Create a short where sound drives the piece: offscreen threat, memory fragments, crowd build, room tone pressure, club bathroom music bleed, source music turning into score, or a hard music stop on a dramatic beat.',
    'Train audio-first filmmaking.',
    'A short film whose emotional spine is built primarily through sound.',
    [
      'Sound must lead, not just decorate.',
      'Use at least one deliberate perspective shift or music decision.',
      'The film must still tell a clear story.'
    ],
    'scene',
    undefined,
    'Learning: Learning sound makes you a better filmmaker because you stop thinking of audio as cleanup. It changes how you write entrances, direct offscreen pressure, shoot coverage, and cut transitions. Walter Murch’s career is a huge reminder that sound and editing are not side departments — they are meaning-making departments. :contentReference[oaicite:1]{index=1}'
  ),
  makeSeed(
    'No Safety Net Scene',
    'Bold Choice',
    'Build a scene around one decisive cinematic idea.',
    'Make a short scene that relies on one major authored choice: a body-rig shot, a reflection-only opening, one-take geography, a scene with no visible faces, a split-diopter style deep frame, or one aggressive music interruption.',
    'Train confidence in singular film decisions.',
    'A short scene where one central cinematic idea defines the finished film.',
    [
      'Choose one main idea only.',
      'The choice must support story, not distract from it.',
      'Do not cover yourself with generic fallback coverage.'
    ],
    'drill',
    undefined,
    'Learning: Many strong filmmakers are remembered because they commit. Studying several departments helps you recognize whether a bold idea belongs to camera, sound, performance, structure, or edit — and whether the rest of the film can support it.'
  ),
  makeSeed(
    'Three-Shot Film',
    'Economy',
    'Tell a full story beat in only three shots.',
    'Create a complete micro-film with exactly 3 shots total. Example structures: wide / medium / close, detail / character / reveal, watcher / watched / aftermath.',
    'Train precision, shot judgment, and structural economy.',
    'A finished film built from only 3 shots that still feels complete.',
    [
      'Exactly 3 shots.',
      'The story must still have a change.',
      'Every shot must do a different job.'
    ],
    'constraint',
    undefined,
    'Learning: Editing teaches economy back into directing. When you understand cutting, you stop shooting redundant material. When you understand writing, you stop building scenes with no turn. When you understand acting, you know when one look can replace three extra lines.'
  ),
  makeSeed(
    'The Two Character Solo',
    'Actor + Director',
    'Direct yourself in a serious two-character scene if you have no scene partner.',
    'Write or stage a two-character scene and play both roles seriously. Shoot each character cleanly, with a distinct objective, framing logic, and rhythm for each side of the conversation. If you can, invite someone from your city chat to act instead — but if not, play both roles properly.',
    'Train directing, performance separation, eyeline control, and self-coverage discipline.',
    'A two-character scene that feels like two real people, not a sketch.',
    [
      'Both characters must want different things.',
      'Keep eyelines and screen direction clean.',
      'Do not play either character as a joke.'
    ],
    'scene',
    undefined,
    'Learning: Doing both sides yourself teaches respect for actors, editors, and continuity all at once. You learn how hard it is to keep objectives distinct, eyelines believable, and emotional timing alive across multiple passes. It also makes you much more useful on low-budget productions.'
  ),
  makeSeed(
    'Scene Re-Interpretation I',
    'Interpretation',
    'Take a script and give it a real point of view.',
    `Film this scene without watching any existing version. Decide who has the power, what the real secret is, and what the scene is actually about underneath the words.

INT. HALLWAY – NIGHT

MILA
Why are you awake?

JONAH
I could ask you the same thing.

MILA
You went through my bag.

JONAH
I was trying to find out who you really are.`,
    'Train screenplay interpretation across acting, directing, camera, sound, and edit.',
    'A finished short scene with a clear directorial reading.',
    [
      'Do not stage it neutrally.',
      'Choose the emotional centre.',
      'Your sound and framing choices must support your interpretation.'
    ],
    'scene',
    undefined,
    'Learning: This is what multi-role study gives you: not just the ability to perform tasks, but the ability to unify interpretation. Writing gives you structure, acting gives you behaviour, cinematography gives you emphasis, sound gives you hidden pressure, and editing gives you final argument.'
  ),
  makeSeed(
    'Scene Re-Interpretation II',
    'Interpretation',
    'Take sparse dialogue and build heavy history underneath it.',
    `Film this scene without researching or watching any reference version. Your job is to invent the unseen years behind it.

INT. DINER – LATE

SARA
You came back.

MARCUS
Only because you never asked me not to.

SARA
That’s not a reason.

MARCUS
It was enough.`,
    'Train restraint, subtext, and authorial interpretation.',
    'A short scene where the pauses and behaviour feel as important as the lines.',
    [
      'Shared history must be felt, not explained.',
      'The final line must land differently because of everything before it.',
      'At least one department besides acting must deepen the subtext.'
    ],
    'scene',
    undefined,
    'Learning: Writers often learn subtext through actors; actors learn subtext through directors; editors learn subtext by choosing where a silence lands. Studying all three helps you understand that history is rarely carried by exposition alone.'
  ),
  makeSeed(
    'Scene Re-Interpretation III',
    'Interpretation',
    'Stage a script where danger stays mostly under the surface.',
    `Film this scene without trying to make it “performative.” Decide whether this is grief, threat, seduction, surveillance, or betrayal.

INT. KITCHEN – EARLY MORNING

RHEA
You should have left it alone.

TOM
It was sitting there.

RHEA
So was I.

TOM
That’s not the same thing.`,
    'Train tonal control and interpretive bravery.',
    'A short scene with a very specific emotional reading.',
    [
      'Pick one dominant reading for the scene.',
      'Do not let it feel generic.',
      'The blocking and sound must both contribute to the tone.'
    ],
    'scene',
    undefined,
    'Learning: Tonal precision usually comes from cross-department awareness. A filmmaker who understands only script may write danger. A filmmaker who also understands acting, camera, sound, and cut can make danger felt in silence, distance, rhythm, and perspective.'
  ),
  makeSeed(
    'Coverage With Intent',
    'Directing + Edit',
    'Shoot only what the cut truly needs.',
    'Create a dialogue scene using a planned coverage list: one master, two mediums, and two close shots maximum. Then edit it so the scene feels shaped, not under-covered.',
    'Train disciplined coverage and edit planning.',
    'A dialogue scene that feels complete with limited planned coverage.',
    [
      'Maximum 5 setup types.',
      'Start from a shot plan before filming.',
      'Do not shoot extra “just in case” coverage.'
    ],
    'technical',
    undefined,
    'Learning: Editing makes you a better director because you start to understand what coverage is actually useful. Steven Soderbergh is a strong example of how shooting and editing experience can feed each other: once you understand the cut, you direct more precisely and waste less. :contentReference[oaicite:2]{index=2}'
  ),
  makeSeed(
    'Edit-Led Scene',
    'Post Authorship',
    'Make the edit the main authorial voice.',
    'Shoot a simple scene — someone entering a room, finding an object, reading a message, or waiting for a reply — then create the meaning primarily through editorial rhythm, withheld reactions, J-cuts/L-cuts, and timing.',
    'Train edit-led storytelling rather than raw-document capture.',
    'A short film where the final meaning comes mostly from editorial decisions.',
    [
      'Use at least one split edit.',
      'The pacing must clearly shape meaning.',
      'The raw footage should feel less interesting than the finished cut.'
    ],
    'technical',
    undefined,
    'Learning: Learning editing makes you a better actor too, because you start to understand what editors need: clean eyelines, behavioral turns, usable entrances and exits, stillness when needed, and truthful reactions. You stop thinking only about your favourite moment and start giving the film usable shape.'
  ),
  makeSeed(
    'POV Film',
    'Perspective',
    'Make every department belong to one inner experience.',
    'Create a film where cinematography, sound, and editing all clearly belong to one character’s emotional point of view: panic, shame, attraction, rage, disassociation, suspicion, exhaustion.',
    'Train integrated POV authorship.',
    'A finished short with a strong subjective identity.',
    [
      'The perspective must stay coherent.',
      'Use at least one sound or lens choice that reflects the POV.',
      'Do not explain the feeling in dialogue.'
    ],
    'technical',
    undefined,
    'Learning: Multi-role study teaches coherence. If you understand acting, you know what the character is living through. If you understand sound, camera, and edit, you know how to externalize that experience without explaining it verbally.'
  ),
  makeSeed(
    'Action Through Geography',
    'Pace',
    'Make something high-paced without losing clarity.',
    'Film a short action sequence built around pursuit, search, escape, or urgent movement — hallway chase, stairwell escape, grabbing the wrong bag, running late to stop something, or trying to hide an object before someone arrives.',
    'Train pace, geography, and action readability.',
    'A fast sequence where the audience always understands where they are and what matters.',
    [
      'The action must remain geographically clear.',
      'Use movement, cut timing, and sound to increase urgency.',
      'Do not replace clarity with chaos.'
    ],
    'scene',
    undefined,
    'Learning: Action filmmaking gets better when the director thinks like an editor and the editor thinks like a director. Geography, objective, and cut motivation all matter more than volume or chaos.'
  ),
  makeSeed(
    'Suspense Without Chase',
    'Suspense',
    'Create pressure without action spectacle.',
    'Build a suspense short with no fight choreography, no jump-scare cheat, and no running. Use sound, timing, framing, and withheld information instead.',
    'Train disciplined tension-building.',
    'A short suspense film driven by control rather than spectacle.',
    [
      'No chase scene.',
      'No cheap jump-scare sting.',
      'The pressure must rise through film language.'
    ],
    'constraint',
    undefined,
    'Learning: This is where learning every craft helps most. Suspense can be built by writing withheld information, acting contained fear, directing silence, shaping frames, designing offscreen sound, and cutting reveals. You do not need spectacle if you understand pressure.'
  ),
  makeSeed(
    'One Actor, Full World',
    'Worldbuilding',
    'Make one body imply a larger unseen world.',
    'Create a short with only one on-screen performer, but make it feel like a larger world exists through sound, eyelines, props, offscreen pressure, phone messages, reflections, and environmental detail.',
    'Train worldbuilding without cast scale.',
    'A solo-driven short that still feels socially and dramatically full.',
    [
      'Only one on-screen actor.',
      'The unseen world must feel specific.',
      'Use at least one offscreen sound or event that changes behaviour.'
    ],
    'scene',
    undefined,
    'Learning: A complete filmmaker learns that scale is not only cast size or budget. Writing, performance, sound, props, and frame edges can all imply a larger world. This is one reason multi-discipline filmmakers often work so well in shorts.'
  ),
  makeSeed(
    'Music Is the Weapon',
    'Sound + Directing',
    'Use music as a dramatic attack, not wallpaper.',
    'Build a scene where music does one of these jobs: cuts out on a realisation, starts from a visible source and expands into score, plays against the scene in an unsettling way, or ends halfway through a lyric for emotional effect.',
    'Train deliberate musical dramaturgy.',
    'A short scene where the music choice changes the meaning of the film.',
    [
      'Use one clear music strategy.',
      'The cue must have a dramatic reason.',
      'Do not let the music simply sit underneath the whole scene unchanged.'
    ],
    'scene',
    undefined,
    'Learning: Sound study gives you better directing judgment because you stop treating music as emotional glue. You begin asking what music is doing structurally, socially, ironically, or psychologically.'
  ),
  makeSeed(
    'Silence Is the Weapon',
    'Restraint',
    'Let the missing sound become the event.',
    'Create a scene where the strongest moment comes from silence or near-silence: a revelation, an apology, the second after a door closes, the aftermath of a message, or someone deciding not to speak.',
    'Train restraint across performance, camera, sound, and edit.',
    'A short film where silence creates the turning point.',
    [
      'The silence must be prepared for.',
      'Do not fill it with unnecessary movement.',
      'The moment after the silence must feel changed.'
    ],
    'scene',
    undefined,
    'Learning: Filmmakers who study multiple departments usually become less decorative. They trust the actor more, the frame more, the cut more, and the silence more because they understand how those things work together.'
  ),
  makeSeed(
    'Object-Centred Short',
    'Theme',
    'Let one object carry the whole film.',
    'Build a short where one object drives the film’s desire, guilt, danger, or memory — key, note, jacket, knife, receipt, ring, cassette, inhaler, bouquet, football ticket.',
    'Train thematic concentration and narrative economy.',
    'A short film where the object’s meaning changes by the end.',
    [
      'The object must matter in every section of the film.',
      'Its meaning must evolve.',
      'Do not use it as mere decoration.'
    ],
    'drill',
    undefined,
    'Learning: Objects are where writing, acting, directing, cinematography, sound, and editing meet. A writer gives the object meaning, an actor gives it behaviour, a director gives it dramatic placement, camera gives it emphasis, sound gives it tactility, and editing gives it timing.'
  ),
  makeSeed(
    'Reflection Film',
    'Visual Concept',
    'Tell the scene through surfaces and doubles.',
    'Make a short where reflections — mirrors, windows, phone screens, puddles, polished tables, oven doors, sunglasses, framed glass — are central to how the story is told.',
    'Train visual concept execution and symbolic framing.',
    'A short film where reflection is part of the narrative grammar.',
    [
      'Use at least 3 reflection-based shots.',
      'The reflections must mean something dramatic.',
      'Do not rely on reflections only because they look cool.'
    ],
    'technical',
    undefined,
    'Learning: Studying visual departments teaches you when a concept is structural instead of decorative. A reflection should not just look good; it should change access, identity, distance, or point of view.'
  ),
  makeSeed(
    'Body-Rig / Attached Camera Film',
    'Experimental Form',
    'Lock the camera to the character’s body or movement pattern.',
    'Create a short sequence using a body-rig, chest mount, bag mount, bike mount, taped tripod, or other attached-camera setup so the background world shifts while the subject stays unnervingly fixed.',
    'Train experimental perspective and embodied cinema.',
    'A short film where the camera rig itself shapes the emotional effect.',
    [
      'The rig must have a dramatic reason.',
      'The audience must still understand what is happening.',
      'Use the strangeness to deepen the scene, not just to show off.'
    ],
    'technical',
    undefined,
    'Learning: Multi-role filmmaking helps you test form against meaning. Experimental camera ideas become stronger when you also understand performance, sound, and edit rhythm, because then the experiment serves the experience instead of replacing it.'
  ),
  makeSeed(
    'One-Take With Turn',
    'Blocking + Performance',
    'Sustain a full scene without the safety of cutting.',
    'Stage and shoot a one-take short scene where the emotional or power dynamic changes clearly during the shot.',
    'Train blocking, rhythm, actor timing, and spatial clarity.',
    'A one-take film with a visible turn.',
    [
      'The geography must stay readable.',
      'There must be a turn by the end.',
      'Do not use the one-take as a gimmick with no dramatic payoff.'
    ],
    'technical',
    undefined,
    'Learning: One-take work teaches respect for actors, camera operators, sound, and blocking all at once. You learn quickly that no department can hide another. That pressure is useful.'
  ),
  makeSeed(
    'Late Entry, Early Exit',
    'Structure',
    'Enter after the setup and leave before the explanation.',
    'Make a short that starts after the obvious beginning and ends before the obvious wrap-up. The audience should still understand the scene and feel the missing material around it.',
    'Train structural confidence and omission.',
    'A short film that feels alive from frame one and lands before it goes flat.',
    [
      'Do not over-explain the missing context.',
      'The audience must catch up quickly.',
      'End on the strongest beat, not the explanatory beat after it.'
    ],
    'scene',
    undefined,
    'Learning: Writers, editors, and directors all benefit from this skill. You start understanding that films do not need every bridge if the emotional logic is clear. Structure is often stronger when you trust the audience.'
  ),
  makeSeed(
    'Aftermath Film',
    'Aftermath',
    'Film the consequence, not the event itself.',
    'Build a short around what happens after the thing most people would normally shoot: after the breakup, after the fight, after the crash, after the audition, after the theft, after the confession.',
    'Train consequence-based storytelling.',
    'A short film where aftermath carries the drama.',
    [
      'Do not fully show the original event.',
      'The aftermath must still have movement and shape.',
      'Behaviour must matter more than explanation.'
    ],
    'drill',
    undefined,
    'Learning: Editors and actors often know this instinctively: the emotional truth often lands after the event, not during the obvious peak. Learning different crafts teaches you to look for consequence, not just incident.'
  ),
  makeSeed(
    'Remake an Unseen Scene',
    'Interpretation',
    'Rebuild a scene from script only, not from memory of a finished film.',
    'Find an older or less familiar script excerpt, or use a scene shared inside Overlooked, and remake it without watching any previous production or reference. Your version must feel like a real interpretation, not a placeholder.',
    'Train taste, script reading, and original directorial thinking.',
    'A remade script scene with a clear authorial point of view.',
    [
      'Do not watch a finished version first.',
      'Make real choices in performance, image, and sound.',
      'The result must feel authored rather than merely staged.'
    ],
    'drill',
    undefined,
    'Learning: This is a great exercise for writers, directors, actors, and editors alike because it forces you to read material actively. You stop copying finished results and start understanding how choices create meaning.'
  ),
  makeSeed(
    'Collaborative Swap',
    'Collaboration',
    'Turn somebody else’s material into your authored film.',
    'Trade footage, self-tapes, sound recordings, voice notes, or unfinished scene material with another Overlooked creative. Build a finished short from at least one element you did not create yourself.',
    'Train adaptation, collaboration, and authorship under shared conditions.',
    'A finished short built partly from another person’s material.',
    [
      'At least one core asset must come from another person.',
      'The final piece must still feel cohesive.',
      'Credit the collaborator clearly.'
    ],
    'collab',
    undefined,
    'Learning: Multi-hyphenate filmmakers usually collaborate better because they understand what other departments are trying to protect. Knowing how actors, editors, DPs, sound people, and writers work makes you less territorial and more precise.'
  ),
  makeSeed(
    'City Collaboration Film',
    'Collaboration',
    'Use the platform like it actually matters.',
    'Reach out in your city chat and make a short with another creative: actor, DP, editor, writer, sound person, or composer. If you cannot find anyone, make the film alone but design it as if you were preparing a proper collaboration pack with shot list, performance notes, and edit plan.',
    'Train real filmmaking collaboration and pre-production discipline.',
    'A short film made collaboratively, or solo with a full collaboration-style prep workflow.',
    [
      'Collaboration is preferred.',
      'If solo, include clear pre-production notes for imaginary collaborators.',
      'The finished piece must show planning, not improvisation alone.'
    ],
    'collab',
    undefined,
    'Learning: Studying other crafts makes you much easier to collaborate with. You write better shot lists if you understand camera. You give better notes if you understand acting. You prep better if you understand editing and sound. Respect comes from practical literacy.'
  ),
  makeSeed(
    'Two-Hander Power Shift',
    'Integrated Scene',
    'Make every department support a power reversal.',
    'Create a two-person scene where the power genuinely shifts from one character to the other. Performance, blocking, framing, sound, and edit must all help tell the reversal.',
    'Train integrated filmmaking around one dramatic architecture.',
    'A short scene where the reversal is visible in more than dialogue.',
    [
      'Both characters must pursue something specific.',
      'The power shift must be earned.',
      'At least 4 departments must support the reversal.'
    ],
    'technical',
    undefined,
    'Learning: This is what complete filmmaking feels like: one dramatic event supported by multiple disciplines. When you study several crafts, you stop asking each department to invent separate meanings and start asking them to support the same one.'
  ),
  makeSeed(
    'Theme-Led Short',
    'Theme',
    'Let one idea infect every department.',
    'Choose one theme — guilt, surveillance, hunger, freedom, loneliness, inheritance, exposure, longing, jealousy — and make a short where story, acting, cinematography, sound, and edit all reflect that theme.',
    'Train thematic cohesion at filmmaker level.',
    'A finished short with clear conceptual unity.',
    [
      'The theme must show in more than dialogue.',
      'Every department should support it.',
      'Avoid empty symbolism with no dramatic function.'
    ],
    'technical',
    undefined,
    'Learning: Theme becomes stronger when departments agree. Writers often start the idea, but actors embody it, directors organize it, cinematography visualizes it, sound textures it, and editing clarifies it. Learning all of them helps you create unity instead of coincidence.'
  ),
  makeSeed(
    'Genre Identity Short',
    'Tone',
    'Make the genre register almost immediately.',
    'Create a short that clearly announces its genre in the first 10 seconds: thriller, romance, drama, coming-of-age, social realism, psychological horror, dark comedy, noir, sci-fi minimalism.',
    'Train tonal authorship and fast setup.',
    'A finished short with a strong early tonal identity.',
    [
      'The genre must register quickly.',
      'Use more than one department to establish the tone.',
      'Do not let the genre become parody.'
    ],
    'scene',
    undefined,
    'Learning: Genre is rarely created by writing alone. Tone comes from acting style, framing, sound pressure, rhythm, color, pacing, and what information you reveal first. That is why broad craft knowledge helps so much.'
  ),
  makeSeed(
    'Misdirection Film',
    'Interpretation',
    'Let the audience read the wrong reality first.',
    'Build a short where the viewer initially believes one emotional or factual reading, then later realises another reading is true. This can happen through sound, withheld framing, edit order, performance, or a final reveal.',
    'Train reinterpretation across the whole film.',
    'A short film with a believable first reading and an earned second reading.',
    [
      'The first reading must feel fair.',
      'The second reading must deepen the film, not just twist it.',
      'Do not cheat with hidden information the audience could never infer.'
    ],
    'scene',
    undefined,
    'Learning: Reinterpretation is one of the clearest examples of why editing, directing, acting, and sound all matter together. The first reading is built by selection and emphasis; the second is built by what you withheld and when you release it.'
  ),
  makeSeed(
    'Constraint Film: No Dialogue',
    'Constraint',
    'Take speech away and make the film still work.',
    'Make a short film with no spoken dialogue at all. The audience must still understand objective, pressure, and change through image, behaviour, sound, and edit.',
    'Train non-verbal filmmaking at full-stack level.',
    'A completed short with no spoken dialogue that still feels dramatically clear.',
    [
      'No spoken dialogue.',
      'Do not explain everything with text cards.',
      'The story must still read cleanly.'
    ],
    'constraint',
    undefined,
    'Learning: This is one of the best ways to test whether you really understand film rather than just scenes on paper. If writing, performance, image, sound, and edit are all working, you can lose speech and still keep drama.'
  ),
  makeSeed(
    'Constraint Film: One Location, One Prop',
    'Constraint',
    'Sharpen invention through harsh limitation.',
    'Build a short using one location only and one central prop only. Example: corridor + envelope, bathroom + ring, bus stop + backpack, stairwell + flowers.',
    'Train economy and concentration.',
    'A finished short whose limitation improves the film rather than shrinking it.',
    [
      'One location only.',
      'One central prop only.',
      'The limitation must shape the film language.'
    ],
    'constraint',
    undefined,
    'Learning: Harsh limitations reveal craft priorities. If you know only one department, you may feel trapped. If you understand several, you begin to see more options inside fewer materials.'
  ),
  makeSeed(
    'Emotional Reveal Film',
    'Reveal',
    'Make the biggest reveal emotional, not factual.',
    'Build a short where the final shift is not “what happened” but “what this really meant to the character.” The reveal should reframe the behaviour, not merely add information.',
    'Train interior revelation and mature storytelling.',
    'A short film whose ending changes our emotional understanding of what came before.',
    [
      'Do not rely on plot twist alone.',
      'The emotional reveal must feel earned.',
      'The earlier beats must support the final re-reading.'
    ],
    'scene',
    undefined,
    'Learning: Actors, editors, and directors all benefit from understanding emotional reveal. Plot surprise is easy to chase; emotional re-understanding is harder and often richer. Multi-role study helps you build toward it from several angles at once.'
  ),
  makeSeed(
    'Actor and Camera Partnership',
    'Performance + Image',
    'Make the camera respond to behaviour, not just record it.',
    'Create a short where framing evolves with the actor’s internal changes: push closer on concealment breaking, drift away as shame arrives, hold wider when they lose control, use height changes or focus shifts to mirror their state.',
    'Train the relationship between performance and image design.',
    'A short scene where the camera and actor feel in conversation.',
    [
      'Do not use random coverage.',
      'The camera changes must respond to acting beats.',
      'The emotional shifts must be visible in both performance and framing.'
    ],
    'technical',
    undefined,
    'Learning: Greta Gerwig is a useful example of how acting experience can feed writing and directing. Moving from performance into writing/directing can sharpen your sense of behavior, accident, and how scenes live in bodies rather than only in lines. :contentReference[oaicite:3]{index=3}'
  ),
  makeSeed(
    'Film With a Final Image',
    'Ending',
    'Build the whole piece toward one image you can only earn, not fake.',
    'Design a short from the final frame backwards. Know the final image before you shoot: empty chair, object left behind, face in reflection, lit doorway, stopped escalator, phone screen, silent crowd, wet floor, open locker, train leaving.',
    'Train ending-oriented authorship.',
    'A short that lands on a final image that feels inevitable and earned.',
    [
      'Choose the final image before production.',
      'Everything before it should build toward it.',
      'Do not end on something arbitrary just because it looks pretty.'
    ],
    'technical',
    undefined,
    'Learning: Planning from the final image backwards is one of the best ways to unify writing, directing, camera, and edit. It gives every earlier choice a destination.'
  ),
  makeSeed(
    'One-Minute Auteur Film',
    'Compression',
    'Make something tiny feel completely authored.',
    'Create a finished film of exactly 60 seconds that still feels like a complete work, not a fragment: clear premise, pressure, shape, and final landing.',
    'Train compression with voice.',
    'A one-minute film with strong identity and full dramatic shape.',
    [
      'Exactly 60 seconds.',
      'It must feel complete.',
      'The voice of the filmmaker should be obvious.'
    ],
    'scene',
    undefined,
    'Learning: Compression is where broad craft knowledge becomes brutally useful. Writers learn omission, actors learn precision, directors learn selection, cinematographers learn decisive imagery, sound learns economy, and editors learn structure.'
  ),
  makeSeed(
    'Collaboration Proof Piece',
    'Mastery',
    'Make another person’s contribution inseparable from the finished film.',
    'Collaborate with at least one other creative and make a polished short where their contribution is structurally necessary — not just added on top. This could be actor + DP, writer + director, actor + editor, sound designer + filmmaker, composer + editor.',
    'Train advanced collaboration and integration.',
    'A cohesive collaborative short where both sides clearly strengthen the film.',
    [
      'A collaborator must matter materially.',
      'The finished piece must feel unified, not stitched together.',
      'Credit each contribution clearly.'
    ],
    'collab',
    undefined,
    'Learning: The more departments you understand, the better collaborator you become. Not because you do everyone’s job for them, but because you can talk to them clearly, respect their constraints, and recognize what great work from them actually looks like.'
  ),
  makeSeed(
    'Filmmaker Proof Piece',
    'Mastery',
    'Combine everything and prove full-stack authorship.',
    'Create a polished short that combines the strongest tools from the whole path: precise performance direction, planned shot design, meaningful lens/light choices, clear sound perspective, disciplined edit rhythm, and a final image or emotional reveal that lands hard.',
    'Prove you can think and execute like a complete filmmaker rather than a single-department specialist.',
    'A finished short film where acting, directing, cinematography, sound, and edit all feel coordinated and deliberate.',
    [
      'At least 4 departments must matter clearly.',
      'Every major choice must feel authored.',
      'The final film must feel finished, not like a sketch of a film.'
    ],
    'technical',
    undefined,
    'Learning: This is the full integration rep. Study people who cross roles — actor-writer-directors, editor-directors, writer-actor-directors, filmmakers who shoot and cut their own work — not because you must do everything forever, but because understanding every department gives you perspective, discipline, empathy, and stronger choices even inside one specialty. :contentReference[oaicite:4]{index=4}'
  ),
];
   

const COMMUNITY_FILMS: SurgeryFilm[] = [
  { id: 1, title: 'Last Exit on Mercer', creator: 'Ella R.', type: 'Drama', hook: 'Quiet breakup scene with strong subtext.' },
  { id: 2, title: 'Static Hour', creator: 'Micah T.', type: 'Thriller', hook: 'Night tension piece built around sound design.' },
  { id: 3, title: 'Blue Hallway', creator: 'Sami K.', type: 'Character', hook: 'A one-location performance study.' },
  { id: 4, title: 'The Red Note', creator: 'Jules P.', type: 'Mystery', hook: 'A voicemail changes everything.' },
  { id: 5, title: 'Sunday Fluorescent', creator: 'Nia C.', type: 'Mood Film', hook: 'Light and silence do most of the storytelling.' },
  { id: 6, title: 'South Platform', creator: 'Leo M.', type: 'Romance', hook: 'Missed connection cut like a memory.' },
  { id: 7, title: 'Borrowed Jacket', creator: 'Imani S.', type: 'Acting', hook: 'One line, many hidden meanings.' },
  { id: 8, title: 'Dust in the Projector', creator: 'Aaron V.', type: 'Editing', hook: 'Old footage given a new emotional reading.' },
  { id: 9, title: 'June Without Sound', creator: 'Rhea D.', type: 'Experimental', hook: 'Silence as a turning point.' },
];

/* ------------------------------ BOSS BANKS ------------------------------ */

const BOSS_COMMUNITY_NOTE =
  'Before starting this challenge, take a moment to support the community by leaving thoughtful feedback on another filmmaker’s submission. Showing support and offering constructive feedback helps everyone grow stronger together.';

const ACTING_BOSSES: Record<number, LessonSeed> = {
  8: makeSeed(
    'Acting Boss 1 — The Train Station Return',
    'Boss',
    'Play a reunion scene where too much history is already in the air before the first line.',
    'Create a 4–6 minute scene set at a train platform or station bench. Two former lovers have not seen each other in 3 years. One of them already knows the other is leaving the country tonight, but does not reveal that immediately. The scene must begin with at least 20 seconds of behavior before the first line. Use the line: “You shouldn’t have come yourself.”',
    'Prove you can play previous circumstances, restraint, listening, and subtext inside a complete dramatic scene.',
    'A finished reunion scene where history is readable from behavior, silence, and shifting emotional temperature.',
    [
      'Two actors only.',
      'Start with at least 20 seconds before the first line.',
      'Use the line: “You shouldn’t have come yourself.”',
      'One actor must begin cold and lose control gradually.',
      'No crying until the final 30 seconds, if at all.',
    ],
    'boss',
    `This should feel like a real film scene, not an acting class sketch. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This is high-level acting because it combines previous circumstances, restraint, listening, and action. The challenge is not to “show history,” but to behave as if the history is already active before the text begins. Mature screen acting often lives in what has already happened to the body before the first line lands.'
  ),
  16: makeSeed(
    'Acting Boss 2 — The Kitchen Confession',
    'Boss',
    'Play a confession scene where a practical task keeps colliding with unbearable truth.',
    'Create a 4–6 minute scene in a kitchen. One character has come to ask for help, but halfway through reveals they were directly responsible for a family betrayal. One actor must continue a practical task such as washing dishes, chopping food, making tea, or cleaning while the scene escalates. Use the line: “I was going to tell you.”',
    'Prove you can combine independent activity, objective, emotional leakage, and tactical change under pressure.',
    'A finished kitchen confrontation where the practical task deepens the tension instead of distracting from it.',
    [
      'The scene must be filmed in a kitchen.',
      'One actor must continue a real task for at least half the scene.',
      'Use the line: “I was going to tell you.”',
      'Include one silence longer than 8 seconds.',
      'The confession must change the power of the scene.',
    ],
    'boss',
    `The task should make the scene more truthful, not more busy. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Independent activity is one of the strongest tools in actor training because it stops scenes becoming abstract emotion displays. The task gives the body something real to do, which often makes truth, denial, leakage, and avoidance far more watchable.'
  ),
  24: makeSeed(
    'Acting Boss 3 — The Calm Interrogation',
    'Boss',
    'Play a scene where the person pressing for truth never raises their voice.',
    'Create a 3–5 minute confrontation where one character knows the other is lying, but stays calm the entire time. The liar must change tactics at least 3 times without fully confessing. End the scene on the line: “That’s not what happened.”',
    'Prove you can play status loss, lying behavior, tactical change, and rising danger without relying on shouting.',
    'A finished interrogation scene where the emotional pressure keeps increasing through restraint.',
    [
      'No shouting from either actor.',
      'The liar must switch tactics at least 3 times.',
      'No full confession is allowed.',
      'End on the line: “That’s not what happened.”',
      'The calmer character must become more dangerous over time.',
    ],
    'boss',
    `Cold pressure is harder and more cinematic than loud pressure. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This is a study in power through restraint. Calm interrogation can be far more dangerous than overt rage because the actor pressing for truth never gives the liar a clean emotional target to react against. Tactical change becomes the real drama.'
  ),
  32: makeSeed(
    'Acting Boss 4 — The Waiting Room Secret',
    'Boss',
    'Play a family waiting-room scene where one person is carrying the unforgivable truth.',
    'Create a 5–8 minute hospital or clinic waiting-room scene between 2 siblings. They are waiting for news about a parent. One of them secretly signed the DNR papers without telling the other. For the first half, that character must try to keep the scene socially normal. The scene must include one failed apology and one moment where a memory almost comes out but is stopped.',
    'Prove you can play shame, suppression, contradiction, and emotional collapse with precision rather than melodrama.',
    'A finished dramatic scene where guilt and restraint carry more weight than overt breakdown.',
    [
      'No music.',
      'No phones in hand.',
      'The guilty character must try to keep things normal for the first half.',
      'Include one failed apology.',
      'No one may say “I’m sorry” more than once.',
    ],
    'boss',
    `This should hurt because of what is withheld, not because of how loudly it is played. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Shame and guilt often make actors quieter, smaller, more socially careful, and more physically interrupted. This scene is strongest when the actor tries to preserve normal behavior long after normal has become impossible.'
  ),
  40: makeSeed(
    'Acting Boss 5 — The Two-Version Break Scene',
    'Boss',
    'Play the same breakup scene twice with the exact same words and opposite hidden actions.',
    'Film the same 4–6 minute breakup scene twice using the exact same script, same framing, and same basic blocking. In Version A, your hidden action is to win them back without admitting that directly. In Version B, your hidden action is to make them hate you so they leave first. Include the line: “You can stop pretending now.”',
    'Prove total control of action, subtext, adjustment, and reinterpretation of text without changing the writing.',
    'Two contrasting versions of the same scene where the hidden action completely changes the meaning.',
    [
      'Same script in both versions.',
      'Same framing and same basic blocking.',
      'Use the line: “You can stop pretending now.”',
      'Only the hidden action and behavior may change.',
      'Both versions must feel truthful and fully playable.',
    ],
    'boss',
    `This is actor-proof work: the same text must become two different realities. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This is one of the clearest proofs that acting lives in action, not wording alone. If the hidden objective genuinely changes, the same text becomes a different event. If it does not, the actor is probably relying on line interpretation rather than playable behavior.'
  ),
};
const SELFTAPE_BOSSES: Record<number, LessonSeed> = {
  8: makeSeed(
    'Self Tape Boss 1 — Clean Audition Tape',
    'Boss',
    'Create a simple, professional self tape that proves you understand the basics.',
    `This boss is your first full self-tape checkpoint. Treat it like a real audition request.

Before filming:
1. Go to Featured and watch 2 creative submissions.
2. Leave one useful comment on each.
3. Check your own setup: frame, light, sound, background, eyeline.
4. Do a short breath and voice reset before recording.

Setup requirements:
- Landscape frame unless your app/audition instructions say otherwise.
- Camera at eye level or slightly above.
- Frame from just above the head to mid-chest.
- Clean background.
- Light coming from the front or front-side.
- Reader, if used, placed near the camera and quieter than you.
- If no reader is available, perform it as a solo monologue.

SLATE:
“Hi, my name is [your name]. I am reading for [role]. I am based in [city/country].”

SCENE / MONOLOGUE:
“I know this is probably not the perfect version.
I can hear the little voice in my head already.
The light could be better.
My hands look strange.
I should have waited until I felt ready.
But ready is starting to feel like another word for hiding.
So I am doing it now.
Not perfectly.
Not magically.
Honestly.
And maybe that is the first useful thing I have done all day.”

As if 1:
You are an actor sending your first serious audition tape after years of fear.

As if 2:
You are apologizing to someone who stopped believing you would ever show up.

As if 3:
You are making a final video message before leaving your old life behind.

As if 4:
You are a public figure making a statement after a humiliating failure.

As if 5:
You are speaking directly to casting, not begging them, but asking them to really watch you.

Final task:
Record 3 different takes using 3 different as-ifs. Submit the strongest one.`,
    'Prove you can create a clean, watchable self tape with basic professional standards and truthful acting.',
    'One finished self tape with a simple slate, clean setup, and one selected final monologue take.',
    [
      'Comment on 2 Featured submissions before filming.',
      'Use clean framing, lighting, and audio.',
      'Record at least 3 as-if versions.',
      'Choose the take that feels most truthful, not the take where you look best.',
      'Do not add music, filters, or dramatic editing.',
    ],
    'boss',
    `Your tape should feel clean, simple, and easy to watch. The performance should feel alive without being overproduced. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Boss 1 tests the foundation of self-taping. Casting should never struggle to see you, hear you, or understand the scene. Once the setup is clean, the actor’s job is to make the moment specific, truthful, and watchable.'
  ),

  16: makeSeed(
    'Self Tape Boss 2 — Five As-If Audition Range',
    'Boss',
    'Use one monologue to prove that imagination can completely transform a self tape.',
    `This boss tests range without changing the words. You will perform the same monologue in five completely different ways.

Before filming:
1. Do a voice warm-up: hum gently, release the jaw, speak the first line on breath.
2. Choose a clean frame and consistent eyeline.
3. Do not change costume, camera angle, or background between takes.
4. Let only the inner world change.

MONOLOGUE:
“You keep saying I have changed.
Maybe I have.
Or maybe I just stopped translating myself into a language that made you comfortable.
I used to soften everything.
My opinions.
My anger.
My ambition.
Even my happiness, if it made the room feel uneven.
But I am tired of being easy to be around.
I would rather be difficult and honest than loved for disappearing.”

Take 1 — Romantic Drama:
As if you are ending a relationship with someone who only loved the smaller version of you.

Take 2 — Political Thriller:
As if you are a young leader refusing to be controlled by advisors who underestimated you.

Take 3 — Coming-of-Age:
As if you are telling your family you are leaving home to become an actor, and they think it is a fantasy.

Take 4 — Villain Origin:
As if this is the moment a kind person becomes dangerous because nobody listened when they were gentle.

Take 5 — Dark Comedy:
As if you are trying to sound empowered but are still embarrassingly desperate for the other person to say they are proud of you.

Final task:
Film all five versions. Watch them back. Submit your strongest two takes: one most emotionally truthful, one most surprising.`,
    'Prove you can make bold, playable choices and transform the same material without relying on gimmicks.',
    'Five takes of the same monologue, with two selected final versions.',
    [
      'Keep the text exactly the same in every take.',
      'Change the stakes, relationship, rhythm, and objective.',
      'Do not just change volume or facial expression.',
      'Submit two final takes: truthful and surprising.',
      'Include a short note explaining why you chose them.',
    ],
    'boss',
    `The five takes should feel like five different audition briefs, not five moods. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Boss 2 tests imagination and range. Real range is not “sad, angry, happy.” Real range comes from different circumstances, different relationships, different stakes, and different objectives. The words stay the same, but the world changes.'
  ),

  24: makeSeed(
    'Self Tape Boss 3 — Technical Rescue Tape',
    'Boss',
    'Diagnose a weak self tape and rebuild it into a professional one.',
    `This boss tests whether you can fix your own tape before submitting it.

Part 1 — Record the weak version on purpose:
Film 20 seconds of the monologue with at least 3 problems:
- Bad backlight.
- Camera too low.
- Messy background.
- Reader too loud.
- Sound too far away.
- Too much movement.
- Eyeline too far from lens.

Part 2 — Diagnose:
Watch it back and write down:
1. What makes it hard to watch?
2. What hides the acting?
3. What makes the sound or image feel unprofessional?
4. What would casting notice before they notice the performance?

Part 3 — Fix:
Correct the setup and film the same monologue again.

MONOLOGUE:
“I watched the first version and wanted to delete it.
Not because it was hopeless.
Because it told the truth too clearly.
I had made everything harder than it needed to be.
The room was fighting me.
The light was fighting me.
Even the angle made me look like I was apologizing for existing.
So I fixed what I could.
Not everything.
Just enough to stop hiding behind the mess.
Now, if this works or fails, at least it is really me.”

As if 1:
You are an actor learning to stop sabotaging your own auditions.

As if 2:
You are a filmmaker correcting a scene after realizing the technical choices were killing the story.

As if 3:
You are a person cleaning up their life before asking for a second chance.

As if 4:
You are a detective reconstructing a mistake that nearly cost someone their life.

As if 5:
You are in a comedy and horrified by how dramatic your bad first setup looked.

Final task:
Submit the before-and-after tape, or submit the improved final tape with a short note explaining the 3 fixes you made.`,
    'Prove you can identify and correct common self-tape problems without expensive equipment.',
    'A before-and-after self tape showing clear improvement in framing, lighting, sound, and performance focus.',
    [
      'Create a weak version intentionally.',
      'Fix at least 3 technical issues.',
      'Keep the acting truthful in the improved version.',
      'Do not use filters, music, or heavy editing to hide problems.',
      'Explain the technical fixes you made.',
    ],
    'boss',
    `The final tape should be obviously cleaner, calmer, and easier to watch than the first version. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Boss 3 trains self-diagnosis. Many actors lose auditions because of fixable technical issues. You do not need a studio. You need awareness: light the face, clean the frame, hear the words, stabilize the camera, and let the acting become visible.'
  ),

  32: makeSeed(
    'Self Tape Boss 4 — Fictional Casting Brief',
    'Boss',
    'Respond to a casting brief like a professional actor.',
    `This boss gives you a fictional casting brief. Follow it exactly.

CASTING BRIEF:
Project: Independent feature film.
Tone: grounded drama with thriller tension.
Role: A young creative who discovers someone close to them has been using their work without permission.
Tape request:
- Slate at the beginning.
- One close self-tape frame.
- No music.
- No props unless essential.
- Keep performance intimate.
- Show restraint, not melodrama.
- Submit one final take.

Before filming:
Go to Featured and comment on 3 submissions:
1. One performance note.
2. One technical note.
3. One moment that made you keep watching.

SLATE:
“Hi, my name is [your name]. I am reading for the role of [role]. I am based in [city/country].”

MONOLOGUE:
“I saw my words in your mouth.
That is the part I cannot stop thinking about.
Not the opportunity.
Not the money.
Not even the fact that everyone clapped.
It was the ease of it.
The way you stood there and wore my life like it fitted you better.
I kept waiting for you to look at me.
Just once.
Some tiny signal that you knew what you had taken.
But you smiled.
You thanked them.
You called it your truth.
And I sat there wondering how much of myself I would have to lose before anyone noticed it was missing.”

Director note 1:
Do it as quiet betrayal. You still love the person and hate that you do.

Director note 2:
Do it as controlled rage. You have already decided what you are going to do next.

Director note 3:
Do it as public humiliation. You are speaking moments after seeing it happen in front of a crowd.

Director note 4:
Do it as a thriller. The person you are speaking to is more powerful than you and may destroy your career.

Director note 5:
Do it as an artist reclaiming themselves. The pain is there, but the final beat becomes strength.

Final task:
Film at least 3 director-note versions. Submit the one that best fits the casting brief.`,
    'Prove you can follow a brief, apply direction, and deliver a complete audition package.',
    'A slate plus one final selected self tape that matches the fictional casting brief.',
    [
      'Follow every instruction in the casting brief.',
      'Comment on 3 Featured submissions before filming.',
      'Record at least 3 directed versions.',
      'Choose the take that best fits the project tone, not just the biggest performance.',
      'Keep the final tape clean, intimate, and professional.',
    ],
    'boss',
    `The final tape should feel like it belongs in the fictional film described by the brief. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Boss 4 tests audition discipline. Casting briefs are not suggestions. A professional actor reads the instructions, understands tone, follows technical requirements, and still brings bold imaginative life to the role.'
  ),

  40: makeSeed(
    'Self Tape Boss 5 — Professional Audition Package',
    'Boss',
    'Create your strongest complete self-tape package and choose yourself with confidence.',
    `This is the final self-tape boss. Treat it like a real professional audition package.

Full preparation:
1. Go to Featured and leave 3 useful comments on other creatives’ work.
2. Do 3 minutes of semi-supine breath release.
3. Hum gently into resonance.
4. Warm articulation with lips, tongue, jaw, and breath.
5. Choose one piece of private music for the character’s emotional world.
6. Turn the music off before recording.
7. Check frame, light, sound, background, and eyeline.
8. Record three radically different takes.
9. Watch them back once.
10. Choose the strongest final take.

SLATE:
“Hi, my name is [your name]. I am reading for [role]. I am based in [city/country].”

FINAL MONOLOGUE:
“If this is the only chance I get, then I do not want to waste it pretending.
I have done that already.
I have made myself smaller for rooms that were never going to choose me.
I have laughed at jokes that cut me.
I have thanked people for scraps and called it opportunity.
I have waited outside doors that were not locked, just because no one invited me through.
But I am tired now.
Not defeated.
Tired in the way a match is tired before it becomes fire.
So look at me properly.
Not as the safe choice.
Not as the obvious one.
As the person standing here with nothing polished left to hide behind.
This is what I have.
This voice.
This body.
This life.
This take.”

Take 1 — The Unknown Actor:
You are sending the audition that could change your life. You are scared, but the fear sharpens you.

Take 2 — The Revolutionary:
You are speaking before the first public act of rebellion. If the room believes you, everything changes.

Take 3 — The Comeback:
You are returning after public humiliation. People think you are finished. You know this is the beginning.

Take 4 — The Future Star:
You are the young lead nobody expected to be dangerous, elegant, intelligent, and impossible to ignore.

Take 5 — The Ghost:
This recording is the only proof you were here. You need one living person to remember you.

Take 6 — The Closed Door:
You are speaking to every gatekeeper who underestimated you and realizing you no longer need permission.

Take 7 — The Final Audition:
Casting has nearly made their decision. This is the take that makes them stop, lean in, and reconsider.

Final package:
- Slate.
- One chosen final take.
- Clean export.
- No music under the scene.
- No visual effects.
- No apology note.
- Optional short reflection: “I chose this take because…”`,
    'Prove you can deliver a professional self tape package with technical clarity, acting truth, imaginative range, and final-take judgment.',
    'A complete final self tape package: slate, polished final monologue, clean technical presentation, and optional short reflection.',
    [
      'Comment on 3 Featured submissions before filming.',
      'Use real actor preparation before recording.',
      'Record at least 3 radically different takes.',
      'Choose the most alive and castable take.',
      'Submit cleanly without over-editing, music, filters, or apologies.',
    ],
    'boss',
    `This should feel like your strongest current self tape: technically clean, emotionally alive, specific, bold, and professional. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Boss 5 is the full integration test. Self-tape mastery means preparation, technical control, imaginative boldness, emotional truth, and judgment. The final tape does not need to be perfect. It needs to be clear, alive, and unmistakably yours.'
  ),
};

const CINEMATOGRAPHY_BOSSES: Record<number, LessonSeed> = {
  8: makeSeed(
    'Cinematography Boss 1 — One Room, Three Moods',
    'Boss',
    'Shoot the same room and same blocking three completely different ways.',
    'Use one room and one short piece of action: a person enters, sits, reads a note, and looks toward the door. Shoot it 3 times so the room reads as intimacy, threat, and grief. Keep the same blocking and performance beats. Only framing, lens choice, camera height, lighting, and distance may change.',
    'Prove you can create emotional meaning through image design rather than script changes.',
    'Three short visual versions of the same scene with clearly different emotional readings.',
    [
      'Same room and same blocking in all 3 versions.',
      'No dialogue changes.',
      'Only image choices may change the mood.',
      'Each version must include one wide, one medium, and one close-up.',
      'The three moods must be instantly distinguishable.',
    ],
    'boss',
    `This proves whether you can tell story with image, not just coverage. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This is pure cinematography authorship. The same event can feel tender, threatening, or mournful depending on lens, distance, height, exposure, contrast, and framing logic. The image itself is the interpretation.'
  ),
  16: makeSeed(
    'Cinematography Boss 2 — The Window Light Decision',
    'Boss',
    'Build a morning decision scene around natural light and one motivated practical.',
    'Film a 2–4 minute scene where a person wakes before sunrise, reads a text, and decides whether to leave. Window light must be the main source. You may use one practical lamp only. The scene must include one wide, two mediums, two close-ups, and one insert of the phone or hand.',
    'Prove you can control motivated light, exposure, continuity, and emotional image design in a limited setup.',
    'A finished low-light morning scene that feels believable, intentional, and cinematic.',
    [
      'Window light must be the main source.',
      'Only one practical lamp is allowed.',
      'Include one wide, two mediums, two close-ups, and one insert.',
      'The room must stay believable.',
      'Faces must remain readable without killing the mood.',
    ],
    'boss',
    `This should feel like lived-in light, not obviously lit light. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Naturalistic light is not the absence of design. The real skill is making motivated light feel emotionally exact while still believable. This challenge is about discipline, not quantity of gear.'
  ),
  24: makeSeed(
    'Cinematography Boss 3 — The Hallway Reveal',
    'Boss',
    'Reveal danger through framing and duration instead of cutting to coverage.',
    'Film a 2–4 minute hallway or doorway suspense scene where a person hears something outside a bedroom or apartment door. The source of danger must be revealed through reframing or movement inside the shot, not through a cutaway insert. Hold at least one shot for 12 seconds or longer.',
    'Prove you can create suspense and reveal information through composition, withholding, and visual patience.',
    'A finished suspense scene where the reveal lands because of framing and timing.',
    [
      'No cutaway insert for the reveal.',
      'Hold at least one shot for 12 seconds or longer.',
      'Use one foreground obstruction in at least 2 shots.',
      'Handheld is only allowed if clearly motivated by fear.',
      'The reveal must change how the audience reads the scene.',
    ],
    'boss',
    `You are directing the viewer’s fear through the frame itself. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Withholding information inside the frame can be more powerful than cutting to it. This exercise trains patience, composition, and confidence in visual suspense rather than coverage-based explanation.'
  ),
  32: makeSeed(
    'Cinematography Boss 4 — The Lens Distance Test',
    'Boss',
    'Shoot the same emotional beat with radically different lens relationships.',
    'Film the same short exchange 3 ways using the line: “You’re late.” Version 1: physically close on a wider lens. Version 2: physically distant on a longer lens. Version 3: a balanced neutral coverage version. The emotional read of the line must feel different in each version.',
    'Prove you understand how focal length, camera distance, and composition affect psychology.',
    'Three versions of the same beat where lensing changes the emotional relationship.',
    [
      'Use the same line in all 3 versions.',
      'One version must be wide and physically close.',
      'One version must be long lens and physically far.',
      'One version must be neutral.',
      'The emotional reading must change between versions.',
    ],
    'boss',
    `The audience should feel the lens choice, even if they do not know why. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Lensing is not only technical coverage choice. Camera distance and focal length alter intimacy, aggression, vulnerability, surveillance, and pressure. This is psychology through optics.'
  ),
  40: makeSeed(
    'Cinematography Boss 5 — The Stairwell Descent',
    'Boss',
    'Build a complete visual sequence around regret, descent, and aftermath.',
    'Film a 3–5 minute no-dialogue sequence in which a character walks down a stairwell immediately after doing something they regret. The sequence must include one top angle, one profile moving shot, one hand or shoe insert, one close-up pause, and one final locked-off frame at the bottom.',
    'Prove you can author a full emotional sequence through image progression, movement, and visual control.',
    'A finished no-dialogue visual sequence with a clear emotional arc from the first step to the final frame.',
    [
      'No dialogue.',
      'Include one top angle, one profile moving shot, one insert, one close-up pause, and one final locked-off frame.',
      'Color temperature must help the mood.',
      'The final frame must land emotionally.',
      'The sequence must feel complete without explanatory text.',
    ],
    'boss',
    `This should feel like visual storytelling with real authorship. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This is a full visual progression exercise. The audience should feel emotional descent through angle, movement, duration, scale, and final stillness, not through explanation or dialogue.'
  ),
};

const DIRECTING_BOSSES: Record<number, LessonSeed> = {
  8: makeSeed(
    'Directing Boss 1 — The No Line Reading Scene',
    'Boss',
    'Direct actors toward playable behavior without telling them how to say the lines.',
    'Direct a 3–5 minute scene where one friend asks another to lie in court tomorrow. In rehearsal, you are not allowed to give line readings. You may only direct using objective, tactic, stakes, what changed, and who has power now. Halfway through the scene, the person resisting must become the more dangerous one.',
    'Prove you can direct actors through intention and dramatic action rather than performance imitation.',
    'A finished scene where the performances feel alive, not indicated.',
    [
      'No line readings in rehearsal.',
      'You may only direct through objective, tactic, stakes, change, and power.',
      'The resisting character must become more dangerous halfway through.',
      'The scene must be 3–5 minutes.',
      'The turn must feel behavioral, not announced.',
    ],
    'boss',
    `This is directing, not puppeteering. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Strong directing usually gives actors a playable path, not a performed result to imitate. This challenge trains you to direct behavior, objective, and scene pressure instead of becoming a line-reading machine.'
  ),
  16: makeSeed(
    'Directing Boss 2 — The Blocking Rewrite',
    'Boss',
    'Discover the best version of a scene by staging it three different ways.',
    'Take one short 2-page scene and stage it 3 ways: Version 1 with both actors seated the entire time, Version 2 with one standing and one seated, Version 3 with both moving and one attempted exit through a doorway. Choose the strongest version and film that version only.',
    'Prove you can use blocking to reveal power, pressure, and scene shape.',
    'A finished scene whose blocking clearly supports the dramatic engine.',
    [
      'Use the same scene text in all 3 rehearsed versions.',
      'Stage it seated, split-level, and moving.',
      'One version must include an attempted exit.',
      'Film only the strongest version.',
      'The final staging must clearly support the power dynamic.',
    ],
    'boss',
    `The room should direct the scene as much as the dialogue does. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Blocking is revision. When you restage a scene, you are often rewriting its meaning physically. This teaches that directing is not just covering text — it is discovering the strongest social and dramatic architecture for the text.'
  ),
  24: makeSeed(
    'Directing Boss 3 — Dinner Table Pressure',
    'Boss',
    'Direct an ensemble scene where accusation lives under politeness until it can no longer stay hidden.',
    'Direct a 4–6 minute dinner table scene with 4 actors. One character knows another has stolen money, but no one may state the accusation directly until the final minute. At least 2 silent reactions must matter, and one actor must leave and re-enter the table.',
    'Prove you can manage subtext, ensemble behavior, silent story beats, and scene escalation.',
    'A finished ensemble scene where pressure moves around the table before the accusation surfaces.',
    [
      '4 actors required.',
      'No direct accusation until the final minute.',
      'At least 2 silent reactions must matter.',
      'One actor must leave and re-enter.',
      'The scene must end before full resolution.',
    ],
    'boss',
    `This should feel alive in every corner of the frame, not just where the lines are. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Ensemble directing means the whole room is active storytelling material. Silence, exits, re-entries, reactions, and who is watching whom are all part of the scene, not background.'
  ),
  32: makeSeed(
    'Directing Boss 4 — Table Read to Rewrite',
    'Boss',
    'Diagnose what is weak in a scene, then improve it through direction and rewrite.',
    'Write or choose a short confrontation scene, do a table read with actors, note where the scene drags or confuses them, then rewrite no more than 20 percent of the dialogue before filming the improved version. The filmed version must include one major turn where the power dynamic changes.',
    'Prove you can use rehearsal and actor response to improve a scene before the camera rolls.',
    'A finished confrontation scene that clearly benefits from diagnosis and revision.',
    [
      'Do a table read before filming.',
      'Rewrite no more than 20 percent of the dialogue.',
      'The filmed version must include one major power shift.',
      'Do not solve everything through new lines.',
      'The improvement must come from both rewrite and direction.',
    ],
    'boss',
    `Real directing includes rewriting with the actors and the room in mind. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Directing includes diagnosis. Table reads often expose what is unclear, static, overwritten, or emotionally thin. The skill is learning what to rewrite, what to restage, and what to fix through performance and rhythm instead of extra dialogue.'
  ),
  40: makeSeed(
    'Directing Boss 5 — The Unequal Power Scene',
    'Boss',
    'Direct a scene where one person holds structural power from frame one, but loses one crucial beat by the end.',
    'Direct a 3–4 minute scene between a teacher and student, boss and employee, parent and child, or older sibling and younger sibling. The stronger character asks a question the weaker character cannot answer honestly. No one may cry or yell. By the end, the weaker character must win one beat of control without fully taking over the scene.',
    'Prove you can direct tonal restraint, power imbalance, and a precise shift in scene authority.',
    'A finished power scene where the imbalance is strong from the first frame and still evolves.',
    [
      'Use a structurally unequal relationship.',
      'No crying or yelling.',
      'The stronger character must hold power from frame one.',
      'The weaker character must win one beat by the end.',
      'The shift must feel earned, not sentimental.',
    ],
    'boss',
    `The scene should feel sharp, adult, and controlled. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Great power scenes are rarely about total reversal. Often the most interesting version is when the weaker person wins one beat, one moment of truth, or one refusal, without fully taking over the structure of power.'
  ),
};

const SOUND_BOSSES: Record<number, LessonSeed> = {
  8: makeSeed(
    'Sound Boss 1 — Rebuild the Kitchen Scene',
    'Boss',
    'Rebuild a simple everyday scene entirely through clean layered sound.',
    'Take a 20–40 second scene of someone entering a kitchen and making tea or coffee. Mute the production sound and rebuild it from scratch using room tone, footsteps, kettle handle, water pour, mug or spoon detail, chair scrape, and distant outside ambience.',
    'Prove you can create believable sonic space through layering and detail rather than raw production audio.',
    'A finished domestic scene whose sound world feels specific, clean, and fully rebuilt.',
    [
      'Mute the production sound completely.',
      'Use at least 6 sound layers.',
      'No music.',
      'The sequence must remain natural and readable.',
      'The final mix must feel believable, not exaggerated.',
    ],
    'boss',
    `This should sound like a real place with emotional texture, not a pile of effects. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Rebuilding a scene from scratch teaches you that sound is not “extra.” Space, tactility, rhythm, and realism are all being authored. Small domestic sounds can carry huge storytelling weight when layered with intention.'
  ),
  16: makeSeed(
    'Sound Boss 2 — The Offscreen Threat',
    'Boss',
    'Create dread through sound without ever showing the threat.',
    'Build a 1–3 minute apartment or hallway suspense scene where a character waits while someone may or may not be outside the door. The threat is never shown. Use at least 4 offscreen sounds, and one repeated sound must change meaning each time it returns.',
    'Prove you can use offscreen space, repetition, and sonic perspective to tell story.',
    'A finished suspense scene where sound carries the danger more than image does.',
    [
      'The threat must never be shown.',
      'Use at least 4 offscreen sounds.',
      'One repeated sound must change meaning each time.',
      'No musical sting allowed.',
      'The audience must feel the threat through sound design.',
    ],
    'boss',
    `The unseen world should become more vivid than the visible one. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This is about making offscreen space dramatically real. When sound is designed well, the audience feels the invisible world pressing against the frame. Repetition and changing context are what turn a noise into story.'
  ),
  24: makeSeed(
    'Sound Boss 3 — Dialogue Cleanup Rescue',
    'Boss',
    'Take imperfect dialogue and make it emotionally playable without flattening the life out of it.',
    'Record or use a 45–90 second two-person scene with deliberately imperfect sound: one steady appliance hum, one bit of traffic bleed, and one handling or chair scrape problem. Clean the scene so it plays naturally, keeps room tone under the edit, and still feels alive.',
    'Prove you can solve practical sound problems while preserving the truth of the scene.',
    'A cleaned and repaired dialogue scene that feels smooth, natural, and emotionally usable.',
    [
      'Include at least 3 deliberate sound problems.',
      'Keep room tone under the full scene.',
      'No dead silence between cuts.',
      'Do not over-process the dialogue.',
      'The repaired scene must still feel human.',
    ],
    'boss',
    `This is craft under constraint, not just sound polish. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Cleanup is not just technical repair. The real skill is solving problems while preserving performance, breath, tone, and humanity. Good dialogue repair makes a scene playable without making it sterile.'
  ),
  32: makeSeed(
    'Sound Boss 4 — Memory Trigger Motif',
    'Boss',
    'Use a tiny sound as a recurring emotional trigger that changes meaning each time.',
    'Build a 1–3 minute scene where a small sound such as a voicemail beep, spoon in a glass, train brake squeal, or key in a lock occurs 3 times. Each recurrence must land differently and reveal more about the character’s private emotional state without being explained in dialogue.',
    'Prove you can build sonic motif, psychological meaning, and emotional progression through repetition.',
    'A finished scene where one sound becomes a memory trigger with evolving meaning.',
    [
      'Use one small recurring sound exactly 3 times.',
      'Each repetition must feel different.',
      'Do not explain the sound’s meaning in dialogue.',
      'The audience should understand the shift through context and design.',
      'The final repetition must land hardest.',
    ],
    'boss',
    `The sound should become story, not decoration. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Motif is strongest when repetition changes function. The same sound can begin as neutral, then become threatening, then tragic, or nostalgic, depending on where and how it returns. Meaning grows through recurrence and context.'
  ),
  40: makeSeed(
    'Sound Boss 5 — The Silence Drop',
    'Boss',
    'Design a scene where removing sound becomes the most powerful storytelling move.',
    'Create a 1–3 minute confrontation in a hallway, car, kitchen, or bedroom. At the key emotional beat, remove almost all environmental sound for 2–3 seconds, then bring the world back in a way that changes the feeling of the scene. Build the whole scene toward that moment.',
    'Prove you can use subtraction, contrast, and dynamic control as intentional storytelling tools.',
    'A finished dramatic scene where the silence drop feels earned and transforms the moment.',
    [
      'Build toward one key silence-drop moment.',
      'Remove almost all environmental sound for 2–3 seconds.',
      'Bring the world back with intention.',
      'Do not use the silence moment as a gimmick.',
      'The silence must change the emotional reading of the scene.',
    ],
    'boss',
    `The absence of sound should hit harder than any effect you could add. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This is a subtraction exercise. Silence or near-silence only works when the scene has prepared for it. The drop should not feel like a trick; it should feel like the world itself briefly changing shape.'
  ),
};
const EDITING_BOSSES: Record<number, LessonSeed> = {
  8: makeSeed(
    'Editing Boss 1 — The Door Scene Recut',
    'Boss',
    'Use the exact same footage to create 3 completely different scene meanings.',
    'Shoot or gather this exact footage: 1) wide of a woman entering an apartment, 2) medium dropping keys, 3) insert of voicemail notification, 4) close-up listening, 5) reaction, 6) empty hallway, 7) sitting down. Create 3 edits from that material only: thriller, breakup drama, and dark comedy.',
    'Prove you can author meaning through timing, order, sound, and emphasis rather than reshoots.',
    'Three finished edits of the same source material with clearly different tones and story readings.',
    [
      'Use the same footage in all 3 versions.',
      'No reshoots.',
      'Each version must be 45–90 seconds.',
      'Only edit, sound, timing, and order may change.',
      'All 3 versions must feel intentional and complete.',
    ],
    'boss',
    `This is the proof that editing can rewrite reality. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This is editor-as-author work. The footage stays the same, but timing, order, reaction emphasis, and sound design can completely rewrite tone and meaning. Editing is interpretation, not assembly alone.'
  ),
  16: makeSeed(
    'Editing Boss 2 — The Reaction Timing Test',
    'Boss',
    'Show how meaning changes when you change only when we see the reaction.',
    'Use one dialogue scene where a character says: “He knew the whole time.” Create 3 edits: one with an immediate reaction cut, one with a delayed reaction cut, and one with no reaction cut at all.',
    'Prove you understand emotional emphasis, withholding, and scene meaning through reaction timing.',
    'Three short versions of the same scene where the reaction placement changes the emotional result.',
    [
      'Use the same source footage in all 3 versions.',
      'No music.',
      'Do not change the dialogue order.',
      'Only change the reaction timing and shot emphasis.',
      'You should be able to describe how each version changes the meaning.',
    ],
    'boss',
    `A single reaction cut can rewrite the scene. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Reaction placement is one of the cleanest tests of editorial intelligence. Showing the face immediately, delaying it, or refusing it altogether each creates a different emotional structure.'
  ),
  24: makeSeed(
    'Editing Boss 3 — The Bad Performance Rescue',
    'Boss',
    'Take flawed material and cut it into the strongest scene possible.',
    'Shoot or use 3 intentionally uneven takes of the same short scene: one rushed, one flat, and one overacted. Build the strongest possible finished version using at least 2 of those flawed takes. The final scene must still feel truthful.',
    'Prove you can rescue material through selection, trimming, reaction use, and editorial judgment.',
    'A finished short dramatic scene that feels stronger than the raw takes have any right to be.',
    [
      'Use at least 2 flawed takes.',
      'No ADR.',
      'No music.',
      'Maximum 90 seconds.',
      'The final cut must feel playable and emotionally coherent.',
    ],
    'boss',
    `Real editors do not always get perfect footage. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Rescue editing is one of the hardest real-world skills. It trains you to protect the truth that is available, not the perfection you wish had been shot.'
  ),
  32: makeSeed(
    'Editing Boss 4 — Pack the Bag / Miss the Bus',
    'Boss',
    'Control time by turning the same practical sequence into compression and suspense.',
    'Shoot this exact action: open drawer, grab passport, miss one item, zip bag, check phone, sprint out, arrive too late at bus stop. Build 2 edits from that same material: a 25-second compressed version and a 75-second suspense version.',
    'Prove you can shape time, clarity, and emotional experience through editorial structure.',
    'Two finished edits of the same sequence with radically different temporal feeling.',
    [
      'Use the same source footage for both versions.',
      'One version must be 25 seconds.',
      'One version must be 75 seconds.',
      'The sequence must stay readable in both versions.',
      'The suspense version must build real pressure, not just run longer.',
    ],
    'boss',
    `Time is one of the editor’s strongest weapons. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Editors control time more directly than almost any other department. Compression and expansion are not just speed choices — they are emotional and structural decisions about what the audience should feel.'
  ),
  40: makeSeed(
    'Editing Boss 5 — Recut an Old Film',
    'Boss',
    'Take an older piece of your own and transform its meaning or quality through re-editing.',
    'Choose an old short film, scene, trailer, or montage you already made. You may reshoot no more than 20 percent of it. Rebuild the rest through re-editing, restructuring, sound changes, pacing, and emphasis so the final piece feels clearly stronger or differently authored.',
    'Prove you can diagnose weak material and fully reshape it through editorial authorship.',
    'A finished before-and-after transformation piece built around your own older work.',
    [
      'Use an existing old piece you already made.',
      'You may reshoot no more than 20 percent.',
      'The transformation must come mainly from re-editing.',
      'The final piece must feel clearly stronger or more intentional.',
      'It must stand on its own as a finished short piece.',
    ],
    'boss',
    `This is editor-as-author work, not just cleanup. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: Recutting your own work is a brutal but valuable lesson. It teaches diagnosis, humility, and authorship: what was weak in writing, coverage, rhythm, performance emphasis, or sound, and what can still be saved in post.'
  ),
};

const FILMMAKER_BOSSES: Record<number, LessonSeed> = {
  8: makeSeed(
    'Filmmaker Boss 1 — The Bus Stop Film',
    'Boss',
    'Build a complete short around one meeting, one withheld truth, and one irreversible ending.',
    'Make a 5–7 minute short film set at one bus stop, train stop, or roadside bench. One person is waiting for someone who is not coming. Another person arrives with information they should not have. The film must include one silent opening stretch, one reveal at minute 3 or later, and one final image that changes how we read the scene.',
    'Prove you can combine performance, directing, image, sound, and editing into one complete dramatic engine.',
    'A finished one-location short film with a clear reveal structure and a strong final image.',
    [
      'One location only.',
      'Two actors only.',
      '5–7 minutes.',
      'Include one silent opening stretch.',
      'Place the reveal at minute 3 or later.',
      'End on one final image that redefines the scene.',
    ],
    'boss',
    `This should feel like a real short film built from pressure, not filler. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This is full-stack storytelling under pressure. Writing sets the withheld truth, acting carries the waiting, directing shapes power, camera controls access, sound opens the unseen world, and editing decides when the reveal actually becomes irreversible.'
  ),
  16: makeSeed(
    'Filmmaker Boss 2 — The Missed Call Film',
    'Boss',
    'Tell a complete present-tense short about one call that should have been answered.',
    'Make a short film where a character ignores a call, then gradually realizes that was the wrong decision. The phone screen may appear only once. No flashbacks are allowed. The story must be told through present action, sound, behavior, and consequence only.',
    'Prove you can build cause and effect through visual storytelling and restraint.',
    'A finished short film where a missed call becomes the engine of the whole story.',
    [
      'The phone screen may appear only once.',
      'No flashbacks.',
      'Maximum 6 minutes.',
      'The story must stay in the present.',
      'The emotional meaning of the call must grow over time.',
    ],
    'boss',
    `The audience should feel the wrong decision spreading through the film. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This is a great filmmaker exercise because it forces cause-and-effect across departments. Writing sets the problem, acting shows denial, sound carries the unseen consequences, and editing controls the spread of realization.'
  ),
  24: makeSeed(
    'Filmmaker Boss 3 — The Corridor Film',
    'Boss',
    'Build a film around a walk toward one conversation that changes before it begins.',
    'Make a short film in which a character walks a corridor, hallway, or exterior path to ask for forgiveness, but by the time they arrive their objective has changed. The film must include one walking shot, one locked shot, one insert, one over-the-shoulder, and one close-up reaction. Use practical lighting only.',
    'Prove you can design sequence, objective shift, image plan, and emotional structure across departments.',
    'A finished short film where the walk itself becomes a dramatic build-up to the changed objective.',
    [
      'Use one walking shot, one locked shot, one insert, one over-the-shoulder, and one close-up reaction.',
      'Practical lighting only.',
      'The character’s objective must change before arrival.',
      'No voiceover.',
      'The final conversation must feel changed by the walk.',
    ],
    'boss',
    `The journey should do dramatic work, not just connect two scenes. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This challenge is about sequence design. A complete filmmaker learns that walking can be drama if objective, sound, framing, and rhythm are all evolving. Transit itself can become the scene.'
  ),
  32: makeSeed(
    'Filmmaker Boss 4 — The Re-Edit + Reshoot Film',
    'Boss',
    'Take an older short piece and turn it into a better film through both diagnosis and invention.',
    'Choose one old film, scene, or abandoned piece you already made. Reshoot no more than 20 percent of it, then completely rebuild the piece through a new edit, revised structure, improved sound, and stronger emphasis. The new version should clearly outperform the old one.',
    'Prove you can think like a total filmmaker by improving writing, directing, image, sound, and edit through revision.',
    'A finished transformed film built from an old piece and a smarter new version of it.',
    [
      'Start from an existing older piece.',
      'Reshoot no more than 20 percent.',
      'The new version must clearly differ in meaning, quality, or structure.',
      'Sound and pacing must be improved deliberately.',
      'The final piece must stand alone as a finished film.',
    ],
    'boss',
    `Revision is part of being a filmmaker, not a sign of failure. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This is one of the most professional filmmaker tests in the whole path. Revision forces you to think like writer, director, editor, sound designer, and producer at once. You learn what was actually missing, not just what bothered you emotionally.'
  ),
  40: makeSeed(
    'Filmmaker Boss 5 — The Caregiver Room Film',
    'Boss',
    'Create a complete no-dialogue short where one room, one actor, and one object carry the entire story.',
    'Make a short film about a caregiver preparing a room for someone who is never coming back. Use one actor, one room, and no dialogue. One object in the room must change meaning by the end. Sound must carry at least half the story. The film should build to one final action or non-action that lands emotionally.',
    'Prove complete authorship across acting, directing, cinematography, editing, and sound under severe constraint.',
    'A finished no-dialogue short film that feels precise, emotional, and fully authored.',
    [
      'One actor only.',
      'One room only.',
      'No dialogue.',
      'Maximum 4 minutes.',
      'One object must change meaning by the end.',
      'Sound must carry at least half the story.',
    ],
    'boss',
    `If this works, it will feel like real filmmaking with nothing to hide behind. ${BOSS_COMMUNITY_NOTE}`,
    'Learning: This is the purest full-filmmaker test in the whole system. With no dialogue, minimal cast, one room, and one object, the film has to work because behavior, image, sound, rhythm, and ending all support the same emotional truth.'
  ),
};
/* ------------------------------ helpers ------------------------------ */
function durationForStep(step: number, boss?: boolean) {
  if (boss) {
    if (step <= 8) return '2–4 min film';
    if (step <= 16) return '3–5 min film';
    if (step <= 24) return '4–6 min film';
    if (step <= 32) return '5–8 min film';
    return '6–10 min film';
  }

  if (step <= 8) return '10–20 min';
  if (step <= 16) return '15–30 min';
  if (step <= 24) return '20–40 min';
  if (step <= 32) return '25–50 min';
  return '30–60 min';
}

function xpForStep(step: number, boss?: boolean) {
  return boss ? 115 + step * 4 : 22 + step * 2;
}

function surgeryStep(step: number) {
  return false;
}

function missionForStep(step: number): Mission | null {
  if (step % 12 === 0) {
    return {
      id: step,
      title: 'Remote Collaboration Mission',
      description:
        'Collaborate with someone outside your city. Trade an idea, performance, sound bed, edit, or footage and build something together.',
      reward: '+50 Mission XP',
      type: 'remote',
      icon: 'globe-outline',
    };
  }

  if (step % 9 === 0) {
    return {
      id: step,
      title: 'City Group Meet Mission',
      description:
        'Connect with someone from your city group chat and create a tiny scene, visual exercise, or micro-film together.',
      reward: '+40 Mission XP',
      type: 'city',
      icon: 'people-outline',
    };
  }

  if (step % 7 === 0) {
    return {
      id: step,
      title: 'Crew-Up Mission',
      description:
        'Find another user with a different discipline than yours and make a short piece together this week.',
      reward: '+35 Mission XP',
      type: 'crew-up',
      icon: 'sparkles-outline',
    };
  }

  return null;
}

function buildLessonsFromBase(
  base: LessonSeed[],
  bosses: Record<number, LessonSeed>,
  total = 40
): Lesson[] {
  const lessons: Lesson[] = [];

  for (let step = 1; step <= total; step += 1) {
    const isBoss = step % 8 === 0;
    const mission = missionForStep(step);

    if (isBoss) {
      const boss = bosses[step];

      if (!boss) {
        throw new Error(`Missing boss lesson for step ${step}`);
      }

       lessons.push({
        id: step,
        step,
        title: boss.title,
        subtitle: 'Boss',
        description: boss.description,
        challenge: boss.challenge,
        objective: boss.objective,
        deliverable: boss.deliverable,
        bonusNote: boss.bonusNote,
        kind: 'boss',
        constraints: boss.constraints,
        xp: xpForStep(step, true),
        duration: durationForStep(step, true),
        isBoss: true,
        requiresSurgery: false,
        missionType: mission?.type || null,
        learning: boss.learning || '',
      });
    } else {
      const normalIndex = step - Math.floor(step / 8) - 1;
      const item = base[normalIndex];

      if (!item) {
        throw new Error(
          `Missing lesson for step ${step} in path bank. normalIndex=${normalIndex}, bankLength=${base.length}`
        );
      }

      lessons.push({
        id: step,
        step,
        title: item.title,
        subtitle: item.subtitle,
        description: item.description,
        challenge: item.challenge,
        objective: item.objective,
        deliverable: item.deliverable,
        bonusNote: item.bonusNote,
        kind: item.kind,
        constraints: item.constraints,
        xp: xpForStep(step, false),
        duration: durationForStep(step, false),
        requiresSurgery: surgeryStep(step),
        missionType: mission?.type || null,
        learning: item.learning || '',
      });
    }
  }

  return lessons;
}

function buildEditingLessons(total = 40): Lesson[] {
  const lessons: Lesson[] = [];

  for (let step = 1; step <= total; step += 1) {
    const isBoss = step % 8 === 0;
    const mission = missionForStep(step);

    if (isBoss) {
      const boss = EDITING_BOSSES[step];

      if (!boss) {
        throw new Error(`Missing editing boss lesson for step ${step}`);
      }

      lessons.push({
        id: step,
        step,
        title: boss.title,
        subtitle: 'Boss',
        description: boss.description,
        challenge: boss.challenge,
        objective: boss.objective,
        deliverable: boss.deliverable,
        bonusNote: boss.bonusNote,
        kind: 'boss',
        constraints: boss.constraints,
        xp: xpForStep(step, true),
        duration: durationForStep(step, true),
        isBoss: true,
        requiresSurgery: false,
        missionType: mission?.type || null,
        learning: boss.learning || '',
      });
    } else {
      const normalIndex = step - Math.floor(step / 8) - 1;

      let item: LessonSeed;
      if (normalIndex <= 6) {
        item = EDITING_FOUNDATION[normalIndex];
      } else if (normalIndex <= 20) {
        item = EDITING_INTERMEDIATE[normalIndex - 7];
      } else {
        item = EDITING_ADVANCED[normalIndex - 21];
      }

      lessons.push({
        id: step,
        step,
        title: item.title,
        subtitle: item.subtitle,
        description: item.description,
        challenge: item.challenge,
        objective: item.objective,
        deliverable: item.deliverable,
        bonusNote: item.bonusNote,
        kind: item.kind,
        constraints: item.constraints,
        xp: xpForStep(step, false),
        duration: durationForStep(step, false),
        requiresSurgery: surgeryStep(step),
        missionType: mission?.type || null,
        learning: item.learning || '',
      });
    }
  }

  return lessons;
}

function buildFilmmakerLessons(total = 40): Lesson[] {
  const lessons: Lesson[] = [];

  for (let step = 1; step <= total; step += 1) {
    const isBoss = step % 8 === 0;
    const mission = missionForStep(step);

    if (isBoss) {
      const boss = FILMMAKER_BOSSES[step];

      if (!boss) {
        throw new Error(`Missing filmmaker boss lesson for step ${step}`);
      }

      lessons.push({
        id: step,
        step,
        title: boss.title,
        subtitle: 'Boss',
        description: boss.description,
        challenge: boss.challenge,
        objective: boss.objective,
        deliverable: boss.deliverable,
        bonusNote: boss.bonusNote,
        kind: 'boss',
        constraints: boss.constraints,
        xp: xpForStep(step, true) + 20,
        duration: durationForStep(step, true),
        isBoss: true,
        requiresSurgery: false,
        missionType: mission?.type || null,
        learning: boss.learning || '',
      });
    } else {
      const normalIndex = step - Math.floor(step / 8) - 1;
      const item = FILMMAKER_ROTATION[normalIndex];

      lessons.push({
        id: step,
        step,
        title: item.title,
        subtitle: item.subtitle,
        description: item.description,
        challenge: item.challenge,
        objective: item.objective,
        deliverable: item.deliverable,
        bonusNote: item.bonusNote,
        kind: item.kind,
        constraints: [
          ...item.constraints,
          'Think like a complete filmmaker, not just one department.',
        ],
        xp: xpForStep(step, false) + 10,
        duration: durationForStep(step, false),
        requiresSurgery: surgeryStep(step) || item.kind === 'surgery',
        missionType: mission?.type || null,
        learning: item.learning || '',
      });
    }
  }

  return lessons;
}
function buildPathLessons(path: WorkshopPathKey): Lesson[] {
  switch (path) {
    case 'acting':
      return buildLessonsFromBase(ACTING_BASE, ACTING_BOSSES);
          case 'selftape':
      return buildLessonsFromBase(SELFTAPE_BASE, SELFTAPE_BOSSES);
    case 'editing':
      return buildEditingLessons();
    case 'cinematography':
      return buildLessonsFromBase(CINEMATOGRAPHY_BASE, CINEMATOGRAPHY_BOSSES);
    case 'directing':
      return buildLessonsFromBase(DIRECTING_BASE, DIRECTING_BOSSES);
    case 'sound':
      return buildLessonsFromBase(SOUND_BASE, SOUND_BOSSES);
    case 'filmmaker':
      return buildFilmmakerLessons();
    default:
      return buildLessonsFromBase(ACTING_BASE, ACTING_BOSSES);
  }
}
function nodeState(step: number, completedSteps: number[]): NodeState {
  const done = new Set(completedSteps);
  const current =
    Array.from({ length: 40 }, (_, i) => i + 1).find((n) => !done.has(n)) || 40;

  if (done.has(step)) return 'completed';
  if (step === current) return 'current';
  if (step === current + 1 || step < current) return 'unlocked';
  return 'locked';
}

function kindLabel(kind: LessonKind) {
  switch (kind) {
    case 'drill':
      return 'Drill';
    case 'scene':
      return 'Scene';
    case 'constraint':
      return 'Constraint';
    case 'technical':
      return 'Technical';
    case 'boss':
      return 'Boss';
    case 'surgery':
      return 'Surgery';
    case 'collab':
      return 'Collab';
    case 'improv':
      return 'Improv';
    default:
      return 'Lesson';
  }
}

function kindIcon(kind: LessonKind): keyof typeof Ionicons.glyphMap {
  switch (kind) {
    case 'drill':
      return 'flash-outline';
    case 'scene':
      return 'film-outline';
    case 'constraint':
      return 'shapes-outline';
    case 'technical':
      return 'construct-outline';
    case 'boss':
      return 'trophy-outline';
    case 'surgery':
      return 'medkit-outline';
    case 'collab':
      return 'people-outline';
    case 'improv':
      return 'sparkles-outline';
    default:
      return 'ellipse-outline';
  }
}

function missionLabel(type?: MissionType | null) {
  switch (type) {
    case 'city':
      return 'City Mission';
    case 'remote':
      return 'Remote Mission';
    case 'crew-up':
      return 'Crew-Up Mission';
    default:
      return 'Mission';
  }
}

function missionIcon(type?: MissionType | null): keyof typeof Ionicons.glyphMap {
  switch (type) {
    case 'city':
      return 'people-outline';
    case 'remote':
      return 'globe-outline';
    case 'crew-up':
      return 'sparkles-outline';
    default:
      return 'flag-outline';
  }
}

function getSurgeryFilmsForStep(step: number) {
  const first = COMMUNITY_FILMS[(step * 2) % COMMUNITY_FILMS.length];
  const second = COMMUNITY_FILMS[(step * 2 + 3) % COMMUNITY_FILMS.length];
  const third = COMMUNITY_FILMS[(step * 2 + 6) % COMMUNITY_FILMS.length];
  return [first, second, third];
}

const PATH_STAGE_META: Record<
  WorkshopPathKey,
  { title: string; subtitle: string }[]
> = {
  acting: [
    {
      title: 'Chapter 1 — Foundations',
      subtitle:
        'Build truth, listening, subtext, and emotional control on camera.',
    },
    {
      title: 'Chapter 2 — Emotional Control',
      subtitle:
        'Develop pressure, contradiction, vulnerability, and restraint.',
    },
    {
      title: 'Chapter 3 — Conflict & Presence',
      subtitle:
        'Strengthen status shifts, tension, confrontation, and screen presence.',
    },
    {
      title: 'Chapter 4 — Performance Mastery',
      subtitle:
        'Bring all your acting tools together in polished, high-level work.',
    },
  ],
    selftape: [
    {
      title: 'Chapter 1 — Self Tape Foundations',
      subtitle:
        'Learn basic setup, framing, eyeline, audio, lighting, background, and simple audition discipline.',
    },
    {
      title: 'Chapter 2 — Performance for Self Tape',
      subtitle:
        'Build truthful camera acting, reader work, emotional control, and take selection.',
    },
    {
      title: 'Chapter 3 — Technical Polish',
      subtitle:
        'Improve lighting, sound, file quality, editing, slates, and professional presentation.',
    },
    {
      title: 'Chapter 4 — Audition Mastery',
      subtitle:
        'Create complete casting-ready tapes with strong choices, clean delivery, and professional consistency.',
    },
  ],
  editing: [
    {
      title: 'Chapter 1 — Foundations',
      subtitle:
        'Learn clarity, continuity, pacing, and the grammar of the cut.',
    },
    {
      title: 'Chapter 2 — Rhythm & Tension',
      subtitle:
        'Shape emotion, suspense, and energy through timing and structure.',
    },
    {
      title: 'Chapter 3 — Story Through the Cut',
      subtitle:
        'Use editorial choices to deepen meaning, tone, and perspective.',
    },
    {
      title: 'Chapter 4 — Editorial Mastery',
      subtitle:
        'Refine taste, finish, and authorship through advanced post decisions.',
    },
  ],
  cinematography: [
    {
      title: 'Chapter 1 — Framing & Light',
      subtitle:
        'Learn visual storytelling through composition, exposure, and mood.',
    },
    {
      title: 'Chapter 2 — Mood & Perspective',
      subtitle:
        'Use lensing, focus, space, and movement to shape feeling.',
    },
    {
      title: 'Chapter 3 — Visual Tension',
      subtitle:
        'Build suspense, withholding, and psychological pressure through image.',
    },
    {
      title: 'Chapter 4 — Cinematic Control',
      subtitle:
        'Create polished, intentional images with full visual authorship.',
    },
  ],
  directing: [
    {
      title: 'Chapter 1 — Blocking & Intention',
      subtitle:
        'Learn to shape scenes through movement, objective, and spatial clarity.',
    },
    {
      title: 'Chapter 2 — Performance Direction',
      subtitle:
        'Strengthen your actor notes, rehearsal instincts, and emotional control.',
    },
    {
      title: 'Chapter 3 — Power & Scene Design',
      subtitle:
        'Build pressure, status shifts, and dramatic scene architecture.',
    },
    {
      title: 'Chapter 4 — Directorial Mastery',
      subtitle:
        'Bring performance, rhythm, staging, and interpretation together.',
    },
  ],
  sound: [
    {
      title: 'Chapter 1 — Atmosphere & Detail',
      subtitle:
        'Train your ear for texture, room tone, intimacy, and sonic clarity.',
    },
    {
      title: 'Chapter 2 — Tension & Space',
      subtitle:
        'Use silence, off-screen pressure, and environment to build suspense.',
    },
    {
      title: 'Chapter 3 — Sonic Storytelling',
      subtitle:
        'Make sound carry memory, perspective, and emotional transformation.',
    },
    {
      title: 'Chapter 4 — Sound Mastery',
      subtitle:
        'Design polished, authored sound worlds with precision and taste.',
    },
  ],
  filmmaker: [
    {
      title: 'Chapter 1 — Core Craft',
      subtitle:
        'Build complete short-form work by combining multiple creative disciplines.',
    },
    {
      title: 'Chapter 2 — Scene Building',
      subtitle:
        'Develop stronger structure, tone, and authorship across the whole piece.',
    },
    {
      title: 'Chapter 3 — Voice & Collaboration',
      subtitle:
        'Push your identity as a filmmaker while working with others.',
    },
    {
      title: 'Chapter 4 — Complete Filmmaker',
      subtitle:
        'Bring image, sound, performance, directing, and edit together at a high level.',
    },
  ],
};

function getChapterIndexFromStep(step: number) {
  return Math.floor((step - 1) / 10);
}

function getLessonsForChapter(lessons: Lesson[], chapterIndex: number) {
  const start = chapterIndex * 10 + 1;
  const end = start + 9;
  return lessons.filter((lesson) => lesson.step >= start && lesson.step <= end);
}

function isChapterUnlocked(chapterIndex: number, completedSteps: number[]) {
  if (chapterIndex === 0) return true;

  const previousChapterStart = (chapterIndex - 1) * 10 + 1;
  const previousChapterEnd = previousChapterStart + 9;

  for (let step = previousChapterStart; step <= previousChapterEnd; step += 1) {
    if (!completedSteps.includes(step)) return false;
  }

  return true;
}

function isChapterCompleted(chapterIndex: number, completedSteps: number[]) {
  const start = chapterIndex * 10 + 1;
  const end = start + 9;

  for (let step = start; step <= end; step += 1) {
    if (!completedSteps.includes(step)) return false;
  }

  return true;
}

function getChapterProgress(chapterIndex: number, completedSteps: number[]) {
  const start = chapterIndex * 10 + 1;
  const end = start + 9;
  let count = 0;

  for (let step = start; step <= end; step += 1) {
    if (completedSteps.includes(step)) count += 1;
  }

  return count;
}


/* -------------------------- animated components -------------------------- */
function SidebarPathItem({
  path,
  active,
  progress,
  onPress,
}: {
  path: PathMeta;
  active: boolean;
  progress: number;
  onPress: () => void;
}) {
  const { colors, isLight } = useAppTheme();
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(active ? 1 : 0)).current;
  const lift = useRef(new Animated.Value(0)).current;

  const animateTo = (hovered: boolean) => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: hovered ? 1.018 : 1,
        useNativeDriver: true,
        friction: 7,
        tension: 120,
      }),
      Animated.timing(lift, {
        toValue: hovered ? -2 : 0,
        duration: 160,
        useNativeDriver: true,
      }),
      Animated.timing(glow, {
        toValue: hovered || active ? 1 : 0,
        duration: 160,
        useNativeDriver: false,
      }),
    ]).start();
  };

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.border, colors.primary],
  });

  const backgroundColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [colors.card, isLight ? '#F7F0E2' : '#13110D'],
  });

  return (
    <Animated.View
      style={[
        styles.sidebarItemWrap,
        {
          transform: [{ scale }, { translateY: lift }],
          borderColor,
          backgroundColor,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        onHoverIn={() => Platform.OS === 'web' && animateTo(true)}
        onHoverOut={() => Platform.OS === 'web' && animateTo(false)}
        style={styles.sidebarItem}
      >
        <View style={[styles.sidebarIcon, { backgroundColor: colors.mutedCard, borderColor: colors.border }, active && styles.sidebarIconActive, active && { backgroundColor: colors.primary, borderColor: colors.primary }]}>
          <Ionicons name={path.icon} size={18} color={active ? colors.textOnPrimary : colors.primary} />
        </View>

        <View style={styles.sidebarTextWrap}>
          <Text style={[styles.sidebarTitle, { color: colors.textPrimary }, active && styles.sidebarTitleActive, active && { color: colors.primary }]}>
            {path.shortLabel}
          </Text>
          <Text style={[styles.sidebarSubtitle, { color: colors.textMuted }]} numberOfLines={1}>
            {path.subtitle}
          </Text>
        </View>

        <View style={[styles.sidebarProgressPill, { backgroundColor: isLight ? 'rgba(158,119,40,0.10)' : 'rgba(198,166,100,0.12)', borderColor: isLight ? 'rgba(158,119,40,0.28)' : 'rgba(198,166,100,0.28)' }]}>
          <Text style={[styles.sidebarProgressText, { color: colors.primary }]}>{progress}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function LessonRowCard({
  lesson,
  state,
  onPress,
}: {
  lesson: Lesson;
  state: NodeState;
  onPress: () => void;
}) {
  const { colors, isLight } = useAppTheme();
  const { language } = useAppLanguage();
  const locked = state === 'locked';
  const completed = state === 'completed';
  const current = state === 'current';
  const translateLessonCopy = useCallback(
    (value?: string | null) => translateTrustedText(value || '', language),
    [language]
  );

  const scale = useRef(new Animated.Value(1)).current;
  const translateX = useRef(new Animated.Value(0)).current;
  const hoverLift = useRef(new Animated.Value(0)).current;

  const animateHover = (hovered: boolean) => {
    if (Platform.OS !== 'web' || locked) return;

    Animated.parallel([
      Animated.spring(scale, {
        toValue: hovered ? 1.01 : 1,
        useNativeDriver: true,
        friction: 7,
        tension: 120,
      }),
      Animated.timing(hoverLift, {
        toValue: hovered ? -2 : 0,
        duration: 140,
        useNativeDriver: true,
      }),
    ]).start();
  };

  const handlePress = () => {
    if (locked) return;

    Animated.sequence([
      Animated.timing(translateX, {
        toValue: 8,
        duration: 70,
        useNativeDriver: true,
      }),
      Animated.spring(translateX, {
        toValue: 0,
        useNativeDriver: true,
        friction: 6,
        tension: 110,
      }),
    ]).start();

    onPress();
  };

  return (
    <Animated.View
      style={{
        flex: 1,
        transform: [{ scale }, { translateY: hoverLift }, { translateX }],
      }}
    >
      <Pressable
        onPress={handlePress}
        disabled={locked}
        onHoverIn={() => animateHover(true)}
        onHoverOut={() => animateHover(false)}
        style={[
          styles.lessonRowCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            shadowColor: colors.shadow,
          },
          completed && styles.lessonRowCardCompleted,
          completed && {
            backgroundColor: isLight ? '#F3FAF5' : '#0D1913',
            borderColor: isLight ? 'rgba(35,122,61,0.22)' : 'rgba(104,186,132,0.18)',
          },
          current && styles.lessonRowCardCurrent,
          current && {
            backgroundColor: isLight ? '#F6ECD8' : 'rgba(198,166,100,0.11)',
            borderColor: colors.primary,
          },
          locked && styles.lessonRowCardLocked,
        ]}
      >
        <View style={styles.lessonRowTextWrap}>
          <View style={styles.lessonRowTopLine}>
            <Text style={[styles.lessonRowStep, { color: colors.primary }, locked && styles.lockedText, locked && { color: colors.textMuted }]}>
              Step {lesson.step}
            </Text>

            <View style={styles.lessonRowBadgeWrap}>
              <View style={[styles.lessonRowKindPill, { backgroundColor: isLight ? 'rgba(158,119,40,0.10)' : 'rgba(198,166,100,0.12)', borderColor: isLight ? 'rgba(158,119,40,0.24)' : 'rgba(198,166,100,0.24)' }]}>
                <Text style={[styles.lessonRowKindText, { color: colors.primary }]}>{kindLabel(lesson.kind)}</Text>
              </View>

              {lesson.missionType ? (
                <View style={styles.lessonRowMissionPill}>
                  <Ionicons
                    name={missionIcon(lesson.missionType)}
                    size={10}
                    color={BLUE}
                  />
                </View>
              ) : null}
            </View>
          </View>

          <Text
            style={[styles.lessonRowTitle, { color: colors.textPrimary }, locked && styles.lockedText, locked && { color: colors.textMuted }]}
            numberOfLines={2}
          >
            {translateLessonCopy(lesson.title)}
          </Text>

          <Text
            style={[styles.lessonRowSubtitle, { color: colors.textMuted }, locked && styles.lockedText]}
            numberOfLines={2}
          >
            {translateLessonCopy(lesson.subtitle || lesson.description)}
          </Text>

          <View style={styles.lessonRowMeta}>
            <View style={[styles.lessonRowMetaPill, { backgroundColor: colors.mutedCard, borderColor: colors.border }]}>
              <Ionicons name="flash-outline" size={11} color={colors.primary} />
              <Text style={[styles.lessonRowMetaText, { color: colors.textMuted }]}>{lesson.xp} XP</Text>
            </View>
          </View>
        </View>

        <Ionicons
          name="chevron-forward"
          size={18}
          color={locked ? colors.textMuted : colors.primary}
          style={styles.lessonRowChevron}
        />
      </Pressable>
    </Animated.View>
  );
}

/* -------------------------------- screen -------------------------------- */
const WorkshopScreen: React.FC = () => {
  const { colors, isLight } = useAppTheme();
  const { language } = useAppLanguage();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const isDesktop = width >= 960;
  const isWebDesktop = Platform.OS === 'web' && width >= 960;
  const navigation = useNavigation<any>();
  const { refreshKey, triggerAppRefresh } = useAppRefresh();
  const isFocused = useIsFocused();

  const {
    userId,
    xp: globalXp,
    level,
    nextLevelMinXp,
    refresh: refreshGamification,
    loading: gamificationLoading,
  } = useGamification();

  const isGuest = !userId;

  const promptSignIn = (message: string) => {
    if (Platform.OS === 'web') {
      const goToSignIn = window.confirm(
        `${message}\n\nPress OK to go to Sign In, or Cancel to go to Create Account.`
      );

      if (goToSignIn) {
        navigation.navigate('Auth', { screen: 'SignIn' });
      } else {
        navigation.navigate('Auth', { screen: 'SignUp' });
      }
      return;
    }

    Alert.alert(
      'Sign in required',
      message,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign In',
          onPress: () => navigation.navigate('Auth', { screen: 'SignIn' }),
        },
        {
          text: 'Create Account',
          onPress: () => navigation.navigate('Auth', { screen: 'SignUp' }),
        },
      ]
    );
  };

  const { streak, refreshStreak } = useMonthlyStreak();

  const hasLoadedOnceRef = useRef(false);
  const lastHandledRefreshKeyRef = useRef(0);

  const [selectedPath, setSelectedPath] = useState<WorkshopPathKey>('acting');
  const [lastPathLoaded, setLastPathLoaded] = useState(false);
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [surgeryLesson, setSurgeryLesson] = useState<Lesson | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [upgradeVisible, setUpgradeVisible] = useState(false);

  const [progressByPath, setProgressByPath] = useState<Record<WorkshopPathKey, number[]>>({
     acting: [],
selftape: [],
editing: [],
cinematography: [],
directing: [],
sound: [],
filmmaker: [],
  });

  const [surgeryProgressByPath, setSurgeryProgressByPath] = useState<
    Record<WorkshopPathKey, number[]>
  >({
     acting: [],
selftape: [],
editing: [],
cinematography: [],
directing: [],
sound: [],
filmmaker: [],
  });

  const [workshopLoading, setWorkshopLoading] = useState(true);
const [refreshing, setRefreshing] = useState(false);
const [surgeryFeedbackState, setSurgeryFeedbackState] = useState<Record<number, boolean>>({});
const [expandedChapters, setExpandedChapters] = useState<Record<string, boolean>>({});
const wheelProgressAnim = useRef(new Animated.Value(0)).current;
const wheelEntranceAnim = useRef(new Animated.Value(1)).current;
const [animatedCompletionPercent, setAnimatedCompletionPercent] = useState(0);
const translateLessonCopy = useCallback(
  (value?: string | null) => translateTrustedText(value || '', language),
  [language]
);

useEffect(() => {
  const listenerId = wheelProgressAnim.addListener(({ value }) => {
    setAnimatedCompletionPercent(Math.max(0, Math.min(100, Math.round(value))));
  });

  return () => {
    wheelProgressAnim.removeListener(listenerId);
  };
}, [wheelProgressAnim]);

  useEffect(() => {
    let alive = true;

    const loadLastPath = async () => {
      try {
        const saved = await AsyncStorage.getItem(WORKSHOP_LAST_PATH_KEY);
        if (!alive) return;
        if (saved && PATHS.some((path) => path.key === saved)) {
          setSelectedPath(saved as WorkshopPathKey);
        }
      } catch {}
      finally {
        if (alive) setLastPathLoaded(true);
      }
    };

    loadLastPath();

    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!lastPathLoaded) return;
    void AsyncStorage.setItem(WORKSHOP_LAST_PATH_KEY, selectedPath);
  }, [lastPathLoaded, selectedPath]);

  const hasProAccess = userProfile?.tier === 'pro';

  const loadWorkshopProgress = useCallback(async () => {
    if (!userId) {
      setUserProfile(null);
      setProgressByPath({
         acting: [],
selftape: [],
editing: [],
cinematography: [],
directing: [],
sound: [],
filmmaker: [],
      });
      setSurgeryProgressByPath({
         acting: [],
selftape: [],
editing: [],
cinematography: [],
directing: [],
sound: [],
filmmaker: [],
      });
      setWorkshopLoading(false);
      return;
    }

    if (!hasLoadedOnceRef.current) {
      setWorkshopLoading(true);
    }

    const emptyMap: Record<WorkshopPathKey, number[]> = {
       acting: [],
selftape: [],
editing: [],
cinematography: [],
directing: [],
sound: [],
filmmaker: [],
    };

    try {
      const { data: profileData, error: profileError } = await supabase
        .from('users')
        .select('id, tier, full_name')
        .eq('id', userId)
        .single();

      const effectiveTier = await getCurrentUserTierOrFree({ force: true });

      if (profileError) {
        console.log('Workshop profile load error:', profileError);
        setUserProfile(null);
      } else if (profileData) {
        setUserProfile({
          id: profileData.id,
          tier: effectiveTier,
          full_name: profileData.full_name,
        });
      }

      const { data, error } = await supabase
        .from('workshop_progress')
        .select('path_key, step')
        .eq('user_id', userId);

      if (error) throw error;

      const nextMap: Record<WorkshopPathKey, number[]> = {
         acting: [],
selftape: [],
editing: [],
cinematography: [],
directing: [],
sound: [],
filmmaker: [],
      };

      (data || []).forEach((row: any) => {
        const path = row.path_key as WorkshopPathKey;
        const step = Number(row.step);

        if (!nextMap[path]) return;
        if (!Number.isFinite(step)) return;

        nextMap[path].push(step);
      });

      (Object.keys(nextMap) as WorkshopPathKey[]).forEach((key) => {
        nextMap[key] = Array.from(new Set(nextMap[key])).sort((a, b) => a - b);
      });

      setProgressByPath(nextMap);
      setSurgeryProgressByPath(emptyMap);
      hasLoadedOnceRef.current = true;
    } catch (e) {
      console.log('Workshop progress load error:', e);
      setProgressByPath(emptyMap);
      setSurgeryProgressByPath(emptyMap);
    } finally {
      setWorkshopLoading(false);
    }
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      const run = async () => {
        try {
          await refreshGamification?.();
        } catch {}

        try {
          await refreshStreak?.();
        } catch {}

        try {
          await loadWorkshopProgress();
        } catch {}
      };

      run();
    }, [refreshGamification, refreshStreak, loadWorkshopProgress])
  );

  useEffect(() => {
    if (!isFocused || refreshKey <= 0 || lastHandledRefreshKeyRef.current === refreshKey) return;

    lastHandledRefreshKeyRef.current = refreshKey;

    const run = async () => {
      try {
        await refreshGamification?.();
      } catch {}

      try {
        await refreshStreak?.();
      } catch {}

      try {
        await loadWorkshopProgress();
      } catch {}
    };

    void run();
  }, [isFocused, refreshGamification, refreshKey, refreshStreak, loadWorkshopProgress]);

  const onRefresh = useCallback(async () => {
  if (refreshing) return;

  setRefreshing(true);

  try {
    triggerAppRefresh();

    try {
      await refreshGamification?.();
    } catch {}

    try {
      await refreshStreak?.();
    } catch {}

    try {
      await loadWorkshopProgress();
    } catch {}
  } finally {
    setRefreshing(false);
  }
}, [
  refreshing,
  triggerAppRefresh,
  refreshGamification,
  refreshStreak,
  loadWorkshopProgress,
]);

  const activePath = PATHS.find((p) => p.key === selectedPath) || PATHS[0];
  const lessons = useMemo(() => buildPathLessons(selectedPath), [selectedPath]);
  const completedSteps = progressByPath[selectedPath] || [];
  const surgeryClearedSteps = surgeryProgressByPath[selectedPath] || [];
  const completedSet = useMemo(() => new Set(completedSteps), [completedSteps]);
  const surgerySet = useMemo(() => new Set(surgeryClearedSteps), [surgeryClearedSteps]);

  const currentStep = useMemo(() => {
    return (
      lessons.find((l) => !completedSet.has(l.step))?.step ||
      lessons[lessons.length - 1].step
    );
  }, [lessons, completedSet]);

  const currentLesson = lessons.find((l) => l.step === currentStep) || lessons[0];

  const currentMission = useMemo(() => {
    return missionForStep(currentStep) || missionForStep(currentStep + 1) || null;
  }, [currentStep]);

  const workshopSessionXp = completedSteps.reduce((sum, step) => {
    const lesson = lessons.find((l) => l.step === step);
    return sum + (lesson?.xp || 0);
  }, 0);

  const xpToNext =
    typeof nextLevelMinXp === 'number' && typeof globalXp === 'number'
      ? Math.max(0, nextLevelMinXp - globalXp)
      : null;

	  const completionPercent = Math.round((completedSteps.length / lessons.length) * 100);
	  const firstName = (userProfile?.full_name || 'Filmmaker').trim().split(/\s+/)[0] || 'Filmmaker';
	  const currentChapterIndex = Math.max(0, Math.floor((currentStep - 1) / 10));
  const bossesCleared = completedSteps.filter((n) => n % 8 === 0).length;
  const surgeryClears = surgeryClearedSteps.length;
  const chapterMeta = PATH_STAGE_META[selectedPath];
  const wheelDisplayPercent = isFocused ? animatedCompletionPercent : completionPercent;
  const wheelScale = wheelEntranceAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.975, 1],
  });
  const wheelOpacity = wheelEntranceAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.86, 1],
  });

  useEffect(() => {
    if (!isFocused) {
      wheelProgressAnim.stopAnimation();
      setAnimatedCompletionPercent(completionPercent);
      wheelProgressAnim.setValue(completionPercent);
      return;
    }

    wheelProgressAnim.stopAnimation();
    wheelEntranceAnim.stopAnimation();

    setAnimatedCompletionPercent(0);
    wheelProgressAnim.setValue(0);
    wheelEntranceAnim.setValue(0);

    Animated.parallel([
      Animated.timing(wheelProgressAnim, {
        toValue: completionPercent,
        duration: 900,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      Animated.spring(wheelEntranceAnim, {
        toValue: 1,
        damping: 18,
        stiffness: 130,
        mass: 0.8,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setAnimatedCompletionPercent(completionPercent);
    });
  }, [completionPercent, isFocused, selectedPath, wheelEntranceAnim, wheelProgressAnim]);

  const chapters = useMemo(() => {
    return chapterMeta.map((meta, chapterIndex) => {
      const chapterLessons = getLessonsForChapter(lessons, chapterIndex);
      const unlocked = isChapterUnlocked(chapterIndex, completedSteps);
      const completed = isChapterCompleted(chapterIndex, completedSteps);
      const progress = getChapterProgress(chapterIndex, completedSteps);
      const isCurrent =
        unlocked &&
        !completed &&
        (chapterIndex === 0 || isChapterCompleted(chapterIndex - 1, completedSteps));

      return {
        ...meta,
        chapterIndex,
        lessons: chapterLessons,
        unlocked,
        completed,
        progress,
        isCurrent,
      };
    });
  }, [chapterMeta, lessons, completedSteps]);

  const nodeSize = isDesktop ? 82 : 70;
  const offsetAmount = isDesktop ? 92 : 42;
  const offsets = [-0.45, 0.55, -0.25, 0.38, -0.5, 0.22, -0.12, 0];

  const activeSurgeryFilms = useMemo(() => {
    if (!surgeryLesson) return [];
    return getSurgeryFilmsForStep(surgeryLesson.step);
  }, [surgeryLesson]);

  const surgeryCompleteCount = activeSurgeryFilms.filter(
    (film) => surgeryFeedbackState[film.id]
  ).length;

  const handleOpenLesson = (lesson: Lesson) => {
    const state = nodeState(lesson.step, completedSteps);
    if (state === 'locked') return;

    if (isGuest) {
      promptSignIn('Create an account or sign in to open workshop challenges.');
      return;
    }

    if (!hasProAccess) {
      setUpgradeVisible(true);
      return;
    }

    setSelectedLesson(lesson);
  };

  const handleOpenSurgeryGate = (lesson: Lesson) => {
    if (isGuest) {
      promptSignIn('Create an account or sign in to continue this workshop challenge.');
      return;
    }

    if (!hasProAccess) {
      setUpgradeVisible(true);
      return;
    }

    setSurgeryLesson(lesson);
    const films = getSurgeryFilmsForStep(lesson.step);
    const initialMap: Record<number, boolean> = {};
    films.forEach((film) => {
      initialMap[film.id] = false;
    });
    setSurgeryFeedbackState(initialMap);
  };

  const handleCompleteSurgery = () => {
    if (!surgeryLesson) return;
    if (surgeryCompleteCount < 3) return;

    setSurgeryProgressByPath((prev) => {
      const existing = prev[selectedPath] || [];
      if (existing.includes(surgeryLesson.step)) return prev;

      return {
        ...prev,
        [selectedPath]: [...existing, surgeryLesson.step].sort((a, b) => a - b),
      };
    });

    const lessonToReopen = surgeryLesson;
    setSurgeryLesson(null);
    setSelectedLesson(lessonToReopen);
  };

  const handleCompleteLesson = async () => {
    if (!selectedLesson || !userId) return;

    if (!hasProAccess) {
      setUpgradeVisible(true);
      return;
    }

    try {
      const { error } = await supabase.from('workshop_progress').insert({
        user_id: userId,
        path_key: selectedPath,
        step: selectedLesson.step,
      });

      if (error) {
        const msg = String(error.message || '').toLowerCase();

        const alreadyExists =
          msg.includes('duplicate') ||
          msg.includes('unique') ||
          msg.includes('already');

        if (!alreadyExists) {
          console.log('Workshop progress insert error:', error);
          return;
        }
      } else {
        try {
          await giveXp(userId, selectedLesson.xp, 'manual_adjust');
        } catch (xpError) {
          console.log('Workshop XP award error:', xpError);
        }
      }

      await loadWorkshopProgress();

      try {
        await refreshGamification?.();
      } catch {}

      try {
        await refreshStreak?.();
      } catch {}

      setSelectedLesson(null);
    } catch (e) {
      console.log('Workshop completion error:', e);
    }
  };

  const lessonNeedsSurgery =
    !!selectedLesson?.requiresSurgery && !surgerySet.has(selectedLesson.step);

  const toggleChapter = (chapterIndex: number) => {
    const key = `${selectedPath}-${chapterIndex}`;
    setExpandedChapters((prev) => ({
      ...prev,
      [key]: !(prev[key] ?? chapterIndex === currentChapterIndex),
    }));
  };

  const BG = colors.background;
  const PANEL = colors.card;
  const PANEL_2 = colors.mutedCard;
  const PANEL_3 = colors.cardAlt;
  const BORDER = colors.border;
  const BORDER_SOFT = colors.border;
  const GOLD = colors.primary;
  const GOLD_SOFT = isLight ? 'rgba(158,119,40,0.10)' : 'rgba(198,166,100,0.10)';
  const GOLD_SOFT_2 = isLight ? 'rgba(158,119,40,0.16)' : 'rgba(198,166,100,0.16)';
  const GOLD_BORDER = isLight ? 'rgba(158,119,40,0.28)' : 'rgba(198,166,100,0.30)';
  const IVORY = colors.textPrimary;
  const MUTED = colors.textMuted;
  const MUTED_2 = colors.navInactive;
  const LINE = colors.borderStrong;
  const surfaceStyle = { backgroundColor: PANEL, borderColor: BORDER };
  const softSurfaceStyle = { backgroundColor: PANEL_2, borderColor: BORDER_SOFT };
  const mutedTextStyle = { color: MUTED };
  const primaryTextStyle = { color: IVORY };

  return (
    <View style={[styles.container, { backgroundColor: BG }]}>
      <ScrollView
  style={[styles.scroll, { backgroundColor: BG }]}
  contentContainerStyle={styles.scrollContent}
  showsVerticalScrollIndicator={false}
  refreshControl={
    Platform.OS !== 'web' ? (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={onRefresh}
        tintColor={GOLD}
        colors={[GOLD]}
        progressBackgroundColor={PANEL}
      />
    ) : undefined
  }
>
        <View style={[styles.pageWrap, { paddingTop: insets.top + 40, backgroundColor: BG }]}>
          <View style={[styles.mainLayout, !isDesktop && styles.mainLayoutMobile]}>
          <View style={[styles.centerPanel, isDesktop && styles.centerPanelDesktop, isWebDesktop && styles.centerPanelWebDesktop]}>
  <View style={[styles.bootcampCard, surfaceStyle, { shadowColor: colors.shadow }, isWebDesktop && styles.bootcampCardWebDesktop]}>
    <View style={styles.referenceHeroTop}>
      <Text style={[styles.referenceGreeting, primaryTextStyle]}>Hello, {firstName}</Text>
      <Text style={[styles.referenceDateLine, mutedTextStyle]}>{activePath.label}</Text>
    </View>

    <View style={styles.bigProgressWrap}>
      <Animated.View
        style={[
          styles.bigProgressOrbit,
          { backgroundColor: PANEL_2, borderColor: BORDER, shadowColor: GOLD },
          {
            opacity: wheelOpacity,
            transform: [{ scale: wheelScale }],
          },
        ]}
      >
        {Array.from({ length: 56 }).map((_, index) => {
          const filled = index / 56 <= wheelDisplayPercent / 100;
          return (
            <View
              key={`progress-tick-${index}`}
              style={[
                styles.bigProgressTick,
                filled && styles.bigProgressTickActive,
                { backgroundColor: filled ? GOLD : LINE },
                {
                  transform: [
                    { rotate: `${index * (360 / 56)}deg` },
                    { translateY: -86 },
                  ],
                },
              ]}
            />
          );
        })}
        <View style={[styles.bigProgressInner, { backgroundColor: BG, borderColor: BORDER }]}>
          <Text style={[styles.bigProgressNumber, primaryTextStyle]}>{wheelDisplayPercent}%</Text>
        </View>
      </Animated.View>
    </View>

	    <ScrollView
	      horizontal
	      showsHorizontalScrollIndicator={false}
	      contentContainerStyle={[styles.subjectTilesRow, isWebDesktop && styles.subjectTilesRowWebDesktop]}
	      style={styles.subjectTilesScroll}
    >
      {PATHS.map((path, index) => {
        const active = selectedPath === path.key;
        const progress = (progressByPath[path.key] || []).length;

        return (
          <Pressable
            key={path.key}
            onPress={() => setSelectedPath(path.key)}
            style={[
              styles.subjectTile,
              index % 3 === 1 && styles.subjectTileAlt,
              index % 3 === 2 && styles.subjectTileCool,
              softSurfaceStyle,
              active && styles.subjectTileActive,
              active && { backgroundColor: GOLD_SOFT_2, borderColor: GOLD_BORDER },
              isWebDesktop && styles.subjectTileWebDesktop,
            ]}
          >
            <View style={[styles.subjectTileIcon, { backgroundColor: PANEL_3, borderColor: BORDER }, active && styles.subjectTileIconActive, active && { backgroundColor: GOLD, borderColor: GOLD }]}>
              <Ionicons name={path.icon} size={14} color={active ? colors.textOnPrimary : GOLD} />
            </View>

            <View style={styles.subjectTileTextWrap}>
              <Text
                style={[styles.subjectTileTitle, primaryTextStyle, active && styles.subjectTileTitleActive, active && { color: GOLD }]}
                numberOfLines={1}
              >
                {path.shortLabel}
              </Text>

              <Text style={[styles.subjectTileMeta, mutedTextStyle, active && styles.subjectTileMetaActive, active && { color: GOLD }]}>
                {progress}/40
              </Text>
            </View>
          </Pressable>
	        );
	      })}
	    </ScrollView>

		    <View style={styles.scheduleHeaderRow}>
		      <Text style={[styles.scheduleTitle, primaryTextStyle]}>Today's Exercise</Text>
		    </View>

		    <TouchableOpacity
	      activeOpacity={0.9}
	      onPress={() => handleOpenLesson(currentLesson)}
      style={[styles.currentLessonStrip, softSurfaceStyle]}
    >
      <View style={[styles.currentLessonIcon, { backgroundColor: GOLD }]}>
        <Ionicons name={activePath.icon} size={17} color={colors.textOnPrimary} />
      </View>

      <View style={styles.currentLessonCopy}>
        <Text style={[styles.currentLessonEyebrow, { color: GOLD }]}>{activePath.shortLabel} • Step {currentLesson.step}</Text>
        <Text style={[styles.currentLessonTitle, primaryTextStyle]} numberOfLines={1}>{currentLesson.title}</Text>
        <Text style={[styles.currentLessonText, mutedTextStyle]} numberOfLines={1}>{currentLesson.description}</Text>
      </View>

      <View style={[styles.currentLessonAction, { backgroundColor: GOLD }]}>
        <Ionicons name="play-outline" size={14} color={colors.textOnPrimary} />
      </View>
    </TouchableOpacity>
  </View>

  {currentMission ? (
    <View style={[styles.missionBanner, softSurfaceStyle]}>
      <View style={styles.missionBannerIcon}>
        <Ionicons name={currentMission.icon} size={16} color={BLUE} />
      </View>

      <View style={styles.missionBannerTextWrap}>
        <Text style={[styles.missionBannerTitle, primaryTextStyle]}>{currentMission.title}</Text>
        <Text style={[styles.missionBannerText, mutedTextStyle]}>
          {currentMission.description}
        </Text>
      </View>
    </View>
  ) : null}

  {workshopLoading ? (
    <View style={[styles.loadingCard, surfaceStyle]}>
      <Text style={[styles.loadingCardText, mutedTextStyle]}>
        Loading workshop progress…
      </Text>
    </View>
  ) : (
    <View style={styles.lessonSectionsWrap}>
      {chapters.map((chapter) => {
        const expandedKey = `${selectedPath}-${chapter.chapterIndex}`;
        const expanded = expandedChapters[expandedKey] ?? chapter.chapterIndex === currentChapterIndex;

        return (
          <View
            key={chapter.chapterIndex}
            style={[
              styles.chapterListCard,
              expanded && styles.chapterListCardExpanded,
              chapter.completed && styles.chapterListCardCompleted,
              !chapter.unlocked && styles.chapterListCardLocked,
              surfaceStyle,
              expanded && { borderColor: GOLD_BORDER },
              chapter.completed && { backgroundColor: isLight ? '#F3FAF5' : '#0D1913' },
              !chapter.unlocked && { opacity: 0.74 },
            ]}
          >
            <Pressable
              onPress={() => toggleChapter(chapter.chapterIndex)}
              style={styles.chapterToggle}
            >
              <View style={styles.chapterListHeader}>
                <View style={styles.chapterListHeaderText}>
                  <Text style={[styles.chapterListEyebrow, { color: GOLD }]}>
                    {chapter.completed
                      ? 'Completed'
                      : chapter.unlocked
                        ? 'In Progress'
                        : 'Locked'}
                  </Text>

                  <Text style={[styles.chapterListTitle, primaryTextStyle]}>{chapter.title}</Text>

                  <Text style={[styles.chapterListSubtitle, mutedTextStyle]} numberOfLines={expanded ? 2 : 1}>
                    {chapter.subtitle}
                  </Text>
                </View>

                <View style={styles.chapterRightStack}>
                  <View style={[styles.chapterListCountPill, { backgroundColor: GOLD_SOFT, borderColor: GOLD_BORDER }]}>
                    <Text style={[styles.chapterListCountText, { color: GOLD }]}>
                      {chapter.progress}/10
                    </Text>
                  </View>

                  <Ionicons
                    name={expanded ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={GOLD}
                  />
                </View>
              </View>

              <View style={[styles.chapterListProgressTrack, { backgroundColor: LINE }]}>
                <View
                  style={[
                    styles.chapterListProgressFill,
                    { backgroundColor: GOLD },
                    { width: `${(chapter.progress / 10) * 100}%` },
                  ]}
                />
              </View>
            </Pressable>

            {expanded ? (
              !chapter.unlocked ? (
                <View style={[styles.chapterLockedBox, softSurfaceStyle]}>
                  <Ionicons
                    name="lock-closed-outline"
                    size={16}
                    color={MUTED_2}
                  />
                  <Text style={[styles.chapterLockedText, mutedTextStyle]}>
                    Complete the previous chapter to unlock this one.
                  </Text>
                </View>
              ) : (
                <View style={styles.lessonPathWrap}>
                  <View pointerEvents="none" style={[styles.lessonPathRail, { backgroundColor: LINE }]} />
                  {chapter.lessons.map((lesson, lessonIndex) => {
                    const state = nodeState(lesson.step, completedSteps);
                    const lessonCompleted = state === 'completed';
                    const lessonCurrent = state === 'current';
                    const lessonLocked = state === 'locked';

                    return (
                      <View key={lesson.id} style={styles.lessonPathItem}>
                        <View
                          style={[
                            styles.lessonPathNode,
                            { backgroundColor: PANEL_2, borderColor: BORDER },
                            lessonCompleted && styles.lessonPathNodeCompleted,
                            lessonCompleted && { backgroundColor: GOLD, borderColor: GOLD },
                            lessonCurrent && styles.lessonPathNodeCurrent,
                            lessonCurrent && { borderColor: GOLD },
                            lessonLocked && styles.lessonPathNodeLocked,
                          ]}
                        >
                          <Text
                            style={[
                              styles.lessonPathNodeText,
                              { color: IVORY },
                              lessonCurrent && styles.lessonPathNodeTextCurrent,
                              lessonCurrent && { color: GOLD },
                              lessonLocked && styles.lessonPathNodeTextLocked,
                              lessonLocked && { color: MUTED_2 },
                            ]}
                          >
                            {lessonIndex + 1}
                          </Text>
                        </View>

                        <LessonRowCard
                          lesson={lesson}
                          state={state}
                          onPress={() => handleOpenLesson(lesson)}
                        />
                      </View>
                    );
                  })}
                </View>
              )
            ) : null}
          </View>
        );
      })}
    </View>
  )}
</View>
          </View>
        </View>
      </ScrollView>

      <Modal
        visible={!!selectedLesson}
        transparent
        animationType="fade"
        onRequestClose={() => setSelectedLesson(null)}
      >
        <Pressable
          style={[styles.modalBackdrop, { backgroundColor: colors.overlay }]}
          onPress={() => setSelectedLesson(null)}
        />

        <View style={styles.modalCenter}>
          {selectedLesson ? (
            <View style={[styles.modalCard, surfaceStyle, { shadowColor: colors.shadow }]}>
              <View style={[styles.modalHeader, { borderBottomColor: BORDER }]}>
                <View style={styles.modalHeaderLeft}>
                  <View style={[styles.modalIconCircle, { backgroundColor: GOLD_SOFT, borderColor: GOLD_BORDER }]}>
                    <Ionicons
                      name={
                        selectedLesson.requiresSurgery &&
                        !surgerySet.has(selectedLesson.step)
                          ? 'medkit-outline'
                          : selectedLesson.isBoss
                            ? 'trophy-outline'
                            : kindIcon(selectedLesson.kind)
                      }
                      size={22}
                      color={GOLD}
                    />
                  </View>

                  <View style={styles.modalTitleWrap}>
                    <Text style={[styles.modalEyebrow, { color: GOLD }]}>
                      {activePath.label} • Step {selectedLesson.step}
                    </Text>
                    <Text style={[styles.modalTitle, primaryTextStyle]}>
                      {translateLessonCopy(selectedLesson.title)}
                    </Text>
                    <Text style={[styles.modalMini, mutedTextStyle]}>
                      {kindLabel(selectedLesson.kind)}
                      {selectedLesson.missionType
                        ? ` • ${missionLabel(selectedLesson.missionType)}`
                        : ''}
                    </Text>

                    <View style={[styles.proOnlyPill, { backgroundColor: GOLD_SOFT, borderColor: GOLD_BORDER }]}>
                      <Ionicons name="sparkles-outline" size={12} color={GOLD} />
                      <Text style={[styles.proOnlyPillText, { color: GOLD }]}>Workshop Pro only</Text>
                    </View>
                  </View>
                </View>

                <TouchableOpacity
                  style={[
                    styles.modalClose,
                    { backgroundColor: colors.backgroundAlt, borderColor: colors.border },
                  ]}
                  onPress={() => setSelectedLesson(null)}
                  activeOpacity={0.9}
                >
                  <Ionicons name="close" size={18} color={colors.textPrimary} />
                </TouchableOpacity>
              </View>

              <ScrollView
                style={styles.modalScroll}
                contentContainerStyle={styles.modalScrollContent}
                showsVerticalScrollIndicator={false}
              >
                <Text style={[styles.modalDescription, { color: colors.textSecondary }]}>
                  {translateLessonCopy(selectedLesson.description)}
                </Text>

                <View style={styles.modalMetaRow}>
                  <View style={[styles.modalMetaPill, { backgroundColor: GOLD_SOFT, borderColor: GOLD_BORDER }]}>
                    <Ionicons name="flash-outline" size={12} color={GOLD} />
                    <Text style={[styles.modalMetaText, { color: GOLD }]}>{selectedLesson.xp} XP</Text>
                  </View>
                </View>

                <View style={[styles.detailCard, softSurfaceStyle]}>
                  <Text style={[styles.detailLabel, { color: GOLD }]}>Challenge</Text>
                  <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                    {translateLessonCopy(selectedLesson.challenge)}
                  </Text>
                </View>

                <View style={[styles.detailCard, softSurfaceStyle]}>
                  <Text style={[styles.detailLabel, { color: GOLD }]}>Objective</Text>
                  <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                    {translateLessonCopy(selectedLesson.objective)}
                  </Text>
                </View>

                <View style={[styles.detailCard, softSurfaceStyle]}>
                  <Text style={[styles.detailLabel, { color: GOLD }]}>Deliverable</Text>
                  <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                    {translateLessonCopy(selectedLesson.deliverable)}
                  </Text>
                </View>

                {selectedLesson.learning ? (
                  <View style={[styles.detailCard, softSurfaceStyle]}>
                    <Text style={[styles.detailLabel, { color: GOLD }]}>Learning</Text>
                    <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                      {translateLessonCopy(selectedLesson.learning)}
                    </Text>
                  </View>
                ) : null}

                {selectedLesson.bonusNote ? (
                  <View style={[styles.detailCard, styles.detailCardSoft, softSurfaceStyle]}>
                    <Text style={[styles.detailLabel, { color: GOLD }]}>Bonus Note</Text>
                    <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                      {translateLessonCopy(selectedLesson.bonusNote)}
                    </Text>
                  </View>
                ) : null}

                {selectedLesson.missionType ? (
                  <View style={[styles.detailCard, styles.detailCardBlue, softSurfaceStyle]}>
                    <Text style={[styles.detailLabel, { color: GOLD }]}>
                      {missionLabel(selectedLesson.missionType)}
                    </Text>
                    <Text style={[styles.detailText, { color: colors.textSecondary }]}>
                      This lesson is part of a collaboration push. Every now and
                      then, users should be nudged to meet someone in their city
                      group chat, collaborate remotely, or team up with someone from
                      a different discipline.
                    </Text>
                  </View>
                ) : null}

                <View style={[styles.rulesCard, softSurfaceStyle]}>
                  <Text style={[styles.rulesTitle, primaryTextStyle]}>Rules</Text>

                  {selectedLesson.constraints.map((rule, i) => (
                    <View key={`${selectedLesson.id}-${i}`} style={styles.ruleRow}>
                      <Ionicons name="diamond-outline" size={12} color={GOLD} />
                      <Text style={[styles.ruleText, { color: colors.textSecondary }]}>
                        {translateLessonCopy(rule)}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>

              <View
                style={[
                  styles.modalActions,
                  { backgroundColor: colors.card, borderTopColor: colors.border },
                ]}
              >
                <TouchableOpacity
                  style={[
                    styles.modalButton,
                    styles.modalGhostButton,
                    { backgroundColor: colors.backgroundAlt, borderColor: colors.border },
                  ]}
                  onPress={() => setSelectedLesson(null)}
                  activeOpacity={0.9}
                >
                  <Text style={[styles.modalGhostText, primaryTextStyle]}>Close</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.modalButton, styles.modalGoldButton, { backgroundColor: GOLD }]}
                  onPress={() => {
                    if (!selectedLesson) return;

                    if (completedSet.has(selectedLesson.step)) {
                      setSelectedLesson(null);
                      return;
                    }

                    if (isGuest) {
                      setSelectedLesson(null);
                      promptSignIn('Create an account or sign in to submit workshop challenges.');
                      return;
                    }

                    if (!hasProAccess) {
                      setSelectedLesson(null);
                      setUpgradeVisible(true);
                      return;
                    }

                    if (lessonNeedsSurgery) {
                      handleOpenSurgeryGate(selectedLesson);
                      return;
                    }

                    navigation.navigate('WorkshopSubmit', {
                      pathKey: selectedPath,
                      step: selectedLesson.step,
                      lessonTitle: selectedLesson.title,
                      lessonDescription: selectedLesson.description,
                      lessonChallenge: selectedLesson.challenge,
                      lessonXp: selectedLesson.xp,
                    });

                    setSelectedLesson(null);
                  }}
                  activeOpacity={0.9}
                >
                  <Ionicons
                    name={
                      completedSet.has(selectedLesson.step)
                        ? 'checkmark-outline'
                        : !hasProAccess
                          ? 'sparkles-outline'
                          : lessonNeedsSurgery
                            ? 'lock-closed-outline'
                            : 'cloud-upload-outline'
                    }
                    size={15}
                    color={colors.textOnPrimary}
                  />
                  <Text style={[styles.modalGoldText, { color: colors.textOnPrimary }]}>
                    {completedSet.has(selectedLesson.step)
                      ? 'Completed'
                      : !hasProAccess
                        ? 'Unlock with Pro'
                        : lessonNeedsSurgery
                          ? 'Unlock'
                          : 'Upload'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}
        </View>
      </Modal>

      <UpgradeModal
        visible={upgradeVisible}
        onClose={() => setUpgradeVisible(false)}
        context="workshop"
        onSelectPro={() => {
          setUpgradeVisible(false);
          navigation.navigate('Profile');
        }}
      />
    </View>
  );
};

export default WorkshopScreen;

/* -------------------------------- styles -------------------------------- */
const CINEMA = {
  bg: '#050505',
  panel: '#0D0D0F',
  panel2: '#111114',
  card: '#111114',
  cardSoft: '#16161A',

  stroke: 'rgba(255,255,255,0.10)',
  strokeSoft: 'rgba(255,255,255,0.06)',

  text: '#F4EFE6',
  textSoft: '#D8D2C8',
  textDim: '#9F927F',

  brass: '#C6A664',
  brassSoft: 'rgba(198,166,100,0.12)',
  brassBorder: 'rgba(198,166,100,0.28)',
  glow: 'rgba(198,166,100,0.07)',

  greenSoft: '#123225',
  greenBorder: 'rgba(104,186,132,0.18)',

  currentSoft: '#16161A',
  currentBorder: 'rgba(198,166,100,0.24)',

  navySoft: '#111722',
  navyBorder: 'rgba(98,127,184,0.20)',

  plumSoft: '#1B1620',
  plumBorder: 'rgba(146,108,186,0.20)',
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: CINEMA.bg,
  },

  scroll: {
    flexGrow: 1,
    paddingHorizontal: 0,
    paddingTop: 2,
    backgroundColor: CINEMA.bg,
  },

  scrollContent: {
    paddingBottom: 120,
  },

  pageWrap: {
    width: '100%',
    maxWidth: '100%',
    alignSelf: 'stretch',
    paddingHorizontal: 16,
    paddingTop: -4,
    backgroundColor: CINEMA.bg,
  },

  mainLayout: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'center',
    gap: 18,
    marginTop: -6,
  },

  mainLayoutMobile: {
    flexDirection: 'column',
  },

  sidebar: {
    width: 220,
    gap: 12,
    marginTop: 36,
  },

  sidebarItemWrap: {
    overflow: 'hidden',
    borderRadius: 24,
    backgroundColor: CINEMA.panel,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },

  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 15,
  },

  sidebarIcon: {
    width: 40,
    height: 40,
    borderRadius: 14,
    backgroundColor: CINEMA.panel2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CINEMA.strokeSoft,
  },

  sidebarIconActive: {
    backgroundColor: CINEMA.brassSoft,
    borderColor: CINEMA.brassBorder,
  },

  sidebarTextWrap: {
    flex: 1,
  },

  sidebarTitle: {
    color: CINEMA.text,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.2,
  },

  sidebarTitleActive: {
    color: CINEMA.brass,
  },

  sidebarSubtitle: {
    color: CINEMA.textDim,
    fontSize: 11,
    marginTop: 2,
    lineHeight: 15,
    letterSpacing: 0.04,
  },

  sidebarProgressPill: {
    backgroundColor: CINEMA.brassSoft,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: CINEMA.brassBorder,
  },

  sidebarProgressText: {
    color: CINEMA.brass,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.1,
  },

  centerPanel: {
    flex: 1,
    minWidth: 0,
    gap: 14,
    width: '100%',
    alignSelf: 'stretch',
  },

  centerPanelDesktop: {
    maxWidth: 760,
    alignSelf: 'center',
  },

  centerPanelWebDesktop: {
    maxWidth: 1180,
  },

  classTopBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },

  classKicker: {
    color: CINEMA.brass,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 3,
    textTransform: 'uppercase',
    marginBottom: 4,
  },

  classTitle: {
    color: CINEMA.text,
    fontSize: 30,
    lineHeight: 34,
    fontWeight: '900',
    letterSpacing: -0.55,
  },

  referenceHeroTop: {
    width: '100%',
    paddingHorizontal: 2,
    marginBottom: 18,
  },

  referenceGreeting: {
    color: CINEMA.text,
    fontSize: 34,
    lineHeight: 39,
    fontWeight: '900',
    letterSpacing: -0.7,
  },

  referenceDateLine: {
    color: CINEMA.textDim,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
    fontWeight: '700',
  },

  bigProgressWrap: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginBottom: 16,
  },

  bigProgressOrbit: {
    width: 210,
    height: 210,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: '#090A0C',
    shadowColor: CINEMA.brass,
    shadowOpacity: 0.12,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 10 },
    zIndex: 2,
  },

  bigProgressTick: {
    position: 'absolute',
    left: 104,
    top: 97,
    width: 2,
    height: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },

  bigProgressTickActive: {
    backgroundColor: CINEMA.brass,
  },

  bigProgressInner: {
    width: 132,
    height: 132,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CINEMA.bg,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },

  bigProgressNumber: {
    color: CINEMA.text,
    fontSize: 46,
    lineHeight: 52,
    fontWeight: '900',
    letterSpacing: -1.4,
  },

  classIntroRow: {
    width: '100%',
    minHeight: 182,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 18,
    backgroundColor: '#0F1014',
    borderRadius: 30,
    paddingHorizontal: 20,
    paddingVertical: 22,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.085)',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.22,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
    elevation: 4,
  },

  classIntroCopy: {
    flex: 1,
    minWidth: 0,
    zIndex: 2,
  },

  classGreeting: {
    color: CINEMA.text,
    fontSize: 32,
    fontWeight: '900',
    lineHeight: 35,
    letterSpacing: -0.65,
  },

  classHeadline: {
    color: CINEMA.text,
    fontSize: 32,
    fontWeight: '900',
    lineHeight: 35,
    letterSpacing: -0.65,
  },

  classBody: {
    color: CINEMA.textSoft,
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
    maxWidth: 270,
  },

  classMascotCard: {
    width: 82,
    height: 82,
    borderRadius: 30,
    backgroundColor: CINEMA.brassSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CINEMA.brassBorder,
    transform: [{ rotate: '-5deg' }],
  },

  classProgressCard: {
    width: 118,
    height: 118,
    borderRadius: 999,
    backgroundColor: 'rgba(198,166,100,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(198,166,100,0.34)',
    shadowColor: CINEMA.brass,
    shadowOpacity: 0.16,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    zIndex: 2,
  },

  classProgressNumber: {
    color: CINEMA.brass,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: -0.65,
  },

  classProgressLabel: {
    color: CINEMA.textSoft,
    fontSize: 8,
    fontWeight: '800',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginTop: 2,
  },

  classProgressTrack: {
    width: 58,
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(255,255,255,0.12)',
    marginTop: 10,
  },

  classProgressFill: {
    height: 4,
    borderRadius: 999,
    backgroundColor: CINEMA.brass,
  },

  subjectHeaderRow: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingHorizontal: 2,
  },

  subjectTitle: {
    color: CINEMA.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.1,
  },

  subjectMeta: {
    color: CINEMA.brass,
    fontSize: 11,
    fontWeight: '800',
  },

  subjectTilesScroll: {
    width: '100%',
  },

  subjectTilesRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 2,
    paddingRight: 14,
    paddingBottom: 2,
  },

  subjectTilesRowWebDesktop: {
    gap: 14,
    paddingRight: 24,
  },

  subjectTile: {
    width: 118,
    minHeight: 48,
    borderRadius: 999,
    backgroundColor: CINEMA.panel2,
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
  },

  subjectTileWebDesktop: {
    width: 156,
    minHeight: 56,
    paddingHorizontal: 16,
  },

  subjectTileAlt: {
    backgroundColor: '#101014',
  },

  subjectTileCool: {
    backgroundColor: '#10131A',
  },

  subjectTileActive: {
    backgroundColor: 'rgba(198,166,100,0.14)',
    borderColor: CINEMA.brassBorder,
  },

  subjectTileIcon: {
    width: 26,
    height: 26,
    borderRadius: 999,
    backgroundColor: CINEMA.brassSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CINEMA.stroke,
  },

  subjectTileIconActive: {
    backgroundColor: CINEMA.brass,
    borderColor: CINEMA.brass,
  },

  subjectTileTextWrap: {
    flex: 1,
    minWidth: 0,
  },

  subjectProgressCircle: {
    width: 48,
    height: 48,
    borderRadius: 999,
    backgroundColor: CINEMA.card,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CINEMA.stroke,
    marginBottom: 10,
  },

  subjectProgressCircleActive: {
    backgroundColor: CINEMA.brassSoft,
    borderColor: CINEMA.brassBorder,
  },

  subjectProgressText: {
    color: CINEMA.brass,
    fontSize: 11,
    fontWeight: '900',
  },

  subjectProgressTextActive: {
    color: CINEMA.text,
  },

  subjectTileTitle: {
    color: CINEMA.text,
    fontSize: 11,
    fontWeight: '900',
    textAlign: 'left',
    maxWidth: '100%',
  },

  subjectTileTitleActive: {
    color: CINEMA.brass,
  },

  subjectMiniProgressTrack: {
    width: '100%',
    height: 4,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.07)',
  },

  subjectMiniProgressFill: {
    height: 4,
    borderRadius: 999,
    backgroundColor: CINEMA.brass,
    opacity: 0.7,
  },

  subjectMiniProgressFillActive: {
    backgroundColor: CINEMA.brass,
    opacity: 1,
  },

  subjectTileMeta: {
    color: CINEMA.textDim,
    fontSize: 9,
    fontWeight: '800',
    marginTop: 3,
  },

  subjectTileMetaActive: {
    color: CINEMA.textSoft,
  },

  currentLessonStrip: {
    width: '100%',
    marginTop: 0,
    minHeight: 72,
    borderRadius: 24,
    backgroundColor: '#121315',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 3,
  },

  currentLessonIcon: {
    width: 42,
    height: 42,
    borderRadius: 15,
    backgroundColor: CINEMA.brassSoft,
    borderWidth: 1,
    borderColor: CINEMA.brassBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  currentLessonCopy: {
    flex: 1,
    minWidth: 0,
  },

  currentLessonEyebrow: {
    color: CINEMA.brass,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 1.6,
    textTransform: 'uppercase',
    marginBottom: 3,
  },

  currentLessonTitle: {
    color: CINEMA.text,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: -0.15,
  },

  currentLessonText: {
    color: CINEMA.textSoft,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
  },

  currentLessonAction: {
    width: 40,
    height: 40,
    borderRadius: 999,
    backgroundColor: CINEMA.brass,
    alignItems: 'center',
    justifyContent: 'center',
  },

  classStatsRow: {
    width: '100%',
    flexDirection: 'row',
    gap: 9,
    marginTop: 13,
  },

  classStatPill: {
    flex: 1,
    minHeight: 58,
    borderRadius: 20,
    backgroundColor: CINEMA.panel2,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.075)',
    paddingHorizontal: 12,
    justifyContent: 'center',
  },

  classStatNumber: {
    color: CINEMA.text,
    fontSize: 16,
    fontWeight: '900',
    letterSpacing: -0.1,
  },

  classStatLabel: {
    color: CINEMA.textDim,
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
  },

  scheduleHeaderRow: {
    width: '100%',
    marginTop: 18,
    marginBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  scheduleTitle: {
    color: CINEMA.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '900',
    letterSpacing: -0.35,
  },

  scheduleFilterButton: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },

  bootcampCard: {
    backgroundColor: CINEMA.panel,
    borderRadius: 34,
    paddingHorizontal: 18,
    paddingTop: 22,
    paddingBottom: 18,
    marginTop: -10,
    marginBottom: 0,
    width: '100%',
    maxWidth: 720,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    alignSelf: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.10,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 5,
  },

  bootcampCardWebDesktop: {
    maxWidth: 1120,
    minHeight: 640,
    paddingHorizontal: 34,
    paddingTop: 34,
    paddingBottom: 30,
  },

  bootcampHeader: {
    width: '100%',
    marginBottom: 18,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 10,
    alignSelf: 'center',
  },

  bootcampTitle: {
    color: CINEMA.text,
    fontSize: 35,
    fontWeight: '800',
    letterSpacing: -1,
    lineHeight: 39,
    textAlign: 'center',
  },

  bootcampSubtitle: {
    color: CINEMA.textSoft,
    fontSize: 15,
    lineHeight: 23,
    marginTop: 10,
    textAlign: 'center',
    maxWidth: 420,
    alignSelf: 'center',
    letterSpacing: 0.05,
  },

  pathGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    rowGap: 14,
    columnGap: 8,
    marginBottom: 0,
    width: '100%',
    alignSelf: 'stretch',
    paddingHorizontal: 4,
  },

  pathCircleCard: {
    width: '31%',
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingVertical: 4,
  },

  pathCircleButton: {
    width: 84,
    height: 84,
    borderRadius: 999,
    backgroundColor: CINEMA.panel,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
  },

  pathCircleButtonActive: {
    backgroundColor: CINEMA.brassSoft,
    borderWidth: 1,
    borderColor: CINEMA.brassBorder,
    shadowColor: '#000',
    shadowOpacity: 0.20,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },

  pathCircleLabel: {
    marginTop: 10,
    color: CINEMA.text,
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 16,
    minHeight: 26,
    letterSpacing: 0.06,
  },

  pathCircleLabelActive: {
    color: CINEMA.brass,
  },

  pathGridCard: {
    width: 92,
    minHeight: 112,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CINEMA.panel,
    borderRadius: 22,
    paddingHorizontal: 8,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
  },

  pathGridCardActive: {
    backgroundColor: CINEMA.cardSoft,
    borderWidth: 1,
    borderColor: CINEMA.brassBorder,
  },

  pathGridIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
    backgroundColor: CINEMA.brassSoft,
    borderWidth: 1,
    borderColor: CINEMA.brassBorder,
  },

  pathGridIconWrapActive: {
    backgroundColor: CINEMA.brassSoft,
    borderColor: CINEMA.brassBorder,
  },

  pathGridTitle: {
    color: CINEMA.text,
    fontSize: 13,
    fontWeight: '700',
    lineHeight: 16,
    textAlign: 'center',
    minHeight: 32,
    width: '100%',
  },

  pathGridTitleActive: {
    color: CINEMA.brass,
  },

  pathGridSubtitle: {
    color: CINEMA.textDim,
    fontSize: 9,
    lineHeight: 12,
    marginTop: 5,
    textAlign: 'center',
    minHeight: 24,
  },

  pathGridSubtitleActive: {
    color: CINEMA.textSoft,
  },

  pathGridCountPill: {
    marginTop: 8,
    alignSelf: 'center',
    backgroundColor: CINEMA.panel2,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    minWidth: 36,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: CINEMA.strokeSoft,
  },

  pathGridCountPillActive: {
    backgroundColor: CINEMA.brassSoft,
    borderColor: CINEMA.brassBorder,
  },

  pathGridCountText: {
    color: CINEMA.brass,
    fontSize: 10,
    fontWeight: '700',
  },

  pathGridCountTextActive: {
    color: CINEMA.brass,
  },

  featuredCard: {
    minHeight: 274,
    backgroundColor: CINEMA.panel,
    borderRadius: 30,
    padding: 20,
    marginBottom: 2,
    marginTop: 0,
    shadowColor: '#000',
    shadowOpacity: 0.32,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 12 },
    elevation: 6,
    overflow: 'hidden',
    position: 'relative',
    borderWidth: 1,
    borderColor: CINEMA.stroke,
},

  featuredGlow: {
  position: 'absolute',
  top: -48,
  right: -20,
  width: 190,
  height: 190,
  borderRadius: 999,
  backgroundColor: CINEMA.glow,
  zIndex: 1,
},
  
  featuredTopRow: {
  flexDirection: 'row',
  alignItems: 'flex-start',
  gap: 12,
  zIndex: 2,
},


  featuredIconWrap: {
  width: 48,
  height: 48,
  borderRadius: 16,
  backgroundColor: 'rgba(0,0,0,0.24)',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.10)',
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: 2,
},
  featuredTitleWrap: {
  flex: 1,
  minHeight: 78,
  justifyContent: 'flex-start',
},

  featuredEyebrow: {
    color: CINEMA.brass,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 3.2,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  featuredTitle: {
  color: CINEMA.text,
  fontSize: 18,
  fontWeight: '800',
  lineHeight: 23,
  letterSpacing: -0.35,
},
featuredSubtitle: {
  color: CINEMA.textSoft,
  fontSize: 12,
  lineHeight: 18,
  marginTop: 8,
  marginBottom: 10,
  maxWidth: '88%',
  letterSpacing: 0.06,
},

  proOnlyPill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 12,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },

  proOnlyPillText: {
    color: CINEMA.text,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
    letterSpacing: 0.15,
  },

  featuredMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 18,
  },

  featuredMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#171A20',
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },

  featuredMetaText: {
    color: CINEMA.text,
    fontSize: 11,
    fontWeight: '600',
  },

featuredCategoryImageBg: {
  ...StyleSheet.absoluteFillObject,
  zIndex: 0,
},

featuredCategoryImageBgInner: {
  borderRadius: 34,
},

featuredImageOverlay: {
  ...StyleSheet.absoluteFillObject,
  backgroundColor: 'rgba(0,0,0,0.62)',
  borderRadius: 34,
},



  featuredStatsRow: {
  flexDirection: 'row',
  gap: 8,
  marginTop: 0,
  zIndex: 2,
},


featuredStatCard: {
  flex: 1,
  backgroundColor: 'rgba(0,0,0,0.28)',
  borderRadius: 18,
  paddingHorizontal: 10,
  paddingVertical: 10,
  minHeight: 62,
  justifyContent: 'center',
  borderWidth: 1,
  borderColor: 'rgba(255,255,255,0.08)',
},

featuredStatNumber: {
  color: CINEMA.text,
  fontSize: 16,
  fontWeight: '800',
  letterSpacing: -0.3,
},

  featuredStatLabel: {
  color: CINEMA.textDim,
  fontSize: 11,
  marginTop: 3,
  letterSpacing: 0.08,
},

  featuredProgressTrack: {
  height: 7,
  marginTop: 14,
  backgroundColor: 'rgba(255,255,255,0.06)',
  borderRadius: 999,
  overflow: 'hidden',
  zIndex: 2,
},

  featuredProgressFill: {
    height: 8,
    backgroundColor: CINEMA.brass,
    borderRadius: 999,
  },

  featuredButton: {
  minHeight: 48,
  marginTop: 14,
  borderRadius: 18,
  backgroundColor: CINEMA.brass,
  alignItems: 'center',
  justifyContent: 'center',
  flexDirection: 'row',
  gap: 8,
  shadowColor: '#000',
  shadowOpacity: 0.12,
  shadowRadius: 16,
  shadowOffset: { width: 0, height: 7 },
  elevation: 5,
  zIndex: 2,
},

  featuredButtonText: {
  color: BG,
  fontSize: 13,
  fontWeight: '800',
  letterSpacing: 0.25,
},

  missionBanner: {
    flexDirection: 'row',
    gap: 12,
    backgroundColor: '#101114',
    borderRadius: 24,
    padding: 16,
    marginBottom: 0,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.075)',
  },

  missionBannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 15,
    backgroundColor: CINEMA.navySoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CINEMA.stroke,
  },

  missionBannerTextWrap: {
    flex: 1,
  },

  missionBannerTitle: {
    color: CINEMA.text,
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 5,
    letterSpacing: -0.1,
  },

  missionBannerText: {
    color: CINEMA.textSoft,
    fontSize: 13,
    lineHeight: 21,
    letterSpacing: 0.04,
  },

  sectionHeader: {
    marginTop: 8,
    marginBottom: 12,
    paddingHorizontal: 2,
  },

  sectionTitle: {
    color: CINEMA.text,
    fontSize: 22,
    fontWeight: '900',
    lineHeight: 26,
    letterSpacing: -0.45,
  },

  sectionSubtitle: {
    color: CINEMA.textDim,
    fontSize: 12,
    marginTop: 4,
    letterSpacing: 0.1,
  },

  loadingCard: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: CINEMA.card,
    borderRadius: 24,
    paddingVertical: 34,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
  },

  loadingCardText: {
    color: CINEMA.textSoft,
    fontSize: 14,
    letterSpacing: 0.1,
  },

  lessonSectionsWrap: {
    gap: 12,
  },

  chapterListCard: {
    backgroundColor: '#0F1012',
    borderRadius: 28,
    padding: 14,
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
    elevation: 3,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.075)',
  },

  chapterListCardExpanded: {
    backgroundColor: '#111216',
    borderColor: 'rgba(198,166,100,0.24)',
  },

  chapterListCardCompleted: {
    backgroundColor: '#0D1913',
  },

  chapterListCardLocked: {
    opacity: 0.72,
  },

  chapterToggle: {
    width: '100%',
  },

  chapterListHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
  },

  chapterListHeaderText: {
    flex: 1,
  },

  chapterListEyebrow: {
    color: CINEMA.brass,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    marginBottom: 5,
  },

  chapterListTitle: {
    color: CINEMA.text,
    fontSize: 19,
    fontWeight: '900',
    lineHeight: 23,
    letterSpacing: -0.45,
  },

  chapterListSubtitle: {
    color: CINEMA.textSoft,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 4,
    letterSpacing: 0.08,
  },

  chapterRightStack: {
    alignItems: 'center',
    gap: 8,
  },

  chapterListCountPill: {
    backgroundColor: CINEMA.brassSoft,
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 7,
    minWidth: 54,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: CINEMA.brassBorder,
  },

  chapterListCountText: {
    color: CINEMA.brass,
    fontSize: 12,
    fontWeight: '700',
  },

  chapterListProgressTrack: {
    height: 7,
    marginTop: 14,
    marginBottom: 2,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 999,
    overflow: 'hidden',
  },

  chapterListProgressFill: {
    height: 7,
    backgroundColor: CINEMA.brass,
    borderRadius: 999,
  },

  chapterLockedBox: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: CINEMA.cardSoft,
    borderRadius: 18,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
  },

  chapterLockedText: {
    color: CINEMA.textDim,
    fontSize: 13,
    fontWeight: '500',
    letterSpacing: 0.05,
  },

  lessonRowsWrap: {
    gap: 8,
    paddingTop: 10,
  },

  lessonPathWrap: {
    position: 'relative',
    gap: 10,
    paddingTop: 12,
    paddingLeft: 6,
  },

  lessonPathRail: {
    position: 'absolute',
    top: 22,
    bottom: 20,
    left: 19,
    width: 2,
    borderRadius: 999,
    backgroundColor: 'rgba(198,166,100,0.18)',
  },

  lessonPathItem: {
    flexDirection: 'row',
    alignItems: 'stretch',
    gap: 9,
  },

  lessonPathNode: {
    width: 24,
    height: 24,
    borderRadius: 999,
    marginTop: 13,
    backgroundColor: CINEMA.panel,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.24)',
    zIndex: 2,
  },

  lessonPathNodeCompleted: {
    backgroundColor: '#18392A',
    borderColor: CINEMA.greenBorder,
  },

  lessonPathNodeCurrent: {
    backgroundColor: CINEMA.brass,
    borderColor: CINEMA.brass,
  },

  lessonPathNodeLocked: {
    backgroundColor: '#101318',
    borderColor: CINEMA.stroke,
  },

  lessonPathNodeText: {
    color: CINEMA.brass,
    fontSize: 10,
    fontWeight: '900',
  },

  lessonPathNodeTextCurrent: {
    color: '#FFFFFF',
  },

  lessonPathNodeTextLocked: {
    color: CINEMA.textDim,
  },

  lessonRowCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#141518',
    borderRadius: 22,
    paddingHorizontal: 13,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },

  lessonRowCardCompleted: {
    backgroundColor: 'rgba(71,214,111,0.075)',
    borderColor: CINEMA.greenBorder,
  },

  lessonRowCardCurrent: {
    backgroundColor: 'rgba(198,166,100,0.11)',
    borderColor: 'rgba(198,166,100,0.26)',
  },

  lessonRowCardLocked: {
    opacity: 0.5,
  },

  lessonRowIconWrap: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: 'rgba(198,166,100,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CINEMA.stroke,
  },

  lessonRowIconWrapCompleted: {
    backgroundColor: '#18392A',
    borderColor: CINEMA.greenBorder,
  },

  lessonRowIconWrapCurrent: {
    backgroundColor: CINEMA.brass,
    borderColor: CINEMA.brass,
  },

  lessonRowIconWrapLocked: {
    backgroundColor: '#101318',
  },

  lessonRowTextWrap: {
    flex: 1,
  },

  lessonRowTopLine: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  lessonRowStep: {
    color: CINEMA.textDim,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.45,
  },

  lessonRowBadgeWrap: {
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
  },

  lessonRowKindPill: {
    backgroundColor: CINEMA.brassSoft,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderWidth: 1,
    borderColor: CINEMA.brassBorder,
  },

  lessonRowKindText: {
    color: CINEMA.brass,
    fontSize: 9,
    fontWeight: '700',
    letterSpacing: 0.35,
  },

  lessonRowMissionPill: {
    width: 22,
    height: 22,
    borderRadius: 999,
    backgroundColor: CINEMA.navySoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: CINEMA.stroke,
  },

  lessonRowTitle: {
    color: CINEMA.text,
    fontSize: 15,
    fontWeight: '900',
    lineHeight: 19,
    marginTop: 4,
    letterSpacing: -0.28,
  },

  lessonRowSubtitle: {
    color: CINEMA.textSoft,
    fontSize: 12,
    lineHeight: 16,
    marginTop: 3,
    letterSpacing: 0.05,
  },

  lessonRowMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 7,
    marginTop: 6,
  },

  lessonRowMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: CINEMA.panel2,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
  },

  lessonRowMetaText: {
    color: CINEMA.textSoft,
    fontSize: 9,
    fontWeight: '600',
  },

  lessonRowStatusPill: {
    backgroundColor: CINEMA.panel2,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: CINEMA.stroke,
  },

  lessonRowStatusPillCompleted: {
    backgroundColor: 'rgba(104,186,132,0.16)',
    borderColor: 'rgba(104,186,132,0.24)',
  },

  lessonRowStatusPillCurrent: {
    backgroundColor: CINEMA.brassSoft,
    borderColor: CINEMA.brassBorder,
  },

  lessonRowStatusPillLocked: {
    backgroundColor: '#101318',
  },

  lessonRowStatusText: {
    color: CINEMA.textSoft,
    fontSize: 10,
    fontWeight: '700',
  },

  lessonRowStatusTextCompleted: {
    color: '#7EC79A',
  },

  lessonRowStatusTextCurrent: {
    color: CINEMA.brass,
  },

  lessonRowStatusTextLocked: {
    color: CINEMA.textDim,
  },

  lessonRowChevron: {
    marginLeft: 2,
  },

  lockedText: {
    color: CINEMA.textDim,
  },

  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4,4,6,0.86)',
  },

  modalCenter: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 18,
  },

  modalCard: {
    width: '100%',
    maxWidth: 680,
    maxHeight: '90%',
    overflow: 'hidden',
    backgroundColor: '#0C0E12',
    borderRadius: 30,
    shadowColor: '#000',
    shadowOpacity: 0.44,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 18 },
    elevation: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },

  surveyModalCard: {
    maxWidth: 700,
  },

  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 16,
    padding: 20,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },

  modalHeaderLeft: {
    flexDirection: 'row',
    gap: 14,
    flex: 1,
  },

  modalIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 15,
    backgroundColor: 'rgba(198,166,100,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(198,166,100,0.24)',
  },

  surveyModalIconCircle: {
    backgroundColor: PURPLE_SOFT,
  },

  modalTitleWrap: {
    flex: 1,
  },

  modalEyebrow: {
    color: CINEMA.textDim,
    fontSize: 11,
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    marginBottom: 5,
  },

  pathPillsWrap: {
    width: '100%',
    position: 'relative',
    marginTop: 2,
  },

  pathPillsRowStatic: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },

  pathPillCompact: {
    flex: 1,
    minHeight: 34,
    maxWidth: '24%',
    borderRadius: 999,
    backgroundColor: CINEMA.panel,
    borderWidth: 1,
    borderColor: CINEMA.strokeSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },

  pathPillCompactActive: {
    backgroundColor: CINEMA.brassSoft,
    borderColor: CINEMA.brassBorder,
  },

  pathPillCompactIcon: {
    marginTop: 0.5,
  },

  pathPillCompactText: {
    color: CINEMA.text,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  pathPillCompactTextActive: {
    color: CINEMA.brass,
  },

  pathPillsScroll: {
    width: '100%',
  },

  pathPillsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 2,
    paddingRight: 24,
  },

  pathPillCinematic: {
    minHeight: 40,
    borderRadius: 999,
    backgroundColor: '#0C0E12',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.055)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },

  pathPillCinematicActive: {
    backgroundColor: 'rgba(198,166,100,0.10)',
    borderColor: 'rgba(198,166,100,0.34)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },

  pathPillCinematicIcon: {
    marginTop: 0.5,
  },

  pathPillCinematicText: {
    color: CINEMA.text,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.28,
  },

  pathPillCinematicTextActive: {
    color: CINEMA.brass,
  },

  pathPill: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: CINEMA.panel,
    borderWidth: 1,
    borderColor: CINEMA.strokeSoft,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },

  pathPillActive: {
    backgroundColor: CINEMA.brassSoft,
    borderColor: CINEMA.brassBorder,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },

  pathPillIcon: {
    marginTop: 0.5,
  },

  pathPillText: {
    color: CINEMA.text,
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.35,
  },

  pathPillTextActive: {
    color: CINEMA.brass,
  },

  pathPillsFadeRight: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 24,
    backgroundColor: 'rgba(5,5,6,0.84)',
  },

  modalTitle: {
    color: CINEMA.text,
    fontSize: 21,
    fontWeight: '800',
    lineHeight: 27,
    letterSpacing: -0.2,
  },

  modalMini: {
    color: CINEMA.textDim,
    fontSize: 12,
    marginTop: 5,
    letterSpacing: 0.1,
  },

  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#15181D',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },

  modalScroll: {
    maxHeight: 470,
  },

  modalScrollContent: {
    padding: 20,
    gap: 14,
  },

  modalDescription: {
    color: CINEMA.textSoft,
    fontSize: 14,
    lineHeight: 23,
    paddingHorizontal: 20,
    paddingTop: 18,
    letterSpacing: 0.08,
  },

  surgeryIntroText: {
    paddingBottom: 0,
  },

  modalMetaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 14,
  },

  modalMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#15181D',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.04)',
  },

  modalMetaText: {
    color: CINEMA.text,
    fontSize: 11,
    fontWeight: '600',
  },

  modalMetaLocked: {
    backgroundColor: '#161921',
  },

  modalMetaDone: {
    backgroundColor: '#10241B',
  },

  lockCard: {
    marginHorizontal: 20,
    marginTop: 14,
    gap: 10,
    backgroundColor: '#141820',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: CINEMA.brassBorder,
  },

  lockCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  lockCardTitle: {
    color: CINEMA.text,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.1,
  },

  lockCardText: {
    color: CINEMA.textSoft,
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: 0.05,
  },

  lockCardButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#C6A664',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },

  lockCardButtonText: {
    color: '#0A0B0D',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.1,
  },

  detailCard: {
    backgroundColor: '#12151A',
    borderRadius: 18,
    padding: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.045)',
  },

  detailCardSoft: {
    backgroundColor: '#17131B',
  },

  detailCardBlue: {
    backgroundColor: '#121825',
  },

  detailLabel: {
    color: CINEMA.brass,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 8,
  },

  detailText: {
    color: CINEMA.text,
    fontSize: 13,
    lineHeight: 21,
    letterSpacing: 0.05,
  },

  rulesCard: {
    backgroundColor: '#12151A',
    borderRadius: 18,
    padding: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.045)',
  },

  rulesTitle: {
    color: CINEMA.brass,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1.15,
    textTransform: 'uppercase',
    marginBottom: 10,
  },

  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },

  ruleText: {
    color: CINEMA.text,
    fontSize: 12,
    lineHeight: 19,
    flex: 1,
    letterSpacing: 0.04,
  },

  surveyProgressTrack: {
    height: 8,
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 999,
    overflow: 'hidden',
  },

  surveyProgressFill: {
    height: 8,
    backgroundColor: PURPLE,
    borderRadius: 999,
  },

  surveyCountText: {
    color: CINEMA.textSoft,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 20,
    paddingTop: 10,
  },

  surveyList: {
    maxHeight: 360,
    marginTop: 12,
  },

  surveyListContent: {
    paddingHorizontal: 20,
    paddingBottom: 10,
    gap: 12,
  },

  surveyFilmCard: {
    gap: 10,
    backgroundColor: '#12151A',
    borderRadius: 20,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.045)',
  },

  surveyFilmCardDone: {
    backgroundColor: '#10241B',
  },

  surveyFilmHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  surveyFilmBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: PURPLE_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  surveyFilmBadgeDone: {
    backgroundColor: GREEN,
  },

  surveyFilmTextWrap: {
    flex: 1,
  },

  surveyFilmTitle: {
    color: CINEMA.text,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.1,
  },

  surveyFilmMeta: {
    color: CINEMA.textSoft,
    fontSize: 12,
    marginTop: 2,
  },

  surveyFilmHook: {
    color: CINEMA.text,
    fontSize: 13,
    lineHeight: 19,
    letterSpacing: 0.04,
  },

  feedbackHintCard: {
    backgroundColor: '#12151A',
    borderRadius: 14,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.045)',
  },

  feedbackHintTitle: {
    color: CINEMA.brass,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 5,
  },

  feedbackHintText: {
    color: CINEMA.textSoft,
    fontSize: 12,
    lineHeight: 18,
    letterSpacing: 0.04,
  },

  feedbackButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#15181D',
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },

  feedbackButtonDone: {
    backgroundColor: GREEN,
  },

  feedbackButtonText: {
    color: CINEMA.text,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.08,
  },

  feedbackButtonTextDone: {
    color: '#050505',
  },

  modalActions: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
    backgroundColor: '#0C0E12',
  },

  modalButton: {
    flex: 1,
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
    borderRadius: 18,
    paddingHorizontal: 12,
  },

  modalGhostButton: {
    backgroundColor: '#15181D',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.05)',
  },

  modalGhostText: {
    color: CINEMA.text,
    fontSize: 13,
    fontWeight: '700',
    letterSpacing: 0.16,
  },

  modalGoldButton: {
    flex: 1.12,
    backgroundColor: '#C6A664',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },

  modalGoldText: {
    color: '#090909',
    fontSize: 12,
    fontWeight: '800',
    letterSpacing: 0.45,
    textTransform: 'uppercase',
  },

  modalDisabledButton: {
    backgroundColor: '#101318',
  },

  modalDisabledText: {
    color: CINEMA.textDim,
  },
});
