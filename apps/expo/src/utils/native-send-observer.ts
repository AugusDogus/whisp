type Subscription = { remove(): void };

/** Native events are wakeups, never job data. Read durable state after configuring
 * the current account, and drain again if a transition arrives during that read. */
export function observeNativeSends(input: {
  isCurrent(): boolean;
  isActive(): boolean;
  configure(): Promise<unknown>;
  resume(): Promise<void>;
  reconcile(): Promise<void>;
  subscribeStatus(listener: () => void): Subscription | undefined;
  subscribeActivation(listener: () => void): Subscription;
  onError(): void;
}) {
  let stopped = false;
  let running = false;
  let ready = false;
  let pending = false;
  let resumePending = false;
  const available = () => !stopped && input.isCurrent() && input.isActive();

  async function drain() {
    if (running || !available()) return;
    running = true;
    try {
      while (pending && available()) {
        pending = false;
        if (!ready) {
          await input.configure();
          if (!available()) return;
          ready = true;
        }
        if (resumePending) {
          resumePending = false;
          await input.resume();
          if (!available()) return;
        }
        await input.reconcile();
      }
    } catch {
      // Reconfigure after failures, including expired native authentication.
      ready = false;
      if (available()) input.onError();
    } finally {
      running = false;
      if (pending && available()) void drain();
    }
  }
  function refresh() {
    pending = true;
    void drain();
  }
  function activate() {
    ready = false;
    resumePending = true;
    refresh();
  }
  // Subscribe before the first read so startup cannot miss a completion.
  const status = input.subscribeStatus(refresh);
  const activation = input.subscribeActivation(activate);
  // Recovery for missed events/process suspension; old binaries keep polling.
  const timer = setInterval(refresh, status ? 30_000 : 2_000);
  activate();
  return () => {
    stopped = true;
    clearInterval(timer);
    status?.remove();
    activation.remove();
  };
}
