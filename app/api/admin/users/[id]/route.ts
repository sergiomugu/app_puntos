import { NextRequest, NextResponse } from "next/server";
import {
  auditEvent,
  contextFor,
  getSession,
  mutationProtectionError,
  requirePermission,
} from "@/lib/server/auth";
import { NO_STORE_HEADERS } from "@/lib/server/request-security";
import { UserManagementError, updateUser } from "@/lib/server/user-management";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "La sesión venció. Ingrese nuevamente." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  if (!requirePermission(session, "users:manage")) {
    return NextResponse.json(
      { error: "No tiene permiso para administrar usuarios." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
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
  try {
    const { id } = await context.params;
    const body = await request.json() as Record<string, unknown>;
    const result = await updateUser(session, id, body, contextFor(request));
    return NextResponse.json({ updated: true, ...result }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    const status = error instanceof UserManagementError ? error.status : 500;
    const message = error instanceof UserManagementError
      ? error.message
      : "No se pudo modificar el usuario.";
    const { id } = await context.params;
    await auditEvent({
      actor: session,
      targetUserId: /^[0-9a-f-]{36}$/i.test(id) ? id : undefined,
      action: "USUARIO_MODIFICACION_RECHAZADA",
      outcome: status >= 500 ? "ERROR" : "RECHAZADO",
      reason: message,
      context: contextFor(request),
    }).catch(() => undefined);
    return NextResponse.json({ error: message }, { status, headers: NO_STORE_HEADERS });
  }
}

