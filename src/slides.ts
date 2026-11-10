import type { Vehicle } from './types';
import type { Backdrop } from './components/VehicleIllustration';

/** A single gallery slide: either a real photo URL or a generated placeholder. */
export type Slide =
  | { kind: 'photo'; src: string; label: string }
  | { kind: 'placeholder'; backdrop: Backdrop; mirrored: boolean; label: string };

const PLACEHOLDER_SLIDES: Slide[] = [
  { kind: 'placeholder', backdrop: 'studio', mirrored: false, label: 'Passenger side' },
  { kind: 'placeholder', backdrop: 'showroom', mirrored: true, label: 'Driver side' },
  { kind: 'placeholder', backdrop: 'outdoor', mirrored: false, label: 'Outdoor' },
  { kind: 'placeholder', backdrop: 'dusk', mirrored: true, label: 'Evening' },
];

export function getSlides(vehicle: Vehicle): Slide[] {
  if (vehicle.photos && vehicle.photos.length > 0) {
    return vehicle.photos.map((src, i) => ({ kind: 'photo', src, label: `Photo ${i + 1}` }));
  }
  return PLACEHOLDER_SLIDES;
}

export const hasRealPhotos = (vehicle: Vehicle) => (vehicle.photos?.length ?? 0) > 0;
