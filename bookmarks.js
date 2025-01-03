/**
 * A script to import my Joplin bookmark files to my Bookmarks DB in Notion.
 */
import 'dotenv/config';
import { Client } from "@notionhq/client";
import fs from "fs/promises";
import path from "path";
import yaml from "yaml";

const NOTION_DATABASE_ID = "c13a16f892f140c4b2fcd33a174ebbf3";
const JOPLIN_DIR = "/mnt/c/Users/mdema/Documents/Joplin/Bookmarks";

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
});

async function parseMarkdownFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");

  // Extract YAML front matter
  const frontMatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontMatterMatch) return null;

  const [_, frontMatter, markdownContent] = frontMatterMatch;
  const metadata = yaml.parse(frontMatter);

  // Extract URL from content (assuming it's on the first line)
  const url = markdownContent.trim().split("\n")[0];

  return {
    title: metadata.title?.replace(/^["']|["']$/g, ""), // Remove quotes if present
    created: metadata.created,
    updated: metadata.updated,
    url: url,
    source: metadata.source,
  };
}

async function createNotionPage(data) {
  try {
    await notion.pages.create({
      parent: {
        database_id: NOTION_DATABASE_ID,
      },
      properties: {
        Title: {
          title: [
            {
              text: {
                content: data.title || "Untitled",
              },
            },
          ],
        },
        Link: {
          url: data.source || data.url || null,
        },
        Tags: {
          multi_select: [
            {
              name: "joplin",
            },
          ],
        },
        Description: {
          rich_text: [
            {
              text: {
                content: '',
              },
            },
          ],
        },
      },
    });

    console.log(`Successfully imported: ${data.title}`);
    return true;
  } catch (error) {
    console.error(`Failed to import ${data.title}:`, error.message);
    return false;
  }
}

async function importToNotion() {
  const failedImports = [];

  try {
    const files = await fs.readdir(JOPLIN_DIR);

    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const filePath = path.join(JOPLIN_DIR, file);
      console.log("Reading", file);
      const data = await parseMarkdownFile(filePath);

      if (data) {
        console.log("Read data; creating Notion page for", file);
        const success = await createNotionPage(data);
        if (!success) {
          failedImports.push({ file, title: data.title });
        }
        
        // Add a small delay to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 500));
      } else {
        failedImports.push({ file, reason: 'Failed to parse markdown' });
      }
    }

    console.log("\nImport completed!");
    
    if (failedImports.length > 0) {
      console.log("\nFailed imports:");
      failedImports.forEach(({ file, title, reason }) => {
        console.log(`- ${file}${title ? ` (${title})` : ''}${reason ? `: ${reason}` : ''}`);
      });
      console.log(`\nTotal failed imports: ${failedImports.length}`);
    } else {
      console.log("All files were imported successfully!");
    }
  } catch (error) {
    console.error("Import failed:", error);
  }
}

importToNotion();
