import { useState } from "react";
import { View } from "react-native";

import { Button } from "heroui-native/button";
import { Input } from "heroui-native/input";

import { SafetyMenu } from "~/components/safety-actions";
import { Avatar } from "~/components/ui/avatar";
import { Text as UIText } from "~/components/ui/text";
import { trpc } from "~/utils/api";

interface IncomingRequestRow {
  requestId: string;
  fromUser: { id: string; name: string };
}

export function AddFriendsPanel() {
  const [query, setQuery] = useState("");

  const { data: results = [], isPending } = trpc.friends.searchUsers.useQuery(
    { query },
    { enabled: query.trim().length > 0 },
  );
  const { data: incoming = [] } = trpc.friends.incomingRequests.useQuery();

  const utils = trpc.useUtils();
  const sendReq = trpc.friends.sendRequest.useMutation({
    onMutate: async (variables) => {
      // Cancel any outgoing refetches
      await utils.friends.searchUsers.cancel();

      // Snapshot the previous value
      const previousResults = utils.friends.searchUsers.getData({ query });

      // Optimistically update to show "Pending" status
      utils.friends.searchUsers.setData({ query }, (old) => {
        if (!old) return old;
        return old.map((user) =>
          user.id === variables.toUserId
            ? { ...user, hasPendingRequest: true }
            : user,
        );
      });

      // Return context with the snapshot
      return { previousResults };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, roll back to the previous value
      if (context?.previousResults) {
        utils.friends.searchUsers.setData({ query }, context.previousResults);
      }
    },
    onSettled: async () => {
      // Always refetch after error or success to ensure we're in sync
      await utils.friends.searchUsers.invalidate();
      await utils.friends.incomingRequests.invalidate();
      await utils.friends.list.invalidate();
    },
  });
  const acceptReq = trpc.friends.acceptRequest.useMutation({
    onMutate: async (variables) => {
      // Cancel any outgoing refetches
      await utils.friends.incomingRequests.cancel();

      // Snapshot the previous value
      const previousRequests = utils.friends.incomingRequests.getData();

      // Optimistically remove the request
      utils.friends.incomingRequests.setData(undefined, (old) => {
        if (!old) return old;
        return old.filter((req) => req?.requestId !== variables.requestId);
      });

      // Return context with the snapshot
      return { previousRequests };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, roll back to the previous value
      if (context?.previousRequests) {
        utils.friends.incomingRequests.setData(
          undefined,
          context.previousRequests,
        );
      }
    },
    onSettled: async () => {
      // Always refetch after error or success to ensure we're in sync
      await utils.friends.incomingRequests.invalidate();
      await utils.friends.list.invalidate();
    },
  });

  const declineReq = trpc.friends.declineRequest.useMutation({
    onMutate: async (variables) => {
      // Cancel any outgoing refetches
      await utils.friends.incomingRequests.cancel();

      // Snapshot the previous value
      const previousRequests = utils.friends.incomingRequests.getData();

      // Optimistically remove the request
      utils.friends.incomingRequests.setData(undefined, (old) => {
        if (!old) return old;
        return old.filter((req) => req?.requestId !== variables.requestId);
      });

      // Return context with the snapshot
      return { previousRequests };
    },
    onError: (err, variables, context) => {
      // If the mutation fails, roll back to the previous value
      if (context?.previousRequests) {
        utils.friends.incomingRequests.setData(
          undefined,
          context.previousRequests,
        );
      }
    },
    onSettled: async () => {
      // Always refetch after error or success to ensure we're in sync
      await utils.friends.incomingRequests.invalidate();
    },
  });

  return (
    <View className="gap-4">
      <Input
        placeholder="Enter their username"
        value={query}
        onChangeText={setQuery}
      />
      <UIText variant="muted" className="text-sm">
        Enter their username exactly as it appears on their profile.
      </UIText>

      {query.trim().length > 0 && (
        <View className="gap-2">
          <UIText className="text-sm font-semibold">Search Results</UIText>
          {isPending ? (
            <UIText variant="muted" className="text-sm">
              Searching…
            </UIText>
          ) : results.length > 0 ? (
            results.map((u) => (
              <View
                key={u.id}
                className="bg-default items-center gap-5 rounded-2xl p-6"
              >
                <View className="absolute right-3 top-3">
                  <SafetyMenu userId={u.id} name={u.name} />
                </View>
                <Avatar userId={u.id} image={u.image} name={u.name} size={96} />
                <UIText className="text-center text-2xl font-semibold">
                  {u.name}
                </UIText>
                {u.isFriend ? (
                  <UIText variant="muted" className="text-center">
                    Friends
                  </UIText>
                ) : u.hasPendingRequest ? (
                  <UIText variant="muted" className="text-center">
                    Request pending
                  </UIText>
                ) : (
                  <Button
                    size="lg"
                    className="w-full"
                    isDisabled={sendReq.isPending}
                    accessibilityLabel={`Add ${u.name} as a friend`}
                    onPress={() => sendReq.mutate({ toUserId: u.id })}
                  >
                    Add friend
                  </Button>
                )}
                {sendReq.isError && sendReq.variables?.toUserId === u.id && (
                  <UIText className="text-danger text-center text-sm">
                    Couldn’t send your friend request. Try again.
                  </UIText>
                )}
              </View>
            ))
          ) : (
            <UIText variant="muted" className="text-sm">
              No users found with that username
            </UIText>
          )}
        </View>
      )}

      <View className="gap-2">
        <UIText className="text-sm font-semibold">Incoming Requests</UIText>
        {(incoming as IncomingRequestRow[]).length === 0 ? (
          <UIText variant="muted" className="text-sm">
            No requests
          </UIText>
        ) : (
          (incoming as IncomingRequestRow[]).map((r) => (
            <View
              key={r.requestId}
              className="bg-default flex-row items-center justify-between rounded-md px-3 py-2"
            >
              <UIText className="flex-1">{r.fromUser.name}</UIText>
              <View className="flex-row items-center gap-2">
                <SafetyMenu userId={r.fromUser.id} name={r.fromUser.name} />
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => declineReq.mutate({ requestId: r.requestId })}
                >
                  Decline
                </Button>
                <Button
                  size="sm"
                  onPress={() => acceptReq.mutate({ requestId: r.requestId })}
                >
                  Accept
                </Button>
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}
