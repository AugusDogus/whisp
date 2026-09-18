-- Apply to the target database before deploying the Discord profile changes.
-- Existing users are populated by the profile refresh path when first viewed.
BEGIN;
ALTER TABLE "user" ADD COLUMN "discordBannerUrl" text;
ALTER TABLE "user" ADD COLUMN "discordAccentColor" integer;
ALTER TABLE "user" ADD COLUMN "discordAvatarDecorationUrl" text;
ALTER TABLE "user" ADD COLUMN "discordGuildTag" text;
ALTER TABLE "user" ADD COLUMN "discordGuildBadgeUrl" text;
ALTER TABLE "user" ADD COLUMN "discordNameplateUrl" text;
ALTER TABLE "user" ADD COLUMN "discordPublicFlags" integer;
ALTER TABLE "user" ADD COLUMN "discordProfileSyncedAt" integer;
ALTER TABLE "user" ADD COLUMN "discordProfileRevision" text;
COMMIT;
