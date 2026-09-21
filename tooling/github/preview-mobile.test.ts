import { expect, test } from "bun:test";

import { MobilePreview } from "./preview-mobile";

const androidBuild = "11111111-1111-4111-8111-111111111111";
const iosBuild = "22222222-2222-4222-8222-222222222222";
const group = "33333333-3333-4333-8333-333333333333";
const buildDetails = {
  distribution: "internal",
  profile: "preview:dev",
  runtime_version: "b".repeat(40),
  app_version: "0.1.0",
  git_commit_hash: "a".repeat(40),
};
const updateDetails = {
  group,
  branch: "pr-17",
  runtimeVersion: buildDetails.runtime_version,
  gitCommitHash: "c".repeat(40),
};
const run = {
  status: "SUCCESS",
  url: "https://expo.dev/accounts/augusdogus/projects/whisp/workflows/run-17",
  jobs: [
    {
      key: "android_existing",
      status: "SUCCESS",
      outputs: { ...buildDetails, build_id: androidBuild },
    },
    { key: "android_build", status: "SKIPPED", outputs: null },
    { key: "ios_existing", status: "SUCCESS", outputs: {} },
    {
      key: "ios_build",
      status: "SUCCESS",
      outputs: { ...buildDetails, build_id: iosBuild },
    },
    {
      key: "update",
      status: "SUCCESS",
      outputs: {
        updates_json: JSON.stringify([
          { ...updateDetails, platform: "android" },
          { ...updateDetails, platform: "ios" },
        ]),
      },
    },
  ],
};

test("comments match Expo's template with reused and new build details and Whisp QR codes", () => {
  const comment = MobilePreview.comment(run);
  expect(comment).toStartWith(
    "<!-- whisp-mobile-preview -->\n🚀 Expo continuous deployment is ready!\n\n- Project → **whisp**\n- Platforms → **android**, **ios**\n- Scheme → **whisp-preview**\n",
  );
  expect(comment).toContain("&nbsp; | 🤖 Android | 🍎 iOS\n--- | --- | ---");
  expect(comment).toContain(
    `Fingerprint | ${buildDetails.runtime_version} | ${buildDetails.runtime_version}`,
  );
  expect(comment).toContain("Build Details | [Build Permalink]");
  expect(comment).toContain("Update Details | [Update Permalink]");
  expect(comment).toContain(
    `<details><summary>Details</summary>Distribution: \`internal\`<br />Build profile: \`preview:dev\`<br />Runtime version: \`${buildDetails.runtime_version}\`<br />App version: \`0.1.0\`<br />Git commit: \`${buildDetails.git_commit_hash}\`</details>`,
  );
  expect(comment).toContain(
    `<details><summary>Details</summary>Branch: \`pr-17\`<br />Runtime version: \`${updateDetails.runtimeVersion}\`<br />Git commit: \`${updateDetails.gitCommitHash}\`</details>`,
  );
  expect(comment).toContain("Update QR   | <a href=");
  expect(comment.match(/width="250px" height="250px"/g)).toHaveLength(2);
  expect(comment).toContain(`/builds/${androidBuild}`);
  expect(comment).toContain(`/builds/${iosBuild}`);
  expect(comment).toContain("https://qr.expo.dev/development-client?");
  expect(comment).toContain(encodeURIComponent(`/group/${group}`));
  expect(comment).not.toContain("https://qr.expo.dev/eas-update");
  expect(comment).toContain("appScheme=whisp-preview");
  expect(comment).not.toContain("## Whisp Preview");
  expect(comment).not.toContain("Install the development build once");
});

test("failed updates do not advertise usable QR previews", () => {
  const comment = MobilePreview.comment({
    ...run,
    status: "FAILURE",
    jobs: run.jobs.map((job) =>
      job.key === "update" ? { ...job, status: "FAILURE" } : job,
    ),
  });
  expect(comment).toContain("failed");
  expect(comment).toContain(run.url);
  expect(comment).not.toContain("qr.expo.dev");
});

test("an iOS build failure preserves the working Android preview", () => {
  const comment = MobilePreview.comment({
    ...run,
    status: "FAILURE",
    jobs: run.jobs.map((job) =>
      job.key === "ios_build" ? { ...job, status: "FAILURE" } : job,
    ),
  });
  expect(comment).toContain(`/builds/${androidBuild}`);
  expect(comment).not.toContain(`/builds/${iosBuild}`);
  expect(comment).toContain(
    `Fingerprint | ${buildDetails.runtime_version} | n/a`,
  );
  expect(comment.match(/appScheme=whisp-preview/g)).toHaveLength(2);
  expect(comment).toContain("failed");
});

test("successful runs must contain a build and update for both platforms", () => {
  expect(() => MobilePreview.comment({ ...run, jobs: [] })).toThrow();
});

test("rejects non-Expo workflow links and malformed build IDs", () => {
  expect(() =>
    MobilePreview.comment({ ...run, url: "https://example.com" }),
  ).toThrow();
  expect(() =>
    MobilePreview.comment({
      ...run,
      jobs: [
        {
          key: "android_existing",
          status: "SUCCESS",
          outputs: { ...buildDetails, build_id: "bad-id" },
        },
        ...run.jobs.slice(1),
      ],
    }),
  ).toThrow();
});
