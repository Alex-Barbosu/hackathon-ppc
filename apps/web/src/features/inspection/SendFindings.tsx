import { useState } from "react";
import { FIELD, PrimaryButton } from "../../components/ui";
import { buildReport, TEAMS, type TeamId } from "./report";
import { mapsUrl } from "./SitePanel";
import { useSiteWeather } from "./useSiteWeather";

// Hands the findings to the crew that acts on them, as an email drafted in the operator's own mail app,
// so nothing is sent without a person reading it first.
export function SendFindings() {
  const [team, setTeam] = useState<TeamId>("maintenance");
  const [state, setState] = useState<"idle" | "drafted" | "copied">("idle");
  const weather = useSiteWeather();
  const target = TEAMS.find((t) => t.id === team)!;

  const send = () => {
    const { subject, body } = buildReport(mapsUrl, weather.data);
    window.location.href = `mailto:${target.to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    setState("drafted");
  };
  const copy = async () => {
    const { subject, body } = buildReport(mapsUrl, weather.data);
    try { await navigator.clipboard.writeText(`${subject}\n\n${body}`); setState("copied"); } catch { setState("idle"); }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <label className="sr-only" htmlFor="send-team">Send to</label>
        <select id="send-team" value={team} onChange={(e) => { setTeam(e.target.value as TeamId); setState("idle"); }} className={`${FIELD} min-w-0 flex-1 text-[14px]`}>
          {TEAMS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <PrimaryButton onClick={send}>Send findings</PrimaryButton>
      </div>
      <p className="text-[13px] text-muted" aria-live="polite">
        {state === "drafted" ? `Draft to ${target.label} opened in your mail app.` : state === "copied" ? "Report copied." : <>
          Opens an email draft to {target.to}. <button type="button" onClick={() => void copy()} className="underline decoration-white/30 underline-offset-2 hover:text-ink">Copy report instead</button></>}
      </p>
    </div>
  );
}
