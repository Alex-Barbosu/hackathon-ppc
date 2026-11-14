import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { LoginPage } from "./features/auth/LoginPage";
import { LibraryPage } from "./features/library/LibraryPage";
import { UploadPage } from "./features/upload/UploadPage";
import { Shell } from "./layout/Shell";
import { OperationsPage } from "./features/operations/OperationsPage";
import { useSession } from "./state/session";

const root = createRootRoute({ component: Outlet });
const login = createRoute({ getParentRoute: () => root, path: "/login", component: LoginPage });

// Every screen except /login sits behind this guard; the API still enforces access itself.
const app = createRoute({
  getParentRoute: () => root,
  id: "app",
  component: Shell,
  beforeLoad: () => {
    if (!useSession.getState().session) throw redirect({ to: "/login" });
  },
});
const upload = createRoute({ getParentRoute: () => app, path: "/", component: UploadPage });
const library = createRoute({ getParentRoute: () => app, path: "/library", component: LibraryPage });
const operations = createRoute({ getParentRoute: () => app, path: "/operations", component: OperationsPage });
// The chaos controls live in the Operations dock so the effect is visible next to the cause.
const chaos = createRoute({
  getParentRoute: () => app,
  path: "/chaos",
  beforeLoad: () => {
    throw redirect({ to: "/operations" });
  },
});

export const router = createRouter({
  routeTree: root.addChildren([login, app.addChildren([upload, library, operations, chaos])]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
