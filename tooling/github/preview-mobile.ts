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
const updatesSchema = z.array(
  z.object({ platform: z.enum(["android", "ios"]), group: z.uuid() }),
);
const contextSchema = z.object({
  backend: z.url().refine((value) => {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname.endsWith(".vercel.app");
  }),
  commit: z.string().regex(/^[a-f0-9]{40}$/),
});

function comment(input: unknown, context: unknown): string {
  const run = runSchema.parse(input);
  const { backend, commit } = contextSchema.parse(context);
  const header = `<!-- whisp-mobile-preview -->
## Whisp Preview

Commit: \`${commit.slice(0, 7)}\` · [PR backend](${backend}) · [EAS workflow](${run.url})`;
  if (run.status !== "SUCCESS") {
    return `${header}

Mobile preview ${run.status === "FAILURE" ? "failed" : "was canceled"}. The backend is still deployed. Check the EAS workflow logs, fix the reported error, and rerun the GitHub Actions workflow.
`;
  }

  const outputs = (key: string) =>
    run.jobs.find((job) => job.key === key && job.status === "SUCCESS")
      ?.outputs;
  const updates = updatesSchema.parse(
    JSON.parse(z.string().parse(outputs("update")?.updates_json)),
  );
  const rows = ["android", "ios"].map((platform) => {
    const buildId = z
      .uuid()
      .parse(
        outputs(`${platform}_build`)?.build_id ??
          outputs(`${platform}_existing`)?.build_id,
      );
    const group = z
      .uuid()
      .parse(updates.find((update) => update.platform === platform)?.group);
    const qr = new URL("https://qr.expo.dev/eas-update");
    qr.search = new URLSearchParams({
      projectId,
      groupId: group,
      appScheme: "whisp-preview",
    }).toString();
    return `| ${platform === "ios" ? "iOS" : "Android"} | [Install development build](${projectUrl}/builds/${buildId}) | [Open update](https://expo.dev/projects/${projectId}/updates/${group}) | [![Preview QR](${qr})](${qr}) |`;
  });

  return `${header}

Install the development build once, then scan the QR code to open this PR's update. Install the linked build again when native dependencies change. iOS requires a device registered in the build's provisioning profile.

| Platform | Build | Update | QR code |
| --- | --- | --- | --- |
${rows.join("\n")}

All PRs share the Whisp Preview app. Use this PR's QR code to select its backend and code.
`;
}

export const MobilePreview = { comment } as const;

if (import.meta.main) {
  const [input, output] = z
    .tuple([z.string(), z.string()])
    .parse(Bun.argv.slice(2));
  await Bun.write(
    output,
    comment(await Bun.file(input).json(), {
      backend: process.env.EXPO_PUBLIC_API_URL,
      commit: process.env.PREVIEW_COMMIT,
    }),
  );
}
