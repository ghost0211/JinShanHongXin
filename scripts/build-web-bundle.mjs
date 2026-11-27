import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function makeCrcTable() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = makeCrcTable();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Pure-Node standard PKZIP creator (Deflate method 8) with UTF-8 filenames.
 * Works identically on Linux, macOS, Windows, and Android Termux without external tools.
 */
export function createZipBuffer(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const name = entry.name.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(name, 'utf8');
    const raw = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data);
    const compressed = deflateRawSync(raw, { level: 9 });
    const useDeflate = compressed.length < raw.length;
    const payload = useDeflate ? compressed : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // UTF-8 filename flag
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10); // Mod time
    localHeader.writeUInt16LE(0x5421, 12); // Mod date (2022-01-01 fixed for determinism)
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(payload.length, 18);
    localHeader.writeUInt32LE(raw.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // Extra length

    localParts.push(localHeader, nameBuf, payload);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central dir signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed
    centralHeader.writeUInt16LE(0x0800, 8); // UTF-8 flag
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0x5421, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(payload.length, 20);
    centralHeader.writeUInt32LE(raw.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // Extra length
    centralHeader.writeUInt16LE(0, 32); // Comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number
    centralHeader.writeUInt16LE(0, 36); // Internal attrs
    centralHeader.writeUInt32LE(0, 38); // External attrs
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, nameBuf);
    offset += localHeader.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuf, eocd]);
}

function collectFilesRecursive(dir) {
  const files = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...collectFilesRecursive(full));
    } else if (st.isFile()) {
      files.push(full);
    }
  }
  return files;
}

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

export function buildWebBundle(options = {}) {
  const releaseConfig = JSON.parse(readFileSync(join(repoRoot, 'release-config.json'), 'utf8'));
  const clientPkg = JSON.parse(readFileSync(join(repoRoot, 'apps/client/package.json'), 'utf8'));
  const rawVersion = options.version || process.env.JINSHAN_APP_VERSION || clientPkg.version;
  const version = String(rawVersion).replace(/^v/i, '');
  const tag = options.tag || `v${version}`;
  const distDir = resolve(options.distDir || join(repoRoot, 'apps/client/dist'));
  const outDir = resolve(options.outDir || join(repoRoot, 'release-dist'));

  if (!existsSync(join(distDir, 'index.html'))) {
    throw new Error(`未找到 ${join(distDir, 'index.html')}，请先执行 npm run build`);
  }

  const files = collectFilesRecursive(distDir);
  const entries = files.map((filePath) => ({
    name: relative(distDir, filePath).replace(/\\/g, '/'),
    data: readFileSync(filePath),
  }));

  const otaMeta = {
    version,
    tag,
    minNativeVersion: releaseConfig.minNativeVersion,
    builtAt: new Date().toISOString(),
    fileCount: entries.length,
  };
  entries.push({
    name: 'ota-meta.json',
    data: Buffer.from(JSON.stringify(otaMeta, null, 2) + '\n', 'utf8'),
  });

  const zipBuf = createZipBuffer(entries);
  const sha256 = createHash('sha256').update(zipBuf).digest('hex');
  const fileName = `jinshan-web-bundle-${tag}.zip`;

  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, fileName);
  writeFileSync(outPath, zipBuf);

  return {
    version,
    tag,
    fileName,
    outPath,
    sha256,
    size: zipBuf.length,
    fileCount: entries.length,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  const res = buildWebBundle({
    version: args.version,
    tag: args.tag,
    distDir: args.dist,
    outDir: args.out,
  });
  console.log(
    `✅ 前端热更新资源包构建成功: ${res.outPath} (${(res.size / 1024).toFixed(1)} KB, ${res.fileCount} files, sha256=${res.sha256.slice(0, 12)}…)`,
  );
}
