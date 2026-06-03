export type MusicProvider = "soundcloud";
export type CatalogItemType = "track" | "playlist" | "profile" | "album" | "unknown";
export type CatalogItemSource = "curated" | "user";
export type CatalogItemStatus = "active" | "broken" | "hidden";

export interface CatalogItem {
  id: string;
  provider: MusicProvider;
  type: CatalogItemType;
  title: string;
  displayTitle?: string;
  artist: string;
  url: string;
  artworkUrl?: string;
  authorUrl?: string;
  categories: string[];
  tags: string[];
  source: CatalogItemSource;
  addedAt: string;
  verifiedAt: string;
  status: CatalogItemStatus;
  playbackCount?: number;
  playback_count?: number;
  playCount?: number;
  play_count?: number;
  plays?: number;
  likesCount?: number;
  likes_count?: number;
  likeCount?: number;
  like_count?: number;
  likes?: number;
  repostsCount?: number;
  reposts_count?: number;
  repostCount?: number;
  repost_count?: number;
  reposts?: number;
  commentsCount?: number;
  comments_count?: number;
  commentCount?: number;
  comment_count?: number;
  comments?: number;
  followersCount?: number;
  followers_count?: number;
  followerCount?: number;
  follower_count?: number;
  followers?: number;
  popularity?: number;
  soundcloudTrackCount?: number;
  popularityConfidence?: "none" | "low" | "medium" | "high";
  popularityUpdatedAt?: string;
}

export interface CatalogFile {
  version: number;
  updatedAt: string;
  items: CatalogItem[];
}
