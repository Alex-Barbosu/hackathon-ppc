import { useNavigate } from "@tanstack/react-router";
import { usePanels } from "../../state/panels";
import { useChaosAction } from "../chaos/useChaos";
import type { StepAction } from "./steps";
import { useDemo } from "./useDemo";

// One button per step: it does the thing and moves the presenter on, so nobody hunts for a control on stage.
export function useRunStep() {
  const navigate = useNavigate();
  const show = usePanels((s) => s.show);
  const chaos = useChaosAction();
  const complete = useDemo((s) => s.complete);
  const run = (i: number, a: StepAction) => {
    if (a.kind === "go") { void navigate({ to: a.to }); complete(i); return; }
    if (a.kind === "panel") { complete(i); show(a.panel, a.draft); return; }
    chaos.mutate(a.action, {
      onSuccess: () => { complete(i); if (a.then) void navigate({ to: a.then }); },
    });
  };
  return { run, pending: chaos.isPending };
}
