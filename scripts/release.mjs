// Figwright-Plus 发布流程（fork 版，覆盖 upstream 的 npm 发布脚本）。
//
// upstream 原 release.mjs 走 changelogen + npm publish 到 awdr74100/figwright，
// 与我们的 fork 发布模型（zip + GitHub Release）不符，且会误发到上游，故替换。
//
// 本脚本一次性完成此前手搓的发布流程：
//   1. bump 三处版本常量（minor +1，或 major 进位）→ 提交（"先 commit 再 build"）
//   2. 构建插件（vite main + ui）与 mcp（tsdown）
//   3. 打 zip（manifest.json + dist）
//   4. 推送分支 + 创建 GitHub Release（gh release create，含 zip）
//
// 用法：
//   node scripts/release.mjs            # minor 发布
//   node scripts/release.mjs major      # major 发布
//   node scripts/release.mjs --skip-gh  # 只 bump+提交+构建+打包，不推送/不发版（本地校验）
//
// 安全：默认会推送 origin 并创建公开 Release。--skip-gh 适合在本机验证构建链路。

import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { bumpPlan, applyBump, repoRoot } from './version-bump.mjs';

const args = process.argv.slice(2);
const skipGh = args.includes('--skip-gh');
const kind = args.includes('major') ? 'major' : 'minor';

function run(cmd, cmdArgs, opts = {}) {
  const r = spawnSync(cmd, cmdArgs, { cwd: repoRoot, stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`✖ ${cmd} ${cmdArgs.join(' ')} 失败（exit ${r.status ?? '?'}）`);
    process.exit(r.status ?? 1);
  }
}

// figwright 自带 node 不认 NODE_OPTIONS=--use-system-ca，构建前必须摘掉。
const buildEnv = { ...process.env };
delete buildEnv.NODE_OPTIONS;

// 1) bump + 提交
const plan = bumpPlan(kind);
console.log(`\n  bump → v${plan.version}`);
applyBump(plan, { commit: true });

// 2) 构建
console.log('\n  构建插件 (vite main + ui) …');
run('pnpm', ['-F', '@figwright/plugin', 'run', 'build'], { env: buildEnv });
console.log('  构建 mcp (tsdown) …');
run('pnpm', ['-F', '@figwright/mcp', 'run', 'build'], { env: buildEnv });

// 3) 版本字符串（含实时 sha）。sha 在构建时已 bake 进产物，这里取同一 HEAD。
const sha = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).stdout.trim();
const tag = `v${plan.version}-${sha}`;
const zipName = `figwright-plus-${tag}.zip`;
const pluginDir = join(repoRoot, 'packages/plugin');
const manifest = join(pluginDir, 'manifest.json');
const distDir = join(pluginDir, 'dist');

if (!existsSync(manifest)) {
  console.error(`✖ 缺少 ${manifest}`);
  process.exit(1);
}
if (!existsSync(distDir)) {
  console.error(`✖ 缺少 ${distDir}，插件构建似乎未产出 dist`);
  process.exit(1);
}

console.log(`\n  打包 ${zipName}（manifest.json + dist）…`);
// zip 相对路径以 packages/plugin 为基准
run('zip', ['-r', '-q', zipName, 'manifest.json', 'dist'], { cwd: pluginDir, env: buildEnv });

if (skipGh) {
  console.log(`\n  --skip-gh：已完成 bump+构建+打包，未推送/未发版。`);
  console.log(`  本地 zip：${join(pluginDir, zipName)}`);
  console.log(`  确认无误后去掉 --skip-gh 重新运行即可发版。\n`);
  process.exit(0);
}

// 4) 推送 + 创建 Release
const branch = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
  cwd: repoRoot,
  encoding: 'utf8',
}).stdout.trim();
console.log(`\n  推送 ${branch} …`);
run('git', ['push', 'origin', branch]);

console.log(`  创建 GitHub Release ${tag} …`);
run('gh', [
  'release',
  'create',
  tag,
  zipName,
  '--title',
  tag,
  '--notes',
  `Figwright-Plus v${plan.version} (${sha})`,
], { cwd: repoRoot });

// 发版后清理本地 zip（GitHub 上已有）
try {
  unlinkSync(join(pluginDir, zipName));
} catch {
  /* 忽略 */
}

console.log(`\n  ✔ 已发布 ${tag}：https://github.com/heyxiaoze/figwright/releases/tag/${tag}\n`);
