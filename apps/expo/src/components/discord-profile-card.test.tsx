import { act, create } from "react-test-renderer";
import type { ReactTestRenderer } from "react-test-renderer";

import { afterEach, beforeEach, expect, test } from "bun:test";

import { createProfileFixture, settle } from "../test/discord-profile";
import { images, native } from "../test/setup";

const { Portal, PortalProvider } = await import("@gorhom/portal");
const { BaseNavigationContainer } = await import("@react-navigation/native");
const { DiscordProfileCard } = await import("./discord-profile-card");

let fixture: ReturnType<typeof createProfileFixture>;
let renderer: ReactTestRenderer | undefined;
beforeEach(() => {
  fixture = createProfileFixture();
  fixture.state.stored.needsRefresh = false;
  native.preference.resolve(false);
});
afterEach(async () => {
  await act(async () => renderer?.unmount());
  renderer = undefined;
  fixture.queryClient.clear();
  expect(images.size).toBe(0);
});

async function show(active: boolean, portal = false) {
  const card = (
    <DiscordProfileCard
      userId="me"
      name="Me"
      image="saved.png"
      active={active}
      variant={portal ? "sheet" : "card"}
    />
  );
  // Match App.tsx: the portal provider/host is outside the navigation container.
  const tree = (
    <fixture.Provider>
      <PortalProvider>
        <BaseNavigationContainer>
          {portal ? <Portal>{card}</Portal> : card}
        </BaseNavigationContainer>
      </PortalProvider>
    </fixture.Provider>
  );
  await act(async () => {
    if (renderer) renderer.update(tree);
    else renderer = create(tree);
  });
  await settle();
}
function avatar() {
  return [...images].find(
    (image) => image.accessibilityLabel === "Me's avatar",
  );
}
async function failAvatar() {
  const image = avatar();
  if (!image?.onError)
    throw new Error("Expected a rendered avatar with an error handler");
  await act(async () =>
    image.onError?.({ error: "Temporary network failure" }),
  );
  await settle();
}

test("friend cards render outside navigation context and follow the caller's active state", async () => {
  await show(true, true);
  expect(avatar()?.autoplay).toBe(true);
  await show(false, true);
  expect(avatar()?.autoplay).toBe(false);
});

test("a retained profile retries the same avatar URL on the next visit after a failure", async () => {
  await show(true);
  expect(avatar()).toBeDefined();
  await failAvatar();
  expect(avatar()).toBeUndefined();
  await show(false);
  await show(true);
  expect(avatar()?.source).toEqual({ uri: "saved.png" });
});

test("avatar recovery forces one refresh per visit and does not loop on a broken URL", async () => {
  fixture.state.unavailable = false;
  await show(true);
  await failAvatar();
  expect(fixture.state.requests).toEqual([{ userId: "me", mode: "force" }]);
  expect(avatar()?.source).toEqual({ uri: "saved.png" });
  await failAvatar();
  expect(avatar()).toBeUndefined();
  expect(fixture.state.requests).toHaveLength(1);
});

test("an inactive card does not refresh a failed avatar", async () => {
  await show(false);
  await failAvatar();
  expect(fixture.state.requests).toHaveLength(0);
  await show(true);
  expect(avatar()).toBeDefined();
});
