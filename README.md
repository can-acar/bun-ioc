# bun-ioc

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
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

This project was created using `bun init` in bun v1.2.23. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
