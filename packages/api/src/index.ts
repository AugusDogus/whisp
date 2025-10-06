import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AnyFileRoute } from "uploadthing/types";

import type { AppRouter } from "./root";
import { appRouter } from "./root";
import { createTRPCContext } from "./trpc";

/**
 * Inference helpers for input types
 * @example
 * type PostByIdInput = RouterInputs['post']['byId']
 *      ^? { id: number }
 **/
type RouterInputs = inferRouterInputs<AppRouter>;

/**
 * Inference helpers for output types
 * @example
 * type AllPostsOutput = RouterOutputs['post']['all']
 *      ^? Post[]
 **/
type RouterOutputs = inferRouterOutputs<AppRouter>;

export { appRouter, createTRPCContext };
export type { AppRouter, RouterInputs, RouterOutputs };
export interface UploadRouter {
  imageUploader: AnyFileRoute;
  [key: string]: AnyFileRoute;
}
export { createUploadRouter } from "./uploadthing/router";
