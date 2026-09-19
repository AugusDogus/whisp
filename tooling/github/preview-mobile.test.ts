import { expect, test } from "bun:test";

import { MobilePreview } from "./preview-mobile";

const androidBuild = "11111111-1111-4111-8111-111111111111";
const iosBuild = "22222222-2222-4222-8222-222222222222";
const group = "33333333-3333-4333-8333-333333333333";
const context = {
  backend: "https://whisp-pr-17.vercel.app",
  commit: "a".repeat(40),
};
const run = {
  status: "SUCCESS",
  url: "https://expo.dev/accounts/augusdogus/projects/whisp/workflows/run-17",
  jobs: [
    {
      key: "android_existing",
      status: "SUCCESS",
      outputs: { build_id: androidBuild },
    },
    { key: "android_build", status: "SKIPPED", outputs: null },
    { key: "ios_existing", status: "SUCCESS", outputs: {} },
    { key: "ios_build", status: "SUCCESS", outputs: { build_id: iosBuild } },
    {
      key: "update",
      status: "SUCCESS",
      outputs: {
        updates_json: JSON.stringify([
          { platform: "android", group },
          { platform: "ios", group },
        ]),
      },
    },
  ],
};

test("comments link reused and new builds and open the PR update in Whisp Preview", () => {
  const comment = MobilePreview.comment(run, context);
  expect(comment).toContain(`/builds/${androidBuild}`);
  expect(comment).toContain(`/builds/${iosBuild}`);
  expect(comment).toContain(`groupId=${group}`);
  expect(comment).toContain("appScheme=whisp-preview");
  expect(comment).toContain(context.backend);
  expect(comment).toContain(context.commit.slice(0, 7));
});

test("failed updates do not advertise usable QR previews", () => {
  const comment = MobilePreview.comment(
    {
      ...run,
      status: "FAILURE",
      jobs: run.jobs.map((job) =>
        job.key === "update" ? { ...job, status: "FAILURE" } : job,
      ),
    },
    context,
  );
  expect(comment).toContain("failed");
  expect(comment).toContain(run.url);
  expect(comment).not.toContain("qr.expo.dev");
});

test("an iOS build failure preserves the working Android preview", () => {
  const comment = MobilePreview.comment(
    {
      ...run,
      status: "FAILURE",
      jobs: run.jobs.map((job) =>
        job.key === "ios_build" ? { ...job, status: "FAILURE" } : job,
      ),
    },
    context,
  );
  expect(comment).toContain(`/builds/${androidBuild}`);
  expect(comment).not.toContain(`/builds/${iosBuild}`);
  expect(comment).toContain("| iOS | Unavailable |");
  expect(comment.match(/appScheme=whisp-preview/g)).toHaveLength(2);
  expect(comment).toContain("failed");
});

test("successful runs must contain a build and update for both platforms", () => {
  expect(() => MobilePreview.comment({ ...run, jobs: [] }, context)).toThrow();
});

test("rejects non-Expo workflow links and malformed build IDs", () => {
  expect(() =>
    MobilePreview.comment({ ...run, url: "https://example.com" }, context),
  ).toThrow();
  expect(() =>
    MobilePreview.comment(
      {
        ...run,
        jobs: [
          {
            key: "android_existing",
            status: "SUCCESS",
            outputs: { build_id: "bad-id" },
          },
          ...run.jobs.slice(1),
        ],
      },
      context,
    ),
  ).toThrow();
});
