import Anthropic from "@anthropic-ai/sdk";

/** The two calls the intelligence layer makes. A small seam so tests never touch the network. */
export interface Llm {
  create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message>;
  stream(params: Anthropic.MessageCreateParamsNonStreaming, onText: (t: string) => void): Promise<Anthropic.Message>;
}

export class BudgetExceeded extends Error {
  constructor() { super("AI call budget for this hour is used up"); this.name = "BudgetExceeded"; }
}

/**
 * A cap on model calls per rolling hour across narrator, briefing and analyst. It is a guard
 * against a loop or a flood, not a billing control: set the real spend limit in the Anthropic Console.
 */
export class CallBudget {
  private readonly stamps: number[] = [];
  constructor(private readonly perHour: number, private readonly now: () => number = Date.now) {}
  take(): boolean {
    const cutoff = this.now() - 3_600_000;
    while (this.stamps.length && (this.stamps[0] ?? 0) < cutoff) this.stamps.shift();
    if (this.stamps.length >= this.perHour) return false;
    this.stamps.push(this.now());
    return true;
  }
}

export function budgeted(inner: Llm, budget: CallBudget): Llm {
  const guard = () => { if (!budget.take()) throw new BudgetExceeded(); };
  return {
    // async, so an exhausted budget is a rejected promise like any other failure, never a synchronous throw.
    create: async (p) => { guard(); return inner.create(p); },
    stream: async (p, onText) => { guard(); return inner.stream(p, onText); },
  };
}

export function anthropicLlm(client: Anthropic): Llm {
  return {
    create: (p) => client.messages.create(p),
    stream: async (p, onText) => {
      const s = client.messages.stream(p);
      s.on("text", onText);
      return s.finalMessage();
    },
  };
}

export interface AiConfig { llm: Llm | null; narratorModel: string; analystModel: string }

export function aiConfigFromEnv(env: NodeJS.ProcessEnv): AiConfig {
  const key = env.ANTHROPIC_API_KEY?.trim();
  const perHour = Number(env.AI_MAX_CALLS_PER_HOUR ?? 120);
  return {
    // No key is a normal state (the demo must run offline): every feature has a non-AI answer.
    llm: key ? budgeted(anthropicLlm(new Anthropic({ apiKey: key })), new CallBudget(Number.isFinite(perHour) ? perHour : 120)) : null,
    narratorModel: env.NARRATOR_MODEL?.trim() || "claude-haiku-5-5",
    analystModel: env.ANALYST_MODEL?.trim() || "claude-haiku-5-5",
  };
}

/** Plain text of a response; a refusal or an empty answer is treated as unavailable by callers. */
export function textOf(m: Anthropic.Message): string {
  return m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("").trim();
}
