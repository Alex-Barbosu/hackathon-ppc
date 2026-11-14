// chaos-control: the demo's chaos buttons (contracts/openapi.yaml /chaos/*), admin only.
// The only container with the Docker socket; it uses it for the three storage containers
// of its own Compose project and nothing else.
import { hostname } from "node:os";
import { buildApp } from "./app.js";
import { DockerClient } from "./docker.js";
import { SimulatorClient } from "./meters.js";
import { SeaweedFiler, Storages } from "./storages.js";
import { ToxiproxyClient } from "./toxiproxy.js";

const env = process.env;
const jwtSecret = env.JWT_SECRET ?? "";
// Same rule as filegrid-api: refuse to verify tokens with an empty or guessable key.
if (jwtSecret.length < 32) throw new Error("JWT_SECRET must be set to at least 32 characters");

const docker = new DockerClient(env.DOCKER_SOCKET ?? "/var/run/docker.sock", env.COMPOSE_PROJECT_NAME ?? "filegrid", hostname());
const { app } = buildApp({
  jwtSecret,
  storages: new Storages(docker, new SeaweedFiler(env.SEAWEED_FILER_URL ?? "http://seaweedfs:8888")),
  toxiproxy: new ToxiproxyClient(env.TOXIPROXY_URL ?? "http://toxiproxy:8474"),
  meters: new SimulatorClient(env.METER_SIMULATOR_URL ?? "http://meter-simulator:9100"),
  defaultReadingsPerSec: Number(env.METER_READINGS_PER_SEC ?? 1),
  apiUrl: env.FILEGRID_FILES_URL ?? "http://filegrid-api:8080/api/v1/files",
});

await app.listen({ host: "0.0.0.0", port: Number(env.PORT ?? 8090) });

const shutdown = async (): Promise<void> => {
  await app.close();
  process.exit(0);
};
process.on("SIGTERM", () => void shutdown());
process.on("SIGINT", () => void shutdown());
