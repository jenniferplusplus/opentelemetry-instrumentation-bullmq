// import rewiremock from 'rewiremock';
// rewiremock.overrideEntryPoint(module);

import * as assert from 'assert';
// const Redis = require('ioredis-mock');
// rewiremock('ioredis').with(Redis);
// rewiremock.enable();

import { context, trace } from '@opentelemetry/api';
import { SemanticAttributes } from '@opentelemetry/semantic-conventions';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import {Queue} from 'bullmq';

// rewiremock.disable();

import {Instrumentation} from '../src'


const instrumentation = new Instrumentation();
const contextManager = new AsyncHooksContextManager().enable();
const memoryExporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider();
const spanProcessor = new SimpleSpanProcessor(memoryExporter);
instrumentation.setTracerProvider(provider);
context.setGlobalContextManager(contextManager);

const tracer = provider.getTracer('default');

provider.addSpanProcessor(spanProcessor);
instrumentation.enable();


describe('bullmq', () => {
  const connection = {host: 'localhost'};

  beforeEach(() => {
    instrumentation.enable();
    // connection = new Redis(QueueOpts);
  });

  afterEach(() => {
    contextManager.disable();
    contextManager.enable();
    memoryExporter.reset();
    instrumentation.disable();
  });

  describe('Queue', () => {
    it('should not generate any spans when disabled', async () => {
      const q = new Queue('test', {connection});
      await q.add('job', {test: 'yes'});

      const spans = memoryExporter.getFinishedSpans();
      assert.strictEqual(spans.length, 0);
    });
  });
});
