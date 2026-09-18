import type { PreviewScope } from "../../packages/api/src/uploadthing/preview-scope";
import type { Client } from "@libsql/client";

import { drizzle } from "drizzle-orm/libsql";

import { eq } from "@acme/db";
import { PreviewPushTokenReset, PushToken } from "@acme/db/schema";

export async function resetInheritedPushTokens(
  client: Client,
  scope: PreviewScope,
) {
  await drizzle(client).transaction(async (tx) => {
    const [reset] = await tx
      .select()
      .from(PreviewPushTokenReset)
      .where(eq(PreviewPushTokenReset.scope, scope.prefix))
      .limit(1);
    if (reset) return;

    // Clear copied production destinations once, before the preview is deployed.
    // Subsequent pushes must retain registrations made by preview devices.
    await tx.delete(PushToken);
    await tx.insert(PreviewPushTokenReset).values({ scope: scope.prefix });
  });
}
