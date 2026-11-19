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

/**
 * `admin` can do everything; `manager` (lead sales manager) sees and assigns all leads; `sales` (sales rep)
 * works the leads assigned to them; `staff` can only view vehicles and the dashboard.
 * Only admins can add, edit or delete vehicles.
 */
export const ROLES = ['admin', 'manager', 'sales', 'staff'] as const;

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

/** Aggregates for one slice of the inventory (a category, or everything). */
export interface InventoryFigures {
  count: number;
  byCondition: Record<Condition, number>;
  /** Sum of asking prices, USD. */
  totalValue: number;
  /** Averages are null when the slice is empty. */
  avgPrice: number | null;
  avgMileage: number | null;
  avgYear: number | null;
}

/** `GET /api/stats/inventory`: totals plus one entry per category (every category, even empty ones). */
export interface InventoryStats {
  total: InventoryFigures;
  categories: ({ category: Category } & InventoryFigures)[];
  /** ISO 8601, UTC: when the figures were computed. */
  generatedAt: string;
}

/** A vehicle the chat assistant found, shown as a link under its reply. */
export interface ChatVehicle {
  id: string;
  name: string;
  model: string;
  year: number;
  price: number;
  category: Category;
  condition: Condition;
  mileage: number;
}

/** `POST /api/chat` response. */
export interface ChatReply {
  conversationId: string;
  reply: string;
  vehicles: ChatVehicle[];
}

// --- CRM: customer leads ------------------------------------------------------------------------

/** How the customer wants to be contacted. */
export const CONTACT_METHODS = ['Email', 'Text', 'Phone'] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

/** Lead lifecycle. Follow-ups are logged in order, each due 2 days after the previous step. */
export const LEAD_STATUSES = ['New', 'Assigned', 'FirstFollowUp', 'SecondFollowUp', 'ThirdFollowUp', 'Won', 'Lost'] as const;
export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  New: 'New',
  Assigned: 'Assigned',
  FirstFollowUp: '1st follow-up',
  SecondFollowUp: '2nd follow-up',
  ThirdFollowUp: '3rd follow-up',
  Won: 'Won',
  Lost: 'Lost',
};

export const CLOSED_LEAD_STATUSES: readonly LeadStatus[] = ['Won', 'Lost'];

/** Where the lead came from: the contact page, a vehicle's "I'm interested" form, or the chat assistant. */
export const LEAD_SOURCES = ['contact', 'vehicle', 'chat'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const FOLLOW_UP_INTERVAL_DAYS = 2;
export const MAX_FOLLOW_UPS = 3;
export const LEAD_MESSAGE_MAX_LENGTH = 1000;
export const LEAD_NOTE_MAX_LENGTH = 1000;
export const MAX_URGENCY_DAYS = 365;

/** The reference shown to customers and staff, e.g. lead 42 → "L-00042". */
export const leadReference = (id: string | number) => `L-${String(id).padStart(5, '0')}`;

/** A row in the leads list. */
export interface LeadSummary {
  id: string;
  customerName: string;
  preferredContact: ContactMethod;
  interestCondition: Condition;
  urgencyDays: number;
  source: LeadSource;
  status: LeadStatus;
  assignedTo: { id: string; username: string } | null;
  vehicle: { id: string; title: string } | null;
  followUps: number;
  /** ISO 8601, UTC. Null when not assigned yet, after the 3rd follow-up, or once closed. */
  nextFollowUpDue: string | null;
  createdAt: string;
}

export interface LeadFollowUp {
  number: number;
  method: ContactMethod;
  note: string;
  author: string;
  createdAt: string;
}

export interface LeadNotification {
  channel: 'email' | 'sms';
  recipient: string;
  status: 'Pending' | 'Sent' | 'Failed' | 'Logged';
  error: string | null;
  createdAt: string;
}

/** `GET /api/leads/:id`. */
export interface Lead extends Omit<LeadSummary, 'vehicle'> {
  customer: {
    firstName: string;
    lastName: string;
    email: string;
    mobile: string;
  };
  vehicle: { id: string; title: string; price: number; stockNumber: string } | null;
  message: string | null;
  assignedAt: string | null;
  closedAt: string | null;
  followUpList: LeadFollowUp[];
  notifications: LeadNotification[];
  /** The customer's other enquiries (same email). `customer` above holds this enquiry's details as submitted. */
  returning: {
    /** ISO 8601, UTC: the customer's first enquiry. */
    customerSince: string;
    /** Newest first, at most 20. */
    otherLeads: { id: string; status: LeadStatus; createdAt: string }[];
    /** The details from the customer's first enquiry, when any differ from this enquiry; otherwise null. */
    onFile: { firstName: string; lastName: string; mobile: string; preferredContact: ContactMethod } | null;
  };
}

/** `GET /api/leads/counts`: for the badge on "Leads" in the account bar. */
export interface LeadCounts {
  open: number;
  unassigned: number;
  overdue: number;
}

/** Someone a lead can be assigned to. */
export interface SalesRep {
  id: string;
  username: string;
  role: Role;
  openLeads: number;
}

/** A "forgot password" request waiting for an admin. */
export interface ResetRequest {
  userId: string;
  username: string;
  role: Role;
  /** ISO 8601, UTC. */
  requestedAt: string;
}
