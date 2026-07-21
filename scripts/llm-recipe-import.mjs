#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith('--') && arg.includes('='))
    .map((arg) => {
      const [key, ...value] = arg.slice(2).split('=');
      return [key, value.join('=')];
    })
);

const sourceUrl = args.get('url') || process.env.RECIPE_URL || '';
const textFile = args.get('text-file') || '';
const outputSlug = args.get('slug') || process.env.RECIPE_SLUG || '';
const model = process.env.OPENAI_MODEL || 'gpt-5.6-luna';
const today = new Date().toISOString().slice(0, 10);

if (!process.env.OPENAI_API_KEY) {
  throw new Error('OPENAI_API_KEY is required.');
}

function slugify(value) {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}

function cleanText(value) {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

async function loadRecipeInput() {
  const pastedText = process.env.RECIPE_TEXT?.trim();
  if (pastedText) return { text: pastedText, fetchError: null };
  if (textFile) return { text: await readFile(textFile, 'utf8'), fetchError: null };
  if (!sourceUrl) {
    throw new Error('Provide RECIPE_URL, RECIPE_TEXT, --url=..., or --text-file=...');
  }

  const response = await fetch(sourceUrl, {
    headers: {
      'user-agent': 'Recipe Shelf importer (+https://github.com/)'
    }
  });

  if (!response.ok) {
    return {
      text: '',
      fetchError: `Could not fetch ${sourceUrl}: ${response.status} ${response.statusText}`
    };
  }

  return { text: cleanText(await response.text()).slice(0, 50000), fetchError: null };
}

const recipeSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'description',
    'originalServings',
    'categories',
    'tags',
    'cuisine',
    'dietary',
    'goesWith',
    'ingredients',
    'instructions',
    'notes',
    'source',
    'image'
  ],
  properties: {
    title: { type: 'string' },
    description: { type: 'string' },
    originalServings: { type: 'number' },
    categories: { type: 'array', items: { type: 'string' } },
    tags: { type: 'array', items: { type: 'string' } },
    cuisine: { type: 'string' },
    dietary: { type: 'array', items: { type: 'string' } },
    goesWith: { type: 'array', items: { type: 'string' } },
    ingredients: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'ingredients'],
        properties: {
          title: { type: 'string' },
          ingredients: {
            type: 'array',
            minItems: 1,
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['name', 'quantity', 'unit', 'notes', 'optional'],
              properties: {
                name: { type: 'string' },
                quantity: { type: ['number', 'null'] },
                unit: { type: ['string', 'null'] },
                notes: { type: 'string' },
                optional: { type: 'boolean' }
              }
            }
          }
        }
      }
    },
    instructions: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['text', 'timerMinutes'],
        properties: {
          text: { type: 'string' },
          timerMinutes: { type: ['number', 'null'] }
        }
      }
    },
    notes: { type: 'string' },
    source: {
      type: 'object',
      additionalProperties: false,
      required: ['title', 'author', 'website', 'url', 'accessed'],
      properties: {
        title: { type: 'string' },
        author: { type: 'string' },
        website: { type: 'string' },
        url: { type: 'string' },
        accessed: { type: 'string' }
      }
    },
    image: { type: 'string' }
  }
};

function yamlString(value) {
  return JSON.stringify(value ?? '');
}

function yamlArray(values, indent = '') {
  if (!values?.length) return `${indent}[]`;
  return values.map((value) => `${indent}- ${yamlString(value)}`).join('\n');
}

function recipeToMarkdown(recipe) {
  const ingredientYaml = recipe.ingredients
    .map((group) => {
      const ingredients = group.ingredients
        .map((ingredient) => {
          const lines = [
            `      - name: ${yamlString(ingredient.name)}`,
            `        quantity: ${ingredient.quantity === null ? 'null' : ingredient.quantity}`,
            `        unit: ${ingredient.unit === null ? 'null' : yamlString(ingredient.unit)}`
          ];
          if (ingredient.notes) lines.push(`        notes: ${yamlString(ingredient.notes)}`);
          if (ingredient.optional) lines.push('        optional: true');
          return lines.join('\n');
        })
        .join('\n');
      return `  - title: ${yamlString(group.title)}\n    ingredients:\n${ingredients}`;
    })
    .join('\n');

  const instructionYaml = recipe.instructions
    .map((step) => {
      const lines = [`  - text: ${yamlString(step.text)}`];
      if (step.timerMinutes) lines.push(`    timerMinutes: ${step.timerMinutes}`);
      return lines.join('\n');
    })
    .join('\n');

  return `---
title: ${yamlString(recipe.title)}
description: ${yamlString(recipe.description)}
originalServings: ${recipe.originalServings || 4}
categories:
${yamlArray(recipe.categories, '  ')}
tags:
${yamlArray(recipe.tags, '  ')}
cuisine: ${yamlString(recipe.cuisine)}
dietary:
${yamlArray(recipe.dietary, '  ')}
goesWith:
${yamlArray(recipe.goesWith, '  ')}
ingredients:
${ingredientYaml}
instructions:
${instructionYaml}
notes: ${yamlString(recipe.notes)}
source:
  title: ${yamlString(recipe.source.title || recipe.title)}
  author: ${yamlString(recipe.source.author)}
  website: ${yamlString(recipe.source.website)}
  url: ${yamlString(recipe.source.url || sourceUrl)}
  accessed: ${yamlString(recipe.source.accessed || today)}
image: ${yamlString(recipe.image)}
created: ${today}
updated: ${today}
---
`;
}

function blockedUrlDraftMarkdown(fetchError) {
  const url = new URL(sourceUrl);
  return `---
title: ${yamlString(outputSlug ? outputSlug.replace(/-/g, ' ') : 'Blocked recipe import')}
description: "Recipe draft created because the source website blocked GitHub Actions from fetching the page."
originalServings: 4
categories:
  - "Draft"
tags:
  - "needs-paste"
cuisine: ""
dietary: []
goesWith: []
ingredients:
  - title: "Ingredients"
    ingredients:
      - name: "Paste recipe text into the Import recipe draft workflow"
        quantity: null
        unit: null
instructions:
  - text: "Open the original recipe URL, copy the recipe ingredients and method, then rerun Import recipe draft using recipe_text instead of recipe_url."
notes: ${yamlString(`${fetchError}. Some sites block automated fetches from GitHub Actions. Use recipe_text for this source.`)}
source:
  title: "Original recipe"
  author: ""
  website: ${yamlString(url.hostname)}
  url: ${yamlString(sourceUrl)}
  accessed: ${yamlString(today)}
image: ""
created: ${today}
updated: ${today}
---
`;
}

const { text: recipeInput, fetchError } = await loadRecipeInput();
if (fetchError) {
  const slug = outputSlug || slugify(new URL(sourceUrl).pathname.split('/').filter(Boolean).at(-1) || 'blocked-recipe');
  const fileName = slug.startsWith('_draft-') ? `${slug}.md` : `_draft-${slug}.md`;
  const outputPath = join(process.cwd(), 'src/content/recipes', fileName);
  await mkdir(join(process.cwd(), 'src/content/recipes'), { recursive: true });
  await writeFile(outputPath, blockedUrlDraftMarkdown(fetchError), 'utf8');
  console.log(`Created blocked-source draft: ${outputPath}`);
  console.log(fetchError);
  process.exit(0);
}

const response = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    model,
    store: false,
    input: [
      {
        role: 'developer',
        content:
          'Convert recipes into the Recipe Shelf JSON schema. Preserve cups, tbsp and tsp as measuring units. Convert ounces and pounds to grams. Keep quantities numeric where possible, or null for text-only amounts. Rewrite method steps so ingredient amounts are included directly in the instruction text. Add timerMinutes for timed cooking/mixing/resting steps. Do not invent ingredients. If uncertain, put a short warning in notes.'
      },
      {
        role: 'user',
        content: `Source URL: ${sourceUrl || 'pasted text'}\nAccessed: ${today}\n\nRecipe content:\n${recipeInput}`
      }
    ],
    text: {
      format: {
        type: 'json_schema',
        name: 'recipe_shelf_recipe',
        strict: true,
        schema: recipeSchema
      }
    }
  })
});

if (!response.ok) {
  throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
}

const result = await response.json();
const outputText =
  result.output_text ??
  result.output
    ?.flatMap((item) => item.content ?? [])
    .find((content) => content.type === 'output_text')?.text;

if (!outputText) {
  throw new Error('OpenAI response did not contain output text.');
}

const recipe = JSON.parse(outputText);
const slug = outputSlug || slugify(recipe.title);
const fileName = slug.startsWith('_draft-') ? `${slug}.md` : `_draft-${slug}.md`;
const outputPath = join(process.cwd(), 'src/content/recipes', fileName);

await mkdir(join(process.cwd(), 'src/content/recipes'), { recursive: true });
await writeFile(outputPath, recipeToMarkdown(recipe), 'utf8');

console.log(`Created ${outputPath}`);
