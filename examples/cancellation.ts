import { CancellationTokenSource, abortableDelay } from "bun-cancellation-token";

// Simple demo that cancels a delay after 100ms
async function main() {
  const cts = new CancellationTokenSource();
  const work = abortableDelay(1_000, cts.token).then(
    () => console.log("work finished (unexpected)"),
    (e: any) => console.log("work cancelled:", e?.message ?? e)
  );

  setTimeout(() => cts.cancel(new Error("manual cancel")), 100);
  await work;
}

main();
