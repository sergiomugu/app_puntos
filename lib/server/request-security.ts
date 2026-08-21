import { createHash } from "node:crypto";

export type RequestContext = {
  ipAddress: string;
  userAgent: string;
};

export const NO_STORE_HEADERS = { "Cache-Control": "no-store" } as const;

export function requestContext(request: Request): RequestContext {
  // El servicio sólo debe publicarse detrás del proxy institucional. Nginx
  // sobrescribe X-Real-IP con la dirección remota verificada; un
  // X-Forwarded-For aportado por el navegador no debe tener prioridad.
  const realIp = request.headers.get("x-real-ip")?.trim();
  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  return {
    ipAddress: (realIp || forwarded || "desconocida").slice(0, 128),
    userAgent: (request.headers.get("user-agent") || "desconocido").slice(0, 512),
  };
}

export function hashedSecurityKey(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function sameOriginError(request: Request) {
  const configured = process.env.PUNTOS_BASE_URL?.trim();
  if (!configured) return "El origen público del sistema no está configurado.";
  let expected: string;
  try {
    expected = new URL(configured).origin;
  } catch {
    return "PUNTOS_BASE_URL no tiene un formato válido.";
  }
  const origin = request.headers.get("origin");
  if (!origin || origin !== expected) {
    return "La solicitud no proviene del origen autorizado.";
  }
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return "La solicitud de otro sitio fue rechazada.";
  }
  return undefined;
}

export function safeReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/";
  if (value.includes("\\") || /[\r\n]/.test(value)) return "/";
  return value.slice(0, 512);
}
