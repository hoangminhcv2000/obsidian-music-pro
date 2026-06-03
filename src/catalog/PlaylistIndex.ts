import type { CatalogItem } from "./types";
import {
  ALL_PLAYLIST_CATEGORIES,
  DEFAULT_PLAYLIST_CATEGORY_ID,
  RECENT_PLAYLIST_CATEGORY_ID,
  comparePlaylistItemsForCategory,
  getPlaylistCategoryIds,
  isEditorsChoice,
  normalizePlaylistText,
  type PlaylistCategoryDefinition
} from "./playlistCategories";

export interface PlaylistIndex {
  items: CatalogItem[];
  byCategory: Map<string, CatalogItem[]>;
  counts: Map<string, number>;
  editorsChoiceItems: CatalogItem[];
  labelsById: Map<string, string[]>;
  searchTextById: Map<string, string>;
}

export function buildPlaylistIndex(
  items: CatalogItem[],
  extraCategories: PlaylistCategoryDefinition[] = [],
  baseCategories: PlaylistCategoryDefinition[] = ALL_PLAYLIST_CATEGORIES
): PlaylistIndex {
  const categoryDefinitions = [...baseCategories, ...extraCategories];
  const enabledCategoryIds = new Set(categoryDefinitions.map((category) => category.id));
  const definitionsById = new Map(categoryDefinitions.map((category) => [category.id, category]));
  const extraCategoryKeys = extraCategories.map((category) => ({
    id: category.id,
    key: normalizePlaylistText(category.label)
  }));
  const byCategory = new Map<string, CatalogItem[]>();
  const labelsById = new Map<string, string[]>();
  const searchTextById = new Map<string, string>();

  for (const category of categoryDefinitions) {
    if (category.id !== RECENT_PLAYLIST_CATEGORY_ID) byCategory.set(category.id, []);
  }

  const editorsChoiceItems = enabledCategoryIds.has(DEFAULT_PLAYLIST_CATEGORY_ID)
    ? items.filter((item) => isEditorsChoice(item))
    : [];
  if (enabledCategoryIds.has(DEFAULT_PLAYLIST_CATEGORY_ID)) byCategory.set(DEFAULT_PLAYLIST_CATEGORY_ID, editorsChoiceItems);

  const indexedItems: CatalogItem[] = [];

  for (const item of items) {
    const itemCategoryKeys = item.categories.map(normalizePlaylistText);
    const customIds = extraCategoryKeys
      .filter((category) => itemCategoryKeys.includes(category.key))
      .map((category) => category.id);
    const baseIds = getPlaylistCategoryIds(item, enabledCategoryIds);
    const baseAndCustomIds = customIds.length > 0
      ? [...baseIds, ...customIds.filter((id) => !baseIds.includes(id))]
      : baseIds;
    const ids = baseAndCustomIds;
    if (ids.length === 0) continue;
    indexedItems.push(item);
    const labels = ids.map((id) => definitionsById.get(id)?.label || id);
    labelsById.set(item.id, labels);
    searchTextById.set(item.id, normalizePlaylistText([
      item.displayTitle || "",
      item.title,
      item.artist,
      item.url,
      ...item.categories,
      ...item.tags,
      ...labels
    ].join(" ")));

    for (const id of ids) {
      if (id === DEFAULT_PLAYLIST_CATEGORY_ID) continue;
      const bucket = byCategory.get(id);
      if (bucket) bucket.push(item);
    }
  }

  const counts = new Map<string, number>();
  for (const category of categoryDefinitions) {
    if (category.id === RECENT_PLAYLIST_CATEGORY_ID) continue;
    const bucket = byCategory.get(category.id);
    if (bucket) bucket.sort((a, b) => comparePlaylistItemsForCategory(category.id, a, b));
    counts.set(category.id, bucket?.length || 0);
  }
  editorsChoiceItems.sort((a, b) => comparePlaylistItemsForCategory(DEFAULT_PLAYLIST_CATEGORY_ID, a, b));

  return {
    items: indexedItems,
    byCategory,
    counts,
    editorsChoiceItems,
    labelsById,
    searchTextById
  };
}
