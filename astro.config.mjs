import { defineConfig } from 'astro/config';

const repositoryName = process.env.GITHUB_REPOSITORY?.split('/')[1];
const isGitHubPagesBuild = Boolean(process.env.GITHUB_ACTIONS && repositoryName);
const site = process.env.PUBLIC_SITE_URL || 'https://example.github.io';

export default defineConfig({
  site,
  base: isGitHubPagesBuild ? `/${repositoryName}` : '/',
  output: 'static',
  build: {
    assets: 'assets'
  }
});
