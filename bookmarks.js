// joplin-to-notion.js
import { Client } from "@notionhq/client";
import fs from "fs/promises";
import path from "path";
import yaml from "yaml";

const NOTION_DATABASE_ID = "c13a16f892f140c4b2fcd33a174ebbf3";
const JOPLIN_DIR = "/mnt/c/Users/mdema/Documents/Joplin/Bookmarks/test"; // Directory containing your Markdown files

// Initialize Notion client
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
                content: `Imported from Joplin on ${new Date().toISOString()}`,
              },
            },
          ],
        },
      },
    });

    console.log(`Successfully imported: ${data.title}`);
  } catch (error) {
    console.error(`Failed to import ${data.title}:`, error.message);
  }
}

async function importToNotion() {
  try {
    // Read all files in the directory
    const files = await fs.readdir(JOPLIN_DIR);

    for (const file of files) {
      if (!file.endsWith(".md")) continue;

      const filePath = path.join(JOPLIN_DIR, file);
      console.log("Reading", file);
      const data = await parseMarkdownFile(filePath);

      if (data) {
        console.log("Read data; creating Notion page for", file)
        await createNotionPage(data);
        // Add a small delay to avoid rate limits
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }

    console.log("Import completed!");
  } catch (error) {
    console.error("Import failed:", error);
  }
}

// Run the import
importToNotion();
