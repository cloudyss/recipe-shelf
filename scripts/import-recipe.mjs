#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const url = process.argv[2];
const outputArg = process.argv.find((arg) => arg.startsWith('--out='));
const today = new Date().toISOString().slice(0, 10);

if (!url) {
  console.error('Usage: npm run import:recipe -- https://example.com/recipe');
  process.exit(1);
}

const unitMap = new Map([
  ['cup', { unit: 'cup', factor: 1 }],
  ['cups', { unit: 'cups', factor: 1 }],
  ['c', { unit: 'cup', factor: 1 }],
  ['tablespoon', { unit: 'tbsp', factor: 1 }],
  ['tablespoons', { unit: 'tbsp', factor: 1 }],
  ['tbsp', { unit: 'tbsp', factor: 1 }],
  ['tbsp.', { unit: 'tbsp', factor: 1 }],
  ['teaspoon', { unit: 'tsp', factor: 1 }],
  ['teaspoons', { unit: 'tsp', factor: 1 }],
  ['tsp', { unit: 'tsp', factor: 1 }],
  ['tsp.', { unit: 'tsp', factor: 1 }],
  ['fluid ounce', { unit: 'ml', factor: 30 }],
  ['fluid ounces', { unit: 'ml', factor: 30 }],
  ['fl oz', { unit: 'ml', factor: 30 }],
  ['gram', { unit: 'g', factor: 1 }],
  ['grams', { unit: 'g', factor: 1 }],
  ['g', { unit: 'g', factor: 1 }],
  ['ounce', { unit: 'g', factor: 28.35 }],
  ['ounces', { unit: 'g', factor: 28.35 }],
  ['oz', { unit: 'g', factor: 28.35 }],
  ['pound', { unit: 'g', factor: 453.59 }],
  ['pounds', { unit: 'g', factor: 453.59 }],
  ['lb', { unit: 'g', factor: 453.59 }],
  ['lbs', { unit: 'g', factor: 453.59 }]
]);

const fractionMap = new Map([
  ['¼', 0.25],
  ['½', 0.5],
  ['¾', 0.75],
  ['⅓', 1 / 3],
  ['⅔', 2 / 3],
  ['⅛', 0.125],
  ['⅜', 0.375],
  ['⅝', 0.625],
  ['⅞', 0.875]
]);

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
    .replace(/\s+/g, ' ')
    .trim();
}

function flattenJsonLd(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (value['@graph']) return [value, ...flattenJsonLd(value['@graph'])];
  return [value];
}

function isRecipeNode(node) {
  const type = node?.['@type'];
  return Array.isArray(type) ? type.includes('Recipe') : type === 'Recipe';
}

function extractJsonLdRecipe(html) {
  const scripts = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) ?? [];

  for (const script of scripts) {
    const json = script
      .replace(/^<script[^>]*>/i, '')
      .replace(/<\/script>$/i, '')
      .trim();

    try {
      const parsed = JSON.parse(json);
      const recipe = flattenJsonLd(parsed).find(isRecipeNode);
      if (recipe) return recipe;
    } catch {
      continue;
    }
  }

  return null;
}

function parseNumberToken(value) {
  const token = value.trim();
  if (fractionMap.has(token)) return fractionMap.get(token);
  if (/^\d+\/\d+$/.test(token)) {
    const [top, bottom] = token.split('/').map(Number);
    return top / bottom;
  }
  if (/^\d+(\.\d+)?$/.test(token)) return Number(token);
  return null;
}

function parseLeadingQuantity(line) {
  const normalised = line.replace(/(\d)([¼½¾⅓⅔⅛⅜⅝⅞])/g, '$1 $2');
  const match = normalised.match(/^((?:\d+(?:\.\d+)?|\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞])(?:\s+(?:\d+\/\d+|[¼½¾⅓⅔⅛⅜⅝⅞]))?)\s+(.+)$/);
  if (!match) return { quantity: null, rest: line };

  const parts = match[1].split(/\s+/).map(parseNumberToken);
  if (parts.some((part) => part === null)) return { quantity: null, rest: line };
  return {
    quantity: parts.reduce((sum, part) => sum + part, 0),
    rest: match[2]
  };
}

function roundQuantity(value) {
  if (value >= 100) return Math.round(value);
  if (value >= 10) return Math.round(value * 10) / 10;
  return Math.round(value * 100) / 100;
}

function parseIngredient(line) {
  const original = cleanText(line);
  const { quantity, rest } = parseLeadingQuantity(original);
  if (quantity === null) {
    return { name: original, quantity: null, unit: null };
  }

  const lowerRest = rest.toLowerCase();
  const matchedUnit = [...unitMap.keys()]
    .sort((a, b) => b.length - a.length)
    .find((unit) => lowerRest === unit || lowerRest.startsWith(`${unit} `));

  if (!matchedUnit) {
    return { name: cleanText(rest), quantity: roundQuantity(quantity), unit: null };
  }

  const conversion = unitMap.get(matchedUnit);
  const name = cleanText(rest.slice(matchedUnit.length));
  return {
    name: name || cleanText(rest),
    quantity: roundQuantity(quantity * conversion.factor),
    unit: conversion.unit
  };
}

function instructionText(step) {
  if (typeof step === 'string') return cleanText(step);
  if (step?.text) return cleanText(step.text);
  if (Array.isArray(step?.itemListElement)) {
    return step.itemListElement.map(instructionText).filter(Boolean).join(' ');
  }
  return '';
}

function formatIngredientForMethod(ingredient) {
  if (ingredient.quantity === null) return ingredient.name;
  return `${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ''} ${ingredient.name}`;
}

function enrichInstructions(instructions, ingredients) {
  return instructions.map((instruction) => {
    let updated = instruction;
    for (const ingredient of ingredients) {
      if (!ingredient.name || ingredient.name.length < 4) continue;
      const escapedName = ingredient.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = new RegExp(`(?<![\\d/\\.])\\b${escapedName}\\b`, 'i');
      if (pattern.test(updated)) {
        updated = updated.replace(pattern, formatIngredientForMethod(ingredient));
      }
    }
    return updated;
  });
}

function yamlString(value) {
  return JSON.stringify(value ?? '');
}

function yamlArray(values, indent = '') {
  if (!values?.length) return `${indent}[]`;
  return values.map((value) => `${indent}- ${yamlString(value)}`).join('\n');
}

function recipeToMarkdown(recipe, sourceUrl) {
  const title = cleanText(recipe?.name) || 'Imported Recipe';
  const slug = outputArg?.slice('--out='.length).replace(/\.md$/, '') || `_draft-${slugify(title || basename(sourceUrl))}`;
  const rawIngredients = recipe?.recipeIngredient ?? [];
  const ingredients = rawIngredients.map(parseIngredient);
  const rawInstructions = Array.isArray(recipe?.recipeInstructions)
    ? recipe.recipeInstructions.map(instructionText).filter(Boolean)
    : [];
  const instructions = enrichInstructions(rawInstructions.length ? rawInstructions : ['Review and add method steps.'], ingredients);
  const author = Array.isArray(recipe?.author) ? recipe.author[0] : recipe?.author;
  const image = Array.isArray(recipe?.image) ? recipe.image[0] : recipe?.image?.url ?? recipe?.image;

  const ingredientYaml = ingredients
    .map((ingredient) => {
      const lines = [
        `      - name: ${yamlString(ingredient.name)}`,
        `        quantity: ${ingredient.quantity === null ? 'null' : ingredient.quantity}`,
        `        unit: ${ingredient.unit === null ? 'null' : yamlString(ingredient.unit)}`
      ];
      return lines.join('\n');
    })
    .join('\n');

  const markdown = `---
title: ${yamlString(title)}
description: ${yamlString(cleanText(recipe?.description) || 'Imported recipe draft ready for review.')}
originalServings: ${Number.parseFloat(recipe?.recipeYield) || 4}
categories:
${yamlArray(['Imported'], '  ')}
tags:
${yamlArray(['review-needed'], '  ')}
cuisine: ${yamlString(cleanText(recipe?.recipeCuisine))}
dietary: []
goesWith: []
ingredients:
  - title: "Ingredients"
    ingredients:
${ingredientYaml || '      - name: "Review and add ingredients"\n        quantity: null\n        unit: null'}
instructions:
${yamlArray(instructions, '  ')}
source:
  title: ${yamlString(cleanText(recipe?.name) || 'Original recipe')}
  author: ${yamlString(cleanText(author?.name ?? author))}
  website: ${yamlString(new URL(sourceUrl).hostname)}
  url: ${yamlString(sourceUrl)}
  accessed: ${today}
notes: ${yamlString(`Imported draft. Review ingredient parsing, metric conversions and method wording before publishing. Original ingredient lines: ${rawIngredients.map(cleanText).join(' | ')}`)}
image: ${image ? yamlString(image) : '""'}
created: ${today}
updated: ${today}
---
`;

  return { slug, markdown };
}

const response = await fetch(url, {
  headers: {
    'user-agent': 'Recipe Shelf importer (+https://github.com/)'
  }
});

if (!response.ok) {
  throw new Error(`Could not fetch ${url}: ${response.status} ${response.statusText}`);
}

const html = await response.text();
const recipe = extractJsonLdRecipe(html);

if (!recipe) {
  throw new Error('No schema.org Recipe JSON-LD was found on this page.');
}

const { slug, markdown } = recipeToMarkdown(recipe, url);
const recipesDir = join(process.cwd(), 'src/content/recipes');
const outputPath = join(recipesDir, `${slug}.md`);

await mkdir(recipesDir, { recursive: true });
await writeFile(outputPath, markdown, 'utf8');

console.log(`Imported draft recipe: ${outputPath}`);
console.log('Review it, remove the _draft- prefix when ready, then run npm run build.');
