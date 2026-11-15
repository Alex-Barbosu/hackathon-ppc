import type { Category, UploadCategory } from "./domain";

export type Page = "/" | "/library" | "/operations" | "/lab" | "/insights" | "/inspection";
export type UserRole = "field" | "dispatch" | "connections" | "admin" | "meter-device";

export interface Access {
  pages: readonly Page[];
  upload: readonly UploadCategory[];
  library: readonly Category[];
  chaos: boolean;
  lab: boolean;
  analyst: boolean;
}

// Each role sees the work the brief gives it: field teams fly drones, dispatch handles substation
// outages, connections handles customer documents (personal data), admin runs the platform.
// The API is the real gate (chaos, policy and Storage Lab runs are admin only server side);
// this table keeps people from seeing screens and categories that are not theirs.
const ACCESS: Record<UserRole, Access> = {
  admin: { pages: ["/", "/library", "/operations", "/lab", "/insights", "/inspection"], upload: ["outage", "document", "video"], library: ["outage", "document", "video", "meter"], chaos: true, lab: true, analyst: true },
  dispatch: { pages: ["/", "/library", "/operations", "/insights"], upload: ["outage"], library: ["outage"], chaos: false, lab: false, analyst: true },
  field: { pages: ["/", "/library", "/inspection"], upload: ["video"], library: ["video"], chaos: false, lab: false, analyst: false },
  connections: { pages: ["/", "/library"], upload: ["document"], library: ["document"], chaos: false, lab: false, analyst: false },
  "meter-device": { pages: [], upload: [], library: [], chaos: false, lab: false, analyst: false },
};

export const NONE: Access = ACCESS["meter-device"];
export const accessFor = (role: string | undefined): Access => (role && role in ACCESS ? ACCESS[role as UserRole] : NONE);
