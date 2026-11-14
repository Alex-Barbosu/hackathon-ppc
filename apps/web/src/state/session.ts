import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { components } from "../api/schema";

export type Session = components["schemas"]["Session"];

interface SessionState {
  session: Session | null;
  signIn: (session: Session) => void;
  signOut: () => void;
}

// sessionStorage, not localStorage: the token dies with the tab, which suits shared
// control-room machines. Expiry is not checked here; a 401 from the API signs the user out,
// so the server stays the single judge of whether a token is still good.
export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      session: null,
      signIn: (session) => set({ session }),
      signOut: () => set({ session: null }),
    }),
    { name: "filegrid.session", storage: createJSONStorage(() => sessionStorage) },
  ),
);

export const getToken = (): string | null => useSession.getState().session?.token ?? null;
