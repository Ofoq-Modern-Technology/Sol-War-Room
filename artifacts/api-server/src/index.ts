import app from "./app";
import { initDb } from "@workspace/db";
import { resetStaleSniperStatuses } from "./lib/sniper-engine.js";
import { resetStaleArbStatuses } from "./lib/arb-engine.js";
import { startDsRadarFeed } from "./lib/token-radar.js";
import { startTaskRunner } from "./lib/task-runner.js";
import { checkLicenseOnStartup } from "./lib/licenseCheck.js";

const rawPort = process.env["PORT"] ?? "8080";
const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Initialise the sql.js database (async WASM compilation) before accepting requests
initDb().then(() => {
  app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
    void resetStaleSniperStatuses();
    void resetStaleArbStatuses();
    startDsRadarFeed();
    startTaskRunner();
    void checkLicenseOnStartup();
  });
}).catch((err) => {
  console.error("[fatal] Failed to initialise database:", err);
  process.exit(1);
});
