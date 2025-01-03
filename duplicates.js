/**
 * Detect duplicates in a Notion DB.
 * 
 * Checks the title and URL properties of a Notion database for duplicates.
 */
import { Client } from '@notionhq/client';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_TOKEN
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;

// Function to normalize URLs for comparison
function normalizeUrl(url) {
  try {
    const urlObj = new URL(url);
    // Remove common variations
    let normalized = urlObj.href
      .replace(/^https?:\/\//, '')  // Remove protocol
      .replace(/^www\./, '')        // Remove www
      .replace(/\/$/, '');          // Remove trailing slash
    
    // Remove UTM parameters and other common tracking params
    const cleanUrl = new URL(url);
    const searchParams = new URLSearchParams(cleanUrl.search);
    const paramsToRemove = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'fbclid', 'ref'];
    
    paramsToRemove.forEach(param => searchParams.delete(param));
    cleanUrl.search = searchParams.toString();
    
    return normalized;
  } catch (error) {
    return url; // Return original if URL is invalid
  }
}

// Function to find URL property in database schema
async function findUrlProperty(schema) {
  for (const [propertyId, property] of Object.entries(schema)) {
    if (property.type === 'url') {
      return propertyId;
    }
  }
  return null;
}

async function detectDuplicates() {
  try {
    // Get database schema
    const database = await notion.databases.retrieve({
      database_id: DATABASE_ID
    });

    // Get title property ID (every database has a title property)
    const titlePropertyId = Object.entries(database.properties)
      .find(([_, prop]) => prop.type === 'title')[0];

    // Find URL property if it exists
    const urlPropertyId = await findUrlProperty(database.properties);

    // Query all pages in the database
    let pages = [];
    let hasMore = true;
    let startCursor = undefined;

    while (hasMore) {
      const response = await notion.databases.query({
        database_id: DATABASE_ID,
        start_cursor: startCursor,
      });

      pages = pages.concat(response.results);
      hasMore = response.has_more;
      startCursor = response.next_cursor;
    }

    // Process pages for duplicates
    const titleMap = new Map();
    const urlMap = new Map();
    const duplicates = {
      titles: [],
      urls: []
    };

    pages.forEach(page => {
      // Check title duplicates
      const titleContent = page.properties[titlePropertyId].title
        .map(text => text.plain_text)
        .join('')
        .toLowerCase()
        .trim();

      if (titleContent) {
        if (titleMap.has(titleContent)) {
          duplicates.titles.push({
            title: titleContent,
            pages: [titleMap.get(titleContent), page.url]
          });
        } else {
          titleMap.set(titleContent, page.url);
        }
      }

      // Check URL duplicates if URL property exists
      if (urlPropertyId) {
        const url = page.properties[urlPropertyId].url;
        if (url) {
          const normalizedUrl = normalizeUrl(url);
          if (urlMap.has(normalizedUrl)) {
            duplicates.urls.push({
              originalUrls: [urlMap.get(normalizedUrl).original, url],
              normalizedUrl,
              pages: [urlMap.get(normalizedUrl).page, page.url]
            });
          } else {
            urlMap.set(normalizedUrl, { original: url, page: page.url });
          }
        }
      }
    });

    // Report findings
    console.log('\n=== Duplicate Detection Report ===\n');
    
    if (duplicates.titles.length === 0 && duplicates.urls.length === 0) {
      console.log('✅ No duplicates found!');
      return;
    }

    if (duplicates.titles.length > 0) {
      console.log('\n🔍 Duplicate Titles Found:');
      duplicates.titles.forEach(dup => {
        console.log(`\nTitle: "${dup.title}"`);
        console.log('Found in pages:');
        dup.pages.forEach(url => console.log(`- ${url}`));
      });
    }

    if (duplicates.urls.length > 0) {
      console.log('\n🔗 Duplicate URLs Found:');
      duplicates.urls.forEach(dup => {
        console.log('\nOriginal URLs:');
        dup.originalUrls.forEach(url => console.log(`- ${url}`));
        console.log(`Normalized as: ${dup.normalizedUrl}`);
        console.log('Found in pages:');
        dup.pages.forEach(url => console.log(`- ${url}`));
      });
    }

  } catch (error) {
    console.error('Error detecting duplicates:', error);
    process.exit(1);
  }
}

// Run the script
detectDuplicates();
