import { useChaosAction, useChaosState } from "../chaos/useChaos";
import { BURST, useOutageBurst, usePagerSetup } from "./usePagerDemo";

const BTN = "inline-flex min-h-10 items-center rounded-lg border-[0.8px] border-line-strong px-4 font-mono text-xs uppercase tracking-label text-ink transition-colors hover:bg-white/8 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-40";

function Topic({ name }: { name: string }) {
  return (
    <button type="button" onClick={() => void navigator.clipboard?.writeText(name)} title="Copy"
      className="block max-w-full truncate rounded-md bg-white/6 px-2 py-1 text-left font-mono text-[12px] text-white/85 hover:bg-white/10">{name}</button>
  );
}

/** Admin only: subscribe a phone, then trigger both kinds of page with real actions, not fake pages. */
export function PagerDemo() {
  const setup = usePagerSetup(true);
  const chaos = useChaosState();
  const act = useChaosAction();
  const burst = useOutageBurst();
  const s3Stopped = chaos.data?.storages?.s3 === "stopped";
  const topics = setup.data?.topics;
  return (
    <div className="grid gap-6 border-t-[0.8px] border-line px-5 py-5 sm:grid-cols-2">
      <div className="min-w-0 space-y-2">
        <p className="caption text-muted">Phone</p>
        {setup.isPending && <div className="h-16 animate-pulse rounded-lg bg-white/6" />}
        {setup.isError && <p className="text-[13px] text-muted">Pager setup could not be read.</p>}
        {setup.data && !setup.data.phone && (
          <p className="text-[13px] text-muted">Phone push is off. Add <span className="font-mono">NTFY_TOPIC=filegrid-&lt;random&gt;</span> to .env and run <span className="font-mono">make c-insights</span>. Pages still appear below.</p>
        )}
        {topics && (
          <>
            <p className="text-[13px] text-muted">In the ntfy app, subscribe on {setup.data?.server ?? "ntfy.sh"} to:</p>
            <Topic name={topics.admin} />
            {topics.dispatch.dobrogea && <Topic name={topics.dispatch.dobrogea} />}
          </>
        )}
      </div>
      <div className="min-w-0 space-y-3">
        <p className="caption text-muted">Trigger a page</p>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={BTN} disabled={act.isPending || chaos.isPending}
            onClick={() => act.mutate({ kind: "storage", storage: "s3", run: s3Stopped ? "start" : "stop" })}>
            {s3Stopped ? "Start S3 again" : "Stop S3"}
          </button>
          <span className="text-[13px] text-muted">{s3Stopped ? "S3 is stopped. The admin page should already be here." : "Pages the admin within seconds."}</span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className={BTN} disabled={burst.isPending} onClick={() => burst.mutate()}>
            {burst.isPending ? `Sending ${burst.sent + 1} of ${BURST}` : `Send ${BURST} Constanța outages`}
          </button>
          <span className="text-[13px] text-muted">
            {burst.isError ? burst.error.message : burst.isSuccess ? "Sent. Dobrogea dispatch is paged." : "Pages Dobrogea dispatch."}
          </span>
        </div>
      </div>
    </div>
  );
}
