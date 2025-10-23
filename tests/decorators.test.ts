import { describe, it, expect } from "bun:test";
import "reflect-metadata";
import { globalContainer, Service, Inject, InjectLazy, Named, InjectMethod, NamedParam } from "../src/decorator";
import { token } from "../src/container";

describe("Decorators - @Service and constructor injection", () => {
  it("registers and resolves a simple service", () => {
    const T = token<SimpleSvc>("Decor:SimpleSvc");
    @Service({ tokenOverride: T })
    class SimpleSvc {
      value = 42;
    }
    const v = globalContainer.resolve(T);
    expect(v.value).toBe(42);
  });

  it("constructor param injection with @Named qualifier", () => {
    // Use a class dependency so token matches class name
    class Dep {}
    const DepT = token<Dep>("Dep");
    globalContainer.register(DepT, () => new Dep(), "singleton", "A");
    globalContainer.register(DepT, () => new Dep(), "singleton", "B");

    const ConsT = token<Consumer>("Decor:Consumer");
    @Service({ tokenOverride: ConsT })
    class Consumer {
      constructor(@Named("B") public dep: Dep) {}
    }
    const c = globalContainer.resolve(ConsT);
    expect(c.dep).toBeInstanceOf(Dep);
  });
});

describe("Decorators - property @Inject and @InjectLazy", () => {
  it("injects property lazily via @Inject", () => {
    const DepT = token<number>("Decor:PropDep");
    let calls = 0;
    globalContainer.register(DepT, () => ++calls, "singleton");

    const T = token<any>("Decor:PropConsumer");
    @Service({ tokenOverride: T })
    class PropConsumer {
      @Inject(DepT) dep!: number;
    }
    const c = globalContainer.resolve(T);
    expect(c.dep).toBe(c.dep);
    expect(calls).toBe(1);
  });

  it("injects property as Promise via @InjectLazy", async () => {
    const DepT = token<string>("Decor:LazyPropDep");
    let calls = 0;
    globalContainer.registerAsync(DepT, async () => `X${++calls}`, "singleton");

    const T = token<any>("Decor:LazyPropConsumer");
    @Service({ tokenOverride: T })
    class LazyPropConsumer {
      @InjectLazy(DepT) dep!: Promise<string>;
    }
    const c = globalContainer.resolve(T);
    const v1 = await c.dep;
    const v2 = await c.dep;
    expect(v1).toBe(v2);
    expect(v1).toBe("X1");
  });
});

describe("Decorators - @InjectMethod and @NamedParam", () => {
  it("resolves method parameters on call-time", () => {
    // InjectMethod looks up tokens by reflected type names (String, Number)
    const A = token<string>("String");
    const B = token<number>("Number");
    globalContainer.register(A, () => "hello", "singleton");
    globalContainer.register(B, () => 7, "singleton");

    const T = token<any>("Decor:MethodConsumer");
    @Service({ tokenOverride: T })
    class MethodConsumer {
      @InjectMethod()
      call(a: string, b: number) {
        return `${a}-${b}`;
      }
    }
    const c = globalContainer.resolve(T);
    expect(c.call()).toBe("hello-7");
  });

  it("@NamedParam overrides method param name", () => {
    // Method param type will be String; register named variants on that token
    const D = token<string>("String");
    globalContainer.register(D, () => "def", "singleton");
    globalContainer.register(D, () => "blue", "singleton", "blue");

    const T = token<any>("Decor:MethodNamedConsumer");
    @Service({ tokenOverride: T })
    class MethodNamedConsumer {
      @InjectMethod()
      pick(@NamedParam("blue") d: string) {
        return d;
      }
    }
    const c = globalContainer.resolve(T);
    expect(c.pick()).toBe("blue");
  });
});
