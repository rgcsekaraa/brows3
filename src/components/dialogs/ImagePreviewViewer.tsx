'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, CircularProgress, Dialog, IconButton, Tooltip, Typography, Divider } from '@mui/material';
import { Close, FitScreen, ZoomIn, ZoomOut, BrokenImageOutlined, ChevronLeft, ChevronRight } from '@mui/icons-material';
import { clampImagePan, fitImage, minimumImageZoom, IMAGE_ZOOM_STEP, MAX_IMAGE_ZOOM, zoomImage, type ImageSize, type ImageTransform } from '@/lib/imageViewport';

// Chrome and pointer-anchored interaction adapted from sitesee-fm's ImageViewer.
// Geometry retains the natural-image fit/pan approach contributed in PR #36.
interface Props {
  open: boolean;
  name: string;
  url: string | null;
  error: string | null;
  attempt: number;
  onClose: () => void;
  onRetry: () => void;
  index?: number;
  total?: number;
  onPrevious?: () => void;
  onNext?: () => void;
}

const chromeButton = {
  width: 32, height: 32, borderRadius: '50%', color: 'text.secondary',
  '@media (pointer: coarse)': { width: 44, height: 44 },
  '&:hover': { bgcolor: 'action.hover', color: 'text.primary' },
  '&.Mui-disabled': { color: 'action.disabled' },
  '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
};

export default function ImagePreviewViewer(props: Props) {
  const titleId = useId();
  useLayoutEffect(() => {
    if (!props.open) return;
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      // Restore on close as well as unmount: metadata can keep the image
      // viewer mounted after its object key has been cleared.
      queueMicrotask(() => { if (opener?.isConnected) opener.focus({ preventScroll: true }); });
    };
  }, [props.open]);
  return (
    <Dialog open={props.open} onClose={props.onClose} fullScreen disableRestoreFocus aria-labelledby={titleId}
      PaperProps={{ sx: { bgcolor: 'background.default', color: 'text.primary', backgroundImage: 'none' } }}>
      <ImagePreviewCanvas key={JSON.stringify([props.name, props.url, props.attempt, props.open])} {...props} titleId={titleId} />
    </Dialog>
  );
}

function ImagePreviewCanvas({ open, name, url, error, onClose, onRetry, titleId, index = 0, total = 0, onPrevious, onNext }: Props & { titleId: string }) {
  const helpId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    // Let the dialog capture the opener before focusing a replacement image.
    const root = rootRef.current;
    queueMicrotask(() => { if (root?.isConnected) root.focus({ preventScroll: true }); });
  }, [open]);
  const stageRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const naturalRef = useRef<ImageSize | null>(null);
  const viewportRef = useRef<ImageSize>({ width: 0, height: 0 });
  const transformRef = useRef<ImageTransform>({ zoom: 1, x: 0, y: 0 });
  const fittedRef = useRef(true);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const [zoom, setZoom] = useState(1);
  const [minimum, setMinimum] = useState(.01);
  const [isFitted, setIsFitted] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  const apply = useCallback((next: ImageTransform) => {
    transformRef.current = next;
    if (imgRef.current) {
      imgRef.current.style.transform = `translate3d(${next.x}px, ${next.y}px, 0) scale(${next.zoom})`;
      const natural = naturalRef.current;
      const canPan = natural && (natural.width * next.zoom > viewportRef.current.width + 1 || natural.height * next.zoom > viewportRef.current.height + 1);
      imgRef.current.style.cursor = canPan ? (pointers.current.size ? 'grabbing' : 'grab') : 'zoom-in';
    }
    // Discrete controls must not depend on requestAnimationFrame: WKWebView can
    // defer frames while the window is inactive, leaving the toolbar stale.
    // Pan updates keep the same zoom, so React bails out of these state updates.
    setZoom(next.zoom);
    setIsFitted(fittedRef.current);
  }, []);

  const fit = useCallback(() => {
    const natural = naturalRef.current;
    if (!natural) return;
    fittedRef.current = true;
    apply({ zoom: fitImage(natural, viewportRef.current), x: 0, y: 0 });
  }, [apply]);

  const zoomTo = useCallback((target: number, clientX?: number, clientY?: number) => {
    const natural = naturalRef.current;
    const stage = stageRef.current;
    if (!natural || !stage) return;
    const rect = stage.getBoundingClientRect();
    const anchor = { x: clientX == null ? 0 : clientX - rect.left - rect.width / 2, y: clientY == null ? 0 : clientY - rect.top - rect.height / 2 };
    const next = zoomImage(transformRef.current, target, natural, viewportRef.current, anchor);
    fittedRef.current = false;
    apply(next);
  }, [apply]);

  const actualSize = () => {
    fittedRef.current = false;
    apply({ zoom: 1, x: 0, y: 0 });
  };

  const measure = useCallback(() => {
    const stage = stageRef.current;
    const natural = naturalRef.current;
    if (!stage) return;
    viewportRef.current = { width: stage.clientWidth, height: stage.clientHeight };
    pointers.current.clear();
    if (!natural) return;
    const minimum = minimumImageZoom(natural, viewportRef.current);
    setMinimum(minimum);
    if (fittedRef.current) fit();
    else apply(clampImagePan({ ...transformRef.current, zoom: Math.max(minimum, transformRef.current.zoom) }, natural, viewportRef.current));
  }, [apply, fit]);

  useEffect(() => {
    if (!open) return;
    const stage = stageRef.current;
    if (!stage) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    const wheel = (event: WheelEvent) => {
      if (!naturalRef.current) return;
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1);
      zoomTo(transformRef.current.zoom * Math.exp(-delta * .0018), event.clientX, event.clientY);
    };
    stage.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); stage.removeEventListener('wheel', wheel); };
  }, [open, loaded, measure, zoomTo]);

  useEffect(() => {
    if (!url || !open || loaded || imageError) return;
    const timeout = setTimeout(() => setImageError('The image took too long to load. Try again or download it.'), 30000);
    return () => clearTimeout(timeout);
  }, [url, open, loaded, imageError]);

  const endPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    apply(transformRef.current);
  };

  const failure = error || imageError;
  const ready = loaded && !failure;
  return (
    <Box ref={rootRef} tabIndex={-1} sx={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, outline: 'none' }}
      onKeyDown={event => {
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (total > 1 && !event.shiftKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
              event.preventDefault(); event.stopPropagation();
              if (event.key === 'ArrowLeft') onPrevious?.();
              else onNext?.();
              return;
            }
            if (!ready) return;
            const current = transformRef.current;
            if (event.key === '+' || event.key === '=') zoomTo(current.zoom * IMAGE_ZOOM_STEP);
            else if (event.key === '-' || event.key === '_') zoomTo(current.zoom / IMAGE_ZOOM_STEP);
            else if (event.key === '0') fit();
            else if (event.key === '1') actualSize();
            else if (event.key.startsWith('Arrow') && naturalRef.current) {
              const step = event.shiftKey ? 120 : 40;
              const x = current.x + (event.key === 'ArrowLeft' ? step : event.key === 'ArrowRight' ? -step : 0);
              const y = current.y + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0);
              apply(clampImagePan({ ...current, x, y }, naturalRef.current, viewportRef.current));
            } else return;
            event.preventDefault(); event.stopPropagation();
          }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, px: { xs: 1.5, sm: 2.5 }, py: 1, bgcolor: 'background.paper', borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography id={titleId} component="h2" title={name} noWrap sx={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: 600 }}>{name}</Typography>
        {total > 1 && <Typography aria-label="Image position" variant="caption" sx={{ color: 'text.secondary', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>{index + 1} / {total}</Typography>}
        <Tooltip title="Close viewer (Esc)"><IconButton aria-label="Close viewer" onClick={onClose} sx={chromeButton}><Close fontSize="small" /></IconButton></Tooltip>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, px: { xs: 1, sm: 2 }, py: 2, pb: '72px', display: 'flex' }}>
        <Box ref={stageRef} role="region" aria-label="Image viewport" aria-describedby={helpId} tabIndex={0} autoFocus

          onPointerDown={event => {
            if (!ready || event.button !== 0) return;
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            apply(transformRef.current);
          }}
          onPointerMove={event => {
            const previous = pointers.current.get(event.pointerId);
            if (!previous || !naturalRef.current) return;
            const before = [...pointers.current.values()];
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            const after = [...pointers.current.values()];
            if (after.length === 2) {
              const distance = (points: typeof after) => Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
              const midpoint = (points: typeof after) => ({ x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2 });
              const a = midpoint(before), b = midpoint(after);
              zoomTo(transformRef.current.zoom * distance(after) / Math.max(1, distance(before)), a.x, a.y);
              apply(clampImagePan({ ...transformRef.current, x: transformRef.current.x + b.x - a.x, y: transformRef.current.y + b.y - a.y }, naturalRef.current, viewportRef.current));
            } else if (after.length === 1) {
              apply(clampImagePan({ ...transformRef.current, x: transformRef.current.x + event.clientX - previous.x, y: transformRef.current.y + event.clientY - previous.y }, naturalRef.current, viewportRef.current));
            }
          }}
          onPointerUp={endPointer} onPointerCancel={endPointer} onLostPointerCapture={endPointer}
          onDoubleClick={event => {
            if (!ready) return;
            if (fittedRef.current) zoomTo(Math.max(1, fitImage(naturalRef.current!, viewportRef.current) * 2.5), event.clientX, event.clientY);
            else fit();
          }}
          sx={{ flex: 1, minWidth: 0, minHeight: 0, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', touchAction: 'none', '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 } }}>
          {!ready && !failure && <CircularProgress aria-label="Loading image" size={28} sx={{ color: 'text.secondary', position: 'absolute' }} />}
          {failure && <Box role="alert" sx={{ maxWidth: 440, p: 3, textAlign: 'center' }}>
            <BrokenImageOutlined sx={{ color: 'text.secondary', fontSize: 40, mb: 1 }} />
            <Typography sx={{ mb: 2, overflowWrap: 'anywhere' }}>{failure}</Typography>
            <Button onClick={onRetry} variant="outlined" sx={{ minHeight: 44 }}>Try again</Button>
          </Box>}
          {url && !failure && (
            // eslint-disable-next-line @next/next/no-img-element -- Presigned object URLs are rendered directly in the desktop WebView.
            <img ref={imgRef} src={url} alt={name} draggable={false} decoding="async"
              onLoad={event => {
                const image = event.currentTarget;
                if (!image.naturalWidth || !image.naturalHeight) { setImageError('This image could not be decoded. Try again or download it.'); return; }
                naturalRef.current = { width: image.naturalWidth, height: image.naturalHeight };
                image.style.width = `${image.naturalWidth}px`;
                image.style.height = `${image.naturalHeight}px`;
                setLoaded(true); measure();
              }}
              onError={() => setImageError('Could not load this image. Try again to refresh its link, or download it.')}
              style={{ flexShrink: 0, maxWidth: 'none', maxHeight: 'none', visibility: loaded ? 'visible' : 'hidden', userSelect: 'none', transformOrigin: 'center', borderRadius: 2 }} />
          )}
        </Box>
      </Box>
      {total > 1 && <>
        <Tooltip title="Previous image (Left)"><span style={{ position: 'absolute', left: 20, top: '50%' }}><IconButton aria-label="Previous image" disabled={!onPrevious} onClick={onPrevious} sx={{ ...chromeButton, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}><ChevronLeft fontSize="small" /></IconButton></span></Tooltip>
        <Tooltip title="Next image (Right)"><span style={{ position: 'absolute', right: 20, top: '50%' }}><IconButton aria-label="Next image" disabled={!onNext} onClick={onNext} sx={{ ...chromeButton, bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider' }}><ChevronRight fontSize="small" /></IconButton></span></Tooltip>
      </>}
      <Typography id={helpId} sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }}>
        {total > 1 ? 'Left and Right switch images. Shift plus arrow keys pans the image.' : 'Arrow keys pan the image.'} Scroll or pinch to zoom. Drag to pan. Plus and minus zoom, 0 fits the image, 1 shows actual size. Escape closes.
      </Typography>
      {ready && <Box role="group" aria-label="Image zoom controls" sx={{ position: 'absolute', bottom: 'max(20px, env(safe-area-inset-bottom))', left: '50%', transform: 'translateX(-50%)', display: 'flex', alignItems: 'center', gap: .25, p: .5, borderRadius: '999px', bgcolor: 'background.paper', border: '1px solid', borderColor: 'divider', whiteSpace: 'nowrap', zIndex: 1 }}>
        <Tooltip title="Zoom out (-)"><span><IconButton aria-label="Zoom out" disabled={zoom <= minimum + 1e-8} onClick={() => zoomTo(transformRef.current.zoom / IMAGE_ZOOM_STEP)} sx={chromeButton}><ZoomOut fontSize="small" /></IconButton></span></Tooltip>
        <Typography component="output" aria-label="Zoom level" aria-live="polite" sx={{ minWidth: 46, textAlign: 'center', color: 'text.primary', fontWeight: 600, fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{zoom * 100 < 1 ? (zoom * 100).toFixed(1) : Math.round(zoom * 100)}%</Typography>
        <Tooltip title="Zoom in (+)"><span><IconButton aria-label="Zoom in" disabled={zoom >= MAX_IMAGE_ZOOM} onClick={() => zoomTo(transformRef.current.zoom * IMAGE_ZOOM_STEP)} sx={chromeButton}><ZoomIn fontSize="small" /></IconButton></span></Tooltip>
        <Divider orientation="vertical" flexItem sx={{ mx: .5, my: 1 }} />
        <Tooltip title="Fit to screen (0)"><Button aria-label="Fit to screen" aria-pressed={isFitted} onClick={fit} startIcon={<FitScreen fontSize="small" />} sx={{ minWidth: 56, height: 32, borderRadius: '999px', px: 1, '@media (pointer: coarse)': { height: 44 }, color: 'text.primary', bgcolor: isFitted ? 'action.selected' : 'transparent', '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>Fit</Button></Tooltip>
        <Tooltip title="Actual size, 100% (1)"><Button aria-label="Actual size" aria-pressed={!isFitted && Math.abs(zoom - 1) < 1e-8} onClick={actualSize} sx={{ minWidth: 36, height: 32, borderRadius: '999px', px: 1, '@media (pointer: coarse)': { minWidth: 44, height: 44 }, color: 'text.primary', bgcolor: !isFitted && Math.abs(zoom - 1) < 1e-8 ? 'action.selected' : 'transparent', '&.Mui-focusVisible': { outline: '2px solid', outlineColor: 'primary.main' } }}>1:1</Button></Tooltip>
      </Box>}
    </Box>
  );
}
