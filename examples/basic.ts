import { Container, token } from "../src/container";

// Basic Container usage
const container = new Container();

// Tokens
const ILogger = token<{ log: (msg: string) => void }>("ILogger");
const IRepo = token<{ getCount: () => number }>("IRepo");

// Register a singleton logger
container.register(ILogger, () => ({ log: (msg: string) => console.log(`[log] ${msg}`) }), "singleton");

// Register transient repository and a named variant
let count = 0;
container.register(IRepo, () => ({ getCount: () => ++count }), "transient");
container.register(IRepo, () => ({ getCount: () => 1000 }), "singleton", "fixed");

// Conditional binding based on flag/profile/env
const IPayment = token<{ pay: (amount: number) => string }>("IPayment");
container.setFlags({ debug: true });
container.whenFlag(IPayment, "debug", true, () => ({ pay: (a) => `MOCK:${a}` }), "singleton", "mock");
container.register(IPayment, () => ({ pay: (a) => `LIVE:${a}` }), "singleton");

// Async binding
const IData = token<{ ts: number }>("IData");
container.registerAsync(IData, async () => ({ ts: Date.now() }), "singleton");

// Resolve usages
const logger = container.resolve(ILogger);
logger.log("hello container");

const repoA = container.resolve(IRepo);
const repoB = container.resolve(IRepo);
logger.log(`transient repo counts: ${repoA.getCount()} then ${repoB.getCount()}`);

const fixed = container.resolve(IRepo, "fixed");
logger.log(`named repo (fixed): ${fixed.getCount()}`);

const payment = container.resolve(IPayment, "mock");
logger.log(payment.pay(42));

const data = await container.resolveAsync(IData);
logger.log(`async data ts=${data.ts}`);

// Scope example (child overrides)
const child = container.createScope();
child.register(ILogger, () => ({ log: (msg: string) => console.log(`[child] ${msg}`) }), "singleton");
const childLogger = child.resolve(ILogger);
childLogger.log("scoped logger in action");
