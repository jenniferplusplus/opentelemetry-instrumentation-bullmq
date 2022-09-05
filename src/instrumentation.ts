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
  WorkerOptions
} from 'bullmq';
import {flatten} from 'flat';

import {VERSION} from './version';
import {BullMQAttributes} from "./attributes";


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
      this._onPatchMain,
      this._onUnPatchMain,
    );
  }

  private _onPatchMain(moduleExports: typeof bullmq) {
    // As Spans
    this._wrap(moduleExports.Queue.prototype, 'add', this._patchQueueAdd());
    this._wrap(moduleExports.Queue.prototype, 'addBulk', this._patchQueueAddBulk());
    this._wrap(moduleExports.FlowProducer.prototype, 'add', this._patchFlowProducerAdd())
    this._wrap(moduleExports.FlowProducer.prototype, 'addBulk', this._patchFlowProducerAddBulk())
    this._wrap(moduleExports.Job.prototype, 'addJob', this._patchAddJob());

    // This works, shimmer.d.ts is a lying liar
    // @ts-expect-error
    this._wrap(moduleExports.Worker.prototype, 'constructor', this._patchWorker());

    // As Events
    this._wrap(moduleExports.Job.prototype, 'extendLock', this._patchExtendLock());
    this._wrap(moduleExports.Job.prototype, 'remove', this._patchRemove());
    this._wrap(moduleExports.Job.prototype, 'retry', this._patchRetry());

    return moduleExports;
  }

  private _onUnPatchMain(moduleExports: typeof bullmq) {
    this._unwrap(moduleExports.Queue.prototype, 'add');
    this._unwrap(moduleExports.Queue.prototype, 'addBulk');

    this._unwrap(moduleExports.FlowProducer.prototype, 'add')
    this._unwrap(moduleExports.FlowProducer.prototype, 'addBulk')

    this._unwrap(moduleExports, 'Worker');
  }

  private _patchAddJob(): (original: Function) => (...args: any) => any {
    const instrumentation = this;
    const tracer = instrumentation.tracer;
    const action = 'Job.addJob';

    return function addJob(original) {
      return async function patch(this:Job, client: never, parentOpts?: ParentOpts): Promise<string> {
        const spanName = `${this.queueName}.${this.name} ${action}`;
        this.opts = this.opts ?? {};
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

        propagation.inject(messageContext, this.opts);
        return await context.with(messageContext, async () => {
          try {
            return await original.apply(this, ...[client, parentOpts]);
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
        let [name, data, opts] = [...args];

        const spanName = `${this.name}.${name} ${action}`;
        const span = tracer.startSpan(spanName, {
          attributes: {
            [SemanticAttributes.MESSAGING_SYSTEM]: BullMQAttributes.MESSAGING_SYSTEM,
            [SemanticAttributes.MESSAGING_DESTINATION]: this.name,
            [BullMQAttributes.JOB_NAME]: name,
          },
          kind: SpanKind.INTERNAL
        });

        return Instrumentation.withContext(original, span, args);
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

        return Instrumentation.withContext(original, span, args);
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

        return Instrumentation.withContext(original, span, [flow, opts])
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

        return Instrumentation.withContext(original, span, args);
      };
    };
  }

  private _patchWorker(): (original: new (...args: any[]) => Worker) => any {
    const instrumentation = this;
    return function Worker(original) {
      return function patch(...args: any[]): Worker {
        const [name, processor, workerOpts] = [...args];

        if (processor instanceof Function) {
          const container = {processor};
          instrumentation._wrap(container, 'processor', instrumentation._patchWorkerCallback(name, workerOpts));
        }

        return new original(...args);
      }
    }
  }

  private _patchWorkerCallback(workerName: string, workerOpts?: WorkerOptions): (original: Function) => (...args: any) => any {
    const instrumentation = this;
    const tracer = instrumentation.tracer;
    const action = 'Worker.processor';

    return function processor<T extends Function>(original: T) {
      return async function patch(job: Job, ...args: any[]): Promise<ReturnType<T>> {
        const currentContext = context.active();
        const parentContext = propagation.extract(currentContext, job.opts);

        const spanName = `${job.queueName}.${job.name} ${workerName} #${job.attemptsMade + 1}`;
        const span = tracer.startSpan(spanName, {
          attributes: {
            [SemanticAttributes.MESSAGING_SYSTEM]: [BullMQAttributes.MESSAGING_SYSTEM],
            [SemanticAttributes.MESSAGING_CONSUMER_ID]: workerName,
            [SemanticAttributes.MESSAGING_MESSAGE_ID]: job.id ?? 'unknown',
            [SemanticAttributes.MESSAGING_OPERATION]: job.attemptsMade === 0 ? 'receive' : 'process',
            [BullMQAttributes.JOB_NAME]: job.name,
            [BullMQAttributes.JOB_ATTEMPTS]: job.attemptsMade,
            [BullMQAttributes.JOB_TIMESTAMP]: job.timestamp,
            [BullMQAttributes.JOB_DELAY]: job.delay,
            ...Instrumentation.attrMap(BullMQAttributes.JOB_OPTS, job.opts),
            [BullMQAttributes.QUEUE_NAME]: job.queueName,
            [BullMQAttributes.WORKER_NAME]: workerName,
            [BullMQAttributes.WORKER_CONCURRENCY]: workerOpts?.concurrency ?? 1,
            [BullMQAttributes.WORKER_LOCK_DURATION]: workerOpts?.lockDuration ?? 0,
            [BullMQAttributes.WORKER_LOCK_RENEW]: workerOpts?.lockRenewTime ?? 0,
            [BullMQAttributes.WORKER_RATE_LIMIT_MAX]: workerOpts?.limiter?.max ?? 'none',
            [BullMQAttributes.WORKER_RATE_LIMIT_DURATION]: workerOpts?.limiter?.duration ?? 'none',
            [BullMQAttributes.WORKER_RATE_LIMIT_GROUP]: workerOpts?.limiter?.groupKey ?? 'none',
          },
          kind: SpanKind.CONSUMER
        }, parentContext);
        if(job.repeatJobKey) span.setAttribute(BullMQAttributes.JOB_REPEAT_KEY, job.repeatJobKey);

        return await context.with(currentContext, async () => {
          try {
            return await original(...[job, ...args]);
          } catch (e) {
            throw Instrumentation.setError(span, e as Error);
          } finally {
            if(job.finishedOn) span.setAttribute(BullMQAttributes.JOB_FINISHED_TIMESTAMP, job.finishedOn);
            if(job.processedOn) span.setAttribute(BullMQAttributes.JOB_PROCESSED_TIMESTAMP, job.processedOn);
            if(job.failedReason) span.setAttribute(BullMQAttributes.JOB_FAILED_REASON, job.failedReason);

            span.end();
          }
        });
      }
    }
}


  private static setError = (span: Span, error: Error) => {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    return error;
  };

  private static attrMap(prefix: string, opts: JobsOptions): Attributes {
    const attrs = flatten({[prefix]: opts}) as Attributes;
    for (const key in attrs) {
      if (attrs[key] === undefined) delete attrs[key];
    }

    return attrs;
  };

  private static async withContext(original: Function, span: Span, args: any[]): Promise<any> {
    const parentContext = context.active();
    const messageContext = trace.setSpan(parentContext, span);

    return await context.with(messageContext, async () => {
      try {
        return await original.apply(this, ...[args]);
      } catch (e) {
        throw Instrumentation.setError(span, e as Error);
      } finally {
        span.end();
      }
    });
  }
}


