import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type SimpleStreamOptions,
  type ToolCall,
  type ToolResultMessage,
  type UserMessage,
} from "@earendil-works/pi-ai";

const usage = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function baseMessage(model: Model<any>): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage,
    stopReason: "pending",
    timestamp: Date.now(),
  };
}

function userText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function toolText(message: ToolResultMessage): string {
  return message.content.filter((part) => part.type === "text").map((part) => part.text).join("\n");
}

function stream(model: Model<any>, context: Context, _options?: SimpleStreamOptions) {
  const events = createAssistantMessageEventStream();
  const output = baseMessage(model);
  const last = context.messages.at(-1);
  const distillation = context.systemPrompt?.includes("You distil an explicitly user-approved coding-agent answer") === true;

  let text: string | undefined;
  let toolCall: ToolCall | undefined;
  if (distillation) {
    text = "<<<QUESTION>>>\nWhere is the invoice total calculated?\n<<<SUMMARY>>>\nInvoice totals are calculated by calculate_total in src/billing.py.\n<<<ANSWER>>>\nUse calculate_total; it sums price_cents and create_invoice stores total_cents.\n<<<SOURCE_NODES>>>\nNONE\n<<<END>>>";
  } else if (last?.role === "toolResult" && last.toolName === "query_graph") {
    const found = /calculate_total|Invoice totals are calculated/i.test(toolText(last));
    text = found
      ? "RECALLED_FROM_GRAPH: the saved conclusion says calculate_total in src/billing.py owns invoice totals."
      : "GRAPH_QUERY_MISSED: the saved conclusion was not present in the graph result.";
  } else if (last?.role === "user" && /saved billing conclusion/i.test(userText(last))) {
    toolCall = {
      type: "toolCall",
      id: `recall-query-${Date.now()}`,
      name: "query_graph",
      arguments: {
        question: "invoice total calculate_total saved conclusion",
        mode: "bfs",
        depth: 3,
        token_budget: 2_000,
      },
    };
  } else {
    text = "The invoice total is calculated by `calculate_total` in `src/billing.py`; it sums `price_cents`.";
  }

  queueMicrotask(() => {
    events.push({ type: "start", partial: output });
    if (toolCall) {
      output.content.push(toolCall);
      events.push({ type: "toolcall_start", contentIndex: 0, partial: output });
      events.push({ type: "toolcall_end", contentIndex: 0, toolCall, partial: output });
      output.stopReason = "toolUse";
      events.push({ type: "done", reason: "toolUse", message: output });
      events.end(output);
      return;
    }
    const finalText = text ?? "";
    output.content.push({ type: "text", text: "" });
    events.push({ type: "text_start", contentIndex: 0, partial: output });
    (output.content[0] as { type: "text"; text: string }).text = finalText;
    events.push({ type: "text_delta", contentIndex: 0, delta: finalText, partial: output });
    events.push({ type: "text_end", contentIndex: 0, content: finalText, partial: output });
    output.stopReason = "stop";
    events.push({ type: "done", reason: "stop", message: output });
    events.end(output);
  });
  return events;
}

export default function recallProvider(pi: ExtensionAPI): void {
  pi.registerProvider("second-brain-recall", {
    api: "openai-completions",
    baseUrl: "http://127.0.0.1/unused",
    apiKey: "test-key",
    models: [{
      id: "fixture",
      name: "Second Brain Recall Fixture",
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 32_000,
      maxTokens: 4_000,
    }],
    streamSimple: stream,
  });
}
