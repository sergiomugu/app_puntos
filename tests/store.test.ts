import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import type { PilotState } from "../lib/server/types";
import { originalsToRemove } from "../lib/server/store";

test("limita originales y protege la versión vigente aunque sea anterior", () => {
  const files = Array.from(
    { length: 25 },
    (_, index) => `${String(index + 1).padStart(4, "0")}-rechazado-PUECON.xlsx`,
  );
  const removed = originalsToRemove(files, 3, 20);

  assert.deepEqual(
    removed.sort(),
    [
      "0001-rechazado-PUECON.xlsx",
      "0002-rechazado-PUECON.xlsx",
      "0004-rechazado-PUECON.xlsx",
      "0005-rechazado-PUECON.xlsx",
    ],
  );
  assert.equal(removed.includes("0003-rechazado-PUECON.xlsx"), false);
});

test("actualiza el estado repetidamente y conserva una copia recuperable", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "puntos-store-"));
  process.env.PUNTOS_DATA_DIR = directory;

  try {
    const store = await import(`../lib/server/store.ts?test=${Date.now()}`);
    await store.getState();
    await store.updateState((state: PilotState) => {
      state.drive.message = "primera actualización";
    });
    await store.updateState((state: PilotState) => {
      state.drive.message = "segunda actualización";
    });

    const current = JSON.parse(
      await readFile(path.join(directory, "state.json"), "utf8"),
    ) as { drive: { message: string } };
    assert.equal(current.drive.message, "segunda actualización");

    await writeFile(path.join(directory, "state.json"), "estado dañado", "utf8");
    const recovered = await store.getState();
    assert.equal(recovered.drive.message, "primera actualización");
  } finally {
    delete process.env.PUNTOS_DATA_DIR;
    await rm(directory, { force: true, recursive: true });
  }
});
