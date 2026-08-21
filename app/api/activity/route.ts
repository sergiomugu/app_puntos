import { NextRequest, NextResponse } from "next/server";
import {
  getSession,
  mutationProtectionError,
} from "@/lib/server/auth";
import { NO_STORE_HEADERS } from "@/lib/server/request-security";
import {
  UserStatisticsError,
  recordUserActivity,
} from "@/lib/server/user-statistics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "La sesión venció. Ingrese nuevamente." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  const protectionError = mutationProtectionError(request, session);
  if (protectionError) {
    return NextResponse.json(
      { error: protectionError },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 4_096) {
    return NextResponse.json(
      { error: "La actividad informada es demasiado grande." },
      { status: 413, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const activity = await recordUserActivity(session, await request.json());
    return NextResponse.json(
      { recorded: true, ...activity },
      { status: 201, headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    const status = error instanceof UserStatisticsError ? error.status : 500;
    const message = error instanceof UserStatisticsError
      ? error.message
      : "No se pudo registrar la actividad.";
    return NextResponse.json(
      { error: message },
      { status, headers: NO_STORE_HEADERS },
    );
  }
}
