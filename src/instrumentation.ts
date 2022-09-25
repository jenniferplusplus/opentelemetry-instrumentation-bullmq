import {
  InstrumentationBase,
  InstrumentationConfig,
  InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import {SemanticAttributes} from '@opentelemetry/semantic-conventions';
import type {Attributes, Span} from '@opentelemetry/api'
import {context, propagation, SpanKind, SpanStatusCode, trace} from '@opentelemetry/api';
import type * as bullmq from 'bullmq';
import type {
  FlowJob,
  FlowOpts,
  FlowProducer,
  Job,
  JobNode,
  JobsOptions,
  ParentOpts,
  Queue,
  Worker,
} from 'bullmq';
import {flatten} from 'flat';

import {VERSION} from './version';
import {BullMQAttributes} from './attributes';

declare type Fn = (...args: any[]) => any;

export class Instrumentation extends InstrumentationBase {
  constructor(config: InstrumentationConfig = {}) {
    super('opentelemetry-instrumentation-bullmq', VERSION, config);
  }

  /**
   * Init method will be called when the plugin is constructed.
   * It returns an `InstrumentationNodeModuleDefinition` which describes
   *   the node module to be instrumented and patched.
   * It may also return a list of `InstrumentationNodeModuleDefinition`s if
   *   the plugin should patch multiple modules or versions.
   */
  protected init() {
    return new InstrumentationNodeModuleDefinition<typeof bullmq>(
      'bullmq',
      ['1.*'],
      this._onPatchMain(),
      this._onUnPatchMain(),
    );
  }

  private _onPatchMain() {
    return (moduleExports: typeof bullmq) => {
      // As Spans
      this._wrap(moduleExports.Queue.prototype, 'add', this._patchQueueAdd());
      this._wrap(moduleExports.Queue.prototype, 'addBulk', this._patchQueueAddBulk());
      this._wrap(moduleExports.FlowProducer.prototype, 'add', this._patchFlowProducerAdd())
      this._wrap(moduleExports.FlowProducer.prototype, 'addBulk', this._patchFlowProducerAddBulk())
      this._wrap(moduleExports.Job.prototype, 'addJob', this._patchAddJob());

      // @ts-expect-error
      this._wrap(moduleExports.Worker.prototype, 'callProcessJob', this._patchCallProcessJob());
      this._wrap(moduleExports.Worker.prototype, 'run', this._patchWorkerRun());

      // As Events
      this._wrap(moduleExports.Job.prototype, 'extendLock', this._patchExtendLock());
      this._wrap(moduleExports.Job.prototype, 'remove', this._patchRemove());
      this._wrap(moduleExports.Job.prototype, 'retry', this._patchRetry());

      return moduleExports;
    }
  }

  private _onUnPatchMain() {
    return (moduleExports: typeof bullmq) => {
      this._unwrap(moduleExports.Queue.prototype, 'add');
      this._unwrap(moduleExports.Queue.prototype, 'addBulk');
      this._unwrap(moduleExports.FlowProducer.prototype, 'add')
      this._unwrap(moduleExports.FlowProducer.prototype, 'addBulk')
      this._unwrap(moduleExports.Job.prototype, 'addJob');

      // @ts-expect-error
      this._unwrap(moduleExports.Worker.prototype, 'callProcessJob');
      this._unwrap(moduleExports.Worker.prototype, 'run');

      this._unwrap(moduleExports.Job.prototype, 'extendLock');
      this._unwrap(moduleExports.Job.prototype, 'remove');
      this._unwrap(moduleExports.Job.prototype, 'retry');
    }
  }

  private _patchAddJob(): (original: Function) => (...args: any) => any {
    const instrumentation = this;
    const tracer = instrumentation.tracer;
    const action = 'Job.addJob';

    return function addJob(original) {
      return async function patch(this:Job, client: never, parentOpts?: ParentOpts): Promise<string> {
        const spanName = `${this.queueName}.${this.name} ${action}`;
        // this.opts = this.opts ?? {};
        const span = tracer.startSpan(spanName, {
          attributes: {
            [SemanticAttributes.MESSAGING_SYSTEM]: BullMQAttributes.MESSAGING_SYSTEM,
            [SemanticAttributes.MESSAGING_DESTINATION]: this.queueName,
            [BullMQAttributes.JOB_NAME]: this.name,
            ...Instrumentation.attrMap(BullMQAttributes.JOB_OPTS, this.opts),
          },
          kind: SpanKind.PRODUCER
        });
        if (parentOpts) {
          span.setAttributes({
            [BullMQAttributes.JOB_PARENT_KEY]: parentOpts.parentKey ?? 'unknown',
            [BullMQAttributes.JOB_WAIT_CHILDREN_KEY]: parentOpts.waitChildrenKey ?? 'unknown',
          });
        }
        const parentContext = context.active();
        const messageContext = trace.setSpan(parentContext, span);
        const prop = propagation;

        propagation.inject(messageContext, this.opts);
        return await context.with(messageContext, async () => {
          try {
            return await original.apply(this, [client, parentOpts]);
          } catch (e) {
            throw Instrumentation.setError(span, e as Error);
          } finally {
            span.setAttribute(SemanticAttributes.MESSAGE_ID, this.id ?? 'unknown');
            span.setAttribute(BullMQAttributes.JOB_TIMESTAMP, this.timestamp)
            span.end();
          }
        });
      }
    }
  }

  private _patchQueueAdd(): (original: Function) => (...args: any) => any {
    const instrumentation = this;
    const tracer = instrumentation.tracer;
    const action = 'Queue.add';

    return function add(original) {
      return async function patch(this: Queue, ...args: any): Promise<Job> {
        const [name] = [...args];

        const spanName = `${this.name}.${name} ${action}`;
        const span = tracer.startSpan(spanName, {
          attributes: {
            [SemanticAttributes.MESSAGING_SYSTEM]: BullMQAttributes.MESSAGING_SYSTEM,
            [SemanticAttributes.MESSAGING_DESTINATION]: this.name,
            [BullMQAttributes.JOB_NAME]: name,
          },
          kind: SpanKind.INTERNAL
        });

        return Instrumentation.withContext(this, original, span, args);
      };
    };
  }

  private _patchQueueAddBulk(): (original: Function) => (...args: any) => any {
    const instrumentation = this;
    const tracer = instrumentation.tracer;
    const action = 'Queue.addBulk';

    return function addBulk(original) {
      return async function patch(this: bullmq.Queue, ...args: bullmq.Job[]): Promise<bullmq.Job[]> {
        const names = args.map(job => job.name);

        const spanName = `${this.name} ${action}`;
        const span = tracer.startSpan(spanName, {
          attributes: {
            [SemanticAttributes.MESSAGING_SYSTEM]: BullMQAttributes.MESSAGING_SYSTEM,
            [SemanticAttributes.MESSAGING_DESTINATION]: this.name,
            [BullMQAttributes.JOB_BULK_NAMES]: names,
            [BullMQAttributes.JOB_BULK_COUNT]: names.length,
          },
          kind: SpanKind.INTERNAL
        });

        return Instrumentation.withContext(this, original, span, args);
      };
    };
  }

  private _patchFlowProducerAdd(): (original: Function) => (...args: any) => any {
    const instrumentation = this;
    const tracer = instrumentation.tracer;
    const action = 'FlowProducer.add';

    return function add(original) {
      return async function patch(this: FlowProducer, flow: FlowJob, opts?: FlowOpts): Promise<JobNode> {
        const spanName = `${flow.queueName}.${flow.name} ${action}`;
        const span = tracer.startSpan(spanName, {
          attributes: {
            [SemanticAttributes.MESSAGING_SYSTEM]: BullMQAttributes.MESSAGING_SYSTEM,
            [SemanticAttributes.MESSAGING_DESTINATION]: flow.queueName,
            [BullMQAttributes.JOB_NAME]: flow.name,
          },
          kind: SpanKind.INTERNAL
        });

        return Instrumentation.withContext(this, original, span, [flow, opts])
      };
    };
  }

  private _patchFlowProducerAddBulk(): (original: Function) => (...args: any) => any {
    const instrumentation = this;
    const tracer = instrumentation.tracer;
    const action = 'FlowProducer.addBulk';

    return function addBulk(original) {
      return async function patch(this: FlowProducer, ...args): Promise<JobNode> {
        const spanName = `${action}`;
        const span = tracer.startSpan(spanName, {
          attributes: {
            [SemanticAttributes.MESSAGING_SYSTEM]: BullMQAttributes.MESSAGING_SYSTEM,
          },
          kind: SpanKind.INTERNAL
        });

        return Instrumentation.withContext(this, original, span, args);
      };
    };
  }

  private _patchCallProcessJob(): (original: Function) => (...args: any) => any {
    const instrumentation = this;
    const tracer = instrumentation.tracer;

    return function patch(original) {
      return async function callProcessJob(this: Worker, job: any, ...rest: any[]){
        const workerName = this.name ?? 'anonymous';
        const currentContext = context.active();
        const parentContext = propagation.extract(currentContext, job.opts);

        const spanName = `${job.queueName}.${job.name} Worker.${workerName} #${job.attemptsMade + 1}`;
        const span = tracer.startSpan(spanName, {
          attributes: {
            [SemanticAttributes.MESSAGING_SYSTEM]: [BullMQAttributes.MESSAGING_SYSTEM],
            [SemanticAttributes.MESSAGING_CONSUMER_ID]: workerName,
            [SemanticAttributes.MESSAGING_MESSAGE_ID]: job.id ?? 'unknown',
            [SemanticAttributes.MESSAGING_OPERATION]: 'receive',
            [BullMQAttributes.JOB_NAME]: job.name,
            [BullMQAttributes.JOB_ATTEMPTS]: job.attemptsMade,
            [BullMQAttributes.JOB_TIMESTAMP]: job.timestamp,
            [BullMQAttributes.JOB_DELAY]: job.delay,
            ...Instrumentation.attrMap(BullMQAttributes.JOB_OPTS, job.opts),
            [BullMQAttributes.QUEUE_NAME]: job.queueName,
            [BullMQAttributes.WORKER_NAME]: workerName,
          },
          kind: SpanKind.CONSUMER
        }, parentContext);
        if (job.repeatJobKey) span.setAttribute(BullMQAttributes.JOB_REPEAT_KEY, job.repeatJobKey);

        return await context.with(currentContext, async () => {
          try {
            return await original.apply(this, [job, ...rest]);
          } catch (e) {
            throw Instrumentation.setError(span, e as Error);
          } finally {
            if (job.finishedOn) span.setAttribute(BullMQAttributes.JOB_FINISHED_TIMESTAMP, job.finishedOn);
            if (job.processedOn) span.setAttribute(BullMQAttributes.JOB_PROCESSED_TIMESTAMP, job.processedOn);
            if (job.failedReason) span.setAttribute(BullMQAttributes.JOB_FAILED_REASON, job.failedReason);

            span.end();
          }
        });
      }
    }
  }

  private _patchWorkerRun(): (original: Function) => (...args: any) => any {
    const instrumentation = this;
    const tracer = instrumentation.tracer;
    const action = 'Worker.run';

    return function run(original) {
      return async function patch(this: Worker, ...args: any): Promise<any> {
        const spanName = `${this.name} ${action}`;
        const span = tracer.startSpan(spanName, {
          attributes: {
            [SemanticAttributes.MESSAGING_SYSTEM]: BullMQAttributes.MESSAGING_SYSTEM,
            [BullMQAttributes.WORKER_NAME]: this.name,
            [BullMQAttributes.WORKER_CONCURRENCY]: this.opts?.concurrency ?? 1,
            [BullMQAttributes.WORKER_LOCK_DURATION]: this.opts?.lockDuration ?? 0,
            [BullMQAttributes.WORKER_LOCK_RENEW]: this.opts?.lockRenewTime ?? 0,
            [BullMQAttributes.WORKER_RATE_LIMIT_MAX]: this.opts?.limiter?.max ?? 'none',
            [BullMQAttributes.WORKER_RATE_LIMIT_DURATION]: this.opts?.limiter?.duration ?? 'none',
            [BullMQAttributes.WORKER_RATE_LIMIT_GROUP]: this.opts?.limiter?.groupKey ?? 'none',
          },
          kind: SpanKind.INTERNAL
        });

        return Instrumentation.withContext(this, original, span, args);
      };
    };
  }

  private _patchExtendLock(): (original: Fn) => (...args: any) => any {
    return function extendLock<T extends Fn>(original: T) {
      return function patch(this: Job, ...args: any): Promise<ReturnType<T>> {
        const span = trace.getSpan(context.active());
        span?.addEvent('extendLock', {
          [BullMQAttributes.JOB_NAME]: this.name,
          [BullMQAttributes.JOB_TIMESTAMP]: this.timestamp,
          [BullMQAttributes.JOB_PROCESSED_TIMESTAMP]: this.processedOn ?? 'unknown',
          [BullMQAttributes.JOB_ATTEMPTS]: this.attemptsMade
        });

        return original(...args);
      };
    };
  }

  private _patchRemove(): (original: Fn) => (...args: any) => any {
    return function extendLock<T extends Fn>(original: T) {
      return function patch(this: Job, ...args: any): Promise<ReturnType<T>> {
        const span = trace.getSpan(context.active());
        span?.addEvent('remove', {
          [BullMQAttributes.JOB_NAME]: this.name,
          [BullMQAttributes.JOB_TIMESTAMP]: this.timestamp,
          [BullMQAttributes.JOB_PROCESSED_TIMESTAMP]: this.processedOn ?? 'unknown',
          [BullMQAttributes.JOB_ATTEMPTS]: this.attemptsMade
        });

        return original(...args);
      };
    };
  }

  private _patchRetry(): (original: Fn) => (...args: any) => any {
    return function extendLock<T extends Fn>(original: T) {
      return function patch(this: Job, ...args: any): Promise<ReturnType<T>> {
        const span = trace.getSpan(context.active());
        span?.addEvent('retry', {
          [BullMQAttributes.JOB_NAME]: this.name,
          [BullMQAttributes.JOB_TIMESTAMP]: this.timestamp,
          [BullMQAttributes.JOB_PROCESSED_TIMESTAMP]: this.processedOn ?? 'unknown',
          [BullMQAttributes.JOB_ATTEMPTS]: this.attemptsMade
        });

        return original(...args);
      };
    };
  }



  private static setError = (span: Span, error: Error) => {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    return error;
  }

  private static attrMap(prefix: string, opts: JobsOptions): Attributes {
    const attrs = flatten({[prefix]: opts}) as Attributes;
    for (const key in attrs) {
      if (attrs[key] === undefined) delete attrs[key];
    }

    return attrs;
  }

  private static async withContext(thisArg: any, original: Function, span: Span, args: any[]): Promise<any> {
    const parentContext = context.active();
    const messageContext = trace.setSpan(parentContext, span);

    return await context.with(messageContext, async () => {
      try {
        return await original.apply(thisArg, ...[args]);
      } catch (e) {
        throw Instrumentation.setError(span, e as Error);
      } finally {
        span.end();
      }
    });
  }
}


