const MAX_EDGE = 2048;
const QUALITY = 0.85;
const SMALL_ENOUGH = 1_000_000;
const RESIZABLE = ['image/jpeg', 'image/png', 'image/webp'];

// Downscale photos in the browser before upload; the original is not kept.
// GIFs (animation), other types and browsers without canvas support upload unchanged.
export async function shrinkImage(file: File): Promise<File> {
  if (!RESIZABLE.includes(file.type) || typeof createImageBitmap !== 'function') return file;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    return file;
  }
  try {
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= SMALL_ENOUGH) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // PNG/WebP may be transparent, so they become WebP; JPEG stays JPEG.
    const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, QUALITY));
    // Browsers without a WebP encoder return PNG instead; keep the original then.
    if (!blob || blob.type !== type || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]*$/, '') + (type === 'image/jpeg' ? '.jpg' : '.webp');
    return new File([blob], name, { type, lastModified: file.lastModified });
  } finally {
    bitmap.close();
  }
}
