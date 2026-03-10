// Generate a simple PNG icon for the app
// Run: node scripts/generate-icon.js

const fs = require('fs');
const path = require('path');

// Create a minimal 256x256 PNG with "CH" text
// This creates a valid PNG file with a purple background and white text

function createPNG(width, height, pixels) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type (RGB)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = makeChunk('IHDR', ihdr);

  // IDAT - raw pixel data with zlib
  const zlib = require('zlib');
  const rawData = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + width * 3)] = 0; // filter none
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 3;
      const offset = y * (1 + width * 3) + 1 + x * 3;
      rawData[offset] = pixels[idx];
      rawData[offset + 1] = pixels[idx + 1];
      rawData[offset + 2] = pixels[idx + 2];
    }
  }
  const compressed = zlib.deflateSync(rawData);
  const idatChunk = makeChunk('IDAT', compressed);

  // IEND
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeBuf, data]);

  // CRC32
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < crcData.length; i++) {
    crc ^= crcData[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  crc = (crc ^ 0xFFFFFFFF) >>> 0;
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc, 0);

  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

const SIZE = 256;
const pixels = Buffer.alloc(SIZE * SIZE * 3);

// Colors
const BG = [139, 92, 246]; // Purple (#8b5cf6)
const FG = [255, 255, 255]; // White

// Fill background with rounded rectangle feel
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const idx = (y * SIZE + x) * 3;
    // Simple rounded corners
    const cornerR = 40;
    let inside = true;
    if (x < cornerR && y < cornerR) inside = Math.hypot(x - cornerR, y - cornerR) <= cornerR;
    if (x > SIZE - cornerR && y < cornerR) inside = Math.hypot(x - (SIZE - cornerR), y - cornerR) <= cornerR;
    if (x < cornerR && y > SIZE - cornerR) inside = Math.hypot(x - cornerR, y - (SIZE - cornerR)) <= cornerR;
    if (x > SIZE - cornerR && y > SIZE - cornerR) inside = Math.hypot(x - (SIZE - cornerR), y - (SIZE - cornerR)) <= cornerR;

    if (inside) {
      // Slight gradient
      const t = y / SIZE;
      pixels[idx] = Math.round(BG[0] * (1 - t * 0.2));
      pixels[idx + 1] = Math.round(BG[1] * (1 - t * 0.2));
      pixels[idx + 2] = Math.round(BG[2] * (1 - t * 0.15));
    } else {
      pixels[idx] = 13; // Dark background
      pixels[idx + 1] = 13;
      pixels[idx + 2] = 15;
    }
  }
}

// Draw "PH" letters using simple pixel font (block style)
// P letter
const letterData = {
  P: [
    [1,1,1,1,0],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,1,1,1,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
    [1,0,0,0,0],
  ],
  H: [
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,1,1,1,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
    [1,0,0,0,1],
  ],
};

const blockSize = 16;
const letterW = 5 * blockSize;
const letterH = 7 * blockSize;
const gap = 12;
const totalW = letterW * 2 + gap;
const startX = Math.floor((SIZE - totalW) / 2);
const startY = Math.floor((SIZE - letterH) / 2);

function drawLetter(letter, ox, oy) {
  const data = letterData[letter];
  for (let row = 0; row < data.length; row++) {
    for (let col = 0; col < data[row].length; col++) {
      if (data[row][col]) {
        for (let by = 0; by < blockSize; by++) {
          for (let bx = 0; bx < blockSize; bx++) {
            const px = ox + col * blockSize + bx;
            const py = oy + row * blockSize + by;
            if (px >= 0 && px < SIZE && py >= 0 && py < SIZE) {
              const idx = (py * SIZE + px) * 3;
              pixels[idx] = FG[0];
              pixels[idx + 1] = FG[1];
              pixels[idx + 2] = FG[2];
            }
          }
        }
      }
    }
  }
}

drawLetter('P', startX, startY);
drawLetter('H', startX + letterW + gap, startY);

const png = createPNG(SIZE, SIZE, pixels);
const outPath = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(outPath, png);
console.log(`Icon generated: ${outPath} (${png.length} bytes)`);
