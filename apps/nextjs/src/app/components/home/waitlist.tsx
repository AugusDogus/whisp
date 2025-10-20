import { appRouter, createTRPCContext } from "@acme/api";

import { auth } from "~/auth/server";
import { cn } from "~/lib/utils";
import { WaitlistButton } from "./waitlist-button";

interface WaitlistFormProps {
  className?: string;
}

export async function WaitlistForm({ className }: WaitlistFormProps) {
  // Fetch count on the server using the router directly
  const ctx = await createTRPCContext({
    headers: new Headers(),
    auth,
  });
  const caller = appRouter.createCaller(ctx);
  const { count } = await caller.waitlist.getCount();

  return (
    <div
      className={cn(
        "mx-auto flex w-full max-w-3xl flex-col items-center justify-center gap-4",
        className,
      )}
    >
      <WaitlistButton />
      <div className="relative mt-3 flex flex-row items-center justify-center gap-3 text-sm sm:text-base">
        <span className="size-2 animate-pulse rounded-full bg-green-600 dark:bg-green-400" />
        <span className="blur-xs absolute left-0 size-2 animate-pulse rounded-full bg-green-600 dark:bg-green-400" />
        <span className="tabular-nums">{count}</span> people already joined the
        waitlist
      </div>
    </div>
  );
}
