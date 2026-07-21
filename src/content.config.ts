import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const ingredientSchema = z.object({
  name: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable().optional(),
  notes: z.string().optional(),
  optional: z.boolean().default(false)
});

const ingredientGroupSchema = z.object({
  title: z.string(),
  ingredients: z.array(ingredientSchema).min(1)
});

const sourceSchema = z.object({
  title: z.string(),
  author: z.string().optional(),
  website: z.string().optional(),
  url: z.string().url().optional(),
  accessed: z.coerce.date().optional()
});

const instructionSchema = z.union([
  z.string(),
  z.object({
    text: z.string(),
    timerMinutes: z.number().positive().optional()
  })
]);

const recipes = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/recipes' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    originalServings: z.number().positive(),
    prepTime: z.string().optional(),
    cookTime: z.string().optional(),
    totalTime: z.string().optional(),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    cuisine: z.string().optional(),
    dietary: z.array(z.string()).default([]),
    ingredients: z.array(ingredientGroupSchema).min(1),
    instructions: z.array(instructionSchema).min(1),
    notes: z.string().optional(),
    goesWith: z.array(z.string()).default([]),
    source: sourceSchema,
    adaptationNotes: z.string().optional(),
    cookingNotes: z.string().optional(),
    image: z.string().optional(),
    created: z.coerce.date(),
    updated: z.coerce.date()
  })
});

export const collections = { recipes };
