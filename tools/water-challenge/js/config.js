/* Atlas Water Challenge (web) - constants.
   Rules and tunables are ported 1:1 from Atlas_Water_Challenge_R55.hta. The on-disk
   contract (FORMAT_REV 21, UTF-16 LE + BOM) must stay identical while R55 runs on the
   share: R55 deletes any field it does not know on its next write. */

export const REV         = "rev 1.0.0";
export const APP_VERSION = "web 1.0.0";   /* stamped as writerVersion */
export const FORMAT_REV  = 21;
export const PEER_VERSIONS = ["r55"];     /* HTA builds that share format 21 without drift */

/* ---- files ---- */
export const SETTINGS_FILE  = "_settings.json";
export const REMOVED_SUBDIR = "_removed";

/* ---- goals (fallbacks; live values come from _settings.json) ---- */
export const GOAL_OZ           = 128;
export const ANNUAL_GOAL_OZ    = 20800;
export const YEAR_DAYS         = 365;
export const LEGACY_FLAT_UNTIL = "2026-09-14";
export const GOAL_EPSILON      = 0.0001;
export const SCORE_TOP         = 2;
export const RATIO_EPSILON     = 0.0005;
export const TIE_EPSILON       = 0.05;

export const QUICK_SIZES    = [8, 12, 16.9, 20, 24, 32, 40, 64];
export const DEFAULT_AMOUNT = 8;

export const POLL_MS        = 6000;
export const POLL_HIDDEN_MS = 30000;
export const ACTIVITY_LIMIT = 80;
export const CHART_DAYS     = 28;

/* ---- streaks ---- */
export const STREAK_MODE           = "both";  /* "both" | "wins" | "goal" | "best" */
export const STREAK_TIE_RULE       = "win";   /* "win" | "hold" | "loss" */
export const STREAK_SKIP_IDLE_DAYS = true;
export const STREAK_MAX_IDLE_RUN   = 4;
export const STREAK_MAX_LOOKBACK   = 180;

export const CARD_ORDER   = "rank";
export const BUTTON_ORDER = "name";

/* ---- pets ---- */
export const EGG_ENABLED = true;
export const PET_NAMES = [
  "Duck","Frog","Turtle","Whale","Octopus","???",
  "Goldfish","Crab","Snail","Penguin","Seal",
  "Swan","Jellyfish","Beaver","Hippo","Pufferfish",
  "Shark","Alligator","Flamingo","Platypus","Otter",
  "Narwhal","Axolotl","Nessie","Cat in a Ring",
  "Homunculus","Dragon"
];
export const PET_BINS = [
  { name: "Common",   weight: 60, kinds: [0, 1, 2, 6, 7, 8, 9, 10] },
  { name: "Uncommon", weight: 20, kinds: [3, 4, 11, 12, 13, 14, 15] },
  { name: "Rare",     weight: 10, kinds: [16, 17, 18, 19, 20] },
  { name: "Epic",     weight: 5,  kinds: [21, 22, 23, 24] },
  { name: "???",      weight: 1,  kinds: [5] }
];
export const PET_COUNT        = 25;
export const HOMUNCULUS_KIND  = 25;
export const MYSTERY_KIND     = 26;
export const MYSTERY_CHANCE   = 0.006;
export const PET_MAX          = 27;
export const HOMUNCULUS_STYLE = "ball";
export const PET_NO_PET       = -1;
export const JOKE_KIND        = 5;
export const GRAVE_LINES = [
  "You did this to me.",
  "I trusted you.",
  "I hope you're hydrated now.",
  "Was the extra glass worth it?",
  "I hate you.",
  "Tell my family I went quickly.",
  "This is on you, and you know it.",
  "I would not have done this to you."
];

/* ---- legacy bottle entries (sync removed; history still shows them) ---- */
export const HIDRATE_TAG   = "hidrate";
export const HIDRATE_LABEL = "bottle";

/* ---- locks (interoperate with the HTA's sidecar .lock files) ---- */
export const LOCK_RETRIES  = 12;
export const LOCK_WAIT_MS  = 70;
export const LOCK_STALE_MS = 15000;

/* ---- colours ---- */
export const PARTICIPANT_COLORS = [
  "#60a5fa","#38bdf8","#22d3ee","#2dd4bf",
  "#14b8a6","#34d399","#4ade80","#a3e635",
  "#f472b6","#e879f9","#c084fc","#a78bfa",
  "#818cf8","#fb923c","#f87171","#fb7185"
];
export const OVERFILL_COLOR = "#facc15";
export const DANGER_COLOR   = "#8e1420";

/* ---- masking past the cap ---- */
export const MASK_STYLE = "symbols";   /* "letters" | "symbols" */
export const MASK_MS    = 380;
export const MASK_CHURN = 0.45;
export const MASK_POOL  = "abcdefghijkmnopqrstuvwxyz";

/* ---- water animation ---- */
export const ANIM_FPS       = 60;
export const IDLE_FPS       = 30;
export const DUCK_SINK_SECS = 2.2;
export const WAVE_STEP_BIG  = 4;
export const WAVE_STEP_SMALL = 6;
export const GHOST_MIN_W    = 100;
export const LEVEL_EASE     = 0.10;
export const AMBIENT_AMP    = 1.5;
export const FILL_AMP       = 9;
export const SPLASH_AMP     = 15;
export const AMP_DECAY      = 0.945;
export const WAVE_SPEED     = 0.06;
export const WAVE_K1        = 0.055;
export const WAVE_K2        = 0.031;
export const SURFACE_BAND   = 3;
export const BUBBLES_PER_GLASS = 7;
export const BUBBLE_MIN_R   = 1.6;
export const BUBBLE_MAX_R   = 4.0;
export const BUBBLE_SPEED_MIN = 0.30;
export const BUBBLE_SPEED_MAX = 0.85;
export const BUBBLE_WOBBLE  = 2.4;
export const SPLASH_RINGS   = 3;
export const RING_GROWTH    = 2.3;
export const RING_FADE      = 0.915;

/* Card sizes, largest first; the layout picks the largest that fits. */
export const CARD_TIERS = [
  { card: 188, gw: 132, gh: 246 },
  { card: 164, gw: 116, gh: 216 },
  { card: 142, gw: 100, gh: 186 },
  { card: 124, gw:  88, gh: 164 },
  { card: 108, gw:  76, gh: 142 }
];
export const CARD_GAP      = 10;
export const MAX_COLS      = 6;
export const COMPACT_UNDER = 140;
export const WRAP_MAX      = 1400;
export const SHELL_PAD     = 18;
