import { PGlite } from "@electric-sql/pglite";
import fs from "node:fs/promises";
import { bootstrap } from "./db-fixture.cjs";
export async function gameDatabase() {
  const db = new PGlite();
  await db.exec(bootstrap);
  for (const file of (await fs.readdir("supabase/migrations")).sort())
    await db.exec(await fs.readFile("supabase/migrations/" + file, "utf8"));
  const users = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  for (const [i, id] of users.entries())
    await db.query("insert into auth.users values($1,$2)", [
      id,
      { full_name: `Game Player ${i + 1}` },
    ]);
  async function as(role, user, fn) {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [
      user || "",
    ]);
    try {
      return await fn();
    } finally {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claim.sub','',false)");
    }
  }
  const value = async (sql, args = []) =>
    (await db.query(sql, args)).rows[0]?.value;
  const rpc = (name, args, role = "authenticated", user = users[0]) =>
    as(role, user, () =>
      value(
        `select public.${name}(${Object.keys(args)
          .map((k, i) => `${k}=>$${i + 1}`)
          .join(",")}) value`,
        Object.values(args),
      ),
    );
  const admin = (action, user, body) =>
    rpc("games_admin", { action, owner: user, body }, "service_role", null);
  for (const id of users)
    await rpc("ensure_my_profile", { expected_user: id }, "authenticated", id);
  return { db, users, as, value, rpc, admin };
}
