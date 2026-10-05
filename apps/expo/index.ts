// Install error handlers before evaluating App and its auth/storage imports.
import "./src/utils/sentry";
import { registerRootComponent } from "expo";

import { createForegroundApp } from "./src/components/foreground-app";

registerRootComponent(createForegroundApp(() => import("./src/App")));
