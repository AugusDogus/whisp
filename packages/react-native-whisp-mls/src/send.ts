import { requireNativeModule } from "expo-modules-core";

interface NativeSend {
  configure(config: string | null): Promise<void>;
  enqueue(input: string): Promise<string>;
  list(): Promise<string>;
  resume(): Promise<void>;
  acknowledge(id: string): Promise<void>;
}
let module: NativeSend | undefined;
function getModule(): NativeSend {
  module ??= requireNativeModule<NativeSend>("WhispSend");
  return module;
}
export const nativeSend: NativeSend = {
  configure: (config) => getModule().configure(config),
  enqueue: (input) => getModule().enqueue(input),
  list: () => getModule().list(),
  resume: () => getModule().resume(),
  acknowledge: (id) => getModule().acknowledge(id),
};
