# Android background-upload review

The Google Play foreground-service declaration requires a recording of a user-initiated media upload continuing in the background.

Use the dedicated review account in the preview app and enable **Send to myself** in Profile. Capture media, send it to **Me (testing)**, leave the app, and show the upload notification before returning to the completed send.

The preview app uses the same background-upload module as the store build. Self-send is a preview-only testing control and is not available in the store build.
