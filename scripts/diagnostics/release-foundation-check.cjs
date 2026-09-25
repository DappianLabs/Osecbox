#!/usr/bin/env node
'use strict';

/**
 * Release-foundation preflight.
 *
 * This check is deliberately separate from packaging. It validates the
 * repository, target matrix, signing contract, updater metadata, and CI
 * guardrails before a real release tag is pushed. It never creates a tag,
 * publishes a release, reads secret contents, or changes build output.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..', '..');
const args = process.argv.slice(2);
const releaseMode = args.includes('--release');
const ciMode = args.includes('--ci');
const targetArg = args.find((arg) => /^--target=(win|linux|mac)$/.test(arg));
const target = targetArg ? targetArg.split('=')[1] : null;
const tagArg = args.find((arg) => arg.startsWith('--tag='));
const requestedTag = tagArg ? tagArg.slice('--tag='.length).trim() : '';

const failures = [];
const warnings = [];

function pass(label, detail) {
  console.log('PASS ' + label + (detail ? ' — ' + detail : ''));
}

function fail(label, detail) {
  console.error('FAIL ' + label + (detail ? ' — ' + detail : ''));
  failures.push(label);
}

function warn(label, detail) {
  console.warn('WARN ' + label + (detail ? ' — ' + detail : ''));
  warnings.push(label);
}

function readText(relativePath) {
  const filePath = path.join(root, relativePath);
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function fileIsPresent(relativePath) {
  const filePath = path.join(root, relativePath);
  return fs.existsSync(filePath) &&
    fs.statSync(filePath).isFile() &&
    fs.statSync(filePath).size > 0;
}

function check(label, condition, detail) {
  if (condition) pass(label, detail);
  else fail(label, detail);
}

function normalizeGithubUrl(value) {
  return String(value || '')
    .trim()
    .replace(/^git@github\.com:/i, 'https://github.com/')
    .replace(/^ssh:\/\/git@github\.com\//i, 'https://github.com/')
    .replace(/\.git$/i, '')
    .replace(/\/+$/g, '')
    .toLowerCase();
}

function runGit(gitArgs) {
  const result = spawnSync('git', ['-c', 'safe.directory=' + root].concat(gitArgs), {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
  });
  return {
    ok: result.status === 0,
    output: String(result.stdout || '').trim(),
    error: String(result.stderr || '').trim(),
  };
}

function hasNonEmptyEnv() {
  return Array.from(arguments).some((name) => String(process.env[name] || '').trim().length > 0);
}

function releaseTagFromEnvironment() {
  if (requestedTag) return requestedTag;
  if (process.env.GITHUB_REF_NAME) return String(process.env.GITHUB_REF_NAME).trim();
  const ref = String(process.env.GITHUB_REF || '').trim();
  return ref.startsWith('refs/tags/') ? ref.slice('refs/tags/'.length) : '';
}

const pkg = readJson('package.json');
const lock = readJson('package-lock.json');
const builder = readJson('electron-builder.json');
const packageScripts = pkg && pkg.scripts ? pkg.scripts : {};
const builderText = readText('electron-builder.json');
const ciWorkflow = readText('.github/workflows/ci.yml');
const releaseWorkflow = readText('.github/workflows/release.yml');
const gitignore = readText('.gitignore');
const readme = readText('README.md');
const developmentDocs = readText('docs/development.md');

console.log('\nOsecBox release-foundation preflight' + (releaseMode ? ' — release gate' : ''));
console.log('Repository root: ' + root);
console.log('Requested target: ' + (target || 'win + linux'));

check('package.json exists', Boolean(pkg));
check('package-lock.json exists', Boolean(lock));
check('Electron Builder configuration exists', Boolean(builder));
check(
  'Node engine and .nvmrc agree',
  pkg && pkg.engines && pkg.engines.node === '>=22.13.0' &&
  readText('.nvmrc').trim() === '22.13.0',
);
check(
  'package and lock versions agree',
  Boolean(pkg && pkg.version && lock && lock.version === pkg.version &&
    lock.packages && lock.packages[''] && lock.packages[''].version === pkg.version),
  'version=' + (pkg && pkg.version ? pkg.version : 'missing'),
);
check(
  'package version is release-compatible',
  Boolean(pkg && typeof pkg.version === 'string' &&
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(pkg.version)),
  pkg && pkg.version ? pkg.version : 'missing',
);

const expectedRepository = normalizeGithubUrl(pkg && pkg.repository && pkg.repository.url);
const configuredRepository = normalizeGithubUrl(
  builder && builder.publish && builder.publish.owner && builder.publish.repo
    ? 'https://github.com/' + builder.publish.owner + '/' + builder.publish.repo
    : '',
);
check(
  'package and Electron Builder point to the same GitHub repository',
  Boolean(expectedRepository && configuredRepository && expectedRepository === configuredRepository),
  (expectedRepository || 'package repository missing') + ' vs ' +
  (configuredRepository || 'builder repository missing'),
);
check('Electron entrypoint is configured', pkg && pkg.main === 'dist/electron/main.cjs');
check('Native target guard exists', fileIsPresent('scripts/build/verify-build-target.cjs'));
check('Package audit exists', fileIsPresent('scripts/diagnostics/packaged-artifact-audit.cjs'));
check(
  'Checksum writer and verifier exist',
  fileIsPresent('scripts/diagnostics/write-release-checksums.cjs') &&
  fileIsPresent('scripts/diagnostics/verify-release-checksums.cjs'),
);

const requiredScripts = [
  'check',
  'check:electron',
  'test',
  'build',
  'build:production:win',
  'build:production:linux',
  'audit:platform',
  'audit:dependencies',
  'audit:package',
  'release:checksums',
  'release:verify-checksums',
  'release:foundation',
];
for (const script of requiredScripts) {
  check('npm script exists: ' + script, typeof packageScripts[script] === 'string');
}

const winTargets = builder && builder.win && Array.isArray(builder.win.target) ? builder.win.target : [];
const linuxTargets = builder && builder.linux && Array.isArray(builder.linux.target)
  ? builder.linux.target
  : [];
check(
  'Windows ships an interactive installer and portable executable',
  winTargets.includes('nsis') && winTargets.includes('portable'),
  winTargets.join(', ') || 'missing',
);
check(
  'Windows installer is per-user and configurable',
  builder && builder.nsis && builder.nsis.oneClick === false &&
  builder.nsis.perMachine === false &&
  builder.nsis.allowToChangeInstallationDirectory === true,
);
check(
  'Windows updater signature verification is enabled',
  builder && builder.win && builder.win.verifyUpdateCodeSignature === true,
);
check(
  'Linux ships AppImage, deb, and tar.gz targets',
  ['AppImage', 'deb', 'tar.gz'].every((item) => linuxTargets.includes(item)),
  linuxTargets.join(', ') || 'missing',
);
check(
  'Linux desktop metadata and executable name are configured',
  Boolean(builder && builder.linux && builder.linux.category && builder.linux.executableName),
);
check(
  'Release artifact names are deterministic and versioned',
  builder && builder.win && builder.win.artifactName === '${productName}-${version}-${arch}.${ext}' &&
  builder.nsis && builder.nsis.artifactName === '${productName}-${version}-${arch}-Setup.${ext}' &&
  builder.linux && builder.linux.artifactName === '${productName}-${version}-${arch}.${ext}',
  'Windows setup/portable and Linux package names include product, version, architecture, and extension',
);
check(
  'Packaging uses ASAR and keeps native PTY resources unpacked',
  builder && builder.asar === true &&
  Array.isArray(builder.asarUnpack) &&
  builder.asarUnpack.some((item) => String(item).includes('node-pty')),
);
check(
  'Packaging does not let electron-builder rebuild native modules',
  builder && builder.npmRebuild === false,
);
check(
  'Encrypted runtime modules are external resources',
  builder && Array.isArray(builder.extraResources) &&
  builder.extraResources.some((item) => item && item.from === 'encrypted-modules' &&
    item.to === 'encrypted-modules'),
);
check(
  'Production packaging invokes artifact audit and checksum generation',
  readText('scripts/build/build-production.js').includes('packaged-artifact-audit.cjs') &&
  readText('scripts/build/build-production.js').includes('release:checksums'),
);

for (const asset of ['build/icon.png', 'build/icon.ico']) {
  check('Brand asset exists: ' + asset, fileIsPresent(asset));
}
check(
  'macOS signing metadata is isolated from the Windows/Linux release lane',
  !releaseWorkflow.includes('target: mac') && !releaseWorkflow.includes('macos-'),
  'macOS packaging remains available through the explicit mac target script',
);

check('CI workflow exists', Boolean(ciWorkflow));
check('Tagged release workflow exists', Boolean(releaseWorkflow));
check(
  'CI defaults to read-only contents permission',
  /permissions:\s*[\r\n]+\s*contents:\s*read/.test(ciWorkflow),
);
check(
  'Release defaults to read-only contents permission',
  /permissions:\s*[\r\n]+\s*contents:\s*read/.test(releaseWorkflow),
);
check(
  'Release publish job requests contents write permission',
  /publish:[\s\S]*?permissions:\s*[\r\n]+\s*contents:\s*write/.test(releaseWorkflow),
);
check(
  'Release is tag-only',
  /push:\s*[\r\n]+\s*tags:\s*[\r\n]+\s*-\s*['"]v\*['"]/.test(releaseWorkflow),
);
check(
  'Release workflow builds Windows and Linux targets',
  /target:\s+win/.test(releaseWorkflow) && /target:\s+linux/.test(releaseWorkflow),
);
check(
  'Release workflow verifies Windows Authenticode signatures',
  releaseWorkflow.includes('WINDOWS_CSC_LINK') &&
  releaseWorkflow.includes('WINDOWS_CSC_KEY_PASSWORD') &&
  releaseWorkflow.includes('Get-AuthenticodeSignature'),
);
check(
  'CI and release workflows scan packaged artifacts with updated AV engines',
  ciWorkflow.includes('clamscan') &&
  ciWorkflow.includes('freshclam') &&
  ciWorkflow.includes('MpCmdRun.exe') &&
  ciWorkflow.includes('ProgramData/Microsoft/Windows Defender/Platform') &&
  releaseWorkflow.includes('clamscan') &&
  releaseWorkflow.includes('freshclam') &&
  releaseWorkflow.includes('MpCmdRun.exe') &&
  releaseWorkflow.includes('ProgramData/Microsoft/Windows Defender/Platform'),
);
check(
  'Pull requests run dependency review',
  ciWorkflow.includes('actions/dependency-review-action@v4') &&
  ciWorkflow.includes('fail-on-severity: high'),
);

check(
  'Release workflow verifies per-target checksums before publishing',
  releaseWorkflow.includes('release:verify-checksums') &&
  releaseWorkflow.includes('sha256sum --check'),
);
check(
  'Release workflow keeps updater metadata with Windows artifacts',
  releaseWorkflow.includes('latest.yml') && releaseWorkflow.includes('*.blockmap'),
);
check(
  'Release workflow publishes with the automatic GitHub token',
  releaseWorkflow.includes('softprops/action-gh-release') &&
  releaseWorkflow.includes('secrets.GITHUB_TOKEN'),
);
check(
  'CI never exposes the encryption secret to pull requests',
  ciWorkflow.includes("github.event_name == 'push' && github.ref == 'refs/heads/main'") &&
  ciWorkflow.includes('BUILD_ENCRYPTION_SECRET'),
);

check(
  'Generated output is ignored',
  gitignore.includes('dist/') &&
  gitignore.includes('release/') &&
  gitignore.includes('encrypted-modules/'),
);
check(
  'Signing material and local secrets are ignored',
  ['.env', 'BUILD_ENCRYPTION_SECRET', '*.pfx', '*.p12', '*.pem', '*.key']
    .every((entry) => gitignore.includes(entry)),
);
check(
  'Release documentation explains signing and target scope',
  readme.includes('WINDOWS_CSC_LINK') &&
  developmentDocs.includes('WINDOWS_CSC_LINK') &&
  fileIsPresent('docs/release.md'),
);

const configuredTag = releaseTagFromEnvironment();
if (configuredTag) {
  check(
    'Release tag uses the vX.Y.Z form',
    /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(configuredTag),
    configuredTag,
  );
  check(
    'Release tag matches package version',
    configuredTag.replace(/^v/, '') === (pkg && pkg.version),
    configuredTag + ' vs v' + (pkg && pkg.version ? pkg.version : 'missing'),
  );
} else if (releaseMode) {
  fail(
    'Release tag is available',
    'pass --tag=v' + (pkg && pkg.version ? pkg.version : 'X.Y.Z') +
    ' locally or push a v* tag in GitHub Actions',
  );
} else {
  warn(
    'No release tag supplied',
    'final gate expects v' + (pkg && pkg.version ? pkg.version : 'X.Y.Z'),
  );
}

const buildSecretValid = /^[a-f0-9]{64}$/i.test(
  String(process.env.BUILD_ENCRYPTION_SECRET || '').trim(),
);
if (releaseMode) {
  check(
    'BUILD_ENCRYPTION_SECRET is configured without exposing its value',
    buildSecretValid,
    '64 hexadecimal characters required',
  );
} else if (buildSecretValid) {
  pass('BUILD_ENCRYPTION_SECRET is available for this run');
} else {
  warn(
    'BUILD_ENCRYPTION_SECRET is not available locally',
    'required by native packaging and the tagged release workflow',
  );
}

const checksWindows = !target || target === 'win';
if (checksWindows) {
  const windowsSigningConfigured = hasNonEmptyEnv('CSC_LINK', 'WINDOWS_CSC_LINK') &&
    hasNonEmptyEnv('CSC_KEY_PASSWORD', 'WINDOWS_CSC_KEY_PASSWORD');
  if (releaseMode) {
    check(
      'Windows Authenticode credentials are configured without exposing their values',
      windowsSigningConfigured,
      'CSC_LINK/CSC_KEY_PASSWORD or WINDOWS_CSC_LINK/WINDOWS_CSC_KEY_PASSWORD required',
    );
  } else if (windowsSigningConfigured) {
    pass('Windows signing credentials are available for this run');
  } else {
    warn(
      'Windows signing credentials are not available locally',
      'local artifacts will be unsigned; the tagged release workflow blocks without them',
    );
  }
}

if (target === 'linux' || !target) {
  pass(
    'Linux release integrity contract',
    'published Linux artifacts use SHA-256 checksums; no platform certificate is required',
  );
}

const gitDirectory = fs.existsSync(path.join(root, '.git'));
if (!gitDirectory) {
  (releaseMode ? fail : warn)(
    'Git metadata is present',
    'initialize or clone the repository before publishing',
  );
} else {
  const head = runGit(['rev-parse', '--verify', 'HEAD']);
  if (head.ok) pass('Repository has a commit to release', head.output);
  else (releaseMode ? fail : warn)(
    'Repository has a commit to release',
    'the current checkout has no initial commit',
  );

  const remote = runGit(['remote', 'get-url', 'origin']);
  const identityName = runGit(['config', 'user.name']);
  const identityEmail = runGit(['config', 'user.email']);
  if (identityName.ok && identityName.output && identityEmail.ok && identityEmail.output) {
    pass('Git author identity is configured', identityName.output + ' <' + identityEmail.output + '>');
  } else {
    (releaseMode ? fail : warn)(
      'Git author identity is configured',
      'set git config user.name and user.email before committing',
    );
  }

  const worktree = runGit(['status', '--porcelain']);
  if (worktree.ok && !worktree.output) pass('Working tree is clean before release');
  else (releaseMode ? fail : warn)(
    'Working tree is clean before release',
    'commit or stash changes before creating the release tag',
  );
  if (remote.ok && remote.output) {
    const remoteRepository = normalizeGithubUrl(remote.output);
    if (expectedRepository && remoteRepository === expectedRepository) {
      pass('origin remote matches package repository', remote.output);
    } else {
      (releaseMode ? fail : warn)(
        'origin remote matches package repository',
        remote.output + ' vs ' + (pkg && pkg.repository ? pkg.repository.url : 'missing package repository'),
      );
    }
  } else {
    (releaseMode ? fail : warn)(
      'origin remote is configured',
      'add the GitHub remote before pushing main or a release tag',
    );
  }
}

if (ciMode) {
  pass(
    'CI mode selected',
    'repository credentials are checked by the workflow, not printed by this script',
  );
}

console.log(
  '\nRelease-foundation result: ' + failures.length + ' blockers, ' + warnings.length + ' warnings.',
);
if (failures.length > 0) {
  process.exitCode = 1;
}
