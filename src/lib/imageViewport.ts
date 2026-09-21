// Fit and bounded-pan geometry adapted from Anton P's Brows3 PR #36:
// https://github.com/rgcsekaraa/brows3/pull/36
export type ImageSize = { width: number; height: number };
export type ImageTransform = { zoom: number; x: number; y: number };
export const MAX_IMAGE_ZOOM = 8;
export const IMAGE_ZOOM_STEP = 1.4;

export function fitImage(image: ImageSize, viewport: ImageSize): number {
  if (image.width <= 0 || image.height <= 0 || viewport.width <= 0 || viewport.height <= 0) return 1;
  return Math.min(1, viewport.width / image.width, viewport.height / image.height);
}

export function clampImagePan(transform: ImageTransform, image: ImageSize, viewport: ImageSize): ImageTransform {
  const maxX = Math.max(0, (image.width * transform.zoom - viewport.width) / 2);
  const maxY = Math.max(0, (image.height * transform.zoom - viewport.height) / 2);
  return { ...transform, x: Math.max(-maxX, Math.min(maxX, transform.x)), y: Math.max(-maxY, Math.min(maxY, transform.y)) };
}

export function minimumImageZoom(image: ImageSize, viewport: ImageSize): number {
  return Math.min(.01, fitImage(image, viewport) / 4);
}

export function zoomImage(previous: ImageTransform, target: number, image: ImageSize, viewport: ImageSize, anchor = { x: 0, y: 0 }): ImageTransform {
  const zoom = Math.min(MAX_IMAGE_ZOOM, Math.max(minimumImageZoom(image, viewport), target));
  const ratio = zoom / previous.zoom;
  return clampImagePan({ zoom, x: anchor.x - ratio * (anchor.x - previous.x), y: anchor.y - ratio * (anchor.y - previous.y) }, image, viewport);
}
