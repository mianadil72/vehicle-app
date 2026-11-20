import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import type { Vehicle } from '../types';
import { getSlides, hasRealPhotos, isPressPhoto } from '../slides';
import { VehiclePhoto } from './VehiclePhoto';

const SWIPE_MIN_PX = 40;

/** Render with `key={vehicle.id}` so the selected photo resets when switching vehicles. */
export function PhotoGallery({ vehicle }: { vehicle: Vehicle }) {
  const slides = getSlides(vehicle);
  const [index, setIndex] = useState(0);

  const go = (delta: number) => setIndex((i) => (i + delta + slides.length) % slides.length);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };

  // Swipe left/right on touch screens. `touch-action: pan-y` (CSS) leaves vertical scrolling to the
  // browser, which cancels the pointer when the user scrolls, so only horizontal swipes reach pointerup.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || slides.length < 2) return;
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.abs(dx) >= SWIPE_MIN_PX && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
  };

  const current = slides[index] ?? slides[0];

  return (
    <div className="gallery">
      <div
        className="gallery-main"
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={() => (swipe.current = null)}
        aria-roledescription="carousel"
        aria-label="Vehicle photos (use arrow keys or swipe to browse)"
      >
        <VehiclePhoto vehicle={vehicle} slide={current} className="gallery-image" />
        {slides.length > 1 && (
          <>
            <button className="gallery-nav prev" onClick={() => go(-1)} aria-label="Previous photo">‹</button>
            <button className="gallery-nav next" onClick={() => go(1)} aria-label="Next photo">›</button>
          </>
        )}
        <span className="gallery-counter">
          {index + 1} / {slides.length} · {current.label}
        </span>
        {!hasRealPhotos(vehicle) && <span className="gallery-note">Sample image – photos coming soon</span>}
        {current.kind === 'photo' && isPressPhoto(current.src) && (
          <span className="gallery-note">Manufacturer photo – color and trim may differ</span>
        )}
      </div>

      {slides.length > 1 && (
        <div className="gallery-thumbs">
          {slides.map((s, i) => (
            <button
              key={i}
              className={i === index ? 'thumb active' : 'thumb'}
              onClick={() => setIndex(i)}
              aria-label={`Show ${s.label}`}
              aria-current={i === index}
            >
              <VehiclePhoto vehicle={vehicle} slide={s} className="thumb-image" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
