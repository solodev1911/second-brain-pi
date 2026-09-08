import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream, type AssistantMessage, type Context, type Model, type SimpleStreamOptions } from "@earendil-works/pi-ai";

function stream(model: Model<any>, context: Context, _options?: SimpleStreamOptions) {
  const events = createAssistantMessageEventStream();
  const distillation = context.systemPrompt?.includes("You distil an explicitly user-approved coding-agent answer") === true;
  const text = distillation
    ? "<<<QUESTION>>>\nWhere is the invoice total calculated?\n<<<SUMMARY>>>\nInvoice totals are calculated by calculate_total in src/billing.py.\n<<<ANSWER>>>\nUse calculate_total; it sums price_cents and create_invoice stores total_cents.\n<<<SOURCE_NODES>>>\nNONE\n<<<END>>>"
    : "The invoice total is calculated by `calculate_total` in `src/billing.py`; it sums `price_cents`. Should I implement this?";
  const output: AssistantMessage = {
    role: "assistant", content: [], api: model.api, provider: model.provider, model: model.id,
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "pending", timestamp: Date.now(),
  };
  queueMicrotask(() => {
    events.push({ type: "start", partial: output });
    output.content.push({ type: "text", text: "" });
    events.push({ type: "text_start", contentIndex: 0, partial: output });
    (output.content[0] as { type: "text"; text: string }).text = text;
    events.push({ type: "text_delta", contentIndex: 0, delta: text, partial: output });
    events.push({ type: "text_end", contentIndex: 0, content: text, partial: output });
    output.stopReason = "stop";
    events.push({ type: "done", reason: "stop", message: output });
    events.end(output);
  });
  return events;
}

export default function fakeProvider(pi: ExtensionAPI): void {
  pi.registerProvider("second-brain-fake", {
    api: "openai-completions",
    baseUrl: "http://127.0.0.1/unused",
    apiKey: "test-key",
    models: [{
      id: "fixture", name: "Second Brain Fixture", reasoning: false, input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_000, maxTokens: 4_000,
    }],
    streamSimple: stream,
  });
}
