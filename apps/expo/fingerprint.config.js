/** @type {import('@expo/fingerprint').Config} */
module.exports = {
  // Native Sentry reads this before JavaScript starts. Changes require a binary
  // with matching options, even when the JavaScript bundle still loads.
  extraSources: [
    {
      type: "file",
      filePath: "sentry.options.json",
      reasons: ["Native Sentry startup options"],
    },
  ],
};
