#!/usr/bin/env node
import { assertEmbeddableSoundCloudUrl, fetchOEmbed, makeItemFromOEmbed, normalizeSoundCloudUrl, readCatalog, validateCatalog, writeCatalog } from "./catalog-utils.mjs";

function parseArgs(argv) {
  const urls = [];
  const opts = { category: "", categories: [], tags: [], source: "curated" };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--category" || arg === "--mood") opts.category = argv[++i] || opts.category;
    else if (arg === "--categories") opts.categories = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--tags") opts.tags = (argv[++i] || "").split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--source") opts.source = argv[++i] || opts.source;
    else if (!arg.startsWith("--")) urls.push(arg);
  }
  if (opts.categories.length === 0 && opts.category) opts.categories = [opts.category];
  return { urls, opts };
}

const { urls, opts } = parseArgs(process.argv.slice(2));
if (urls.length === 0) {
  console.error("Usage: npm run catalog:add -- <soundcloud-url...> [--category \"Ambience\"] [--tags focus,ambient]");
  process.exit(1);
}

const catalog = await readCatalog();
const existing = new Set(catalog.items.map((item) => normalizeSoundCloudUrl(item.url).toLowerCase()));
let added = 0;
for (const input of urls) {
  try {
    const url = assertEmbeddableSoundCloudUrl(input);
    if (existing.has(url.toLowerCase())) {
      console.log(`Skip duplicate: ${url}`);
      continue;
    }
    const data = await fetchOEmbed(url);
    const item = makeItemFromOEmbed(url, data, opts);
    let id = item.id;
    let suffix = 2;
    while (catalog.items.some((existingItem) => existingItem.id === item.id)) {
      item.id = `${id}-${suffix++}`;
    }
    catalog.items.push(item);
    existing.add(url.toLowerCase());
    added++;
    console.log(`Added: ${item.displayTitle || item.title} — ${item.artist} (${item.categories.join(", ")})`);
  } catch (error) {
    console.error(`Failed: ${input}\n  ${error.message}`);
  }
}

const normalized = await writeCatalog(catalog);
const errors = validateCatalog(normalized);
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`Catalog OK: ${normalized.items.length} items (${added} added).`);
