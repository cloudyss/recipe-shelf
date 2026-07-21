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
const provider = process.env.LLM_PROVIDER || 'groq';
const model = process.env.LLM_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const today = new Date().toISOString().slice(0, 10);

if (provider !== 'groq') {
  throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
}

if (!process.env.GROQ_API_KEY) {
  throw new Error('GROQ_API_KEY is required.');
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
  recipe = normalizeRecipe(recipe);
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
${recipe.source.url || sourceUrl ? `  url: ${yamlString(recipe.source.url || sourceUrl)}\n` : ''}  accessed: ${yamlString(recipe.source.accessed || today)}
image: ${yamlString(recipe.image)}
created: ${today}
updated: ${today}
---
`;
}

function parseQuantity(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^\d+\/\d+$/.test(trimmed)) {
    const [top, bottom] = trimmed.split('/').map(Number);
    return bottom ? top / bottom : null;
  }
  if (/^\d+\s+\d+\/\d+$/.test(trimmed)) {
    const [whole, fraction] = trimmed.split(/\s+/, 2);
    const [top, bottom] = fraction.split('/').map(Number);
    return bottom ? Number(whole) + top / bottom : Number(whole);
  }
  return null;
}

function normalizeRecipe(recipe) {
  const normalized = {
    title: cleanText(recipe.title) || 'Imported recipe',
    description: cleanText(recipe.description) || 'Imported recipe draft.',
    originalServings: parseQuantity(recipe.originalServings) || 4,
    categories: Array.isArray(recipe.categories) ? recipe.categories.map(cleanText).filter(Boolean) : ['Imported'],
    tags: Array.isArray(recipe.tags) ? recipe.tags.map(cleanText).filter(Boolean) : ['review-needed'],
    cuisine: cleanText(recipe.cuisine),
    dietary: Array.isArray(recipe.dietary) ? recipe.dietary.map(cleanText).filter(Boolean) : [],
    goesWith: Array.isArray(recipe.goesWith) ? recipe.goesWith.map(slugify).filter(Boolean) : [],
    ingredients: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
    instructions: Array.isArray(recipe.instructions) ? recipe.instructions : [],
    notes: cleanText(recipe.notes),
    source: recipe.source && typeof recipe.source === 'object' ? recipe.source : {},
    image: cleanText(recipe.image)
  };

  normalized.ingredients = normalized.ingredients.map((group) => ({
    title: cleanText(group.title) || 'Ingredients',
    ingredients: Array.isArray(group.ingredients)
      ? group.ingredients.map((ingredient) => ({
          name: cleanText(ingredient.name) || 'Review ingredient',
          quantity: parseQuantity(ingredient.quantity),
          unit: ingredient.unit === null || ingredient.unit === undefined ? null : cleanText(ingredient.unit),
          notes: cleanText(ingredient.notes),
          optional: Boolean(ingredient.optional)
        }))
      : []
  }));

  if (!normalized.ingredients.length || normalized.ingredients.every((group) => !group.ingredients.length)) {
    normalized.ingredients = [
      {
        title: 'Ingredients',
        ingredients: [{ name: 'Review and add ingredients', quantity: null, unit: null, notes: '', optional: false }]
      }
    ];
  }

  normalized.instructions = normalized.instructions.map((step) => ({
    text: cleanText(step.text ?? step) || 'Review and add method step.',
    timerMinutes: parseQuantity(step.timerMinutes)
  }));

  if (!normalized.instructions.length) {
    normalized.instructions = [{ text: 'Review and add method steps.', timerMinutes: null }];
  }

  normalized.source = {
    title: cleanText(normalized.source.title) || normalized.title,
    author: cleanText(normalized.source.author),
    website: cleanText(normalized.source.website),
    url: cleanText(normalized.source.url || sourceUrl),
    accessed: cleanText(normalized.source.accessed) || today
  };

  return normalized;
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

const systemPrompt =
  `Convert recipes into the Recipe Shelf JSON schema. Preserve cups, tbsp and tsp as measuring units. Convert ounces and pounds to grams. Keep quantities numeric where possible, or null for text-only amounts. Rewrite method steps so ingredient amounts are included directly in the instruction text. Add timerMinutes for timed cooking/mixing/resting steps. Do not invent ingredients. If uncertain, put a short warning in notes.

Return only a JSON object, with no markdown fences and no commentary. Match this schema shape:
${JSON.stringify(recipeSchema)}`;

const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
  method: 'POST',
  headers: {
    authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    'content-type': 'application/json'
  },
  body: JSON.stringify({
    model,
    temperature: 0.1,
    messages: [
      {
        role: 'system',
        content: systemPrompt
      },
      {
        role: 'user',
        content: `Source URL: ${sourceUrl || 'pasted text'}\nAccessed: ${today}\n\nRecipe content:\n${recipeInput}`
      }
    ]
  })
});

if (!response.ok) {
  throw new Error(`Groq request failed: ${response.status} ${await response.text()}`);
}

const result = await response.json();
const outputText = result.choices?.[0]?.message?.content;

if (!outputText) {
  throw new Error('Groq response did not contain output text.');
}

function parseJsonObject(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error(`Groq response was not JSON: ${text.slice(0, 500)}`);
    return JSON.parse(match[0]);
  }
}

const recipe = parseJsonObject(outputText);
const slug = outputSlug || slugify(recipe.title);
const fileName = slug.startsWith('_draft-') ? `${slug}.md` : `_draft-${slug}.md`;
const outputPath = join(process.cwd(), 'src/content/recipes', fileName);

await mkdir(join(process.cwd(), 'src/content/recipes'), { recursive: true });
await writeFile(outputPath, recipeToMarkdown(recipe), 'utf8');

console.log(`Created ${outputPath}`);
