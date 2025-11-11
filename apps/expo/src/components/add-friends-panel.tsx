import { useState } from "react";
import { View } from "react-native";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Text as UIText } from "~/components/ui/text";
import { trpc } from "~/utils/api";

interface SearchUserResult {
  id: string;
  name: string;
  isFriend: boolean;
  hasPendingRequest: boolean;
}

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
        placeholder="Search by username"
        value={query}
        onChangeText={setQuery}
      />

      {query.trim().length > 0 && (
        <View className="gap-2">
          <UIText className="text-sm font-semibold">Search Results</UIText>
          {isPending ? (
            <UIText variant="muted" className="text-sm">
              Searching…
            </UIText>
          ) : (results as SearchUserResult[]).length > 0 ? (
            (results as SearchUserResult[]).map((u) => (
              <View
                key={u.id}
                className="flex-row items-center justify-between rounded-md bg-secondary px-3 py-2"
              >
                <UIText>{u.name}</UIText>
                {u.isFriend ? (
                  <UIText variant="muted" className="text-xs">
                    Friends
                  </UIText>
                ) : u.hasPendingRequest ? (
                  <UIText variant="muted" className="text-xs">
                    Pending
                  </UIText>
                ) : (
                  <Button
                    size="sm"
                    onPress={() => sendReq.mutate({ toUserId: u.id })}
                  >
                    <UIText>Add</UIText>
                  </Button>
                )}
              </View>
            ))
          ) : (
            <UIText variant="muted" className="text-sm">
              No users found
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
              className="flex-row items-center justify-between rounded-md bg-secondary px-3 py-2"
            >
              <UIText>{r.fromUser.name}</UIText>
              <View className="flex-row gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onPress={() => declineReq.mutate({ requestId: r.requestId })}
                >
                  <UIText>Decline</UIText>
                </Button>
                <Button
                  size="sm"
                  onPress={() => acceptReq.mutate({ requestId: r.requestId })}
                >
                  <UIText>Accept</UIText>
                </Button>
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}
