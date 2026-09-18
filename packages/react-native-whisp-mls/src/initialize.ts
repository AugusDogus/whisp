import bindings from "./generated/whisp_mls";
import installer from "./NativeWhispMls";

let initialized = false;

/** Call before creating clients. Rebuild the dev client after installing this module. */
export function initializeMls(): void {
  if (initialized) return;
  if (!installer) {
    throw new Error(
      "The MLS native module is missing. Build react-native-whisp-mls for this platform and rebuild the Expo dev client. Expo Go cannot load it.",
    );
  }
  if (!installer.installRustCrate()) {
    throw new Error(
      "The MLS native bindings could not be installed. Restart the dev client and retry.",
    );
  }
  bindings.initialize();
  initialized = true;
}
