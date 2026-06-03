#!/usr/bin/env node
import { readCatalog, validateCatalog, writeCatalog } from "./catalog-utils.mjs";

const catalog = await readCatalog();
const normalized = await writeCatalog(catalog);
const errors = validateCatalog(normalized);
if (errors.length > 0) {
  console.error("Catalog validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Catalog valid: ${normalized.items.length} items.`);
