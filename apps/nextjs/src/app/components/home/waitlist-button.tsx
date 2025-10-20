"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button } from "@acme/ui/button";

import { authClient } from "~/auth/client";
import { useTRPC } from "~/trpc/react";

export function WaitlistButton() {
  const { data: session } = authClient.useSession();
  const [isJoining, setIsJoining] = useState(false);
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { data: statusData } = useQuery({
    ...trpc.waitlist.isUserOnWaitlist.queryOptions(),
    enabled: !!session,
  });

  const joinMutation = useMutation(
    trpc.waitlist.join.mutationOptions({
      onSuccess: async () => {
        setIsJoining(false);
        await queryClient.invalidateQueries(trpc.waitlist.pathFilter());
      },
      onError: () => {
        setIsJoining(false);
      },
    }),
  );

  // Auto-join waitlist after Discord OAuth redirect
  useEffect(() => {
    if (session && !statusData?.onWaitlist && !joinMutation.isPending) {
      joinMutation.mutate();
    }
  }, [session, statusData, joinMutation]);

  async function handleJoinWaitlist() {
    setIsJoining(true);
    await authClient.signIn.social({
      provider: "discord",
      callbackURL: "/",
    });
  }

  const onWaitlist = statusData?.onWaitlist ?? false;

  if (onWaitlist) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed bg-white p-4 text-center dark:border-neutral-500 dark:bg-neutral-900">
        <p className="text-xl font-semibold">Welcome to the waitlist! 🎉</p>
        <p className="text-base text-muted-foreground">
          We&apos;ll let you know when we&#39;re ready to show you what
          we&#39;ve been working on.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-3">
      <Button
        className="relative h-11 w-full cursor-pointer overflow-hidden rounded-lg px-4 text-base drop-shadow-[0_0_8px_rgba(0,0,0,0.3)] transition-all duration-300 before:absolute before:inset-0 before:translate-x-[-100%] before:bg-gradient-to-r before:from-transparent before:via-white/10 before:to-transparent before:transition-transform before:duration-1000 before:ease-in-out hover:drop-shadow-[0_0_12px_rgba(0,0,0,0.4)] hover:before:translate-x-[100%] dark:drop-shadow-[0_0_8px_rgba(255,255,255,0.3)] dark:hover:drop-shadow-[0_0_12px_rgba(255,255,255,0.4)]"
        onClick={handleJoinWaitlist}
        disabled={isJoining}
      >
        {isJoining ? "Redirecting..." : "Join Waitlist with Discord"}
      </Button>
    </div>
  );
}
