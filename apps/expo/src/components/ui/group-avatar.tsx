import { View } from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";

import { Text } from "./text";

interface MemberAvatar {
  userId: string;
  image: string | null;
}

interface GroupAvatarProps {
  members: MemberAvatar[];
  size?: number;
}

const PLACEHOLDER: MemberAvatar = { userId: "?", image: null };

function at(members: MemberAvatar[], i: number): MemberAvatar {
  return members[i] ?? PLACEHOLDER;
}

function getInitial(userId: string) {
  return userId.charAt(0).toUpperCase() || "?";
}

function MiniCircle({
  member,
  diameter,
}: {
  member: MemberAvatar;
  diameter: number;
}) {
  if (member.image) {
    return (
      <View
        className="overflow-hidden rounded-full bg-secondary"
        style={{ width: diameter, height: diameter }}
      >
        <Image
          source={{ uri: member.image }}
          style={{ width: diameter, height: diameter }}
          contentFit="cover"
        />
      </View>
    );
  }

  return (
    <View
      className="items-center justify-center rounded-full bg-secondary"
      style={{ width: diameter, height: diameter }}
    >
      <Text className="font-semibold" style={{ fontSize: diameter * 0.4 }}>
        {getInitial(member.userId)}
      </Text>
    </View>
  );
}

export function GroupAvatar({ members, size = 44 }: GroupAvatarProps) {
  if (members.length === 0) {
    return (
      <View
        className="items-center justify-center rounded-full bg-muted"
        style={{ width: size, height: size }}
      >
        <Ionicons name="people" size={size * 0.5} color="#999" />
      </View>
    );
  }

  const firstMember = members[0];
  if (members.length === 1 && firstMember) {
    return <MiniCircle member={firstMember} diameter={size} />;
  }

  if (members.length === 2) {
    const d = size * 0.65;
    const overlap = size * 0.22;
    return (
      <View
        style={{
          width: size,
          height: size,
          justifyContent: "center",
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <MiniCircle member={at(members, 0)} diameter={d} />
          <View style={{ marginLeft: -overlap }}>
            <MiniCircle member={at(members, 1)} diameter={d} />
          </View>
        </View>
      </View>
    );
  }

  const spacing = 0.16;

  if (members.length === 3) {
    const d = size * 0.5;
    return (
      <View
        style={{
          width: size,
          height: size,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <MiniCircle member={at(members, 0)} diameter={d} />
        <View
          style={{
            flexDirection: "row",
            gap: -d * spacing,
            marginTop: -d * spacing,
          }}
        >
          <MiniCircle member={at(members, 1)} diameter={d} />
          <MiniCircle member={at(members, 2)} diameter={d} />
        </View>
      </View>
    );
  }

  const d = size * 0.48;
  const gap = -d * 0.04;
  return (
    <View
      style={{
        width: size,
        height: size,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View style={{ flexDirection: "row", gap, marginBottom: gap }}>
        <MiniCircle member={at(members, 0)} diameter={d} />
        <MiniCircle member={at(members, 1)} diameter={d} />
      </View>
      <View style={{ flexDirection: "row", gap }}>
        <MiniCircle member={at(members, 2)} diameter={d} />
        <MiniCircle member={at(members, 3)} diameter={d} />
      </View>
    </View>
  );
}
