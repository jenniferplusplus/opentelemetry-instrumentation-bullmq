import {
  InstrumentationBase,
  InstrumentationConfig,
  InstrumentationNodeModuleDefinition,
} from '@opentelemetry/instrumentation';
import {SemanticAttributes} from '@opentelemetry/semantic-conventions';
import type * as bullmq from 'bullmq';

import {VERSION} from './version';
import {context, propagation, SpanKind, SpanStatusCode, trace} from '@opentelemetry/api';
import type {Span} from '@opentelemetry/api'


export class Instrumentation extends InstrumentationBase<any> {
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
    const module = new InstrumentationNodeModuleDefinition<typeof bullmq>(
      'bullmq',
      ['1.*'],
      this._onPatchMain,
      this._onUnPatchMain,
    );

    return module;
    // you can also define more modules then just return an array of modules
    // return [module1, module2, ....]
  }

  private _onPatchMain(moduleExports: typeof bullmq) {
    this._wrap(moduleExports.Queue.prototype, 'add', this._patchQueueAdd);
    this._wrap(moduleExports.Queue.prototype, 'addBulk', this._patchQueueAdd);

    this._wrap(moduleExports.FlowProducer.prototype, 'add', this._patchFlowProducerAdd())
    this._wrap(moduleExports.FlowProducer.prototype, 'addBulk', this._patchFlowProducerAdd())

    this._wrap(moduleExports, 'Worker', this._patchWorker());

    return moduleExports;
  }

  private _onUnPatchMain(moduleExports: typeof bullmq) {
    this._unwrap(moduleExports.Queue.prototype, 'add');
    this._unwrap(moduleExports.Queue.prototype, 'addBulk');

    this._unwrap(moduleExports.FlowProducer.prototype, 'add')
    this._unwrap(moduleExports.FlowProducer.prototype, 'addBulk')

    this._unwrap(moduleExports, 'Worker');
  }

  private _patchQueueAdd(): (original: Function) => any {
    const instrumentation = this;
    const tracer = this.tracer;

    return function add(original) {
      return async function patchAdd(this: bullmq.Queue, ...args: any): Promise<bullmq.Job> {
        let [name, data, opts] = [...args];

        const spanName = `${this.name}.${name} add`;
        const span = tracer.startSpan(spanName, {
          attributes: {
            [SemanticAttributes.MESSAGING_SYSTEM]: 'BullMq',
            [SemanticAttributes.MESSAGING_DESTINATION]: this.name,
          },
          kind: SpanKind.PRODUCER
        });

        const parentContext = context.active();
        const messageContext = trace.setSpan(parentContext, span);

        // do propagations, use opts as carrier
        opts = opts ?? {};
        opts.headers = opts.headers ?? {};
        propagation.inject(messageContext, opts.headers);

        let job: bullmq.Job;
        return await context.with(messageContext, async () => {
          try {
            job = await original.apply(this, ...[name, data, opts]);
            return job;
          } catch (e) {
            throw Instrumentation.setError(span, e as Error);
          } finally {
            span.setAttribute(SemanticAttributes.MESSAGE_ID, job?.id || 'unknown');
            span.end();
          }
        });
      };
    };
  }

  private static setError = (span: Span, error: Error) => {
    span.recordException(error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    return error;
  };
}


