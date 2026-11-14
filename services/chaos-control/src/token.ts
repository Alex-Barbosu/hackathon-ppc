// `make b-token`: prints an admin JWT for scripts and curl, signed with this container's
// JWT_SECRET exactly like POST /api/v1/auth/login would. The secret never leaves the container.
import { mintJwt } from "./auth.js";

const secret = process.env.JWT_SECRET ?? "";
if (secret.length < 32) {
  console.error("JWT_SECRET is not set in this container");
  process.exit(1);
}
const hours = Number(process.argv[2] ?? 8);
process.stdout.write(`${mintJwt(secret, "chaos-cli", "admin", Math.round(hours * 3600))}\n`);
