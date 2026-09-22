// Build a square app icon from the wide ISHITA wordmark: white logo centered on
// the brand teal, exported as build/icon.png (512) and build/icon.ico.
import { Jimp } from 'jimp';
import pngToIco from 'png-to-ico';
import fs from 'fs';

const SIZE = 512;
const TEAL = 0x0f5f6bff; // #0f5f6b, opaque

const canvas = new Jimp({ width: SIZE, height: SIZE, color: TEAL });

const logo = await Jimp.read('src/assets/logo.png');
// Force every visible pixel to white, keep the alpha (the mark is dark-on-transparent).
const d = logo.bitmap.data;
for (let i = 0; i < d.length; i += 4) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; }

const targetW = Math.round(SIZE * 0.74);
const scale = targetW / logo.bitmap.width;
logo.resize({ w: targetW, h: Math.round(logo.bitmap.height * scale) });

const x = Math.round((SIZE - logo.bitmap.width) / 2);
const y = Math.round((SIZE - logo.bitmap.height) / 2);
canvas.composite(logo, x, y);

fs.mkdirSync('build', { recursive: true });
await canvas.write('build/icon.png');

const buf256 = await canvas.clone().resize({ w: 256, h: 256 }).getBuffer('image/png');
const ico = await pngToIco([buf256]);
fs.writeFileSync('build/icon.ico', ico);

console.log('Wrote build/icon.png and build/icon.ico');
