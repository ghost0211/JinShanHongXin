import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { alignApk, verifyApkAlignment } from './zipalign.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const androidRoot = resolve(__dirname, '..');
const repoRoot = resolve(androidRoot, '../..');
const clientDistDir = join(repoRoot, 'apps/client/dist');
const appMainDir = join(androidRoot, 'app/src/main');
const assetsWwwDir = join(appMainDir, 'assets/www');
const sdkCacheDir = join(androidRoot, '.sdk-cache');
const buildDir = join(androidRoot, 'build');
const distDir = join(androidRoot, 'dist');

const PLATFORM_ZIP_URL =
  process.env.ANDROID_PLATFORM_URL ??
  'https://dl.google.com/android/repository/platform-35_r02.zip';

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    stdio: opts.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: opts.capture ? 'utf8' : undefined,
    cwd: opts.cwd ?? androidRoot,
  });
}

function collectFiles(dir, suffix) {
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      results.push(...collectFiles(full, suffix));
    } else if (full.endsWith(suffix)) {
      results.push(full);
    }
  }
  return results;
}

function ensureAndroidJar() {
  if (process.env.ANDROID_JAR && existsSync(process.env.ANDROID_JAR)) {
    return process.env.ANDROID_JAR;
  }
  const cachedJar = join(sdkCacheDir, 'android-35/android.jar');
  if (existsSync(cachedJar)) {
    return cachedJar;
  }

  mkdirSync(dirname(cachedJar), { recursive: true });
  const tmpZip = join(sdkCacheDir, 'platform-35.zip');
  console.log(`[APK] 首次构建，正在下载官方 Android API 35 平台库 (${PLATFORM_ZIP_URL})...`);
  run('curl', ['-fSL', '--retry', '3', '-o', tmpZip, PLATFORM_ZIP_URL]);

  const listing = run('unzip', ['-Z1', tmpZip], { capture: true });
  const jarEntry = listing
    .split(/\r?\n/)
    .find((line) => line.trim().endsWith('/android.jar') || line.trim() === 'android.jar');
  if (!jarEntry) {
    rmSync(tmpZip, { force: true });
    throw new Error('下载的 Android 平台压缩包中未找到 android.jar');
  }

  console.log(`[APK] 提取 ${jarEntry.trim()} 到本地缓存...`);
  const jarBuf = execFileSync('unzip', ['-p', tmpZip, jarEntry.trim()], {
    maxBuffer: 120 * 1024 * 1024,
  });
  writeFileSync(cachedJar, jarBuf);
  rmSync(tmpZip, { force: true });
  return cachedJar;
}

function ensureDebugKeystore() {
  const ksPath = join(sdkCacheDir, 'debug.keystore');
  if (existsSync(ksPath)) return ksPath;

  mkdirSync(sdkCacheDir, { recursive: true });
  console.log('[APK] 生成本地调试签名证书 debug.keystore...');
  run('keytool', [
    '-genkeypair',
    '-v',
    '-keystore',
    ksPath,
    '-storepass',
    'android',
    '-alias',
    'androiddebugkey',
    '-keypass',
    'android',
    '-keyalg',
    'RSA',
    '-keysize',
    '2048',
    '-validity',
    '10000',
    '-dname',
    'CN=JinshanHongXinDebug,O=JinshanHongXin,C=CN',
  ]);
  return ksPath;
}

function resolveSigningConfig() {
  const base64Ks = process.env.ANDROID_KEYSTORE_BASE64?.trim();
  const explicitPath = process.env.ANDROID_KEYSTORE_PATH?.trim();
  if (base64Ks || (explicitPath && existsSync(explicitPath))) {
    let ksPath = explicitPath;
    if (base64Ks) {
      mkdirSync(sdkCacheDir, { recursive: true });
      ksPath = join(sdkCacheDir, 'ci-release.keystore');
      writeFileSync(ksPath, Buffer.from(base64Ks, 'base64'));
    }
    const alias = process.env.ANDROID_KEY_ALIAS?.trim() || 'release';
    const storePass = process.env.ANDROID_KEYSTORE_PASS || '';
    const keyPass = process.env.ANDROID_KEY_PASS || storePass;
    console.log(`[APK] 使用配置签名证书 (${alias})...`);
    return { ksPath, alias, storePass, keyPass };
  }

  const ksPath = ensureDebugKeystore();
  return {
    ksPath,
    alias: 'androiddebugkey',
    storePass: 'android',
    keyPass: 'android',
  };
}

function semverToVersionCode(versionName) {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(String(versionName || '').replace(/^v/i, ''));
  if (!m) return 1;
  return Math.max(1, Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]));
}

function main() {
  if (!existsSync(join(clientDistDir, 'index.html'))) {
    throw new Error('未找到 apps/client/dist/index.html，请先执行 npm run build');
  }

  console.log('[APK] 1/7 同步前端离线构建产物到 assets/www/...');
  rmSync(assetsWwwDir, { recursive: true, force: true });
  mkdirSync(assetsWwwDir, { recursive: true });
  cpSync(clientDistDir, assetsWwwDir, { recursive: true });

  const androidJar = ensureAndroidJar();
  const signing = resolveSigningConfig();

  const clientPkg = JSON.parse(readFileSync(join(repoRoot, 'apps/client/package.json'), 'utf8'));
  const versionName = (process.env.JINSHAN_APP_VERSION || clientPkg.version || '0.3.0').replace(
    /^v/i,
    '',
  );
  const versionCode = process.env.JINSHAN_VERSION_CODE
    ? Number(process.env.JINSHAN_VERSION_CODE)
    : semverToVersionCode(versionName);

  rmSync(buildDir, { recursive: true, force: true });
  mkdirSync(join(buildDir, 'gen'), { recursive: true });
  mkdirSync(join(buildDir, 'classes'), { recursive: true });
  mkdirSync(join(buildDir, 'dex'), { recursive: true });
  mkdirSync(distDir, { recursive: true });

  const resZip = join(buildDir, 'res.zip');
  const unsignedRawApk = join(buildDir, 'unsigned-raw.apk');
  const unsignedAlignedApk = join(buildDir, 'unsigned-aligned.apk');
  const finalApk = process.env.ANDROID_APK_OUT
    ? resolve(repoRoot, process.env.ANDROID_APK_OUT)
    : join(distDir, 'jinshan-hongxin-debug.apk');
  mkdirSync(dirname(finalApk), { recursive: true });

  console.log(`[APK] 2/7 编译与链接 Android 资源 (aapt2, v${versionName} / code ${versionCode})...`);
  run('aapt2', ['compile', '--dir', join(appMainDir, 'res'), '-o', resZip]);
  run('aapt2', [
    'link',
    '-I',
    androidJar,
    '--manifest',
    join(appMainDir, 'AndroidManifest.xml'),
    '--version-name',
    versionName,
    '--version-code',
    String(versionCode),
    '-A',
    join(appMainDir, 'assets'),
    '-R',
    resZip,
    '--java',
    join(buildDir, 'gen'),
    '--min-sdk-version',
    '26',
    '--target-sdk-version',
    '35',
    '--auto-add-overlay',
    '-o',
    unsignedRawApk,
  ]);

  console.log('[APK] 3/7 编译 Java 源码 (javac --release 11)...');
  const javaFiles = [
    ...collectFiles(join(buildDir, 'gen'), '.java'),
    ...collectFiles(join(appMainDir, 'java'), '.java'),
  ];
  run('javac', [
    '--release',
    '11',
    '-encoding',
    'UTF-8',
    '-classpath',
    androidJar,
    '-d',
    join(buildDir, 'classes'),
    ...javaFiles,
  ]);

  console.log('[APK] 4/7 生成 Dalvik 字节码 classes.dex (d8)...');
  const classFiles = collectFiles(join(buildDir, 'classes'), '.class');
  run('d8', [
    '--min-api',
    '26',
    '--lib',
    androidJar,
    '--output',
    join(buildDir, 'dex'),
    ...classFiles,
  ]);

  console.log('[APK] 5/7 注入 classes.dex 并执行 4 字节对齐...');
  run('zip', ['-j', '-q', unsignedRawApk, join(buildDir, 'dex/classes.dex')]);
  alignApk(unsignedRawApk, unsignedAlignedApk);
  verifyApkAlignment(unsignedAlignedApk);

  console.log('[APK] 6/7 对 APK 执行 v1+v2+v3 签名 (apksigner)...');
  run('apksigner', [
    'sign',
    '--ks',
    signing.ksPath,
    '--ks-key-alias',
    signing.alias,
    '--ks-pass',
    `pass:${signing.storePass}`,
    '--key-pass',
    `pass:${signing.keyPass}`,
    '--v1-signing-enabled',
    'true',
    '--v2-signing-enabled',
    'true',
    '--v3-signing-enabled',
    'true',
    '--out',
    finalApk,
    unsignedAlignedApk,
  ]);

  console.log('[APK] 7/7 校验签名与包体信息...');
  run('apksigner', ['verify', '--verbose', finalApk]);
  const badging = run('aapt2', ['dump', 'badging', finalApk], { capture: true });
  const summaryLines = badging
    .split(/\r?\n/)
    .filter((l) =>
      /^(package:|sdkVersion:|targetSdkVersion:|application-label:|launchable-activity:|supports-screens:)/.test(
        l,
      ),
    );
  console.log(summaryLines.join('\n'));

  const sizeKb = (statSync(finalApk).size / 1024).toFixed(1);
  console.log(`\n✅ 安卓安装包构建成功: ${finalApk} (${sizeKb} KB)`);
}

main();
