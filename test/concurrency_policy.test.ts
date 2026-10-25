import assert from "node:assert/strict";
import test from "node:test";
import {
  creatorJobSchema,
  selectExecutionWave,
  type QueuedCreatorJob
} from "../src/concurrency_policy.js";

function queued(messageId: string, payload: unknown): QueuedCreatorJob {
  return { messageId, job: creatorJobSchema.parse(payload) };
}

test("one execution wave preserves capacity for delivery while limiting content processing", () => {
  const pending = [
    queued("content-1", { kind: "content_processing", creatorId: "c1", contentId: "v1", operation: "transcode" }),
    queued("content-2", { kind: "content_processing", creatorId: "c1", contentId: "v2", operation: "thumbnail" }),
    queued("delivery-1", { kind: "digital_asset_delivery", creatorId: "c1", orderId: "o1", assetId: "a1" }),
    queued("delivery-2", { kind: "digital_asset_delivery", creatorId: "c2", orderId: "o2", assetId: "a2" }),
    queued("delivery-3", { kind: "digital_asset_delivery", creatorId: "c3", orderId: "o3", assetId: "a3" }),
    queued("delivery-4", { kind: "digital_asset_delivery", creatorId: "c4", orderId: "o4", assetId: "a4" })
  ];

  const wave = selectExecutionWave(pending);

  assert.deepEqual(
    wave.map((item) => item.messageId),
    ["content-1", "delivery-1", "delivery-2", "delivery-3"]
  );
});

test("invalid queue payload is rejected at the worker boundary", () => {
  assert.throws(
    () => creatorJobSchema.parse({ kind: "content_processing", creatorId: "c1", contentId: "v1", operation: "publish" }),
    /Invalid enum value/
  );
});
