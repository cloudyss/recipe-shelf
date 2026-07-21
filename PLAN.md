# Recipe App MVP Plan

## Current repository state

- The repository is a fresh Git repository on `main`.
- There are no existing application files, package files, recipes, or deployment workflows.
- Because there is no current structure to preserve, the MVP can use a clean Astro project layout.

## Proposed project structure

- `.github/workflows/deploy.yml` - GitHub Actions workflow for GitHub Pages.
- `astro.config.mjs` - Astro configuration with GitHub Pages base path handling.
- `src/content.config.ts` - Astro content collection schema for recipes.
- `src/content/recipes/` - Human-readable Markdown recipe files.
- `src/pages/index.astro` - Searchable and filterable recipe index.
- `src/pages/recipes/[id].astro` - Individual recipe pages with client-side scaling.
- `src/layouts/BaseLayout.astro` - Shared page shell, metadata and navigation.
- `src/styles/global.css` - Mobile-first styling.
- `public/manifest.webmanifest` and `public/sw.js` - Practical PWA support.
- `scripts/import-recipe.mjs` - URL importer that creates reviewable Markdown drafts from recipe websites.
- `README.md` - Setup, deployment and recipe editing documentation.

## Implementation sequence

1. Create the Astro project files and TypeScript configuration.
2. Define a validated recipe content schema using Astro content collections.
3. Add sample recipes and a commented recipe template.
4. Build the recipe index with search, category filters and tag filters.
5. Build recipe detail pages with serving controls and scaled ingredient quantities.
6. Add PWA manifest and a small service worker for app-shell and previously loaded page caching.
7. Add GitHub Pages deployment through GitHub Actions.
8. Write README documentation with exact local and GitHub workflow steps.
9. Add a review-first import workflow for recipes copied from websites.
10. Install dependencies, run type checks and build the production site.
11. Review responsive layout and fix issues found during validation.

## Design decisions

- Keep recipes in Markdown with structured frontmatter so they are readable, reviewable and version-controlled.
- Keep scaling client-side only; recipe pages are static HTML that become interactive with a small script.
- Convert common American volume and weight units to metric when importing from websites. Numeric quantities then scale directly in the app; `null` quantities remain text-only.
- Keep GitHub editing explicit through links to GitHub’s file editor instead of adding browser authentication.
- Use no component library for the MVP; simple HTML, CSS and Astro components are enough.
- Do not use a database for the current version. Git-backed Markdown remains the simplest storage model for personal recipes, source attribution and reviewable edits.
