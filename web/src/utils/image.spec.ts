import { afterEach, describe, expect, it, vi } from 'vitest';
import { shrinkImage } from './image';

function fakeCanvas(outputSize: number, outputType?: string) {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: vi.fn() }),
    toBlob: (done: (blob: Blob) => void, type: string) => done(new Blob(['x'.repeat(outputSize)], { type: outputType || type })),
  };
  vi.spyOn(document, 'createElement').mockReturnValue(canvas as unknown as HTMLElement);
  return canvas;
}

function photo(type: string, size: number, name = 'photo.jpeg') {
  return new File(['x'.repeat(size)], name, { type });
}

describe('shrinkImage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('downscales large photos to a 2048px long edge', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }));
    const canvas = fakeCanvas(500);

    const result = await shrinkImage(photo('image/jpeg', 5000));

    expect([canvas.width, canvas.height]).toEqual([2048, 1536]);
    expect(result.type).toBe('image/jpeg');
    expect(result.name).toBe('photo.jpg');
    expect(result.size).toBe(500);
  });

  it('turns screenshots into WebP and keeps the original when the browser cannot encode WebP', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 3000, height: 2000, close: vi.fn() }));
    fakeCanvas(500);
    expect((await shrinkImage(photo('image/png', 5000, 'shot.png'))).name).toBe('shot.webp');

    vi.restoreAllMocks();
    fakeCanvas(500, 'image/png');
    const original = photo('image/png', 5000, 'shot.png');
    expect(await shrinkImage(original)).toBe(original);
  });

  it('leaves GIFs, small images and larger re-encodes unchanged', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 800, height: 600, close: vi.fn() }));
    const gif = photo('image/gif', 5_000_000, 'a.gif');
    expect(await shrinkImage(gif)).toBe(gif);
    const small = photo('image/jpeg', 2000);
    expect(await shrinkImage(small)).toBe(small);

    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 4000, height: 3000, close: vi.fn() }));
    fakeCanvas(9000);
    const compact = photo('image/jpeg', 5000);
    expect(await shrinkImage(compact)).toBe(compact);
  });
});
