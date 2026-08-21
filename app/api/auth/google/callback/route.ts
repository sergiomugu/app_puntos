import { NextRequest, NextResponse } from "next/server";
import {
  authenticationConfigurationErrors,
  auditEvent,
  authorizeInstitutionalIdentity,
  clearAuthenticationFailures,
  contextFor,
  createDatabaseSession,
  getSession,
  oauthCookieName,
  oauthCookieOptions,
  registerAuthenticationFailure,
  rotateSessionAfterReauthentication,
  sessionCookieName,
  sessionCookieOptions,
  verifyGoogleAuthorizationCode,
  verifyOAuthFlow,
} from "@/lib/server/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function applicationUrl(path: string) {
  return new URL(path, process.env.PUNTOS_BASE_URL);
}

export async function GET(request: NextRequest) {
  if (authenticationConfigurationErrors().length) {
    return NextResponse.json(
      { error: "El acceso institucional todavía no fue configurado en el servidor." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  const context = contextFor(request);
  const state = request.nextUrl.searchParams.get("state");
  const code = request.nextUrl.searchParams.get("code");
  const providerError = request.nextUrl.searchParams.get("error");
  const flow = verifyOAuthFlow(request.cookies.get(oauthCookieName())?.value, state);
  let response: NextResponse;

  try {
    if (!flow || providerError || !code) {
      throw new Error("El flujo de autenticación fue cancelado, venció o no superó el control de estado.");
    }
    const identity = await verifyGoogleAuthorizationCode(code, flow);
    let databaseSession;
    let targetUserId: string;

    if (flow.payload.intent === "reauth") {
      const current = await getSession();
      if (!current) throw new Error("La sesión que debía confirmarse ya no está vigente.");
      databaseSession = await rotateSessionAfterReauthentication(
        current,
        identity.sub,
        context,
      );
      targetUserId = current.user.id;
      await auditEvent({
        actor: current,
        targetUserId,
        action: "IDENTIDAD_RECONFIRMADA",
        outcome: "EXITO",
        context,
      });
    } else {
      const user = await authorizeInstitutionalIdentity(identity);
      databaseSession = await createDatabaseSession(user.id, context);
      targetUserId = user.id;
      await auditEvent({
        targetUserId,
        action: "INICIO_SESION",
        outcome: "EXITO",
        metadata: { email: identity.email },
        context,
      });
    }

    await clearAuthenticationFailures(context);
    response = NextResponse.redirect(applicationUrl(flow.payload.returnTo));
    response.cookies.set(
      sessionCookieName(),
      databaseSession.rawToken,
      sessionCookieOptions(),
    );
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Error de autenticación";
    await registerAuthenticationFailure(context).catch(() => undefined);
    await auditEvent({
      action: "INICIO_SESION",
      outcome: "RECHAZADO",
      reason,
      context,
    }).catch(() => undefined);
    response = NextResponse.redirect(applicationUrl("/?authError=acceso_no_autorizado"));
  }

  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(oauthCookieName(), "", { ...oauthCookieOptions(), maxAge: 0 });
  return response;
}
