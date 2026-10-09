// Reproduce the approved-board dealer export; no image synthesis or remote model.
// Uses the existing project sharp dependency. Run from the repository root.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

(async function(){
  const root = path.resolve(__dirname, '../../..');
  const source = path.join(__dirname, 'premium-collection.png');
  const maskPath = path.join(__dirname, 'royal-gold-dealer-mask.svg');
  const output = path.join(root, 'poker/assets/themes/royal-gold/dealer.webp');
  const scaled = await sharp(source).extract({ left: 1250, top: 40, width: 135, height: 140 })
    .resize(810, 840, { kernel: 'lanczos3' }).ensureAlpha().png().toBuffer();
  // The source table occludes the lower waist. Continue only that hidden fabric
  // with sampled dress pixels so the unchanged live rail can occlude it again.
  const waist = await sharp(scaled).extract({ left: 310, top: 594, width: 269, height: 33 })
    .resize(269, 100, { kernel: 'lanczos3' }).png().toBuffer();
  const continued = await sharp(scaled).composite([{ input: waist, left: 310, top: 615 }]).png().toBuffer();
  const mask = await sharp(maskPath).png().toBuffer();
  const isolated = await sharp(continued).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
  const encoded = await sharp(isolated).extract({ left: 60, top: 48, width: 684, height: 736 })
    .resize(546, 640, { fit: 'fill', kernel: 'lanczos3' })
    .sharpen({ sigma: 0.5, m1: 0.4, m2: 1 }).webp({ quality: 92, alphaQuality: 100 }).toBuffer();
  fs.writeFileSync(output, encoded);
  process.stdout.write(JSON.stringify({ path: output, bytes: encoded.length,
    sha256: crypto.createHash('sha256').update(encoded).digest('hex') }) + '\n');
})().catch(function(error){ process.stderr.write(error.message + '\n'); process.exitCode = 1; });
