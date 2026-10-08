import { describe, expect, it, vi } from 'vitest';
import { createVisionHandler, isLandmarkOnly, toLandmarkMessage, type FromWorker } from './visionProtocol';

const hand = (x: number) => Array.from({ length: 21 }, (_, i) => ({ x: x + i * 0.001, y: 0.5, z: 0, visibility: 0.9 }));

class FakeBitmap { closed = false; width = 640; height = 480; close() { this.closed = true; } }

function rawResult() {
  return {
    landmarks: [hand(0.3)],
    worldLandmarks: [hand(0.1)],
    handedness: [[{ categoryName: 'Left', score: 0.98, index: 0, displayName: '' }]],
    // things a real result / buggy code might carry: must never be posted
    image: new FakeBitmap(),
    segmentationMasks: [new Float32Array(16)],
    buffer: new ArrayBuffer(32),
  };
}

describe('vision worker protocol', () => {
  it('[T0-10] worker posts only landmark data; frames are closed and never posted back', async () => {
    const posted: Array<{ msg: FromWorker; transfer: unknown }> = [];
    const handler = createVisionHandler({
      createHand: async () => ({ detectForVideo: () => rawResult() as never }),
      createFace: async () => ({ detectForVideo: () => ({ faceLandmarks: [hand(0.5)], faceBlendshapes: [{}], image: new FakeBitmap() }) as never }),
      post: (msg) => posted.push({ msg, transfer: undefined }),
    });
    await handler({ type: 'init', baseUrl: '/mediapipe', hands: true, face: true });
    const frames = [new FakeBitmap(), new FakeBitmap(), new FakeBitmap()];
    for (const [i, f] of frames.entries()) await handler({ type: 'frame', id: i + 1, t: 1000 + i * 16, frame: f as unknown as ImageBitmap });

    expect(posted[0].msg).toEqual({ type: 'ready', hands: true, face: true });
    const lm = posted.filter((p) => p.msg.type === 'landmarks').map((p) => p.msg);
    expect(lm).toHaveLength(3);
    for (const m of posted) {
      expect(isLandmarkOnly(m.msg)).toBe(true);
      expect(JSON.parse(JSON.stringify(m.msg))).toEqual(m.msg); // pure JSON, nothing binary
    }
    const first = lm[0] as Extract<FromWorker, { type: 'landmarks' }>;
    expect(Object.keys(first).sort()).toEqual(['face', 'hands', 'id', 'procMs', 't', 'type']);
    expect(first.hands[0].landmarks).toHaveLength(21);
    expect(Object.keys(first.hands[0].landmarks[0]).sort()).toEqual(['x', 'y', 'z']);
    expect(first.face).toHaveLength(21);
    // every frame transferred in is closed after inference (no retention)
    expect(frames.every((f) => f.closed)).toBe(true);
  });

  it('[T0-10] frames are closed even when inference throws, and only an error string is posted', async () => {
    const posted: FromWorker[] = [];
    const handler = createVisionHandler({
      createHand: async () => ({ detectForVideo: () => { throw new Error('boom'); } }),
      createFace: async () => { throw new Error('no face'); },
      post: (m) => posted.push(m),
    });
    await handler({ type: 'init', baseUrl: '/mediapipe', hands: true, face: false });
    const f = new FakeBitmap();
    await handler({ type: 'frame', id: 1, t: 5, frame: f as unknown as ImageBitmap });
    expect(f.closed).toBe(true);
    expect(posted.at(-1)).toEqual({ type: 'error', message: 'boom' });
  });

  it('[T0-10] the guard refuses to post binary / image data', () => {
    const post = vi.fn();
    expect(isLandmarkOnly({ a: [1, 2, { b: 'x' }] })).toBe(true);
    expect(isLandmarkOnly({ frame: new FakeBitmap() })).toBe(false);
    expect(isLandmarkOnly({ buf: new ArrayBuffer(4) })).toBe(false);
    expect(isLandmarkOnly({ arr: new Uint8ClampedArray(4) })).toBe(false);
    expect(isLandmarkOnly({ blob: new Blob(['x']) })).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('[T0-10] handedness is converted to the user\'s point of view for un-mirrored webcam frames', () => {
    const m = toLandmarkMessage(1, 2, 3, { landmarks: [hand(0.2)], handedness: [[{ categoryName: 'Left' }]] }, null, false);
    expect(m.hands[0].handedness).toBe('Right');
    const mirrored = toLandmarkMessage(1, 2, 3, { landmarks: [hand(0.2)], handedness: [[{ categoryName: 'Left' }]] }, null, true);
    expect(mirrored.hands[0].handedness).toBe('Left');
  });
});
