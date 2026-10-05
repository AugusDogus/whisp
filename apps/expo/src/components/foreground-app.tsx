import type { ComponentType } from "react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AppState } from "react-native";

/** Native background tasks must not import the UI's protected auth storage.
 * Once the UI has committed, retain it across backgrounding to preserve drafts. */
export function createForegroundApp(
  load: () => Promise<{ default: ComponentType }>,
) {
  const App = lazy(load);

  function LoadedApp({ onCommit }: { onCommit(): void }) {
    useEffect(onCommit, [onCommit]);
    return <App />;
  }

  return function ForegroundApp() {
    const [started, setStarted] = useState(false);
    const [, refresh] = useState(0);
    const onCommit = useCallback(() => setStarted(true), []);
    useEffect(() => {
      if (started) return;
      const changed = () => refresh((value) => value + 1);
      const subscription = AppState.addEventListener("change", changed);
      // Activation can occur between the first render and subscribing.
      changed();
      return () => subscription.remove();
    }, [started]);

    // Read the current state at the actual render/import boundary. A stale
    // activation event must not start the app after the phone locks again.
    if (!started && AppState.currentState !== "active") return null;
    return (
      <Suspense fallback={null}>
        <LoadedApp onCommit={onCommit} />
      </Suspense>
    );
  };
}
