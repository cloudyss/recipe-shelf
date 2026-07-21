# Recipe Shelf

Recipe Shelf is a mobile-first personal recipe web app. It stores each recipe as a human-readable Markdown file in this GitHub repository, builds a static Astro site, and deploys it to GitHub Pages.

## Architecture

- Astro renders a static site from files in `src/content/recipes/`.
- `src/content.config.ts` validates every recipe with an Astro content collection schema.
- Recipe pages use a small browser script to scale numeric ingredient quantities instantly.
- GitHub Actions builds the site and deploys `dist/` to GitHub Pages.
- There is no database, backend, paid host, or browser-to-GitHub authentication.

## Why Recipes Live In GitHub

Recipe files are plain Markdown with structured frontmatter, so they are readable, searchable, reviewable and backed up. Every recipe edit is a Git commit, which gives you version history and an easy way to undo mistakes.

## Install

```bash
npm install
```

Copy the example environment file if you want local “Edit in GitHub” links to point to your repository:

```bash
cp .env.example .env
```

Then edit `.env`:

```bash
PUBLIC_GITHUB_REPOSITORY_URL=https://github.com/your-username/your-recipe-repo
```

## Run Locally

```bash
npm run dev
```

Open the local URL printed by Astro, usually `http://localhost:4321/`.

## Check And Build

```bash
npm run check
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Deploy To GitHub Pages

The workflow at `.github/workflows/deploy.yml` runs on every push to `main` and can also be started manually from GitHub Actions.

In your GitHub repository, enable:

1. `Settings` -> `Pages`.
2. Under `Build and deployment`, set `Source` to `GitHub Actions`.
3. Push this repository to GitHub.
4. Confirm the `Deploy to GitHub Pages` workflow completes.

The Astro config automatically uses the repository name as the GitHub Pages base path during GitHub Actions builds.

## Add A Recipe

Copy the template:

```bash
cp src/content/recipes/_template.md src/content/recipes/my-new-recipe.md
```

Edit the new file and keep the frontmatter structure intact. Then validate:

```bash
npm run check
npm run build
```

Commit and push:

```bash
git add src/content/recipes/my-new-recipe.md
git commit -m "Add my new recipe"
git push
```

## Edit A Recipe From A Phone

1. Open the deployed recipe page on your phone.
2. Tap `Edit in GitHub`.
3. Sign in to GitHub if prompted.
4. Edit the Markdown file in GitHub’s web editor.
5. Tap `Commit changes`.
6. GitHub Actions will rebuild and publish the site.

For a new recipe from a phone, open `src/content/recipes/_template.md` in GitHub, copy its contents, create a new file under `src/content/recipes/`, paste the template, fill it in, and commit.

## Recipe Format

Recipes live in `src/content/recipes/`. The file name becomes the recipe URL, so use short lowercase names such as `lemon-chickpea-orzo.md`.

Important fields:

- `title`, `description`, `originalServings`, `created` and `updated` are required.
- `ingredients` are grouped into sections.
- Each ingredient has `name`, `quantity`, `unit`, `notes` and `optional`.
- Use numeric quantities such as `1`, `0.5` or `1.25`.
- Use `quantity: null` for amounts such as `to taste`.
- `source` records where the recipe came from.
- `notes` is where you write your own notes. Source and file history are shown after it.
- `goesWith` lists other recipe slugs to show as pairing links at the bottom of the recipe page.
- `instructions` can be plain text or timed steps using `text` and `timerMinutes`.

See `src/content/recipes/_template.md` for the full format.

## Import A Recipe From A Website

Use the importer to create a draft recipe from a website that publishes `schema.org` Recipe structured data:

```bash
npm run import:recipe -- https://example.com/recipe
```

The importer writes a draft file like:

```text
src/content/recipes/_draft-recipe-title.md
```

Draft files start with `_draft-`, so they are validated but not shown in the app. Review the file, edit the ingredients and method, then rename it without `_draft-` when it is ready to publish:

```bash
mv src/content/recipes/_draft-recipe-title.md src/content/recipes/recipe-title.md
npm run build
```

The importer:

- saves the original recipe URL in `source.url`;
- keeps the original ingredient lines in `notes` for review;
- keeps cups, tablespoons and teaspoons as written, while converting ounces and pounds to grams;
- adds ingredient quantities into method steps when it can confidently match ingredient names.

It is intentionally review-first. Websites format recipes differently, so imported recipes should always be checked before publishing.

## Import From Your Phone With AI

For phone use, run the `Import recipe draft` GitHub Action. It can take a recipe URL or pasted recipe text, call OpenAI, generate a hidden draft Markdown file, validate the app, and commit the draft back to GitHub.

One-time setup in GitHub:

1. Open your repository on GitHub.
2. Go to `Settings` -> `Secrets and variables` -> `Actions`.
3. Add a repository secret named `OPENAI_API_KEY`.
4. Optional: add a repository variable named `OPENAI_MODEL`. If omitted, the workflow uses `gpt-5.6-luna`.

Run it from your phone:

1. Open the repository in the GitHub mobile app or mobile browser.
2. Go to `Actions`.
3. Tap `Import recipe draft`.
4. Tap `Run workflow`.
5. Paste either `recipe_url` or `recipe_text`.
6. Optionally enter `output_slug`, such as `lemon-cake`.
7. Run the workflow.

The workflow creates a file such as:

```text
src/content/recipes/_draft-lemon-cake.md
```

Draft files are intentionally hidden from the app. Review the Markdown in GitHub, edit anything you want, then rename it without `_draft-` when you are ready to publish it.

Some websites block GitHub Actions from fetching their pages. If a URL import creates a draft saying the source was blocked, open the recipe page yourself, copy the visible ingredients and method, then rerun `Import recipe draft` with `recipe_text` instead of `recipe_url`.

The AI import prompt asks the model to:

- preserve cups, tablespoons and teaspoons;
- convert ounces and pounds to grams;
- keep quantities numeric where possible;
- include ingredient quantities directly in method steps;
- add `timerMinutes` when a step says to beat, bake, rest or cook for a specific time;
- keep source attribution.

## Storage: Markdown Or Database?

Use Markdown files for this app, not a database.

Your recipes are stored in:

```text
src/content/recipes/
```

That is the right fit because the app is personal, static, easy to back up, easy to edit on GitHub, and benefits from Git history. A database would add hosting, authentication, backups and maintenance before you need them.

## Ingredient Scaling

The app scales numeric quantities using:

```text
scaled quantity = original quantity * selected servings / original servings
```

Imported recipes keep cup, tablespoon and teaspoon measurements as written. Weight units such as ounces and pounds are converted to grams before they are saved. After that, the app scales the saved numeric quantities.

Text-only ingredients with `quantity: null` are not scaled.

## Source Attribution

Each recipe includes a `source` object with the original title, author, website, URL and date accessed where available. Recipe pages display that attribution and link to the source URL when provided.

## Current Limitations

- Weight conversion is import-time only and covers common ounces/pounds cases, not every ingredient-specific conversion.
- No private browser editing flow; edits happen in GitHub.
- Offline support is basic and works best for pages you have already loaded.
- Images are supported in the schema but sample recipes do not yet include image assets.

## Future Enhancements

- Import helper for recipes copied from websites or notes.
- Fraction display for common scaled quantities.
- Print-friendly recipe pages.
- Shopping list generation.
- More robust offline caching once the recipe collection grows.
