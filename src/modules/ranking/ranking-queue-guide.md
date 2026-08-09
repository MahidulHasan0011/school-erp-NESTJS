# Ranking Queue — কীভাবে কাজ করে

RabbitMQ দিয়ে ranking job চালানোর পুরো ফ্লো, দোকানের উদাহরণ দিয়ে।

---

## ১. মেডিসিন শপের উদাহরণ

| দোকান | কোড |
|---|---|
| সেলসম্যান | `ranking.controller.ts` |
| যাচাই ("স্টকে আছে?") | `loadClassAndSession`, `assertExamsReady`, `isLocked` |
| স্লিপ লেখা | `payload` object — `ranking.service.ts` → `enqueue()` |
| ট্রে-তে স্লিপ রাখা | `rankingQueue.publish(payload)` |
| ট্রে ১ | `ranking.jobs` queue |
| ট্রে ২ | `roll.jobs` queue |
| পুরো অর্ডার সিস্টেম | RabbitMQ সার্ভার (`amqp://localhost:5672`) |
| স্টোর বয় ১ | `job/ranking.job.ts` → `processRankingJob()` |
| স্টোর বয় ২ | `job/roll.job.ts` → `processRollJob()` |
| হাতের কাজ | `RankingEngine`, `RollEngine` |
| টোকেন বোর্ড | Redis — `ranking:job:<classId>:<sessionId>` |
| বাতিল অর্ডারের বাক্স | DLQ — `ranking.jobs.dlq` |

**RabbitMQ = পুরো সিস্টেম → Queue = ট্রে → Message = একটা স্লিপ (job)**

---

## ২. অ্যাপ চালু হলে কী হয় (একবার)

```
npm run start:dev
   │
   │ ranking.module.ts → providers: [RankingJob, RollJob]
   ▼
Nest instance বানায় (কেউ inject করে না, তাই providers-এ নাম না লিখলে বানাত না)
   │
   │ ওরা OnModuleInit implement করে
   ▼
Nest নিজে onModuleInit() কল করে
   │
   ▼
rabbitmq.registerConsumer('ranking.jobs', payload => processRankingJob(payload))
   │
   ▼
ch.consume() → RabbitMQ-কে বলল "ট্রে-১ ('ranking.jobs') এ স্লিপ এলে আমাকে দিও"
   │
   ▼
📞 পাইপ খোলা রইল — worker RAM-এ or Node প্রসেসের মেমোরিতেই ঘুমিয়ে অপেক্ষা করছে
```

> **queue = ট্রে।** `'ranking.jobs'` = ট্রে-১, `'roll.jobs'` = ট্রে-২ — একই জিনিসের দুই নাম।

**কেন `providers[]`?** → instance জন্ম নেওয়ার জন্য।
**কেন `OnModuleInit`?** → জন্মের পর consumer বসানোর জন্য (constructor-এ নয়, কারণ তখন RabbitMQ connection রেডি নাও থাকতে পারে)। Constructor-এ কেন লিখলাম না? কারণ constructor চলার সময় dependency-গুলো হয়তো এখনো নিজেদের init শেষ করেনি — RabbitMQ connection তখন null থাকতে পারত। onModuleInit চলে সব dependency ready হওয়ার পরে, তাই this.rabbitmq তখন কানেক্টেড।

---

## ৩. queue আর job একে অপরকে চেনে কীভাবে?

**চেনে না।** দুজনেই শুধু একটা নাম চেনে:

```ts
// ranking.constants.ts
export const RANKING_QUEUE = 'ranking.jobs';
```

```
queue/ranking.queue.ts          job/ranking.job.ts
publish('ranking.jobs')         registerConsumer('ranking.jobs')
        │                                │
        └────────► RabbitMQ ◄────────────┘
                নাম মিলিয়ে দেয়
```

ঠিকানার মতো — চিঠি পাঠানোর লোক আর পাওয়ার লোক একে অপরকে না চিনলেও ডাকঘর মিলিয়ে দেয়।

---

## ৪. API হিট করলে পুরো যাত্রা

```
POST /ranking/generate-roll
   │
   ▼ ranking.controller.ts → requestGenerate()
   │  ১. যাচাই: ক্লাস/সেশন আছে? FINAL exam PUBLISHED? locked নয় তো?
   │  ২. Redis-এ লিখল: status = "queued"
   │  ৩. publish ──TCP──► RabbitMQ         ← "এই bytes রাখো"
   │  ৪. ২০২ Accepted ফেরত (ইউজার অপেক্ষা করে না)
   │
   ▼ RabbitMQ ডিস্কে সেভ করল (persistent) — এখন message নিরাপদ
   │
   ▼ RabbitMQ ──TCP──► অ্যাপ                ← "এই নাও" (push)
   │
   ▼ rabbitmq.service.ts → handleMessage() → JSON.parse → handler(payload)
   │
   ▼ ranking.service.ts → processRankingJob()          [STEP 1]
   │  Redis: "processing / ranking"
   │  RankingEngine.buildCombinedRanking() ← নম্বর যোগ করে র‍্যাংক লিস্ট
   │  rollQueue.publish({...payload, rankedList}) ── ট্রে-২ তে নতুন স্লিপ
   │  ACK ──► RabbitMQ message মুছল ✅
   │
   ▼ (একই চক্র আবার, roll.jobs queue-এ)
   │
   ▼ ranking.service.ts → processRollJob()             [STEP 2]
      Redis: "processing / roll"
      RollEngine.generateRolls() ← roll বসানো + history + lock + audit (এক transaction)
      Redis: "completed, version 3, 120 জন" ✅
```
```
TCP = Node.js App আর RabbitMQ-এর মধ্যে data যাওয়া-আসার রাস্তা।
আর RabbitMQ = সেই রাস্তা দিয়ে message নিয়ে queue/worker-এর মধ্যে কাজ করায়।
TCP = Transmission Control Protocol
```

---

## ৪ক. একই যাত্রা, বাস্তব ডেটা দিয়ে

### ধাপ ১ — ইউজার যা পাঠাল

```http
POST /ranking/generate-roll
Authorization: Bearer eyJhbGci...
Content-Type: application/json

{
  "classId": "3f2b1c9e-7a44-4c81-9d3e-51f0a2b6c7d8",
  "academicSessionId": "a91e4d20-6c35-4f7b-8e12-9c4d5a6b7e30"
}
```

### ধাপ ২ — `enqueue()` স্লিপ (payload) বানাল

`triggeredBy` ইউজার পাঠায়নি — JWT থেকে `@CurrentUser('id')` দিয়ে আসে।

```ts
const payload: RankingJobPayload = {
  action: 'GENERATE',
  classId: '3f2b1c9e-7a44-4c81-9d3e-51f0a2b6c7d8',
  academicSessionId: 'a91e4d20-6c35-4f7b-8e12-9c4d5a6b7e30',
  triggeredBy: 'd7c8e9f0-1234-4a5b-9c6d-7e8f90a1b2c3',
};
```

### ধাপ ৩ — "bytes" মানে কী?

TCP তার দিয়ে JavaScript object পাঠানো যায় না, শুধু **কাঁচা বাইট** যায়। তাই object কে আগে string, তারপর Buffer (বাইটের সারি) বানানো হয় — `rabbitmq.service.ts` → `encode()`:

```ts
Buffer.from(JSON.stringify(payload))
```

```
JS object                    →  string (JSON)                  →  bytes (Buffer)
{ action: 'GENERATE', ... }     '{"action":"GENERATE",...}'       7b 22 61 63 74 69 6f 6e ...
                                                                   {  "  a  c  t  i  o  n
```

**অর্থাৎ "bytes" = আপনার payload-ই, শুধু তারে পাঠানোর উপযোগী রূপে।** নতুন কিছু নয়।

### ধাপ ৪ — RabbitMQ ডিস্কে যা সেভ থাকে

```
Queue: ranking.jobs
┌─────────────────────────────────────────────────────────┐
│ body:    {"action":"GENERATE",                          │  ← এই bytes-টাই
│           "classId":"3f2b1c9e-...",                     │
│           "academicSessionId":"a91e4d20-...",           │
│           "triggeredBy":"d7c8e9f0-..."}                 │
│                                                          │
│ headers: { "x-attempts": 0 }        ← কত নম্বর চেষ্টা   │
│ props:   { deliveryMode: 2 }        ← persistent, ডিস্কে │
└─────────────────────────────────────────────────────────┘
```

`x-attempts` আর `deliveryMode` আপনার payload-এর অংশ নয় — RabbitMQ-র নিজের খামের উপরের লেখা। `publish()` এগুলো বসিয়ে দেয়।

### ধাপ ৫ — Push হওয়ার সময় যা আসে

RabbitMQ ওই খামটাই ফেরত পাঠায়, `msg` object আকারে:

```ts
msg = {
  content: <Buffer 7b 22 61 63 ...>,          // সেই bytes
  fields:  { deliveryTag: 1, routingKey: 'ranking.jobs' },
  properties: { headers: { 'x-attempts': 0 }, deliveryMode: 2 },
}
```

`handleMessage()` এখান থেকে দুইটা জিনিস নেয়:

```ts
const attempts = Number(msg.properties.headers?.['x-attempts'] ?? 0);  // 0
const payload = JSON.parse(msg.content.toString());                    // ↓ object আবার
```

### ধাপ ৬ — `handler(payload)` যা পায়

**ধাপ ২-এ যা লিখেছিলাম, হুবহু সেটাই ফেরত** — গোল সম্পূর্ণ:

```ts
{
  action: 'GENERATE',
  classId: '3f2b1c9e-7a44-4c81-9d3e-51f0a2b6c7d8',
  academicSessionId: 'a91e4d20-6c35-4f7b-8e12-9c4d5a6b7e30',
  triggeredBy: 'd7c8e9f0-1234-4a5b-9c6d-7e8f90a1b2c3',
}
```

```
object → string → bytes → [RabbitMQ ডিস্ক] → bytes → string → object
       encode()                                          JSON.parse()
```

### ধাপ ৭ — STEP 2-এর স্লিপ (ট্রে-২)

`processRankingJob()` একই payload-এর সাথে `rankedList` জুড়ে দিয়ে `roll.jobs`-এ পাঠায়:

```ts
{
  action: 'GENERATE',
  classId: '3f2b1c9e-...',
  academicSessionId: 'a91e4d20-...',
  triggeredBy: 'd7c8e9f0-...',
  rankedList: [
    { studentId: 'b1c2...', rankPosition: 1, totalScore: 987.5 },
    { studentId: 'e5f6...', rankPosition: 2, totalScore: 971.0 },
    // ... ১২০ জন
  ],
}
```

শুধু এই তিনটা field পাঠানো হয় (`RollListEntry`), পুরো `RankedEntry` নয় — message ছোট রাখতে, কারণ প্রতিটা retry-তে আরেকটা কপি জমে।

### ধাপ ৮ — ফেল করলে খামটা কেমন হয়

```
Queue: ranking.jobs.dlq
┌─────────────────────────────────────────────────────────┐
│ body:    (হুবহু একই — payload বদলায় না)                │
│ headers: { "x-attempts": 3,                             │
│            "x-error": "FINAL exam result missing" }     │
└─────────────────────────────────────────────────────────┘
```

`GET /ranking/dlq` ঠিক এটাই দেখায় — `attempts`, `error`, আর parse করা `payload`।

---

## ৫. দুইটা দিক গুলিয়ে ফেলবেন না

```
PUBLISH   অ্যাপ ──TCP──► RabbitMQ    "এই bytes রাখো"
PUSH      RabbitMQ ──TCP──► অ্যাপ    "এই নাও"
```

আর worker **pull করে না** — খোঁজেও না, জিজ্ঞেসও করে না। সে নাম লিখিয়ে ঘুমায়, RabbitMQ ডেকে তোলে।

---

## ৬. ACK — কাজ কেন হারায় না

ACK না পাঠানো পর্যন্ত RabbitMQ message **মুছে না**, শুধু "কারো হাতে দেওয়া" (unacked) অবস্থায় রাখে।

```
কাজ সফল  → ACK → message মুছে গেল ✅
কাজ ফেল  → delay queue → 2s → 4s → 8s (backoff + jitter), মোট ৩ বার
৩ বারেও ফেল → DLQ (ranking.jobs.dlq) — error message সহ পার্ক
অ্যাপ ক্র্যাশ → ACK আসেনি → RabbitMQ message ফেরত দেয়
```

DLQ দেখা: `GET /ranking/dlq` · আবার চালানো: `POST /ranking/dlq/replay`

---

## ৭. Redis-এর ভূমিকা (আলাদা জিনিস)

Redis কাজ চালায় না — শুধু **স্ট্যাটাস বোর্ড**।

```
key:   ranking:job:<classId>:<academicSessionId>     ← jobKey()
value: {"status":"processing","stage":"roll","at":"..."}
TTL:   ২৪ ঘণ্টা
```

`setJobStatus()` লেখে, `getJobStatus()` পড়ে → `GET /ranking/:classId/:academicSessionId/job-status`

key একই থাকে, তাই প্রতিবার **overwrite** হয় — শুধু সর্বশেষ অবস্থা থাকে, ইতিহাস নয়।
ইতিহাস ডাটাবেজে: `GET .../history`, `GET .../audit`

**`trySetJobStatus()` কেন?** কাজ commit হওয়ার পর status লিখতে গিয়ে error হলে throw করলে RabbitMQ পুরো job আবার চালাত → ডাবল version তৈরি হতো। status হারানো তুচ্ছ, কাজ দুইবার হওয়া নয়।

---

## ৮. ফাইল ম্যাপ

```
src/modules/ranking/
├── ranking.controller.ts     HTTP নেয়, ২০২ ফেরত দেয়
├── ranking.service.ts        যাচাই + enqueue + processRankingJob/processRollJob
├── ranking.constants.ts      RANKING_QUEUE / ROLL_QUEUE নাম (আসল জোড়া লাগানোর সুতো)
├── ranking.module.ts         providers[] — Job গুলো এখানে না লিখলে consumer বসবে না
├── queue/
│   ├── ranking.queue.ts      producer — ট্রে-১ এ রাখে
│   └── roll.queue.ts         producer — ট্রে-২ এ রাখে
├── job/
│   ├── ranking.job.ts        consumer — onModuleInit-এ বসে
│   └── roll.job.ts           consumer — onModuleInit-এ বসে
└── engine/
    ├── ranking.engine.ts     ভারী হিসাব — র‍্যাংক
    └── roll.engine.ts        roll assign + transaction

src/common/rabbitmq/rabbitmq.service.ts
    publish / registerConsumer / handleMessage / retry / DLQ
```

---

## এক লাইনে

সেলসম্যান স্লিপ লিখে ট্রে-তে রেখেই কাস্টমারকে বিদায় করে দেয় (২০২);
ট্রে-র পাশে আগে থেকেই দাঁড়ানো স্টোর বয়কে RabbitMQ স্লিপ ধরিয়ে দেয়;
স্টোর বয় কাজ শেষে ACK দিলে তবেই স্লিপ মোছে;
আর কাস্টমার Redis-এর বোর্ড দেখে বোঝে তার অর্ডার কতদূর।
