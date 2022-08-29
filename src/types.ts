import * as bullmq from 'bullmq';

export const QueueAdd = typeof bullmq.Queue.prototype.add;
export const Worker = typeof bullmq.Worker;
