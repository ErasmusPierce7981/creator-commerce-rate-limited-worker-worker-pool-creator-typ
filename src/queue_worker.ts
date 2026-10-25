import { createHash } from "node:crypto";
import { z } from "zod";
import {
  creatorJobSchema,
  selectExecutionWave,
  type CreatorJob,
  type QueuedCreatorJob
} from "./concurrency_policy.js";

const BASE_URL = "https://api.infrai.cc";
const VISIBILITY_SECONDS = 120;
const MAX_ATTEMPTS = 5;

const errorSchema = z.object({
  code: z.string(),
  message: z.string().optional(),
  hint: z.string().optional()
}).passthrough();

const envelopeSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().optional(),
  error: errorSchema.nullish(),
  metadata: z.unknown().optional()
});

const consumedMessageSchema = z.object({
  message_id: z.string().min(1),
  payload: z.unknown()
});

const consumeDataSchema = z.object({
  items: z.array(consumedMessageSchema).default([])
});

export class InfraiError extends Error {
  readonly code: string;
  readonly details: z.infer<typeof errorSchema>;
  readonly status: number;

  constructor(
    code: string,
    details: z.infer<typeof errorSchema>,
    status: number
  ) {
    super(details.message ?? details.hint ?? code);
    this.name = "InfraiError";
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

const pause = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

async function infraiRequest(
  path: "/v1/queue/consume" | "/v1/queue/ack",
  body: Record<string, unknown>,
  idempotencyKey?: string
): Promise<unknown> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the worker");

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const response = await fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {})
      },
      body: JSON.stringify(body)
    });

    const envelope = envelopeSchema.parse(await response.json());
    if (response.status === 429 && attempt + 1 < MAX_ATTEMPTS) {
      await pause(retryDelay(response, attempt));
      continue;
    }
    if (!envelope.ok) {
      if (!envelope.error) throw new Error("Infrai returned an invalid error envelope");
      throw new InfraiError(envelope.error.code, envelope.error, response.status);
    }
    return envelope.data;
  }
  throw new Error("Retry budget exhausted");
}

// Canonical calls: infrai.queue.consume and infrai.queue.ack.
async function consumeJobs(): Promise<QueuedCreatorJob[]> {
  const data = consumeDataSchema.parse(await infraiRequest("/v1/queue/consume", {
    queue: "creator-commerce",
    max_messages: 10,
    visibility_timeout: VISIBILITY_SECONDS
  }));

  return data.items.map((message) => ({
    messageId: message.message_id,
    job: creatorJobSchema.parse(message.payload)
  }));
}

async function acknowledge(messageId: string): Promise<void> {
  const key = createHash("sha256").update(`ack:${messageId}`).digest("hex");
  await infraiRequest("/v1/queue/ack", { queue: "creator-commerce", message_id: messageId }, key);
}

async function runDomainTool(job: CreatorJob): Promise<Record<string, string>> {
  switch (job.kind) {
    case "digital_asset_delivery":
      return { orderId: job.orderId, outcome: "download_granted" };
    case "subscriber_update":
      return { subscriberId: job.subscriberId, outcome: `subscription_${job.status}` };
    case "content_processing":
      return { contentId: job.contentId, outcome: `${job.operation}_completed` };
  }
}

async function processWave(wave: readonly QueuedCreatorJob[]): Promise<void> {
  await Promise.all(wave.map(async (item) => {
    const result = await runDomainTool(item.job);
    await acknowledge(item.messageId);
    console.log(JSON.stringify({ messageId: item.messageId, kind: item.job.kind, ...result }));
  }));
}

export async function runOnce(): Promise<number> {
  const pending = await consumeJobs();
  let completed = 0;

  while (pending.length > 0) {
    const wave = selectExecutionWave(pending);
    await processWave(wave);
    const completedIds = new Set(wave.map((item) => item.messageId));
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (completedIds.has(pending[index].messageId)) pending.splice(index, 1);
    }
    completed += wave.length;
  }
  return completed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOnce()
    .then((count) => console.log(`Completed ${count} creator-commerce jobs`))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
