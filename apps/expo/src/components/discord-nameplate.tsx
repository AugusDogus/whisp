import { useState } from "react";
import { StyleSheet, View } from "react-native";

import { Image } from "expo-image";

function AnimatedNameplate({ staticUrl }: { staticUrl: string }) {
  const [status, setStatus] = useState<"loading" | "loaded" | "failed">(
    "loading",
  );
  // Saved URLs use static.png. Discord also serves the animation as APNG.
  const uri = staticUrl.replace(/\/static\.png$/, "/img.png?passthrough=true");
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
          source={{ uri }}
          style={[
            StyleSheet.absoluteFill,
            { opacity: status === "loaded" ? 1 : 0 },
          ]}
          contentFit="contain"
          autoplay
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
  staticUrl,
  animate,
}: {
  staticUrl: string;
  animate: boolean;
}) {
  return (
    <View style={{ width: "45%", aspectRatio: 16 / 3 }}>
      {animate ? (
        <AnimatedNameplate key={staticUrl} staticUrl={staticUrl} />
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
