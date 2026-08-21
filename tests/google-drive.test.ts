import assert from "node:assert/strict";
import test from "node:test";
import {
  driveRetryDelayMilliseconds,
  retryableDriveStatus,
} from "../lib/server/google-drive";

test("reintenta límites temporales y errores transitorios de Google Drive", () => {
  for (const status of [429, 500, 502, 503, 504]) {
    assert.equal(retryableDriveStatus(status), true);
  }
});

test("no reintenta errores permanentes de autenticación o permisos", () => {
  for (const status of [400, 401, 403, 404]) {
    assert.equal(retryableDriveStatus(status), false);
  }
});

test("aplica esperas exponenciales acotadas con variación aleatoria", () => {
  assert.equal(driveRetryDelayMilliseconds(1, 0), 2_000);
  assert.equal(driveRetryDelayMilliseconds(2, 250), 4_250);
  assert.equal(driveRetryDelayMilliseconds(5, 1_000), 33_000);
  assert.equal(driveRetryDelayMilliseconds(99, 0), 64_000);
});
