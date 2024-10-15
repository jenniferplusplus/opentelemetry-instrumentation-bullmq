> [!WARNING]  
> This package is minimally maintained, and will be deprecated in the future. Consider using https://github.com/appsignal/opentelemetry-instrumentation-bullmq instead

# OpenTelemetry Bullmq Instrumentation for Node.js

[![Node.js CI](https://github.com/jenniferplusplus/opentelemetry-instrumentation-bullmq/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/jenniferplusplus/opentelemetry-instrumentation-bullmq/actions/workflows/ci.yml)
[![npm version](https://badge.fury.io/js/@jenniferplusplus%2Fopentelemetry-instrumentation-bullmq.svg)](https://badge.fury.io/js/@jenniferplusplus%2Fopentelemetry-instrumentation-bullmq)

This module provides automatic tracing instrumentation for [BullMQ][bullmq-web-url].

Compatible with OpenTelemetry JS API and SDK `1.0+`.

## Installation

```bash
npm install --save @jenniferplusplus/opentelemetry-instrumentation-bullmq
```

### Supported Versions

- `[1.90.1, 2.x, 3.x, 4.x, 5.x]`

It's likely that the instrumentation would support earlier versions of BullMQ, but I haven't tested it.

## Usage

OpenTelemetry Bullmq Instrumentation allows the user to automatically collect trace data from Bullmq jobs and workers and export them to the backend of choice.

To load the instrumentation, specify it in the instrumentations list to `registerInstrumentations`. There is currently no configuration option.

```javascript
const { NodeTracerProvider } = require('@opentelemetry/sdk-trace-node');
const { registerInstrumentations } = require('@opentelemetry/instrumentation');
const { BullMQInstrumentation } = require('@jenniferplusplus/opentelemetry-instrumentation-bullmq');

const provider = new NodeTracerProvider();
provider.register();

registerInstrumentations({
  instrumentations: [
    new BullMQInstrumentation(),
  ],
});
```

## Emitted Spans

| Name                                                   | BullMQ method           | Description                                         |
|--------------------------------------------------------|-------------------------|-----------------------------------------------------|
| `{QueueName.JobName} Queue.add`                        | `Queue.add            ` | A new job is added to the queue                     |
| `{QueueName} Queue.addBulk`                            | `Queue.addBulk        ` | New jobs are added to the queue in bulk             |
| `{QueueName.FlowName} FlowProducer.add`                | `FlowProducer.add     ` | A new job flow is added to a queue                  |
| `FlowProducer.addBulk  `                               | `FlowProducer.addBulk ` | New job flows are added to queues in bulk           |
| `{QueueName.JobName} Job.addJob`                       | `Job.addJob           ` | Each individual job added to a queue                |
| `{WorkerName} Worker.run`                              | `Worker.run           ` | While a worker is accepting jobs                    |
| `{QueueName.JobName} Worker.{WorkerName} #{attempt}`   | `Worker.callProcessJob` | Each job execution by a worker's processor function |


## Useful links

- For more information on OpenTelemetry, visit: <https://opentelemetry.io/>
- For more about OpenTelemetry JavaScript: <https://github.com/open-telemetry/opentelemetry-js>
- For help or feedback on this project, open an issue or submit a PR

## License

Apache 2.0 - See [LICENSE][license-url] for more information.

[license-url]: https://opensource.org/licenses/Apache-2.0
[npm-url]: https://www.npmjs.com/package/@jenniferplusplus/opentelemetry-instrumentation-bullmq
[bullmq-web-url]: https://docs.bullmq.io/

## Contributing

I no longer use BullMQ in any of my projects, and so I have no cause to update this library. I will continue to update to support new versions of node.js, and backward-compatible versions of BullMQ. I'm not accepting new features, and I would likely not make updates for any breaking changes in BullMQ. I plan to deprecate this package when there is a clear successor. Currently, [AppSignals's](https://github.com/appsignal/opentelemetry-instrumentation-bullmq) implementation is the most mature. The API and emitted telemetry is very similar to this one as it was forked from this project. [Taskforce.sh](https://github.com/taskforcesh/bullmq/pull/2721) is also developing a first-party tracing solution.
