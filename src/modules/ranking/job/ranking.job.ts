import { Injectable, OnModuleInit } from '@nestjs/common';
import { RabbitMQService } from '../../../common/rabbitmq/rabbitmq.service';
import { RANKING_QUEUE, RankingJobPayload } from '../ranking.constants';
import { RankingService } from '../ranking.service';

/**
 * STEP 1 worker — ranking queue থেকে job নিয়ে rankedList তৈরি করে
 * (RankingService.processRankingJob → RankingEngine), তারপর roll queue-তে পাঠায়।
 * ব্যর্থ হলে RabbitMQ exponential-backoff retry (৩ বার), তারপর DLQ।
 * (পুরনো `jobs/ranking.job.js`-এর সমতুল্য।)
 */
@Injectable()
export class RankingJob implements OnModuleInit {
  constructor(
    private readonly rabbitmq: RabbitMQService,
    private readonly rankingService: RankingService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.rabbitmq.registerConsumer<RankingJobPayload>(
      RANKING_QUEUE, //Consumer queue name
      (payload) => this.rankingService.processRankingJob(payload),
      { maxAttempts: 3, baseDelayMs: 2000 },
    );
  }
}
