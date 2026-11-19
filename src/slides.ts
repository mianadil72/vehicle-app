import type { Vehicle } from './types';
import type { Backdrop } from './components/VehicleIllustration';

/** A single gallery slide: either a real photo URL or a generated placeholder. */
export type PlaceholderSlide = { kind: 'placeholder'; backdrop: Backdrop; mirrored: boolean; label: string };
export type Slide = { kind: 'photo'; src: string; label: string } | PlaceholderSlide;

export const PLACEHOLDER_SLIDES: PlaceholderSlide[] = [
  { kind: 'placeholder', backdrop: 'studio', mirrored: false, label: 'Passenger side' },
  { kind: 'placeholder', backdrop: 'showroom', mirrored: true, label: 'Driver side' },
  { kind: 'placeholder', backdrop: 'outdoor', mirrored: false, label: 'Outdoor' },
  { kind: 'placeholder', backdrop: 'dusk', mirrored: true, label: 'Evening' },
];

/** Manufacturer press photos (`npm run db:photos`) show the model, not this exact vehicle. */
export const isPressPhoto = (src: string) => src.startsWith('/vehicles/models/');

export function getSlides(vehicle: Vehicle): Slide[] {
  if (vehicle.photos && vehicle.photos.length > 0) {
    return vehicle.photos.map((src, i) => ({
      kind: 'photo',
      src,
      label: isPressPhoto(src) ? 'Manufacturer photo' : `Photo ${i + 1}`,
    }));
  }
  return PLACEHOLDER_SLIDES;
}

export const hasRealPhotos = (vehicle: Vehicle) => (vehicle.photos?.length ?? 0) > 0;
