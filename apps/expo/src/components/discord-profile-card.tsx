import { View } from "react-native";

import { Image } from "expo-image";

import { useCosmeticMotion } from "~/hooks/useCosmeticMotion";
import { useDiscordProfile } from "~/hooks/useDiscordProfile";
import { cn } from "~/lib/utils";

import { DiscordNameplate } from "./discord-nameplate";
import { Avatar } from "./ui/avatar";
import { Text } from "./ui/text";

interface DiscordProfileCardProps {
  userId: string;
  name: string;
  image: string | null;
  active: boolean;
  variant?: "card" | "sheet";
}

export function DiscordProfileCard({
  userId,
  name,
  image,
  active,
  variant = "card",
}: DiscordProfileCardProps) {
  const { profile } = useDiscordProfile(userId, active);
  const savedProfile = profile.data?.profile;
  const cosmetics = savedProfile?.cosmetics;
  const animate = useCosmeticMotion(active);
  const avatarUrl = savedProfile?.avatarUrl ?? image;
  const displayName = savedProfile?.name ?? name;

  return (
    <View
      className={cn(
        "bg-surface overflow-hidden",
        variant === "card" && "rounded-2xl",
      )}
    >
      <View
        className="bg-default"
        style={{
          aspectRatio: 20 / 7,
          backgroundColor: cosmetics?.accentColor ?? undefined,
        }}
      >
        {cosmetics?.bannerUrl && (
          <Image
            key={`banner-${animate}`}
            source={{ uri: cosmetics.bannerUrl }}
            style={{ width: "100%", height: "100%" }}
            contentFit="cover"
            autoplay={animate}
            accessibilityLabel={`${displayName}'s Discord banner`}
          />
        )}
        {variant === "sheet" && (
          <View
            pointerEvents="none"
            className="absolute top-2 h-1 w-12 self-center rounded-full bg-foreground/60"
          />
        )}
      </View>

      <View className="gap-3 px-4 pb-4">
        <View className="bg-surface -mt-10 size-24 items-center justify-center self-start rounded-full p-1">
          {/* A new visit or source resets the shared avatar's bounded recovery. */}
          <Avatar
            key={`${avatarUrl}:${active}`}
            userId={userId}
            image={avatarUrl}
            name={displayName}
            size={88}
            active={active}
            autoplay={animate}
          />
          {cosmetics?.decorationUrl && (
            <Image
              key={`decoration-${animate}`}
              source={{ uri: cosmetics.decorationUrl }}
              style={{ position: "absolute", width: 112, height: 112 }}
              contentFit="contain"
              autoplay={animate}
              pointerEvents="none"
              accessibilityLabel="Discord avatar decoration"
            />
          )}
        </View>

        <View className="min-h-16 flex-row items-center gap-3">
          <View className="flex-1 gap-1">
            <Text className="text-2xl font-bold">{displayName}</Text>
            {savedProfile?.username && (
              <Text className="text-sm text-muted">
                @{savedProfile.username}
              </Text>
            )}
          </View>
          {cosmetics?.nameplateUrl && (
            <DiscordNameplate
              staticUrl={cosmetics.nameplateUrl}
              animate={animate}
            />
          )}
        </View>

        {cosmetics?.guildTag && (
          <View
            className="bg-default flex-row items-center gap-1.5 self-start rounded-lg px-2 py-1"
            accessible
            accessibilityLabel={`Discord server tag: ${cosmetics.guildTag.tag}`}
          >
            {cosmetics.guildTag.badgeUrl && (
              <Image
                source={{ uri: cosmetics.guildTag.badgeUrl }}
                style={{ width: 20, height: 20 }}
              />
            )}
            <Text className="text-sm font-semibold">
              {cosmetics.guildTag.tag}
            </Text>
          </View>
        )}

        {cosmetics && cosmetics.badges.length > 0 && (
          <View className="flex-row flex-wrap gap-1.5">
            {cosmetics.badges.map((badge) => (
              <View key={badge} className="bg-default rounded-lg px-2 py-1">
                <Text className="text-xs">{badge}</Text>
              </View>
            ))}
          </View>
        )}

        {profile.isLoading && (
          <View accessibilityLabel="Loading Discord profile" className="gap-2">
            <View className="bg-default h-3 w-24 rounded" />
            <View className="bg-default h-5 w-40 rounded" />
          </View>
        )}
      </View>
    </View>
  );
}
