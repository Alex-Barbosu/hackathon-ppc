import { create } from "zustand";

interface SessionState {
  token: string;
  setToken: (token: string) => void;
}

// Login screen is a later backlog item; until then the mock accepts any bearer value.
export const useSession = create<SessionState>((set) => ({
  token: "demo-token",
  setToken: (token) => set({ token }),
}));
