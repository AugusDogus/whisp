import { z } from "zod";

const projectId = "9d685be4-a82e-4a29-885f-4fbb76fb008c";
const projectUrl = "https://expo.dev/accounts/augusdogus/projects/whisp";
const runSchema = z.object({
  status: z.enum(["SUCCESS", "FAILURE", "CANCELED"]),
  url: z.url().refine((value) => value.startsWith(`${projectUrl}/workflows/`)),
  jobs: z.array(
    z.object({
      key: z.string(),
      status: z.string(),
      outputs: z.record(z.string(), z.unknown()).nullish(),
    }),
  ),
});
const hashSchema = z.string().regex(/^[a-f0-9]{40}$/);
const detailSchema = z.string().regex(/^[\w.+:/-]+$/);
const buildSchema = z.object({
  build_id: z.uuid(),
  distribution: detailSchema,
  profile: detailSchema,
  runtime_version: hashSchema,
  app_version: detailSchema,
  git_commit_hash: hashSchema,
});
const updateSchema = z.object({
  platform: z.enum(["android", "ios"]),
  group: z.uuid(),
  branch: detailSchema,
  runtimeVersion: hashSchema,
  gitCommitHash: hashSchema,
});

function details(link: string, lines: string[]): string {
  return `${link}<br /><details><summary>Details</summary>${lines.join("<br />")}</details>`;
}

function comment(input: unknown): string {
  const run = runSchema.parse(input);
  const status =
    run.status === "SUCCESS"
      ? "🚀 Expo continuous deployment is ready!"
      : `Mobile deployment ${run.status === "FAILURE" ? "failed" : "was canceled"} for one or more jobs. Available previews are linked below. Check the [EAS workflow logs](${run.url}), fix the reported error, and rerun the GitHub Actions workflow.`;

  const outputs = (key: string) =>
    run.jobs.find((job) => job.key === key && job.status === "SUCCESS")
      ?.outputs;
  const updateOutput = outputs("update");
  const updates = updateOutput
    ? z
        .array(updateSchema)
        .parse(JSON.parse(z.string().parse(updateOutput.updates_json)))
    : [];
  const platformDetails = (platform: "android" | "ios") => {
    const buildOutput =
      outputs(`${platform}_build`) ?? outputs(`${platform}_existing`);
    const update = updates.find((candidate) => candidate.platform === platform);
    if (run.status !== "SUCCESS" && (!buildOutput?.build_id || !update)) {
      return { fingerprint: "n/a", build: "n/a", update: "n/a", qr: "n/a" };
    }
    const build = buildSchema.parse(buildOutput);
    const published = updateSchema.parse(update);
    // /eas-update treats appScheme as a slug and prepends exp+.
    // Our installed preview uses the explicit whisp-preview scheme.
    const qr = new URL("https://qr.expo.dev/development-client");
    qr.search = new URLSearchParams({
      appScheme: "whisp-preview",
      url: `https://u.expo.dev/${projectId}/group/${published.group}`,
    }).toString();
    return {
      fingerprint: build.runtime_version,
      build: details(
        `[Build Permalink](${projectUrl}/builds/${build.build_id})`,
        [
          `Distribution: \`${build.distribution}\``,
          `Build profile: \`${build.profile}\``,
          `Runtime version: \`${build.runtime_version}\``,
          `App version: \`${build.app_version}\``,
          `Git commit: \`${build.git_commit_hash}\``,
        ],
      ),
      update: details(
        `[Update Permalink](https://expo.dev/projects/${projectId}/updates/${published.group})`,
        [
          `Branch: \`${published.branch}\``,
          `Runtime version: \`${published.runtimeVersion}\``,
          `Git commit: \`${published.gitCommitHash}\``,
        ],
      ),
      qr: `<a href="${qr}"><img src="${qr}" width="250px" height="250px" /></a>`,
    };
  };
  const android = platformDetails("android");
  const ios = platformDetails("ios");

  // Match expo-github-action's continuous-deploy-fingerprint comment template.
  return `<!-- whisp-mobile-preview -->
${status}

- Project → **whisp**
- Platforms → **android**, **ios**
- Scheme → **whisp-preview**

&nbsp; | 🤖 Android | 🍎 iOS
--- | --- | ---
Fingerprint | ${android.fingerprint} | ${ios.fingerprint}
Build Details | ${android.build} | ${ios.build}
Update Details | ${android.update} | ${ios.update}
Update QR   | ${android.qr} | ${ios.qr}
`;
}

export const MobilePreview = { comment } as const;

if (import.meta.main) {
  const [input, output] = z
    .tuple([z.string(), z.string()])
    .parse(Bun.argv.slice(2));
  await Bun.write(output, comment(await Bun.file(input).json()));
}
