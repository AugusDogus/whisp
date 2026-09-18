import { calculateUserDefaultAvatarIndex, CDN } from "@discordjs/rest";
import { z } from "zod/v4";

const cdn = new CDN();
const snowflake = z.string().regex(/^\d{1,20}$/);
const assetHash = z.string().regex(/^(a_)?[a-f0-9]{32}$/);

// Only consume public cosmetics from Discord's documented User object.
const discordUser = z.object({
  id: snowflake,
  username: z.string().min(1),
  discriminator: z.string().regex(/^\d{1,4}$/),
  global_name: z.string().nullish(),
  avatar: assetHash.nullable(),
  banner: assetHash.nullish(),
  accent_color: z.number().int().min(0).max(0xffffff).nullish(),
  public_flags: z.number().int().nonnegative().optional(),
  avatar_decoration_data: z.object({ asset: assetHash }).nullish(),
  primary_guild: z
    .object({
      identity_enabled: z.boolean().nullable(),
      identity_guild_id: snowflake.nullable(),
      tag: z.string().nullable(),
      badge: assetHash.nullable(),
    })
    .nullish(),
  collectibles: z
    .object({
      nameplate: z
        .object({
          asset: z.string().regex(/^nameplates\/(?:[a-zA-Z0-9_-]+\/)+$/),
        })
        .nullish(),
    })
    .nullish(),
});

const profileSchema = discordUser.transform((user) => {
  const guild = user.primary_guild;
  const nameplate = user.collectibles?.nameplate;
  const defaultIndex =
    user.discriminator === "0"
      ? calculateUserDefaultAvatarIndex(user.id)
      : Number(user.discriminator) % 5;

  return {
    id: user.id,
    name: user.global_name || user.username,
    username: user.username,
    avatarUrl: user.avatar
      ? cdn.avatar(user.id, user.avatar, { size: 256 })
      : cdn.defaultAvatar(defaultIndex),
    bannerUrl: user.banner
      ? cdn.banner(user.id, user.banner, { size: 1024 })
      : null,
    accentColor: user.accent_color ?? null,
    decorationUrl: user.avatar_decoration_data
      ? cdn.avatarDecoration(user.avatar_decoration_data.asset)
      : null,
    guildTag:
      guild?.identity_enabled && guild.identity_guild_id && guild.tag
        ? {
            tag: guild.tag,
            badgeUrl: guild.badge
              ? cdn.guildTagBadge(guild.identity_guild_id, guild.badge)
              : null,
          }
        : null,
    // Discord collectible assets use a static PNG and an optional WebM.
    nameplateUrl: nameplate
      ? `https://cdn.discordapp.com/assets/collectibles/${nameplate.asset}static.png`
      : null,
    publicFlags: user.public_flags ?? 0,
  };
});

export type DiscordProfile = z.output<typeof profileSchema>;

function toUserFields(profile: DiscordProfile) {
  return {
    image: profile.avatarUrl,
    discordUsername: profile.username,
    discordBannerUrl: profile.bannerUrl,
    discordAccentColor: profile.accentColor,
    discordAvatarDecorationUrl: profile.decorationUrl,
    discordGuildTag: profile.guildTag?.tag ?? null,
    discordGuildBadgeUrl: profile.guildTag?.badgeUrl ?? null,
    discordNameplateUrl: profile.nameplateUrl,
    discordPublicFlags: profile.publicFlags,
    discordProfileSyncedAt: new Date(),
    discordProfileRevision: crypto.randomUUID(),
  };
}

export const DiscordProfile = {
  parse: (input: unknown) => profileSchema.safeParse(input),
  toUserFields,
} as const;
