import { replay, subscribe } from "@/lib/term";

export const dynamic = "force-dynamic";
export const maxDuration = 3600;

/** SSE stream of the terminal session — replays history, then live output. */
export async function GET() {
  const enc = new TextEncoder();
  let unsub: (() => void) | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (s: string) => {
        try {
          controller.enqueue(enc.encode(`data: ${JSON.stringify(s)}\n\n`));
        } catch {
          /* consumer gone */
        }
      };
      send(replay());
      unsub = subscribe(send);
    },
    cancel() {
      unsub?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  });
}
