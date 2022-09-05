const ns = 'messaging.bullmq';
const job = `${ns}.job`
const queue = `${ns}.queue`
const worker = `${ns}.worker`

export const BullMQAttributes = {
  MESSAGING_SYSTEM: 'BullMQ',
  JOB_ATTEMPTS: `${job}.attempts`,
  JOB_DELAY: `${job}.delay`,
  JOB_FAILED_REASON: `${job}.failedReason`,
  JOB_FINISHED_TIMESTAMP: `${job}.finishedOn`,
  JOB_PROCESSED_TIMESTAMP: `${job}.processedOn`,
  JOB_NAME: `${job}.name`,
  JOB_OPTS: `${job}.opts`,
  JOB_REPEAT_KEY: `${job}.repeatJobKey`,
  JOB_TIMESTAMP: `${job}.timestamp`,
  JOB_PARENT_KEY: `${job}.parentOpts.parentKey`,
  JOB_WAIT_CHILDREN_KEY: `${job}.parentOpts.waitChildrenKey`,
  JOB_BULK_NAMES: `${job}.bulk.names`,
  JOB_BULK_COUNT: `${job}.bulk.count`,
  QUEUE_NAME: `${queue}.name`,
  WORKER_NAME: `${worker}.name`,
  WORKER_CONCURRENCY: `${worker}.concurrency`,
  WORKER_LOCK_DURATION: `${worker}.lockDuration`,
  WORKER_LOCK_RENEW: `${worker}.lockRenewTime`,
  WORKER_RATE_LIMIT_MAX: `${worker}.rateLimiter.max`,
  WORKER_RATE_LIMIT_DURATION: `${worker}.rateLimiter.duration`,
  WORKER_RATE_LIMIT_GROUP: `${worker}.rateLimiter.groupKey`,
}
