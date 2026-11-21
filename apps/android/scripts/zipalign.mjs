import { readFileSync, writeFileSync } from 'node:fs';

const SIG_LFH = 0x04034b50;
const SIG_CDH = 0x02014b50;
const SIG_EOCD = 0x06054b50;

function findEocdOffset(buf) {
  const minPos = Math.max(0, buf.length - 65557);
  for (let pos = buf.length - 22; pos >= minPos; pos--) {
    if (buf.readUInt32LE(pos) === SIG_EOCD) {
      return pos;
    }
  }
  throw new Error('Invalid ZIP/APK: EOCD record not found');
}

export function alignApk(inputPath, outputPath) {
  const inBuf = readFileSync(inputPath);
  const eocdPos = findEocdOffset(inBuf);
  const totalEntries = inBuf.readUInt16LE(eocdPos + 10);
  const cdOffset = inBuf.readUInt32LE(eocdPos + 16);

  const outChunks = [];
  const cdChunks = [];
  let outOffset = 0;
  let cdPos = cdOffset;

  for (let i = 0; i < totalEntries; i++) {
    if (inBuf.readUInt32LE(cdPos) !== SIG_CDH) {
      throw new Error(`Invalid Central Directory signature at ${cdPos}`);
    }

    const flags = inBuf.readUInt16LE(cdPos + 8);
    const method = inBuf.readUInt16LE(cdPos + 10);
    const crc32 = inBuf.readUInt32LE(cdPos + 16);
    const compSize = inBuf.readUInt32LE(cdPos + 20);
    const uncompSize = inBuf.readUInt32LE(cdPos + 24);
    const nameLen = inBuf.readUInt16LE(cdPos + 28);
    const extraLen = inBuf.readUInt16LE(cdPos + 30);
    const commentLen = inBuf.readUInt16LE(cdPos + 32);
    const localOff = inBuf.readUInt32LE(cdPos + 42);

    const name = inBuf.subarray(cdPos + 46, cdPos + 46 + nameLen).toString('utf8');
    const cdTotalLen = 46 + nameLen + extraLen + commentLen;
    const cdRaw = Buffer.from(inBuf.subarray(cdPos, cdPos + cdTotalLen));
    cdPos += cdTotalLen;

    if (inBuf.readUInt32LE(localOff) !== SIG_LFH) {
      throw new Error(`Invalid Local File Header signature for ${name} at ${localOff}`);
    }

    const lfhNameLen = inBuf.readUInt16LE(localOff + 26);
    const lfhExtraLen = inBuf.readUInt16LE(localOff + 28);
    const lfhRaw = Buffer.from(inBuf.subarray(localOff, localOff + 30));
    const lfhName = inBuf.subarray(localOff + 30, localOff + 30 + lfhNameLen);
    const lfhExtra = inBuf.subarray(
      localOff + 30 + lfhNameLen,
      localOff + 30 + lfhNameLen + lfhExtraLen,
    );
    const dataStart = localOff + 30 + lfhNameLen + lfhExtraLen;
    const payload = inBuf.subarray(dataStart, dataStart + compSize);

    // Strip data descriptor bit (0x08) and ensure CRC/sizes exist directly in LFH
    const cleanFlags = flags & ~0x0008;
    lfhRaw.writeUInt16LE(cleanFlags, 6);
    lfhRaw.writeUInt32LE(crc32, 14);
    lfhRaw.writeUInt32LE(compSize, 18);
    lfhRaw.writeUInt32LE(uncompSize, 22);
    cdRaw.writeUInt16LE(cleanFlags, 8);

    let padLen = 0;
    if (method === 0) {
      const align = name.endsWith('.so') ? 4096 : 4;
      const baseDataOffset = outOffset + 30 + lfhName.length + lfhExtra.length;
      const rem = baseDataOffset % align;
      padLen = rem === 0 ? 0 : align - rem;
    }

    lfhRaw.writeUInt16LE(lfhExtra.length + padLen, 28);
    cdRaw.writeUInt32LE(outOffset, 42);

    outChunks.push(lfhRaw, lfhName, lfhExtra);
    if (padLen > 0) {
      outChunks.push(Buffer.alloc(padLen));
    }
    outChunks.push(payload);
    outOffset += 30 + lfhName.length + lfhExtra.length + padLen + payload.length;

    cdChunks.push(cdRaw);
  }

  const newCdOffset = outOffset;
  const cdBuffer = Buffer.concat(cdChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(totalEntries, 8);
  eocd.writeUInt16LE(totalEntries, 10);
  eocd.writeUInt32LE(cdBuffer.length, 12);
  eocd.writeUInt32LE(newCdOffset, 16);
  eocd.writeUInt16LE(0, 20);

  outChunks.push(cdBuffer, eocd);
  writeFileSync(outputPath, Buffer.concat(outChunks));
}

export function verifyApkAlignment(apkPath) {
  const buf = readFileSync(apkPath);
  const eocdPos = findEocdOffset(buf);
  const totalEntries = buf.readUInt16LE(eocdPos + 10);
  const cdOffset = buf.readUInt32LE(eocdPos + 16);

  let cdPos = cdOffset;
  let foundResources = false;

  for (let i = 0; i < totalEntries; i++) {
    const method = buf.readUInt16LE(cdPos + 10);
    const nameLen = buf.readUInt16LE(cdPos + 28);
    const extraLen = buf.readUInt16LE(cdPos + 30);
    const commentLen = buf.readUInt16LE(cdPos + 32);
    const localOff = buf.readUInt32LE(cdPos + 42);
    const name = buf.subarray(cdPos + 46, cdPos + 46 + nameLen).toString('utf8');
    cdPos += 46 + nameLen + extraLen + commentLen;

    const lfhNameLen = buf.readUInt16LE(localOff + 26);
    const lfhExtraLen = buf.readUInt16LE(localOff + 28);
    const dataOffset = localOff + 30 + lfhNameLen + lfhExtraLen;

    if (name === 'resources.arsc') {
      foundResources = true;
      if (method !== 0) {
        throw new Error('resources.arsc MUST be stored uncompressed (method=0) for Android 11+');
      }
    }
    if (method === 0) {
      const align = name.endsWith('.so') ? 4096 : 4;
      if (dataOffset % align !== 0) {
        throw new Error(
          `Unaligned STORE entry "${name}": offset ${dataOffset} is not a multiple of ${align}`,
        );
      }
    }
  }

  if (!foundResources) {
    throw new Error('APK is missing resources.arsc');
  }
}
