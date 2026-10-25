import { test, after } from "node:test";
import assert from "node:assert/strict";
import { v7 } from "uuid";
import { emailSchema } from "../packages/shared/src/email";
import { pool } from "../apps/api/src/db";

after(() => pool.end());

test("email validation normalizes before validating", () => {
  assert.equal(emailSchema.parse("  Person@Example.COM  "), "person@example.com");
  assert.equal(emailSchema.safeParse("invalid email").success, false);
});

test("database normalizes inserts and updates and rejects case duplicates", async () => {
  assert.equal(process.env.APP_ENV, "test", "Requires a disposable database");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const email = `email-test-${v7()}@example.com`;
    const inserted = await client.query('INSERT INTO "user"(name,email) VALUES($1,$2) RETURNING id,email', ["Test", `  ${email.toUpperCase()}  `]);
    assert.equal(inserted.rows[0].email, email);
    const next = `updated-${email}`;
    const updated = await client.query('UPDATE "user" SET email=$1 WHERE id=$2 RETURNING email', [` ${next.toUpperCase()} `, inserted.rows[0].id]);
    assert.equal(updated.rows[0].email, next);
    await client.query("SAVEPOINT duplicate_email");
    await assert.rejects(client.query('INSERT INTO "user"(name,email) VALUES($1,$2)', ["Duplicate", next.toUpperCase()]), { code: "23505" });
    await client.query("ROLLBACK TO SAVEPOINT duplicate_email");
  } finally {
    await client.query("ROLLBACK");
    client.release();
  }
});
