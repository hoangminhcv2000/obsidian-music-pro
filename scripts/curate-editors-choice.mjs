#!/usr/bin/env node
import { readCatalog, validateCatalog, writeCatalog } from "./catalog-utils.mjs";
import { compareCatalogItemsForCategory } from "./playlist-category-rules.mjs";

const perCategoryArg = process.argv.find((arg) => arg.startsWith("--per-category="));
const perCategory = Math.max(1, Number(perCategoryArg?.split("=")[1] || 3));
const dryRun = process.argv.includes("--dry-run");
const editorLabel = "Editor's Choice";

const catalog = await readCatalog();
const categories = [
  "Ambience",
  "Jazz & Blues",
  "Orchestra",
  "Piano",
  "Movies/Games",
  "Handpan & Kalimba",
  "House",
  "Acoustic",
  "Fantasy Folk",
  "Bossa",
  "Asia",
  "Middle East"
];

const picked = new Set();
for (const category of categories) {
  const candidates = catalog.items
    .filter((item) => item.status === "active" && item.type === "playlist" && item.categories.includes(category))
    .sort((a, b) => compareCatalogItemsForCategory(a, b, category));
  for (const item of candidates.slice(0, perCategory)) picked.add(item.id);
}

let changed = 0;
catalog.items = catalog.items.map((item) => {
  if (!picked.has(item.id) || item.categories.includes(editorLabel)) return item;
  changed++;
  return { ...item, categories: [editorLabel, ...item.categories] };
});

console.log(`Editor's Choice candidates: ${picked.size}; newly marked: ${changed}${dryRun ? " (dry run)" : ""}.`);
if (dryRun || changed === 0) process.exit(0);

const normalized = await writeCatalog(catalog);
const errors = validateCatalog(normalized);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("Editor's Choice updated.");
