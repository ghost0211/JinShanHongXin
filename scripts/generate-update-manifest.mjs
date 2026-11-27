import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key.startsWith('--') && i + 1 < argv.length) {
      args[key.slice(2)] = argv[++i];
    }
  }
  return args;
}

function sha256File(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function describeAsset(dir, fileName, repo, tag) {
  if (!fileName) return null;
  const full = join(dir, fileName);
  if (!existsSync(full) || !statSync(full).isFile()) return null;
  return {
    fileName,
    url: `https://github.com/${repo}/releases/download/${tag}/${fileName}`,
    sha256: sha256File(full),
    size: statSync(full).size,
  };
}

function readGitTagNotes(tag) {
  try {
    const out = execFileSync('git', ['tag', '-l', '--format=%(contents)', tag], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out;
  } catch {
    return '';
  }
}

export function generateUpdateManifest(options = {}) {
  const releaseConfig = JSON.parse(readFileSync(join(repoRoot, 'release-config.json'), 'utf8'));
  const clientPkg = JSON.parse(readFileSync(join(repoRoot, 'apps/client/package.json'), 'utf8'));
  const repo = options.repo || releaseConfig.repo;
  const rawTag = options.tag || process.env.JINSHAN_RELEASE_TAG || `v${clientPkg.version}`;
  const tag = rawTag.startsWith('v') ? rawTag : `v${rawTag}`;
  const version = tag.replace(/^v/i, '');
  const dir = resolve(options.dir || join(repoRoot, 'release-dist'));
  const files = existsSync(dir) ? readdirSync(dir).sort() : [];

  const webBundleFile = files.find((f) => /^jinshan-web-bundle-.*\.zip$/i.test(f));
  const androidApkFile = files.find((f) => /\.apk$/i.test(f));
  const windowsInstallerFile = files.find((f) => /\.exe$/i.test(f));
  const windowsPortableFile = files.find((f) => /windows.*portable.*\.zip$/i.test(f));

  let notes = options.notes || '';
  if (!notes && options.notesFile && existsSync(options.notesFile)) {
    notes = readFileSync(options.notesFile, 'utf8').trim();
  }
  if (!notes) {
    notes = readGitTagNotes(tag);
  }
  if (!notes) {
    notes = `金山打红心 · 打黑心 ${tag} 正式发布`;
  }

  const manifest = {
    schemaVersion: 1,
    version,
    tag,
    publishedAt: new Date().toISOString(),
    minNativeVersion: options.minNativeVersion || releaseConfig.minNativeVersion,
    notes,
    releaseUrl: `https://github.com/${repo}/releases/tag/${tag}`,
    webBundle: describeAsset(dir, webBundleFile, repo, tag),
    androidApk: describeAsset(dir, androidApkFile, repo, tag),
    windowsInstaller: describeAsset(dir, windowsInstallerFile, repo, tag),
    windowsPortable: describeAsset(dir, windowsPortableFile, repo, tag),
  };

  const outPath = resolve(options.out || join(dir, 'update-manifest.json'));
  writeFileSync(outPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  return { manifest, outPath };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const { manifest, outPath } = generateUpdateManifest({
    dir: args.dir,
    tag: args.tag,
    out: args.out,
    notes: args.notes,
    notesFile: args['notes-file'],
    minNativeVersion: args['min-native-version'],
    repo: args.repo,
  });
  console.log(`✅ 更新清单已生成: ${outPath}`);
  console.log(
    JSON.stringify(
      {
        version: manifest.version,
        minNativeVersion: manifest.minNativeVersion,
        webBundle: manifest.webBundle?.fileName ?? null,
        androidApk: manifest.androidApk?.fileName ?? null,
        windowsInstaller: manifest.windowsInstaller?.fileName ?? null,
        windowsPortable: manifest.windowsPortable?.fileName ?? null,
      },
      null,
      2,
    ),
  );
}
