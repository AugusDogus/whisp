import { DiscordProfile as DiscordProfileData } from "@acme/auth/discord-profile";
import { and, eq, isNull } from "@acme/db";
import type { db } from "@acme/db/client";
import { account, user as User } from "@acme/db/schema";

import { DISCORD_PROVIDER_ID } from "../constants";
import { checkIsFriend } from "./friendship";

const publicBadges = [
  { flag: 1 << 0, label: "Discord Staff" },
  { flag: 1 << 1, label: "Partnered Server Owner" },
  { flag: 1 << 2, label: "HypeSquad Events" },
  { flag: 1 << 3, label: "Bug Hunter Level 1" },
  { flag: 1 << 6, label: "HypeSquad Bravery" },
  { flag: 1 << 7, label: "HypeSquad Brilliance" },
  { flag: 1 << 8, label: "HypeSquad Balance" },
  { flag: 1 << 9, label: "Early Nitro Supporter" },
  { flag: 1 << 14, label: "Bug Hunter Level 2" },
  { flag: 1 << 16, label: "Verified Bot" },
  { flag: 1 << 17, label: "Early Verified Bot Developer" },
  { flag: 1 << 18, label: "Moderator Programs Alumni" },
  { flag: 1 << 22, label: "Active Developer" },
];

type ProfileResult =
  | { success: true; profile: SavedProfile; needsRefresh: boolean }
  | {
      success: false;
      code: "FORBIDDEN" | "NOT_FOUND" | "BAD_GATEWAY";
      error: string;
    };

const storedProfileColumns = {
  name: User.name,
  discordUsername: User.discordUsername,
  image: User.image,
  discordBannerUrl: User.discordBannerUrl,
  discordAccentColor: User.discordAccentColor,
  discordAvatarDecorationUrl: User.discordAvatarDecorationUrl,
  discordGuildTag: User.discordGuildTag,
  discordGuildBadgeUrl: User.discordGuildBadgeUrl,
  discordNameplateUrl: User.discordNameplateUrl,
  discordPublicFlags: User.discordPublicFlags,
  discordProfileSyncedAt: User.discordProfileSyncedAt,
};

type StoredProfile = Pick<
  typeof User.$inferSelect,
  keyof typeof storedProfileColumns
>;
type SavedProfile = ReturnType<typeof toSavedProfile>;

function toSavedProfile(row: StoredProfile) {
  return {
    name: row.name,
    username: row.discordUsername,
    avatarUrl: row.image,
    cosmetics:
      row.discordProfileSyncedAt === null
        ? null
        : {
            bannerUrl: row.discordBannerUrl,
            accentColor:
              row.discordAccentColor === null
                ? null
                : `#${row.discordAccentColor.toString(16).padStart(6, "0")}`,
            decorationUrl: row.discordAvatarDecorationUrl,
            guildTag:
              row.discordGuildTag === null
                ? null
                : {
                    tag: row.discordGuildTag,
                    badgeUrl: row.discordGuildBadgeUrl,
                  },
            nameplateUrl: row.discordNameplateUrl,
            badges: publicBadges
              .filter(
                ({ flag }) => ((row.discordPublicFlags ?? 0) & flag) !== 0,
              )
              .map(({ label }) => label),
            lastSyncedAt: row.discordProfileSyncedAt.getTime(),
          },
  };
}

const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

function fromStored(row: StoredProfile) {
  const profile = toSavedProfile(row);
  return {
    profile,
    needsRefresh:
      profile.cosmetics === null ||
      Date.now() - profile.cosmetics.lastSyncedAt >= REFRESH_INTERVAL_MS,
  };
}

async function read(
  dbClient: typeof db,
  viewerId: string,
  userId: string,
): Promise<ProfileResult> {
  if (
    viewerId !== userId &&
    !(await checkIsFriend(dbClient, viewerId, userId))
  ) {
    return {
      success: false,
      code: "FORBIDDEN",
      error: "You can only view Discord details for yourself and your friends.",
    };
  }

  const [row] = await dbClient
    .select(storedProfileColumns)
    .from(User)
    .where(eq(User.id, userId))
    .limit(1);

  if (!row) {
    return {
      success: false,
      code: "NOT_FOUND",
      error: "This Whisp profile no longer exists.",
    };
  }

  return {
    success: true,
    ...fromStored(row),
  };
}

async function refresh(
  dbClient: typeof db,
  viewerId: string,
  userId: string,
  fetchUser: (discordId: string) => Promise<unknown>,
  mode: "force" | "if-stale" = "force",
): Promise<ProfileResult> {
  const saved = await read(dbClient, viewerId, userId);
  if (!saved.success) return saved;
  if (mode === "if-stale" && !saved.needsRefresh) return saved;

  const [linkedAccount] = await dbClient
    .select({
      discordId: account.accountId,
      revision: User.discordProfileRevision,
    })
    .from(account)
    .innerJoin(User, eq(User.id, account.userId))
    .where(
      and(
        eq(account.userId, userId),
        eq(account.providerId, DISCORD_PROVIDER_ID),
      ),
    )
    .limit(1);

  if (!linkedAccount) {
    return {
      success: false,
      code: "NOT_FOUND",
      error: "This profile has no linked Discord account.",
    };
  }

  let response: unknown;
  try {
    response = await fetchUser(linkedAccount.discordId);
  } catch {
    return {
      success: false,
      code: "BAD_GATEWAY",
      error:
        "Discord profile details could not be loaded. Your Whisp profile is unchanged. Try again shortly.",
    };
  }

  const parsed = DiscordProfileData.parse(response);
  if (!parsed.success || parsed.data.id !== linkedAccount.discordId) {
    return {
      success: false,
      code: "BAD_GATEWAY",
      error:
        "Discord returned unexpected profile data. Your Whisp profile is unchanged. Try again later.",
    };
  }
  const profile = parsed.data;

  // One write keeps the avatar and cosmetics from the same successful fetch together.
  const [updated] = await dbClient
    .update(User)
    .set({
      ...DiscordProfileData.toUserFields(profile),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(User.id, userId),
        linkedAccount.revision === null
          ? isNull(User.discordProfileRevision)
          : eq(User.discordProfileRevision, linkedAccount.revision),
      ),
    )
    .returning(storedProfileColumns);

  if (!updated) {
    // A newer refresh or sign-in won the write. Return its saved profile.
    return read(dbClient, viewerId, userId);
  }

  return {
    success: true,
    needsRefresh: false,
    profile: toSavedProfile(updated),
  };
}

export const DiscordProfile = {
  storedColumns: storedProfileColumns,
  fromStored,
  parse: DiscordProfileData.parse,
  read,
  refresh,
} as const;
