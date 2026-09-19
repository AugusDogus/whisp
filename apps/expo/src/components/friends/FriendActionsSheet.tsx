import type { FriendRow } from "./types";
import type {
  BottomSheetBackdropProps,
  BottomSheetModal,
} from "@gorhom/bottom-sheet";

import type { MutableRefObject, ReactElement } from "react";
import { useRef, useState } from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Ionicons, MaterialIcons } from "@expo/vector-icons";
import {
  BottomSheetScrollView,
  BottomSheetModal as GorhomBottomSheetModal,
} from "@gorhom/bottom-sheet";
import { useIsFocused } from "@react-navigation/native";
import { useThemeColor } from "heroui-native/hooks";

import { DiscordProfileCard } from "~/components/discord-profile-card";
import { Text } from "~/components/ui/text";

export function FriendActionsSheet({
  bottomSheetRef,
  renderBackdrop,
  selectedFriend,
  isShowingDialogRef,
  clearSelectedFriend,
  onSendWhisp,
  onViewDiscordProfile,
  onRemoveFriend,
}: {
  bottomSheetRef: MutableRefObject<BottomSheetModal | null>;
  renderBackdrop: (props: BottomSheetBackdropProps) => ReactElement;
  selectedFriend: FriendRow | null;
  isShowingDialogRef: MutableRefObject<boolean>;
  clearSelectedFriend: () => void;
  onSendWhisp: (friend: FriendRow) => void;
  onViewDiscordProfile: (discordId: string) => void;
  onRemoveFriend: () => void;
}) {
  // This component is inside navigation; the modal's portaled children are not.
  const isFocused = useIsFocused();
  const [surfaceColor, iconColor, dangerColor] = useThemeColor([
    "surface",
    "muted",
    "danger",
  ]);
  const discordId = selectedFriend?.discordId;
  const [isOpen, setIsOpen] = useState(false);
  const [profileVisible, setProfileVisible] = useState(true);
  const profileHeight = useRef(0);
  const insets = useSafeAreaInsets();

  return (
    <GorhomBottomSheetModal
      ref={bottomSheetRef}
      // A first Discord sync can add badges and a guild tag after opening.
      // Keep the sheet still while its scrollable content updates.
      enableDynamicSizing={false}
      snapPoints={["80%"]}
      topInset={insets.top}
      enablePanDownToClose
      enableDismissOnClose
      backdropComponent={renderBackdrop}
      handleComponent={null}
      style={{
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        overflow: "hidden",
      }}
      onChange={(index) => setIsOpen(index >= 0)}
      onDismiss={() => {
        setIsOpen(false);
        setProfileVisible(true);
        if (!isShowingDialogRef.current) {
          clearSelectedFriend();
        }
      }}
      backgroundStyle={{
        backgroundColor: surfaceColor,
      }}
    >
      <BottomSheetScrollView
        contentContainerStyle={{
          gap: 8,
          paddingBottom: Math.max(32, insets.bottom + 16),
        }}
        scrollEventThrottle={100}
        onScroll={({
          nativeEvent,
        }: NativeSyntheticEvent<NativeScrollEvent>) => {
          setProfileVisible(
            nativeEvent.contentOffset.y < profileHeight.current,
          );
        }}
      >
        <View
          onLayout={({ nativeEvent }) => {
            profileHeight.current = nativeEvent.layout.height;
          }}
        >
          {selectedFriend && (
            <DiscordProfileCard
              key={selectedFriend.id}
              userId={selectedFriend.id}
              name={selectedFriend.name}
              image={selectedFriend.image}
              active={isFocused && isOpen && profileVisible}
              variant="sheet"
            />
          )}
        </View>

        <View className="gap-2 px-4">
          <Pressable
            className="active:bg-default flex-row items-center gap-3 rounded-lg px-3 py-3"
            onPress={() => {
              if (selectedFriend) {
                onSendWhisp(selectedFriend);
                bottomSheetRef.current?.close();
              }
            }}
          >
            <Ionicons name="camera" size={22} color={iconColor} />
            <Text className="text-base">Send whisp</Text>
          </Pressable>

          {discordId && (
            <Pressable
              className="active:bg-default flex-row items-center gap-3 rounded-lg px-3 py-3"
              onPress={() => {
                onViewDiscordProfile(discordId);
                bottomSheetRef.current?.close();
              }}
            >
              <MaterialIcons name="discord" size={22} color={iconColor} />
              <Text className="text-base">View Discord Profile</Text>
            </Pressable>
          )}

          <Pressable
            className="active:bg-default flex-row items-center gap-3 rounded-lg px-3 py-3"
            onPress={() => {
              isShowingDialogRef.current = true;
              onRemoveFriend();
              bottomSheetRef.current?.close();
            }}
          >
            <Ionicons name="person-remove" size={22} color={dangerColor} />
            <Text className="text-danger text-base">Remove Friend</Text>
          </Pressable>
        </View>
      </BottomSheetScrollView>
    </GorhomBottomSheetModal>
  );
}
