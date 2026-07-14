const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');

const { composeTemplatePrint } = require('../src/core/template-print-compositor');

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

test('full-resolution compositor preserves template dimensions and every pixel outside the cleaned mask', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'caishen-template-compositor-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
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
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const fixture = await createFixture(root);
  await sharp({ create: { width: 96, height: 64, channels: 3, background: '#000' } }).png().toFile(fixture.maskPath);

  await assert.rejects(
    composeTemplatePrint(fixture),
    /蒙版为空|没有可执行的印花区域/
  );
  await assert.rejects(fs.access(fixture.outputPath));
});
