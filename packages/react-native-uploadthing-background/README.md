# react-native-uploadthing-background

`react-native-uploadthing-background` is a Nitro-powered helper for running
UploadThing uploads with native background transfer support in Expo / React
Native apps.

It was added to this monorepo to power `whisp` media uploads without relying on
the JavaScript runtime staying alive while a photo or video is being sent.

## What it does

- keeps UploadThing auth negotiation in JavaScript
- asks the existing UploadThing route for presigned upload targets
- hands the actual file transfer off to native code
- exposes persistent upload task snapshots back to JavaScript
- adds Expo integration for:
  - Android foreground data-sync uploads
  - iOS AppDelegate background `URLSession` callbacks

## How it works

### JavaScript layer

`src/uploadthing.ts` provides `createUploadthingBackgroundClient()`.

That client:

1. POSTs to the app's UploadThing route with the same `actionType=upload` /
   `slug=<route>` contract used by UploadThing's standard client.
2. Receives presigned upload URLs.
3. Schedules native background tasks via the Nitro HybridObject.
4. Polls persisted task state until those tasks enter a terminal state.

### iOS runtime

- uses `URLSessionConfiguration.background(withIdentifier:)`
- builds a multipart upload body on disk
- uploads using `URLSession.uploadTask(with:fromFile:)`
- persists task snapshots in Application Support
- uses an Expo AppDelegate subscriber to forward
  `handleEventsForBackgroundURLSession`

### Android runtime

- schedules uploads with `WorkManager`
- promotes work into a foreground `dataSync` transfer with a notification
- streams multipart bodies over `HttpURLConnection`
- persists task snapshots in `SharedPreferences`

## Public API

### Nitro module

The core HybridObject is `UploadthingBackground`.

It exposes:

- `enqueueUpload(request)`
- `getTask(taskId)`
- `listTasks()`
- `cancelUpload(taskId)`
- `removeTask(taskId)`

### UploadThing helper

```ts
import { createUploadthingBackgroundClient } from "react-native-uploadthing-background";

const { uploadFilesWithInputInBackground } =
  createUploadthingBackgroundClient({
    url: "https://example.com/api/uploadthing",
    fetch,
  });
```

`uploadFilesWithInputInBackground(route, { files, input })` returns:

- `tasks`: accepted native background tasks
- `completion`: a promise that resolves once all scheduled tasks become
  `completed`, `failed`, or `cancelled`

## Expo integration

This package includes:

- `app.plugin.js`
- `plugin/index.js`
- `expo-module.config.json`

In an Expo app, add the package to the `plugins` array:

```ts
plugins: [
  // ...
  "react-native-uploadthing-background",
];
```

The plugin ensures Android prebuild adds:

- `android.permission.FOREGROUND_SERVICE`
- `android.permission.FOREGROUND_SERVICE_DATA_SYNC`
- `android.permission.POST_NOTIFICATIONS` (by default)
- `androidx.work.impl.foreground.SystemForegroundService` with
  `foregroundServiceType="dataSync"`

## Whisp integration notes

`whisp` uses this package in `apps/expo/src/utils/uploadthing.ts` and
`apps/expo/src/utils/media-upload.ts`.

The app:

- compresses local media before upload
- creates a React Native FormData-compatible `File`
- schedules a background UploadThing transfer
- reconciles terminal tasks on app foreground / relaunch

## Current limitations

- uploads are persistent, but task event delivery to JavaScript is polling-based
  rather than push/event-emitter based
- Android retries currently rely on WorkManager reruns instead of resumable byte
  ranges
- iOS uploads rebuild a multipart body file on disk before scheduling the native
  background transfer
- end-to-end device validation still needs a logged-in Expo dev client / device

## Suggested manual QA

1. Start the Expo dev client for `whisp`.
2. Log into the app.
3. Send a photo to a friend.
4. Immediately background the app and confirm the upload still completes.
5. Repeat with a video.
6. Force-close the app mid-upload, reopen it, and verify the inbox / friend list
   reconcile once the app becomes active again.
7. Disable network during an upload and verify the task eventually reports a
   failure state.
