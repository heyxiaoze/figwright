import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

import { execSync } from 'node:child_process';

// Dynamic version: v0.1.0-beta-<short-git-sha>, refreshed on every build. The `.0` patch is required
// so the string is valid semver (MAJOR.MINOR.PATCH-prerelease) — the shared version comparator in
// `packages/shared/src/version.ts` rejects anything that doesn't parse, which would otherwise mark
// every result as "unverified".
function buildVersion(): string {
  try {
    const sha = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
    return `0.1.0-beta-${sha}`;
  } catch {
    return '0.1.0-beta-unknown';
  }
}

const version = buildVersion();

export default defineConfig({
  root: 'ui',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [vue(), tailwindcss(), viteSingleFile()],
  build: {
    outDir: '../dist',
    emptyOutDir: false,
    target: 'baseline-widely-available',
    rollupOptions: {
      input: 'ui/index.html',
    },
  },
});
