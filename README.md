# bun-ioc

Lightweight, TypeScript-first IoC (Inversion of Control) container for the Bun runtime — with decorators, async factories, conditional bindings, and a zero-boilerplate module scanner.

## Features

- Clean, tiny API built for Bun and TypeScript
- Lifetimes: `singleton`, `scoped`, `transient`
- Named and conditional bindings (env/flag/profile/fn)
- Sync and async factories, `resolveAll`/`resolveAllAsync`
- Lazy resolution: `resolveLazy`, `resolveLazyAsync`, and `injectLazy` descriptor
- Circular dependency detection
- Decorators: `@Service`, `@Inject`, `@InjectLazy`, `@Named`, `@InjectMethod`, `@NamedParam`
- Module scanner: auto-bind undecorated classes and run module `configure(container)` hooks

## Install

```bash
bun add bun-ioc
```

If you use decorators, enable metadata and import reflect-metadata once (or preload it in tests):

tsconfig.json
```jsonc
{
	"compilerOptions": {
		"experimentalDecorators": true,
		"emitDecoratorMetadata": true
	}
}
```

Entry (or test preload via bunfig):
```ts
import "reflect-metadata";
```

## Quick Start

### Container API

```ts
import { Container, token } from "bun-ioc";

const c = new Container();

// Tokens
const ILogger = token<{ log: (m: string) => void }>("ILogger");
const Repo = token<{ id: number }>("Repo");

// Register
c.register(ILogger, () => ({ log: (m) => console.log(m) }), "singleton");
let next = 0;
c.register(Repo, () => ({ id: ++next }), "transient");

// Resolve
const log = c.resolve(ILogger);
const r1 = c.resolve(Repo);
const r2 = c.resolve(Repo); // different instance
log.log(`${r1.id} != ${r2.id}`);

// Async
const Data = token<{ ts: number }>("Data");
c.registerAsync(Data, async () => ({ ts: Date.now() }), "singleton");
const data = await c.resolveAsync(Data);

// Conditional + named
const Payment = token<{ pay: (a: number) => string }>("Payment");
c.setFlags({ debug: true });
c.whenFlag(Payment, "debug", true, () => ({ pay: (a) => `MOCK:${a}` }), "singleton", "mock");
c.register(Payment, () => ({ pay: (a) => `LIVE:${a}` }), "singleton");
const pay = c.resolve(Payment, "mock");
```

### Decorators

```ts
import "reflect-metadata";
import { Service, Inject, Named } from "bun-ioc";
import { token } from "bun-ioc";

class Driver { constructor(public kind: string) {} }
const TDriver = token<Driver>("Driver");
import { globalContainer } from "bun-ioc";
globalContainer.register(TDriver, () => new Driver("B"), "singleton", "B");

@Service()
class Repository { id = Math.random(); }

@Service()
class ServiceA {
	constructor(@Named("B") public driver: Driver, public repo: Repository) {}
	@Inject("String") // method parameters resolved by reflected token names
	greet(name: string) { return `${name}@${this.driver.kind}`; }
}

const svc = globalContainer.resolve(token<ServiceA>("ServiceA"));
```

### Module Scanner

```ts
import "reflect-metadata";
import { scanModules, Service, globalContainer, token } from "bun-ioc";

@Service()
class Decorated {}
class Greeter { constructor(public who: Decorated) {} }

await scanModules(globalContainer, [{ Decorated, Greeter }], {
	autoBindUndecorated: true,
	fallbackLifetime: "transient",
});

const TGreeter = token<Greeter>("Greeter");
const g = globalContainer.resolve(TGreeter);
```

## Examples

```bash
# Basic container usage (register/resolve, named, async, scope)
bun run examples/basic.ts

# Decorators (@Service, @Inject, @InjectLazy, @Named, @InjectMethod)
bun run examples/decorators.ts

# Module scanner (configure hook, autoBindUndecorated)
bun run examples/scanner.ts
```

## Tests

This package uses Bun's built-in test runner. Reflect metadata is preloaded via `bunfig.toml`.

Run all tests:

```bash
bun test
```

What’s covered:
- Container registration & resolution (singleton/transient), scoping, conditional bindings (env/flag/profile), async factories, circular detection, and lazy resolvers.
- Decorators: `@Service`, constructor param injection with `@Named`, property `@Inject` / `@InjectLazy`, and method injection with `@InjectMethod` and `@NamedParam`.
- Module scanner: `configure` hooks, auto-binding undecorated classes with constructor injection when metadata is available.

## Requirements

- Bun >= 1.0
- TypeScript >= 5
- For decorators: `experimentalDecorators` and `emitDecoratorMetadata` enabled, and `reflect-metadata` imported once at startup (or preloaded in tests)

## License

MIT
