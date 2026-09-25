import { authRouter } from "./router/auth";
import { backgroundUploadTestRouter } from "./router/background-upload-test";
import { friendsRouter } from "./router/friends";
import { groupsRouter } from "./router/groups";
import { messagesRouter } from "./router/messages";
import { notificationsRouter } from "./router/notifications";
import { safetyRouter } from "./router/safety";
import { waitlistRouter } from "./router/waitlist";
import { createTRPCRouter } from "./trpc";

export const appRouter = createTRPCRouter({
  auth: authRouter,
  backgroundUploadTest: backgroundUploadTestRouter,
  friends: friendsRouter,
  groups: groupsRouter,
  messages: messagesRouter,
  notifications: notificationsRouter,
  waitlist: waitlistRouter,
  safety: safetyRouter,
});

// export type definition of API
export type AppRouter = typeof appRouter;
