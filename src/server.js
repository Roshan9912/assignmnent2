import "dotenv/config";
import { createApp } from "./app.js";
import { PortalClient } from "./portal-client.js";

const client = new PortalClient({
  baseUrl: process.env.PORTAL_BASE_URL || "https://urja-ops.flockenergy.tech",
  email: process.env.PORTAL_EMAIL,
  password: process.env.PORTAL_PASSWORD,
  timeoutMs: Number(process.env.PORTAL_TIMEOUT_MS || 10000)
});

const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}

const server = createApp(client).listen(port, () => {
  console.log(`Flock Urja API listening on http://localhost:${port}`);
});

function shutdown() {
  server.close((error) => {
    if (error) {
      console.error("Failed to stop the API server cleanly:", error);
      process.exitCode = 1;
    }
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
