import type { CatalogItem } from "../catalog/types";

const ARTWORK_PLACEHOLDER_PALETTES = [
  [214, 258, 224],
  [18, 44, 22],
  [142, 176, 166],
  [326, 268, 286],
  [198, 222, 236],
  [348, 12, 334],
  [82, 158, 132],
  [44, 34, 26],
  [274, 238, 252],
  [174, 202, 190],
  [286, 314, 254],
  [28, 8, 350],
  [156, 126, 184],
  [204, 176, 226],
  [232, 286, 210],
  [6, 52, 338],
  [118, 86, 148],
  [190, 230, 252],
  [306, 18, 272],
  [34, 172, 198],
  [260, 224, 316],
  [96, 168, 204],
  [334, 24, 52],
  [218, 28, 172],
  [48, 92, 152],
  [182, 284, 326],
  [12, 206, 250],
  [152, 42, 312]
] as const;

const ARTWORK_PLACEHOLDER_VARIANTS = ["orb", "prism", "aurora", "vinyl", "wave", "ember", "glass", "flare"] as const;

type PlaceholderVariant = typeof ARTWORK_PLACEHOLDER_VARIANTS[number];
type PlaceholderMotif = "aurora" | "vinyl" | "wave" | "prism" | "pulse" | "grain" | "ribbon" | "glass" | "grid";

interface ArtworkProfile {
  id: string;
  labels: string[];
  keywords: string[];
  icon: string;
  motif: PlaceholderMotif;
  variant: PlaceholderVariant;
  hues: readonly [number, number, number];
  saturation: number;
  lightness: number;
}

interface ArtworkSource {
  seed: string;
  title: string;
  artist: string;
  type: string;
  categories: string[];
  tags: string[];
  source: string;
}

const CATEGORY_ARTWORK_PROFILES: ArtworkProfile[] = [
  {
    id: "ambience",
    labels: ["ambience", "ambient"],
    keywords: ["ambience", "ambient", "rain", "forest", "ocean", "waves", "field recording", "frequency", "binaural", "solfeggio", "noise", "meditation", "space"],
    icon: "cloud-rain",
    motif: "aurora",
    variant: "aurora",
    hues: [202, 224, 162],
    saturation: 72,
    lightness: 51
  },
  {
    id: "piano",
    labels: ["piano"],
    keywords: ["piano", "keys", "chopin", "einaudi", "yiruma", "nils frahm", "keith jarrett", "solo piano"],
    icon: "piano",
    motif: "glass",
    variant: "glass",
    hues: [220, 252, 188],
    saturation: 70,
    lightness: 53
  },
  {
    id: "jazz-blues",
    labels: ["jazz blues", "jazz & blues", "jazz", "blues"],
    keywords: ["jazz", "blues", "sax", "saxophone", "trumpet", "soul", "bebop", "swing", "cafe jazz", "motown", "funk"],
    icon: "music-4",
    motif: "vinyl",
    variant: "vinyl",
    hues: [34, 265, 316],
    saturation: 74,
    lightness: 50
  },
  {
    id: "orchestra",
    labels: ["orchestra", "classical"],
    keywords: ["orchestra", "orchestral", "symphony", "classical", "concerto", "sonata", "quartet", "violin", "cello", "choir", "philharmonic"],
    icon: "audio-lines",
    motif: "ribbon",
    variant: "prism",
    hues: [224, 280, 202],
    saturation: 62,
    lightness: 52
  },
  {
    id: "movies-games",
    labels: ["movies games", "movies/games", "soundtrack"],
    keywords: ["movie", "film", "game", "games", "soundtrack", "score", "anime", "ost", "zelda", "mario", "minecraft", "ghibli", "star wars", "hans zimmer"],
    icon: "clapperboard",
    motif: "grid",
    variant: "prism",
    hues: [215, 262, 318],
    saturation: 78,
    lightness: 52
  },
  {
    id: "handpan-kalimba",
    labels: ["handpan kalimba", "handpan", "kalimba"],
    keywords: ["handpan", "hang drum", "kalimba", "mbira", "thumb piano", "tongue drum", "pantam"],
    icon: "drum",
    motif: "wave",
    variant: "orb",
    hues: [178, 132, 214],
    saturation: 68,
    lightness: 52
  },
  {
    id: "house",
    labels: ["house"],
    keywords: ["house", "deep house", "disco", "groove", "funky house", "lounge house", "nu disco", "balearic"],
    icon: "disc-3",
    motif: "pulse",
    variant: "flare",
    hues: [286, 210, 334],
    saturation: 78,
    lightness: 52
  },
  {
    id: "acoustic",
    labels: ["acoustic", "guitar"],
    keywords: ["acoustic", "guitar", "fingerstyle", "fingerpicking", "country", "folk", "bluegrass", "banjo", "americana"],
    icon: "guitar",
    motif: "grain",
    variant: "ember",
    hues: [36, 24, 96],
    saturation: 70,
    lightness: 50
  },
  {
    id: "fantasy-folk",
    labels: ["fantasy folk", "folk", "celtic", "medieval"],
    keywords: ["fantasy", "folk", "celtic", "nordic", "medieval", "tavern", "bard", "viking", "dnd", "lute", "harp"],
    icon: "castle",
    motif: "grain",
    variant: "glass",
    hues: [42, 98, 158],
    saturation: 66,
    lightness: 49
  },
  {
    id: "bossa",
    labels: ["bossa", "latin"],
    keywords: ["bossa", "samba", "latin", "tango", "salsa", "brazilian", "bolero", "rumba"],
    icon: "sun",
    motif: "ribbon",
    variant: "flare",
    hues: [28, 348, 210],
    saturation: 78,
    lightness: 54
  },
  {
    id: "asia",
    labels: ["asia", "asian"],
    keywords: ["asia", "asian", "japanese", "chinese", "korean", "vietnamese", "guzheng", "koto", "erhu", "shamisen", "sitar", "tabla", "gamelan"],
    icon: "flower-2",
    motif: "prism",
    variant: "aurora",
    hues: [152, 204, 332],
    saturation: 68,
    lightness: 52
  },
  {
    id: "middle-east",
    labels: ["middle east", "arabic", "persian", "turkish"],
    keywords: ["middle east", "middle eastern", "arabic", "persian", "turkish", "oud", "ney", "darbuka", "desert", "sufi", "maqam"],
    icon: "moon",
    motif: "ribbon",
    variant: "ember",
    hues: [30, 348, 248],
    saturation: 72,
    lightness: 50
  },
  {
    id: "editors-choice",
    labels: ["editor's choice", "editors choice", "editor's", "editors"],
    keywords: ["editor", "choice", "curated"],
    icon: "sparkles",
    motif: "glass",
    variant: "flare",
    hues: [218, 258, 190],
    saturation: 76,
    lightness: 53
  },
  {
    id: "recent",
    labels: ["recent", "recently played"],
    keywords: ["recent", "history"],
    icon: "history",
    motif: "vinyl",
    variant: "orb",
    hues: [214, 236, 184],
    saturation: 58,
    lightness: 49
  },
  {
    id: "community",
    labels: ["community"],
    keywords: ["community", "top picks", "popular"],
    icon: "radio",
    motif: "pulse",
    variant: "wave",
    hues: [210, 166, 286],
    saturation: 70,
    lightness: 52
  }
];

const PERSONAL_PROFILE: ArtworkProfile = {
  id: "personal",
  labels: ["personal", "mh", "minh"],
  keywords: ["personal", "user", "saved", "mh", "minh"],
  icon: "folder-heart",
  motif: "glass",
  variant: "glass",
  hues: [214, 256, 194],
  saturation: 72,
  lightness: 52
};

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function wrapHue(value: number): number {
  return ((Math.round(value) % 360) + 360) % 360;
}

function formatHsl(hue: number, saturation: number, lightness: number): string {
  return `hsl(${wrapHue(hue)} ${Math.round(saturation)}% ${Math.round(lightness)}%)`;
}

function normalizeText(value: string): string {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function isCatalogItem(value: string | CatalogItem): value is CatalogItem {
  return typeof value === "object" && value !== null && "url" in value && "title" in value;
}

function sourceFromInput(input: string | CatalogItem): ArtworkSource {
  if (!isCatalogItem(input)) {
    const title = String(input || "Music Pro");
    return {
      seed: title,
      title,
      artist: "",
      type: "unknown",
      categories: [],
      tags: [],
      source: ""
    };
  }

  const title = input.displayTitle || input.title || "Music Pro";
  return {
    seed: [input.id, input.url, input.displayTitle, input.title, input.artist, input.categories?.join("|"), input.tags?.join("|")].filter(Boolean).join("|"),
    title,
    artist: input.artist || "",
    type: input.type || "unknown",
    categories: Array.isArray(input.categories) ? input.categories.filter(Boolean) : [],
    tags: Array.isArray(input.tags) ? input.tags.filter(Boolean) : [],
    source: input.source || ""
  };
}

function sourceText(source: ArtworkSource): string {
  return normalizeText([
    source.title,
    source.artist,
    source.type,
    source.source,
    ...source.categories,
    ...source.tags
  ].join(" "));
}

function profileMatchesText(profile: ArtworkProfile, normalized: string): boolean {
  if (!normalized) return false;
  return [...profile.labels, ...profile.keywords]
    .map(normalizeText)
    .filter(Boolean)
    .some((keyword) => normalized === keyword || normalized.includes(keyword));
}

function resolveArtworkPalette(profile: ArtworkProfile, hash: number): readonly [number, number, number] {
  const globalPalette = ARTWORK_PLACEHOLDER_PALETTES[(hash >>> 5) % ARTWORK_PLACEHOLDER_PALETTES.length];
  const mode = (hash >>> 27) % 6;
  const broadShift = ((hash >>> 12) % 121) - 60;
  const softShift = ((hash >>> 20) % 71) - 35;

  // Keep a recognizable category base, but borrow one or two hues from the
  // wider palette bank so a row of missing covers does not look duplicated.
  switch (mode) {
    case 0:
      return [profile.hues[0] + broadShift, profile.hues[1] - softShift, profile.hues[2] + softShift / 2];
    case 1:
      return [profile.hues[0] + softShift, globalPalette[1] + broadShift / 2, profile.hues[2] - broadShift / 3];
    case 2:
      return [globalPalette[0] + softShift, profile.hues[1] + broadShift, globalPalette[2] - softShift];
    case 3:
      return [profile.hues[1] + 52 + softShift, profile.hues[2] - 28 + broadShift / 3, globalPalette[0] + 24];
    case 4:
      return [globalPalette[0] + broadShift / 2, globalPalette[1] - softShift, profile.hues[0] + 86 + softShift / 2];
    default:
      return [profile.hues[0] - 42 + broadShift / 3, globalPalette[2] + softShift, profile.hues[1] + 44 - softShift / 2];
  }
}

function getArtworkProfile(source: ArtworkSource, hash: number): ArtworkProfile {
  if (source.source === "user") return PERSONAL_PROFILE;

  const normalizedCategories = source.categories.map(normalizeText).filter(Boolean);
  for (const category of normalizedCategories) {
    const direct = CATEGORY_ARTWORK_PROFILES.find((profile) => profile.labels.map(normalizeText).includes(category) || profile.id === category.replace(/\s+/g, "-"));
    if (direct) return direct;
  }

  const text = sourceText(source);
  const inferred = CATEGORY_ARTWORK_PROFILES.find((profile) => profileMatchesText(profile, text));
  if (inferred) return inferred;

  const palette = ARTWORK_PLACEHOLDER_PALETTES[hash % ARTWORK_PLACEHOLDER_PALETTES.length];
  return {
    id: "music-pro",
    labels: [],
    keywords: [],
    icon: source.type === "profile" ? "user-round" : source.type === "album" ? "disc-3" : source.type === "track" ? "music-2" : "list-music",
    motif: ["aurora", "vinyl", "wave", "prism", "pulse", "grain", "ribbon", "glass", "grid"][hash % 9] as PlaceholderMotif,
    variant: ARTWORK_PLACEHOLDER_VARIANTS[(hash >>> 3) % ARTWORK_PLACEHOLDER_VARIANTS.length],
    hues: palette,
    saturation: 66 + ((hash >>> 11) % 18),
    lightness: 48 + ((hash >>> 15) % 8)
  };
}

function chooseIcon(profile: ArtworkProfile, source: ArtworkSource, fallbackIcon: string): string {
  if (source.type === "track" && fallbackIcon && fallbackIcon !== "music") return fallbackIcon;
  return profile.icon || fallbackIcon || "music";
}

export function applyArtworkPlaceholderStyle(element: HTMLElement, input: string | CatalogItem, fallbackIcon = "music"): string {
  const source = sourceFromInput(input);
  const hash = hashString(source.seed || source.title || "Music Pro");
  const profile = getArtworkProfile(source, hash);
  const palette = resolveArtworkPalette(profile, hash);
  const hueShift = ((hash >>> 8) % 71) - 35;
  const microShift = ((hash >>> 19) % 19) - 9;
  const saturationA = profile.saturation + ((hash >>> 14) % 18) - 7;
  const saturationB = profile.saturation - 10 + ((hash >>> 20) % 20);
  const saturationC = Math.max(40, profile.saturation - 20 + ((hash >>> 23) % 18));
  const lightA = profile.lightness + 7 + ((hash >>> 24) % 12);
  const lightB = profile.lightness - 6 + ((hash >>> 4) % 13);
  const lightC = 9 + ((hash >>> 11) % 15);
  const accentHue = palette[1] + hueShift + 20 + ((hash >>> 27) % 50);
  const variant = ARTWORK_PLACEHOLDER_VARIANTS[(hash >>> 3) % ARTWORK_PLACEHOLDER_VARIANTS.length] || profile.variant;

  element.addClass("music-pro-art-placeholder");
  element.setAttr("data-music-pro-art-profile", profile.id);
  element.setAttr("data-music-pro-art-variant", variant);
  element.setAttr("data-music-pro-art-motif", profile.motif);
  element.setAttr("data-music-pro-art-kind", source.type || "unknown");
  element.setAttr("data-music-pro-art-palette", String((hash >>> 5) % ARTWORK_PLACEHOLDER_PALETTES.length));
  element.style.setProperty("--music-pro-art-a", formatHsl(palette[0] + hueShift, saturationA, lightA));
  element.style.setProperty("--music-pro-art-b", formatHsl(palette[1] - hueShift / 2, saturationB, lightB));
  element.style.setProperty("--music-pro-art-c", formatHsl(palette[2] + hueShift / 3, saturationC, lightC));
  element.style.setProperty("--music-pro-art-d", formatHsl(accentHue, Math.min(92, profile.saturation + 10 + ((hash >>> 21) % 10)), 58 + ((hash >>> 2) % 10)));
  element.style.setProperty("--music-pro-art-angle", `${112 + (hash % 82)}deg`);
  element.style.setProperty("--music-pro-art-conic-angle", `${hash % 360}deg`);
  element.style.setProperty("--music-pro-art-pattern-angle", `${70 + ((hash >>> 6) % 92)}deg`);
  element.style.setProperty("--music-pro-art-pattern-opacity", `${0.34 + ((hash >>> 12) % 30) / 100}`);
  element.style.setProperty("--music-pro-art-tilt", `${((hash >>> 18) % 16) - 8}deg`);
  element.style.setProperty("--music-pro-art-glow-x", `${22 + (hash % 52)}%`);
  element.style.setProperty("--music-pro-art-glow-y", `${18 + ((hash >> 5) % 48)}%`);
  element.style.setProperty("--music-pro-art-glow-x2", `${18 + ((hash >>> 9) % 62)}%`);
  element.style.setProperty("--music-pro-art-glow-y2", `${28 + ((hash >>> 13) % 54)}%`);
  element.style.setProperty("--music-pro-art-line-a", formatHsl(palette[0] + hueShift + 28, Math.min(94, profile.saturation + 12), 64 + ((hash >>> 17) % 10)));
  element.style.setProperty("--music-pro-art-line-b", formatHsl(palette[2] - hueShift - 16, Math.min(90, profile.saturation + 6), 54 + microShift));

  return chooseIcon(profile, source, fallbackIcon);
}
