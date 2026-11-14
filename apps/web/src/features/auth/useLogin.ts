import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { api } from "../../api/client";
import { useSession, type Session } from "../../state/session";

interface Credentials {
  username: string;
  password: string;
}

export class LoginError extends Error {}

export function useLogin() {
  const signIn = useSession((s) => s.signIn);
  const navigate = useNavigate();
  return useMutation<Session, LoginError, Credentials>({
    mutationFn: async (body) => {
      const { data, response } = await api.POST("/api/v1/auth/login", { body });
      if (data) return data;
      throw new LoginError(
        response.status === 401
          ? "That username and password do not match."
          : "FileGrid could not be reached. Nothing was changed; try again in a moment.",
      );
    },
    onSuccess: (session) => {
      signIn(session);
      void navigate({ to: "/" });
    },
  });
}
