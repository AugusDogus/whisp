import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Image } from "expo-image";

import { authClient } from "~/utils/auth";
import { getBaseUrl } from "~/utils/base-url";

function AnimatedNameplate({
  userId,
  staticUrl,
}: {
  userId: string;
  staticUrl: string;
}) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  const cookie = authClient.getCookie();
  const uri = `${getBaseUrl()}/api/discord-profile/${encodeURIComponent(userId)}/nameplate?asset=${encodeURIComponent(staticUrl)}`;
  return (
    <>
      <Image
        source={{ uri: staticUrl }}
        style={[
          StyleSheet.absoluteFill,
          { opacity: status === "loaded" ? 0 : 1 },
        ]}
        contentFit="contain"
        accessibilityLabel="Discord nameplate"
      />
      {status !== "failed" && (
        <Image
          source={{ uri, headers: cookie ? { Cookie: cookie } : undefined }}
          style={[
            StyleSheet.absoluteFill,
            { opacity: status === "loaded" ? 1 : 0 },
          ]}
          contentFit="contain"
          autoplay
          useAppleWebpCodec={false}
          onLoad={() => setStatus("loaded")}
          onError={() => setStatus("failed")}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      )}
    </>
  );
}

export function DiscordNameplate({
  userId,
  staticUrl,
  animate,
}: {
  userId: string;
  staticUrl: string;
  animate: boolean;
}) {
  return (
    <View style={{ width: "45%", aspectRatio: 16 / 3 }}>
      {animate ? (
        <AnimatedNameplate
          key={staticUrl}
          userId={userId}
          staticUrl={staticUrl}
        />
      ) : (
        <Image
          source={{ uri: staticUrl }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          accessibilityLabel="Discord nameplate"
        />
      )}
    </View>
  );
}
