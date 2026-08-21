import { NextRequest, NextResponse } from "next/server";
import {
  auditEvent,
  contextFor,
  getSession,
  mutationProtectionError,
  requirePermission,
} from "@/lib/server/auth";
import { NO_STORE_HEADERS } from "@/lib/server/request-security";
import {
  UserManagementError,
  administrationCatalog,
  createUser,
  listUsers,
} from "@/lib/server/user-management";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function forbidden() {
  return NextResponse.json(
    { error: "No tiene permiso para administrar usuarios." },
    { status: 403, headers: NO_STORE_HEADERS },
  );
}

export async function GET(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "La sesión venció. Ingrese nuevamente." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (!requirePermission(session, "users:manage")) return forbidden();
  const users = await listUsers({
    search: request.nextUrl.searchParams.get("search") ?? undefined,
    role: request.nextUrl.searchParams.get("role") ?? undefined,
    status: request.nextUrl.searchParams.get("status") ?? undefined,
  });
  return NextResponse.json(
    {
      users,
      catalog: administrationCatalog(),
      canGrantAdmin: session.user.protectedPrincipal,
      reauthFresh: session.reauthFresh,
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "La sesión venció. Ingrese nuevamente." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (!requirePermission(session, "users:manage")) return forbidden();
  const protectionError = mutationProtectionError(request, session);
  if (protectionError) {
    return NextResponse.json({ error: protectionError }, { status: 403, headers: NO_STORE_HEADERS });
  }
  if (!session.reauthFresh) {
    return NextResponse.json(
      { error: "Debe volver a verificar su identidad antes de esta acción.", reauthRequired: true },
      { status: 428, headers: NO_STORE_HEADERS },
    );
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 32_768) {
    return NextResponse.json({ error: "La solicitud es demasiado grande." }, { status: 413 });
  }
  try {
    const body = await request.json() as Record<string, unknown>;
    const userId = await createUser(session, body, contextFor(request));
    return NextResponse.json({ created: true, userId }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    const status = error instanceof UserManagementError ? error.status : 500;
    const message = error instanceof UserManagementError
      ? error.message
      : "No se pudo crear el usuario.";
    await auditEvent({
      actor: session,
      action: "USUARIO_ALTA",
      outcome: status >= 500 ? "ERROR" : "RECHAZADO",
      reason: message,
      context: contextFor(request),
    }).catch(() => undefined);
    return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
  }
}

