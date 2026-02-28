import { trpc } from "~/utils/api";

export function useMarkReadMutation() {
  const utils = trpc.useUtils();
  const markRead = trpc.messages.markRead.useMutation({
    onMutate: async (variables) => {
      await utils.messages.inbox.cancel();
      const previousInbox = utils.messages.inbox.getData();
      utils.messages.inbox.setData(undefined, (old) => {
        if (!old) return old;
        return old.filter((msg) => msg?.deliveryId !== variables.deliveryId);
      });
      return { previousInbox };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousInbox) {
        utils.messages.inbox.setData(undefined, context.previousInbox);
      }
    },
    onSettled: async () => {
      await utils.messages.inbox.invalidate();
    },
  });

  const { mutate: cleanupMessage } =
    trpc.messages.cleanupIfAllRead.useMutation();

  return { markRead, cleanupMessage, utils };
}
