// The pending request must not block email login or outlive the login screen.
export function beginConditionalPasskey<Options, Assertion>(adapter: {
  supported(): Promise<boolean>;
  options(signal: AbortSignal): Promise<Options>;
  authenticate(options: Options): Promise<Assertion>;
  verify(assertion: Assertion, signal: AbortSignal): Promise<boolean>;
  cancel(): void;
}, signedIn: () => Promise<void>): () => void {
  const controller = new AbortController();
  let authenticating = false;
  void (async () => {
    try {
      if (!await adapter.supported() || controller.signal.aborted) return;
      const options = await adapter.options(controller.signal);
      if (controller.signal.aborted) return;
      authenticating = true;
      let assertion: Assertion;
      try { assertion = await adapter.authenticate(options); }
      finally { authenticating = false; }
      if (controller.signal.aborted) return;
      if (await adapter.verify(assertion, controller.signal) && !controller.signal.aborted)
        await signedIn();
    } catch {
      // Unsupported devices, cancellation and background failures leave email login usable.
    }
  })();
  return () => {
    controller.abort();
    if (authenticating) {
      authenticating = false;
      adapter.cancel();
    }
  };
}
