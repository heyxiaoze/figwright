// 版本号自动化 CLI：改齐三处常量（vite.config.ts / dashboard.mjs / mcp index.ts）并提交。
//
// 用法：
//   node scripts/bump-version.mjs            # minor +1（默认），如 1.2 → 1.3，提交
//   node scripts/bump-version.mjs major      # major 进位，minor 归零，如 1.2 → 2.0，提交
//   node scripts/bump-version.mjs --dry-run  # 只改文件、不提交（用于本地校验）
//
// 设计要点：
//   - 提交后再由 release.mjs 构建，sha 才 bake 进产物（"先 commit 再 build" 铁律）。
//   - 不直接动 package.json 的 semver（fork 用 MAJOR.MINOR 格式，npm 发布走上游，本 fork 不发 npm）。

import { bumpPlan, applyBump, readCurrent } from './version-bump.mjs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const kind = args.includes('major') ? 'major' : 'minor';

const cur = readCurrent();
const plan = bumpPlan(kind);

console.log(`\n  当前版本  v${cur.major}.${cur.minor}`);
console.log(`  目标版本  v${plan.version}${dryRun ? '  (dry-run，不提交)' : ''}\n`);

applyBump(plan, { commit: !dryRun, dryRun });

if (dryRun) {
  console.log('  dry-run：三处常量已改为 v' + plan.version + '，未提交。可 git checkout 还原。');
  console.log('  下一步：去掉 --dry-run 重新运行以提交，或 node scripts/release.mjs 直接发布。\n');
} else {
  console.log(`  ✔ 已提交 chore: bump to v${plan.version}`);
  console.log('  下一步（构建 + 发布）：node scripts/release.mjs' + (kind === 'major' ? ' major' : '') + '\n');
}
