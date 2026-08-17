// Figwright-Plus 版本号管理（单一真相源）。
//
// 版本格式：v<MAJOR>.<MINOR>-<sha>。MAJOR/MINOR 是显式常量，sha 在构建时由
// git rev-parse 实时 bake 进产物。三处常量必须保持同步，否则插件 / 控制台 / server
// 报告的版本会对不上（我们此前两次踩过这个坑）。本模块把"改齐三处 + 提交"收敛成一个
// 函数，bump-version.mjs 与 release.mjs 共用，杜绝手改只改一两处导致的回归。
//
// 三处置：
//   1. packages/plugin/vite.config.ts        → const MAJOR / const MINOR
//   2. scripts/dashboard.mjs                 → const APP_MAJOR / const APP_MINOR
//   3. packages/mcp/src/index.ts             → const APP_VERSION_MAJOR / const APP_VERSION_MINOR
//
// 约定：major 进位时 minor 归零（1.2 → 2.0）；默认 minor +1（1.2 → 1.3）。

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

export const FILES = {
  vite: join(repoRoot, 'packages/plugin/vite.config.ts'),
  dashboard: join(repoRoot, 'scripts/dashboard.mjs'),
  mcp: join(repoRoot, 'packages/mcp/src/index.ts'),
};

function fail(message) {
  console.error(`✖ ${message}`);
  process.exit(1);
}

// 以 vite.config.ts 为 MAJOR/MINOR 的权威来源。
export function readCurrent() {
  const vite = readFileSync(FILES.vite, 'utf8');
  const majorM = vite.match(/const MAJOR\s*=\s*(\d+);/);
  const minorM = vite.match(/const MINOR\s*=\s*'(\d+)';/);
  if (!majorM || !minorM) fail('无法在 vite.config.ts 解析 MAJOR/MINOR');
  return { major: Number(majorM[1]), minor: Number(minorM[1]) };
}

// 算出下一版计划，不落盘。
export function bumpPlan(kind = 'minor') {
  const cur = readCurrent();
  let major = cur.major;
  let minor = cur.minor;
  if (kind === 'major') {
    major += 1;
    minor = 0;
  } else {
    minor += 1;
  }
  return { major, minor, version: `${major}.${minor}` };
}

function replaceConst(src, re, replacement, fileLabel) {
  if (!re.test(src)) fail(`在 ${fileLabel} 中未匹配到目标常量（正则：${re}）`);
  return src.replace(re, replacement);
}

// 把新 MAJOR/MINOR 写回三处文件；commit=true 时一并 git add + commit。
// dryRun=true 时只计算、不落盘也不提交（用于本地校验）。
export function applyBump(plan, { commit = true, dryRun = false } = {}) {
  // 1) vite.config.ts
  let vite = readFileSync(FILES.vite, 'utf8');
  vite = replaceConst(vite, /const MAJOR\s*=\s*\d+;/, `const MAJOR = ${plan.major};`, 'vite.config.ts');
  vite = replaceConst(vite, /const MINOR\s*=\s*'\d+';/, `const MINOR = '${plan.minor}';`, 'vite.config.ts');
  if (!dryRun) writeFileSync(FILES.vite, vite);

  // 2) scripts/dashboard.mjs
  let dash = readFileSync(FILES.dashboard, 'utf8');
  dash = replaceConst(dash, /const APP_MAJOR\s*=\s*\d+;/, `const APP_MAJOR = ${plan.major};`, 'dashboard.mjs');
  dash = replaceConst(dash, /const APP_MINOR\s*=\s*'\d+';/, `const APP_MINOR = '${plan.minor}';`, 'dashboard.mjs');
  if (!dryRun) writeFileSync(FILES.dashboard, dash);

  // 3) packages/mcp/src/index.ts
  let mcp = readFileSync(FILES.mcp, 'utf8');
  mcp = replaceConst(mcp, /const APP_VERSION_MAJOR\s*=\s*\d+;/, `const APP_VERSION_MAJOR = ${plan.major};`, 'index.ts');
  mcp = replaceConst(mcp, /const APP_VERSION_MINOR\s*=\s*'\d+';/, `const APP_VERSION_MINOR = '${plan.minor}';`, 'index.ts');
  if (!dryRun) writeFileSync(FILES.mcp, mcp);

  if (commit && !dryRun) {
    const { status } = spawnSync(
      'git',
      ['add', FILES.vite, FILES.dashboard, FILES.mcp],
      { cwd: repoRoot, stdio: 'inherit' },
    );
    if (status !== 0) fail('git add 失败');
    const c = spawnSync('git', ['commit', '-m', `chore: bump to v${plan.version}`], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    if (c.status !== 0) fail('git commit 失败');
  }
}

export { repoRoot };
