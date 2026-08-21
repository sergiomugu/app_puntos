import { NextResponse } from "next/server";
import { authenticationConfigurationErrors } from "../../../lib/server/auth";
import { driveCredentialsAvailable } from "../../../lib/server/google-drive";
import { driveRuntimeConfig } from "../../../lib/server/runtime-config";
import { getState } from "../../../lib/server/store";
import {
  databaseConfigurationErrors,
  databaseHealthy,
} from "../../../lib/server/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const state = await getState();
  const driveConfig = driveRuntimeConfig();
  const authenticationConfigured =
    authenticationConfigurationErrors().length === 0;
  const databaseConfigured = databaseConfigurationErrors().length === 0;
  const databaseIsHealthy = await databaseHealthy();
  const driveCredentialsConfigured = await driveCredentialsAvailable();
  return NextResponse.json({
    status:
      authenticationConfigured &&
      databaseConfigured &&
      databaseIsHealthy &&
      driveConfig.folderId &&
      driveCredentialsConfigured
        ? "ok"
        : "configuracion_pendiente",
    version: "2.3.1",
    baseInstitutionalVersion: "2.3.0",
    baseFunctionalVersion: "2.1.7",
    edition: "drive_metadata_optimization",
    authenticationConfigured,
    databaseConfigured,
    databaseHealthy: databaseIsHealthy,
    driveConfigured: state.drive.configured,
    driveFolderConfigured: Boolean(driveConfig.folderId),
    driveCredentialsConfigured,
    lastDriveSyncAt: state.drive.lastSyncAt,
  }, { headers: { "Cache-Control": "no-store" } });
}
