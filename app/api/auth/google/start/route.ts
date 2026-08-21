import { NextRequest, NextResponse } from "next/server";
import {
  authenticationConfigurationErrors,
  authenticationIsBlocked,
  contextFor,
  createOAuthFlow,
  getSession,
  googleAuthorizationUrl,
  oauthCookieName,
  oauthCookieOptions,
} from "@/lib/server/auth";
import { NO_STORE_HEADERS, safeReturnPath } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (authenticationConfigurationErrors().length) {
    return NextResponse.json(
      { error: "El acceso institucional todavía no fue configurado en el servidor." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
  const context = contextFor(request);
  if (await authenticationIsBlocked(context)) {
    return NextResponse.json(
      { error: "Demasiados intentos rechazados. Espere 15 minutos e intente nuevamente." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  const requestedIntent = request.nextUrl.searchParams.get("intent");
  const intent = requestedIntent === "reauth" ? "reauth" : "login";
  if (intent === "reauth" && !(await getSession())) {
    return NextResponse.redirect(new URL("/?authError=sesion_vencida", request.url));
  }
  const returnTo = safeReturnPath(request.nextUrl.searchParams.get("returnTo"));
  const flow = createOAuthFlow(intent, returnTo);
  const response = NextResponse.redirect(googleAuthorizationUrl(flow));
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(oauthCookieName(), flow.cookieToken, oauthCookieOptions());
  return response;
}

