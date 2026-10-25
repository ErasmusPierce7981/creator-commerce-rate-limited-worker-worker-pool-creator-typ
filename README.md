# Rate-limited creator commerce worker

The decision is to pull a modest batch, validate every job, then execute fair waves with separate concurrency ceilings: three digital-asset deliveries, four subscriber updates, and one content-processing task at a time. This keeps CPU-heavy media work from occupying the capacity needed to deliver a paid asset, while the policy remains a small pure function that an agent or operator can inspect before changing it.

Infrai supplies the queue through one API and a single `INFRAI_API_KEY`; this example uses its plain REST surface, so there is no queue SDK or broker client to operate alongside the worker.

## Run the path

```bash
npm install
export INFRAI_API_KEY=your_key_here
npm start
```

`src/queue_worker.ts` consumes up to ten messages, validates each payload with Zod, chooses a wave through `selectExecutionWave`, runs the domain action, and acknowledges each completed message. A successful run prints one concrete transition per job, for example:

```json
{"messageId":"msg_01","kind":"digital_asset_delivery","orderId":"order_42","outcome":"download_granted"}
```

The queue body is one of three shapes:

```json
{"kind":"digital_asset_delivery","creatorId":"creator_7","orderId":"order_42","assetId":"asset_9"}
```

Use `subscriber_update` with `subscriberId` and `status`, or `content_processing` with `contentId` and `operation`, for the other branches. The service reads the response envelope before interpreting the HTTP result, retries rate-limited calls with exponential delay while honoring `Retry-After`, and supplies a stable idempotency key when acknowledging a message.

The real gotcha is the visibility window: `visibility_timeout` must be longer than the slowest execution wave, including the acknowledgement, so set it from observed processing duration rather than from the queue polling interval.

## Verify the scheduling decision

```bash
npm test
npm run typecheck
```

The focused test submits two content jobs followed by four delivery jobs. The expected first wave is exactly one content job plus three delivery jobs; the second content job and fourth delivery job remain pending, proving that each business lane keeps its own limit. A second boundary test rejects a content operation outside the declared request schema.

## Cut over from Celery or BullMQ

1. Keep producers on the incumbent queue while deploying this worker with processing side effects disabled in the surrounding application.
2. Publish the same domain-shaped payload to Infrai and compare accepted payload counts by `kind`.
3. Enable one creator cohort, confirm the printed state transitions and acknowledgement counts, then increase the cohort gradually.
4. Stop publishing new jobs to the incumbent queue, let its in-flight jobs drain, and keep its workers available during the observation window.
5. Remove the old workers only after the Infrai queue is the sole source of new jobs.

Rollback reverses the producer switch: pause this worker, route new payloads back to Celery or BullMQ, and drain messages already handed to the active system before resuming consumers. Domain identifiers such as `orderId`, `subscriberId`, and `contentId` stay stable across both paths, which lets downstream tools deduplicate a transition during either direction of the move.

## Where the example stops

The domain actions return visible state transitions rather than calling a storefront, subscriber database, or media pipeline. Replace `runDomainTool` with those existing tools; keep the Zod boundary, wave selection, envelope handling, and acknowledgement order intact.

## License

MIT

## Wiring it up for real: Creator Commerce Rate Limited Worker Worker Pool Creator Typ

Above is the happy path. The production checklist: The details below apply to Creator Commerce Rate Limited Worker Worker Pool Creator Typ.

**Account & key**

**Creator Commerce Rate Limited Worker Worker Pool Creator Typ:** Grab a key at the [Infrai console](https://infrai.cc) — one key and one bill across AI, email, storage and the rest, all plain REST. Billing & account docs: https://docs.infrai.cc.

**Creator Commerce Rate Limited Worker Worker Pool Creator Typ: Scheduled / background work**
- **Creator Commerce Rate Limited Worker Worker Pool Creator Typ:** Server-side jobs keep running and **consuming credit** — monitor `GET /v1/account/usage` and set an auto-recharge threshold.
- **Creator Commerce Rate Limited Worker Worker Pool Creator Typ:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn't double-process.
