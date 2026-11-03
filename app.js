require("dotenv").config();

const sessionSecret = process.env.SESSION_SECRET;
const placeholderSecrets = new Set([
  "change-me-in-production",
  "change-me-to-a-random-string",
  "replace-with-at-least-32-random-characters",
]);

if (
  !sessionSecret ||
  Buffer.byteLength(sessionSecret) < 32 ||
  placeholderSecrets.has(sessionSecret)
) {
  console.error("FATAL: SESSION_SECRET must be set in .env (min 32 chars)");
  process.exit(1);
}

const express = require("express");
const app = express();
const settings = require("./controllers/settings.js");

require("./controllers/config.js")(app, express);
app.use(require("./controllers/routes.js"));

app.listen(settings.PORT, function () {
  console.info(`Listening on port ${settings.PORT} in ${app.get("env")} mode.`);
});
