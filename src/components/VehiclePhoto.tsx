import { useState } from 'react';
import type { Vehicle } from '../types';
import { getSlides, PLACEHOLDER_SLIDES, type Slide } from '../slides';
import { VehicleIllustration } from './VehicleIllustration';

interface Props {
  vehicle: Vehicle;
  slide?: Slide;
  className?: string;
}

/** Renders one slide of a vehicle; defaults to the cover (first) slide. */
export function VehiclePhoto({ vehicle, slide = getSlides(vehicle)[0], className }: Props) {
  // A photo that fails to load (e.g. press photos not downloaded yet) falls back to the placeholder.
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const alt = `${vehicle.year} ${vehicle.name} ${vehicle.model} – ${slide.label}`;
  if (slide.kind === 'photo' && failedSrc !== slide.src) {
    return <img src={slide.src} alt={alt} className={className} loading="lazy" onError={() => setFailedSrc(slide.src)} />;
  }
  const placeholder = slide.kind === 'placeholder' ? slide : PLACEHOLDER_SLIDES[0];
  return (
    <VehicleIllustration
      category={vehicle.category}
      colorHex={vehicle.colorHex}
      backdrop={placeholder.backdrop}
      mirrored={placeholder.mirrored}
      className={className}
      title={alt}
    />
  );
}
