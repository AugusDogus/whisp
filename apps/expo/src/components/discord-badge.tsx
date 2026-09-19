import { View } from "react-native";

import { Image } from "expo-image";

import ActiveDeveloper from "../../assets/discord-badges/active-developer.svg";
import BugHunterLevel1 from "../../assets/discord-badges/bug-hunter-level-1.svg";
import BugHunterLevel2 from "../../assets/discord-badges/bug-hunter-level-2.svg";
import DiscordPartner from "../../assets/discord-badges/discord-partner.svg";
import DiscordStaff from "../../assets/discord-badges/discord-staff.svg";
import EarlyNitroSupporter from "../../assets/discord-badges/early-nitro-supporter.svg";
import EarlyVerifiedBotDeveloper from "../../assets/discord-badges/early-verified-bot-developer.svg";
import HypeSquadBalance from "../../assets/discord-badges/hypesquad-balance.svg";
import HypeSquadBravery from "../../assets/discord-badges/hypesquad-bravery.svg";
import HypeSquadBrilliance from "../../assets/discord-badges/hypesquad-brilliance.svg";
import HypeSquadEvents from "../../assets/discord-badges/hypesquad-events.svg";
import ModeratorProgramsAlumni from "../../assets/discord-badges/moderator-programs-alumni.svg";
import { Text } from "./ui/text";

const artwork = new Map<string, number>([
  ["Discord Staff", DiscordStaff],
  ["Partnered Server Owner", DiscordPartner],
  ["HypeSquad Events", HypeSquadEvents],
  ["Bug Hunter Level 1", BugHunterLevel1],
  ["HypeSquad Bravery", HypeSquadBravery],
  ["HypeSquad Brilliance", HypeSquadBrilliance],
  ["HypeSquad Balance", HypeSquadBalance],
  ["Early Nitro Supporter", EarlyNitroSupporter],
  ["Bug Hunter Level 2", BugHunterLevel2],
  ["Early Verified Bot Developer", EarlyVerifiedBotDeveloper],
  ["Moderator Programs Alumni", ModeratorProgramsAlumni],
  ["Active Developer", ActiveDeveloper],
]);

export function DiscordBadge({ label }: { label: string }) {
  const source = artwork.get(label);
  if (source === undefined) {
    return (
      <View className="bg-default rounded-lg px-2 py-1">
        <Text className="text-xs">{label}</Text>
      </View>
    );
  }

  return (
    <Image
      source={source}
      style={{ width: 24, height: 24 }}
      contentFit="contain"
      accessibilityLabel={label}
      accessibilityRole="image"
    />
  );
}
