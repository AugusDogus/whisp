import { authRouter } from "./router/auth";
import { friendsRouter } from "./router/friends";
import { messagesRouter } from "./router/messages";
import { postRouter } from "./router/post";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  post: postRouter,
  friends: friendsRouter,
  messages: messagesRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
