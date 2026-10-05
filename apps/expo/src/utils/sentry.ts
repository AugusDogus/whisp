import * as Sentry from "@sentry/react-native";

// Metro and the native build both load sentry.options.json. Keeping this module
// free of app imports lets it capture failures while those imports evaluate.
Sentry.init({ integrations: [Sentry.feedbackIntegration()] });
