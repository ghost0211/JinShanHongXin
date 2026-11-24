/**
 * Zero-dependency ISO/IEC 18004 QR Code encoder (Byte mode, ECL L, Versions 1–6).
 * Supports up to 134 UTF-8 bytes — plenty for offline LAN join URLs.
 */

export interface QrMatrix {
  version: number;
  size: number;
  modules: boolean[][];
}

interface VersionSpec {
  version: number;
  size: number;
  totalDataCodewords: number;
  ecCodewordsPerBlock: number;
  blocks: number;
  alignmentCenters: readonly number[];
}

// ISO/IEC 18004 Table 9 (Error Correction Level L)
const VERSION_SPECS: readonly VersionSpec[] = [
  { version: 1, size: 21, totalDataCodewords: 19, ecCodewordsPerBlock: 7, blocks: 1, alignmentCenters: [] },
  { version: 2, size: 25, totalDataCodewords: 34, ecCodewordsPerBlock: 10, blocks: 1, alignmentCenters: [6, 18] },
  { version: 3, size: 29, totalDataCodewords: 55, ecCodewordsPerBlock: 15, blocks: 1, alignmentCenters: [6, 22] },
  { version: 4, size: 33, totalDataCodewords: 80, ecCodewordsPerBlock: 20, blocks: 1, alignmentCenters: [6, 26] },
  { version: 5, size: 37, totalDataCodewords: 108, ecCodewordsPerBlock: 26, blocks: 1, alignmentCenters: [6, 30] },
  { version: 6, size: 41, totalDataCodewords: 136, ecCodewordsPerBlock: 18, blocks: 2, alignmentCenters: [6, 34] },
];

// GF(256) tables with primitive polynomial x^8 + x^4 + x^3 + x^2 + 1 (0x11d)
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) {
    GF_EXP[i] = GF_EXP[i - 255];
  }
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const root = GF_EXP[i];
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], root);
    }
    poly = next;
  }
  return poly;
}

function rsComputeEcc(data: Uint8Array, ecLen: number): Uint8Array {
  const gen = rsGeneratorPoly(ecLen);
  const rem = new Uint8Array(ecLen);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ rem[0];
    rem.copyWithin(0, 1);
    rem[ecLen - 1] = 0;
    if (factor !== 0) {
      for (let j = 0; j < ecLen; j++) {
        rem[j] ^= gfMul(gen[j + 1], factor);
      }
    }
  }
  return rem;
}

function encodeUtf8(text: string): Uint8Array {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text);
  }
  const encoded = unescape(encodeURIComponent(text));
  const bytes = new Uint8Array(encoded.length);
  for (let i = 0; i < encoded.length; i++) {
    bytes[i] = encoded.charCodeAt(i);
  }
  return bytes;
}

function buildCodewords(bytes: Uint8Array, spec: VersionSpec): Uint8Array {
  const bitBuf: number[] = [];
  const pushBits = (val: number, len: number) => {
    for (let i = len - 1; i >= 0; i--) {
      bitBuf.push((val >>> i) & 1);
    }
  };

  // Mode: Byte (0100), Count: 8 bits (for Versions 1-9)
  pushBits(0b0100, 4);
  pushBits(bytes.length, 8);
  for (const b of bytes) {
    pushBits(b, 8);
  }

  const maxBits = spec.totalDataCodewords * 8;
  const termLen = Math.min(4, maxBits - bitBuf.length);
  pushBits(0, termLen);
  while (bitBuf.length % 8 !== 0) {
    bitBuf.push(0);
  }

  const dataBytes = new Uint8Array(spec.totalDataCodewords);
  const filledCodewords = bitBuf.length / 8;
  for (let i = 0; i < filledCodewords; i++) {
    let val = 0;
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | bitBuf[i * 8 + b];
    }
    dataBytes[i] = val;
  }
  for (let i = filledCodewords; i < spec.totalDataCodewords; i++) {
    dataBytes[i] = (i - filledCodewords) % 2 === 0 ? 0xec : 0x11;
  }

  // Split into RS blocks and interleave (Versions 1-6 L all have equal-sized blocks)
  const blockDataLen = spec.totalDataCodewords / spec.blocks;
  const dataBlocks: Uint8Array[] = [];
  const eccBlocks: Uint8Array[] = [];
  for (let b = 0; b < spec.blocks; b++) {
    const slice = dataBytes.subarray(b * blockDataLen, (b + 1) * blockDataLen);
    dataBlocks.push(slice);
    eccBlocks.push(rsComputeEcc(slice, spec.ecCodewordsPerBlock));
  }

  const out = new Uint8Array(
    spec.totalDataCodewords + spec.blocks * spec.ecCodewordsPerBlock,
  );
  let pos = 0;
  for (let i = 0; i < blockDataLen; i++) {
    for (let b = 0; b < spec.blocks; b++) {
      out[pos++] = dataBlocks[b][i];
    }
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    for (let b = 0; b < spec.blocks; b++) {
      out[pos++] = eccBlocks[b][i];
    }
  }
  return out;
}

function computeFormatBitsL(mask: number): number {
  const data = (0b01 << 3) | (mask & 0b111); // ECL L = 01
  let rem = data << 10;
  for (let bit = 14; bit >= 10; bit--) {
    if ((rem >>> bit) & 1) {
      rem ^= 0x537 << (bit - 10);
    }
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function maskBit(mask: number, r: number, c: number): boolean {
  switch (mask) {
    case 0: return (r + c) % 2 === 0;
    case 1: return r % 2 === 0;
    case 2: return c % 3 === 0;
    case 3: return (r + c) % 3 === 0;
    case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default: return false;
  }
}

function placeFormatBits(modules: boolean[][], size: number, mask: number): void {
  const bits = computeFormatBitsL(mask);
  const bitAt = (idx: number) => ((bits >>> idx) & 1) === 1;

  // Copy 1: around top-left finder
  const coords1: ReadonlyArray<[number, number]> = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) {
    const [r, c] = coords1[i];
    modules[r][c] = bitAt(14 - i);
  }

  // Copy 2: bottom-left vertical (b14..b8) + top-right horizontal (b7..b0)
  for (let i = 0; i < 7; i++) {
    modules[size - 1 - i][8] = bitAt(14 - i);
  }
  modules[size - 8][8] = true; // Mandatory dark module
  for (let i = 0; i < 8; i++) {
    modules[8][size - 8 + i] = bitAt(7 - i);
  }
}

function evaluatePenalty(modules: boolean[][], size: number): number {
  let penalty = 0;

  // Rule 1: adjacent modules in row/col of same color
  for (let r = 0; r < size; r++) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }
  for (let c = 0; c < size; c++) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (modules[r][c] === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = modules[r][c];
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const color = modules[r][c];
      if (
        color === modules[r][c + 1] &&
        color === modules[r + 1][c] &&
        color === modules[r + 1][c + 1]
      ) {
        penalty += 3;
      }
    }
  }

  // Rule 3: finder-like 1:1:3:1:1 patterns
  const matchFinderPattern = (get: (i: number) => boolean, start: number) => {
    const a =
      get(start) && !get(start + 1) && get(start + 2) && get(start + 3) && get(start + 4) &&
      !get(start + 5) && get(start + 6) && !get(start + 7) && !get(start + 8) && !get(start + 9) && !get(start + 10);
    const b =
      !get(start) && !get(start + 1) && !get(start + 2) && !get(start + 3) && get(start + 4) &&
      !get(start + 5) && get(start + 6) && get(start + 7) && get(start + 8) && !get(start + 9) && get(start + 10);
    return a || b;
  };
  for (let r = 0; r < size; r++) {
    for (let c = 0; c <= size - 11; c++) {
      if (matchFinderPattern((i) => modules[r][i], c)) penalty += 40;
    }
  }
  for (let c = 0; c < size; c++) {
    for (let r = 0; r <= size - 11; r++) {
      if (matchFinderPattern((i) => modules[i][c], r)) penalty += 40;
    }
  }

  // Rule 4: balance of dark modules
  let dark = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (modules[r][c]) dark++;
    }
  }
  const total = size * size;
  const k = Math.floor(Math.abs(dark * 20 - total * 10) / total);
  penalty += k * 10;
  return penalty;
}

export function encodeQrCode(text: string): QrMatrix {
  const bytes = encodeUtf8(text);
  const spec = VERSION_SPECS.find((v) => bytes.length <= v.totalDataCodewords - 2);
  if (!spec) {
    throw new Error(`QR text too long (${bytes.length} bytes, max 134 bytes)`);
  }

  const size = spec.size;
  const baseModules: boolean[][] = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false),
  );
  const isFunc: boolean[][] = Array.from({ length: size }, () =>
    Array<boolean>(size).fill(false),
  );

  const setFunc = (r: number, c: number, dark: boolean) => {
    if (r >= 0 && r < size && c >= 0 && c < size) {
      baseModules[r][c] = dark;
      isFunc[r][c] = true;
    }
  };

  // Finder patterns + separators
  const drawFinder = (top: number, left: number) => {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = top + dr;
        const c = left + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter = dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6;
        const isDark =
          inOuter &&
          (dr === 0 ||
            dr === 6 ||
            dc === 0 ||
            dc === 6 ||
            (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
        setFunc(r, c, isDark);
      }
    }
  };
  drawFinder(0, 0);
  drawFinder(0, size - 7);
  drawFinder(size - 7, 0);

  // Timing patterns
  for (let i = 8; i < size - 8; i++) {
    setFunc(6, i, i % 2 === 0);
    setFunc(i, 6, i % 2 === 0);
  }

  // Alignment patterns
  const centers = spec.alignmentCenters;
  for (let i = 0; i < centers.length; i++) {
    for (let j = 0; j < centers.length; j++) {
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === centers.length - 1) ||
        (i === centers.length - 1 && j === 0)
      ) {
        continue;
      }
      const cr = centers[i];
      const cc = centers[j];
      for (let dr = -2; dr <= 2; dr++) {
        for (let dc = -2; dc <= 2; dc++) {
          const dist = Math.max(Math.abs(dr), Math.abs(dc));
          setFunc(cr + dr, cc + dc, dist !== 1);
        }
      }
    }
  }

  // Reserve format info cells
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      isFunc[8][i] = true;
      isFunc[i][8] = true;
    }
  }
  for (let i = size - 8; i < size; i++) {
    isFunc[8][i] = true;
    isFunc[i][8] = true;
  }
  setFunc(size - 8, 8, true);

  // Place data + EC bits in standard zig-zag order
  const codewords = buildCodewords(bytes, spec);
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const r = upward ? size - 1 - step : step;
      for (let dx = 0; dx < 2; dx++) {
        const c = right - dx;
        if (isFunc[r][c]) continue;
        const dark =
          bitIdx < totalBits
            ? ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) === 1
            : false;
        baseModules[r][c] = dark;
        bitIdx++;
      }
    }
    upward = !upward;
  }

  // Choose the mask pattern (0..7) with the lowest penalty score
  let bestModules = baseModules;
  let bestPenalty = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const cand: boolean[][] = Array.from({ length: size }, (_, r) =>
      Array.from({ length: size }, (_, c) =>
        isFunc[r][c] ? baseModules[r][c] : baseModules[r][c] !== maskBit(mask, r, c),
      ),
    );
    placeFormatBits(cand, size, mask);
    const penalty = evaluatePenalty(cand, size);
    if (penalty < bestPenalty) {
      bestPenalty = penalty;
      bestModules = cand;
    }
  }

  return {
    version: spec.version,
    size,
    modules: bestModules,
  };
}
