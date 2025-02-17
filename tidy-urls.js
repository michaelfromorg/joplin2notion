/**
 * Notion Database URL Cleaner
 *
 * Processes multiple Notion databases and cleans URL properties using the URL cleaner utility.
 * Provides a dry run option and detailed reporting of changes.
 */

import { Client } from "@notionhq/client";
import dotenv from "dotenv";
import { cleanUrl } from "./lib/urls.js";

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// Comma-separated list of database IDs in .env
const DATABASE_IDS = process.env.NOTION_DATABASE_IDS.split(",");

// Configuration for URL cleaning
const CLEANING_OPTIONS = {
  tryHttps: true,
  removeWww: true,
  removeTrailingSlash: true,
  removeFragment: true,
  removeTracking: true,
  sortParams: true,
  removeEmptyParams: true,
  removeDefaultPorts: true,
};

/**
 * Finds URL properties in a database schema
 * @param {Object} schema - Notion database schema
 * @returns {Array} Array of URL property IDs
 */
function findUrlProperties(schema) {
  const urlProps = [];
  for (const [propertyId, property] of Object.entries(schema)) {
    if (property.type === "url") {
      urlProps.push({
        id: propertyId,
        name: property.name,
      });
    }
  }
  return urlProps;
}

/**
 * Gets all pages from a database
 * @param {string} databaseId - Notion database ID
 * @returns {Promise<Array>} Array of pages
 */
async function getAllPages(databaseId) {
  let pages = [];
  let hasMore = true;
  let startCursor = undefined;

  while (hasMore) {
    const response = await notion.databases.query({
      database_id: databaseId,
      start_cursor: startCursor,
    });

    pages = pages.concat(response.results);
    hasMore = response.has_more;
    startCursor = response.next_cursor;
  }

  return pages;
}

/**
 * Updates a page's URL property
 * @param {string} pageId - Notion page ID
 * @param {string} propertyId - Property ID to update
 * @param {string} newUrl - New URL value
 * @returns {Promise<void>}
 */
async function updatePageUrl(pageId, propertyId, newUrl) {
  await notion.pages.update({
    page_id: pageId,
    properties: {
      [propertyId]: {
        url: newUrl,
      },
    },
  });
}

/**
 * Processes URLs in Notion databases
 * @param {Object} options - Processing options
 * @returns {Promise<void>}
 */
async function processNotionUrls(options = {}) {
  const {
    dryRun = true, // Default to dry run for safety
    batchSize = 10, // Number of concurrent URL checks
    verbose = true, // Detailed logging
  } = options;

  console.log(`\n=== Notion URL Cleaning ${dryRun ? "(DRY RUN) " : ""}===\n`);

  const stats = {
    totalDatabases: 0,
    totalPages: 0,
    totalUrlsProcessed: 0,
    totalUrlsChanged: 0,
    errors: 0,
  };

  // Process each database
  for (const dbId of DATABASE_IDS) {
    try {
      console.log(`Processing database: ${dbId}`);
      stats.totalDatabases++;

      // Get database schema and find URL properties
      const database = await notion.databases.retrieve({
        database_id: dbId,
      });
      const urlProperties = findUrlProperties(database.properties);

      if (urlProperties.length === 0) {
        console.log("No URL properties found in this database, skipping...\n");
        continue;
      }

      // Get all pages from this database
      const pages = await getAllPages(dbId);
      stats.totalPages += pages.length;

      console.log(
        `Found ${pages.length} pages with ${urlProperties.length} URL properties each`
      );

      // Process pages in batches
      for (let i = 0; i < pages.length; i += batchSize) {
        const batch = pages.slice(i, i + batchSize);
        const batchPromises = batch.flatMap((page) => {
          return urlProperties.map(async (prop) => {
            try {
              const currentUrl = page.properties[prop.id]?.url;
              if (!currentUrl) return;

              stats.totalUrlsProcessed++;

              // Clean the URL
              const cleaned = await cleanUrl(currentUrl, CLEANING_OPTIONS);

              if (cleaned.cleaned !== currentUrl) {
                stats.totalUrlsChanged++;

                if (verbose) {
                  console.log(`\nPage: ${page.url}`);
                  console.log(`Property: ${prop.name}`);
                  console.log(`Original: ${currentUrl}`);
                  console.log(`Cleaned:  ${cleaned.cleaned}`);
                  console.log("Changes:");
                  cleaned.changes.forEach((change) =>
                    console.log(`- ${change}`)
                  );
                }

                if (!dryRun) {
                  await updatePageUrl(page.id, prop.id, cleaned.cleaned);
                  if (verbose) console.log("✅ Updated in Notion");
                }
              }
            } catch (error) {
              stats.errors++;
              console.error(`Error processing ${page.url}:`, error.message);
            }
          });
        });

        // Wait for batch to complete
        await Promise.all(batchPromises);
      }
    } catch (error) {
      stats.errors++;
      console.error(`Error processing database ${dbId}:`, error.message);
    }
  }

  // Print summary
  console.log("\n=== Summary ===");
  console.log(`Databases processed: ${stats.totalDatabases}`);
  console.log(`Pages processed: ${stats.totalPages}`);
  console.log(`URLs processed: ${stats.totalUrlsProcessed}`);
  console.log(`URLs changed: ${stats.totalUrlsChanged}`);
  console.log(`Errors encountered: ${stats.errors}`);

  if (dryRun && stats.totalUrlsChanged > 0) {
    console.log("\n⚠️  This was a dry run. No changes were made to Notion.");
    console.log("Run with {dryRun: false} to apply changes.");
  }
}

// Run the script
const options = {
  dryRun: true, // Set to false to actually update Notion
  verbose: true, // Set to false for less output
  batchSize: 10, // Adjust based on your rate limit needs
};

processNotionUrls(options).catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
