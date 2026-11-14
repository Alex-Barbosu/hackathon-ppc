import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";
import { Shell } from "./layout/Shell";
import { LibraryPage } from "./features/library/LibraryPage";
import { UploadPage } from "./features/upload/UploadPage";
import { Placeholder } from "./routes/Placeholder";

const root = createRootRoute({ component: Shell });
const upload = createRoute({ getParentRoute: () => root, path: "/", component: UploadPage });
const library = createRoute({ getParentRoute: () => root, path: "/library", component: LibraryPage });
const operations = createRoute({
  getParentRoute: () => root,
  path: "/operations",
  component: () => <Placeholder title="Operations" line="Live latency, throughput and storage health per category will appear here." />,
});
const chaos = createRoute({
  getParentRoute: () => root,
  path: "/chaos",
  component: () => <Placeholder title="Chaos" line="Controls to kill a storage, degrade the network and fire a storm will appear here." />,
});

export const router = createRouter({ routeTree: root.addChildren([upload, library, operations, chaos]) });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
