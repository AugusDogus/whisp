import { useState } from "react";
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";

import * as Notifications from "expo-notifications";

import { Ionicons } from "@expo/vector-icons";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "heroui-native/button";
import { Dialog } from "heroui-native/dialog";
import { useThemeColor } from "heroui-native/hooks";
import { Input } from "heroui-native/input";
import { Menu } from "heroui-native/menu";
import { toast } from "sonner-native";

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

interface SafetyTarget {
  userId: string;
  name: string;
  onBlocked?: () => void;
  // Portal host for dialogs rendered inside a native Modal, which would
  // otherwise cover the app-level portal.
  portalHost?: string;
}

// Block and report flows for one account. Callers render their own triggers
// and must render `dialogs`.
export function useSafetyActions({
  userId,
  name,
  onBlocked,
  portalHost,
}: SafetyTarget) {
  const { data: session } = authClient.useSession();
  const [reportOpen, setReportOpen] = useState(false);
  const [blockOpen, setBlockOpen] = useState(false);
  const utils = trpc.useUtils();
  const queryClient = useQueryClient();
  const block = trpc.safety.block.useMutation({
    onSuccess: async () => {
      setBlockOpen(false);
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
      toast.success(`${name} blocked`, {
        description: "You can unblock them from Profile.",
      });
    },
  });

  const isSelf = session?.user.id === userId;

  const dialogs = isSelf ? null : (
    <>
      <Dialog
        isOpen={blockOpen}
        onOpenChange={(open) => {
          if (!block.isPending) setBlockOpen(open);
        }}
      >
        <Dialog.Portal hostName={portalHost}>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>Block {name}?</Dialog.Title>
            <Dialog.Description>
              They won’t be able to send you whisps or friend requests, and you
              won’t see each other’s messages in shared groups. This also
              removes your friendship. Unblocking later won’t restore it.
            </Dialog.Description>
            {block.error && (
              <Text accessibilityRole="alert" className="text-danger pt-2">
                Couldn’t block {name}. {block.error.message}
              </Text>
            )}
            <View className="flex-row justify-end gap-3 pt-4">
              <Button
                variant="ghost"
                size="sm"
                isDisabled={block.isPending}
                onPress={() => setBlockOpen(false)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                isDisabled={block.isPending}
                onPress={() => block.mutate({ userId })}
              >
                {block.isPending ? "Blocking…" : "Block"}
              </Button>
            </View>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog>
      <ReportModal
        userId={userId}
        name={name}
        open={reportOpen}
        onClose={() => setReportOpen(false)}
      />
    </>
  );

  return {
    isSelf,
    isBlocking: block.isPending,
    openReport: () => setReportOpen(true),
    openBlock: () => {
      block.reset();
      setBlockOpen(true);
    },
    dialogs,
  };
}

// Compact "more" button for rows and cards.
export function SafetyMenu({
  iconColor,
  ...target
}: SafetyTarget & { iconColor?: string }) {
  const actions = useSafetyActions(target);
  const [mutedColor, dangerColor] = useThemeColor(["muted", "danger"]);
  if (actions.isSelf) return null;
  return (
    <>
      <Menu>
        <Menu.Trigger
          ph-no-capture
          accessibilityLabel={`More options for ${target.name}`}
          isDisabled={actions.isBlocking}
          hitSlop={8}
          className="size-9 items-center justify-center rounded-full active:opacity-70"
        >
          <Ionicons
            name="ellipsis-horizontal"
            size={20}
            color={iconColor ?? mutedColor}
          />
        </Menu.Trigger>
        <Menu.Portal hostName={target.portalHost}>
          <Menu.Overlay />
          <Menu.Content
            presentation="popover"
            placement="bottom"
            align="end"
            width={180}
          >
            <Menu.Item onPress={actions.openReport}>
              <Ionicons name="flag-outline" size={18} color={mutedColor} />
              <Menu.ItemTitle>Report</Menu.ItemTitle>
            </Menu.Item>
            <Menu.Item variant="danger" onPress={actions.openBlock}>
              <Ionicons name="ban" size={18} color={dangerColor} />
              <Menu.ItemTitle>Block</Menu.ItemTitle>
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
      {actions.dialogs}
    </>
  );
}

function ReportModal({
  userId,
  name,
  open,
  onClose,
}: {
  userId: string;
  name: string;
  open: boolean;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState("");
  const [foregroundColor, mutedColor, successColor] = useThemeColor([
    "foreground",
    "muted",
    "success",
  ]);
  const report = trpc.safety.report.useMutation();

  function close() {
    if (report.isPending) return;
    onClose();
    setReason(null);
    setDetails("");
    report.reset();
  }

  return (
    <Modal
      visible={open}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={close}
    >
      <SafeAreaView ph-no-capture className="flex-1 bg-background">
        <View className="flex-row items-center gap-2 px-4 py-3">
          <Pressable
            onPress={close}
            disabled={report.isPending}
            className="size-10 items-center justify-center rounded-full active:opacity-70"
            accessibilityRole="button"
            accessibilityLabel="Close"
          >
            <Ionicons name="close" size={24} color={foregroundColor} />
          </Pressable>
          <Text className="flex-1 text-lg font-semibold">Report</Text>
        </View>

        {report.isSuccess ? (
          <View className="flex-1 items-center justify-center gap-3 px-8">
            <Ionicons name="checkmark-circle" size={56} color={successColor} />
            <Text
              accessibilityRole="header"
              className="text-center text-xl font-semibold"
            >
              Thanks for letting us know
            </Text>
            <Text className="text-center text-muted">
              The whisp team will review your report. {name} won’t see it.
            </Text>
            <Button className="mt-4 self-stretch" onPress={close}>
              Done
            </Button>
          </View>
        ) : (
          <KeyboardAvoidingView
            className="flex-1"
            behavior={Platform.OS === "ios" ? "padding" : undefined}
          >
            <ScrollView
              className="flex-1"
              contentContainerClassName="gap-6 px-4 pb-4"
              keyboardShouldPersistTaps="handled"
            >
              <View className="gap-1 px-1">
                <Text
                  accessibilityRole="header"
                  className="text-2xl font-semibold"
                >
                  Why are you reporting {name}?
                </Text>
                <Text className="text-sm text-muted">
                  Only the whisp team sees reports. Photos and videos aren’t
                  attached or saved.
                </Text>
              </View>

              <View
                accessibilityRole="radiogroup"
                className="bg-surface rounded-xl"
              >
                {reasons.map((item, index) => {
                  const selected = reason === item.value;
                  return (
                    <View key={item.value}>
                      <Pressable
                        accessibilityRole="radio"
                        accessibilityState={{ checked: selected }}
                        disabled={report.isPending}
                        onPress={() => setReason(item.value)}
                        className="active:bg-default flex-row items-center gap-3 px-4 py-3.5"
                      >
                        <Text className="flex-1 text-base">{item.label}</Text>
                        <Ionicons
                          name={
                            selected ? "radio-button-on" : "radio-button-off"
                          }
                          size={22}
                          color={selected ? foregroundColor : mutedColor}
                        />
                      </Pressable>
                      {index < reasons.length - 1 && (
                        <View className="bg-separator mx-4 h-px" />
                      )}
                    </View>
                  );
                })}
              </View>

              <View className="gap-2">
                <Text className="px-1 text-xs font-medium uppercase tracking-wide text-muted">
                  Details (optional)
                </Text>
                <Input
                  accessibilityLabel="Report details"
                  multiline
                  textAlignVertical="top"
                  className="min-h-28"
                  maxLength={2000}
                  value={details}
                  onChangeText={setDetails}
                  editable={!report.isPending}
                  placeholder="What happened? Don’t include passwords or sensitive images."
                />
              </View>
            </ScrollView>

            <View className="gap-2 px-4 pb-4 pt-2">
              {report.error && (
                <Text accessibilityRole="alert" className="text-danger text-sm">
                  {report.error.message}
                </Text>
              )}
              <Button
                isDisabled={!reason || report.isPending}
                onPress={() => {
                  if (reason) report.mutate({ userId, reason, details });
                }}
              >
                {report.isPending ? "Sending…" : "Submit report"}
              </Button>
            </View>
          </KeyboardAvoidingView>
        )}
      </SafeAreaView>
    </Modal>
  );
}
