import { z } from "zod";

export const creatorJobSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("digital_asset_delivery"),
    creatorId: z.string().min(1),
    orderId: z.string().min(1),
    assetId: z.string().min(1)
  }),
  z.object({
    kind: z.literal("subscriber_update"),
    creatorId: z.string().min(1),
    subscriberId: z.string().min(1),
    status: z.enum(["active", "paused", "cancelled"])
  }),
  z.object({
    kind: z.literal("content_processing"),
    creatorId: z.string().min(1),
    contentId: z.string().min(1),
    operation: z.enum(["transcode", "thumbnail", "moderate"])
  })
]);

export type CreatorJob = z.infer<typeof creatorJobSchema>;
export type JobKind = CreatorJob["kind"];

export interface QueuedCreatorJob {
  messageId: string;
  job: CreatorJob;
}

export const concurrencyByKind: Readonly<Record<JobKind, number>> = {
  digital_asset_delivery: 3,
  subscriber_update: 4,
  content_processing: 1
};

/** Select one fair execution wave while preserving queue order within each job kind. */
export function selectExecutionWave(
  pending: readonly QueuedCreatorJob[],
  limits: Readonly<Record<JobKind, number>> = concurrencyByKind
): QueuedCreatorJob[] {
  const selected: QueuedCreatorJob[] = [];
  const used: Record<JobKind, number> = {
    digital_asset_delivery: 0,
    subscriber_update: 0,
    content_processing: 0
  };

  for (const item of pending) {
    if (used[item.job.kind] < limits[item.job.kind]) {
      selected.push(item);
      used[item.job.kind] += 1;
    }
  }
  return selected;
}
