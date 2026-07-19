#!/usr/bin/env node
/**
 * Generate build information for the About page.
 * This script runs during Netlify build to capture deployment metadata.
 *
 * Netlify Environment Variables used:
 * - COMMIT_REF: Full git commit SHA
 * - CONTEXT: Build context (production, deploy-preview, branch-deploy, dev)
 * - BRANCH: Git branch name
 * - DEPLOY_ID: Unique Netlify deploy identifier
 * - REVIEW_ID: Pull/Merge request ID (for deploy previews)
 * - REPOSITORY_URL: Git repository URL
 * - HEAD: Branch or PR head reference
 * - PULL_REQUEST: "true" if this is a PR build
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function getGitCommit() {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function getGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function getSourceBranch() {
  // For PRs, try to get the actual source branch name from git
  // In Netlify PR builds, we're in detached HEAD state

  // Method 1: Try git log --format=%D to find remote refs
  try {
    const result = execSync('git log -1 --format=%D HEAD', { encoding: 'utf8' }).trim();
    // Result might be like: "HEAD, origin/claude/add-version-build-info-msEu8"
    const match = result.match(/origin\/([^,\s]+)/);
    if (match && !match[1].startsWith('pull/')) {
      return match[1];
    }
  } catch {
    // Ignore errors
  }

  // Method 2: Try to find branch from remote refs containing this commit
  try {
    const result = execSync('git branch -r --contains HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
    // Result might be like: "  origin/claude/add-version-build-info-msEu8"
    const lines = result.split('\n').map(l => l.trim()).filter(l => l && !l.includes('HEAD') && !l.includes('pull/'));
    if (lines.length > 0) {
      const match = lines[0].match(/origin\/(.+)/);
      if (match) {
        return match[1];
      }
    }
  } catch {
    // Ignore errors
  }

  // Method 3: Try git name-rev
  try {
    const result = execSync('git name-rev --name-only HEAD 2>/dev/null', { encoding: 'utf8' }).trim();
    // Result might be like: "remotes/origin/claude/add-version-build-info-msEu8"
    if (result && !result.includes('undefined') && !result.startsWith('pull/')) {
      const match = result.match(/(?:remotes\/)?origin\/(.+)/);
      if (match) {
        return match[1];
      }
    }
  } catch {
    // Ignore errors
  }

  return null;
}

function getGitCommitDate() {
  try {
    return execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

function getBuildType(context) {
  switch (context) {
    case 'production':
      return 'prod';
    case 'deploy-preview':
      return 'preview';
    case 'branch-deploy':
      return 'branch';
    case 'dev':
    case 'development':
      return 'dev';
    default:
      return 'local';
  }
}

function generateBuildInfo() {
  const env = process.env;
  const now = new Date();

  // Netlify provides these, fallback to git commands for local builds
  const commitHash = env.COMMIT_REF || getGitCommit() || 'unknown';
  const commitShort = commitHash.substring(0, 7);
  const context = env.CONTEXT || 'local';
  const buildType = getBuildType(context);

  // For PR builds, try to get actual source branch instead of "pull/X/head"
  let branch = env.BRANCH || env.HEAD || getGitBranch() || 'unknown';
  const originalBranch = branch; // Keep original for logging

  if (branch.startsWith('pull/') && branch.endsWith('/head')) {
    // Try to get the actual source branch from git
    console.log('  Attempting to resolve PR branch...');
    const sourceBranch = getSourceBranch();
    if (sourceBranch) {
      console.log('  Found source branch:', sourceBranch);
      branch = sourceBranch;
    } else {
      console.log('  Could not determine source branch from git');
      // Debug: Show what git sees
      try {
        const refs = execSync('git log -1 --format=%D HEAD 2>/dev/null || echo "N/A"', { encoding: 'utf8' }).trim();
        console.log('  git log -1 --format=%D:', refs);
      } catch { /* ignore */ }
      try {
        const branches = execSync('git branch -r 2>/dev/null | head -5 || echo "N/A"', { encoding: 'utf8' }).trim();
        console.log('  git branch -r (first 5):', branches.replace(/\n/g, ', '));
      } catch { /* ignore */ }

      // If we have a reviewId, use a friendlier format
      if (env.REVIEW_ID) {
        branch = `PR #${env.REVIEW_ID}`;
      }
    }
  }

  const buildInfo = {
    // Version identification
    version: commitShort,
    commitHash: commitHash,
    commitShort: commitShort,
    commitDate: getGitCommitDate() || null,

    // Build classification
    buildType: buildType,
    context: context,
    isProduction: context === 'production',
    isPreview: context === 'deploy-preview',
    isBranchDeploy: context === 'branch-deploy',
    isLocal: context === 'local',

    // Build metadata
    buildTime: now.toISOString(),
    buildTimestamp: now.getTime(),

    // Branch & PR info
    branch: branch,
    pullRequest: env.PULL_REQUEST === 'true',
    reviewId: env.REVIEW_ID || null,

    // Netlify-specific
    deployId: env.DEPLOY_ID || null,
    deployUrl: env.DEPLOY_PRIME_URL || env.DEPLOY_URL || null,
    siteUrl: env.URL || null,
    siteName: env.SITE_NAME || null,

    // Runtime endpoint hints for poker WS client
    pokerWsUrl: env.POKER_WS_URL || 'wss://ws.kcswh.pl/ws',
    pokerWsPreviewUrl: env.POKER_WS_PREVIEW_URL || 'wss://ws-preview.kcswh.pl/ws',

    // Node version used for build
    nodeVersion: process.version,
  };

  return buildInfo;
}

function pickSupabasePublicConfig(env) {
  return {
    url: env.SUPABASE_URL || env.SUPABASE_URL_V2 || "",
    anonKey: env.SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY_V2 || "",
  };
}

function generateSupabaseConfig(env) {
  const config = pickSupabasePublicConfig(env);
  if (!config.url || !config.anonKey) {
    return false;
  }

  const outputDir = path.join(process.cwd(), "js", "auth");
  const outputPath = path.join(outputDir, "supabase-config.js");

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const content = [
    "// Auto-generated by scripts/generate-build-info.js",
    "// Do not edit manually - this file is regenerated on Netlify builds",
    "window.SUPABASE_CONFIG = {",
    "  SUPABASE_URL: " + JSON.stringify(config.url) + ",",
    "  SUPABASE_ANON_KEY: " + JSON.stringify(config.anonKey),
    "};",
    "",
  ].join("\n");

  fs.writeFileSync(outputPath, content, "utf8");
  console.log("Supabase public config generated:");
  console.log("  URL: " + config.url);
  console.log("  Anon key present: " + (config.anonKey.length > 0));
  console.log("  Output: " + outputPath);
  return true;
}

function normalizeDeployOrigin(raw) {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

function generateServerDeployContext(context, deployPrimeUrl) {
  const supported = new Set(['production', 'deploy-preview', 'branch-deploy', 'dev', 'development']);
  const value = supported.has(context) ? context : 'unknown';
  const outputDir = path.join(process.cwd(), 'netlify', 'functions', '_generated');
  const outputPath = path.join(outputDir, 'deploy-context.mjs');
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(outputPath, [
    '// Auto-generated by scripts/generate-build-info.js during Netlify builds.',
    `export const BUILD_DEPLOY_CONTEXT = ${JSON.stringify(value)};`,
    `export const BUILD_DEPLOY_ORIGIN = ${JSON.stringify(normalizeDeployOrigin(deployPrimeUrl))};`,
    '',
  ].join('\n'), 'utf8');
  console.log(`Server deploy context generated: ${value}`);
}

function main() {
  const buildInfo = generateBuildInfo();

  // Output relative to current working directory (where build runs from)
  const outputDir = path.join(process.cwd(), 'js');
  const outputPath = path.join(outputDir, 'build-info.js');

  // Ensure js/ directory exists
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Create the JS module that exposes build info globally
  const content = `// Auto-generated by scripts/generate-build-info.js
// Do not edit manually - this file is regenerated on each build
window.BUILD_INFO = ${JSON.stringify(buildInfo, null, 2)};
`;

  fs.writeFileSync(outputPath, content, 'utf8');

  console.log('Build info generated:');
  console.log(`  Version: ${buildInfo.commitShort}`);
  console.log(`  Build type: ${buildInfo.buildType}`);
  console.log(`  Context: ${buildInfo.context}`);
  console.log(`  Branch: ${buildInfo.branch}`);
  console.log(`  Build time: ${buildInfo.buildTime}`);
  if (buildInfo.deployId) {
    console.log(`  Deploy ID: ${buildInfo.deployId}`);
  }
  if (buildInfo.reviewId) {
    console.log(`  PR #${buildInfo.reviewId}`);
  }
  console.log(`  Output: ${outputPath}`);

  if (!generateSupabaseConfig(process.env)) {
    console.log("Supabase public config not generated: SUPABASE_URL/SUPABASE_ANON_KEY missing");
  }
  generateServerDeployContext(buildInfo.context, process.env.DEPLOY_PRIME_URL);
}

main();
