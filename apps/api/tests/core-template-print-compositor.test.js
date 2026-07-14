const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const { composeTemplatePrint } = require('../src/core/template-print-compositor');

sharp.cache(false);

async function removeFixture(root) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EBUSY') throw error;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  await fs.rm(root, { recursive: true, force: true });
}

async function createFixture(root) {
  const templatePath = path.join(root, 'template.png');
  const printPath = path.join(root, 'original-print.png');
  const maskPath = path.join(root, 'replace-mask.png');
  const cleanMaskPath = path.join(root, 'clean-mask.png');
  const outputPath = path.join(root, 'output.png');

  await sharp({
    create: { width: 96, height: 64, channels: 4, background: { r: 208, g: 208, b: 208, alpha: 1 } }
  })
    .composite([
      { input: Buffer.from('<svg width="76" height="44"><rect width="76" height="44" fill="#f6f6f6"/></svg>'), left: 10, top: 10 },
      { input: Buffer.from('<svg width="2" height="44"><rect width="2" height="44" fill="#181818"/></svg>'), left: 47, top: 10 },
      { input: Buffer.from('<svg width="6" height="6"><circle cx="3" cy="3" r="3" fill="#101010"/></svg>'), left: 38, top: 29 }
    ])
    .png()
    .toFile(templatePath);

  await sharp({
    create: { width: 4000, height: 2000, channels: 4, background: { r: 220, g: 30, b: 40, alpha: 1 } }
  })
    .composite([
      { input: Buffer.from('<svg width="2000" height="2000"><rect width="2000" height="2000" fill="#145ce6"/></svg>'), left: 2000, top: 0 }
    ])
    .png({ compressionLevel: 0 })
    .toFile(printPath);

  await sharp({
    create: { width: 96, height: 64, channels: 3, background: '#000' }
  })
    .composite([
      { input: Buffer.from('<svg width="76" height="44"><rect width="76" height="44" fill="#fff"/></svg>'), left: 10, top: 10 }
    ])
    .png()
    .toFile(maskPath);

  return { templatePath, printPath, maskPath, cleanMaskPath, outputPath };
}

function createBmp24(width, height, pixelAt) {
  const rowBytes = Math.ceil(width * 3 / 4) * 4;
  const bytes = Buffer.alloc(54 + rowBytes * height);
  bytes.write('BM', 0, 2, 'ascii');
  bytes.writeUInt32LE(bytes.length, 2);
  bytes.writeUInt32LE(54, 10);
  bytes.writeUInt32LE(40, 14);
  bytes.writeInt32LE(width, 18);
  bytes.writeInt32LE(height, 22);
  bytes.writeUInt16LE(1, 26);
  bytes.writeUInt16LE(24, 28);
  bytes.writeUInt32LE(rowBytes * height, 34);
  for (let fileY = 0; fileY < height; fileY += 1) {
    const y = height - 1 - fileY;
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = pixelAt(x, y);
      const offset = 54 + fileY * rowBytes + x * 3;
      bytes[offset] = b;
      bytes[offset + 1] = g;
      bytes[offset + 2] = r;
    }
  }
  return bytes;
}

test('full-resolution compositor preserves template dimensions and every pixel outside the cleaned mask', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-template-compositor-'));
  t.after(() => removeFixture(root));
  const fixture = await createFixture(root);
  const sourceStat = await fs.stat(fixture.printPath);

  const result = await composeTemplatePrint(fixture);

  assert.equal(result.width, 96);
  assert.equal(result.height, 64);
  assert.equal(result.sourceBytes, sourceStat.size);
  assert.equal(result.sourceWidth, 4000);
  assert.equal(result.sourceHeight, 2000);
  assert.ok(result.maskPixels > 1000);

  const template = await sharp(fixture.templatePath).ensureAlpha().raw().toBuffer();
  const output = await sharp(fixture.outputPath).ensureAlpha().raw().toBuffer();
  const cleanMask = await sharp(fixture.cleanMaskPath).greyscale().raw().toBuffer();
  for (let index = 0; index < cleanMask.length; index += 1) {
    if (cleanMask[index] !== 0) continue;
    const offset = index * 4;
    assert.deepEqual(
      [...output.subarray(offset, offset + 4)],
      [...template.subarray(offset, offset + 4)],
      `outside-mask pixel ${index} changed`
    );
  }

  const pixel = (buffer, x, y) => [...buffer.subarray((y * 96 + x) * 4, (y * 96 + x) * 4 + 4)];
  assert.deepEqual(pixel(output, 48, 20), pixel(template, 48, 20), 'dark cabinet seam must remain unchanged');
  assert.deepEqual(pixel(output, 40, 32), pixel(template, 40, 32), 'dark handle must remain unchanged');
  assert.ok(pixel(output, 20, 30)[0] > 180, 'left side should contain the original red print');
  assert.ok(pixel(output, 75, 30)[2] > 180, 'right side should contain the original blue print');
});

test('compositor rejects an empty printable mask before producing output', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-template-compositor-empty-'));
  t.after(() => removeFixture(root));
  const fixture = await createFixture(root);
  await sharp({ create: { width: 96, height: 64, channels: 3, background: '#000' } }).png().toFile(fixture.maskPath);

  await assert.rejects(
    composeTemplatePrint(fixture),
    /蒙版为空|没有可执行的印花区域/
  );
  await assert.rejects(fs.access(fixture.outputPath));
});

test('compositor writes the real container format while preserving template dimensions', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-template-compositor-formats-'));
  t.after(() => removeFixture(root));
  const fixture = await createFixture(root);
  const formats = [
    { extension: '.jpg', signature: bytes => bytes[0] === 0xff && bytes[1] === 0xd8 },
    { extension: '.webp', signature: bytes => bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP' },
    { extension: '.tiff', signature: bytes => ['II*\u0000', 'MM\u0000*'].includes(bytes.subarray(0, 4).toString('binary')) },
    { extension: '.gif', signature: bytes => /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii')) },
    { extension: '.bmp', signature: bytes => bytes.subarray(0, 2).toString('ascii') === 'BM' }
  ];

  for (const format of formats) {
    const outputPath = path.join(root, `output${format.extension}`);
    const result = await composeTemplatePrint({ ...fixture, outputPath });
    const bytes = await fs.readFile(outputPath);
    assert.equal(format.signature(bytes), true, `${format.extension} signature must match its file name`);
    if (format.extension === '.bmp') {
      assert.equal(bytes.readInt32LE(18), 96);
      assert.equal(bytes.readInt32LE(22), 64);
    } else {
      const metadata = await sharp(outputPath).metadata();
      assert.equal(metadata.width, 96);
      assert.equal(metadata.height, 64);
    }
    assert.equal(result.width, 96);
    assert.equal(result.height, 64);
  }
});

test('compositor reads Windows BMP templates and original BMP prints at full source dimensions', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-template-compositor-bmp-input-'));
  t.after(() => removeFixture(root));
  const templatePath = path.join(root, 'template.bmp');
  const printPath = path.join(root, 'original-print.bmp');
  const maskPath = path.join(root, 'mask.png');
  const outputPath = path.join(root, 'output.png');
  await fs.writeFile(templatePath, createBmp24(96, 64, () => [240, 240, 240]));
  await fs.writeFile(printPath, createBmp24(400, 200, x => x < 200 ? [220, 30, 40] : [20, 92, 230]));
  await sharp({ create: { width: 96, height: 64, channels: 3, background: '#fff' } }).png().toFile(maskPath);

  const result = await composeTemplatePrint({ templatePath, printPath, maskPath, outputPath });

  assert.equal(result.width, 96);
  assert.equal(result.height, 64);
  assert.equal(result.sourceWidth, 400);
  assert.equal(result.sourceHeight, 200);
  const output = await sharp(outputPath).ensureAlpha().raw().toBuffer();
  const pixel = (x, y) => [...output.subarray((y * 96 + x) * 4, (y * 96 + x) * 4 + 4)];
  assert.ok(pixel(20, 32)[0] > 180);
  assert.ok(pixel(75, 32)[2] > 180);
});

test('compositor uses oriented template dimensions for EXIF-rotated JPEG templates', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-template-compositor-orientation-'));
  t.after(() => removeFixture(root));
  const templatePath = path.join(root, 'template.jpg');
  const printPath = path.join(root, 'original-print.png');
  const maskPath = path.join(root, 'mask.png');
  const outputPath = path.join(root, 'output.jpg');

  await sharp({
    create: { width: 90, height: 60, channels: 3, background: '#f8f8f8' }
  })
    .jpeg({ quality: 98 })
    .withMetadata({ orientation: 6 })
    .toFile(templatePath);
  await sharp({ create: { width: 1200, height: 600, channels: 3, background: '#df2435' } })
    .png({ compressionLevel: 0 })
    .toFile(printPath);
  await sharp({ create: { width: 60, height: 90, channels: 3, background: '#fff' } })
    .png()
    .toFile(maskPath);

  const result = await composeTemplatePrint({ templatePath, printPath, maskPath, outputPath });

  assert.equal(result.width, 60);
  assert.equal(result.height, 90);
  const outputMetadata = await sharp(outputPath).metadata();
  assert.equal(outputMetadata.width, 60);
  assert.equal(outputMetadata.height, 90);
});
