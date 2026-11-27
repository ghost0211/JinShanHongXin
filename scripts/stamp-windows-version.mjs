import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

const raw = process.argv[2] || process.env.JINSHAN_APP_VERSION || '';
const version = raw.trim().replace(/^v/i, '');
if (!/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error(`Invalid release semver version: "${raw}"`);
}

const tauriPath = resolve(repoRoot, 'apps/windows/src-tauri/tauri.conf.json');
const tauriConf = JSON.parse(readFileSync(tauriPath, 'utf8'));
tauriConf.version = version;
writeFileSync(tauriPath, JSON.stringify(tauriConf, null, 2) + '\n', 'utf8');

const cargoPath = resolve(repoRoot, 'apps/windows/src-tauri/Cargo.toml');
const cargo = readFileSync(cargoPath, 'utf8').replace(
  /^version = ".*"$/m,
  `version = "${version}"`,
);
writeFileSync(cargoPath, cargo, 'utf8');

const winPkgPath = resolve(repoRoot, 'apps/windows/package.json');
const winPkg = JSON.parse(readFileSync(winPkgPath, 'utf8'));
winPkg.version = version;
writeFileSync(winPkgPath, JSON.stringify(winPkg, null, 2) + '\n', 'utf8');

console.log(`Stamped Windows Tauri manifests with version ${version}`);
