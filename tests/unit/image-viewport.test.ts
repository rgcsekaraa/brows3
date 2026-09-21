import { expect, test } from 'vitest';
import { clampImagePan, fitImage, zoomImage } from '@/lib/imageViewport';

const photo = { width: 6000, height: 4000 };
const viewport = { width: 600, height: 400 };

test('large photos fit below 25% and small photos are not upscaled', () => {
  expect(fitImage(photo, viewport)).toBe(.1);
  expect(fitImage({ width: 100, height: 100 }, viewport)).toBe(1);
});

test('zoom starts at the fit ratio without jumping to a fixed floor', () => {
  const result = zoomImage({ zoom: .1, x: 0, y: 0 }, .14, photo, viewport);
  expect(result.zoom).toBe(.14);
  expect(zoomImage(result, .01, photo, viewport)).toEqual({ zoom: .01, x: 0, y: 0 });
});

test('panning is bounded and fitted images cannot be dragged into empty space', () => {
  expect(clampImagePan({ zoom: .1, x: 100, y: -100 }, photo, viewport)).toEqual({ zoom: .1, x: 0, y: -0 });
  expect(clampImagePan({ zoom: 1, x: 9999, y: -9999 }, photo, viewport)).toEqual({ zoom: 1, x: 2700, y: -1800 });
});

test('zoom remains anchored to the pointer and capped at 800%', () => {
  expect(zoomImage({ zoom: 1, x: 0, y: 0 }, 2, photo, viewport, { x: 100, y: 50 })).toEqual({ zoom: 2, x: -100, y: -50 });
  expect(zoomImage({ zoom: 1, x: 0, y: 0 }, 100, photo, viewport).zoom).toBe(8);
});

test('resized viewports clamp pan independently along each axis', () => {
  expect(clampImagePan({ zoom: .1, x: 80, y: -80 }, photo, { width: 500, height: 500 })).toEqual({ zoom: .1, x: 50, y: -0 });
});
