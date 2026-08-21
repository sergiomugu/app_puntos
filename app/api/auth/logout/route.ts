import { NextRequest, NextResponse } from "next/server";
import {
  auditEvent,
  contextFor,
  getSession,
  mutationProtectionError,
  revokeSession,
  sessionCookieName,
  sessionCookieOptions,
} from "@/lib/server/auth";
import { NO_STORE_HEADERS } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (session) {
    const protectionError = mutationProtectionError(request, session);
    if (protectionError) {
      return NextResponse.json(
        { error: protectionError },
        { status: 403, headers: NO_STORE_HEADERS },
      );
    }
    await revokeSession(session.id, "Cierre de sesión solicitado por el usuario");
    await auditEvent({
      actor: session,
      targetUserId: session.user.id,
      action: "CIERRE_SESION",
      outcome: "EXITO",
      context: contextFor(request),
    });
  }
  const response = NextResponse.json(
    { authenticated: false },
    { headers: { ...NO_STORE_HEADERS, "Clear-Site-Data": '"cache", "storage"' } },
  );
  response.cookies.set(sessionCookieName(), "", {
    ...sessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
