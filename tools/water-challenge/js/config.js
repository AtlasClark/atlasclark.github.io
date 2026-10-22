/* Water Challenge (web) - constants: rules, tunables and the on-disk contract
   (FORMAT_REV, UTF-16 LE + BOM JSON, unknown fields kept). */

export const REV         = "rev 1.26.1";
export const APP_VERSION = "web 1.26.1";   /* stamped as writerVersion */
/* Every file is written at FORMAT_REV. A file stamped higher came from a newer
   build, and the page asks for a reload. */
export const FORMAT_REV    = 22;
/* Every field the page understands. Anything else in a file is kept as-is. */
export const KNOWN_FIELDS = ["name", "color", "goal", "dayGoals", "away", "created", "equippedPet",
  "petRollDay", "pets", "graves", "graveDay", "lastRoll", "prevRoll", "rollKind", "rollWasNew",
  "deadKind", "tokensSpent", "rerollDay", "rollLog", "graveLog", "spends",
  "writerRev", "writerVersion", "writerUser", "writtenAt", "entries"];

/* ---- the token shop ----
   One token is worth one daily roll, so a pet's price is 1 / (chance of rolling
   that exact species): Common 8 share 62.5%, Uncommon 7 share 20.8%, and so on. */
export const SHOP_PRICES  = [13, 35, 50, 80, 100];   /* by PET_BINS index */
/* Passing the cap drowns a pet and pays this many tokens, for days from CAP_BONUS_SINCE.
   Computed from each day's total, like goal-day tokens, so an undo takes it back. */
export const CAP_BONUS       = 5;
export const CAP_BONUS_SINCE = "2026-10-13";
export const REROLL_COST  = 1;
export const PLINKO_COST  = 1;
export const PLINKO_ROWS  = 10;
/* Slot -> PET_BINS index, left to right. Every peg is a fair 50/50 bounce, so the
   ball's path decides the slot (slot k of n has C(rows, k) / 2^rows): with 10 rows,
   Common 65.6%, Uncommon 23.4%, Rare 8.8%, Epic 1.95%, ??? 0.20%. */
export const CHEST = -1;                     /* a slot that is the Community Chest, not a rarity */
export const PLINKO_SLOTS = [4, 3, 2, 1, 0, CHEST, 0, 1, 2, 3, 4];
/* The centre cup: the drop's token goes into the chest, then (if the chest held
   anything before) this chance to win all of it. */
export const CHEST_CHANCE = 0.05;
export const PLINKO_ROW_SECS = 0.26;
export const LIVE_SUBDIR  = "_live";       /* drops shared with every open shop */
export const LIVE_POLL_MS = 1000;
export const LIVE_KEEP_MS = 120000;        /* drop files older than this are cleared */
export const LIVE_SHOW_MS = 9000;          /* a drop seen later than this shows as a result only */

/* ---- files ---- */
export const SETTINGS_FILE  = "_settings.json";
export const REMOVED_SUBDIR = "_removed";
/* Pet art for this folder only, saved there by the Pet Studio for testing. While it
   is there it replaces the site's pets/pets.json; delete it to go back. */
export const FOLDER_PETS_FILE = "_pets.json";
/* The first page to connect each day copies every .json into _backup/YYYY-MM-DD/,
   before anything is written that day. Older days are cleared after this many. */
export const BACKUP_SUBDIR    = "_backup";
export const BACKUP_KEEP_DAYS = 14;

/* ---- updates ----
   Every file the page is made of. When a new version is out, these are re-fetched
   past the browser cache before reloading, so old and new modules never mix. */
export const SITE_FILES = ["./", "app.css",
  "js/app.js", "js/art.js", "js/bottle.js", "js/config.js", "js/glass.js", "js/guard.js", "js/live.js", "js/model.js", "js/cosmetics.js", "js/styleui.js", "js/pen1art.js", "js/pen2art.js", "js/propart.js", "js/petdefs.js",
  "js/pets.js", "js/plinko.js", "js/radial.js", "js/reveal.js", "js/shop.js", "js/shopui.js", "js/store.js", "js/ui.js", "js/util.js", "pets/pets.json"];
export const VERSION_CHECK_MS = 300000;

/* ---- goals (fallbacks; live values come from _settings.json) ---- */
export const GOAL_OZ           = 128;
/* The heading and the line above it, until a folder sets its own (_settings.json
   "title" / "tagline", written only when set). */
/* Holiday hats: from HOLIDAY_SPAN days before to HOLIDAY_SPAN days after each date,
   these replace the crown (goal met) and the jester hat (led, under goal) on pets and
   in every hat icon. Drawings in propart.js (HOLIDAY_ART). */
export const HOLIDAY_HATS = [
  { name: "Halloween", m: 10, d: 31, crown: "witch",     jester: "pumpkin" },
  { name: "Christmas", m: 12, d: 25, crown: "santa",     jester: "elf" },
  { name: "New Year",  m: 1,  d: 1,  crown: "partyGold", jester: "partyStripe" }
];
export const HOLIDAY_SPAN = 1;
/* Shells: the Style shop's own currency, apart from goal tokens. Each day a person
   logs any water earns shells: 1 the first day, one more for each day in a row, up to
   SHELL_MAX a day; a day without a pour starts again at 1. Counted from the entries
   themselves, from SHELLS_SINCE on (no backlog). Spends of SHELL_KINDS are paid in
   shells, never tokens. */
export const SHELL_MAX         = 5;
export const SHELLS_SINCE      = "2026-10-21";
export const SHELL_KINDS       = ["cosmetic", "paint"];
export const DEFAULT_TITLE     = "Water Challenge";
export const DEFAULT_TAGLINE   = "Drink responsibly. Brag irresponsibly.";
export const TITLE_MAX         = 40;
export const TAGLINE_MAX       = 80;
export const ANNUAL_GOAL_OZ    = 20800;
export const YEAR_DAYS         = 365;
export const LEGACY_FLAT_UNTIL = "2026-09-14";
export const GOAL_EPSILON      = 0.0001;
export const SCORE_TOP         = 2;
export const RATIO_EPSILON     = 0.0005;
export const TIE_EPSILON       = 0.05;

export const QUICK_SIZES    = [8, 12, 16.9, 20, 24, 32, 40, 64];
export const DEFAULT_AMOUNT = 8;
/* "by" values that are not people, so never offered as a username */
export const NOT_USERS = ["", "?", "unknown", "hidrate", "test"];

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

/* ---- pets ---- */
export const EGG_ENABLED = true;
/* The second pen (format 22 only): kinds PEN2_FIRST .. PEN2_FIRST + 24, opened for
   good the first time all 25 first-pen pets are alive at once. Kind PEN2_FIRST + i
   has first-pen kind i's rarity; drawings in js/pen2art.js. */
export const PEN2_FIRST = 27;
export const PEN2_NAMES = [
  "Tadpole","Starfish","Clam","Dolphin","Manta Ray","Old Boot",
  "Shrimp","Guppy","Sea Urchin","Hermit Crab","Koi",
  "Seahorse","Lobster","Squid","Puffin","Walrus",
  "Orca","Hammerhead","Anglerfish","Manatee","Polar Bear",
  "Kraken","Leafy Sea Dragon","Coelacanth","Kelpie"
];
export const PET_NAMES = [
  "Duck","Frog","Turtle","Whale","Octopus","???",
  "Goldfish","Crab","Snail","Penguin","Seal",
  "Swan","Jellyfish","Beaver","Hippo","Pufferfish",
  "Shark","Alligator","Flamingo","Platypus","Otter",
  "Narwhal","Axolotl","Nessie","Cat in a Ring",
  "Homunculus","Dragon",
  ...PEN2_NAMES
];
/* PET_NAMES can be renamed by pets/pets.json; these never change (icon hues use them). */
export const PET_BASE_NAMES = PET_NAMES.slice();
export const PET_BINS = [
  { name: "Common",   weight: 60, kinds: [0, 1, 2, 6, 7, 8, 9, 10] },
  { name: "Uncommon", weight: 20, kinds: [3, 4, 11, 12, 13, 14, 15] },
  { name: "Rare",     weight: 10, kinds: [16, 17, 18, 19, 20] },
  { name: "Epic",     weight: 5,  kinds: [21, 22, 23, 24] },
  { name: "???",      weight: 1,  kinds: [5] }
];
export const PEN2_BINS = PET_BINS.map(b => ({ name: b.name, weight: b.weight, kinds: b.kinds.map(k => k + PEN2_FIRST) }));
export const PET_COUNT        = 25;                /* per pen */
export const HOMUNCULUS_KIND  = 25;
export const MYSTERY_KIND     = 26;
export const MYSTERY_CHANCE   = 0.006;
export const PET_MAX          = PEN2_FIRST + 25;   /* every kind: two pens, the reward, the dragon */
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

/* ---- bottle sync (js/bottle.js) ---- */
export const HIDRATE_TAG       = "hidrate";     /* "by" on bottle entries */
export const HIDRATE_LABEL     = "bottle";      /* how the activity list shows it */
export const BOTTLE_USER       = "rclark";      /* the one username that sees and runs the sync */
export const BOTTLE_BUCKET_MIN = 5;             /* sips grouped into 5-minute entries */
export const BOTTLE_SIP_LIMIT  = 500;
export const BOTTLE_TIMEOUT_MS = 20000;

/* ---- locks (sidecar .lock files shared by every page on the folder) ---- */
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
/* Pet motion. Applied around the drawing (position, facing, tilt, tint), never
   inside the shapes, so it survives new pet graphics. Times in seconds. */
export const PET_MOTION     = true;
/* Pet size and swim range. r = min(glass width x PET_R_SHARE, PET_R_MAX), so a glass
   is 3.9 to 4.1 r wide. A pet swims SWIM_RANGE of the width either side of the middle,
   less when its drawing reaches further than that leaves room for, and always keeps
   WALL_GAP_R from the walls, facing either way. The Pet Studio draws these limits. */
export const PET_R_SHARE    = 0.26;
export const PET_R_MAX      = 30;
export const SWIM_RANGE     = 0.21;
export const WALL_GAP_R     = 0.06;
/* A drawn pet can also set its own swim range ("range" in pets.json, 0 to 1 of
   SWIM_RANGE) so a big creature wanders less; the reach limit still applies. */

/* The narrowest glass in pet radii: half its width, and how far a drawing can reach
   and still swim a given share of the range. The Pet Studio draws these. */
export function narrowCup() {
  const W = Math.round(CARD_MIN * GLASS_W_RATIO) - 8, r = Math.min(W * PET_R_SHARE, PET_R_MAX), wr = W / r;
  return { half: wr / 2, swim: SWIM_RANGE * wr, reachFor: range => wr / 2 - range * SWIM_RANGE * wr - WALL_GAP_R };
}
export const DIVE_EVERY     = [25, 60];   /* random gap between dives */
export const HOP_EVERY      = [9, 24];    /* random gap between small hops */
/* Visits: now and then a pet leaps to the glass beside it (same row, left or right),
   plays there, then leaps home. Only on screen: nothing is saved, and each screen
   picks its own visits, since every screen lays the glasses out its own way. */
export const VISIT_EVERY     = [30, 90];  /* seconds between a pet's chances to go */
export const VISIT_CHANCE    = 0.08;      /* the chance each time: about one visit per 12 minutes */
export const VISIT_STAY      = [20, 45];  /* seconds it stays */
export const VISIT_JUMP_SECS = 1.15;      /* the leap between glasses */
export const VISIT_PLAY      = 0.3;       /* dive and hop gaps scale by this for guest and host */
export const VISIT_MIN_LEVEL = 0.15;      /* both glasses need this much water */
/* A dive is one continuous path: down and forward, back up, out of the water on a
   gravity arc at the speed it rose, and a splash on landing. */
export const DIVE_UNDER_SECS = 2.3;       /* time under the surface */
export const DIVE_DEPTH_R   = 3.2;        /* deepest a dive goes, in pet radii (and 60% of the water) */
export const DIVE_FORWARD_R = 1.6;        /* how far it swims forward over a dive, in pet radii */
export const GRAVITY_R      = 14;         /* pet radii per second squared, for jumps */
export const BREACH_R       = 1.15;       /* highest a jump out of the water goes, in pet radii */
export const BREACH_MIN_R   = 0.5;        /* a shallow dive still kicks out at least this high */
export const HOP_R          = 0.55;       /* small hop height, in pet radii */
export const TALLEST_PET_R  = 2.1;        /* highest point of any pet above its waterline (dragon horns) */
export const HOP_SECS       = 0.7;
/* A dive needs this much water under the surface, in pet radii, both now and where
   the level is heading. Below SURFACE_DEPTH_R mid-dive, the pet turns back up. */
export const DIVE_MIN_DEPTH_R = 2.4;
export const SURFACE_DEPTH_R  = 1.2;
export const TURN_EASE      = 0.16;       /* how fast a pet turns to face its drift */
export const TURN_SKIP_CHANCE = 0.10;     /* at a side, the chance it keeps facing the way it was */
export const UNDERWATER_TINT = 0.42;      /* water colour over anything below the surface */

/* Pour: a stream falls into the glass when someone logs water. The level waits for
   the stream to land, then rises at POUR_EASE while it flows. */
export const POUR_SECS_MIN  = 0.8;
export const POUR_SECS_MAX  = 1.7;        /* reached at POUR_OZ_FULL or more */
export const POUR_OZ_FULL   = 48;
export const POUR_LAND      = 0.15;       /* share of the pour before the stream reaches the water */
export const POUR_TAIL      = 0.80;       /* share after which the stream's tail falls */
export const POUR_EASE      = 0.05;

/* Unlock: a reveal card on the machine that made the roll, then the pet drops in. */
export const DROP_SECS      = 0.9;
export const REVEAL_SPIN    = [70, 70, 80, 90, 110, 140, 180, 240, 330];   /* ms between rarity flashes */
export const REVEAL_HOLD_MS = 3200;       /* how long the revealed card stays */
export const SPLASH_RINGS   = 3;
export const RING_GROWTH    = 2.3;
export const RING_FADE      = 0.915;

/* Card layout. Each row holds as many cards as stay at least CARD_COMFORT wide (up to
   MAX_COLS); the rest wrap to the next row, centred. Widening the screen adds one
   column at a time (8 people: 4 + 4, 5 + 3, 6 + 2, 7 + 1, 8). The glass scales with the card.
   The glasses may use the screen's full width, up to WRAP_MAX, past the page's own
   1400 px column, so a big screen fits one row of up to MAX_COLS. */
export const CARD_MAX      = 212;
export const CARD_COMFORT  = 144;
export const CARD_MIN      = 100;
export const CARD_STEP     = 4;         /* sizes snap to this, so a resize rebuilds less often */
export const GLASS_W_RATIO = 132 / 188;
export const GLASS_H_RATIO = 246 / 188;
export const CARD_GAP      = 10;
export const MAX_COLS      = 8;
export const COMPACT_UNDER = 140;
export const WRAP_MAX      = 1880;
export const SHELL_PAD     = 18;
