// Keep one ordered mock lifecycle for integration scenarios that share the real
// device queue and native-send configuration. Each domain owns its assertions.
import { describe } from "bun:test";

import { registerDeviceTests } from "../test/mls/device";
import { registerNativeSendTests } from "../test/mls/native-send";
import { registerOutboxTests } from "../test/mls/outbox";
import { registerReceivingTests } from "../test/mls/receiving";

describe("device", registerDeviceTests);
describe("receiving", registerReceivingTests);
describe("outbox", registerOutboxTests);
describe("native-send", registerNativeSendTests);
