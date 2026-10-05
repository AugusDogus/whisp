type Subscription = { remove(): void };

/** Native events are wakeups, never job data. Read durable state after configuring
 * the current account, and drain again if a transition arrives during that read. */
export function observeNativeSends(input: {
  getSessionCookie(): string;
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
  let sessionCookie: string | undefined;
  let activationVersion = 0;
  // Checking the account reads protected keychain storage on iOS.
  const available = () => {
    if (stopped || !input.isActive()) return false;
    const currentCookie = input.getSessionCookie();
    sessionCookie ??= currentCookie;
    return sessionCookie === currentCookie;
  };

  async function drain() {
    if (running || !available()) return;
    running = true;
    try {
      while (pending && available()) {
        const version = activationVersion;
        pending = false;
        if (!ready) {
          await input.configure();
          if (version !== activationVersion) continue;
          if (!available()) return;
          ready = true;
        }
        if (resumePending) {
          resumePending = false;
          await input.resume();
          if (version !== activationVersion) continue;
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
    // A new foreground activation reconfigures against the current account.
    sessionCookie = undefined;
    activationVersion++;
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
