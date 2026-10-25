import { auth } from "../modules/auth/config";
import { db } from "../db";
import { user } from "../db/schema";
import { eq } from "drizzle-orm";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function actor(headers: Headers) {
  const s = await auth.api.getSession({ headers });
  if (!s) throw new HttpError(401, "Войдите в приложение");
  const [u] = await db.select().from(user).where(eq(user.id, s.user.id));
  if (!u || u.banned) throw new HttpError(401, "Доступ приостановлен");
  return u;
}
export function adminOnly(u: { role: string }) {
  if (u.role !== "admin")
    throw new HttpError(403, "Нужны права администратора");
}
export function checkOrigin(request: Request) {
  if (
    request.method !== "GET" &&
    request.headers.get("origin") !== new URL(process.env.APP_URL!).origin
  )
    throw new HttpError(403, "Недопустимый источник запроса");
}
