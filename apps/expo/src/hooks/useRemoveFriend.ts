import { trpc } from "~/utils/api";

export function useRemoveFriend(onRemoved: () => void) {
  const utils = trpc.useUtils();
  const removeFriend = trpc.friends.removeFriend.useMutation({
    onMutate: async (variables) => {
      await utils.friends.list.cancel();
      const previousFriends = utils.friends.list.getData();
      utils.friends.list.setData(undefined, (old) => {
        if (!old) return old;
        return old.filter((friend) => friend.id !== variables.friendId);
      });
      return { previousFriends };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousFriends) {
        utils.friends.list.setData(undefined, context.previousFriends);
      }
    },
    onSuccess: () => {
      onRemoved();
    },
    onSettled: async () => {
      await utils.friends.list.invalidate();
    },
  });

  return removeFriend;
}
