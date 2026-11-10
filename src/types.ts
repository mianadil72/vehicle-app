export const CATEGORIES = ['Sedan', 'SUV', 'Truck', 'Coupe', 'Electric', 'Van'] as const;

export type Category = (typeof CATEGORIES)[number];

export type Condition = 'New' | 'Used' | 'Certified';

export interface Vehicle {
  id: string;
  name: string; // make / brand
  model: string;
  year: number;
  price: number;
  category: Category;
  condition: Condition;
  mileage: number;
  color: string;
  colorHex: string; // paint color, used to tint placeholder images
  stockNumber: string;
  /**
   * Photo URLs, first one is the cover image. Put files in `public/vehicles/<id>/`
   * and reference them as `/vehicles/<id>/front.jpg`. When empty or omitted, the UI
   * shows generated placeholder images instead.
   */
  photos?: string[];
}
