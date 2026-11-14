// صورة PNG صغيرة مختلفة في كل استدعاء (منع تكرار الصور يرفض نفس الصورة لمنتجين)
import sharp from 'sharp';

let n = 0;
export async function uniquePng() {
  n += 1;
  const c = (k) => (n * k + Math.floor(Math.random() * 256)) % 256;
  return sharp({ create: { width: 4, height: 4, channels: 3, background: { r: c(37), g: c(71), b: c(113) } } }).png({ compressionLevel: 0 }).withMetadata({ exif: { IFD0: { ImageDescription: `t${n}-${Date.now()}-${Math.random()}` } } }).toBuffer();
}
