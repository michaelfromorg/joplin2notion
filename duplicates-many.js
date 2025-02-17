/**
 * Detect duplicates across multiple Notion databases.
 *
 * Checks for duplicates based on normalized URLs and exact title matches
 * across a list of specified Notion databases.
 */
import { Client } from "@notionhq/client";
import dotenv from "dotenv";

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

// Comma-separated list of database IDs in .env
const DATABASE_IDS = process.env.NOTION_DATABASE_IDS.split(",");

// Function to normalize URLs for comparison (kept from original)
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    let normalized = urlObj.href
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/\/$/, "");

    const cleanUrl = new URL(url);
    const searchParams = new URLSearchParams(cleanUrl.search);
    const paramsToRemove = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "ref",
    ];

    paramsToRemove.forEach((param) => searchParams.delete(param));
    cleanUrl.search = searchParams.toString();

    return normalized;
  } catch (error) {
    return url;
  }
}

// Function to find URL property in database schema
async function findUrlProperty(schema) {
  for (const [propertyId, property] of Object.entries(schema)) {
    if (property.type === "url") {
      return propertyId;
    }
  }
  return null;
}

// Function to get all pages from a database
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

// Structure to hold duplicate information
class DuplicateEntry {
  constructor(type, value, pages) {
    this.type = type; // 'title' or 'url'
    this.value = value; // The duplicate value found
    this.pages = new Set(); // Set of page information
  }

  addPage(pageInfo) {
    this.pages.add(JSON.stringify(pageInfo));
  }

  getPages() {
    return Array.from(this.pages).map((p) => JSON.parse(p));
  }
}

async function detectCrossDatabaseDuplicates() {
  try {
    const duplicateMap = new Map(); // Map to store all duplicates
    const processedPages = new Set(); // Track processed pages to avoid duplicate reporting

    // Process each database
    for (const dbId of DATABASE_IDS) {
      console.log(`\nProcessing database: ${dbId}`);

      // Get database schema
      const database = await notion.databases.retrieve({
        database_id: dbId,
      });

      // Get property IDs
      const titlePropertyId = Object.entries(database.properties).find(
        ([_, prop]) => prop.type === "title"
      )[0];
      const urlPropertyId = await findUrlProperty(database.properties);

      // Get all pages from this database
      const pages = await getAllPages(dbId);

      // Process each page
      for (const page of pages) {
        if (processedPages.has(page.id)) continue;

        const pageInfo = {
          id: page.id,
          url: page.url,
          database: dbId,
          databaseTitle: database.title[0]?.plain_text || dbId,
        };

        // Process title
        const titleContent = page.properties[titlePropertyId].title
          .map((text) => text.plain_text)
          .join("")
          .toLowerCase()
          .trim();

        if (titleContent) {
          const titleKey = `title:${titleContent}`;
          if (!duplicateMap.has(titleKey)) {
            duplicateMap.set(
              titleKey,
              new DuplicateEntry("title", titleContent, [])
            );
          }
          duplicateMap.get(titleKey).addPage(pageInfo);
        }

        // Process URL if available
        if (urlPropertyId) {
          const url = page.properties[urlPropertyId].url;
          if (url) {
            const normalizedUrl = normalizeUrl(url);
            const urlKey = `url:${normalizedUrl}`;
            if (!duplicateMap.has(urlKey)) {
              duplicateMap.set(urlKey, new DuplicateEntry("url", url, []));
            }
            duplicateMap.get(urlKey).addPage(pageInfo);
          }
        }

        processedPages.add(page.id);
      }
    }

    // Report findings
    console.log("\n=== Cross-Database Duplicate Detection Report ===\n");

    let duplicatesFound = false;
    const reportedPages = new Set();

    // Function to report duplicates if they haven't been reported yet
    function reportDuplicate(entry) {
      const pages = entry.getPages();
      if (pages.length < 2) return false;

      // Check if we've already reported these pages
      const pageIds = new Set(pages.map((p) => p.id));
      const alreadyReported = Array.from(pageIds).some((id) =>
        reportedPages.has(id)
      );
      if (alreadyReported) return false;

      // Report this group of duplicates
      console.log(
        `\n${entry.type === "title" ? "📝" : "🔗"} Duplicate ${
          entry.type === "title" ? "Title" : "URL"
        } Found:`
      );
      if (entry.type === "title") {
        console.log(`Title: "${entry.value}"`);
      } else {
        console.log(`Normalized URL: ${normalizeUrl(entry.value)}`);
        console.log(`Original URL: ${entry.value}`);
      }

      console.log("\nFound in:");
      pages.forEach((page) => {
        console.log(`- Database: ${page.databaseTitle}`);
        console.log(`  Page: ${page.url}`);
        reportedPages.add(page.id);
      });

      return true;
    }

    // Report duplicates, checking both title and URL matches
    for (const entry of duplicateMap.values()) {
      if (reportDuplicate(entry)) {
        duplicatesFound = true;
      }
    }

    if (!duplicatesFound) {
      console.log("✅ No duplicates found across databases!");
    }
  } catch (error) {
    console.error("Error detecting duplicates:", error);
    process.exit(1);
  }
}

// Run the script
detectCrossDatabaseDuplicates();
