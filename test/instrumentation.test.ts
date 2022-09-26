// import rewiremock from 'rewiremock';
// rewiremock.overrideEntryPoint(module);

import * as assert from 'assert';
// const Redis = require('ioredis-mock');
// rewiremock('ioredis').with(Redis);
// rewiremock.enable();

import {context, propagation, SpanStatusCode, trace} from '@opentelemetry/api';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { AsyncHooksContextManager } from '@opentelemetry/context-async-hooks';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import type * as bullmq from 'bullmq';

import {Instrumentation} from '../src'

// rewiremock.disable();

let Queue: typeof bullmq.Queue;
let FlowProducer: typeof bullmq.FlowProducer;
let Worker: typeof bullmq.Worker;


function getWait(): [Promise<any>, Function, Function] {
  let resolve: Function;
  let reject: Function
  const p = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });

  // @ts-ignore
  return [p, resolve, reject];
}

describe('bullmq', () => {
  const instrumentation = new Instrumentation();
  const connection = {host: 'localhost'};
  const provider = new NodeTracerProvider();
  const memoryExporter = new InMemorySpanExporter();
  const spanProcessor = new SimpleSpanProcessor(memoryExporter);
  provider.addSpanProcessor(spanProcessor);
  let contextManager = new AsyncHooksContextManager();

  beforeEach(() => {
    contextManager.enable();
    context.setGlobalContextManager(contextManager);
    instrumentation.setTracerProvider(provider);
    instrumentation.enable();
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());

    Worker = require('bullmq').Worker;
    Queue = require('bullmq').Queue;
    FlowProducer = require('bullmq').FlowProducer;
  });

  afterEach(() => {
    contextManager.disable();
    contextManager.enable();
    memoryExporter.reset();
    instrumentation.disable();
  });

  describe('Queue', () => {
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
    it('should not generate any spans when disabled', async () => {
      instrumentation.disable();
      const w = new Worker('disabled', async (job, token) => {}, {connection})
      await w.waitUntilReady();

      const q = new Queue('disabled', {connection});
      await q.add('testJob', {test: 'yes'});

      const spans = memoryExporter.getFinishedSpans();
      assert.strictEqual(spans.length, 0);
    });

    it('should create a span for the processor', async () => {
      const [processor, processorDone] = getWait();

      const w = new Worker('worker', async (job, token) => {processorDone(); return {completed: new Date().toTimeString()}}, {connection})
      await w.waitUntilReady();

      const q = new Queue('worker', {connection});
      await q.add('testJob', {test: 'yes'});

      await processor;
      await w.close();

      const span = memoryExporter.getFinishedSpans()
        .find(span => span.name.includes('Worker.worker'));
      assert.notStrictEqual(span, undefined);
    });

    it('should propagate from the producer', async () => {
      const [processor, processorDone] = getWait();

      const q = new Queue('worker', {connection});
      const w = new Worker('worker', async (job, token) => {processorDone(); return {completed: new Date().toTimeString()}}, {connection})
      await w.waitUntilReady();

      await q.add('testJob', {started: new Date().toTimeString()});

      await processor;
      await w.close();

      const consumer = memoryExporter.getFinishedSpans().find(span => span.name.includes('Worker.worker'));
      const producer = memoryExporter.getFinishedSpans().find(span => span.name.includes('Job.addJob'));

      assert.notStrictEqual(consumer, undefined);
      assert.notStrictEqual(producer, undefined);
      assert.strictEqual(producer?.spanContext().spanId, consumer?.parentSpanId);
    });

    it('should capture events from the processor', async () => {
      const [processor, processorDone] = getWait();

      const q = new Queue('worker', {connection});
      const w = new Worker('worker', async (job, token) => {
        await job.extendLock(token as string, 20);
        processorDone();
        return {completed: new Date().toTimeString()}
      }, {connection})
      await w.waitUntilReady();

      await q.add('testJob', {started: new Date().toTimeString()});

      await processor;
      await w.close();

      const span = memoryExporter.getFinishedSpans().find(span => span.name.includes('Worker.worker'));
      const evt = span?.events.find(event => event.name.includes('extendLock'));

      assert.notStrictEqual(evt, undefined);
    });

    it('should capture errors from the processor', async () => {
      const [processor, processorDone] = getWait();

      const q = new Queue('worker', {connection});
      const w = new Worker('worker', async (job, token) => {
        processorDone();
        throw new Error('forced error');
      }, {connection})
      await w.waitUntilReady();

      await q.add('testJob', {started: new Date().toTimeString()});

      await processor;
      await w.close();

      const span = memoryExporter.getFinishedSpans().find(span => span.name.includes('Worker.worker'));
      const evt = span?.events.find(event => event.name.includes('exception'));

      assert.notStrictEqual(evt, undefined);
      assert.strictEqual(span?.status.code, SpanStatusCode.ERROR);
      assert.strictEqual(span?.status.message, 'forced error');
    });
  });
});
