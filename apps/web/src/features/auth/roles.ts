// The API signs in four demo accounts named after their roles. The password is shared (DEMO_PASSWORD in .env).
export const ROLES = [
  { id: "dispatch", label: "Dispatch", hint: "Outage records" },
  { id: "field", label: "Field", hint: "Drone video" },
  { id: "connections", label: "Connections", hint: "Customer documents" },
  { id: "admin", label: "Admin", hint: "Everything, plus chaos" },
] as const;
