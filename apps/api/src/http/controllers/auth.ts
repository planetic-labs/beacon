import { auth } from "@api/modules/auth/config";
async function handler(request: Request) {
  let path:string;
  try{path=decodeURIComponent(new URL(request.url).pathname)}catch{return new Response(null,{status:400})}
  // Administrative mutations go through our transactional policy layer only.
  if (
    path.includes("/admin/") ||
    ["/delete-user", "/update-user", "/change-email", "/sign-up/email"].some(
      (p) => path.endsWith(p),
    )
  )
    return Response.json({ message: "Недоступно" }, { status: 403 });
  return auth.handler(request);
}
export { handler as GET, handler as POST };
