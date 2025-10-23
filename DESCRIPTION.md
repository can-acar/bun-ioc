bun-ioc is a lightweight, TypeScript-first Inversion of Control (IoC) container built for the Bun runtime.

- Tiny API with powerful features: singleton/scoped/transient lifetimes, named and conditional bindings, sync/async factories, and lazy resolution.
- First-class decorator support (@Service, @Inject, @InjectLazy, @Named, @InjectMethod) and a module scanner to auto-bind classes and run module-level configure hooks.
- Designed for Bun: zero-config testing with bun test, fast startup, and minimal dependencies (reflect-metadata).
