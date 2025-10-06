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
    onSuccess: async () => {
      await utils.friends.searchUsers.invalidate();
      await utils.friends.incomingRequests.invalidate();
      await utils.friends.list.invalidate();
    },
  });
  const acceptReq = trpc.friends.acceptRequest.useMutation({
    onSuccess: async () => {
      await utils.friends.incomingRequests.invalidate();
      await utils.friends.list.invalidate();
    },
  });

  return (
    <View className="gap-4">
      <Input
        placeholder="Search by name or email"
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
              <Button
                size="sm"
                onPress={() => acceptReq.mutate({ requestId: r.requestId })}
              >
                <UIText>Accept</UIText>
              </Button>
            </View>
          ))
        )}
      </View>
    </View>
  );
}
