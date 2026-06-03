import type { CatalogItem } from "../catalog/types";

export type PlayerMode = "sidebar" | "mini";

export interface SoundCloudSound {
  id: string;
  title: string;
  artist: string;
  durationMs: number;
  originalIndex: number;
  isPreview?: boolean;
  isPlayable?: boolean;
  unplayableReason?: string;
  artworkUrl?: string;
  permalinkUrl?: string;
}

export interface PlaybackResumeTarget {
  soundIndex?: number;
  positionMs?: number;
}

export interface PlaybackState {
  currentItem: CatalogItem | null;
  isReady: boolean;
  isPlaying: boolean;
  isLoading: boolean;
  volume: number;
  mode: PlayerMode;
  error: string | null;
  positionMs: number;
  durationMs: number;
  soundList: SoundCloudSound[];
  soundListVersion: number;
  currentSoundIndex: number;
  currentSoundTitle: string;
  currentSoundArtist: string;
  currentSoundArtworkUrl: string;
  currentSoundIsPreview: boolean;
  currentSoundIsUnavailable: boolean;
  currentSoundUnavailableReason: string;
  playlistReady: boolean;
}

export type PlaybackListener = (state: PlaybackState) => void;
