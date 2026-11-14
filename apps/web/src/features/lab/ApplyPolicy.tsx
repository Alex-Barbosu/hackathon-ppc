const WHY = "Needs PUT /api/v1/policy (zone A)";

// Disabled controls swallow hover, so the tooltip sits on the wrapper; the sentence is also
// visible text for touch and keyboard users.
export function ApplyPolicy() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <span title={WHY}>
        <button type="button" disabled aria-describedby="apply-why"
          className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50">
          Apply policy
        </button>
      </span>
      <p id="apply-why" className="text-[13px] text-muted">{WHY}</p>
    </div>
  );
}
