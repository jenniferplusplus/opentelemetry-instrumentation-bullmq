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
import type * as bullmq from 'bullmq';

let Queue: typeof bullmq.Queue;
let FlowProducer: typeof bullmq.FlowProducer;
let Worker: typeof bullmq.Worker;

// rewiremock.disable();

import {Instrumentation} from '../src'


const instrumentation = new Instrumentation();
// const tracer = provider.getTracer('default');
//
// instrumentation.enable();


describe('bullmq', () => {
  const connection = {host: 'localhost'};
  const provider = new NodeTracerProvider();
  const memoryExporter = new InMemorySpanExporter();
  const spanProcessor = new SimpleSpanProcessor(memoryExporter);
  provider.addSpanProcessor(spanProcessor);
  const tracer = provider.getTracer('default');
  let contextManager = new AsyncHooksContextManager();

  beforeEach(() => {
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    instrumentation.setTracerProvider(provider);
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
    beforeEach(() => {
      Queue = require('bullmq').Queue;
    });

    it('should not generate any spans when disabled', async () => {
      instrumentation.disable();
      const q = new Queue('disabled', {connection});
      await q.add('testJob', {test: 'yes'});

      const spans = memoryExporter.getFinishedSpans();
      assert.strictEqual(spans.length, 0);
    });

    it('should create a span for add', async () => {
      const q = new Queue('queue', {connection});
      await q.add('testJob', {test: 'yes'});

      const span = memoryExporter.getFinishedSpans()
          .find(span => span.name.includes('Queue.add'));
      assert.notStrictEqual(span, undefined);
    });

    it('should create a span for addBulk', async () => {
      const q = new Queue('queue', {connection});
      await q.addBulk([{name: 'testJob', data: {test: 'yes'}}])

      const span = memoryExporter.getFinishedSpans()
        .find(span => span.name.includes('Queue.addBulk'));
      assert.notStrictEqual(span, undefined);
    });
  });

  describe('FlowProducer', () => {
    beforeEach(() => {
      FlowProducer = require('bullmq').FlowProducer;
    });

    it('should not generate any spans when disabled', async () => {
      instrumentation.disable();
      const q = new FlowProducer();
      await q.add({name: 'testJob', queueName: 'disabled'});

      const spans = memoryExporter.getFinishedSpans();
      assert.strictEqual(spans.length, 0);
    });

    it('should create a span for add', async () => {
      const q = new FlowProducer();
      await q.add({name: 'testJob', queueName: 'flow'});

      const span = memoryExporter.getFinishedSpans()
          .find(span => span.name.includes('FlowProducer.add'));
      assert.notStrictEqual(span, undefined);
    });

    it('should create a span for addBulk', async () => {
      const q = new FlowProducer();
      await q.addBulk([{name: 'testJob', queueName: 'flow'}]);

      const span = memoryExporter.getFinishedSpans()
        .find(span => span.name.includes('FlowProducer.addBulk'));
      assert.notStrictEqual(span, undefined);
    });
  });

  describe('Worker', () => {
    beforeEach(() => {
      Worker = require('bullmq').Worker;
      Queue = require('bullmq').Queue;
    });

    // after(() => {
    //   const test = new Queue('test');
    //   test.drain(true);
    //   test.clean(0, 1000, 'completed');
    //   test.clean(0, 1000, 'active');
    //   test.clean(0, 1000, 'paused');
    //   test.clean(0, 1000, 'failed');
    //
    //   const workerTest = new Queue('workerTest');
    //   workerTest.drain(true);
    //   workerTest.clean(0, 1000, 'completed');
    //   workerTest.clean(0, 1000, 'active');
    //   workerTest.clean(0, 1000, 'paused');
    //   workerTest.clean(0, 1000, 'failed');
    // });

    it('should not generate any spans when disabled', async () => {
      instrumentation.disable();
      const w = new Worker('disabled', async (job, token) => {}, {connection})
      await w.waitUntilReady();

      const q = new Queue('disabled', {connection});
      await q.add('testJob', {test: 'yes'});

      const spans = memoryExporter.getFinishedSpans();
      assert.strictEqual(spans.length, 0);
    });

    it('should generate a processor span for the callback', async () => {
      let done: Function;
      const cb = new Promise((resolve, reject) => {
          done = resolve;
      });

      const w = new Worker('worker', async (job, token) => {return {complete: 'yes'}}, {connection})
      const q = new Queue('worker', {connection});
      await q.add('testJob', {test: 'yes'});

      await w.waitUntilReady();
      await w.close();

      const finishedSpans = memoryExporter.getFinishedSpans();
      const span = memoryExporter.getFinishedSpans()
        .find(span => span.name.includes('processor'));
      assert.notStrictEqual(span, undefined);
    });
  });
});
