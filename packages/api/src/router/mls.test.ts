// One database and router lifecycle, with scenarios grouped by protocol domain.
import { describe } from "bun:test";

import { registerApplicationTests } from "../test/mls/applications";
import { registerConversationTests } from "../test/mls/conversations";
import { registerDeviceTests } from "../test/mls/devices";
import { registerDraftTests } from "../test/mls/drafts";

describe("devices", registerDeviceTests);
describe("conversations", registerConversationTests);
describe("drafts", registerDraftTests);
describe("applications", registerApplicationTests);
