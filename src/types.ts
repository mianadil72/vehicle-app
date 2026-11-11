export const CATEGORIES = ['Sedan', 'SUV', 'Truck', 'Coupe', 'Electric', 'Van'] as const;

export type Category = (typeof CATEGORIES)[number];

export const CONDITIONS = ['New', 'Used', 'Certified'] as const;

export type Condition = (typeof CONDITIONS)[number];

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

/** `admin` can add, edit and delete vehicles; `staff` can only view them. */
export const ROLES = ['admin', 'staff'] as const;

export type Role = (typeof ROLES)[number];

/** The signed-in user, as returned by `/api/auth/me` and `/api/auth/login`. */
export interface User {
  id: string;
  username: string;
  role: Role;
}

/** An account as listed for admins on the password page. */
export interface UserSummary extends User {
  isActive: boolean;
  lastLoginAt: string | null;
}

/** A comment/review on a vehicle. Written by admins, visible to everyone. */
export interface VehicleComment {
  id: string;
  vehicleId: string;
  body: string;
  author: string;
  /** ISO 8601, UTC. */
  createdAt: string;
}

export const COMMENT_MAX_LENGTH = 2000;

/** A "forgot password" request waiting for an admin. */
export interface ResetRequest {
  userId: string;
  username: string;
  role: Role;
  /** ISO 8601, UTC. */
  requestedAt: string;
}
