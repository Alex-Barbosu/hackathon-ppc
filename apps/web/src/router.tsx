import { createRootRoute, createRoute, createRouter, Outlet, redirect } from "@tanstack/react-router";
import { LoginPage } from "./features/auth/LoginPage";
import { LibraryPage } from "./features/library/LibraryPage";
import { UploadPage } from "./features/upload/UploadPage";
import { Shell } from "./layout/Shell";
import { InsightsPage } from "./features/insights/InsightsPage";
import { LabPage } from "./features/lab/LabPage";
import { OperationsPage } from "./features/operations/OperationsPage";
import { accessFor, type Page } from "./lib/permissions";
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
// A typed URL to a screen the role does not have lands on Upload, which every role has.
const only = (page: Page) => () => {
  if (!accessFor(useSession.getState().session?.role).pages.includes(page)) throw redirect({ to: "/" });
};
const upload = createRoute({ getParentRoute: () => app, path: "/", component: UploadPage });
const library = createRoute({ getParentRoute: () => app, path: "/library", component: LibraryPage, beforeLoad: only("/library") });
const operations = createRoute({ getParentRoute: () => app, path: "/operations", component: OperationsPage, beforeLoad: only("/operations") });
const insights = createRoute({ getParentRoute: () => app, path: "/insights", component: InsightsPage, beforeLoad: only("/insights") });
const lab = createRoute({ getParentRoute: () => app, path: "/lab", component: LabPage, beforeLoad: only("/lab") });
// Old link: the chaos controls now open from the nav bar on any screen.
const chaos = createRoute({
  getParentRoute: () => app,
  path: "/chaos",
  beforeLoad: () => {
    throw redirect({ to: "/operations" });
  },
});

export const router = createRouter({
  routeTree: root.addChildren([login, app.addChildren([upload, library, operations, lab, insights, chaos])]),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
