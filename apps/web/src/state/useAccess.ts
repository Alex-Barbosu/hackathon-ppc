import { accessFor, type Access } from "../lib/permissions";
import { useSession } from "./session";

export function useAccess(): Access {
  return accessFor(useSession((s) => s.session?.role));
}
