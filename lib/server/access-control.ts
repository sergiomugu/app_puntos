export const ROLE_CODES = [
  "ADMIN_GENERAL",
  "OPERADOR_DGPFP",
  "RESPONSABLE_FACULTAD",
  "CONSULTA_GENERAL",
  "CONSULTA_FACULTAD",
] as const;

export type RoleCode = (typeof ROLE_CODES)[number];

export const USER_STATUS_CODES = [
  "PENDIENTE",
  "ACTIVO",
  "SUSPENDIDO",
  "BAJA",
] as const;

export type UserStatusCode = (typeof USER_STATUS_CODES)[number];

export const FACULTY_IDS = ["ayv", "exa", "ing", "eco", "hum"] as const;
export type FacultyId = (typeof FACULTY_IDS)[number];

export const PERMISSIONS = [
  "dashboard:read",
  "report:faculty",
  "report:consolidated",
  "history:activity",
  "history:full",
  "sync:manual",
  "users:manage",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const ROLE_DETAILS: Record<RoleCode, {
  label: string;
  description: string;
  institutionalScope: boolean;
  permissions: readonly Permission[];
}> = {
  ADMIN_GENERAL: {
    label: "Administrador General",
    description: "Administración integral, usuarios, auditoría y operación institucional.",
    institutionalScope: true,
    permissions: PERMISSIONS,
  },
  OPERADOR_DGPFP: {
    label: "Operador DGPFP",
    description: "Operación completa del tablero, verificación e historial, sin administrar usuarios.",
    institutionalScope: true,
    permissions: [
      "dashboard:read",
      "report:faculty",
      "report:consolidated",
      "history:activity",
      "history:full",
      "sync:manual",
    ],
  },
  RESPONSABLE_FACULTAD: {
    label: "Responsable de Facultad",
    description: "Consulta operativa y actividad limitada a las Facultades asignadas.",
    institutionalScope: false,
    permissions: ["dashboard:read", "report:faculty", "history:activity"],
  },
  CONSULTA_GENERAL: {
    label: "Consulta General Institucional",
    description: "Lectura de las cinco Facultades e informes, sin iniciar actualizaciones.",
    institutionalScope: true,
    permissions: ["dashboard:read", "report:faculty", "report:consolidated"],
  },
  CONSULTA_FACULTAD: {
    label: "Consulta de Facultad",
    description: "Lectura e informe de las Facultades asignadas, sin actividad ni actualizaciones.",
    institutionalScope: false,
    permissions: ["dashboard:read", "report:faculty"],
  },
};

export function isRoleCode(value: unknown): value is RoleCode {
  return typeof value === "string" && ROLE_CODES.includes(value as RoleCode);
}

export function isUserStatusCode(value: unknown): value is UserStatusCode {
  return typeof value === "string" &&
    USER_STATUS_CODES.includes(value as UserStatusCode);
}

export function hasPermission(role: RoleCode, permission: Permission) {
  return ROLE_DETAILS[role].permissions.includes(permission);
}

export function roleRequiresFacultyScope(role: RoleCode) {
  return !ROLE_DETAILS[role].institutionalScope;
}

export function normalizeFacultyScopes(value: unknown): FacultyId[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value)]
    .filter((item): item is FacultyId =>
      typeof item === "string" && FACULTY_IDS.includes(item as FacultyId),
    )
    .sort();
}

export function validateRoleScopes(role: RoleCode, facultyIds: FacultyId[]) {
  if (roleRequiresFacultyScope(role) && facultyIds.length === 0) {
    return "El perfil requiere al menos una Facultad asignada.";
  }
  if (!roleRequiresFacultyScope(role) && facultyIds.length > 0) {
    return "El perfil tiene alcance institucional y no admite Facultades individuales.";
  }
  return undefined;
}

export function canAccessFaculty(
  role: RoleCode,
  facultyScopes: readonly string[],
  facultyId: string,
) {
  return ROLE_DETAILS[role].institutionalScope || facultyScopes.includes(facultyId);
}

export function publicRoleCatalog() {
  return ROLE_CODES.map((code) => ({ code, ...ROLE_DETAILS[code] }));
}

