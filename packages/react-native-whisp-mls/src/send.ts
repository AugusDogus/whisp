import { requireNativeModule, type EventSubscription } from "expo-modules-core";

interface NativeSend {
  configure(config: string | null): Promise<void>;
  enqueue(input: string): Promise<string>;
  list(): Promise<string>;
  resume(): Promise<void>;
  acknowledge(id: string): Promise<void>;
}
interface NativeSendModule extends NativeSend {
  statusEventsSupported?: boolean;
  addListener(
    event: "onSendStatusChanged",
    listener: () => void,
  ): EventSubscription;
}
let module: NativeSendModule | undefined;
function getModule(): NativeSendModule {
  module ??= requireNativeModule<NativeSendModule>("WhispSend");
  return module;
}
export const nativeSend = {
  configure: (config) => getModule().configure(config),
  enqueue: (input) => getModule().enqueue(input),
  list: () => getModule().list(),
  resume: () => getModule().resume(),
  acknowledge: (id) => getModule().acknowledge(id),
  subscribe(listener: () => void): EventSubscription | undefined {
    const native = getModule();
    // OTA updates can run on binaries predating native status events.
    if (!native.statusEventsSupported) return undefined;
    return native.addListener("onSendStatusChanged", listener);
  },
} satisfies NativeSend & {
  subscribe(listener: () => void): EventSubscription | undefined;
};
