import type { Vehicle } from '../types';
import { getSlides, type Slide } from '../slides';
import { VehicleIllustration } from './VehicleIllustration';

interface Props {
  vehicle: Vehicle;
  slide?: Slide;
  className?: string;
}

/** Renders one slide of a vehicle; defaults to the cover (first) slide. */
export function VehiclePhoto({ vehicle, slide = getSlides(vehicle)[0], className }: Props) {
  const alt = `${vehicle.year} ${vehicle.name} ${vehicle.model} – ${slide.label}`;
  if (slide.kind === 'photo') {
    return <img src={slide.src} alt={alt} className={className} loading="lazy" />;
  }
  return (
    <VehicleIllustration
      category={vehicle.category}
      colorHex={vehicle.colorHex}
      backdrop={slide.backdrop}
      mirrored={slide.mirrored}
      className={className}
      title={alt}
    />
  );
}
