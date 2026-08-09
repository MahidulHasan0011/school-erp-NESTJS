
# step 1

 **RabbitMQ-এর ভিতরে Queue থাকে, আর Queue-এর ভিতরে Job (বা Message) থাকে।**

মানে সম্পর্কটা এমন:

```text
RabbitMQ
│
├── ranking_queue
│     ├── Job 1
│     ├── Job 2
│     └── Job 3
│
├── roll_queue
│     ├── Job 1
│     └── Job 2
│
└── email_queue
      ├── Job 1
      └── Job 2
```

এখন তোমার **মেডিসিন শপের উদাহরণ** দিয়ে দেখি।

---

## Step 1: তুমি দোকানে গেলে

তুমি বললে,

> "৪টা Napa আর ২টা Mexpro দিন।"

এটা Controller-এর কাছে Request যাওয়ার মতো।

```text
Customer
    │
    ▼
Salesman (Controller)
```

---

## Step 2: Salesman কী করল?

Salesman নিজে ওষুধ আনতে গেল না।

সে একটি **স্লিপ** লিখল।

স্লিপে লিখল:

```json
{
  "napa": 4,
  "mexpro": 2
}
```

**এই স্লিপটাই হলো Job (Message)।**

অর্থাৎ,

> "৪টা Napa + ২টা Mexpro" **Queue নয়**, **এটাই Job**।

---

## Step 3: স্লিপ কোথায় রাখল?

দোকানে একটা ট্রে আছে যেখানে সব অর্ডারের স্লিপ রাখা হয়।

```
Medicine Order Queue

-------------------------
Job 1
Napa 4
Mexpro 2

-------------------------
Job 2
Seclo 1
Ace 10

-------------------------
Job 3
Monas 2
```

এই ট্রেটাই হলো **Queue**।

---

## Step 4: RabbitMQ কী?

RabbitMQ হলো পুরো দোকানের অর্ডার ম্যানেজার।

এর ভিতরে অনেক Queue থাকতে পারে।

```
RabbitMQ

├── medicine_queue
│      Job 1
│      Job 2
│
├── payment_queue
│      Job 1
│
└── sms_queue
       Job 1
       Job 2
```

অর্থাৎ,

* RabbitMQ = পুরো সিস্টেম
* Queue = নির্দিষ্ট লাইনের অর্ডার রাখার জায়গা
* Job/Message = প্রতিটি অর্ডার

---

## তোমার উদাহরণে Mapping

| বাস্তব উদাহরণ               | RabbitMQ                |
| --------------------------- | ----------------------- |
| Salesman                    | `ranking.controller.ts` |
| "৪টা Napa, ২টা Mexpro"      | **Job (Message)**       |
| অর্ডারের ট্রে               | **Queue**               |
| পুরো দোকানের অর্ডার সিস্টেম | **RabbitMQ**            |
| Store Boy ওষুধ এনে দেয়     | **Worker/Consumer**     |

### এক লাইনে মনে রাখো

* **RabbitMQ-এর মধ্যে অনেক Queue থাকে।**
* **প্রতিটি Queue-এর মধ্যে অনেক Job (Message) থাকে।**
* **একটি Job = একটি কাজ বা একটি Request।**

তাই তোমার উদাহরণে **"৪টা Napa + ২টা Mexpro" একটি Job**, আর সেই Job-টি `medicine_queue` নামের একটি Queue-এর মধ্যে রাখা হবে।













# step 2 

# RabbitMQ আসলে কী?

RabbitMQ হলো একটি **Message Broker**। সহজ ভাষায়, এটি একটি **ডাকঘর** বা **কুরিয়ার সার্ভিসের** মতো কাজ করে। এর একমাত্র দায়িত্ব হলো Producer থেকে Message (Job) গ্রহণ করা, সঠিক Queue-তে রাখা এবং পরে Consumer-এর কাছে পৌঁছে দেওয়া।

একটি RabbitMQ Flow সাধারণত এমন হয়:

```text
Producer
    │
    ▼
Exchange
    │
    ▼
Queue
    │
    ▼
Consumer
```

## আমাদের প্রজেক্টে এর Mapping

| ভূমিকা   | আমাদের কোড                                                                 |
| -------- | -------------------------------------------------------------------------- |
| Producer | `queue/ranking.queue.ts`, `queue/roll.queue.ts` — শুধু `publish()` করে     |
| Exchange | `app.jobs` — `rabbitmq.service.ts`-এ তৈরি করা Direct Exchange              |
| Queue    | `ranking.jobs`, `roll.jobs` — `ranking.constants.ts`-এ সংজ্ঞায়িত          |
| Consumer | `job/ranking.job.ts`, `job/roll.job.ts` — Queue থেকে Job নিয়ে Process করে |

---

# RabbitMQ-এর ভিতরে কী থাকে?

অনেকে মনে করেন RabbitMQ-এর ভিতরে শুধু Job থাকে। আসলে তা নয়।

```text
RabbitMQ Server
│
├── Exchange
│
├── ranking.jobs Queue
│      ├── Job 1
│      ├── Job 2
│      └── Job 3
│
└── roll.jobs Queue
       ├── Job 1
       └── Job 2
```

অর্থাৎ,

* RabbitMQ-এর ভিতরে একাধিক **Exchange** থাকতে পারে।
* প্রতিটি Exchange থেকে Message নির্দিষ্ট **Queue**-তে যায়।
* প্রতিটি Queue-এর ভিতরে অনেকগুলো **Job (Message)** জমা থাকে।
* Consumer Queue থেকে একে একে Job নিয়ে Process করে।

---

# Channel কেন তিনটি?

AMQP-তে একটি Channel-এ বড় কোনো Error হলে পুরো Channel বন্ধ হয়ে যেতে পারে। তাই Publish, Consume এবং Temporary কাজগুলো আলাদা Channel-এ রাখা হয়।

| Channel           | কাজ                                                        |
| ----------------- | ---------------------------------------------------------- |
| `pubChannel`      | Message Publish করে (Confirm Channel)                      |
| `subChannel`      | Message Consume করে এবং `ack()` / `nack()` পাঠায়          |
| Temporary Channel | DLQ Peek, Replay বা বিশেষ কাজের জন্য অস্থায়ীভাবে তৈরি হয় |

এভাবে একটি Channel নষ্ট হলেও অন্য Channel স্বাভাবিকভাবে কাজ করতে পারে।

---

# কেন RabbitMQ ব্যবহার করা হয়?

ধরুন একজন User "Generate Ranking" বাটনে ক্লিক করল।

Controller যদি নিজেই Ranking Calculate শুরু করে, তাহলে User-কে কয়েক মিনিট অপেক্ষা করতে হবে এবং Request Timeout হওয়ার সম্ভাবনা থাকবে।

কিন্তু RabbitMQ ব্যবহার করলে—

1. Controller শুধু একটি Job Publish করে।
2. RabbitMQ সেই Job Queue-তে সংরক্ষণ করে।
3. Worker পরে Queue থেকে Job নিয়ে Process করে।
4. User সঙ্গে সঙ্গে Response পায় যে Request গ্রহণ করা হয়েছে।

---

# Durable Queue এবং Persistent Message

RabbitMQ-তে সাধারণত দুটি গুরুত্বপূর্ণ Setting ব্যবহার করা হয়।

* `durable: true` → Queue Server Restart হলেও থেকে যায়।
* `persistent: true` → Queue-এর ভিতরের Message-ও Disk-এ সংরক্ষিত থাকে।

ফলে RabbitMQ Restart হলেও অসমাপ্ত Job হারিয়ে যায় না। Worker আবার চালু হলে সেই Job-গুলো পুনরায় Process করতে পারে।

---

## এক লাইনে মনে রাখো

> **RabbitMQ হলো Message Broker।**
>
> **Exchange Message গ্রহণ করে → Queue-তে পাঠায় → Queue Job জমিয়ে রাখে → Consumer সেই Job নিয়ে কাজ সম্পন্ন করে।**











দুটি method-এর call path বের করছি, তারপর Bangla-তে সংক্ষেপে “where / when / why” ব্যাখ্যা দেব। আগে কোথা থেকে invoke হচ্ছে সেটা নিশ্চিত করে নিই যাতে ভুল ধারণা না দিই।

এখন worker/job files আর controller-এর endpoint গুলো দেখছি, যাতে trigger path আর purpose পরিষ্কারভাবে বলতে পারি। এরপর Bangla-তে সরাসরি map করে দেব।

processRankingJob আর processRollJob দুটোই manual request থেকে সরাসরি না, বরং RabbitMQ worker-এর মাধ্যমে background-এ চলে। কোথায় ব্যবহার হয়, কখন চালু হয়, আর কেন আলাদা করা হয়েছে তা নিচে দিলাম।

processRankingJob আছে ranking.service.ts:144, আর এটাকে worker হিসেবে register করা হয়েছে ranking.job.ts:1.
processRollJob আছে ranking.service.ts:199, আর এটাকে worker হিসেবে register করা হয়েছে roll.job.ts:1.
কবে চালু হয়:

ইউজার POST /ranking/generate-roll মারলে controller থেকে ranking.controller.ts:21 → requestGenerate() → ranking queue-তে job যায় → তারপর RabbitMQ consumer processRankingJob() চালায়।
ইউজার POST /ranking/recalculate মারলেও ranking.controller.ts:29 → requestRecalculate() → ranking queue-তে job যায় → processRankingJob() চালায়।
processRankingJob() শেষ হলে এটা rollQueue.publish(...) করে, আর সেই roll queue-এর consumer processRollJob() চালায়।
কেন ব্যবহার হয়:

processRankingJob first step: studentদের combined ranking compute করে, তারপর ছোট payload (rankedList) roll queue-তে পাঠায়।
processRollJob second step: ওই ranked list থেকে roll assign করে, history লেখে, lock বসায়, audit log করে।
এই split করার কারণে কাজটা background-এ হয়, HTTP request block হয় না, retry/DLQ সহজ হয়, আর heavy calculation আর transactional roll assignment আলাদা থাকে।
সংক্ষেপে flow:
API request → requestGenerate/requestRecalculate → ranking queue → processRankingJob → roll queue → processRollJob

আরও ছোট করে বললে:

processRankingJob = ranking হিসাব করা
processRollJob = roll assign + save + lock + audit করা
চাইলে আমি এটা এখন Bangla flowchart আকারে ৫-৬ লাইনে দেখাতে পারি।