import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { giveXp, supabase, type UserTier } from '../lib/supabase';
import { useGamification } from '../context/GamificationContext';
import { useMonthlyStreak } from '../lib/useMonthlyStreak';
import { UpgradeModal } from '../../components/UpgradeModal';

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

/* -------------------------------- types -------------------------------- */
type WorkshopPathKey =
  | 'acting'
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
  prompt: string;
  objective: string;
  deliverable: string;
  bonusNote?: string;
  constraints: string[];
  kind: LessonKind;
};

type Lesson = {
  id: number;
  step: number;
  title: string;
  subtitle: string;
  description: string;
  prompt: string;
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
};

/* -------------------------------- paths -------------------------------- */
const PATHS: PathMeta[] = [
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
  {
    key: 'filmmaker',
    label: 'All In One Filmmaker',
    shortLabel: 'Filmmaker',
    subtitle: 'Separate elite mixed path',
    icon: 'sparkles-outline',
    description:
      'A separate mixed path combining acting, directing, cinematography, editing, sound, collaboration, and community feedback.',
  },
];

/* ---------------------------- lesson banks ---------------------------- */
const makeSeed = (
  title: string,
  subtitle: string,
  description: string,
  prompt: string,
  objective: string,
  deliverable: string,
  constraints: string[],
  kind: LessonKind = 'drill',
  bonusNote?: string
): LessonSeed => ({
  title,
  subtitle,
  description,
  prompt,
  objective,
  deliverable,
  constraints,
  kind,
  bonusNote,
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
    'A 45–90 second filmed exercise where the object clearly matters before you ever explain why.',
    [
      'Use only one object.',
      'Do not explain its history out loud.',
      'Let touch, hesitation, attention, and breath reveal its meaning.',
    ],
    'drill',
    'The audience should feel the object has history, value, and emotional charge even if they never learn the full story.'
  ),
  makeSeed(
    'Reactivity Drill',
    'Foundation',
    'Let another person genuinely change you in real time.',
    'Play a short partner exchange where your job is not to be interesting, but to be affected.',
    'Train responsiveness, moment-to-moment truth, and behavioral adjustment.',
    'A 45–90 second two-person exercise with at least 3 visible changes in your behavior.',
    [
      'Do not pre-plan reactions.',
      'Stay with the other actor.',
      'If you have no partner, record a partner track first and respond to it truthfully in one take.',
    ],
    'drill'
  ),
  makeSeed(
    'Repetition for Camera',
    'Foundation',
    'Use simple repetition to free up live response.',
    'With a scene partner, repeat a simple factual phrase and let the exchange evolve through behavior, not clever wording.',
    'Train responsiveness, presence, and truthful listening.',
    'A 1–2 minute filmed repetition exercise where the words stay simple but the exchange becomes alive.',
    [
      'Keep the phrase simple and factual.',
      'Do not invent witty lines.',
      'If you have no partner, use a fixed recorded phrase and let your responses shift truthfully.',
    ],
    'improv'
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
    'This should feel alive because of what you are doing, not because you pre-performed the line.'
  ),
  makeSeed(
    'Independent Activity',
    'Foundation',
    'Truth gets stronger when the body has a real job to do.',
    'Do a difficult private task with real urgency while another person interrupts, questions, distracts, or needs something from you.',
    'Train concentration, justification, urgency, and truthful doing under imaginary circumstances.',
    'A 1–2 minute scene with a clear practical task and rising pressure.',
    [
      'Choose a task that is difficult to complete.',
      'The task must matter personally.',
      'If you have no partner, let an offscreen interruption force you to keep doing the task while responding.',
    ],
    'improv'
  ),
  makeSeed(
    'Previous Circumstances Entrance',
    'Foundation',
    'Enter the frame with a life already happening.',
    'Begin a scene as if the most important event started before the camera rolled and you are already inside it.',
    'Train entrances, residue, and lived-in circumstance.',
    'A 45–90 second scene where the first 5 seconds imply unseen history.',
    [
      'Enter already in motion.',
      'No backstory speech.',
      'The body should arrive before the explanation does.',
    ],
    'scene'
  ),
  makeSeed(
    'Action, Not Emotion',
    'Foundation',
    'Play a clear action instead of a vague feeling.',
    'Perform a short scene where your action is to reassure someone while privately trying to hide frightening news.',
    'Train action-based acting and stop generalized emotional playing.',
    'A 30–60 second close scene where the action is clear and the feeling arrives through behavior.',
    [
      'Use the line: “I’m fine, honestly.”',
      'Do not cry.',
      'Play reassurance, not sadness.',
    ],
    'drill'
  ),
  makeSeed(
    'As If: Unexpected Reunion',
    'Imagination',
    'Use a precise imaginative reality.',
    'Say “I didn’t expect to see you here” as if you have just met the teacher who changed your life.',
    'Train specificity in imaginative substitution.',
    'A short single-take performance built around one exact circumstance.',
    [
      'Keep the line exact.',
      'No costume tricks.',
      'The shift must come from thought and behavior.',
    ],
    'technical'
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
    'technical'
  ),
  makeSeed(
    'Silent Objective',
    'Behavior',
    'Let the want live in the body.',
    'Play a moment where you need forgiveness but cannot ask for it out loud.',
    'Train silent pursuit and readable need.',
    'A silent 30–60 second close-up or medium-shot performance.',
    [
      'No dialogue.',
      'No music.',
      'Only behavior, focus, and breath can tell the story.',
    ],
    'drill'
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
    'scene'
  ),
  makeSeed(
    'Text vs Subtext',
    'Subtext',
    'Say one thing while doing another.',
    'Play the line “You should go” while your real action is to make them stay.',
    'Train contradiction between text and intention.',
    'A short scene where the hidden action is readable without explanation.',
    [
      'Keep the spoken text simple.',
      'The real want must be clear.',
      'Do not overplay the contradiction.',
    ],
    'scene'
  ),
  makeSeed(
    'Status Shift',
    'Status',
    'Change status without announcing it.',
    'Play a scene where you begin lower in status and gradually gain control through behavior and timing.',
    'Train status play, tactical adjustment, and power movement.',
    'A 1–2 minute scene with a visible reversal in who holds control.',
    [
      'The shift must be gradual.',
      'Do not announce the change.',
      'Use timing, eye line, and physical behavior more than words.',
    ],
    'drill'
  ),
  makeSeed(
    'Emotional Leak',
    'Pressure',
    'Stay functional while emotion escapes in cracks.',
    'Improvise a scene where you are trapped in small talk immediately after life-changing news.',
    'Train contradiction, leakage, and internal pressure.',
    'A 1–2 minute improvised scene with escalating internal strain.',
    [
      'No shouting.',
      'Start calm.',
      'End in a different emotional state than you began.',
    ],
    'improv'
  ),
  makeSeed(
    'Character Entrance',
    'Presence',
    'Tell us who the character is the moment they arrive.',
    'Enter the scene so we instantly read status, danger, insecurity, charm, or shame.',
    'Train first-impression storytelling.',
    'A 20–45 second entrance-based performance.',
    [
      'Entrance within the first 10 seconds.',
      'No voiceover.',
      'Use pace, posture, rhythm, and focus.',
    ],
    'drill'
  ),
  makeSeed(
    'Scene Recreation: Famous Close-Up',
    'Scene Study',
    'Learn precision by remaking a great screen moment.',
    'Recreate a short close-up scene from a famous film or TV performance, focusing on behavior, timing, and thought rather than imitation.',
    'Train observation, film behavior, and on-camera economy.',
    'A 30–90 second recreation with your own truthful life inside the scene.',
    [
      'Choose a short scene.',
      'Do not do an impression.',
      'Study silence, thought, and behavior more than voice.',
    ],
    'scene'
  ),
  makeSeed(
    'Dual Character Scene',
    'Solo Scene',
    'Play both sides of a serious scene truthfully.',
    'Perform a two-character scene alone by recording both roles separately, giving each character a real objective and full inner life.',
    'Train contrast, specificity, and serious dual-role scene work.',
    'A 45–120 second two-character scene that feels like two real people, not a skit.',
    [
      'Take both roles seriously.',
      'The two characters must want different things.',
      'If possible, try finding a partner through your city chat first.',
    ],
    'technical',
    'This is not a comedy sketch exercise. Both characters should feel specific, dignified, and fully lived.'
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
    'A filmed two-person scene of 45–120 seconds.',
    [
      'Play the stakes, not just anger.',
      'There must be a shift by the end.',
      'Avoid generic shouting.',
    ],
    'scene'
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
    'A short scene with visible imbalance and rising pressure.',
    [
      'Do not rush the pauses.',
      'Calm can be more threatening than volume.',
      'The final line must land.',
    ],
    'scene'
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
    'technical'
  ),
  makeSeed(
    'Memory Trigger',
    'Inner Life',
    'A small trigger detonates the scene from inside.',
    'Play a scene where an object, smell, or phrase unexpectedly triggers a painful memory mid-conversation.',
    'Train internal shifts caused by private life.',
    'A short scene with a visible internal interruption.',
    [
      'The trigger must be small.',
      'Do not explain the memory.',
      'Let the body register it first.',
    ],
    'drill'
  ),
  makeSeed(
    'Need Without Touch',
    'Constraint',
    'Keep them there without force.',
    'Play a scene where you must stop someone leaving, but you cannot touch them or stand in the doorway.',
    'Train tactical variety and inventive pursuit.',
    'A short scene built around persuasion, distraction, seduction, or vulnerability.',
    [
      'No touching.',
      'No blocking the exit.',
      'You must keep pursuing the action.',
    ],
    'constraint'
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
    'A short scene with a slow tightening of power.',
    [
      'Keep it grounded.',
      'Do not play general villainy.',
      'Let silence do part of the work.',
    ],
    'scene'
  ),
  makeSeed(
    'Apology Rejected',
    'Conflict',
    'Want forgiveness and fail to get it.',
    'Perform a scene where you apologise sincerely but realise halfway through that they will never forgive you.',
    'Train collapsing action and tactical failure in real time.',
    'A short scene with a visible collapse in hope.',
    [
      'Start with hope.',
      'Let defeat arrive gradually.',
      'No self-pity theatrics.',
    ],
    'scene'
  ),
  makeSeed(
    'Public Mask',
    'Constraint',
    'Hide a private emergency in public.',
    'Play a private emotional crisis while trapped in a public place where you must appear normal.',
    'Train split behavior and social masking.',
    'A 45–90 second performance with concealed panic, grief, or humiliation.',
    [
      'No big breakdown.',
      'Public behavior must stay believable.',
      'The internal struggle must still read.',
    ],
    'constraint'
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
    'A short two-person scene with an unresolved wound beneath the words.',
    [
      'Do not play general irritation.',
      'Make shared history felt.',
      'The last line must cut.',
    ],
    'scene'
  ),
  makeSeed(
    'Objective Through Courtesy',
    'Tactics',
    'Be polite while playing ruthlessly.',
    'Play a scene where your action is to dominate, manipulate, or expose someone while staying outwardly pleasant.',
    'Train contrast between social tone and private action.',
    'A short scene where danger hides inside courtesy.',
    [
      'No overt aggression.',
      'Use charm as a weapon.',
      'The action must stay active throughout.',
    ],
    'drill'
  ),
  makeSeed(
    'Status Loss',
    'Status',
    'Arrive in control and leave exposed.',
    'Perform a scene where you begin with authority but lose it before the end.',
    'Train descending status and unraveling control.',
    'A short scene with a clear collapse in power.',
    [
      'The fall must be visible.',
      'Do not rush the collapse.',
      'Avoid cliché humiliation acting.',
    ],
    'scene'
  ),
  makeSeed(
    'Monologue to Someone Present',
    'Monologue',
    'A monologue is still an action on another person.',
    'Deliver a monologue directly to a specific person in the room who keeps affecting how you say it.',
    'Train active monologue behavior.',
    'A 60–120 second monologue with at least two tactical shifts.',
    [
      'Do not perform into emptiness.',
      'The listener must affect you.',
      'There must be at least two turns.',
    ],
    'technical'
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
    'improv'
  ),
  makeSeed(
    'Protect the Lie',
    'High Stakes',
    'The lie matters more than your dignity.',
    'Play a scene where you must keep a lie alive even when the other person is almost certainly right.',
    'Train survival behavior under exposure.',
    'A short scene with mounting pressure and tactical adaptation.',
    [
      'Never simply give up.',
      'Switch tactics when needed.',
      'Fear of exposure must be visible.',
    ],
    'scene'
  ),
  makeSeed(
    'Scene From Stillness',
    'Camera',
    'Do less and let the camera catch more.',
    'Play an emotionally loaded close-up with almost no movement, letting the eyes and breath do the work.',
    'Train on-camera economy.',
    'A 20–40 second close-up performance.',
    [
      'Keep movement minimal.',
      'No theatrical gesturing.',
      'Let the camera come to you.',
    ],
    'technical'
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
    'A short scene where simplicity carries emotional weight.',
    [
      'Do not over-romanticise it.',
      'Let history live in the pauses.',
      'Stay truthful, not poetic.',
    ],
    'scene'
  ),
  makeSeed(
    'Pleading Without Weakness',
    'Advanced Tactics',
    'Need does not have to look collapsed.',
    'Play a scene where you beg for something life-changing without losing your dignity.',
    'Train strong pleading rather than generic desperation.',
    'A 45–90 second scene built around controlled need.',
    [
      'No melodrama.',
      'Your pride must stay present.',
      'The stakes must feel real.',
    ],
    'drill'
  ),
  makeSeed(
    'Shame Scene',
    'Advanced Emotion',
    'Shame behaves differently from grief or anger.',
    'Perform a scene where the main engine is shame rather than sadness or rage.',
    'Train quieter, more exact emotional states.',
    'A short scene where shame shapes eye line, posture, and speech.',
    [
      'No weeping shortcut.',
      'Keep it specific.',
      'Let shame affect the body first.',
    ],
    'scene'
  ),
  makeSeed(
    'Mask to Threat',
    'Turn',
    'Charm turns dangerous.',
    'Start a scene warmly and let it slowly become threatening without raising your volume much.',
    'Train tonal transformation and behavioral control.',
    'A short scene with a chilling pivot.',
    [
      'The shift must be gradual.',
      'Keep volume mostly controlled.',
      'The final beat must feel earned.',
    ],
    'constraint'
  ),
  makeSeed(
    'Caregiver Exhaustion',
    'Character Study',
    'Love and burnout at the same time.',
    'Play someone caring for another person while privately nearing emotional collapse.',
    'Train contradiction between tenderness and depletion.',
    'A short scene showing compassion and fatigue together.',
    [
      'Do not villainise the person being cared for.',
      'Fatigue must live in behavior.',
      'Let compassion and resentment coexist.',
    ],
    'scene'
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
    'drill'
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
    'technical'
  ),
  makeSeed(
    'No Sympathy Allowed',
    'Mastery',
    'Need something badly without playing for pity.',
    'Perform a scene where you are desperate but cannot let the other person pity you.',
    'Train pride inside vulnerability.',
    'A short scene built around need, self-protection, and contradiction.',
    [
      'No begging tone.',
      'Pride must stay alive.',
      'Let vulnerability leak, do not present it.',
    ],
    'drill'
  ),
  makeSeed(
    'Cold Rage',
    'Mastery',
    'Anger without explosion.',
    'Play a confrontation where anger grows colder and more dangerous instead of louder.',
    'Train contained aggression and controlled danger.',
    'A short confrontation where threat increases through restraint.',
    [
      'No shouting.',
      'Use stillness and focus.',
      'The final beat must feel dangerous.',
    ],
    'scene'
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
    'technical'
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
    'A 15–30 second sequence where the action is completely easy to follow on first watch.',
    [
      'Use exactly 5 shots.',
      'Do not add music.',
      'The audience must understand the action without text.',
    ],
    'drill',
    'This is about order and clarity, not style.'
  ),
  makeSeed(
    'Door, Cross, Sit',
    'Flow',
    'Make one continuous action feel seamless across multiple shots.',
    'Shoot or use footage of someone opening a door, entering a room, crossing to a chair, and sitting down. Get at least 1 wide, 2 mediums, and 2 close details. Edit it so the movement feels continuous and screen direction stays clear.',
    'Train continuity, matching movement, and spatial logic.',
    'A 20–40 second sequence where the action plays smoothly with no confusing jump in space or direction.',
    [
      'Keep left/right screen direction consistent.',
      'Match the sitting action cleanly across cuts.',
      'Do not use effects or transitions.',
    ],
    'technical'
  ),
  makeSeed(
    'Choose the Best Take',
    'Selection',
    'Learn to spot the take with the clearest behavior.',
    'Record 3 takes of the same short line: “I didn’t mean to do that.” In one take play apology, in one defensiveness, and in one hidden amusement. Build a short edit using the take that creates the strongest and clearest read.',
    'Train take selection and editorial taste.',
    'A 10–20 second close-up performance edit built around your strongest take choice.',
    [
      'Use the same framing in all 3 takes.',
      'Choose based on truth, not just cleanliness.',
      'Be able to explain why your chosen take works best.',
    ],
    'scene'
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
    'technical'
  ),
  makeSeed(
    'Reaction to Bad News',
    'Emotion',
    'Learn how a reaction shot changes the story.',
    'Shoot or use a 2-person exchange where one person says, “He’s not coming.” Create version A where you cut immediately to the reaction, and version B where you delay the reaction by 1–2 beats.',
    'Train emphasis, reaction timing, and emotional interpretation.',
    'Two short edits of the same scene where the meaning changes because of reaction timing.',
    [
      'Use the exact same footage in both versions.',
      'Only change reaction timing.',
      'The audience should feel a different emotional result in each cut.',
    ],
    'drill'
  ),
  makeSeed(
    'Room Tone Under Dialogue',
    'Sound Foundations',
    'Hide audio cuts and keep a scene sonically stable.',
    'Shoot or use a 15–30 second dialogue clip in one room. Record 20 seconds of empty room tone in the same space. Lay the room tone underneath your dialogue edits so the background sound remains consistent.',
    'Train basic sound continuity and clean dialogue editing.',
    'A short dialogue edit with smooth audio underneath every cut.',
    [
      'Use real room tone from the same location.',
      'No dead silence between cuts.',
      'The audio bed should feel steady and natural.',
    ],
    'technical'
  ),
  makeSeed(
    'J-Cut and L-Cut Basics',
    'Audio Flow',
    'Let sound lead or trail the image.',
    'Use a 20–40 second 2-person conversation filmed in shot/reverse-shot. Make one version where the next line begins before the image cuts (J-cut), and one where the previous line continues after the image changes (L-cut).',
    'Train split edits and dialogue flow.',
    'Two short dialogue examples showing one J-cut and one L-cut clearly.',
    [
      'Use the same conversation footage for both.',
      'Keep the scene readable.',
      'The audio overlap must improve flow, not confuse it.',
    ],
    'technical'
  ),
];

const EDITING_INTERMEDIATE: LessonSeed[] = [
  makeSeed(
    'Hard Cut vs Crossfade',
    'Sound Editing',
    'Hear the difference between an abrupt cut and a shaped transition.',
    'Take 2 adjacent audio clips from the same room dialogue scene and make 3 versions: a hard cut, a short crossfade, and a longer crossfade.',
    'Train crossfade judgment, transition feel, and audio smoothness.',
    'Three 5–10 second audio transition examples built from the same source.',
    [
      'Use the same source clips in all 3 versions.',
      'Avoid clicks, pops, or bumps.',
      'Choose the version that best supports the moment, not the fanciest one.',
    ],
    'technical'
  ),
  makeSeed(
    'Layer a Room Entry',
    'Sound Editing',
    'Build a believable scene out of multiple audio layers.',
    'Shoot or use a 15–25 second scene of someone entering a room, setting down a bag, sitting in a chair, and opening a notebook. Build the soundtrack from 4 separate layers: room tone, footsteps, bag impact, and chair/notebook detail.',
    'Train layering, prioritising detail, and avoiding muddy mixes.',
    'A short scene with a fuller, more intentional soundtrack than raw production audio.',
    [
      'Use at least 4 audio layers.',
      'Each layer must add something specific.',
      'Do not let layering make the mix muddy.',
    ],
    'technical'
  ),
  makeSeed(
    'Fade Shape Study',
    'Sound Editing',
    'Use fades as emotional tools, not just cleanup.',
    'Take one clip with dialogue or ambience and make 3 versions of its ending: abrupt end, short fade, and long fade. Compare which feels natural and which feels dramatic.',
    'Train fade length control and how fades change emotional tone.',
    'Three short exports of the same clip with clearly different endings.',
    [
      'Change only the fade shape or length.',
      'Listen on speakers and headphones if possible.',
      'Be able to explain what each fade does to the feeling.',
    ],
    'technical'
  ),
  makeSeed(
    'Pace the Performance',
    'Emotion',
    'Shape how an actor lands through timing.',
    'Take a performance-heavy close-up moment and make 2 versions: one that cuts quickly around the actor and one that lets the actor breathe.',
    'Train sensitivity to breathing room and performance emphasis.',
    'Two short edits of the same performance beat with clearly different emotional weight.',
    [
      'Do not flatten the emotion by overcutting.',
      'At least one held beat must matter.',
      'The stronger version should make the actor feel more alive, not more polished.',
    ],
    'drill'
  ),
  makeSeed(
    'Genre Recut: The Message',
    'Scene Study',
    'Push the same footage into a different genre.',
    'Shoot or use one neutral scene: a person enters a room, finds a phone, reads a message, and looks up. Cut it as either a thriller, romance, comedy, or psychological drama.',
    'Train emotional authorship through rhythm, order, silence, and sound.',
    'A 30–90 second genre recut with a clear tonal identity.',
    [
      'No reshoots.',
      'Maximum 3 text cards if absolutely necessary.',
      'Use rhythm and sound intentionally.',
    ],
    'scene'
  ),
  makeSeed(
    'Tension by Delay',
    'Pacing',
    'Build pressure by refusing to cut too soon.',
    'Use a scene where a hand reaches for a doorknob, opens a text, or turns toward someone offscreen. Build tension mainly by holding longer than expected before cutting.',
    'Train duration, discomfort, and release.',
    'A short sequence where restraint creates noticeable pressure.',
    [
      'Hold at least one shot longer than feels safe.',
      'Do not add fake tension with loud music.',
      'The final 5 seconds must land hardest.',
    ],
    'constraint'
  ),
  makeSeed(
    'Parallel Pressure',
    'Structure',
    'Intercut two threads so they charge each other with meaning.',
    'Shoot or collect 2 simultaneous mini-actions: one person getting dressed to leave and another person waiting outside a door or at a bus stop. Intercut them so pressure rises with each return.',
    'Train cross-cutting logic and escalation.',
    'A short sequence where intercutting creates tension or dramatic irony.',
    [
      'Use at least 2 distinct threads.',
      'The cross-cutting must build toward something.',
      'Each return should increase tension, contrast, or meaning.',
    ],
    'scene'
  ),
  makeSeed(
    'Cut the Reveal',
    'Impact',
    'Control what the audience learns and when.',
    'Build a reveal scene around one hidden thing: a text message, ring, knife, empty chair, or face in a doorway. The cut order must control exactly when the audience gets the key information.',
    'Train suspense and payoff timing.',
    'A short sequence where the reveal changes understanding.',
    [
      'Do not reveal the key information too early.',
      'The reveal must change what the audience thinks or feels.',
      'Shot order must matter.',
    ],
    'constraint'
  ),
  makeSeed(
    'Cut on Thought',
    'Psychology',
    'Cut with internal shifts, not just movement.',
    'Use a close-up or dialogue scene and place cuts where thought changes, not where hands move or heads turn.',
    'Train psychological editing and invisible timing.',
    'A short scene that feels smarter and more emotionally exact.',
    [
      'At least 3 cuts must be motivated by thought shifts.',
      'Protect actor timing.',
      'No showy cuts.',
    ],
    'drill'
  ),
  makeSeed(
    'Time Compression: Pack a Bag',
    'Time',
    'Condense time without losing clarity.',
    'Shoot or use a longer process of someone packing a bag to leave the house. Compress the full action into 15–30 seconds while keeping the emotional line clear.',
    'Train ellipsis and temporal control.',
    'A compressed sequence that still feels complete.',
    [
      'The audience must never feel lost.',
      'Keep the emotional spine alive.',
      'Use compression intentionally rather than chopping randomly.',
    ],
    'technical'
  ),
  makeSeed(
    'Time Expansion: The Key',
    'Time',
    'Make a tiny moment feel huge.',
    'Take one small action — a hand reaching for a key, unlocking a door, or opening a message — and expand it into a suspenseful beat using inserts, delay, and sound detail.',
    'Train duration, suspense, and emphasis.',
    'A short expanded-time sequence built from a tiny event.',
    [
      'Do not become repetitive.',
      'Every insert must add pressure or focus.',
      'The moment must stay clear.',
    ],
    'constraint'
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
    'technical'
  ),
  makeSeed(
    'Montage to the Beat',
    'Montage',
    'Cut a sequence entirely to the pulse of music.',
    'Shoot or collect 12–20 shots of one person getting ready to leave the house: shoes, keys, jacket, mirror, door, stairs, street, bus stop, train, etc. Choose one song and cut the montage so the major visual changes land on the beat or on deliberate off-beat accents.',
    'Train rhythmic montage and beat-based timing.',
    'A 30–60 second montage with clear musical structure.',
    [
      'Use one song only.',
      'All major image changes must relate to the track’s rhythm.',
      'Do not let the montage become random just because it is fast.',
    ],
    'scene'
  ),
  makeSeed(
    'Trailer Pulse',
    'Cutdown',
    'Build a teaser that feels urgent and cinematic.',
    'Take an existing short scene or short film and cut a 30–60 second teaser that sells tone, stakes, and curiosity without explaining everything.',
    'Train compression, hook-building, and ending impact.',
    'A 30–60 second teaser with a strong opening and final hook.',
    [
      '30–60 seconds only.',
      'Maximum 3 text cards.',
      'End on the strongest hook, not the loudest moment.',
    ],
    'technical'
  ),
];

const EDITING_ADVANCED: LessonSeed[] = [
  makeSeed(
    'Documentary Truth Pass',
    'Nonfiction',
    'Find shape inside messy real material.',
    'Shoot or use observational footage of one real process: a market stall opening, a friend preparing food, someone setting up camera gear, a train platform, or a bus stop wait. Shape it into a short truthful scene.',
    'Train nonfiction story instincts and structural judgment.',
    'A short documentary-style scene with a clear emotional centre.',
    [
      'Do not force fake drama.',
      'Clarity matters.',
      'Find the actual human beat in the material.',
    ],
    'scene',
    'A good documentary edit finds shape without flattening reality.'
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
    'technical'
  ),
  makeSeed(
    'Shot Match',
    'Color',
    'Different shots should feel like they belong to the same scene.',
    'Take 2 or more mismatched shots from one dialogue scene — for example a wide and 2 close-ups with different white balance or brightness — and match them into believable continuity.',
    'Train colour continuity and shot matching.',
    'A short matched sequence where the shots feel unified.',
    [
      'Use at least 2 shots.',
      'Match balance before mood.',
      'The audience should stop noticing the mismatch.',
    ],
    'technical'
  ),
  makeSeed(
    'Color Grade the Emotion',
    'Color',
    'Use grading to push emotional world without losing readability.',
    'Take one 10–20 second close-up or dialogue scene in neutral light and create 2 versions: one warm and intimate, one cold and emotionally distant.',
    'Train emotional decision-making in colour, contrast, and temperature.',
    'Two graded versions of the same scene with clearly different emotional identities.',
    [
      'Same footage for both versions.',
      'Do not over-stylise past readability.',
      'Skin tones must stay believable unless the concept clearly demands otherwise.',
    ],
    'technical'
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
    'scene'
  ),
  makeSeed(
    'False Lead Edit',
    'Misdirection',
    'Make the audience believe the wrong thing first.',
    'Build a scene where a viewer first reads one meaning — for example romance, comfort, safety, or honesty — and then realises they were wrong because of the edit.',
    'Train misdirection and payoff.',
    'A short sequence with a strong reinterpretation beat.',
    [
      'The false reading must be believable.',
      'The reveal must reframe earlier cuts.',
      'No cheat twists.',
    ],
    'scene'
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
    'drill'
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
    'scene'
  ),
  makeSeed(
    'Memory Cut',
    'Subjective Edit',
    'Edit like recollection instead of objective reality.',
    'Take existing footage of a conversation, reunion, walk, or room and cut it as if it is being remembered imperfectly, emotionally, or selectively.',
    'Train subjectivity and emotional fragmentation.',
    'A short sequence that feels like memory rather than plain chronology.',
    [
      'The structure does not need to be linear.',
      'The emotion must still read clearly.',
      'The approach must feel deliberate rather than random.',
    ],
    'scene'
  ),
  makeSeed(
    'Silence and Shock',
    'Contrast',
    'What you remove can hit harder than what you add.',
    'Build a moment where expected audio drops away during a key visual beat: a text reveal, eye contact, object discovery, or the moment after a slammed door.',
    'Train contrast, restraint, and sonic punctuation.',
    'A short sequence where silence or sonic drop becomes the turning point.',
    [
      'The silence must be clearly motivated.',
      'Use contrast, not randomness.',
      'The key turn must land through restraint.',
    ],
    'technical'
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
    'drill'
  ),
  makeSeed(
    'Withhold the Reaction',
    'Tension',
    'Sometimes the strongest reaction is the one you refuse to show.',
    'Cut a reveal scene so the audience waits too long for the reaction shot, creating pressure before the reaction finally lands.',
    'Train withholding, anticipation, and timing.',
    'A short tension sequence where the delayed reaction changes the scene.',
    [
      'Delay with purpose.',
      'The eventual reaction must land.',
      'Do not confuse the audience.',
    ],
    'constraint'
  ),
  makeSeed(
    'Elliptical Story Edit',
    'Structure',
    'Leave out more and trust the audience more.',
    'Tell a short scene by omitting expected steps — for example arriving, unlocking, entering, finding, leaving — and letting the audience assemble the logic.',
    'Train elegant omission and compressed storytelling.',
    'A short sequence that feels complete without spelling everything out.',
    [
      'Do not become confusing.',
      'Omissions must feel intentional.',
      'The audience should still emotionally track.',
    ],
    'scene'
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
    'technical'
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
    'A 20–40 second comparison sequence showing how the exact same action changes across 4 frame sizes.',
    [
      'Use the exact same action each time.',
      'Keep lighting and blocking as similar as possible.',
      'Only the framing size should change the emotional effect.',
    ],
    'drill',
    'This teaches that framing distance is never neutral.'
  ),

  makeSeed(
    'Camera Height Study',
    'Foundations',
    'Learn how camera height affects status and vulnerability.',
    'Shoot the same short interaction from 3 heights: high angle, eye level, and low angle. Use one beat like someone being questioned, confronted, or asked to leave.',
    'Train psychological use of camera height.',
    'A short comparison scene where camera height clearly changes the feeling of power.',
    [
      'Use the same blocking and text in all 3 versions.',
      'Only camera height should change the reading.',
      'The difference must be easy to feel on first watch.',
    ],
    'technical'
  ),

  makeSeed(
    'Lens Study: Wide vs Long',
    'Lens Basics',
    'Learn how focal length changes space and pressure.',
    'Shoot the same action twice: once on the widest lens you have and once on a longer lens or tighter crop from farther away. Use one action such as walking toward camera, sitting at a table, turning after hearing something, or crossing a corridor.',
    'Train focal-length awareness, spatial distortion, and compression.',
    'A 20–40 second comparison showing how wider and longer lensing change the emotional feel of the same moment.',
    [
      'Keep the final subject size roughly similar in both versions if possible.',
      'Do not change the acting much.',
      'Let the lens and camera distance do the work.',
    ],
    'technical'
  ),

  makeSeed(
    'Aperture Exercise: Isolate the Subject',
    'Exposure Basics',
    'Use depth of field to control what matters.',
    'Shoot one subject against a deeper background. Create one version with the deepest depth of field you can achieve and one with the shallowest depth of field you can achieve. Example: someone waiting in a hallway, sitting at a table, or standing still while people move behind them.',
    'Train creative use of aperture and depth of field.',
    'Two short clips where the viewer clearly feels the difference between deep focus and shallow focus.',
    [
      'Use the same subject and background in both versions.',
      'Focus must be accurate in both clips.',
      'The change in depth of field must be clearly visible.',
    ],
    'technical'
  ),

  makeSeed(
    'ISO Test: Night Exterior Truth',
    'Exposure Basics',
    'Learn what higher ISO gives you and what it costs you.',
    'Shoot the same short night scene twice outside or near a dim practical source: someone checking their phone, pacing under a streetlight, lighting a cigarette, or waiting by a doorway. Film once at a lower ISO and once at a much higher ISO.',
    'Train exposure judgment, noise awareness, and low-light discipline.',
    'Two short clips showing the trade-off between cleaner shadows and brighter exposure.',
    [
      'Use the same location and action in both versions.',
      'Do not change the main light source.',
      'Compare detail, shadow shape, and noise honestly.',
    ],
    'technical'
  ),

  makeSeed(
    'White Balance Mood Shift',
    'Exposure Basics',
    'Learn how color temperature changes emotional tone.',
    'Shoot the same short setup 3 times: balanced normally, intentionally warmer, and intentionally cooler. Use a simple beat like someone reading a message, sitting alone at a table, or preparing to leave.',
    'Train white balance awareness and emotional color control.',
    'A short comparison showing how color temperature changes the scene’s mood.',
    [
      'Keep framing and exposure as similar as possible.',
      'Only white balance should meaningfully shift the mood.',
      'Do not fix the color in post before comparing.',
    ],
    'technical'
  ),

  makeSeed(
    'One Practical Light Scene',
    'Lighting',
    'Build the scene around one visible source.',
    'Shoot a 20–45 second scene lit only by one practical source: lamp, window, fridge light, TV, phone, or computer screen. Example scene: someone waiting for a reply, recording a voice note, or deciding whether to leave.',
    'Train discipline, motivated lighting, and contrast control.',
    'A short scene where the light source clearly shapes the emotional tone.',
    [
      'Use one visible source only.',
      'No hidden fill.',
      'The scene must still feel readable enough to watch.',
    ],
    'scene'
  ),

  makeSeed(
    'Reflections First',
    'Framing',
    'Tell the moment through reflections before direct access.',
    'Open a short scene using mirrors, windows, polished metal, phone screens, puddles, or any reflective surface before finally showing the subject directly.',
    'Train withholding, visual intrigue, and reveal timing.',
    'A 20–60 second scene with at least one reveal that feels earned.',
    [
      'Use at least 3 reflection-based frames.',
      'Do not show the subject directly at first.',
      'The final reveal must matter emotionally or narratively.',
    ],
    'drill'
  ),

  makeSeed(
    'No Face Emotion',
    'Constraint',
    'Tell the emotional beat without showing a full face.',
    'Build a short scene using only hands, posture, silhouette, props, movement, or framing to show feeling. Example actions: deleting a text, gripping a sink, dropping keys, folding clothes, or packing a bag.',
    'Train non-obvious visual storytelling.',
    'A brief scene where emotion is readable without a full-face reveal.',
    [
      'No full face allowed.',
      'Use body language and objects intentionally.',
      'Emotion must still read clearly on first watch.',
    ],
    'constraint'
  ),

  makeSeed(
    'Foreground Storytelling',
    'Depth',
    'Use layers, not just subjects.',
    'Frame a short scene through foreground elements like door frames, hanging clothes, glass, railings, plants, another person’s shoulder, or objects on a table.',
    'Train depth and layered composition.',
    'A short scene where foreground changes the emotional meaning or power of the image.',
    [
      'Use active foreground in at least 3 shots.',
      'Do not clutter the frame randomly.',
      'Layering must add meaning, not just style.',
    ],
    'technical'
  ),

  makeSeed(
    'Negative Space Pressure',
    'Composition',
    'Let emptiness create unease.',
    'Frame a character so a large empty section of the frame feels threatening, lonely, anticipatory, or emotionally loaded. Example: someone waiting for a call, hearing a noise offscreen, or standing near a doorway they are afraid to cross.',
    'Train negative space as storytelling.',
    'A short scene where empty frame area carries tension.',
    [
      'Negative space must feel intentional.',
      'The audience should keep looking into the empty area.',
      'Do not explain the feeling verbally.',
    ],
    'constraint'
  ),

  makeSeed(
    'Backlight Entrance',
    'Lighting',
    'Let shape and edge light reveal character.',
    'Shoot an entrance where backlight from a doorway, window, hallway, or exterior source does most of the dramatic work.',
    'Train silhouette control and subject separation.',
    'A short entrance scene driven by backlight.',
    [
      'The backlight must be motivated in the space.',
      'Keep exposure intentional.',
      'The entrance should feel authored, not accidental.',
    ],
    'scene'
  ),

  makeSeed(
    'Reveal by Focus',
    'Focus',
    'A focus shift should reveal meaning, not just look pretty.',
    'Build a scene where the important reveal happens through focus: a figure in the background, a hidden object on a table, a message on a phone, or a detail in someone’s hand.',
    'Train selective attention and focus-based storytelling.',
    'A short scene built around one meaningful focus pull.',
    [
      'The rack focus must change meaning.',
      'Do not use more than 2 focus shifts.',
      'Keep the shift motivated by story.',
    ],
    'technical'
  ),

  makeSeed(
    'Movement With Meaning',
    'Camera Motion',
    'Move the camera only when the beat earns it.',
    'Shoot a short scene where the camera stays still until one clear turning point, then performs one push, drift, pan, or follow move that changes the pressure of the moment.',
    'Train meaningful camera movement rather than decorative movement.',
    'A short scene with one decisive movement that matters.',
    [
      'Only one major camera move is allowed.',
      'The move must begin on a real emotional or narrative beat.',
      'Stillness before the move should matter too.',
    ],
    'scene'
  ),

  makeSeed(
    'Handheld With Rules',
    'Camera Motion',
    'Handheld needs grammar, not chaos.',
    'Shoot a short scene handheld, but define one rule before filming: stay shoulder height only, stay behind the subject, move only when the subject moves, or keep the subject on one side of frame the whole time.',
    'Train disciplined handheld work.',
    'A short scene with purposeful handheld grammar.',
    [
      'Set one handheld rule before shooting.',
      'No random wobble.',
      'The movement must feel emotionally connected to the subject.',
    ],
    'technical'
  ),

  makeSeed(
    'POV Frame',
    'Subjective Camera',
    'Make the frame clearly belong to one character’s experience.',
    'Shoot a short sequence from one character’s emotional point of view: jealousy at a party, suspicion in a hallway, longing across a station, or fear in an empty room.',
    'Train subjective cinematography.',
    'A short sequence with a strong POV identity.',
    [
      'The audience should feel whose experience it is.',
      'Keep visual choices consistent.',
      'Do not explain the POV in dialogue.',
    ],
    'scene'
  ),

  makeSeed(
    'Body-Rig Panic Shot',
    'Experimental Movement',
    'Trap the audience inside the character’s body.',
    'Create one short panic or overwhelm beat using a body-mounted, chest-mounted, or improvised strapped-camera setup so the actor stays fixed while the world moves around them.',
    'Train subjective camera grammar and psychological image design.',
    'A 10–25 second shot where the audience feels trapped inside the character’s mental state.',
    [
      'The actor must remain the visual anchor.',
      'The shot should feel psychological, not goofy.',
      'Use the effect only for a beat where the emotion justifies it.',
    ],
    'technical'
  ),

  makeSeed(
    'Window Light Intimacy',
    'Naturalism',
    'Soft realism can still feel cinematic.',
    'Shoot a close emotional scene by a real window: someone reading a letter, recording a voice note, getting ready to leave, or trying not to cry.',
    'Train softness, shaping, and realistic intimacy.',
    'A short intimate scene built around believable natural light.',
    [
      'Use only window light or a believable window-light imitation.',
      'Protect the eyes.',
      'The light must support vulnerability, not flatten the face.',
    ],
    'technical'
  ),

  makeSeed(
    'Action Beat: Chase to Door',
    'Action',
    'Shoot speed and urgency without losing clarity.',
    'Film a 20–45 second action beat where a character runs toward a door, looks back, fumbles the handle, gets inside, and slams it shut. Use at least 1 wide, 2 medium shots, and 2 close details.',
    'Train readable action geography, screen direction, and pacing.',
    'A short high-pressure scene where the audience always understands where the character is and what they need.',
    [
      'Keep screen direction clear.',
      'The audience must always understand where the door is in relation to the character.',
      'Use movement only when it improves urgency or clarity.',
    ],
    'scene'
  ),

  makeSeed(
    'Frame the Power Shift',
    'Composition',
    'Change power through the frame itself.',
    'Shoot a 2-person scene where one person starts visually dominant and the other ends dominant. Show the shift through framing, spacing, and who controls the image.',
    'Train visual power dynamics.',
    'A short scene with a visible compositional status shift.',
    [
      'Do not explain the shift in dialogue.',
      'Let framing and distance do the work.',
      'The change must be readable even with no sound.',
    ],
    'drill'
  ),

  makeSeed(
    'Lens for Paranoia',
    'Lens Psychology',
    'Use optics to create unease.',
    'Shoot a short paranoia scene in a corridor, stairwell, street, or empty room. Use focal length and camera distance to make the world feel either too exposed or too compressed.',
    'Train lens psychology and emotional spatial design.',
    'A short scene where optics clearly support the mental state.',
    [
      'Lens choice must be intentional.',
      'Do not rely only on shaky camera.',
      'The emotional effect must come from image design, not just performance.',
    ],
    'technical'
  ),

  makeSeed(
    'Light Change as Turn',
    'Lighting',
    'Let light shift with the scene.',
    'Build a short scene where one motivated light change marks the emotional or narrative turn: blinds opening, fridge closing, TV switching off, lamp turning on, or a door opening to daylight.',
    'Train lighting as dramaturgy.',
    'A short scene where light changes the beat.',
    [
      'The light shift must be motivated.',
      'The change must matter emotionally.',
      'Avoid gimmicky color changes.',
    ],
    'scene'
  ),

  makeSeed(
    'Claustrophobic Coverage',
    'Space',
    'Make the room feel tighter than it is.',
    'Shoot a scene in a small room, bathroom, car, or hallway where the emotional pressure increases as framing gets tighter and exits feel less available.',
    'Train spatial pressure and progressive visual tightening.',
    'A short scene where the space closes in emotionally.',
    [
      'Let visual space tighten gradually.',
      'Do not only move closer randomly.',
      'Pressure must build from shot to shot.',
    ],
    'drill'
  ),

  makeSeed(
    'Withhold the Face',
    'Withholding',
    'Delay identity while keeping the subject dramatically present.',
    'Shoot a scene where a key character is introduced only through hands, shoes, back of head, shadow, or reflection before their face is finally shown.',
    'Train partial information and reveal control.',
    'A short scene with a controlled delayed face reveal.',
    [
      'No full face until it matters.',
      'The audience must still track the character clearly.',
      'The reveal must pay off.',
    ],
    'constraint'
  ),

  makeSeed(
    'Practical Neon Scene',
    'Stylized Lighting',
    'Use colored light boldly without losing readability.',
    'Shoot a short scene using visible colored practicals, LED strips, signs, monitor light, or a motivated colored source. Example: late-night phone call, post-party silence, or someone getting ready to leave.',
    'Train stylized realism.',
    'A short scene with controlled color atmosphere.',
    [
      'Protect readability.',
      'Color must support story.',
      'Do not make it look accidental or muddy.',
    ],
    'technical'
  ),

  makeSeed(
    'Shot Sequence Without Coverage',
    'Intentional Design',
    'Commit to decisive images instead of collecting safety shots.',
    'Plan a short scene of 5–7 shots maximum and shoot only those shots. Example: someone comes home, discovers something missing, and leaves again.',
    'Train intention over safety.',
    'A short scene built from a deliberate shot list.',
    [
      'No safety coverage mentality.',
      'Each shot must earn its place.',
      'The sequence must still cut together clearly.',
    ],
    'scene'
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
    'scene'
  ),

  makeSeed(
    'Mirror Psychology',
    'Reflection',
    'Use reflections as emotional metaphor.',
    'Use mirrors or reflective surfaces to show divided identity, self-surveillance, vanity, fear, or emotional fracture.',
    'Train symbolic cinematography.',
    'A short psychologically loaded scene built around reflection.',
    [
      'The reflection must mean something.',
      'Avoid empty prettiness.',
      'Tie it directly to character state.',
    ],
    'drill'
  ),

  makeSeed(
    'Reveal Through Absence',
    'Withholding',
    'What is missing can land harder than what is present.',
    'Build a scene where the emotional hit comes from an absence: an empty chair, missing suitcase, no wedding ring, cleared-out room, or removed photograph.',
    'Train omission and discovery.',
    'A short scene where the missing element becomes the reveal.',
    [
      'The absence must become the reveal.',
      'Do not over-explain.',
      'Build discovery visually.',
    ],
    'constraint'
  ),

  makeSeed(
    'Visual Irony',
    'Subtext',
    'Let the image quietly contradict the words.',
    'Shoot a scene where the frame undercuts what the character says or believes. Example: “I’m fine” in a wrecked room, “I trust you” through glass, or “I’m not leaving” beside a packed bag.',
    'Train visual irony.',
    'A short scene with a strong image/subtext contradiction.',
    [
      'The contradiction must be readable.',
      'Do not underline it verbally.',
      'Keep it elegant.',
    ],
    'drill'
  ),

  makeSeed(
    'Low Light Truth',
    'Exposure',
    'Make darkness readable without making it muddy.',
    'Shoot a low-light night scene using one real practical source such as a bedside lamp, hallway spill, fridge light, laptop, candle, or streetlight through a window.',
    'Train exposure discipline in darkness.',
    'A short low-light scene with controlled blacks and readable key information.',
    [
      'Avoid muddy darkness.',
      'Darkness must feel intentional.',
      'Protect the key information the audience needs to read.',
    ],
    'technical'
  ),

  makeSeed(
    'Tension in the Wide',
    'Blocking',
    'Keep tension alive without rushing into close-ups.',
    'Shoot a tense 2-person scene mostly in wides or medium-wides: waiting for an answer, confronting someone, discovering a lie, or deciding whether to leave.',
    'Train composition and blocking under pressure.',
    'A short scene where tension survives without close-up dependence.',
    [
      'Use space intelligently.',
      'Let blocking carry tension.',
      'Do not immediately cut close for every beat.',
    ],
    'scene'
  ),

  makeSeed(
    'Image as Theme',
    'Thematic Visuals',
    'Turn a theme into visual language.',
    'Choose one theme — guilt, hunger, surveillance, loneliness, freedom, jealousy — and build a short scene where framing, light, objects, and space all reflect it.',
    'Train thematic image-making.',
    'A short scene with clear thematic visuals.',
    [
      'The theme must show in images, not speech.',
      'Avoid obvious symbols only.',
      'Keep it cinematic and emotionally grounded.',
    ],
    'drill'
  ),

  makeSeed(
    'Silhouette Choice',
    'Shape',
    'Make shape tell the story before detail does.',
    'Build a short scene where silhouette is the clearest dramatic tool in at least 2 shots. Example: doorway hesitation, rooftop wait, corridor argument, or someone dressing to leave.',
    'Train shape-first visual storytelling.',
    'A short scene using silhouette as part of the emotional design.',
    [
      'Silhouette must be clean.',
      'Shape must add meaning.',
      'Do not rely on it in every shot.',
    ],
    'technical'
  ),

  makeSeed(
    'Compression and Isolation',
    'Lens Choice',
    'Use optics to isolate the character from the world.',
    'Shoot a scene where focal length and background compression intensify loneliness, scrutiny, or pressure. Example: bus stop, pavement, park bench, train platform, or long corridor.',
    'Train emotional use of compression.',
    'A short scene where lensing creates isolation.',
    [
      'Lens choice must be deliberate.',
      'Background should matter compositionally.',
      'The emotional effect must be felt.',
    ],
    'scene'
  ),

  makeSeed(
    'Two Color Worlds',
    'Color Contrast',
    'Give two characters different visual worlds in the same scene.',
    'Light or frame a scene so each character feels visually aligned with a different emotional world: warm vs cold, lit vs shadowed, open vs trapped.',
    'Train contrast inside one location.',
    'A short 2-person scene with strong visual duality.',
    [
      'Both worlds must be clear.',
      'Do not make it messy.',
      'The contrast must support story.',
    ],
    'technical'
  ),

  makeSeed(
    'Frame After the Action',
    'Patience',
    'Sometimes the strongest image comes just after the obvious beat.',
    'Hold a shot after the main action ends and let the aftermath become the point. Example: after the slap, after the goodbye, after the message is read, after the door closes.',
    'Train patience and aftermath imagery.',
    'A short scene where the best frame happens after the expected moment.',
    [
      'Do not cut too early.',
      'The aftermath must matter.',
      'The hold must feel earned.',
    ],
    'drill'
  ),

  makeSeed(
    'Reveal by Blocking',
    'Staging',
    'Let movement inside frame create the reveal.',
    'Design a shot where the reveal happens because someone enters, exits, sits down, opens a door, or shifts within the frame.',
    'Train internal reveal design.',
    'A short scene where blocking, not cutting, reveals the key information.',
    [
      'Use movement inside the frame.',
      'Do not rely on an edit reveal.',
      'The reveal must change meaning immediately.',
    ],
    'scene'
  ),

  makeSeed(
    'Glass Barrier Scene',
    'Visual Subtext',
    'A barrier can become emotional architecture.',
    'Shoot a scene where glass, windows, mirrors, bus panels, or partitions emphasize emotional separation.',
    'Train environmental metaphor.',
    'A short scene where transparent barriers add meaning.',
    [
      'The barrier must matter dramatically.',
      'Do not use it only decoratively.',
      'Keep the emotional read clear.',
    ],
    'scene'
  ),

  makeSeed(
    'Reveal the Room Slowly',
    'Worldbuilding',
    'Let the audience learn the space piece by piece.',
    'Build a scene where the room is understood gradually through details: photographs, packed boxes, dishes, toys, medicine, ashtray, open wardrobe, or a half-hidden object.',
    'Train spatial withholding and reveal.',
    'A short scene with gradual environmental discovery.',
    [
      'Do not front-load everything.',
      'The reveals must feel motivated.',
      'The room should tell us something about the story.',
    ],
    'technical'
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
    'technical'
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
    'Three short versions of the same scene where the performance clearly changes because the note changes.',
    [
      'Use the exact same text all 3 times.',
      'Only the actor direction changes.',
      'Do not use vague notes like “more emotion.”',
    ],
    'technical',
    'If no actor is available, play both characters truthfully — not as a skit.'
  ),

  makeSeed(
    'Silent Objective Scene',
    'Foundations',
    'Direct behavior before dialogue.',
    'Direct a 30–60 second silent scene built around one simple objective: keep them here, hide the truth, get forgiveness, stop them leaving, or make them admit something.',
    'Train clear visual direction without relying on lines.',
    'A silent scene where the audience clearly understands what one person wants.',
    [
      'No spoken dialogue.',
      'The objective must still read clearly.',
      'Use blocking, pauses, props, and eyelines to tell the story.',
    ],
    'drill'
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
    'technical'
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
    'technical'
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
    'scene'
  ),

  makeSeed(
    'Status Through Blocking',
    'Blocking',
    'Make power visible before it is spoken.',
    'Direct a short 2-person scene where one character starts dominant and the other ends dominant. Use standing vs sitting, control of the door, distance, crossing, and eye-line height.',
    'Train power design through physical staging.',
    'A 45–90 second scene with a clear status reversal.',
    [
      'Do not explain the shift in dialogue.',
      'The status change must be visible physically.',
      'Every move must mean something.',
    ],
    'drill'
  ),

  makeSeed(
    'Entrance Tells the Story',
    'Character Arrival',
    'Direct a character entrance that instantly communicates who they are.',
    'Stage one entrance and direct it 3 ways: ashamed, dangerous, charming, exhausted, grieving, or furious. Use the same door, corridor, or room entry each time.',
    'Train immediate character communication.',
    'Three short entrance clips where the character meaning is clear in the first few seconds.',
    [
      'Use the same entrance path each time.',
      'Only direction, timing, posture, and environment interaction should change the read.',
      'No explanatory voiceover.',
    ],
    'drill'
  ),

  makeSeed(
    'Object as Scene Engine',
    'Objects',
    'Direct a whole scene around one object whose meaning changes.',
    'Choose one object — phone, glass, ring, key, envelope, packed bag, knife, photograph, or coat — and build a scene where the object’s meaning changes over the course of the scene.',
    'Train prop-centered direction.',
    'A short scene where the object becomes the emotional engine.',
    [
      'The object must matter in every beat.',
      'Its meaning must shift by the end.',
      'Do not use it as decoration.',
    ],
    'scene'
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
    'This is not a gimmick challenge. Treat both roles like proper cast characters.'
  ),

  makeSeed(
    'Watcher in the Room',
    'Pressure',
    'A silent third person should alter the whole scene.',
    'Direct a scene between 2 people while a third person watches silently. The watcher may sit, clean, smoke outside a doorway, scroll a phone, or fold clothes. Their presence must change the dynamic.',
    'Train triangulation, social pressure, and room tension.',
    'A short scene where the silent watcher matters as much as the speakers.',
    [
      'The watcher speaks little or not at all.',
      'Eyelines must matter.',
      'The pressure must be visible before anyone names it.',
    ],
    'drill'
  ),

  makeSeed(
    'Interruption Rhythm',
    'Rhythm',
    'Direct a scene whose energy comes from interruption.',
    'Build a short scene where interruption is the engine: unfinished sentences, cut-offs, blocked exits, repeated attempts to leave, or someone refusing to let the scene settle.',
    'Train rhythm and escalation.',
    'A short scene with clear pressure built through interruption.',
    [
      'The interruptions must mean something emotionally.',
      'Do not make the overlap unreadable.',
      'The scene must escalate rather than stay flat.',
    ],
    'scene'
  ),

  makeSeed(
    'Chair Logic',
    'Blocking',
    'Use furniture to reveal social hierarchy and discomfort.',
    'Direct a scene around who sits, who stands, who circles, who leans, and who refuses to settle. Example settings: kitchen apology, bedroom confrontation, office accusation, hospital waiting room.',
    'Train directors to think physically and socially.',
    'A short scene where furniture use reveals power and discomfort.',
    [
      'Every seated or standing choice must mean something.',
      'At least one shift in position must change the power.',
      'Avoid random wandering.',
    ],
    'technical'
  ),

  makeSeed(
    'Conflicting Objectives',
    'Conflict',
    'Make both characters want something concrete and incompatible.',
    'Direct a 2-person scene where each character wants a different outcome: stay vs leave, confess vs avoid, forgive vs punish, tell truth vs keep peace.',
    'Train active scene conflict.',
    'A short scene where both objectives stay alive from start to finish.',
    [
      'Both objectives must be specific.',
      'Avoid passive conversation.',
      'The conflict must sharpen by the end.',
    ],
    'scene'
  ),

  makeSeed(
    'Subtext Under Ordinary Dialogue',
    'Subtext',
    'Direct what the scene is really about, not just what is said.',
    'Use ordinary text — making tea, discussing a taxi, talking about dinner, folding clothes, asking about tomorrow — and direct it so the real scene underneath is betrayal, jealousy, grief, fear, or desire.',
    'Train subtext direction.',
    'A short scene where the hidden conflict is unmistakable.',
    [
      'The spoken text must stay ordinary.',
      'The real scene must live underneath.',
      'Do not explain the subtext aloud.',
    ],
    'scene'
  ),

  makeSeed(
    'Opposite Notes for Each Actor',
    'Actor Direction',
    'Let contradiction generate electricity.',
    'Take a 2-person scene and give each actor a contradictory private note. Example: Actor A “comfort them,” Actor B “make them regret coming.” Or Actor A “keep peace,” Actor B “force the truth.”',
    'Train layered direction and contradiction.',
    'A short scene where tension rises because each performer is living in a different strategy.',
    [
      'Each note must be playable.',
      'Do not tell both actors the same thing.',
      'The contradiction must be felt clearly.',
    ],
    'technical'
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
    'drill'
  ),

  makeSeed(
    'Silence as Turning Point',
    'Silence',
    'Make one silence do more work than all the dialogue around it.',
    'Direct a scene where one long silence becomes the actual turning point. Example: after “I know,” before a goodbye, after an accusation, or before someone opens the door.',
    'Train restraint and beat control.',
    'A short scene structured around one decisive silence.',
    [
      'The silence must be earned.',
      'Do not fill it with pointless fidgeting.',
      'The room must feel changed after the silence.',
    ],
    'drill'
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
    'scene'
  ),

  makeSeed(
    'Fear Without Monster',
    'Suspense',
    'Direct suspense without relying on spectacle.',
    'Create a suspense scene where the threat is mostly implied: a sound outside the door, someone approaching, a missing item, a power cut, or a person who should not be there.',
    'Train tension without showing too much.',
    'A short suspense scene built around expectation and dread.',
    [
      'Do not over-show the threat.',
      'Use performance and blocking to build fear.',
      'Keep the audience leaning forward.',
    ],
    'scene'
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
    'technical'
  ),

  makeSeed(
    'Directing for the Cut',
    'Coverage Strategy',
    'Shoot with editorial purpose instead of collecting random coverage.',
    'Plan a short scene knowing exactly where the edit should bite hardest. Decide beforehand which line, look, movement, or silence deserves the close-up or the cut.',
    'Train coverage as storytelling rather than safety.',
    'A short scene where the coverage clearly supports the final emotional cut points.',
    [
      'Every angle must have a reason.',
      'Do not collect generic wide-medium-close coverage.',
      'Know where the emotional cuts belong before you shoot.',
    ],
    'technical'
  ),

  makeSeed(
    'Ensemble Pressure',
    'Ensemble',
    'Direct 3 or more people so the whole room stays alive.',
    'Direct a scene with at least 3 on-screen people where tension exists even when only 2 are talking. Give background behavior to everyone that affects the dynamic.',
    'Train ensemble staging.',
    'A short ensemble scene where every body in the room matters.',
    [
      'Use every actor intentionally.',
      'Background behavior must mean something.',
      'The room dynamic must stay alive at all times.',
    ],
    'scene'
  ),

  makeSeed(
    'Direct the Camera Operator',
    'Collaboration',
    'Communicate emotional intention to camera, not just actors.',
    'Work with a cinematographer, or direct your own camera, on a scene where the frame strategy changes with the emotional beat: distance, angle, movement, stillness, or withholding.',
    'Train collaboration between directing and camera.',
    'A short scene where camera choices clearly support your scene interpretation.',
    [
      'The camera strategy must change with the scene beats.',
      'Do not use movement just because it looks nice.',
      'Every frame choice must support the emotional read.',
    ],
    'technical'
  ),

  makeSeed(
    'Contradictory Scene Surface',
    'Interpretation',
    'Direct a scene where behavior and text are in conflict.',
    'Create a scene where the dialogue is polite but the actual behavior is punishing, where the words are calm but the room feels dangerous, or where the text sounds romantic but the scene is really about control.',
    'Train tonal contradiction.',
    'A short scene where the surface and the truth clearly clash.',
    [
      'Do not explain the contradiction aloud.',
      'The audience must feel the real scene underneath.',
      'Keep it truthful, not theatrical.',
    ],
    'scene'
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
    'scene'
  ),

  makeSeed(
    'Misdirect the Audience',
    'Interpretation',
    'Make the audience read the scene one way first, then realize they were wrong.',
    'Direct a short scene where the viewer initially thinks one person is guilty, vulnerable, in love, or in control, then slowly realizes the truth is different.',
    'Train directorial misdirection.',
    'A short scene with a later reinterpretation beat.',
    [
      'The first read must be believable.',
      'The second read must feel earned.',
      'Do not cheat the audience.',
    ],
    'scene'
  ),

  makeSeed(
    'Shot Design as Opinion',
    'Visual Direction',
    'Your directing view should exist in the shot plan itself.',
    'Take a short scene and design a shot sequence that reflects your interpretation: boxed-in close-ups, withheld faces, wide humiliation, creeping approach, trapped over-shoulders, or a static frame that refuses relief.',
    'Train total-scene authorship.',
    'A short finished scene where the shot design clearly reflects your view of the material.',
    [
      'Every frame must point the same way.',
      'Do not stage it neutrally.',
      'The visual plan should reveal your interpretation before dialogue explains it.',
    ],
    'technical'
  ),

  makeSeed(
    'Directing Shame',
    'Subtle Emotion',
    'Direct a scene whose engine is shame, not anger.',
    'Build a scene where shame shapes posture, pace, eye-line, silence, and physical distance. Example: being found out, returning something, being seen after failure, asking for help.',
    'Train subtle emotional orchestration.',
    'A short scene where shame is the dominant emotional force.',
    [
      'Keep it specific and quiet.',
      'Do not over-explain.',
      'Let body language carry the weight.',
    ],
    'scene'
  ),

  makeSeed(
    'Space as Power',
    'Blocking',
    'Change power by changing physical distance.',
    'Direct a scene where shrinking distance increases control, or increased distance becomes the victory. Build the scene around who approaches, who retreats, and who stops moving first.',
    'Train spatial storytelling.',
    'A short scene where the power dynamic is clear from spacing alone.',
    [
      'Track distance carefully.',
      'Do not explain the power shift in dialogue.',
      'The space must tell the story.',
    ],
    'drill'
  ),

  makeSeed(
    'Offscreen Character Pressure',
    'Presence',
    'Someone not in frame can still dominate the scene.',
    'Direct a scene where an unseen person strongly affects everyone on screen: someone upstairs, someone outside the door, someone on the phone, someone expected to arrive, or someone who has just left the room.',
    'Train offscreen dramatic presence.',
    'A short scene where the unseen character matters heavily.',
    [
      'The offscreen person must shape behavior.',
      'Do not show them directly.',
      'The pressure must be clear even without seeing them.',
    ],
    'scene'
  ),

  makeSeed(
    'Scene Begins Late',
    'Structure',
    'Drop the audience into pressure immediately.',
    'Direct a scene that starts after the expected beginning. Skip the warm-up. The emotional event is already underway when the camera starts.',
    'Train late-entry scene design.',
    'A short scene that feels alive from frame one.',
    [
      'Do not over-explain the missing beginning.',
      'The audience should catch up fast.',
      'The tension must already exist in the first shot.',
    ],
    'technical'
  ),

  makeSeed(
    'Scene Ends Early',
    'Structure',
    'Leave before the expected explanation.',
    'Direct a scene that cuts away at the strongest point instead of explaining the aftermath. End on the look, the breath, the object, the exit, or the silence that contains the scene.',
    'Train ending judgment.',
    'A short scene with a bold, well-chosen endpoint.',
    [
      'Do not linger too long.',
      'The audience should still feel complete.',
      'End on the strongest beat, not after it.',
    ],
    'constraint'
  ),

  makeSeed(
    'Public Mask / Private Emergency',
    'Behavior',
    'Direct the split between social behavior and inner collapse.',
    'Create a scene in a public place — hallway, café, street corner, shop, train platform — where one character must appear normal while privately falling apart.',
    'Train social masking on screen.',
    'A short scene where public behavior and private truth coexist.',
    [
      'The public mask must stay believable.',
      'The private crisis must still read.',
      'Do not let it become melodramatic.',
    ],
    'drill'
  ),

  makeSeed(
    'Directing the Reveal Beat',
    'Tension',
    'A reveal is not just information — it is timing and aftermath.',
    'Direct a scene built around one reveal. It could be a phone showing a message, a found object, a wrong name, a hidden bag, or a sentence like “I already knew.” Stage the reactions as carefully as the reveal itself.',
    'Train reveal orchestration.',
    'A short reveal scene where the timing of who knows what matters.',
    [
      'The reveal must change the room.',
      'Reaction timing must matter.',
      'Do not rush the aftermath.',
    ],
    'scene'
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
    'drill'
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
    'technical'
  ),

  makeSeed(
    'Directing the Final Image',
    'Mastery',
    'Build the entire scene toward one final image that contains the meaning.',
    'Direct a short scene where the final frame is clearly the strongest image in the piece: empty chair, open door, packed bag, hand not taken, person left alone in the frame, object left behind, or a face finally revealed.',
    'Train directors to build toward a decisive visual ending.',
    'A short scene with a final shot that feels earned and memorable.',
    [
      'The ending image must be planned before you shoot.',
      'Everything before it should build toward it.',
      'Do not let the scene fade out weakly.',
    ],
    'technical'
  ),
];


/* -------------------------------- SOUND -------------------------------- */
/* 35 unique non-boss lessons */
const SOUND_BASE: LessonSeed[] = [
  makeSeed(
    'Clean Dialogue First',
    'Foundation',
    'Before style, make speech clean and watchable.',
    'Take a 20–40 second dialogue clip you shot yourself — even just one person saying 4 to 6 lines in a quiet room — and make the dialogue sound clean, even, and easy to follow from start to finish.',
    'Train the first rule of sound post: the audience must understand the words before they admire the sound design.',
    'A short dialogue clip with consistent clarity and level.',
    [
      'Use room tone underneath any dialogue edits.',
      'Remove obvious background distractions if possible.',
      'The voice must stay natural, not over-processed.'
    ],
    'technical',
    'If the dialogue is unclear, nothing built on top of it will matter.'
  ),
  makeSeed(
    'Room Tone Stitch',
    'Foundation',
    'Make invisible dialogue edits by filling the air.',
    'Record 20–30 seconds of room tone in one location, then cut together a short 3-line dialogue exchange and use that room tone underneath every edit so the background does not jump or disappear.',
    'Train one of the most basic professional habits in post: using room tone to hide cuts and preserve continuity.',
    'A short dialogue scene with smooth, invisible background continuity.',
    [
      'Use one location only.',
      'The background sound must not disappear between lines.',
      'No music allowed.'
    ],
    'technical'
  ),
  makeSeed(
    'L-Cut the Argument',
    'Dialogue Flow',
    'Let emotion spill over the cut.',
    'Film or find a short 20–45 second argument scene, then rebuild it using at least 3 L-cuts so one person’s line continues briefly over the other person’s reaction shot.',
    'Train smoother dramatic dialogue editing through split edits.',
    'A short argument scene that feels more fluid and emotionally alive after the re-edit.',
    [
      'Use at least 3 L-cuts.',
      'Every overlap must improve rhythm or tension.',
      'Do not let the overlap confuse who is speaking.'
    ],
    'technical'
  ),
  makeSeed(
    'J-Cut the Entrance',
    'Dialogue Flow',
    'Let the next moment arrive through sound first.',
    'Build a short 20–45 second sequence where we hear the next location, person, TV, club, train, or threat before we cut to it. Use at least 2 J-cuts to pull the audience forward.',
    'Train anticipatory audio and smoother scene transitions.',
    'A short sequence where sound leads the audience into the next image.',
    [
      'Use at least 2 J-cuts.',
      'The audience must understand the geography of the transition.',
      'Do not use the J-cut just for decoration.'
    ],
    'technical'
  ),
  makeSeed(
    'Foley a Mug Scene',
    'Foley',
    'Make ordinary objects feel cinematic.',
    'Film or use a short close-up scene of someone making tea or coffee: mug placed down, spoon stirring, cupboard opening, kettle pouring, chair movement, breath, cloth. Strip the original production sound if needed and rebuild the entire scene with fresh foley.',
    'Train sync, detail, and tactile realism.',
    'A 20–45 second domestic sequence rebuilt almost entirely from foley.',
    [
      'Include at least 8 separate synced sounds.',
      'No music allowed.',
      'The final scene should feel richer than the raw audio.'
    ],
    'drill'
  ),
  makeSeed(
    'Footstep Character',
    'Character',
    'Build a person through the way they move.',
    'Create 3 different sets of footsteps crossing the same space: one confident, one exhausted, one frightened. You can show the person or keep them offscreen, but the audience must hear the difference in character.',
    'Train performance through sound detail.',
    'A short comparison or sequence where footsteps clearly imply emotional state.',
    [
      'Use the same floor or surface if possible.',
      'Change rhythm, weight, pace, and texture.',
      'Do not rely on music to explain the difference.'
    ],
    'drill'
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
    'scene'
  ),
  makeSeed(
    'End the Song Mid-Line',
    'Source Music',
    'Interrupt comfort with a hard stop.',
    'Use a scene with diegetic music coming from a radio, speaker, headphones, TV, or car. Cut the song off halfway through a lyric or musical phrase at the most awkward or dramatic moment.',
    'Train source-music interruption as storytelling.',
    'A short scene where cutting the music mid-phrase changes the emotional temperature instantly.',
    [
      'The music must clearly come from within the scene.',
      'The cut-off point must feel dramatic, not random.',
      'The room tone after the stop must still feel alive.'
    ],
    'scene'
  ),
  makeSeed(
    'Club Bathroom Perspective',
    'Perspective',
    'Make the same song feel physically located in space.',
    'Build a short sequence that starts near loud music — party, club, rehearsal room, car outside a venue — then move into a bathroom, hallway, stairwell, or side room where the same song becomes distant, muffled, and bass-heavy.',
    'Train EQ, filtering, level, and perspective shifts.',
    'A short sequence where one song clearly changes with location.',
    [
      'The music must sound full in one place and filtered in another.',
      'Use EQ or muffling, not just lower volume.',
      'The audience should always understand where they are.'
    ],
    'technical'
  ),
  makeSeed(
    'Breath as Score',
    'Intimacy',
    'Replace music with the body.',
    'Take a close emotional scene — crying held back, panic rising, someone preparing to confess something — and build it so breath, mouth noise, clothing movement, and tiny body sounds carry the emotional tension instead of score.',
    'Train intimacy and body-led sound design.',
    'A short scene where body sound replaces underscore.',
    [
      'No music allowed.',
      'Keep the breaths natural, not theatrical.',
      'At least 4 subtle body sounds must be audible.'
    ],
    'scene'
  ),
  makeSeed(
    'Phone Speaker Reality',
    'Processing',
    'Make clean sound feel like a device, not a clean recording.',
    'Record a short voicemail, speakerphone call, or video message and process it so it genuinely sounds like it is coming through a phone speaker in a room.',
    'Train EQ, bandwidth limiting, and source realism.',
    'A short scene where device audio feels believable and physically placed.',
    [
      'Use one device type only.',
      'Do not just make it “bad quality.”',
      'The device sound must still be understandable.'
    ],
    'technical'
  ),
  makeSeed(
    'Old Radio / Old Film Voice',
    'Processing',
    'Make a voice feel historically or physically limited.',
    'Take a clean line of dialogue and make it sound like it is coming from an old radio, old TV broadcast, tape recorder, security camera speaker, or damaged archive reel.',
    'Train source-specific processing choices.',
    'A short processed line or exchange with convincing character.',
    [
      'Choose only one source format.',
      'The processing must fit that source specifically.',
      'Avoid making it muddy beyond comprehension.'
    ],
    'technical'
  ),
  makeSeed(
    'Crowd From Nothing',
    'Worldbuilding',
    'Create a room full of people who were never filmed.',
    'Take a simple one- or two-person café, bar, classroom, restaurant, or house-party scene and build a believable crowd around it using walla, chairs, cutlery, glasses, laughter, footsteps, and distant speech.',
    'Train crowd layering and social-space realism.',
    'A short scene that feels populated without becoming muddy.',
    [
      'Use at least 5 crowd or room layers.',
      'Dialogue must remain understandable.',
      'The crowd must feel like a place, not generic noise.'
    ],
    'scene'
  ),
  makeSeed(
    'Threat Off Screen',
    'Suspense',
    'Let danger live just outside the frame.',
    'Create a short suspense scene where the main threat is never fully shown. Use footsteps, a door handle, a bag drop, breathing, distant metal movement, or a repeated offscreen noise to build dread.',
    'Train offscreen tension and sound-led fear.',
    'A short suspense scene driven mainly by sound.',
    [
      'The threat cannot be fully shown.',
      'Use one repeated sound motif.',
      'Escalate the motif across the scene.'
    ],
    'scene'
  ),
  makeSeed(
    'Outside the Flat',
    'Offscreen Pressure',
    'Let the world outside invade the room.',
    'Build an interior scene where sounds from outside the room or flat slowly reshape the emotional reality inside: neighbours fighting, police sirens, a party downstairs, a car alarm, a protest, or someone arriving.',
    'Train pressure from beyond the frame.',
    'A short interior scene transformed by exterior sound.',
    [
      'The exterior sound must evolve or escalate.',
      'Keep the interior and exterior relationship clear.',
      'The outside sound must change the behaviour inside.'
    ],
    'drill'
  ),
  makeSeed(
    'Sonic Reveal',
    'Reveal',
    'Let sound get there before image.',
    'Create a scene where the audience first understands the reveal through audio before the picture confirms it: keys that should not be there, a hospital machine, a voice in another room, a train arriving, a gun being loaded, or a child laughing in an empty house.',
    'Train audio-led revelation.',
    'A short scene where the reveal lands through sound first.',
    [
      'The reveal must be legible.',
      'Do not confirm it visually too quickly.',
      'The image should either confirm or deepen the sound.'
    ],
    'technical'
  ),
  makeSeed(
    'The Lie Changes the Room',
    'Subtext',
    'Use sound to make dishonesty feel different.',
    'Build a short two-line or three-line dialogue scene where a character lies. At the lie, alter the sonic world subtly: room tone narrows, a fridge hum appears louder, clock ticks emerge, air feels thinner, or an exterior noise suddenly feels invasive.',
    'Train psychological sound design without obvious gimmicks.',
    'A short scene where the lie changes how the room feels.',
    [
      'The change must be subtle, not horror-movie obvious.',
      'The audience should feel the shift even if they cannot name it.',
      'Tie the sound change to a specific line.'
    ],
    'drill'
  ),
  makeSeed(
    'Object Motif',
    'Pattern',
    'Turn one repeated sound into story.',
    'Choose one object sound — lighter flick, key turn, pill bottle, glass clink, shoe squeak, train announcement, lift ding — and repeat it at least 3 times across a scene so its meaning changes each time.',
    'Train motif-building and emotional repetition.',
    'A short scene built around one evolving repeated sound.',
    [
      'Use the same object or source each time.',
      'Each repetition must mean something different.',
      'The final repetition should land hardest.'
    ],
    'constraint'
  ),
  makeSeed(
    'Memory Through Sound',
    'Memory',
    'Let sound behave like recollection.',
    'Create a present-day scene interrupted by sound fragments from memory: children in a garden, a tube announcement, hospital monitor beeps, a football crowd, church bells, a parent calling from another room. The fragments should feel linked to one emotional event.',
    'Train associative and memory-based sound design.',
    'A short scene where memory reshapes the present through audio.',
    [
      'Use no more than 4 memory fragments.',
      'The fragments must feel connected, not random collage.',
      'The present scene must stay emotionally readable.'
    ],
    'constraint'
  ),
  makeSeed(
    'Two Hearing Worlds',
    'POV',
    'Let two people hear the same room differently.',
    'Create a short two-character scene where the sound perspective shifts between them: one hears the room clearly, the other hears it narrowed, bass-heavy, ringing, distant, or hyper-detailed because of panic, attraction, shame, rage, or dissociation.',
    'Train comparative subjective sound.',
    'A short scene with at least 2 distinct hearing perspectives.',
    [
      'Both perspectives must feel clearly different.',
      'The switch points must be motivated by emotion.',
      'The audience must never get lost in the geography.'
    ],
    'technical'
  ),
  makeSeed(
    'Crowd Isolation',
    'Focus',
    'Find one human thread inside chaos.',
    'Take a crowded scene — canteen, corridor, train platform, pub, house party — and shape the mix so one voice, laugh, breath, chant, or phrase rises above everything else at exactly the right emotional moment.',
    'Train selective focus inside layered ambience.',
    'A short crowd scene with one clearly dominant emotional detail.',
    [
      'The crowd must still feel full.',
      'One element must cut through at the key moment.',
      'Do not bury the main dialogue.'
    ],
    'scene'
  ),
  makeSeed(
    'Make It Sound Like a Club Bathroom',
    'Acoustic Space',
    'Use filtering and reflections to create location.',
    'Take any piece of music or dialogue and make it sound like it is being heard from inside a nightclub bathroom, corridor, stairwell, or smoking area while the party continues outside.',
    'Train space-making through filtering, reverb, and muffled source bleed.',
    'A short audio scene with a clearly believable architectural space.',
    [
      'The main source must feel outside the room, not inside it.',
      'Use reverb and filtering intentionally.',
      'The space must be guessable without explanation.'
    ],
    'technical'
  ),
  makeSeed(
    'Make It Sound Like an Old Cinema',
    'Texture',
    'Give audio a historical playback identity.',
    'Take a short music cue or spoken line and make it sound like it is being heard in an old cinema, village hall screening, damaged archive projection, or worn film reel environment.',
    'Train tonal shaping and playback texture.',
    'A short processed cue or scene with a distinct old-film playback feel.',
    [
      'Keep the creative choice specific.',
      'Add character without making it impossible to hear.',
      'The texture must feel deliberate, not broken by accident.'
    ],
    'technical'
  ),
  makeSeed(
    'Dialogue Under Pressure',
    'Balance',
    'Let the world compete without winning.',
    'Mix a dialogue scene where environmental sound matters — train passing, dishes, traffic, rain, children, warehouse hum, football crowd, or club bleed — but the words still stay understandable.',
    'Train balancing speech against aggressive environment.',
    'A short scene where both dialogue and world feel important.',
    [
      'Dialogue must remain understandable.',
      'The environment must still feel active.',
      'The pressure source must change the mood of the scene.'
    ],
    'technical'
  ),
  makeSeed(
    'No-Music Suspense',
    'Suspense',
    'Build tension honestly.',
    'Create a suspense scene with zero music and no cheap stingers. Use only breath, footsteps, surfaces, doors, distant sounds, silence, and timing.',
    'Train tension-building through pure sound design.',
    'A short suspense scene with no score at all.',
    [
      'No music.',
      'No jump-scare sting.',
      'The tension must still rise clearly.'
    ],
    'constraint'
  ),
  makeSeed(
    'Music Against the Scene',
    'Contrast',
    'Make the wrong music become the right choice.',
    'Take a serious, tense, or heartbreaking scene and score it with music that seems emotionally opposite at first. Then shape entry point, level, and stop point so the contrast becomes revealing or disturbing rather than comic.',
    'Train counterpoint between music and image.',
    'A short scene where contrasting music deepens the meaning.',
    [
      'Do not make it parody.',
      'Use at least one exact moment where the music changes level or stops.',
      'The contrast must add meaning, not undermine the scene.'
    ],
    'scene'
  ),
  makeSeed(
    'Source Music Becomes Score',
    'Music Perspective',
    'Blur the line between heard and felt music.',
    'Start a scene with music clearly coming from a radio, TV, speaker, band rehearsal, headphones, or car. As the emotional intensity rises, let that same cue grow into full score.',
    'Train transitions between diegetic and non-diegetic music.',
    'A short scene where source music transforms into emotional underscore.',
    [
      'The source must be established clearly first.',
      'The transition into score must feel smooth and motivated.',
      'The emotional reason for the shift must be obvious.'
    ],
    'scene'
  ),
  makeSeed(
    'Rhythmic Dread',
    'Pattern',
    'Let repetition become terror.',
    'Build a suspense sequence around one repeated rhythm: train wheels, dripping tap, flickering fluorescent buzz, washing machine, basketball bounce, neighbour knocking, heel clicks, or elevator thud.',
    'Train escalation through repeated sonic pattern.',
    'A short sequence where repetition becomes oppressive.',
    [
      'Use one main rhythm source.',
      'The rhythm must evolve across the scene.',
      'Do not rely on jump scares.'
    ],
    'technical'
  ),
  makeSeed(
    'Silence After Violence',
    'Aftermath',
    'The silence after the event is part of the event.',
    'Build the aftermath of an unseen fight, crash, collapse, or violent confrontation using debris, breath, ringing ears, cloth, footsteps, glass, distant sirens, or stunned room tone.',
    'Train restraint and aftermath sound design.',
    'A short aftermath scene where the emotional weight lives in what remains.',
    [
      'Do not show the violence itself in full.',
      'Let aftermath sounds carry the scene.',
      'The silence must feel earned, not empty.'
    ],
    'scene'
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
    'technical'
  ),
  makeSeed(
    'Whisper Pressure',
    'Intimacy',
    'Quiet can feel more invasive than shouting.',
    'Create a scene where whispered or nearly whispered lines become more intense than loud dialogue would be. Build the intimacy with breath, proximity, room hush, and vocal detail.',
    'Train low-level intensity and close-mic pressure.',
    'A short scene built around quiet but dangerous or intimate sound.',
    [
      'Whispers must stay intelligible.',
      'Do not flatten the whole mix to one level.',
      'The quiet should feel active, not weak.'
    ],
    'technical'
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
    'drill'
  ),
  makeSeed(
    'Sound Theme Build',
    'Theme',
    'Turn an idea into a sound language.',
    'Choose one theme — guilt, surveillance, loneliness, desire, exposure, envy, home, or hunger — and design a short scene where the sound world reflects that theme through repetition, texture, distance, or interruption.',
    'Train thematic sound authorship.',
    'A short scene with a coherent sonic concept.',
    [
      'The theme must shape multiple sound choices.',
      'Avoid random “cool” effects.',
      'The emotional meaning must stay grounded.'
    ],
    'scene'
  ),
  makeSeed(
    'Make the Crowd Think They Saw Something',
    'Misdirection',
    'Use sound to imply an event that may not be real.',
    'Build a scene where the audience initially believes something happened offscreen because of the sound design — a crash, a body falling, a kiss, a slap, police arriving, a scream — and then discovers they misread it.',
    'Train sonic misdirection and reinterpretation.',
    'A short scene where the first sonic reading is wrong but believable.',
    [
      'The false reading must feel plausible.',
      'The reveal must reframe the earlier sound.',
      'Do not cheat with information the audience never had.'
    ],
    'scene'
  ),
  makeSeed(
    'Last Sound Wins',
    'Ending',
    'Let the final sound become the final image.',
    'Build a scene where the ending lands because of one last sound: a key turn, voicemail beep, stadium roar cutting out, tube doors closing, a laugh in another room, a kettle boiling over, or sudden dead silence.',
    'Train ending design through audio punctuation.',
    'A short scene with a memorable final sonic beat.',
    [
      'The final sound must feel earned.',
      'Do not use a random sting.',
      'The ending must grow from the scene before it.'
    ],
    'constraint'
  ),
  makeSeed(
    'Sound Design Proof',
    'Mastery',
    'Show total control of dialogue, world, perspective, and music.',
    'Create a polished 45–90 second scene that includes: clean dialogue, room tone continuity, at least one split edit, at least one perspective shift, one worldbuilding layer set, and one deliberate music choice or deliberate refusal of music.',
    'Prove advanced sound-post authorship in one finished sequence.',
    'A fully designed short scene where every sonic choice feels intentional.',
    [
      'Dialogue must remain clear throughout.',
      'Every major sound layer must have a reason to be there.',
      'The final scene must feel mixed, not merely assembled.'
    ],
    'technical'
  ),
];

/* ------------------------------- FILMMAKER ------------------------------- */
/* 35 unique non-boss lessons */
const FILMMAKER_ROTATION: LessonSeed[] = [
  makeSeed(
    'Word to World',
    'Foundation',
    'Build a whole film language from one word.',
    'Choose one word — for example: “late,” “forgive,” “hunger,” “watching,” “home,” or “replaceable.” Write a 1–2 sentence premise, then make a 45–90 second short where that word shapes the performance, frame choices, sound, and final image.',
    'Train full-film authorship from a single conceptual seed.',
    'A short film where one word clearly drives the entire piece.',
    [
      'The word must affect more than dialogue.',
      'At least 3 departments must clearly reflect the word.',
      'The final image must feel connected to the original word.'
    ],
    'scene',
    'A strong short often begins with a precise central idea, not a pile of random cool shots.'
  ),
  makeSeed(
    'Object Exercise Film',
    'Performance + Film Language',
    'Turn the acting object exercise into a full cinematic short.',
    'Choose a personal object with emotional charge — ring, jacket, letter, watch, old phone, key, photograph. Build a 60–120 second film where the object changes the behaviour of the character before they ever explain why it matters.',
    'Train the fusion of acting inner life, close visual attention, and restrained storytelling.',
    'A short film where the object becomes the emotional engine.',
    [
      'The object must appear in the first 10 seconds.',
      'Do not explain its full meaning in dialogue.',
      'Use at least one close-up where the object changes the scene.'
    ],
    'scene'
  ),
  makeSeed(
    'One Room, Full Film',
    'Foundation',
    'Prove you can make one room feel like a complete film.',
    'Make a 1–2 minute short in one room only: bedroom, kitchen, hallway, garage, classroom, bathroom, office. The film must still have a beginning, escalation, and clear ending image.',
    'Train limitation-driven filmmaking and structural discipline.',
    'A complete one-room short with a turn.',
    [
      'One room only.',
      'There must be a turn or reveal.',
      'Sound and framing must stop the room feeling visually dead.'
    ],
    'technical'
  ),
  makeSeed(
    'Performance-Led Short',
    'Actor-Centred',
    'Let the actor carry the piece and make every other department serve them.',
    'Build a 45–90 second short around one emotional action: hiding panic, trying to keep dignity, trying not to cry, trying to leave without being stopped, pretending to be fine. The performance should be the main reason the film works.',
    'Train alignment around acting rather than decorative filmmaking.',
    'A short film where performance is clearly the centre of gravity.',
    [
      'One actor must dominate the emotional arc.',
      'Do not let flashy cutting overpower the acting.',
      'At least one shot must stay long enough to watch behaviour change.'
    ],
    'drill'
  ),
  makeSeed(
    'Image-Led Short',
    'Visual Storytelling',
    'Tell the story mainly through frame, light, and withholding.',
    'Create a 45–90 second short where the audience understands the story mostly from images: reflections, silhouettes, negative space, blocked reveals, distance changes, or camera height shifts.',
    'Train image-first authorship.',
    'A short film where visual design is the main storytelling engine.',
    [
      'Minimal exposition.',
      'At least 3 shots must carry story without dialogue.',
      'The visual idea must feel consistent, not random.'
    ],
    'technical'
  ),
  makeSeed(
    'Sound-Led Short',
    'Sound Story',
    'Build the film around sound perspective and sonic meaning.',
    'Create a 45–90 second short where sound drives the piece: offscreen threat, memory fragments, crowd build, room tone pressure, club bathroom music bleed, source music turning into score, or a hard music stop on a dramatic beat.',
    'Train audio-first filmmaking.',
    'A short film whose emotional spine is built primarily through sound.',
    [
      'Sound must lead, not just decorate.',
      'Use at least one deliberate perspective shift or music decision.',
      'The film must still tell a clear story.'
    ],
    'scene'
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
    'drill'
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
    'constraint'
  ),
  makeSeed(
    'The Two Character Solo',
    'Actor + Director',
    'Direct yourself in a serious two-character scene if you have no scene partner.',
    'Write or stage a 45–90 second two-character scene and play both roles seriously. Shoot each character cleanly, with a distinct objective, framing logic, and rhythm for each side of the conversation. If you can, invite someone from your city chat to act instead — but if not, play both roles properly.',
    'Train directing, performance separation, eyeline control, and self-coverage discipline.',
    'A two-character scene that feels like two real people, not a sketch.',
    [
      'Both characters must want different things.',
      'Keep eyelines and screen direction clean.',
      'Do not play either character as a joke.'
    ],
    'scene'
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
    'scene'
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
    'scene'
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
    'scene'
  ),
  makeSeed(
    'Coverage With Intent',
    'Directing + Edit',
    'Shoot only what the cut truly needs.',
    'Create a 30–60 second dialogue scene using a planned coverage list: one master, two mediums, and two close shots maximum. Then edit it so the scene feels shaped, not under-covered.',
    'Train disciplined coverage and edit planning.',
    'A short dialogue scene that feels complete with limited planned coverage.',
    [
      'Maximum 5 setup types.',
      'Start from a shot plan before filming.',
      'Do not shoot extra “just in case” coverage.'
    ],
    'technical'
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
    'technical'
  ),
  makeSeed(
    'POV Film',
    'Perspective',
    'Make every department belong to one inner experience.',
    'Create a 45–90 second film where cinematography, sound, and editing all clearly belong to one character’s emotional point of view: panic, shame, attraction, rage, disassociation, suspicion, exhaustion.',
    'Train integrated POV authorship.',
    'A finished short with a strong subjective identity.',
    [
      'The perspective must stay coherent.',
      'Use at least one sound or lens choice that reflects the POV.',
      'Do not explain the feeling in dialogue.'
    ],
    'technical'
  ),
  makeSeed(
    'Action Through Geography',
    'Pace',
    'Make something high-paced without losing clarity.',
    'Film a short action sequence built around pursuit, search, escape, or urgent movement — hallway chase, stairwell escape, grabbing the wrong bag, running late to stop something, or trying to hide an object before someone arrives. Keep it under 75 seconds.',
    'Train pace, geography, and action readability.',
    'A fast sequence where the audience always understands where they are and what matters.',
    [
      'The action must remain geographically clear.',
      'Use movement, cut timing, and sound to increase urgency.',
      'Do not replace clarity with chaos.'
    ],
    'scene'
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
    'constraint'
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
    'scene'
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
    'scene'
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
    'scene'
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
    'drill'
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
    'technical'
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
    'technical'
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
    'technical'
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
    'scene'
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
    'drill'
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
    'drill'
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
    'collab'
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
    'collab'
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
    'technical'
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
    'technical'
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
    'scene'
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
    'scene'
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
    'constraint'
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
    'constraint'
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
    'scene'
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
    'technical'
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
    'technical'
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
    'scene'
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
    'collab'
  ),
  makeSeed(
    'Filmmaker Proof Piece',
    'Mastery',
    'Combine everything and prove full-stack authorship.',
    'Create a polished 90–180 second short that combines the strongest tools from the whole path: precise performance direction, planned shot design, meaningful lens/light choices, clear sound perspective, disciplined edit rhythm, and a final image or emotional reveal that lands hard.',
    'Prove you can think and execute like a complete filmmaker rather than a single-department specialist.',
    'A finished short film where acting, directing, cinematography, sound, and edit all feel coordinated and deliberate.',
    [
      'At least 4 departments must matter clearly.',
      'Every major choice must feel authored.',
      'The final film must feel finished, not like a sketch of a film.'
    ],
    'technical'
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

function buildLessonsFromBase(base: LessonSeed[], total = 40): Lesson[] {
  const lessons: Lesson[] = [];

  for (let step = 1; step <= total; step += 1) {
    const isBoss = step % 8 === 0;
    const mission = missionForStep(step);

    if (isBoss) {
      lessons.push({
        id: step,
        step,
        title: `Boss Challenge ${step / 8}`,
        subtitle: 'Boss',
        description:
          'A larger challenge combining the previous lessons into one polished mini-film or major exercise.',
        prompt:
          'Create a full piece that proves the previous training is now part of your instincts, not just theory.',
        objective:
          'Synthesize recent skills into one finished challenge with confidence and intention.',
        deliverable:
          'A major workshop submission that feels complete from beginning to end.',
        bonusNote:
          'This should feel like a statement piece for this stage of the path.',
        kind: 'boss',
        constraints: [
          'The piece must feel complete from beginning to end.',
          'Use what the previous lessons trained.',
          'The final moment must land emotionally or cinematically.',
        ],
        xp: xpForStep(step, true),
        duration: durationForStep(step, true),
        isBoss: true,
        requiresSurgery: false,
        missionType: mission?.type || null,
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
        prompt: item.prompt,
        objective: item.objective,
        deliverable: item.deliverable,
        bonusNote: item.bonusNote,
        kind: item.kind,
        constraints: item.constraints,
        xp: xpForStep(step, false),
        duration: durationForStep(step, false),
        requiresSurgery: surgeryStep(step),
        missionType: mission?.type || null,
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

    let bank = EDITING_FOUNDATION;
    if (step > 16 && step <= 32) bank = EDITING_INTERMEDIATE;
    if (step > 32) bank = EDITING_ADVANCED;

    if (isBoss) {
      const bossLabel =
        step <= 8
          ? 'Editing Boss 1'
          : step <= 16
          ? 'Editing Boss 2'
          : step <= 24
            ? 'Editing Boss 3'
            : step <= 32
              ? 'Editing Boss 4'
              : 'Editing Boss 5';

      lessons.push({
        id: step,
        step,
        title: bossLabel,
        subtitle: 'Boss',
        description:
          step <= 16
            ? 'A bigger editing piece that proves you can assemble, clarify, and shape a sequence cleanly.'
            : step <= 32
              ? 'A larger challenge combining clarity, rhythm, reveals, and emotional control through the cut.'
              : 'An advanced post challenge where editorial choices fully transform the material into something authored and cinematic.',
        prompt:
          step <= 16
            ? 'Take raw or rough material and build the cleanest, strongest finished sequence you can.'
            : step <= 32
              ? 'Create a polished mini-piece where pacing, emotional emphasis, and structure feel fully intentional.'
              : 'Transform existing material into a refined, emotionally authored piece using structure, sound, perspective, and post finish.',
        objective:
          step <= 16
            ? 'Prove the user can edit for clarity and flow before moving into advanced reinterpretation.'
            : step <= 32
              ? 'Prove the user can shape experience, not just arrange footage.'
              : 'Prove the user can fully author meaning in post like a true editor, not just a cutter.',
        deliverable:
          'A finished editing submission that feels complete, readable, and intentional from start to finish.',
        bonusNote:
          'Every boss should feel like the natural proof of the steps before it.',
        kind: 'boss',
        constraints: [
          'The piece must feel complete from beginning to end.',
          'The cut must clearly show the lessons from this phase.',
          'The final version must land emotionally or structurally.',
        ],
        xp: xpForStep(step, true),
        duration: durationForStep(step, true),
        isBoss: true,
        requiresSurgery: false,
        missionType: mission?.type || null,
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
        prompt: item.prompt,
        objective: item.objective,
        deliverable: item.deliverable,
        bonusNote: item.bonusNote,
        kind: item.kind,
        constraints: item.constraints,
        xp: xpForStep(step, false),
        duration: durationForStep(step, false),
        requiresSurgery: surgeryStep(step),
        missionType: mission?.type || null,
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
      lessons.push({
        id: step,
        step,
        title: `Filmmaker Boss ${step / 8}`,
        subtitle: 'Boss',
        description:
          'A full mixed-discipline challenge combining acting, directing, cinematography, editing, sound, and collaboration.',
        prompt:
          'Make a short piece that feels authored across performance, image, sound, pacing, and emotional logic.',
        objective:
          'Prove you can think like a complete filmmaker instead of a single department specialist.',
        deliverable:
          'A finished mini-film or polished sequence where at least 3 disciplines clearly matter.',
        bonusNote:
          'Taste matters here just as much as effort.',
        kind: 'boss',
        constraints: [
          'Use at least 3 disciplines clearly.',
          'The visual idea must be strong.',
          'Sound and pacing must matter.',
          'The piece must feel like a finished mini-film.',
        ],
        xp: xpForStep(step, true) + 20,
        duration: durationForStep(step, true),
        isBoss: true,
        requiresSurgery: false,
        missionType: mission?.type || null,
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
        prompt: item.prompt,
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
      });
    }
  }

  return lessons;
}

function buildPathLessons(path: WorkshopPathKey): Lesson[] {
  switch (path) {
    case 'acting':
      return buildLessonsFromBase(ACTING_BASE);
    case 'editing':
      return buildEditingLessons();
    case 'cinematography':
      return buildLessonsFromBase(CINEMATOGRAPHY_BASE);
    case 'directing':
      return buildLessonsFromBase(DIRECTING_BASE);
    case 'sound':
      return buildLessonsFromBase(SOUND_BASE);
    case 'filmmaker':
      return buildFilmmakerLessons();
    default:
      return buildLessonsFromBase(ACTING_BASE);
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
  const scale = useRef(new Animated.Value(1)).current;
  const glow = useRef(new Animated.Value(active ? 1 : 0)).current;

  const animateTo = (hovered: boolean) => {
    Animated.parallel([
      Animated.spring(scale, {
        toValue: hovered ? 1.015 : 1,
        useNativeDriver: true,
        friction: 7,
        tension: 120,
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
    outputRange: [BORDER, GOLD],
  });

  const backgroundColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [PANEL, '#13110D'],
  });

  return (
    <Animated.View
      style={[
        styles.sidebarItemWrap,
        {
          transform: [{ scale }],
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
        <View style={[styles.sidebarIcon, active && styles.sidebarIconActive]}>
          <Ionicons name={path.icon} size={18} color={active ? BG : GOLD} />
        </View>

        <View style={styles.sidebarTextWrap}>
          <Text style={[styles.sidebarTitle, active && styles.sidebarTitleActive]}>
            {path.shortLabel}
          </Text>
          <Text style={styles.sidebarSubtitle} numberOfLines={1}>
            {path.subtitle}
          </Text>
        </View>

        <View style={styles.sidebarProgressPill}>
          <Text style={styles.sidebarProgressText}>{progress}</Text>
        </View>
      </Pressable>
    </Animated.View>
  );
}

function MobilePathChip({
  path,
  active,
  onPress,
}: {
  path: PathMeta;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      activeOpacity={0.9}
      onPress={onPress}
      style={[styles.mobileChip, active && styles.mobileChipActive]}
    >
      <Ionicons name={path.icon} size={15} color={active ? BG : GOLD} />
      <Text style={[styles.mobileChipText, active && styles.mobileChipTextActive]}>
        {path.shortLabel}
      </Text>
    </TouchableOpacity>
  );
}

function LessonBubble({
  lesson,
  state,
  size,
  onPress,
}: {
  lesson: Lesson;
  state: NodeState;
  size: number;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const shadow = useRef(new Animated.Value(state === 'current' ? 1 : 0)).current;

  const animateTo = (hovered: boolean) => {
    if (state === 'locked') return;

    Animated.parallel([
      Animated.spring(scale, {
        toValue: hovered ? 1.05 : 1,
        useNativeDriver: true,
        friction: 7,
        tension: 120,
      }),
      Animated.timing(shadow, {
        toValue: hovered || state === 'current' ? 1 : 0,
        duration: 160,
        useNativeDriver: false,
      }),
    ]).start();
  };

  const borderColor =
    state === 'completed'
      ? GREEN
      : state === 'current'
        ? GOLD
        : state === 'locked'
          ? LOCKED
          : BORDER;

  const backgroundColor =
    state === 'completed'
      ? GREEN
      : state === 'current'
        ? GOLD
        : lesson.requiresSurgery
          ? '#13101A'
          : lesson.isBoss
            ? '#17130B'
            : PANEL_2;

  const shadowOpacity = shadow.interpolate({
    inputRange: [0, 1],
    outputRange: [0.05, 0.18],
  });

  return (
    <Animated.View
      style={[
        styles.lessonBubbleShadowWrap,
        {
          transform: [{ scale }],
          shadowOpacity,
          shadowColor: lesson.requiresSurgery ? PURPLE : GOLD,
        },
      ]}
    >
      <Pressable
        onPress={onPress}
        disabled={state === 'locked'}
        onHoverIn={() => Platform.OS === 'web' && animateTo(true)}
        onHoverOut={() => Platform.OS === 'web' && animateTo(false)}
        style={[
          styles.lessonBubble,
          {
            width: size,
            height: size,
            borderRadius: size / 2,
            borderColor,
            backgroundColor,
          },
        ]}
      >
        <Ionicons
          name={
            state === 'completed'
              ? 'checkmark'
              : lesson.requiresSurgery
                ? 'medkit-outline'
                : lesson.isBoss
                  ? 'trophy-outline'
                  : kindIcon(lesson.kind)
          }
          size={lesson.isBoss ? 24 : 19}
          color={state === 'locked' ? MUTED_2 : state === 'current' ? BG : IVORY}
        />
      </Pressable>
    </Animated.View>
  );
}

/* -------------------------------- screen -------------------------------- */
const WorkshopScreen: React.FC = () => {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 960;
  const navigation = useNavigation<any>();

  const {
    userId,
    xp: globalXp,
    level,
    nextLevelMinXp,
    refresh: refreshGamification,
    loading: gamificationLoading,
  } = useGamification();

  const { streak, refreshStreak } = useMonthlyStreak();

  const hasLoadedOnceRef = useRef(false);

  const [selectedPath, setSelectedPath] = useState<WorkshopPathKey>('acting');
  const [selectedLesson, setSelectedLesson] = useState<Lesson | null>(null);
  const [surgeryLesson, setSurgeryLesson] = useState<Lesson | null>(null);
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [upgradeVisible, setUpgradeVisible] = useState(false);

  const [progressByPath, setProgressByPath] = useState<Record<WorkshopPathKey, number[]>>({
    acting: [],
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
    editing: [],
    cinematography: [],
    directing: [],
    sound: [],
    filmmaker: [],
  });

  const [workshopLoading, setWorkshopLoading] = useState(true);
  const [surgeryFeedbackState, setSurgeryFeedbackState] = useState<Record<number, boolean>>({});

  const hasProAccess = userProfile?.tier === 'pro';

  const loadWorkshopProgress = useCallback(async () => {
    if (!userId) {
      setUserProfile(null);
      setProgressByPath({
        acting: [],
        editing: [],
        cinematography: [],
        directing: [],
        sound: [],
        filmmaker: [],
      });
      setSurgeryProgressByPath({
        acting: [],
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
      editing: [],
      cinematography: [],
      directing: [],
      sound: [],
      filmmaker: [],
    };

    try {
      const { data: profileData, error: profileError } = await supabase
        .from('users')
        .select('id, tier')
        .eq('id', userId)
        .single();

      if (profileError) {
        console.log('Workshop profile load error:', profileError);
        setUserProfile(null);
      } else if (profileData) {
        setUserProfile({
          id: profileData.id,
          tier: profileData.tier as UserTier,
        });
      }

      const { data, error } = await supabase
        .from('workshop_progress')
        .select('path_key, step')
        .eq('user_id', userId);

      if (error) throw error;

      const nextMap: Record<WorkshopPathKey, number[]> = {
        acting: [],
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
  const bossesCleared = completedSteps.filter((n) => n % 8 === 0).length;
  const surgeryClears = surgeryClearedSteps.length;
  const chapterMeta = PATH_STAGE_META[selectedPath];

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

    if (!hasProAccess) {
      setUpgradeVisible(true);
      return;
    }

    setSelectedLesson(lesson);
  };

  const handleOpenSurgeryGate = (lesson: Lesson) => {
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

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.pageWrap}>
          <View style={styles.heroBlock}>
  <Text style={styles.eyebrow}>Film Bootcamp</Text>
  <Text style={styles.pageTitle}>Learn the Craft of Film</Text>
  <Text style={styles.pageSubtitle}>
    Choose a discipline, build real skills, and grow your creative portfolio with every challenge you complete.
  </Text>
</View>


          {!isDesktop ? (
            <ScrollView
  horizontal
  showsHorizontalScrollIndicator={false}
  contentContainerStyle={styles.mobileChipRow}
  style={styles.mobileChipScroll}
>
              {PATHS.map((path) => (
                <MobilePathChip
                  key={path.key}
                  path={path}
                  active={selectedPath === path.key}
                  onPress={() => setSelectedPath(path.key)}
                />
              ))}
            </ScrollView>
          ) : null}

          <View style={[styles.mainLayout, !isDesktop && styles.mainLayoutMobile]}>
            {isDesktop ? (
              <View style={styles.sidebar}>
                {PATHS.map((path) => (
                  <SidebarPathItem
                    key={path.key}
                    path={path}
                    active={selectedPath === path.key}
                    progress={(progressByPath[path.key] || []).length}
                    onPress={() => setSelectedPath(path.key)}
                  />
                ))}
              </View>
            ) : null}

            <View style={styles.centerPanel}>
              <View style={[styles.topSummary, !isDesktop && styles.topSummaryMobile]}>
                <View style={[styles.topSummaryLeft, !isDesktop && styles.topSummaryLeftMobile]}>
                  <View style={[styles.activePathBadge, !isDesktop && styles.activePathBadgeMobile]}>
                    <Ionicons name={activePath.icon} size={18} color={GOLD} />
                  </View>

                  <View
  style={[
    styles.topSummaryTextWrap,
    !isDesktop && styles.topSummaryTextWrapMobile,
  ]}
>
                    <Text style={[styles.topSummaryTitle, !isDesktop && styles.topSummaryTitleMobile]}>
  {activePath.label}
</Text>
                    <Text
  style={[
    styles.topSummarySubtitle,
    !isDesktop && styles.topSummarySubtitleMobile,
  ]}
>
  {activePath.subtitle}
</Text>
                  </View>
                </View>

  <View style={[styles.summaryPillsRow, !isDesktop && styles.summaryPillsRowMobile]}>
    <View style={[styles.summaryPill, !isDesktop && styles.summaryPillMobile]}>
      <Ionicons name="flash-outline" size={12} color={GOLD} />
      <Text style={[styles.summaryPillText, !isDesktop && styles.summaryPillTextMobile]}>
        {`${globalXp} Total XP`}
      </Text>
    </View>

    <View style={[styles.summaryPill, !isDesktop && styles.summaryPillMobile]}>
      <Ionicons name="ribbon-outline" size={12} color={GOLD} />
      <Text style={[styles.summaryPillText, !isDesktop && styles.summaryPillTextMobile]}>
        {`Lv ${level}`}
      </Text>
    </View>

    <View style={[styles.summaryPill, !isDesktop && styles.summaryPillMobile]}>
      <Ionicons name="flame-outline" size={12} color={GOLD} />
      <Text style={[styles.summaryPillText, !isDesktop && styles.summaryPillTextMobile]}>
        {`${streak} Streak`}
      </Text>
    </View>

    <View style={[styles.summaryPill, !isDesktop && styles.summaryPillMobile]}>
      <Ionicons name="checkmark-circle-outline" size={12} color={GREEN} />
      <Text style={[styles.summaryPillText, !isDesktop && styles.summaryPillTextMobile]}>
        {`${completedSteps.length}/40 Complete`}
      </Text>
    </View>

    {isDesktop ? (
      <>
        <View style={styles.summaryPill}>
          <Ionicons name="library-outline" size={12} color={GOLD} />
          <Text style={styles.summaryPillText}>{`${workshopSessionXp} Path XP`}</Text>
        </View>

        <View style={styles.summaryPill}>
          <Ionicons name="trophy-outline" size={12} color={GOLD} />
          <Text style={styles.summaryPillText}>{`${bossesCleared} Bosses`}</Text>
        </View>
      </>
    ) : null}
  </View>
</View>

<View style={styles.currentMissionCard}>
  <Text style={styles.currentMissionEyebrow}>Current Lesson</Text>
  <Text style={styles.currentMissionTitle}>
    Step {currentLesson.step} — {currentLesson.title}
  </Text>

  <View style={styles.proOnlyPill}>
    <Ionicons name="sparkles-outline" size={12} color={GOLD} />
    <Text style={styles.proOnlyPillText}>Pro only</Text>
  </View>

  <Text style={styles.currentMissionText}>{currentLesson.description}</Text>

  <View style={styles.currentMissionMeta}>
    <View style={styles.currentMetaPill}>
      <Ionicons name={kindIcon(currentLesson.kind)} size={12} color={GOLD} />
      <Text style={styles.currentMetaText}>{kindLabel(currentLesson.kind)}</Text>
    </View>

    <View style={styles.currentMetaPill}>
      <Ionicons name="time-outline" size={12} color={GOLD} />
      <Text style={styles.currentMetaText}>{currentLesson.duration}</Text>
    </View>

    <View style={styles.currentMetaPill}>
      <Ionicons name="flash-outline" size={12} color={GOLD} />
      <Text style={styles.currentMetaText}>{`Reward: ${currentLesson.xp} XP`}</Text>
    </View>

    <View style={styles.currentMetaPill}>
      <Ionicons name="ribbon-outline" size={12} color={GOLD} />
      <Text style={styles.currentMetaText}>{`Lv ${level}`}</Text>
    </View>

    <View style={styles.currentMetaPill}>
      <Ionicons name="flame-outline" size={12} color={GOLD} />
      <Text style={styles.currentMetaText}>{`${streak} Streak`}</Text>
    </View>
  </View>

  <View style={styles.progressTrack}>
    <View style={[styles.progressFill, { width: `${completionPercent}%` }]} />
  </View>
</View>

{currentMission ? (
  <View style={styles.missionCard}>
    <View style={styles.missionHeader}>
      <View style={styles.missionBadge}>
        <Ionicons name={currentMission.icon} size={16} color={BLUE} />
      </View>

      <View style={styles.missionTextWrap}>
        <Text style={styles.missionEyebrow}>Mission</Text>
        <Text style={styles.missionTitle}>{currentMission.title}</Text>
      </View>
    </View>

    <Text style={styles.missionDescription}>{currentMission.description}</Text>

    <View style={styles.missionPillsRow}>
      <View style={styles.missionPill}>
        <Ionicons name="sparkles-outline" size={12} color={BLUE} />
        <Text style={styles.missionPillText}>{currentMission.reward}</Text>
      </View>

      <View style={styles.missionPill}>
        <Ionicons
          name={missionIcon(currentMission.type)}
          size={12}
          color={BLUE}
        />
        <Text style={styles.missionPillText}>
          {missionLabel(currentMission.type)}
        </Text>
      </View>
    </View>
  </View>
) : null}

             <View style={styles.treeCard}>
  {workshopLoading ? (
    <View
      style={{ paddingVertical: 40, alignItems: 'center', justifyContent: 'center' }}
    >
      <Text style={{ color: MUTED }}>Loading workshop progress…</Text>
    </View>
  ) : (
    <View style={styles.chapterStack}>
      {chapters.map((chapter) => (
        <View
          key={chapter.chapterIndex}
          style={[
            styles.chapterCard,
            chapter.completed && styles.chapterCardCompleted,
            !chapter.unlocked && styles.chapterCardLocked,
            chapter.isCurrent && styles.chapterCardCurrent,
          ]}
        >
          <View style={styles.chapterHeader}>
            <View style={styles.chapterHeaderText}>
              <Text style={styles.chapterEyebrow}>
                {chapter.completed
                  ? 'Completed'
                  : chapter.unlocked
                    ? 'In Progress'
                    : 'Locked'}
              </Text>

              <Text style={styles.chapterTitle}>{chapter.title}</Text>
              <Text style={styles.chapterSubtitle}>{chapter.subtitle}</Text>
            </View>

            <View style={styles.chapterProgressWrap}>
              <View
                style={[
                  styles.chapterStatusPill,
                  chapter.completed && styles.chapterStatusPillCompleted,
                  !chapter.unlocked && styles.chapterStatusPillLocked,
                ]}
              >
                <Text
                  style={[
                    styles.chapterStatusText,
                    chapter.completed && styles.chapterStatusTextCompleted,
                    !chapter.unlocked && styles.chapterStatusTextLocked,
                  ]}
                >
                  {chapter.completed ? '10/10' : `${chapter.progress}/10`}
                </Text>
              </View>
            </View>
          </View>

          <View style={styles.chapterProgressTrack}>
            <View
              style={[
                styles.chapterProgressFill,
                { width: `${(chapter.progress / 10) * 100}%` },
              ]}
            />
          </View>

          {!chapter.unlocked ? (
            <View style={styles.chapterLockedBox}>
              <Ionicons name="lock-closed-outline" size={16} color={MUTED_2} />
              <Text style={styles.chapterLockedText}>
                Complete the previous chapter to unlock this one.
              </Text>
            </View>
          ) : (
            <View style={styles.treeInner}>
              {chapter.lessons.map((lesson, index) => {
                const state = nodeState(lesson.step, completedSteps);
                const offset = offsets[index % offsets.length] * offsetAmount;
                const actualNodeSize = lesson.isBoss ? nodeSize + 14 : nodeSize;

                return (
                  <View
                    key={lesson.id}
                    style={[
                      styles.treeRow,
                      { minHeight: isDesktop ? 162 : 148 },
                    ]}
                  >
                    <View
                      style={[
                        styles.treeNodeColumn,
                        {
                          transform: [{ translateX: offset }],
                        },
                      ]}
                    >
                      <LessonBubble
                        lesson={lesson}
                        state={state}
                        size={actualNodeSize}
                        onPress={() => handleOpenLesson(lesson)}
                      />

                      <View
                        style={[
                          styles.lessonInfoCard,
                          state === 'locked' && styles.lessonInfoCardLocked,
                        ]}
                      >
                        <Text
                          style={[
                            styles.treeStep,
                            state === 'locked' && styles.lockedText,
                          ]}
                        >
                          Step {lesson.step}
                        </Text>

                        <View style={styles.treeBadgeRow}>
                          <View style={styles.treeKindPill}>
                            <Text
                              style={[
                                styles.treeKindText,
                                state === 'locked' && styles.lockedText,
                              ]}
                            >
                              {kindLabel(lesson.kind)}
                            </Text>
                          </View>

                          {lesson.missionType ? (
                            <View style={styles.treeMissionDot}>
                              <Ionicons
                                name={missionIcon(lesson.missionType)}
                                size={10}
                                color={BLUE}
                              />
                            </View>
                          ) : null}
                        </View>

                        <Text
                          style={[
                            styles.treeTitle,
                            state === 'locked' && styles.lockedText,
                          ]}
                          numberOfLines={3}
                        >
                          {lesson.title}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </View>
          )}
        </View>
      ))}
    </View>
  )}
</View>
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
    style={styles.modalBackdrop}
    onPress={() => setSelectedLesson(null)}
  />

  <View style={styles.modalCenter}>
    {selectedLesson ? (
      <View style={styles.modalCard}>
        <View style={styles.modalHeader}>
          <View style={styles.modalHeaderLeft}>
            <View style={styles.modalIconCircle}>
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
              <Text style={styles.modalEyebrow}>
                {activePath.label} • Step {selectedLesson.step}
              </Text>
              <Text style={styles.modalTitle}>{selectedLesson.title}</Text>
              <Text style={styles.modalMini}>
                {kindLabel(selectedLesson.kind)}
                {selectedLesson.missionType
                  ? ` • ${missionLabel(selectedLesson.missionType)}`
                  : ''}
              </Text>

              <View style={styles.proOnlyPill}>
                <Ionicons name="sparkles-outline" size={12} color={GOLD} />
                <Text style={styles.proOnlyPillText}>Workshop Pro only</Text>
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={styles.modalClose}
            onPress={() => setSelectedLesson(null)}
            activeOpacity={0.9}
          >
            <Ionicons name="close" size={18} color={IVORY} />
          </TouchableOpacity>
        </View>

        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.modalDescription}>
            {selectedLesson.description}
          </Text>

          <View style={styles.modalMetaRow}>
            <View style={styles.modalMetaPill}>
              <Ionicons name="time-outline" size={12} color={GOLD} />
              <Text style={styles.modalMetaText}>
                {selectedLesson.duration}
              </Text>
            </View>

            <View style={styles.modalMetaPill}>
              <Ionicons name="flash-outline" size={12} color={GOLD} />
              <Text style={styles.modalMetaText}>{selectedLesson.xp} XP</Text>
            </View>
          </View>

          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Challenge Prompt</Text>
            <Text style={styles.detailText}>{selectedLesson.prompt}</Text>
          </View>

          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Objective</Text>
            <Text style={styles.detailText}>{selectedLesson.objective}</Text>
          </View>

          <View style={styles.detailCard}>
            <Text style={styles.detailLabel}>Deliverable</Text>
            <Text style={styles.detailText}>
              {selectedLesson.deliverable}
            </Text>
          </View>

          {selectedLesson.bonusNote ? (
            <View style={[styles.detailCard, styles.detailCardSoft]}>
              <Text style={styles.detailLabel}>Bonus Note</Text>
              <Text style={styles.detailText}>
                {selectedLesson.bonusNote}
              </Text>
            </View>
          ) : null}

          {selectedLesson.missionType ? (
            <View style={[styles.detailCard, styles.detailCardBlue]}>
              <Text style={styles.detailLabel}>
                {missionLabel(selectedLesson.missionType)}
              </Text>
              <Text style={styles.detailText}>
                This lesson is part of a collaboration push. Every now and
                then, users should be nudged to meet someone in their city
                group chat, collaborate remotely, or team up with someone from
                a different discipline.
              </Text>
            </View>
          ) : null}

          <View style={styles.rulesCard}>
            <Text style={styles.rulesTitle}>Rules</Text>

            {selectedLesson.constraints.map((rule, i) => (
              <View key={`${selectedLesson.id}-${i}`} style={styles.ruleRow}>
                <Ionicons name="diamond-outline" size={12} color={GOLD} />
                <Text style={styles.ruleText}>{rule}</Text>
              </View>
            ))}
          </View>
        </ScrollView>

        <View style={styles.modalActions}>
          <TouchableOpacity
            style={[styles.modalButton, styles.modalGhostButton]}
            onPress={() => setSelectedLesson(null)}
            activeOpacity={0.9}
          >
            <Text style={styles.modalGhostText}>Close</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.modalButton, styles.modalGoldButton]}
            onPress={() => {
              if (!selectedLesson) return;

              if (completedSet.has(selectedLesson.step)) {
                setSelectedLesson(null);
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
                lessonPrompt: selectedLesson.prompt,
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
              color={BG}
            />
            <Text style={styles.modalGoldText}>
              {completedSet.has(selectedLesson.step)
                ? 'Completed'
                : !hasProAccess
                  ? 'Unlock with Pro'
                  : lessonNeedsSurgery
                    ? 'Unlock'
                    : 'Upload Submission'}
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
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: BG,
  },

  scroll: {
    flex: 1,
  },

  scrollContent: {
    paddingBottom: 120,
  },

  pageWrap: {
  width: '100%',
  maxWidth: 1180,
  alignSelf: 'center',
  paddingHorizontal: 24,
  paddingTop: 46,
},
  heroBlock: {
  alignItems: 'center',
  justifyContent: 'center',
  marginBottom: 10,
},

  eyebrow: {
  color: GOLD,
  fontSize: 11,
  letterSpacing: 3,
  textTransform: 'uppercase',
  marginBottom: 12,
  fontFamily: SYSTEM_SANS,
  fontWeight: '700',
  opacity: 0.95,
  textAlign: 'center',
},

 pageTitle: {
  color: IVORY,
  fontSize: 42,
  fontWeight: '800',
  letterSpacing: -1.2,
  lineHeight: 46,
  maxWidth: 760,
  textAlign: 'center',
},

  pageSubtitle: {
  color: '#B7AE9F',
  fontSize: 15,
  lineHeight: 24,
  marginTop: 14,
  marginBottom: 30,
  maxWidth: 720,
  fontWeight: '400',
  textAlign: 'center',
},

  mobileChipRow: {
  paddingRight: 6,
  gap: 8,
  paddingBottom: 14,
  paddingHorizontal: 2,
},

  mobileChip: {
  flexDirection: 'row',
  alignItems: 'center',
  gap: 8,
  backgroundColor: PANEL,
  borderWidth: 1,
  borderColor: BORDER,
  borderRadius: 999,
  paddingHorizontal: 14,
  paddingVertical: 10,
  marginRight: 10,
  shadowColor: '#000',
  shadowOpacity: 0.18,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 6 },
  elevation: 4,
},

  mobileChipActive: {
    backgroundColor: GOLD,
    borderColor: GOLD,
  },

  mobileChipText: {
    color: IVORY,
    fontSize: 13,
    fontWeight: '500',
  },

  mobileChipTextActive: {
    color: BG,
  },

  mainLayout: {
  flexDirection: 'row',
  gap: 24,
  marginTop: 6,
},

  mainLayoutMobile: {
    flexDirection: 'column',
  },

  sidebar: {
    width: 220,
    gap: 12,
  },

  sidebarItemWrap: {
    borderWidth: 1,
    borderRadius: 16,
    overflow: 'hidden',
  },

  chapterStack: {
  gap: 18,
},

chapterCard: {
  backgroundColor: '#09090C',
  borderRadius: 20,
  borderWidth: 1,
  borderColor: BORDER,
  padding: 18,
  gap: 16,
},

chapterCardCurrent: {
  borderColor: GOLD_BORDER,
  backgroundColor: '#0B0A08',
},

chapterCardCompleted: {
  borderColor: 'rgba(198,166,100,0.34)',
  backgroundColor: '#0E0C08',
},

chapterCardLocked: {
  opacity: 0.8,
},

chapterHeader: {
  flexDirection: 'row',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 14,
},

chapterHeaderText: {
  flex: 1,
},

chapterEyebrow: {
  color: GOLD,
  fontSize: 11,
  letterSpacing: 1.6,
  textTransform: 'uppercase',
  fontWeight: '700',
  marginBottom: 6,
},

chapterTitle: {
  color: IVORY,
  fontSize: 20,
  fontWeight: '700',
  lineHeight: 26,
},
mobileChipScroll: {
  marginBottom: 4,
},

chapterSubtitle: {
  color: MUTED,
  fontSize: 13,
  lineHeight: 20,
  marginTop: 6,
  maxWidth: 680,
},

chapterProgressWrap: {
  alignItems: 'flex-end',
},

chapterStatusPill: {
  backgroundColor: PANEL_2,
  borderRadius: 999,
  paddingHorizontal: 12,
  paddingVertical: 7,
  borderWidth: 1,
  borderColor: BORDER,
},

chapterStatusPillCompleted: {
  backgroundColor: GOLD_SOFT,
  borderColor: GOLD_BORDER,
},

chapterStatusPillLocked: {
  backgroundColor: PANEL_2,
  borderColor: BORDER_SOFT,
},

chapterStatusText: {
  color: IVORY,
  fontSize: 12,
  fontWeight: '700',
},

chapterStatusTextCompleted: {
  color: GOLD,
},

chapterStatusTextLocked: {
  color: MUTED_2,
},

chapterProgressTrack: {
  height: 8,
  backgroundColor: BORDER_SOFT,
  borderRadius: 999,
  overflow: 'hidden',
},

chapterProgressFill: {
  height: 8,
  backgroundColor: GOLD,
  borderRadius: 999,
},

chapterLockedBox: {
  minHeight: 84,
  borderRadius: 16,
  borderWidth: 1,
  borderColor: BORDER,
  backgroundColor: PANEL_2,
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  paddingHorizontal: 16,
},

chapterLockedText: {
  color: MUTED_2,
  fontSize: 13,
  fontWeight: '500',
},

  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 14,
    gap: 12,
  },

  sidebarIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: PANEL_2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  sidebarIconActive: {
    backgroundColor: GOLD,
  },

  sidebarTextWrap: {
    flex: 1,
  },

  sidebarTitle: {
    color: IVORY,
    fontSize: 14,
    fontWeight: '600',
  },

  sidebarTitleActive: {
    color: GOLD,
  },

  sidebarSubtitle: {
    color: MUTED_2,
    fontSize: 11,
    marginTop: 2,
  },

  sidebarProgressPill: {
    backgroundColor: PANEL_3,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
  },

  sidebarProgressText: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '600',
  },

  centerPanel: {
    flex: 1,
    gap: 18,
  },

  topSummary: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#0A0A0D',
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 14,
  },

  topSummaryMobile: {
  flexDirection: 'column',
  alignItems: 'stretch',
  padding: 14,
  gap: 12,
},

  topSummaryLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flexShrink: 1,
  },
topSummaryLeftMobile: {
  alignItems: 'center',
  gap: 10,
},
  activePathBadge: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: PANEL_2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activePathBadgeMobile: {
  width: 40,
  height: 40,
  borderRadius: 12,
},

  topSummaryTextWrap: {
    flexShrink: 1,
  },
  topSummaryTextWrapMobile: {
  flex: 1,
},

  topSummaryTitle: {
    color: IVORY,
    fontSize: 17,
    fontWeight: '700',
  },

  topSummaryTitleMobile: {
  fontSize: 16,
},

  topSummarySubtitle: {
    color: MUTED,
    fontSize: 12,
    marginTop: 2,
  },

  topSummarySubtitleMobile: {
  fontSize: 11,
  lineHeight: 16,
},

  summaryPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    gap: 10,
    flexShrink: 1,
  },
  summaryPillsRowMobile: {
  justifyContent: 'space-between',
  gap: 8,
},

  summaryPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: PANEL_2,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },
  summaryPillMobile: {
  width: '48%',
  paddingHorizontal: 10,
  paddingVertical: 9,
  borderRadius: 12,
  backgroundColor: '#121216',
},

  summaryPillText: {
    color: IVORY,
    fontSize: 11,
    fontWeight: '600',
  },
  summaryPillTextMobile: {
  fontSize: 10,
},

  currentMissionCard: {
    backgroundColor: '#0A0A0D',
    borderRadius: 18,
    padding: 20,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
  },

  currentMissionEyebrow: {
    color: GOLD,
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },

  currentMissionTitle: {
    color: IVORY,
    fontSize: 19,
    fontWeight: '700',
    lineHeight: 26,
  },

  proOnlyPill: {
    marginTop: 8,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: GOLD_SOFT,
    borderWidth: 1,
    borderColor: GOLD_BORDER,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
  },

  proOnlyPillText: {
    color: GOLD,
    fontSize: 12,
    fontFamily: SYSTEM_SANS,
    fontWeight: '700',
  },

  currentMissionText: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 21,
  },

  currentMissionMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 4,
  },

  currentMetaPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: PANEL_2,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },

  currentSurveyMetaPill: {
    borderWidth: 1,
    borderColor: PURPLE_SOFT,
  },

  currentMetaText: {
    color: IVORY,
    fontSize: 11,
    fontWeight: '600',
  },

  progressTrack: {
    height: 7,
    backgroundColor: BORDER_SOFT,
    borderRadius: 999,
    overflow: 'hidden',
    marginTop: 8,
  },

  progressFill: {
    height: 7,
    backgroundColor: GOLD,
    borderRadius: 999,
  },

  missionCard: {
    backgroundColor: PANEL,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 12,
  },

  missionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },

  missionBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: BLUE_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  missionTextWrap: {
    flex: 1,
  },

  missionEyebrow: {
    color: BLUE,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },

  missionTitle: {
    color: IVORY,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 2,
  },

  missionDescription: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
  },

  missionPillsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },

  missionPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: BLUE_SOFT,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },

  missionPillText: {
    color: IVORY,
    fontSize: 11,
    fontWeight: '600',
  },

  surveyGateCard: {
    backgroundColor: PANEL,
    borderRadius: 18,
    padding: 18,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 14,
  },

  surveyGateHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'flex-start',
  },

  surveyGateIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: PURPLE_SOFT,
    alignItems: 'center',
    justifyContent: 'center',
  },

  surveyGateTextWrap: {
    flex: 1,
  },

  surveyGateTitle: {
    color: IVORY,
    fontSize: 16,
    fontWeight: '700',
  },

  surveyGateText: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
    marginTop: 4,
  },

  surveyGateButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GOLD,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },

  surveyGateButtonText: {
    color: BG,
    fontSize: 12,
    fontWeight: '700',
  },

  treeCard: {
    marginTop: 6,
    backgroundColor: PANEL,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 30,
    paddingHorizontal: 16,
  },

  treeInner: {
    alignItems: 'center',
    gap: 28,
  },

  treeRow: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },

  treeNodeColumn: {
    alignItems: 'center',
    gap: 12,
  },

  lessonBubbleShadowWrap: {
    shadowOffset: { width: 0, height: 8 },
    shadowRadius: 18,
    elevation: 8,
  },

  lessonBubble: {
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },

  lessonInfoCard: {
    backgroundColor: PANEL_2,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: BORDER,
    alignItems: 'center',
    width: 168,
    minHeight: 82,
  },

  lessonInfoCardLocked: {
    opacity: 0.5,
  },

  treeStep: {
    fontSize: 11,
    color: MUTED_2,
    marginBottom: 5,
    fontWeight: '600',
  },

  treeBadgeRow: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
    alignItems: 'center',
  },

  treeKindPill: {
    backgroundColor: PANEL_3,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 999,
  },

  treeKindText: {
    fontSize: 10,
    color: GOLD,
    fontWeight: '700',
  },

  treeSurveyDot: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: '#17111E',
    alignItems: 'center',
    justifyContent: 'center',
  },

  treeMissionDot: {
    width: 20,
    height: 20,
    borderRadius: 999,
    backgroundColor: '#101826',
    alignItems: 'center',
    justifyContent: 'center',
  },

  treeTitle: {
    color: IVORY,
    fontSize: 12,
    textAlign: 'center',
    lineHeight: 17,
    fontWeight: '600',
  },

  lockedText: {
    color: MUTED_2,
  },

  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.72)',
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
    backgroundColor: PANEL,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: BORDER,
    overflow: 'hidden',
  },

  surveyModalCard: {
    maxWidth: 700,
  },

  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 20,
    borderBottomWidth: 1,
    borderColor: BORDER,
    gap: 16,
  },

  modalHeaderLeft: {
    flexDirection: 'row',
    gap: 14,
    flex: 1,
  },

  modalIconCircle: {
    width: 46,
    height: 46,
    borderRadius: 14,
    backgroundColor: PANEL_2,
    alignItems: 'center',
    justifyContent: 'center',
  },

  surveyModalIconCircle: {
    backgroundColor: PURPLE_SOFT,
  },

  modalTitleWrap: {
    flex: 1,
  },

  modalEyebrow: {
    color: MUTED,
    fontSize: 11,
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginBottom: 4,
  },

  modalTitle: {
    color: IVORY,
    fontSize: 22,
    fontWeight: '700',
    lineHeight: 28,
  },

  modalMini: {
    color: MUTED_2,
    fontSize: 12,
    marginTop: 4,
  },

  modalClose: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: PANEL_2,
  },

  modalScroll: {
    maxHeight: 470,
  },

  modalScrollContent: {
    padding: 20,
    gap: 14,
  },

  modalDescription: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 22,
    paddingHorizontal: 20,
    paddingTop: 18,
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
    backgroundColor: PANEL_2,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
  },

  modalMetaText: {
    color: IVORY,
    fontSize: 11,
    fontWeight: '600',
  },

  modalMetaLocked: {
    borderWidth: 1,
    borderColor: 'rgba(180,140,255,0.22)',
  },

  modalMetaDone: {
    borderWidth: 1,
    borderColor: 'rgba(71,214,111,0.24)',
  },

  lockCard: {
    marginHorizontal: 20,
    marginTop: 14,
    backgroundColor: '#15111B',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(180,140,255,0.22)',
    padding: 16,
    gap: 10,
  },

  lockCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },

  lockCardTitle: {
    color: IVORY,
    fontSize: 15,
    fontWeight: '700',
  },

  lockCardText: {
    color: MUTED,
    fontSize: 13,
    lineHeight: 20,
  },

  lockCardButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GOLD,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
  },

  lockCardButtonText: {
    color: BG,
    fontSize: 12,
    fontWeight: '700',
  },

  detailCard: {
    backgroundColor: PANEL_2,
    borderRadius: 14,
    padding: 15,
    borderWidth: 1,
    borderColor: BORDER,
  },

  detailCardSoft: {
    backgroundColor: '#17140F',
    borderColor: GOLD_BORDER,
  },

  detailCardBlue: {
    backgroundColor: '#0F1520',
    borderColor: 'rgba(107,167,255,0.22)',
  },

  detailLabel: {
    color: GOLD,
    fontSize: 11,
    marginBottom: 7,
    letterSpacing: 1,
    textTransform: 'uppercase',
    fontWeight: '700',
  },

  detailText: {
    color: IVORY,
    fontSize: 13,
    lineHeight: 20,
  },

  rulesCard: {
    backgroundColor: PANEL_2,
    borderRadius: 14,
    padding: 15,
    borderWidth: 1,
    borderColor: BORDER,
  },

  rulesTitle: {
    color: GOLD,
    fontSize: 12,
    marginBottom: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  ruleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 8,
  },

  ruleText: {
    color: IVORY,
    fontSize: 12,
    flex: 1,
    lineHeight: 18,
  },

  surveyProgressTrack: {
    height: 8,
    backgroundColor: BORDER_SOFT,
    borderRadius: 999,
    overflow: 'hidden',
    marginHorizontal: 20,
    marginTop: 14,
  },

  surveyProgressFill: {
    height: 8,
    backgroundColor: PURPLE,
    borderRadius: 999,
  },

  surveyCountText: {
    color: MUTED,
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
    backgroundColor: PANEL_2,
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: BORDER,
    gap: 10,
  },

  surveyFilmCardDone: {
    borderColor: 'rgba(71,214,111,0.28)',
    backgroundColor: '#101712',
  },

  surveyFilmHeader: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
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
    color: IVORY,
    fontSize: 15,
    fontWeight: '700',
  },

  surveyFilmMeta: {
    color: MUTED,
    fontSize: 12,
    marginTop: 2,
  },

  surveyFilmHook: {
    color: IVORY,
    fontSize: 13,
    lineHeight: 19,
  },

  feedbackHintCard: {
    backgroundColor: PANEL_3,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: BORDER_SOFT,
  },

  feedbackHintTitle: {
    color: GOLD,
    fontSize: 11,
    fontWeight: '700',
    marginBottom: 5,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },

  feedbackHintText: {
    color: MUTED,
    fontSize: 12,
    lineHeight: 18,
  },

  feedbackButton: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: PANEL_3,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: BORDER,
  },

  feedbackButtonDone: {
    backgroundColor: GREEN,
    borderColor: GREEN,
  },

  feedbackButtonText: {
    color: IVORY,
    fontSize: 12,
    fontWeight: '700',
  },

  feedbackButtonTextDone: {
    color: BG,
  },

  modalActions: {
    flexDirection: 'row',
    gap: 12,
    padding: 20,
    borderTopWidth: 1,
    borderColor: BORDER,
    backgroundColor: PANEL,
  },

  modalButton: {
    flex: 1,
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 7,
    borderRadius: 14,
    paddingHorizontal: 12,
  },

  modalGhostButton: {
    backgroundColor: PANEL_2,
  },

  modalGhostText: {
    color: IVORY,
    fontWeight: '600',
    fontSize: 13,
  },

  modalGoldButton: {
    backgroundColor: GOLD,
  },

  modalGoldText: {
    color: BG,
    fontWeight: '700',
    fontSize: 13,
  },

  modalDisabledButton: {
    backgroundColor: PANEL_2,
    borderWidth: 1,
    borderColor: BORDER,
  },

  modalDisabledText: {
    color: MUTED,
  },
});
