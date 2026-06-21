import type { CatalogFile, CatalogItem } from "./catalog/types";
import { ALL_PLAYLIST_CATEGORIES, COMMUNITY_PLAYLIST_CATEGORY_ID, DEFAULT_PLAYLIST_CATEGORY_ID, RECENT_PLAYLIST_CATEGORY_ID } from "./catalog/playlistCategories";
import type { PlayerMode } from "./player/types";

export interface PersonalPlaylistCategory {
  id: string;
  label: string;
  createdAt: string;
}

export interface MusicProBehaviorStats {
  playCount: number;
  completionCount: number;
  skipCount: number;
  replayCount: number;
  folderAddCount: number;
  unavailableCount: number;
  previewCount: number;
  totalListenMs: number;
  lastPlayedAt: string;
  updatedAt: string;
}

export interface MusicProSettings {
  viewMode: PlayerMode;
  autoplayOnStartup: boolean;
  enableMobileMode: boolean;
  autoHideMini: boolean;
  pauseForExternalAudio: boolean;
  randomPlaylistEnabled: boolean;
  loopTrackEnabled: boolean;
  accentColor: string;
  rainbowAccentEnabled: boolean;
  adaptAccentToTheme: boolean;
  volume: number;
  useRemoteCatalog: boolean;
  remoteCatalogUrl: string;
  refreshIntervalDays: number;
  lastCatalogRefresh: string;
  cachedRemoteCatalog: CatalogFile | null;
  userItems: CatalogItem[];
  userItemOrder: string[];
  personalCategories: PersonalPlaylistCategory[];
  personalPlaylistAssignments: Record<string, string[]>;
  personalFolderItemOrders: Record<string, string[]>;
  playlistCategoryOrder: string[];
  disabledPlaylistCategoryIds: string[];
  playlistTrackOrders: Record<string, string[]>;
  recentlyPlayedItemIds: string[];
  recentlyPlayedArtworkByItemId: Record<string, string>;
  currentItemId: string;
  currentSoundIndex: number;
  currentPositionMs: number;
  lastSelectedCategory: string;
  firstRunComplete: boolean;
  lastAddCategory: string;
  behaviorStats: Record<string, MusicProBehaviorStats>;
  behaviorRankingScores: Record<string, number>;
  behaviorRankingUpdatedAt: string;
}

export const DEFAULT_REMOTE_CATALOG_URL = "";
export const DEFAULT_ACCENT_COLOR = "#2f7cf6";
export const LEGACY_PLAYLIST_CATEGORY_ORDER = ALL_PLAYLIST_CATEGORIES.map((category) => category.id);
export const DEFAULT_PLAYLIST_CATEGORY_ORDER = [
  RECENT_PLAYLIST_CATEGORY_ID,
  DEFAULT_PLAYLIST_CATEGORY_ID,
  ...ALL_PLAYLIST_CATEGORIES
    .map((category) => category.id)
    .filter((id) => id !== RECENT_PLAYLIST_CATEGORY_ID && id !== DEFAULT_PLAYLIST_CATEGORY_ID && id !== COMMUNITY_PLAYLIST_CATEGORY_ID)
    .flatMap((id) => id === "middle-east" ? [id, COMMUNITY_PLAYLIST_CATEGORY_ID] : [id])
];

export const DEFAULT_SETTINGS: MusicProSettings = {
  viewMode: "mini",
  autoplayOnStartup: true,
  enableMobileMode: false,
  autoHideMini: true,
  pauseForExternalAudio: true,
  randomPlaylistEnabled: false,
  loopTrackEnabled: false,
  accentColor: DEFAULT_ACCENT_COLOR,
  rainbowAccentEnabled: false,
  adaptAccentToTheme: false,
  volume: 40,
  useRemoteCatalog: true,
  remoteCatalogUrl: DEFAULT_REMOTE_CATALOG_URL,
  refreshIntervalDays: 14,
  lastCatalogRefresh: "",
  cachedRemoteCatalog: null,
  userItems: [],
  userItemOrder: [],
  personalCategories: [],
  personalPlaylistAssignments: {},
  personalFolderItemOrders: {},
  playlistCategoryOrder: DEFAULT_PLAYLIST_CATEGORY_ORDER,
  disabledPlaylistCategoryIds: [],
  playlistTrackOrders: {},
  recentlyPlayedItemIds: [],
  recentlyPlayedArtworkByItemId: {},
  currentItemId: "",
  currentSoundIndex: 0,
  currentPositionMs: 0,
  lastSelectedCategory: "editors-choice",
  firstRunComplete: false,
  lastAddCategory: "User",
  behaviorStats: {},
  behaviorRankingScores: {},
  behaviorRankingUpdatedAt: ""
};
