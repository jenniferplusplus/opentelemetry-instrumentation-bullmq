const ns = 'messaging.bullmq';
const job = `${ns}.job`
const queue = `${ns}.queue`
const worker = `${ns}.worker`

export const BullMQAttributes = {
  MESSAGING_SYSTEM: 'BullMQ',
  JOB_NAME: `${job}.name`,
  JOB_OPTS: `${job}.opts`,
  JOB_TIMESTAMP: `${job}.timestamp`,
  JOB_PARENT_KEY: `${job}.parentOpts.parentKey`,
  JOB_WAIT_CHILDREN_KEY: `${job}.parentOpts.waitChildrenKey`,
  JOB_BULK_NAMES: `${job}.bulk.names`,
  JOB_BULK_COUNT: `${job}.bulk.count`,
  QUEUE_NAME: `${queue}.name`,
}
