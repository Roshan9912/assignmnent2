import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeMeterList,
  normalizeMeterPage,
  normalizeReadings,
  normalizeTransformers
} from "../src/normalize.js";

test("normalizes meter search field names", () => {
  assert.deepEqual(normalizeMeterList({
    data: [{
      meterId: "J100001",
      serialNo: "GE84132",
      make: "L&T",
      phaseType: "single",
      installStatus: "Installed",
      dtCode: "DT-002"
    }],
    total: 403,
    page: 1,
    pageSize: 20
  }), {
    data: [{
      meter_id: "J100001",
      serial_number: "GE84132",
      make: "L&T",
      phase_type: "single",
      installation_status: "Installed",
      distribution_transformer_code: "DT-002"
    }],
    total: 403,
    page: 1,
    page_size: 20
  });
});

test("extracts nameplate, hierarchy, and numeric geo from server-rendered detail", () => {
  const html = `
    <main>
      <nav><span>Jaipur Zone 1 (Z-01)</span><span>Circle 1 (C-01)</span>
      <span>Malviya Nagar DT 1 (DT-001)</span></nav>
      <dl><div><dt>Meter ID</dt><dd>J100000</dd></div>
      <div><dt>Serial No</dt><dd>SE33962</dd></div>
      <div><dt>Installation Type</dt><dd>Whole Current</dd></div></dl>
    </main>`;
  assert.deepEqual(normalizeMeterPage(html, "J100000", {
    data: { latitude: "26.9", longitude: "75.8" }
  }), {
    meter_id: "J100000",
    serial_number: "SE33962",
    installation_type: "Whole Current",
    distribution_transformer_code: "DT-001",
    network_hierarchy: [
      { level: "zone", name: "Jaipur Zone 1", code: "Z-01" },
      { level: "circle", name: "Circle 1", code: "C-01" },
      { level: "distribution_transformer", name: "Malviya Nagar DT 1", code: "DT-001" }
    ],
    location: { latitude: 26.9, longitude: 75.8 }
  });
  assert.equal(normalizeMeterPage(html, "not-this-meter", { data: {} }), null);
});

test("normalizes consumption readings and preserves portal timestamps", () => {
  assert.deepEqual(normalizeReadings({
    data: [{
      timestamp: "30/06/2026 23:30",
      kwh: "48580.79",
      kvah: "52467.25",
      voltR: "220"
    }]
  }, "J100000"), {
    meter_id: "J100000",
    interval_minutes: 30,
    count: 1,
    readings: [{
      timestamp: "30/06/2026 23:30",
      kwh: 48580.79,
      kvah: 52467.25,
      voltage_r: 220
    }]
  });
  assert.throws(
    () => normalizeReadings({ data: [{ timestamp: "x", kwh: "bad", kvah: "1", voltR: "2" }] }, "J"),
    /non-numeric/
  );
});

test("normalizes transformer fields", () => {
  assert.deepEqual(normalizeTransformers({
    data: [{ code: "DT-001", name: "Malviya Nagar DT 1", feederCode: "F-001", capacityKva: 100 }],
    total: 40,
    page: 1,
    pageSize: 20
  }), {
    data: [{ code: "DT-001", name: "Malviya Nagar DT 1", feeder_code: "F-001", capacity_kva: 100 }],
    total: 40,
    page: 1,
    page_size: 20
  });
});
