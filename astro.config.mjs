import { defineConfig } from 'astro/config';

// GitHub Pages 部署時由 .github/workflows/deploy.yml 傳入 SITE 與 BASE_PATH。
export default defineConfig({
  site: process.env.SITE ?? 'http://localhost:4321',
  base: process.env.BASE_PATH ?? '/',
  trailingSlash: 'always',
});
