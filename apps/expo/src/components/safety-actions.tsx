import { useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
} from "react-native";

import * as Notifications from "expo-notifications";

import { useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native/button";
import { Input } from "heroui-native/input";

import { SafeAreaView } from "~/components/styled";
import { Text } from "~/components/ui/text";
import { trpc, type RouterInputs, type RouterOutputs } from "~/utils/api";
import { authClient } from "~/utils/auth";

type Reason = RouterInputs["safety"]["report"]["reason"];
const reasons: { value: Reason; label: string }[] = [
  { value: "spam", label: "Spam or scams" },
  { value: "harassment", label: "Harassment or bullying" },
  { value: "sexual_content", label: "Sexual or non-consensual content" },
  { value: "child_safety", label: "Child safety" },
  { value: "violence", label: "Violence or threats" },
  { value: "other", label: "Something else" },
];

export function SafetyActions({
  userId,
  name,
  onBlocked,
  compact = false,
}: {
  userId: string;
  name: string;
  onBlocked?: () => void;
  compact?: boolean;
}) {
  const { data: session } = authClient.useSession();
  const [reportOpen, setReportOpen] = useState(false);
  const [reason, setReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState("");
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const block = trpc.safety.block.useMutation({
    onSuccess: async () => {
      onBlocked?.();
      await Promise.all([
        utils.messages.inbox.cancel(),
        utils.groups.inbox.cancel(),
        utils.friends.list.cancel(),
        utils.friends.incomingRequests.cancel(),
      ]);
      // Remove cached content even if the subsequent network refresh fails.
      utils.messages.inbox.setData(
        undefined,
        (old) => old?.filter((message) => message?.senderId !== userId) ?? [],
      );
      utils.friends.list.setData(
        undefined,
        (old) => old?.filter((friend) => friend.id !== userId) ?? [],
      );
      utils.friends.incomingRequests.setData(
        undefined,
        (old) =>
          old?.filter((request) => request?.fromUser.id !== userId) ?? [],
      );
      queryClient.setQueriesData<RouterOutputs["groups"]["inbox"]>(
        { queryKey: [["groups", "inbox"]] },
        (old) => old?.filter((message) => message.senderId !== userId),
      );
      void utils.invalidate();
      void Notifications.dismissAllNotificationsAsync();
      Alert.alert(
        "Account blocked",
        "You will no longer receive messages or friend requests from this account. You can unblock it in Profile.",
      );
    },
    onError: (error) => Alert.alert("Could not block account", error.message),
  });
  const report = trpc.safety.report.useMutation({
    onSuccess: () => {
      setReportOpen(false);
      setDetails("");
      setReason(null);
      Alert.alert(
        "Report received",
        "Your report is available to the whisp team for review. No photos or videos were attached. You can also block this account.",
      );
    },
  });

  if (session?.user.id === userId) return null;

  function openActions() {
    Alert.alert(name, "Manage contact with this account.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Report",
        onPress: () => {
          report.reset();
          setReportOpen(true);
        },
      },
      {
        text: "Block",
        style: "destructive",
        onPress: () =>
          Alert.alert(
            `Block ${name}?`,
            "This removes your friendship and pending requests. Messages between you will be hidden, including in shared groups. Unblocking does not restore your friendship.",
            [
              { text: "Cancel", style: "cancel" },
              {
                text: "Block",
                style: "destructive",
                onPress: () => block.mutate({ userId }),
              },
            ],
          ),
      },
    ]);
  }

  return (
    <>
      <Pressable
        ph-no-capture
        accessibilityRole="button"
        accessibilityLabel={`Block or report ${name}`}
        disabled={block.isPending}
        onPress={openActions}
        className="min-h-12 min-w-12 items-center justify-center rounded-lg px-3 py-3 active:opacity-70"
      >
        <Text className="text-base">{compact ? "•••" : "Block or report"}</Text>
      </Pressable>
      <Modal
        visible={reportOpen}
        animationType="slide"
        onRequestClose={() => {
          if (!report.isPending) setReportOpen(false);
        }}
      >
        <SafeAreaView ph-no-capture className="flex-1 bg-background">
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              contentContainerClassName="gap-4 p-5"
              keyboardShouldPersistTaps="handled"
            >
              <Text className="text-2xl font-semibold">Report {name}</Text>
              <Text className="text-muted">
                Tell us what happened. Your report goes to the whisp team, not
                this account. Photos and videos are not attached or preserved.
              </Text>
              {reasons.map((item) => (
                <Pressable
                  key={item.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: reason === item.value }}
                  disabled={report.isPending}
                  onPress={() => setReason(item.value)}
                  className={`min-h-12 rounded-xl border p-3 ${reason === item.value ? "bg-default border-foreground" : "border-separator"}`}
                >
                  <Text>{item.label}</Text>
                </Pressable>
              ))}
              <Text>Details (optional)</Text>
              <Input
                accessibilityLabel="Report details"
                multiline
                maxLength={2000}
                value={details}
                onChangeText={setDetails}
                editable={!report.isPending}
                placeholder="Describe the behavior. Do not include passwords or sensitive images."
              />
              {report.error && (
                <Text accessibilityRole="alert" className="text-danger">
                  {report.error.message}
                </Text>
              )}
              <Button
                isDisabled={!reason || report.isPending}
                onPress={() => {
                  if (reason) report.mutate({ userId, reason, details });
                }}
              >
                {report.isPending ? "Sending…" : "Send report"}
              </Button>
              <Button
                variant="ghost"
                isDisabled={report.isPending}
                onPress={() => setReportOpen(false)}
              >
                Cancel
              </Button>
            </ScrollView>
          </KeyboardAvoidingView>
        </SafeAreaView>
      </Modal>
    </>
  );
}
