import * as cheerio from "cheerio";

const hierarchyLevels = [
  "zone",
  "circle",
  "division",
  "subdivision",
  "substation",
  "feeder",
  "distribution_transformer"
];

function hierarchyLevel(code, position) {
  if (/^DT-/i.test(code)) return "distribution_transformer";
  if (/^SS-/i.test(code)) return "substation";
  if (/^SD-/i.test(code)) return "subdivision";
  if (/^F-/i.test(code)) return "feeder";
  if (/^D-/i.test(code)) return "division";
  if (/^C-/i.test(code)) return "circle";
  if (/^Z-/i.test(code)) return "zone";
  return hierarchyLevels[position] ?? "other";
}

const meterFields = {
  "Meter ID": "meter_id",
  "Serial No": "serial_number",
  Make: "make",
  "Phase Type": "phase_type",
  "Installation Status": "installation_status",
  "Installation Type": "installation_type"
};

export class InvalidPortalDataError extends Error {}

function text(value) {
  return String(value ?? "").trim();
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

export function normalizeMeterPage(html, meterId, geo) {
  const $ = cheerio.load(html);
  const fields = {};
  $("main dl div").each((_, row) => {
    const label = text($(row).find("dt").text());
    const value = text($(row).find("dd").text());
    const key = meterFields[label];
    if (key) fields[key] = value;
  });

  if (!fields.meter_id || fields.meter_id !== meterId) return null;

  const networkHierarchy = [];
  $("main nav span").each((_, element) => {
    const match = text($(element).text()).match(/^(.*?)\s+\(([^()]*)\)$/);
    if (!match) return;
    const index = networkHierarchy.length;
    networkHierarchy.push({
      level: hierarchyLevel(match[2], index),
      name: match[1],
      code: match[2]
    });
  });

  return {
    ...fields,
    distribution_transformer_code: networkHierarchy.find(
      (entry) => entry.level === "distribution_transformer"
    )?.code ?? null,
    network_hierarchy: networkHierarchy,
    location: {
      latitude: numberOrNull(geo?.data?.latitude),
      longitude: numberOrNull(geo?.data?.longitude)
    }
  };
}

export function normalizeMeterList(payload) {
  return {
    data: (payload.data ?? []).map((meter) => ({
      meter_id: meter.meterId,
      serial_number: meter.serialNo,
      make: meter.make,
      phase_type: meter.phaseType,
      installation_status: meter.installStatus,
      distribution_transformer_code: meter.dtCode
    })),
    total: payload.total,
    page: payload.page,
    page_size: payload.pageSize
  };
}

export function normalizeTransformers(payload) {
  return {
    data: (payload.data ?? []).map((transformer) => ({
      code: transformer.code,
      name: transformer.name,
      feeder_code: transformer.feederCode,
      capacity_kva: transformer.capacityKva
    })),
    total: payload.total,
    page: payload.page,
    page_size: payload.pageSize
  };
}

export function normalizeReadings(payload, meterId) {
  const readings = (payload.data ?? []).map((reading) => ({
    timestamp: reading.timestamp,
    kwh: numberOrNull(reading.kwh),
    kvah: numberOrNull(reading.kvah),
    voltage_r: numberOrNull(reading.voltR)
  }));

  if (readings.some((reading) =>
    reading.kwh === null || reading.kvah === null || reading.voltage_r === null
  )) {
    throw new InvalidPortalDataError(
      "The Urja portal returned a non-numeric consumption value"
    );
  }

  return {
    meter_id: meterId,
    interval_minutes: 30,
    count: readings.length,
    readings
  };
}
