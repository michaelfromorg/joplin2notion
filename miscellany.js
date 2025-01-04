import { Client } from '@notionhq/client';
import fs from 'fs/promises';
import { parse } from 'yaml';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const notion = new Client({
  auth: process.env.NOTION_TOKEN
});

const DATABASE_ID = process.env.NOTION_DATABASE_ID;
const JOPLIN_DIR = "/mnt/c/Users/mdema/Documents/Joplin/Archive/Notion";

// Function to parse front matter and content from markdown
async function parseMarkdownFile(filePath) {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const frontMatterRegex = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/;
    const match = content.match(frontMatterRegex);
    
    if (!match) {
      return null;
    }

    const [_, frontMatterString, markdownContent] = match;
    const frontMatter = parse(frontMatterString);
    
    return {
      frontMatter,
      content: markdownContent.trim()
    };
  } catch (error) {
    console.error(`Error parsing file ${filePath}:`, error);
    return null;
  }
}

// Convert markdown content to Notion blocks
function markdownToNotionBlocks(content) {
  const blocks = [];
  const lines = content.split('\n');

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    // Handle heading
    if (line.startsWith('# ')) {
      blocks.push({
        type: 'heading_1',
        heading_1: {
          rich_text: [{
            type: 'text',
            text: { content: line.slice(2) }
          }]
        }
      });
      continue;
    }

    // Handle regular text and key-value pairs
    if (line.includes(': ')) {
      const [key, value] = line.split(': ').map(part => part.trim());
      blocks.push({
        type: 'paragraph',
        paragraph: {
          rich_text: [
            {
              type: 'text',
              text: { content: key + ': ' },
              annotations: { bold: true }
            },
            {
              type: 'text',
              text: { content: value }
            }
          ]
        }
      });
    } else {
      blocks.push({
        type: 'paragraph',
        paragraph: {
          rich_text: [{
            type: 'text',
            text: { content: line }
          }]
        }
      });
    }
  }

  return blocks;
}

async function createNotionPage(data) {
  try {
    const response = await notion.pages.create({
      parent: {
        database_id: DATABASE_ID
      },
      properties: {
        // Title property
        'Title': {
          title: [
            {
              text: {
                // Remove UUID pattern at the end of the title
                content: (data.frontMatter.title || 'Untitled').replace(/\s+[a-f0-9]{32}$/i, '')
              }
            }
          ]
        },
        // Completed property
        'Completed?': {
          checkbox: data.frontMatter['completed?'] === 'yes'
        }
      },
      children: markdownToNotionBlocks(data.content)
    });

    console.log(`✅ Successfully imported: ${data.frontMatter.title}`);
    return true;
  } catch (error) {
    console.error(`Failed to import ${data.frontMatter?.title || 'Unknown'}:`, error.message);
    return false;
  }
}

// Function to validate the database schema
async function validateDatabase() {
  try {
    const database = await notion.databases.retrieve({
      database_id: DATABASE_ID
    });

    // Check for required properties
    const properties = database.properties;
    const hasTitle = Object.values(properties).some(prop => prop.type === 'title');
    const hasCompleted = Object.values(properties).some(
      prop => prop.type === 'checkbox' && prop.name === 'Completed?'
    );

    if (!hasTitle || !hasCompleted) {
      throw new Error(
        'Database schema validation failed. Required properties: Title (title), Completed? (checkbox)'
      );
    }

    console.log('✅ Database schema validation passed');
    return true;
  } catch (error) {
    console.error('Database validation error:', error);
    process.exit(1);
  }
}

async function importToNotion() {
  const failedImports = [];

  try {
    // Validate database schema first
    await validateDatabase();

    // Read all files in directory
    const files = await fs.readdir(JOPLIN_DIR);

    for (const file of files) {
      if (!file.endsWith('.md')) continue;

      const filePath = path.join(JOPLIN_DIR, file);
      console.log('Reading', file);
      const data = await parseMarkdownFile(filePath);

      if (data) {
        console.log('Creating Notion page for', file);
        const success = await createNotionPage(data);
        if (!success) {
          failedImports.push({ file, title: data.frontMatter?.title });
        }

        // Add delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      } else {
        failedImports.push({ file, reason: 'Failed to parse markdown' });
      }
    }

    console.log('\nImport completed!');

    if (failedImports.length > 0) {
      console.log('\nFailed imports:');
      failedImports.forEach(({ file, title, reason }) => {
        console.log(`- ${file}${title ? ` (${title})` : ''}${reason ? `: ${reason}` : ''}`);
      });
      console.log(`\nTotal failed imports: ${failedImports.length}`);
    } else {
      console.log('All files were imported successfully!');
    }
  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  }
}

// Main execution
async function main() {
  // Validate environment variables
  if (!process.env.NOTION_TOKEN || !process.env.NOTION_DATABASE_ID) {
    console.error('Error: NOTION_TOKEN and NOTION_DATABASE_ID environment variables are required');
    process.exit(1);
  }

  await importToNotion();
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
