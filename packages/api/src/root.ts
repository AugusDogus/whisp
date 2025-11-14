import { authRouter } from "./router/auth";
import { friendsRouter } from "./router/friends";
import { groupsRouter } from "./router/groups";
import { messagesRouter } from "./router/messages";
import { notificationsRouter } from "./router/notifications";
import { waitlistRouter } from "./router/waitlist";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  friends: friendsRouter,
  groups: groupsRouter,
  messages: messagesRouter,
  notifications: notificationsRouter,
  waitlist: waitlistRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
