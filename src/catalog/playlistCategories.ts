import type { CatalogItem } from "./types";

export interface PlaylistCategoryDefinition {
  id: string;
  label: string;
  shortLabel?: string;
  description: string;
  icon: string;
  keywords: string[];
}

export const DEFAULT_PLAYLIST_CATEGORY_ID = "editors-choice";
export const RECENT_PLAYLIST_CATEGORY_ID = "recent";
export const COMMUNITY_PLAYLIST_CATEGORY_ID = "community";

export const PLAYLIST_CATEGORIES: PlaylistCategoryDefinition[] = [
  {
    id: "ambience",
    label: "Ambience",
    description: "Ambient sounds for focus, calm, sleep, and deep work.",
    icon: "cloud-rain",
    keywords: [
      "ambience", "ambient sound", "ambient sounds", "ambient soundscape", "soundscape", "environmental sound",
      "environmental sounds", "field recording", "field recordings", "nature sound", "nature sounds", "nature ambience",
      "rain", "rainfall", "thunder", "thunderstorm", "storm", "forest", "jungle sounds", "jungle ambience", "birds", "birdsong",
      "ocean", "sea", "waves", "beach waves", "beach ambience", "river", "creek", "stream", "waterfall", "water sounds", "wind",
      "fireplace", "campfire", "crackling fire", "space ambience", "cosmic ambience", "cosmos", "galaxy",
      "frequency", "frequencies", "hz", "hertz", "binaural", "binaural beats", "solfeggio", "healing frequency",
      "white noise", "brown noise", "pink noise", "green noise", "drone", "liminal ambience", "meditation frequency"
    ]
  },
  {
    id: "jazz-blues",
    label: "Jazz & Blues",
    description: "Warm jazz, blues, soul, and cafe sessions.",
    icon: "music-4",
    keywords: [
      "jazz", "blues", "blue", "sax", "saxophone", "trumpet", "bebop", "swing", "smooth jazz",
      "cafe jazz", "coffee jazz", "lounge jazz", "jazzhop", "jazz hiphop", "jazz hip hop", "delta blues",
      "electric blues", "chicago blues", "soul jazz", "soul blues", "soul music", "classic soul", "southern soul",
      "northern soul", "neo soul", "neosoul", "motown", "stax", "quiet storm", "funk soul", "r and b soul"
    ]
  },
  {
    id: "orchestra",
    label: "Orchestra",
    description: "Classical and orchestral pieces for calm, drama, and focus.",
    icon: "audio-lines",
    keywords: [
      "orchestra", "orchestral", "symphony", "symphonic", "chamber", "classical", "concerto", "sonata",
      "quartet", "string quartet", "strings", "violin", "viola", "cello", "cello suite", "choir", "choral",
      "ensemble", "philharmonic", "string ensemble", "violin concerto", "cello concerto", "requiem", "opera"
    ]
  },
  {
    id: "piano",
    label: "Piano",
    description: "Soft piano playlists for focus, reading, and sleep.",
    icon: "piano",
    keywords: [
      "piano", "solo piano", "peaceful piano", "soft piano", "study piano", "sleep piano", "classical piano",
      "piano concerto", "piano sonata", "piano cover", "piano covers", "pianist", "pianists"
    ]
  },
  {
    id: "movies-games",
    label: "Movies/Games",
    description: "Soundtracks from films, games, anime, and TV.",
    icon: "clapperboard",
    keywords: [
      "movie", "movies", "film", "film score", "movie soundtrack", "soundtrack", "soundtracks", "ost", "anime",
      "original soundtrack", "official soundtrack", "original score", "movie score", "film soundtrack",
      "motion picture soundtrack", "cinema soundtrack", "cinema score", "tv soundtrack", "television soundtrack",
      "series soundtrack", "anime ost", "anime soundtrack", "anime op", "anime opening", "anime ending",
      "video game music", "game music", "game bgm", "game score", "vgm", "jrpg", "jrpg ost", "visual novel ost",
      "movie themes", "film themes", "game themes", "opening theme", "ending theme", "main theme",
      "ghibli", "studio ghibli", "zelda", "legend of zelda", "breath of the wild", "tears of the kingdom", "ocarina of time",
      "mario", "super mario", "minecraft", "c418", "final fantasy", "nobuo uematsu", "chrono trigger", "yasunori mitsuda",
      "nier", "persona", "kingdom hearts", "skyrim", "elder scrolls", "jeremy soule", "witcher", "lord of the rings",
      "lotr", "hobbit", "harry potter", "star wars", "john williams", "interstellar", "hans zimmer", "dune",
      "oppenheimer", "blade runner", "pirates of the caribbean", "jurassic park", "la la land", "cinema paradiso",
      "amelie", "titanic", "godfather", "halo", "god of war", "elden ring", "dark souls", "bloodborne", "mass effect",
      "hollow knight", "celeste", "undertale", "journey", "red dead redemption", "the last of us", "baldur's gate",
      "baldurs gate", "hades", "pokemon", "sonic", "metroid", "castlevania", "doom", "street fighter", "tekken",
      "naruto", "one piece", "attack on titan", "demon slayer", "kimetsu", "jujutsu kaisen", "death note",
      "cowboy bebop", "evangelion", "samurai champloo", "fullmetal alchemist", "steins gate", "your name", "suzume",
      "weathering with you", "violet evergarden", "hunter x hunter", "frieren", "made in abyss", "akira"
    ]
  },
  {
    id: "handpan-kalimba",
    label: "Handpan & Kalimba",
    shortLabel: "Handpan",
    description: "Gentle handpan and kalimba sounds for calm moments.",
    icon: "drum",
    keywords: [
      "handpan", "hand pan", "hang drum", "hangdrum", "hang", "pantam", "steel tongue drum", "tongue drum",
      "kalimba", "calimba", "mbira", "thumb piano", "sansula", "karimba"
    ]
  },
  {
    id: "house",
    label: "House",
    description: "Deep, funky, disco, and lounge house for a clean groove.",
    icon: "disc-3",
    keywords: [
      "house music", "house mix", "house playlist", "funky house", "disco house", "deep house", "soulful house",
      "chill house", "lounge house", "jazzy house", "classic house", "vocal house", "afro house", "latin house",
      "nu disco", "nu-disco", "disco", "disco groove", "groove house", "groovy house", "balearic", "balearic house",
      "defected", "glitterbox", "flavour trip", "flavor trip", "strictly rhythm", "masters at work", "maw records"
    ]
  },
  {
    id: "acoustic",
    label: "Acoustic",
    description: "Acoustic guitar, folk, country, and fingerstyle playlists.",
    icon: "guitar",
    keywords: [
      "guitar playlist", "instrumental guitar", "12 string guitar", "12string guitar", "acoustic guitar", "guitar acoustic", "solo guitar", "fingerstyle", "fingerstyle guitar",
      "fingerpicking", "nylon guitar", "classical guitar", "spanish guitar", "americana", "texas country",
      "country acoustic", "acoustic country", "outlaw country", "western acoustic", "bluegrass", "flatpicking",
      "banjo", "dobro", "pedal steel", "country folk", "folk guitar"
    ]
  },
  {
    id: "fantasy-folk",
    label: "Fantasy Folk",
    description: "Celtic, Nordic, medieval, tavern, and fantasy folk.",
    icon: "castle",
    keywords: [
      "fantasy folk", "medieval", "medieval folk", "middle ages", "renaissance", "tavern", "tavern music",
      "bard", "bardcore", "celtic", "gaelic", "nordic", "norse", "scandinavian", "viking", "viking music",
      "dnd", "dungeons and dragons", "tabletop rpg", "lute", "hurdy gurdy", "lyre", "harp", "bagpipe",
      "flute folk", "woodland folk", "elven", "dwarven", "shire music", "medieval tavern", "dungeon synth",
      "pagan folk", "dark folk", "wardruna", "heilung", "danheim", "faun", "omnium gatherum"
    ]
  },
  {
    id: "bossa",
    label: "Bossa",
    description: "Bossa, samba, tango, salsa, and soft Latin lounge.",
    icon: "sun",
    keywords: [
      "bossa", "samba", "samba bossa", "brazilian jazz", "brazilian lounge",
      "latin cafe", "latin jazz", "latin lounge", "tropical jazz", "salsa", "salsa lounge", "tango", "bolero",
      "rumba", "afro cuban", "cuban son", "son cubano", "bachata acoustic", "latin acoustic"
    ]
  },
  {
    id: "asia",
    label: "Asia",
    description: "Traditional Asian instruments and folk-inspired playlists.",
    icon: "flower-2",
    keywords: [
      "traditional chinese", "chinese traditional", "traditional japanese", "japanese traditional", "traditional korean",
      "korean traditional", "traditional vietnamese", "vietnamese traditional", "asian traditional", "guzheng", "gu zheng",
      "guqin", "koto", "erhu", "shamisen", "shakuhachi", "dizi", "pipa", "xiao", "hulusi", "dan bau",
      "đàn bầu", "dan tranh", "đàn tranh", "zither", "taiko", "gamelan", "sitar", "sarod", "bansuri",
      "tabla", "raga", "kodo", "silk road ensemble"
    ]
  },
  {
    id: "middle-east",
    label: "Middle East",
    description: "Arabic, Persian, Turkish, oud, ney, and desert moods.",
    icon: "moon",
    keywords: [
      "middle east", "middle eastern", "arabic traditional", "traditional arabic", "arabian traditional",
      "persian traditional", "traditional persian", "iranian traditional", "turkish traditional", "traditional turkish",
      "ottoman music", "anatolian", "egyptian traditional", "levantine", "moroccan traditional", "andalusian",
      "sufi", "oud", "qanun", "kanun", "ney", "darbuka", "duduk", "saz", "baglama", "tanbur", "riq",
      "maqam", "hijaz", "arabian oud", "persian santur", "middle eastern instrumental", "arabian desert music",
      "desert caravan"
    ]
  }
];

export const SPECIAL_PLAYLIST_CATEGORIES: PlaylistCategoryDefinition[] = [
  {
    id: DEFAULT_PLAYLIST_CATEGORY_ID,
    label: "Editor's Choice",
    shortLabel: "Editor's",
    description: "Curated playlists selected by the editors.",
    icon: "sparkles",
    keywords: ["editor's choice", "editors choice", "editor pick", "curator pick", "ai pick"]
  },
  {
    id: RECENT_PLAYLIST_CATEGORY_ID,
    label: "Recent",
    description: "Playlists and tracks you listened to recently.",
    icon: "history",
    keywords: ["recent", "recently played"]
  },
  {
    id: COMMUNITY_PLAYLIST_CATEGORY_ID,
    label: "Community",
    description: "Top picks gathered from every music category.",
    icon: "radio",
    keywords: ["community", "top playlists", "popular picks"]
  }
];

export const ALL_PLAYLIST_CATEGORIES: PlaylistCategoryDefinition[] = [
  ...SPECIAL_PLAYLIST_CATEGORIES,
  ...PLAYLIST_CATEGORIES
];

const categoryKeywordCache = new Map<string, string[]>();
const editorsChoiceCache = new WeakMap<CatalogItem, { fingerprint: string; value: boolean }>();
const categoryIdsCache = new WeakMap<CatalogItem, { fingerprint: string; ids: string[] }>();

const MOVIES_GAMES_CONTEXT_PATTERNS = [
  /\b(?:movie|movies|film|films|cinema|anime|tv|television|series)\s+(?:ost|osts|soundtrack|soundtracks|score|scores|theme|themes|music)\b/,
  /\b(?:ost|osts|soundtrack|soundtracks|score|scores|theme|themes|music)\s+(?:from|for|of)\s+(?:movie|movies|film|films|anime|game|games|tv|television|series)\b/,
  /\b(?:video\s+game|video\s+games|game|games|gaming|jrpg|rpg|visual\s+novel)\s+(?:ost|osts|soundtrack|soundtracks|score|scores|theme|themes|music|bgm)\b/,
  /\b(?:anime)\s+(?:op|ed|opening|ending|theme|themes|ost|soundtrack)\b/,
  /\b(?:motion\s+picture|original|official)\s+(?:soundtrack|score)\b/,
  /\b(?:vgm|game\s+bgm|anime\s+bgm)\b/
];

const CATEGORY_CURATION_SIGNALS: Record<string, string[]> = {
  ambience: [
    "432 hz", "528 hz", "639 hz", "741 hz", "852 hz", "963 hz", "binaural", "solfeggio", "rain", "forest",
    "ocean waves", "white noise", "brown noise", "pink noise", "nature sounds", "field recordings"
  ],
  "jazz-blues": [
    "miles davis", "john coltrane", "charlie parker", "duke ellington", "louis armstrong", "billie holiday",
    "ella fitzgerald", "nina simone", "bb king", "b b king", "muddy waters", "howlin wolf", "robert johnson",
    "aretha franklin", "otis redding", "marvin gaye", "stevie wonder", "al green", "etta james", "ray charles",
    "dangelo", "d angelo", "erykah badu", "jill scott", "sade"
  ],
  orchestra: [
    "bach", "mozart", "beethoven", "tchaikovsky", "vivaldi", "debussy", "brahms", "mahler", "stravinsky",
    "rachmaninoff", "yo yo ma", "hilary hahn", "itzhak perlman", "anne sophie mutter", "london symphony",
    "berlin philharmonic", "vienna philharmonic"
  ],
  piano: [
    "chopin", "ludovico einaudi", "yiruma", "nils frahm", "george winston", "joep beving", "keith jarrett",
    "glenn gould", "martha argerich", "lang lang", "yuja wang"
  ],
  "movies-games": [
    "the legend of zelda", "ocarina of time", "breath of the wild", "super mario", "minecraft", "final fantasy",
    "chrono trigger", "nier automata", "persona", "halo", "skyrim", "the witcher", "journey", "hollow knight",
    "celeste", "undertale", "red dead redemption", "the last of us", "baldurs gate", "baldur's gate", "elden ring",
    "studio ghibli", "joe hisaishi", "star wars", "john williams", "lord of the rings", "howard shore",
    "harry potter", "interstellar", "hans zimmer", "dune", "oppenheimer", "blade runner", "pirates of the caribbean",
    "jurassic park", "la la land", "amelie", "cinema paradiso", "the godfather", "naruto", "one piece",
    "attack on titan", "demon slayer", "jujutsu kaisen", "death note", "cowboy bebop", "evangelion",
    "samurai champloo", "fullmetal alchemist", "steins gate", "your name", "suzume", "violet evergarden", "frieren"
  ],
  "handpan-kalimba": [
    "handpan", "hang drum", "pantam", "steel tongue drum", "kalimba", "mbira", "thumb piano"
  ],
  house: [
    "flavour trip", "flavor trip", "defected", "glitterbox", "folamour", "purple disco machine", "kerri chandler",
    "moodymann", "masters at work", "louie vega", "kenny dope", "kaytranada", "todd terje", "groove culture",
    "toy tonics", "strictly rhythm"
  ],
  acoustic: [
    "tommy emmanuel", "andy mckee", "john fahey", "leo kottke", "willie nelson", "townes van zandt",
    "guy clark", "doc watson", "tony rice", "norman blake", "chet atkins"
  ],
  "fantasy-folk": [
    "wardruna", "heilung", "danheim", "faun", "skald", "eivor", "clannad", "loreena mckennitt",
    "the dubliners", "medieval baebes"
  ],
  bossa: [
    "antonio carlos jobim", "tom jobim", "joao gilberto", "joão gilberto", "astrud gilberto", "stan getz",
    "elis regina", "buena vista social club", "cesaria evora", "caetano veloso", "gilberto gil", "toquinho"
  ],
  asia: [
    "ravi shankar", "anoushka shankar", "ali akbar khan", "zakir hussain", "kitaro", "kodo", "yo yo ma silk road",
    "silk road ensemble", "wu man", "lei qiang", "yoshida brothers", "hifumi hachigaeshi"
  ],
  "middle-east": [
    "anouar brahem", "omar faruk tekbilek", "kayhan kalhor", "naseer shamma", "marcel khalife", "fairuz",
    "farid al atrash", "munir bashir", "hossam ramzy", "mercau mec"
  ]
};

const GENERIC_QUALITY_SIGNALS = [
  "official", "classic", "classics", "essential", "best of", "greatest", "definitive", "anthology", "collection",
  "complete", "remastered", "live at", "soundtrack", "ost"
];
const LOW_PRIORITY_SIGNALS = ["copy of", "random", "test", "free download", "sped up", "tiktok", "nightcore"];
const CATEGORY_MAINSTREAM_SIGNALS: Record<string, string[]> = {
  ambience: [
    "relaxing white noise", "melatonin studio", "spiritual moment", "music from the firmament",
    "jeffrey michael", "fireheart music", "mynoise", "headspace"
  ],
  "jazz-blues": [
    "miles davis", "john coltrane", "charlie parker", "duke ellington", "louis armstrong", "billie holiday",
    "ella fitzgerald", "nina simone", "bb king", "b b king", "muddy waters", "howlin wolf", "robert johnson",
    "aretha franklin", "otis redding", "marvin gaye", "stevie wonder", "al green", "etta james", "ray charles",
    "dangelo", "d angelo", "erykah badu", "jill scott", "sade"
  ],
  orchestra: [
    "bach", "mozart", "beethoven", "tchaikovsky", "vivaldi", "debussy", "brahms", "mahler", "stravinsky",
    "rachmaninoff", "yo yo ma", "hilary hahn", "itzhak perlman", "anne sophie mutter", "london symphony",
    "berlin philharmonic", "vienna philharmonic"
  ],
  piano: [
    "chopin", "ludovico einaudi", "yiruma", "nils frahm", "george winston", "joep beving", "keith jarrett",
    "glenn gould", "martha argerich", "lang lang", "yuja wang"
  ],
  "movies-games": [
    "the legend of zelda", "ocarina of time", "breath of the wild", "super mario", "minecraft", "final fantasy",
    "chrono trigger", "nier automata", "persona", "halo", "skyrim", "the witcher", "journey", "hollow knight",
    "celeste", "undertale", "red dead redemption", "the last of us", "baldurs gate", "baldur's gate", "elden ring",
    "studio ghibli", "joe hisaishi", "star wars", "john williams", "lord of the rings", "howard shore",
    "harry potter", "interstellar", "hans zimmer", "dune", "oppenheimer", "blade runner", "pirates of the caribbean",
    "jurassic park", "la la land", "amelie", "cinema paradiso", "the godfather", "naruto", "one piece",
    "attack on titan", "demon slayer", "jujutsu kaisen", "death note", "cowboy bebop", "evangelion",
    "samurai champloo", "fullmetal alchemist", "steins gate", "your name", "suzume", "violet evergarden", "frieren"
  ],
  "handpan-kalimba": [
    "hang massive", "malte marten", "yatao", "david charrier", "mathieu clavel", "samyula", "manu delago",
    "yarden pantam", "forest ravi"
  ],
  house: [
    "flavour trip", "flavor trip", "defected", "glitterbox", "folamour", "purple disco machine", "kerri chandler",
    "moodymann", "masters at work", "louie vega", "kenny dope", "kaytranada", "todd terje", "groove culture",
    "toy tonics", "strictly rhythm"
  ],
  acoustic: [
    "tommy emmanuel", "andy mckee", "john fahey", "leo kottke", "willie nelson", "townes van zandt",
    "guy clark", "doc watson", "tony rice", "norman blake", "chet atkins"
  ],
  "fantasy-folk": [
    "wardruna", "heilung", "danheim", "faun", "skald", "eivor", "clannad", "loreena mckennitt",
    "the dubliners", "medieval baebes"
  ],
  bossa: [
    "antonio carlos jobim", "tom jobim", "joao gilberto", "joão gilberto", "astrud gilberto", "stan getz",
    "elis regina", "buena vista social club", "cesaria evora", "caetano veloso", "gilberto gil", "toquinho"
  ],
  asia: [
    "ravi shankar", "anoushka shankar", "ali akbar khan", "zakir hussain", "kitaro", "kodo", "yo yo ma silk road",
    "silk road ensemble", "wu man", "lei qiang", "yoshida brothers", "hifumi hachigaeshi"
  ],
  "middle-east": [
    "anouar brahem", "omar faruk tekbilek", "kayhan kalhor", "naseer shamma", "marcel khalife", "fairuz",
    "farid al atrash", "munir bashir", "hossam ramzy", "mercau mec"
  ]
};
const POPULARITY_SIGNAL_GROUPS: Array<{ keys: string[]; weight: number }> = [
  { keys: ["playbackCount", "playback_count", "playCount", "play_count", "plays"], weight: 12 },
  { keys: ["likesCount", "likes_count", "likeCount", "like_count", "likes"], weight: 5 },
  { keys: ["repostsCount", "reposts_count", "repostCount", "repost_count", "reposts"], weight: 4 },
  { keys: ["commentsCount", "comments_count", "commentCount", "comment_count", "comments"], weight: 2 },
  { keys: ["followersCount", "followers_count", "followerCount", "follower_count", "followers"], weight: 6 },
  { keys: ["popularity"], weight: 1 }
];

export function normalizePlaylistText(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .replace(/&/g, " and ")
    .replace(/[-_/.:|()[\]{}]+/g, " ")
    .replace(/\bbossa\s+nova\b/g, "bossa")
    .replace(/\bbossanova\b/g, "bossa")
    .replace(/\s+/g, " ")
    .trim();
}

function itemFingerprint(item: CatalogItem): string {
  return [
    item.title,
    item.displayTitle || "",
    item.artist,
    item.url,
    item.categories.join("\u001f"),
    item.tags.join("\u001f")
  ].join("\u001e");
}

function getNormalizedKeywords(category: PlaylistCategoryDefinition): string[] {
  const cached = categoryKeywordCache.get(category.id);
  if (cached) return cached;
  const normalized = category.keywords.map(normalizePlaylistText).filter(Boolean);
  categoryKeywordCache.set(category.id, normalized);
  return normalized;
}

function keywordMatches(haystack: string, normalizedKeyword: string): boolean {
  if (!normalizedKeyword) return false;
  const paddedHaystack = ` ${haystack} `;
  return paddedHaystack.includes(` ${normalizedKeyword} `);
}

const ACOUSTIC_NEGATIVE_PATTERN = /\b(?:electric\s+guitar|hard\s+rock|heavy\s+metal|metal|shred|riff|djent|satriani|steve\s+vai|petrucci|hendrix)\b/;

function categoryMatches(category: PlaylistCategoryDefinition, haystack: string): boolean {
  if (category.id === "acoustic" && ACOUSTIC_NEGATIVE_PATTERN.test(haystack)) return false;
  const keywordHit = getNormalizedKeywords(category).some((keyword) => keywordMatches(haystack, keyword));
  const curationSignalHit = (CATEGORY_CURATION_SIGNALS[category.id] || [])
    .map(normalizePlaylistText)
    .some((keyword) => keywordMatches(haystack, keyword));
  if (category.id === "movies-games") {
    return keywordHit || curationSignalHit || MOVIES_GAMES_CONTEXT_PATTERNS.some((pattern) => pattern.test(haystack));
  }
  return keywordHit || curationSignalHit;
}

function getExplicitCategoryIdMap(): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const category of PLAYLIST_CATEGORIES) {
    aliases.set(normalizePlaylistText(category.id), category.id);
    aliases.set(normalizePlaylistText(category.label), category.id);
    if (category.shortLabel) aliases.set(normalizePlaylistText(category.shortLabel), category.id);
  }
  return aliases;
}

const explicitCategoryIdMap = getExplicitCategoryIdMap();

function getExplicitPlaylistCategoryIds(item: CatalogItem): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const category of item.categories || []) {
    const id = explicitCategoryIdMap.get(normalizePlaylistText(category));
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

function getItemMatchText(item: CatalogItem): string {
  return normalizePlaylistText([
    item.displayTitle || "",
    item.title,
    item.artist,
    item.url,
    ...item.tags
  ].join(" "));
}

export function isEditorsChoice(item: CatalogItem): boolean {
  const fingerprint = itemFingerprint(item);
  const cached = editorsChoiceCache.get(item);
  if (cached?.fingerprint === fingerprint) return cached.value;
  const values = [...item.categories, ...item.tags].map(normalizePlaylistText);
  const value = values.some((value) => (
    value === "editors choice"
    || value === "editor choice"
    || value === "editor pick"
    || value === "curator pick"
    || value === "ai pick"
  ));
  editorsChoiceCache.set(item, { fingerprint, value });
  return value;
}

export function getPlaylistCategoryDefinition(categoryId: string): PlaylistCategoryDefinition {
  return ALL_PLAYLIST_CATEGORIES.find((category) => category.id === categoryId) || ALL_PLAYLIST_CATEGORIES[0];
}

export function getPlaylistCategoryIds(item: CatalogItem, allowedCategoryIds?: Set<string>): string[] {
  if (allowedCategoryIds) return getPlaylistCategoryIdsUncached(item, allowedCategoryIds);

  const fingerprint = itemFingerprint(item);
  const cached = categoryIdsCache.get(item);
  if (cached?.fingerprint === fingerprint) return cached.ids;

  const ids = getPlaylistCategoryIdsUncached(item);
  categoryIdsCache.set(item, { fingerprint, ids });
  return ids;
}

function getPlaylistCategoryIdsUncached(item: CatalogItem, allowedCategoryIds?: Set<string>): string[] {
  const ids: string[] = [];
  if (isEditorsChoice(item) && (!allowedCategoryIds || allowedCategoryIds.has(DEFAULT_PLAYLIST_CATEGORY_ID))) {
    ids.push(DEFAULT_PLAYLIST_CATEGORY_ID);
  }

  const explicitIds = getExplicitPlaylistCategoryIds(item).filter((id) => !allowedCategoryIds || allowedCategoryIds.has(id));
  const explicitSet = new Set(explicitIds);
  const haystack = getItemMatchText(item);
  const inferredIds = PLAYLIST_CATEGORIES
    .filter((category) => (!allowedCategoryIds || allowedCategoryIds.has(category.id)) && !explicitSet.has(category.id) && categoryMatches(category, haystack))
    .map((category) => category.id);

  return [...ids, ...explicitIds, ...inferredIds.filter((id) => !ids.includes(id))];
}

export function itemMatchesPlaylistCategory(item: CatalogItem, categoryId: string): boolean {
  if (categoryId === DEFAULT_PLAYLIST_CATEGORY_ID) return isEditorsChoice(item);
  if (categoryId === RECENT_PLAYLIST_CATEGORY_ID) return false;
  if (categoryId === COMMUNITY_PLAYLIST_CATEGORY_ID) return false;
  return getPlaylistCategoryIds(item).includes(categoryId);
}

export interface PlaylistSortProfile {
  totalScore: number;
  mainstreamScore: number;
  popularityScore: number;
  qualityScore: number;
}

function readPopularityMetric(raw: Record<string, unknown>, key: string): number {
  const value = Number(raw[key]);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function getPlaylistPopularityScore(item: CatalogItem): number {
  const raw = item as unknown as Record<string, unknown>;
  let score = 0;
  for (const group of POPULARITY_SIGNAL_GROUPS) {
    const value = Math.max(...group.keys.map((key) => readPopularityMetric(raw, key)));
    if (value > 0) score += Math.log10(value + 1) * group.weight;
  }
  return score;
}

export function getPlaylistMainstreamNameScore(item: CatalogItem, categoryId = ""): number {
  const playlistAuthorityText = normalizePlaylistText([
    item.title,
    ...item.tags
  ].join(" "));
  const creatorAuthorityText = normalizePlaylistText([
    item.artist,
    item.authorUrl || ""
  ].join(" "));
  let score = 0;

  const signals = [
    ...(CATEGORY_MAINSTREAM_SIGNALS[categoryId] || []),
    ...(categoryId === DEFAULT_PLAYLIST_CATEGORY_ID ? Object.values(CATEGORY_MAINSTREAM_SIGNALS).flat() : [])
  ].map(normalizePlaylistText);
  const seenSignals = new Set<string>();
  for (const signal of signals) {
    if (!signal || seenSignals.has(signal)) continue;
    seenSignals.add(signal);
    if (keywordMatches(playlistAuthorityText, signal)) score += 46;
    if (keywordMatches(creatorAuthorityText, signal)) score += 20;
  }

  for (const signal of CATEGORY_CURATION_SIGNALS[categoryId] || []) {
    const normalizedSignal = normalizePlaylistText(signal);
    if (keywordMatches(playlistAuthorityText, normalizedSignal)) score += 6;
    else if (keywordMatches(creatorAuthorityText, normalizedSignal)) score += 2;
  }
  for (const signal of GENERIC_QUALITY_SIGNALS) {
    if (keywordMatches(playlistAuthorityText, normalizePlaylistText(signal))) score += 2;
  }

  if (item.source === "curated") score += 1;
  if (item.status === "active") score += 1;
  if (item.type === "playlist" || item.type === "album") score += 0.5;
  if (isEditorsChoice(item)) score += 6;
  return score;
}

function getPlaylistQualityScore(item: CatalogItem): number {
  const haystack = getItemMatchText(item);
  let score = 0;
  for (const signal of LOW_PRIORITY_SIGNALS) {
    if (keywordMatches(haystack, normalizePlaylistText(signal))) score -= 18;
  }
  if (hasLowInformationPlaylistTitle(item) && !hasCompactNamingFallback(item)) score -= 36;
  if (item.status === "broken") score -= 50;
  if (item.status === "hidden") score -= 100;
  return score;
}

function hasLowInformationPlaylistTitle(item: CatalogItem): boolean {
  const titleKey = normalizePlaylistText(item.title || item.displayTitle || "");
  if (!titleKey) return true;
  if (!/\p{L}/u.test(titleKey)) return true;
  if (/^(?:playlist|music|songs?|tracks?|set|mix|album)(?:\s+\d+)*$/.test(titleKey)) return true;
  if (/^(?:my|new)\s+(?:playlist|music|mix)(?:\s+\d+)*$/.test(titleKey)) return true;
  return false;
}

function hasCompactNamingFallback(item: CatalogItem): boolean {
  const artistKey = normalizePlaylistText(item.artist || "");
  const cleanArtistKey = artistKey.replace(/\s+\d{1,4}$/, "");
  if (cleanArtistKey && !/^(?:soundcloud|unknown|unknown artist|unknown curator|user(?:\s+\d+)?)$/.test(cleanArtistKey)) return true;
  const context = normalizePlaylistText([...item.categories, ...item.tags, item.title || ""].join(" "));
  return Boolean(context && /\b(?:piano|guitar|acoustic|handpan|kalimba|violin|cello|sax|saxophone|trumpet|flute|oud|orchestra|ambient|ambience|rain|jazz|blues|house|lofi|lo fi|folk|fantasy|medieval|movie|film|game|anime|ost|soundtrack|bossa|latin|asia|middle east)\b/.test(context));
}

export function getPlaylistSortProfile(item: CatalogItem, categoryId = ""): PlaylistSortProfile {
  const popularityScore = getPlaylistPopularityScore(item);
  const mainstreamScore = getPlaylistMainstreamNameScore(item, categoryId);
  const qualityScore = getPlaylistQualityScore(item);
  return {
    popularityScore,
    mainstreamScore,
    qualityScore,
    totalScore: popularityScore + mainstreamScore + qualityScore
  };
}

export function getPlaylistCurationScore(item: CatalogItem, categoryId = ""): number {
  return getPlaylistSortProfile(item, categoryId).totalScore;
}

export function comparePlaylistItemsForCategory(categoryId: string, a: CatalogItem, b: CatalogItem): number {
  const profileA = getPlaylistSortProfile(a, categoryId);
  const profileB = getPlaylistSortProfile(b, categoryId);
  const scoreDelta = profileB.totalScore - profileA.totalScore;
  if (Math.abs(scoreDelta) > 0.001) return scoreDelta;
  const popularityDelta = profileB.popularityScore - profileA.popularityScore;
  if (Math.abs(popularityDelta) > 0.001) return popularityDelta;
  const mainstreamDelta = profileB.mainstreamScore - profileA.mainstreamScore;
  if (Math.abs(mainstreamDelta) > 0.001) return mainstreamDelta;
  const titleA = normalizePlaylistText(a.displayTitle || a.title);
  const titleB = normalizePlaylistText(b.displayTitle || b.title);
  return titleA.localeCompare(titleB);
}
