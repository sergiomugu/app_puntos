import { NextResponse } from "next/server";
import { getSession } from "../../../lib/server/auth";
import { publicDashboard } from "../../../lib/server/public-state";
import { getState } from "../../../lib/server/store";
import { NO_STORE_HEADERS } from "../../../lib/server/request-security";
import { sanitizedMessage } from "../../../lib/server/sync-drive";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json(
      { error: "La sesión venció. Ingrese nuevamente." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }
  try {
    const state = await getState();
    return NextResponse.json(publicDashboard(state, {
      role: session.user.role,
      facultyIds: session.user.facultyIds,
    }), {
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    console.error("Fallo al recuperar el tablero", error);
    return NextResponse.json(
      { error: sanitizedMessage(error) },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
