import { useState, type KeyboardEvent } from 'react';
import type { Vehicle } from '../types';
import { getSlides, hasRealPhotos } from '../slides';
import { VehiclePhoto } from './VehiclePhoto';

/** Render with `key={vehicle.id}` so the selected photo resets when switching vehicles. */
export function PhotoGallery({ vehicle }: { vehicle: Vehicle }) {
  const slides = getSlides(vehicle);
  const [index, setIndex] = useState(0);

  const go = (delta: number) => setIndex((i) => (i + delta + slides.length) % slides.length);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };

  const current = slides[index] ?? slides[0];

  return (
    <div className="gallery">
      <div
        className="gallery-main"
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-roledescription="carousel"
        aria-label="Vehicle photos (use arrow keys to browse)"
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
