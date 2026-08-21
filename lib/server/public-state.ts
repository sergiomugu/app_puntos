import { canAccessFaculty, type RoleCode } from "./access-control";
import type { ImportAttempt, PilotState } from "./types";

export function publicAttempt(attempt?: ImportAttempt) {
  if (!attempt) return undefined;
  const safe: Partial<ImportAttempt> = { ...attempt };
  delete safe.driveFileId;
  return { ...safe, sha256: attempt.sha256.slice(0, 16) };
}

export function sessionActivity(
  history: ImportAttempt[],
  sinceAttempt: number,
) {
  if (!history.length) return [];
  if (sinceAttempt <= 0) return history;
  return history.filter((attempt) => attempt.attempt >= sinceAttempt);
}

export function publicDashboard(
  state: PilotState,
  access?: { role: RoleCode; facultyIds: readonly string[] },
) {
  const faculties = access
    ? state.faculties.filter((faculty) =>
        canAccessFaculty(access.role, access.facultyIds, faculty.id),
      )
    : state.faculties;
  const institutionalScope = !access || faculties.length === state.faculties.length;
  return {
    updatedAt: state.updatedAt,
    drive: {
      configured: state.drive.configured,
      intervalSeconds: state.drive.intervalSeconds,
      lastSyncAt: state.drive.lastSyncAt,
      status: state.drive.status,
      message: state.drive.message,
      warnings: institutionalScope ? state.drive.warnings : [],
    },
    faculties: faculties.map((faculty) => ({
      ...faculty,
      source: {
        expectedFileName: faculty.source.expectedFileName,
        current: publicAttempt(faculty.source.current),
        lastAttempt: publicAttempt(faculty.source.lastAttempt),
      },
    })),
  };
}
