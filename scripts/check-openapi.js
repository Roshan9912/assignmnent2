import { readFile } from "node:fs/promises";

const spec = JSON.parse(await readFile(new URL("../openapi.json", import.meta.url), "utf8"));
const required = [
  "/api/v1/meters",
  "/api/v1/meters/{meterId}",
  "/api/v1/meters/{meterId}/hierarchy",
  "/api/v1/meters/{meterId}/consumption",
  "/api/v1/transformers"
];
const missing = required.filter((path) => !spec.paths[path]);
if (spec.openapi !== "3.1.0" || missing.length > 0) {
  throw new Error(`OpenAPI specification is invalid. Missing paths: ${missing.join(", ")}`);
}
const unprotected = required
  .filter((path) =>
    !spec.paths[path].get.security?.some((scheme) => scheme.BearerAuth) ||
    !spec.paths[path].get.responses["401"]
  );
if (unprotected.length > 0) {
  throw new Error(`Protected routes missing bearer auth documentation: ${unprotected.join(", ")}`);
}
console.log("OpenAPI specification contains all documented API paths.");
