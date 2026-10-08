import express from "express";
import {
  InvalidPortalDataError,
  normalizeMeterList,
  normalizeMeterPage,
  normalizeReadings,
  normalizeTransformers
} from "./normalize.js";
import { PortalError } from "./portal-client.js";

const identifierPattern = /^[A-Za-z0-9_-]{1,64}$/;

function validateIdentifier(value) {
  return typeof value === "string" && identifierPattern.test(value);
}

function positiveInteger(value, fallback, maximum = 1000000) {
  if (value === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(String(value))) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed <= maximum ? parsed : null;
}

async function meterExists(client, meterId) {
  const query = new URLSearchParams({ q: meterId, page: "1" });
  const payload = await client.getJson(`/portal/meters/search?${query}`);
  return (payload.data ?? []).some((meter) => meter.meterId === meterId);
}

export function createApp(client) {
  const app = express();
  app.disable("x-powered-by");

  app.get("/healthz", (_request, response) => {
    response.json({ status: "ok" });
  });

  app.get("/api/v1/meters", async (request, response, next) => {
    const page = positiveInteger(request.query.page, 1);
    const query = typeof request.query.q === "string" ? request.query.q.trim() : "";
    if (
      page === null ||
      query.length > 100 ||
      (request.query.q !== undefined && typeof request.query.q !== "string")
    ) {
      response.status(400).json({
        error: { code: "invalid_query", message: "Use page >= 1 and a search query of at most 100 characters." }
      });
      return;
    }

    try {
      const search = new URLSearchParams({ q: query, page: String(page) });
      const payload = await client.getJson(`/portal/meters/search?${search}`);
      response.json(normalizeMeterList(payload));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/meters/:meterId", async (request, response, next) => {
    const { meterId } = request.params;
    if (!validateIdentifier(meterId)) {
      response.status(400).json({
        error: { code: "invalid_meter_id", message: "Meter ID contains unsupported characters." }
      });
      return;
    }

    try {
      if (!await meterExists(client, meterId)) {
        response.status(404).json({
          error: { code: "meter_not_found", message: `Meter '${meterId}' was not found.` }
        });
        return;
      }
      const pathId = encodeURIComponent(meterId);
      const [html, geo] = await Promise.all([
        client.getHtml(`/meters/${pathId}`),
        client.getJson(`/portal/meters/${pathId}/geo`)
      ]);
      const meter = normalizeMeterPage(html, meterId, geo);
      if (!meter) {
        response.status(404).json({
          error: { code: "meter_not_found", message: `Meter '${meterId}' was not found.` }
        });
        return;
      }
      response.json(meter);
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/meters/:meterId/hierarchy", async (request, response, next) => {
    const { meterId } = request.params;
    if (!validateIdentifier(meterId)) {
      response.status(400).json({
        error: { code: "invalid_meter_id", message: "Meter ID contains unsupported characters." }
      });
      return;
    }

    try {
      if (!await meterExists(client, meterId)) {
        response.status(404).json({
          error: { code: "meter_not_found", message: `Meter '${meterId}' was not found.` }
        });
        return;
      }
      const html = await client.getHtml(`/meters/${encodeURIComponent(meterId)}`);
      const meter = normalizeMeterPage(html, meterId, null);
      if (!meter) {
        response.status(404).json({
          error: { code: "meter_not_found", message: `Meter '${meterId}' was not found.` }
        });
        return;
      }
      response.json({
        meter_id: meter.meter_id,
        distribution_transformer_code: meter.distribution_transformer_code,
        hierarchy: meter.network_hierarchy
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/meters/:meterId/consumption", async (request, response, next) => {
    const { meterId } = request.params;
    if (!validateIdentifier(meterId)) {
      response.status(400).json({
        error: { code: "invalid_meter_id", message: "Meter ID contains unsupported characters." }
      });
      return;
    }

    try {
      if (!await meterExists(client, meterId)) {
        response.status(404).json({
          error: { code: "meter_not_found", message: `Meter '${meterId}' was not found.` }
        });
        return;
      }
      const payload = await client.getJson(
        `/portal/meters/${encodeURIComponent(meterId)}/energy`
      );
      response.json(normalizeReadings(payload, meterId));
    } catch (error) {
      next(error);
    }
  });

  app.get("/api/v1/transformers", async (request, response, next) => {
    const page = positiveInteger(request.query.page, 1);
    if (page === null) {
      response.status(400).json({
        error: { code: "invalid_query", message: "Use a positive integer page number." }
      });
      return;
    }

    try {
      const payload = await client.getJson(`/portal/dts?page=${page}`);
      response.json(normalizeTransformers(payload));
    } catch (error) {
      next(error);
    }
  });

  app.use((_request, response) => {
    response.status(404).json({
      error: { code: "not_found", message: "API route not found." }
    });
  });

  app.use((error, _request, response, _next) => {
    if (error instanceof PortalError) {
      response.status(error.status).json({
        error: { code: error.code, message: error.message }
      });
      return;
    }
    if (error instanceof URIError) {
      response.status(400).json({
        error: { code: "invalid_path", message: "The requested path contains invalid encoding." }
      });
      return;
    }
    if (error instanceof InvalidPortalDataError) {
      response.status(502).json({
        error: { code: "upstream_invalid_data", message: error.message }
      });
      return;
    }
    console.error("Unhandled API error:", error);
    response.status(500).json({
      error: { code: "internal_error", message: "The request could not be completed." }
    });
  });

  return app;
}
