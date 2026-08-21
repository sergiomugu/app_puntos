import { NextResponse } from "next/server";
import { ROLE_DETAILS } from "@/lib/server/access-control";
import { getSession } from "@/lib/server/auth";
import { NO_STORE_HEADERS } from "@/lib/server/request-security";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  return NextResponse.json(
    session
      ? {
          authenticated: true,
          user: session.user,
          permissions: ROLE_DETAILS[session.user.role].permissions,
          csrfToken: session.csrfToken,
          reauthFresh: session.reauthFresh,
          absoluteExpiresAt: session.absoluteExpiresAt,
        }
      : { authenticated: false },
    { headers: NO_STORE_HEADERS },
  );
}

