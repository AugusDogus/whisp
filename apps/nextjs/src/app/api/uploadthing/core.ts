import { createUploadRouter } from "@acme/api";

import { getSession } from "~/auth/server";

export const uploadRouter = createUploadRouter({ getSession });
export type UploadRouter = typeof uploadRouter;
