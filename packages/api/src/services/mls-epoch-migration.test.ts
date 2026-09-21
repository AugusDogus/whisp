import { createClient } from "@libsql/client";
import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("epoch migration backfills commits and tracks legacy writers transactionally", async () => {
  const directory = await mkdtemp(join(tmpdir(), "whisp-epoch-migration-"));
  const client = createClient({ url: `file:${join(directory, "test.db")}` });
  try {
    await client.executeMultiple(
      await Bun.file(
        new URL("../../../db/drizzle/0002_mls.sql", import.meta.url),
      ).text(),
    );
    await client.executeMultiple(`
      INSERT INTO mls_conversation (id, scope, users, revision, members)
      VALUES ('conversation', 'direct', '[]', 3, '[]');
      INSERT INTO mls_event (id, conversationId, sequence, entry) VALUES
        ('first', 'conversation', 1, '{"kind":"commit"}'),
        ('second', 'conversation', 2, '{"kind":"commit"}'),
        ('third', 'conversation', 3, '{"kind":"application"}');
    `);
    await client.executeMultiple(
      await Bun.file(
        new URL(
          "../../../db/drizzle/0004_mls_application_epochs.sql",
          import.meta.url,
        ),
      ).text(),
    );
    expect(
      (await client.execute("SELECT epoch, revision FROM mls_conversation"))
        .rows[0],
    ).toMatchObject({ epoch: 2, revision: 3 });
    // Old deployments do not know about epoch. Their existing event insertion
    // must still advance it, including a batch of multiple commits.
    await client.executeMultiple(`
      INSERT INTO mls_event (id, conversationId, sequence, entry) VALUES
        ('fourth', 'conversation', 4, '{"kind":"commit"}'),
        ('fifth', 'conversation', 5, '{"kind":"commit"}'),
        ('sixth', 'conversation', 6, '{"kind":"application"}');
      UPDATE mls_conversation SET revision = 6;
    `);
    expect(
      (await client.execute("SELECT epoch, revision FROM mls_conversation"))
        .rows[0],
    ).toMatchObject({ epoch: 4, revision: 6 });
    const transaction = await client.transaction("write");
    try {
      await transaction.execute(
        "INSERT INTO mls_event (id, conversationId, sequence, entry) VALUES ('rolled-back', 'conversation', 7, '{\"kind\":\"commit\"}')",
      );
      expect(
        (await transaction.execute("SELECT epoch FROM mls_conversation"))
          .rows[0],
      ).toMatchObject({ epoch: 5 });
      await transaction.rollback();
    } finally {
      transaction.close();
    }
    expect(
      (await client.execute("SELECT epoch FROM mls_conversation")).rows[0],
    ).toMatchObject({ epoch: 4 });
    expect(
      (
        await client.execute("PRAGMA foreign_key_list(mls_application_attempt)")
      ).rows.some((row) => row.table === "mls_draft"),
    ).toBe(false);
  } finally {
    client.close();
    await rm(directory, { recursive: true });
  }
});
