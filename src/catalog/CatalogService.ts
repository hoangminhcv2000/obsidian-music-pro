import { Notice, requestUrl } from "obsidian";
import { BUNDLED_CATALOG } from "./bundledCatalog";
import type { CatalogFile, CatalogItem } from "./types";
import type { MusicProSettings } from "../settings";
import { assertEmbeddableSoundCloudUrl, cleanTitle, inferSoundCloudType, makeDisplayTitle, normalizeDisplayTitle, normalizeSoundCloudArtworkUrl, normalizeSoundCloudUrl, slugify, today } from "../utils/normalize";
import { ALL_PLAYLIST_CATEGORIES, normalizePlaylistText } from "./playlistCategories";

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
  html?: string;
}

interface SoundCloudPageMetadata {
  title: string;
  artist: string;
  url: string;
  type: CatalogItem["type"];
  artworkUrl?: string;
  authorUrl?: string;
}

const POPULARITY_FIELD_NAMES = [
  "playbackCount", "playback_count", "playCount", "play_count", "plays",
  "likesCount", "likes_count", "likeCount", "like_count", "likes",
  "repostsCount", "reposts_count", "repostCount", "repost_count", "reposts",
  "commentsCount", "comments_count", "commentCount", "comment_count", "comments",
  "followersCount", "followers_count", "followerCount", "follower_count", "followers",
  "popularity"
] as const;

const REMOVED_CATEGORY_KEYS = new Set(["focus", "other", "rock metal"]);
const LEGACY_BOSSA_CATEGORY_PATTERN = /\bbossa\s*[- ]?\s*nova\b|\bbossanova\b/i;
const VALID_CATEGORY_LABEL_KEYS = new Set([
  ...ALL_PLAYLIST_CATEGORIES.map((category) => normalizePlaylistText(category.label)),
  "user"
]);
const DUPLICATE_TITLE_STOP_WORDS = new Set([
  "official", "playlist", "playlists", "set", "sets", "music", "songs", "tracks", "track", "mix", "mixes"
]);

export interface AddUserSoundCloudResult {
  item: CatalogItem;
  added: boolean;
  resolvedUrl: string;
}

export class CatalogService {
  private settings: MusicProSettings;
  private saveSettings: () => Promise<void>;
  private activeItemsCache: CatalogItem[] | null = null;
  private orderUserItems(items: CatalogItem[]): CatalogItem[] {
    return items.slice().sort((a, b) => {
      const ai = this.settings.userItemOrder.indexOf(a.id);
      const bi = this.settings.userItemOrder.indexOf(b.id);
      const ar = ai === -1 ? Number.MAX_SAFE_INTEGER : ai;
      const br = bi === -1 ? Number.MAX_SAFE_INTEGER : bi;
      if (ar !== br) return ar - br;
      return a.addedAt.localeCompare(b.addedAt);
    });
  }
  private catalog: CatalogFile = BUNDLED_CATALOG;

  constructor(settings: MusicProSettings, saveSettings: () => Promise<void>) {
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.catalog = this.mergeCatalogs(BUNDLED_CATALOG, settings.cachedRemoteCatalog, this.userCatalog());
  }

  getCatalog(): CatalogFile {
    return this.catalog;
  }

  getItems(): CatalogItem[] {
    if (!this.activeItemsCache) {
      this.activeItemsCache = this.catalog.items.filter((item) => item.status === "active");
    }
    return this.activeItemsCache;
  }

  getCategories(): string[] {
    const categories = new Set<string>(["All"]);
    for (const item of this.getItems()) {
      for (const category of item.categories) categories.add(category);
    }
    return [...categories];
  }

  reloadFromSettings(settings: MusicProSettings): void {
    this.settings = settings;
    this.catalog = this.mergeCatalogs(BUNDLED_CATALOG, settings.cachedRemoteCatalog, this.userCatalog());
    this.activeItemsCache = null;
  }

  search(query: string, category: string): CatalogItem[] {
    const q = normalizePlaylistText(query);
    return this.getItems().filter((item) => {
      const categoryMatch = category === "All" || item.categories.includes(category);
      if (!categoryMatch) return false;
      if (!q) return true;
      const haystack = normalizePlaylistText([item.displayTitle, item.title, item.artist, item.url, ...item.categories, ...item.tags].join(" "));
      return haystack.includes(q);
    });
  }

  needsRemoteRefresh(): boolean {
    if (!this.settings.useRemoteCatalog || !this.settings.remoteCatalogUrl.trim()) return false;
    if (!this.settings.lastCatalogRefresh) return true;
    const last = new Date(this.settings.lastCatalogRefresh).getTime();
    if (!Number.isFinite(last)) return true;
    const ageMs = Date.now() - last;
    return ageMs > this.settings.refreshIntervalDays * 24 * 60 * 60 * 1000;
  }

  async refreshRemoteCatalog(force = false, quiet = false): Promise<boolean> {
    if (!this.settings.useRemoteCatalog || !this.settings.remoteCatalogUrl.trim()) {
      if (force && !quiet) new Notice("Music Pro: set a remote catalog URL in Advanced settings first.");
      return false;
    }
    if (!force && !this.needsRemoteRefresh()) return false;
    try {
      const remoteUrl = this.validateRemoteCatalogUrl(this.settings.remoteCatalogUrl.trim());
      const response = await requestUrl({ url: remoteUrl, method: "GET" });
      const data = typeof response.json === "object" ? response.json : JSON.parse(response.text);
      const normalized = this.normalizeCatalog(data, "curated");
      const errors = this.validateCatalog(normalized);
      if (errors.length > 0) throw new Error(errors[0]);
      this.settings.cachedRemoteCatalog = normalized;
      this.settings.lastCatalogRefresh = new Date().toISOString();
      this.reloadFromSettings(this.settings);
      await this.saveSettings();
      if (force && !quiet) new Notice(`Music Pro: refreshed catalog (${normalized.items.length} items).`);
      return true;
    } catch (error) {
      if (force && !quiet) new Notice(`Music Pro: catalog refresh failed — ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  async addUserSoundCloudUrl(urlInput: string, categories: string[]): Promise<AddUserSoundCloudResult> {
    const url = await this.resolveSoundCloudShareUrl(urlInput);
    assertEmbeddableSoundCloudUrl(url);
    const duplicate = this.findDuplicateItem(url);
    if (duplicate) return { item: duplicate, added: false, resolvedUrl: url };

    const safeCategories = categories.map((category) => category.trim()).filter(Boolean);
    const finalCategories = safeCategories.length ? safeCategories : ["User"];
    let item: CatalogItem;
    try {
      const metadata = await this.fetchOEmbed(url);
      item = this.itemFromOEmbed(url, metadata, finalCategories, "user");
      item = await this.enrichItemArtworkFromPage(item);
    } catch {
      try {
        const metadata = await this.fetchPageMetadata(url);
        item = this.itemFromPageMetadata(metadata, finalCategories, "user");
      } catch {
        item = this.fallbackItemFromUrl(url, finalCategories, "user");
      }
    }

    const canonicalDuplicate = this.findDuplicateItem(item.url);
    if (canonicalDuplicate) return { item: canonicalDuplicate, added: false, resolvedUrl: item.url };

    let baseId = item.id;
    let suffix = 2;
    const existingIds = new Set(this.catalog.items.map((existing) => existing.id));
    while (existingIds.has(item.id)) item.id = `${baseId}-${suffix++}`;
    this.settings.userItems = [...this.settings.userItems, item];
    this.settings.userItemOrder = [...(this.settings.userItemOrder || []), item.id];
    this.reloadFromSettings(this.settings);
    await this.saveSettings();
    return { item, added: true, resolvedUrl: item.url };
  }

  async removeUserItem(itemId: string): Promise<void> {
    this.settings.userItems = this.settings.userItems.filter((item) => item.id !== itemId);
    this.settings.userItemOrder = this.settings.userItemOrder.filter((id) => id !== itemId);
    this.reloadFromSettings(this.settings);
    await this.saveSettings();
  }

  async moveUserItem(itemId: string, direction: "up" | "down"): Promise<void> {
    const ordered = this.orderUserItems(this.settings.userItems || []);
    const ids = ordered.map((item) => item.id);
    const index = ids.indexOf(itemId);
    if (index === -1) return;
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= ids.length) return;
    const [id] = ids.splice(index, 1);
    ids.splice(target, 0, id);
    this.settings.userItemOrder = ids;
    this.reloadFromSettings(this.settings);
    await this.saveSettings();
  }

  getUserItems(): CatalogItem[] {
    return this.orderUserItems(this.settings.userItems || []);
  }

  async fetchOEmbed(url: string): Promise<OEmbedResponse> {
    const endpoint = `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`;
    const response = await requestUrl({ url: endpoint, method: "GET" });
    const data = typeof response.json === "object" ? response.json : JSON.parse(response.text);
    return data as OEmbedResponse;
  }

  private async resolveSoundCloudShareUrl(urlInput: string): Promise<string> {
    const normalized = normalizeSoundCloudUrl(urlInput);
    const parsed = new URL(normalized);
    if (parsed.hostname !== "on.soundcloud.com") return normalized;

    const resolved = await this.tryResolveRedirectUrl(normalized);
    return normalizeSoundCloudUrl(resolved || normalized);
  }

  private async tryResolveRedirectUrl(url: string): Promise<string | null> {
    let current = url;
    for (let attempt = 0; attempt < 4; attempt++) {
      const response = await requestUrl({ url: current, method: "GET", throw: false });
      const location = response.headers.location || response.headers.Location;
      if (location) {
        current = new URL(location, current).toString();
        if (new URL(current).hostname !== "on.soundcloud.com") return current;
        continue;
      }

      const htmlUrl = this.extractCanonicalUrlFromHtml(response.text);
      if (htmlUrl) return htmlUrl;
      break;
    }
    return null;
  }

  private findDuplicateItem(url: string): CatalogItem | null {
    const key = this.urlDedupKey(url);
    return this.getItems().find((item) => this.urlDedupKey(item.url) === key) || null;
  }

  private urlDedupKey(url: string): string {
    return normalizeSoundCloudUrl(url).toLowerCase();
  }

  private async fetchPageMetadata(url: string): Promise<SoundCloudPageMetadata> {
    const response = await requestUrl({ url, method: "GET", throw: false });
    if (response.status >= 400) throw new Error(`SoundCloud page failed ${response.status}.`);
    const html = response.text || "";
    const canonical = normalizeSoundCloudUrl(this.extractCanonicalUrlFromHtml(html) || url);
    const title = this.htmlDecode(this.extractMetaContent(html, "og:title") || this.titleFromUrl(canonical));
    const description = this.htmlDecode(this.extractMetaContent(html, "description") || this.extractMetaContent(html, "og:description") || "");
    const authorUrl = this.extractMetaContent(html, "soundcloud:user") || this.authorUrlFromUrl(canonical);
    const artist = this.extractArtistFromDescription(description) || this.artistFromAuthorUrl(authorUrl) || "SoundCloud";
    const pageArtworkUrl = normalizeSoundCloudArtworkUrl(
      this.htmlDecode(this.extractMetaContent(html, "og:image") || this.extractMetaContent(html, "twitter:image") || "")
    );
    const firstTrackArtworkUrl = pageArtworkUrl ? undefined : await this.fetchFirstTrackArtworkUrlFromHtml(html);
    const artworkUrl = pageArtworkUrl || firstTrackArtworkUrl;
    const ogType = (this.extractMetaContent(html, "og:type") || "").toLowerCase();
    const type: CatalogItem["type"] = ogType.includes("playlist")
      ? "playlist"
      : ogType.includes("song")
        ? "track"
        : inferSoundCloudType(canonical);

    return {
      title,
      artist,
      url: canonical,
      type,
      ...(artworkUrl ? { artworkUrl } : {}),
      ...(authorUrl ? { authorUrl: normalizeSoundCloudUrl(authorUrl) } : {})
    };
  }

  private async enrichItemArtworkFromPage(item: CatalogItem): Promise<CatalogItem> {
    try {
      const metadata = await this.fetchPageMetadata(item.url);
      const artworkUrl = normalizeSoundCloudArtworkUrl(metadata.artworkUrl);
      const canonicalUrl = metadata.url || item.url;
      return {
        ...item,
        id: `soundcloud-${slugify(new URL(canonicalUrl).pathname)}`,
        url: canonicalUrl,
        type: metadata.type || item.type,
        ...(artworkUrl ? { artworkUrl } : {}),
        ...(metadata.authorUrl ? { authorUrl: metadata.authorUrl } : {})
      };
    } catch {
      return item;
    }
  }

  private itemFromPageMetadata(data: SoundCloudPageMetadata, categories: string[], source: "curated" | "user"): CatalogItem {
    const cleanCategories = [...new Set(categories.map((category) => category.trim()).filter(Boolean))].slice(0, 6);
    return {
      id: `soundcloud-${slugify(new URL(data.url).pathname)}`,
      provider: "soundcloud",
      type: data.type,
      title: data.title,
      displayTitle: makeDisplayTitle(data.title, data.artist, cleanCategories),
      artist: data.artist,
      url: data.url,
      ...(data.artworkUrl ? { artworkUrl: data.artworkUrl } : {}),
      ...(data.authorUrl ? { authorUrl: data.authorUrl } : {}),
      categories: cleanCategories,
      tags: [],
      source,
      addedAt: today(),
      verifiedAt: today(),
      status: "active"
    };
  }

  private extractCanonicalUrlFromHtml(html: string): string | null {
    return this.extractLinkHref(html, "canonical")
      || this.extractMetaContent(html, "og:url")
      || this.extractMetaContent(html, "twitter:url");
  }

  private extractMetaContent(html: string, key: string): string | null {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const propertyPattern = new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']+)["'][^>]*>`, "i");
    const contentFirstPattern = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i");
    return propertyPattern.exec(html)?.[1] || contentFirstPattern.exec(html)?.[1] || null;
  }

  private extractLinkHref(html: string, rel: string): string | null {
    const escaped = rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const relFirstPattern = new RegExp(`<link[^>]+rel=["']${escaped}["'][^>]+href=["']([^"']+)["'][^>]*>`, "i");
    const hrefFirstPattern = new RegExp(`<link[^>]+href=["']([^"']+)["'][^>]+rel=["']${escaped}["'][^>]*>`, "i");
    return relFirstPattern.exec(html)?.[1] || hrefFirstPattern.exec(html)?.[1] || null;
  }

  private extractArtistFromDescription(description: string): string | null {
    return / by (.+?) on (?:desktop|SoundCloud|mobile)/i.exec(description)?.[1]?.trim()
      || /made for (.+?) from/i.exec(description)?.[1]?.trim()
      || null;
  }

  private authorUrlFromUrl(url: string): string | undefined {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts[0] && parts[0] !== "discover") return `https://soundcloud.com/${parts[0]}`;
    return undefined;
  }

  private artistFromAuthorUrl(url?: string): string | null {
    if (!url) return null;
    try {
      const slug = new URL(url).pathname.split("/").filter(Boolean)[0] || "";
      if (!slug) return null;
      return this.titleCase(slug.replace(/[-_]+/g, " "));
    } catch {
      return null;
    }
  }

  private titleFromUrl(url: string): string {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const raw = parts.includes("sets") ? parts[parts.indexOf("sets") + 1] : parts[1] || parts[0] || "SoundCloud link";
    return this.titleCase(raw.replace(/[-_]+/g, " ").replace(/::/g, " "));
  }

  private titleCase(value: string): string {
    const clean = value.replace(/\s+/g, " ").trim();
    return clean ? clean.charAt(0).toUpperCase() + clean.slice(1) : "SoundCloud";
  }

  private htmlDecode(value: string): string {
    return value
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">");
  }

  private async fetchFirstTrackArtworkUrlFromHtml(html: string): Promise<string | undefined> {
    const hydration = this.extractSoundCloudHydration(html);
    const playlistEntry = hydration.find((entry) => this.readNestedValue(entry, ["hydratable"]) === "playlist");
    const playlistTracks = this.readNestedValue(playlistEntry, ["data", "tracks"]);
    const rawTracks = Array.isArray(playlistTracks) ? playlistTracks : [];
    const directArtworkUrl = this.extractFirstUsableTrackArtworkUrl(rawTracks);
    if (directArtworkUrl) return directArtworkUrl;

    const apiClientEntry = hydration.find((entry) => this.readNestedValue(entry, ["hydratable"]) === "apiClient");
    const clientId = String(this.readNestedValue(apiClientEntry, ["data", "id"]) || "");
    if (!clientId) return undefined;
    const trackIds = rawTracks
      .map((track: unknown) => this.readNestedValue(track, ["id"]))
      .filter((id: unknown): id is string | number => typeof id === "string" || typeof id === "number")
      .map((id: string | number) => String(id))
      .filter(Boolean)
      .slice(0, 12);
    if (trackIds.length === 0) return undefined;

    try {
      const endpoint = `https://api-v2.soundcloud.com/tracks?ids=${encodeURIComponent(trackIds.join(","))}&client_id=${encodeURIComponent(clientId)}`;
      const response = await requestUrl({
        url: endpoint,
        method: "GET",
        headers: { Accept: "application/json" },
        throw: false
      });
      if (response.status >= 400) return undefined;
      const hydratedTracks = Array.isArray(response.json) ? response.json : JSON.parse(response.text || "[]");
      return this.extractFirstUsableTrackArtworkUrl(hydratedTracks);
    } catch {
      return undefined;
    }
  }

  private extractSoundCloudHydration(html: string): unknown[] {
    const match = html.match(/window\.__sc_hydration\s*=\s*([\s\S]*?);<\/script>/);
    if (!match?.[1]) return [];
    try {
      const data: unknown = JSON.parse(match[1]);
      return Array.isArray(data) ? data : [];
    } catch {
      return [];
    }
  }

  private extractFirstUsableTrackArtworkUrl(rawTracks: unknown[]): string | undefined {
    for (const track of rawTracks) {
      const candidates = [
        this.readNestedValue(track, ["artwork_url"]),
        this.readNestedValue(track, ["artworkUrl"]),
        this.readNestedValue(track, ["artwork", "url"]),
        this.readNestedValue(track, ["artwork", "uri"]),
        this.readNestedValue(track, ["visuals", "visuals", 0, "visual_url"]),
        this.readNestedValue(track, ["visuals", "visuals", 0, "url"])
      ];
      for (const candidate of candidates) {
        const artworkUrl = normalizeSoundCloudArtworkUrl(typeof candidate === "string" ? candidate : "");
        if (artworkUrl) return artworkUrl;
      }
    }
    return undefined;
  }

  private readNestedValue(source: unknown, path: Array<string | number>): unknown {
    let current = source;
    for (const part of path) {
      if (current == null || (typeof current !== "object" && !Array.isArray(current))) return undefined;
      current = (current as Record<string | number, unknown>)[part];
    }
    return current;
  }


  fallbackItemFromUrl(url: string, categories: string[], source: "curated" | "user"): CatalogItem {
    const normalizedUrl = normalizeSoundCloudUrl(url);
    const parsed = new URL(normalizedUrl);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const artist = parts[0] ? parts[0].replace(/[-_]+/g, " ") : "SoundCloud";
    const rawTitle = parts.includes("sets") ? parts[parts.indexOf("sets") + 1] : parts[1] || parts[0] || "SoundCloud link";
    const title = rawTitle ? rawTitle.replace(/[-_]+/g, " ") : "SoundCloud link";
    const cleanCategories = [...new Set(categories.map((category) => category.trim()).filter(Boolean))].slice(0, 6);
    const cleanArtist = artist.charAt(0).toUpperCase() + artist.slice(1);
    const cleanTitleText = title.charAt(0).toUpperCase() + title.slice(1);
    return {
      id: `soundcloud-${slugify(parsed.hostname + parsed.pathname)}`,
      provider: "soundcloud",
      type: inferSoundCloudType(normalizedUrl),
      title: cleanTitleText,
      displayTitle: makeDisplayTitle(cleanTitleText, cleanArtist, cleanCategories, ["metadata-fallback"]),
      artist: cleanArtist,
      url: normalizedUrl,
      categories: cleanCategories,
      tags: ["metadata-fallback"],
      source,
      addedAt: today(),
      verifiedAt: today(),
      status: "active"
    };
  }

  itemFromOEmbed(url: string, data: OEmbedResponse, categories: string[], source: "curated" | "user"): CatalogItem {
    const artist = (data.author_name || "SoundCloud").trim();
    const title = cleanTitle(data.title || "Untitled", artist);
    const normalizedUrl = normalizeSoundCloudUrl(url);
    const cleanCategories = [...new Set(categories.map((category) => category.trim()).filter(Boolean))].slice(0, 6);
    const artworkUrl = normalizeSoundCloudArtworkUrl(data.thumbnail_url);
    return {
      id: `soundcloud-${slugify(new URL(normalizedUrl).pathname)}`,
      provider: "soundcloud",
      type: this.inferType(normalizedUrl, data.html),
      title,
      displayTitle: makeDisplayTitle(title, artist, cleanCategories),
      artist,
      url: normalizedUrl,
      ...(artworkUrl ? { artworkUrl } : {}),
      ...(data.author_url ? { authorUrl: data.author_url } : {}),
      categories: cleanCategories,
      tags: [],
      source,
      addedAt: today(),
      verifiedAt: today(),
      status: "active"
    };
  }


  private inferType(url: string, html?: string): CatalogItem["type"] {
    if (html?.includes("api.soundcloud.com%2Fplaylists") || html?.includes("api.soundcloud.com/playlists")) return "playlist";
    if (html?.includes("api.soundcloud.com%2Ftracks") || html?.includes("api.soundcloud.com/tracks")) return "track";
    if (html?.includes("api.soundcloud.com%2Fusers") || html?.includes("api.soundcloud.com/users")) return "profile";
    return inferSoundCloudType(url);
  }

  private userCatalog(): CatalogFile {
    return { version: 1, updatedAt: today(), items: this.orderUserItems(this.settings.userItems || []) };
  }

  private mergeCatalogs(...catalogs: Array<CatalogFile | null | undefined>): CatalogFile {
    const byUrl = new Map<string, CatalogItem>();
    let updatedAt = BUNDLED_CATALOG.updatedAt;
    for (const catalog of catalogs) {
      if (!catalog) continue;
      if (catalog.updatedAt > updatedAt) updatedAt = catalog.updatedAt;
      for (const item of catalog.items || []) {
        try {
          const url = normalizeSoundCloudUrl(item.url).toLowerCase();
          // Later catalogs intentionally override earlier ones:
          // bundled fallback < remote catalog < local user links.
          byUrl.set(url, this.normalizeItem(item));
        } catch {
          // Ignore invalid remote items.
        }
      }
    }
    const items = this.removeDuplicatePlaylistItems([...byUrl.values()]);
    items.sort((a, b) => {
      const ca = (a.categories[0] || "").localeCompare(b.categories[0] || "");
      if (ca !== 0) return ca;
      return (a.displayTitle || a.title).localeCompare(b.displayTitle || b.title);
    });
    return { version: 1, updatedAt, items };
  }

  private normalizeCatalog(data: Partial<CatalogFile>, defaultSource: "curated" | "user"): CatalogFile {
    return {
      version: Number(data.version || 1),
      updatedAt: String(data.updatedAt || today()),
      items: (data.items || []).map((item) => this.normalizeItem(item, defaultSource))
    };
  }

  private normalizeItem(item: Partial<CatalogItem>, defaultSource: "curated" | "user" = "curated"): CatalogItem {
    const url = normalizeSoundCloudUrl(item.url || "");
    const title = item.title || "Untitled";
    const artist = item.artist || "SoundCloud";
    const categories = Array.isArray(item.categories) && item.categories.length > 0 ? item.categories : ["Focus"];
    const tags = Array.isArray(item.tags) ? item.tags : [];
    const artworkUrl = normalizeSoundCloudArtworkUrl(item.artworkUrl);
    return {
      id: item.id || `soundcloud-${slugify(new URL(url).pathname)}`,
      provider: "soundcloud",
      type: item.type || inferSoundCloudType(url),
      title,
      displayTitle: normalizeDisplayTitle(item.displayTitle || "") || makeDisplayTitle(title, artist, categories, tags),
      artist,
      url,
      ...(artworkUrl ? { artworkUrl } : {}),
      ...(item.authorUrl ? { authorUrl: item.authorUrl } : {}),
      categories,
      tags,
      source: item.source || defaultSource,
      addedAt: item.addedAt || today(),
      verifiedAt: item.verifiedAt || today(),
      status: item.status || "active",
      ...this.normalizePopularityFields(item as Record<string, unknown>),
      ...(item.soundcloudTrackCount !== undefined && Number.isFinite(Number(item.soundcloudTrackCount)) ? { soundcloudTrackCount: Math.max(0, Math.floor(Number(item.soundcloudTrackCount))) } : {}),
      ...(item.popularityConfidence && ["none", "low", "medium", "high"].includes(item.popularityConfidence) ? { popularityConfidence: item.popularityConfidence } : {}),
      ...(item.popularityUpdatedAt ? { popularityUpdatedAt: String(item.popularityUpdatedAt) } : {})
    };
  }

  private normalizePopularityFields(item: Record<string, unknown>): Partial<CatalogItem> {
    const out: Record<string, number> = {};
    for (const key of POPULARITY_FIELD_NAMES) {
      const value = Number(item[key]);
      if (Number.isFinite(value) && value > 0) out[key] = value;
    }
    return out as Partial<CatalogItem>;
  }

  private validateRemoteCatalogUrl(url: string): string {
    const parsed = new URL(url);
    const isLocalHttp = parsed.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (parsed.protocol !== "https:" && !isLocalHttp) {
      throw new Error("Remote catalog URL must use HTTPS.");
    }
    return parsed.toString();
  }

  private removeDuplicatePlaylistItems(items: CatalogItem[]): CatalogItem[] {
    const activeDuplicateKeys = new Map<string, CatalogItem[]>();
    for (const item of items) {
      const key = this.getPlaylistDuplicateKey(item);
      if (!key || item.status !== "active") continue;
      const group = activeDuplicateKeys.get(key) || [];
      group.push(item);
      activeDuplicateKeys.set(key, group);
    }

    const hiddenDuplicateIds = new Set<string>();
    for (const group of activeDuplicateKeys.values()) {
      if (group.length <= 1) continue;
      const keep = group.slice().sort((a, b) => this.getDuplicateKeeperScore(b) - this.getDuplicateKeeperScore(a))[0];
      for (const item of group) {
        if (item.id !== keep.id) hiddenDuplicateIds.add(item.id);
      }
    }

    return hiddenDuplicateIds.size === 0
      ? items
      : items.filter((item) => !hiddenDuplicateIds.has(item.id));
  }

  private getPlaylistDuplicateKey(item: CatalogItem): string {
    if (item.type !== "playlist" || item.status !== "active") return "";
    const artistKey = normalizePlaylistText(item.artist || "").replace(/\s+\d{1,4}$/, "");
    const titleKey = this.normalizeDuplicatePlaylistTitle(item.title || item.displayTitle || "");
    if (!artistKey || !titleKey || ["soundcloud", "unknown", "unknown artist", "unknown curator", "user"].includes(artistKey)) return "";
    const trackCount = Number(item.soundcloudTrackCount || 0);
    const primaryCategory = (item.categories || [])
      .map(normalizePlaylistText)
      .find((category) => category && category !== "editors choice" && category !== "recent" && category !== "community") || "";
    if (trackCount > 0) return `${artistKey}::${titleKey}::tracks:${Math.floor(trackCount)}`;
    const wordCount = titleKey.split(" ").filter(Boolean).length;
    if (wordCount < 1) return "";
    return `${artistKey}::${titleKey}::category:${primaryCategory}`;
  }

  private normalizeDuplicatePlaylistTitle(value: string): string {
    return normalizePlaylistText(value)
      .split(" ")
      .filter((word) => word && !DUPLICATE_TITLE_STOP_WORDS.has(word))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
  }

  private getDuplicateKeeperScore(item: CatalogItem): number {
    const raw = item as unknown as Record<string, unknown>;
    const popularity = POPULARITY_FIELD_NAMES
      .map((field) => Number(raw[field] || 0))
      .filter((value) => Number.isFinite(value) && value > 0)
      .reduce((sum, value) => sum + Math.log10(value + 1), 0);
    return (item.source === "curated" ? 20 : 0)
      + (item.artworkUrl ? 8 : 0)
      + (item.soundcloudTrackCount ? 5 : 0)
      + popularity;
  }

  private validateCatalog(catalog: CatalogFile): string[] {
    const errors: string[] = [];
    if (!catalog || typeof catalog !== "object") errors.push("catalog must be an object");
    if (typeof catalog.version !== "number") errors.push("version must be a number");
    if (typeof catalog.updatedAt !== "string") errors.push("updatedAt must be a string");
    if (!Array.isArray(catalog.items)) errors.push("items must be an array");
    const ids = new Set<string>();
    const urls = new Set<string>();
    const duplicateKeys = new Map<string, CatalogItem>();
    for (const [index, item] of catalog.items.entries()) {
      if (item.provider !== "soundcloud") errors.push(`items[${index}].provider must be soundcloud`);
      if (!["track", "playlist", "profile", "album", "unknown"].includes(item.type)) errors.push(`items[${index}].type invalid`);
      if (!["curated", "user"].includes(item.source)) errors.push(`items[${index}].source invalid`);
      if (!["active", "broken", "hidden"].includes(item.status)) errors.push(`items[${index}].status invalid`);
      if (!item.title) errors.push(`items[${index}].title is required`);
      if (!item.artist) errors.push(`items[${index}].artist is required`);
      if (!Array.isArray(item.categories) || item.categories.length === 0) errors.push(`items[${index}].categories is required`);
      if (!Array.isArray(item.tags)) errors.push(`items[${index}].tags must be an array`);
      if (item.displayTitle && item.displayTitle.split(/\s+/).filter(Boolean).length > 4) errors.push(`items[${index}].displayTitle should be 4 words or fewer`);
      for (const category of item.categories || []) {
        const key = normalizePlaylistText(category);
        if (LEGACY_BOSSA_CATEGORY_PATTERN.test(String(category))) errors.push(`items[${index}].categories should use Bossa, not ${category}`);
        if (REMOVED_CATEGORY_KEYS.has(key)) errors.push(`items[${index}].categories contains removed category ${category}`);
        if (!VALID_CATEGORY_LABEL_KEYS.has(key)) errors.push(`items[${index}].categories contains unknown category ${category}`);
      }
      if (ids.has(item.id)) errors.push(`items[${index}].id duplicate`);
      ids.add(item.id);
      try {
        const normalized = normalizeSoundCloudUrl(item.url).toLowerCase();
        if (urls.has(normalized)) errors.push(`items[${index}].url duplicate`);
        urls.add(normalized);
        if (item.status === "active") assertEmbeddableSoundCloudUrl(item.url);
      } catch (error) {
        errors.push(`items[${index}].url invalid: ${error instanceof Error ? error.message : String(error)}`);
      }
      const duplicateKey = this.getPlaylistDuplicateKey(item);
      const firstDuplicate = duplicateKey ? duplicateKeys.get(duplicateKey) : undefined;
      if (firstDuplicate && item.status === "active") errors.push(`items[${index}] duplicates active playlist ${firstDuplicate.id}`);
      if (duplicateKey && item.status === "active") duplicateKeys.set(duplicateKey, item);
    }
    return errors;
  }
}
