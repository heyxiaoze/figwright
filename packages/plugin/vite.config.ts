import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

import { execSync } from 'node:child_process';

// Figwright-Plus version, baked into the plugin bundle and shown in the panel footer / debug tab.
// Format: `<MAJOR>.<MINOR>-<short-git-sha>`, displayed as `v0.06-<sha>`.
//   - MAJOR stays 0 until the major version is bumped (the user will say when).
//   - MINOR starts at 05 and increments by 1 on every release (05 → 06 → … → 10 → 11 …).
//   - The commit hash is refreshed on every build, so the panel always reports the exact build.
// Skew detection was removed (checkPluginCompatibility now always returns true), so this string is
// display-only — it no longer has to satisfy the semver comparator in packages/shared/src/version.ts.
const MAJOR = 0;
const MINOR = '06'; // bump +1 on each release

function buildVersion(): string {
  let sha = 'unknown';
  try {
    sha = execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // leave sha as 'unknown'
  }
  return `${MAJOR}.${MINOR}-${sha}`;
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
