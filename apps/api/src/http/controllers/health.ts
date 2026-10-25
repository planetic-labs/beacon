import { sql } from "drizzle-orm";
import { db } from "@api/db";
export const dynamic = "force-dynamic";
export async function GET() {
  try {
    const result = await db.execute(
      sql`select to_regclass('public.user') is not null as ready`,
    );
    if (!result.rows[0]?.ready) throw new Error();
    return Response.json(
      { ok: true },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json({ ok: false }, { status: 503 });
  }
}
