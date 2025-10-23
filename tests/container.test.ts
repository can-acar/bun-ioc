import { describe, it, expect } from "bun:test";
import { Container, token } from "../src/container";

describe("Container - registration and resolution", () => {
  it("resolves transient with new instance each time", () => {
    const c = new Container();
    type Svc = { id: number };
    const T = token<Svc>("Svc-Transient");
    let counter = 0;
    c.register(T, () => ({ id: ++counter }), "transient");

    const a = c.resolve(T);
    const b = c.resolve(T);
    expect(a.id).not.toEqual(b.id);
  });

  it("resolves singleton with same instance", () => {
    const c = new Container();
    type Svc = { id: number };
    const T = token<Svc>("Svc-Singleton");
    let counter = 0;
    c.register(T, () => ({ id: ++counter }), "singleton");

    const a = c.resolve(T);
    const b = c.resolve(T);
    expect(a).toBe(b);
    expect(a.id).toEqual(1);
  });

  it("scopes do not fallback to parent for resolve()", () => {
    const parent = new Container();
    type Svc = { x: number };
    const T = token<Svc>("Svc-Scoped");
    parent.register(T, () => ({ x: 1 }), "singleton");

    const child = parent.createScope();
    expect(() => child.resolve(T)).toThrow(); // no fallback for resolve()

    // override in child
    child.register(T, () => ({ x: 2 }), "singleton");
    const v = child.resolve(T);
    expect(v.x).toBe(2);
    // parent remains intact
    expect(parent.resolve(T).x).toBe(1);
  });

  it("resolveAll falls back to parent when local missing", () => {
    const parent = new Container();
    const T = token<number>("NumList");
    parent.register(T, () => 1, "transient", "one");
    parent.register(T, () => 2, "transient", "two");

    const child = parent.createScope();
    const all = child.resolveAll(T);
    expect(new Set(all)).toEqual(new Set([1, 2]));
  });
});

describe("Container - conditional bindings and policy", () => {
  it("selects by requested name when condition holds", () => {
    const c = new Container();
    type DB = { name: string };
    const DBT = token<DB>("DB");
    c.setEnv({ NODE_ENV: "production" });
    c.whenEnv(DBT, "NODE_ENV", "production", () => ({ name: "prod" }), "singleton", "prod");
    c.register(DBT, () => ({ name: "default" }), "singleton");

    const byName = c.resolve(DBT, "prod");
    expect(byName.name).toBe("prod");
    const def = c.resolve(DBT);
    expect(def.name).toBe("default");
  });

  it("throws on ambiguity when multiple candidates match and no default", () => {
    const c = new Container();
    const T = token<number>("Ambiguous");
    // two named candidates both hold (no conditions)
    c.register(T, () => 1, "singleton", "a");
    c.register(T, () => 2, "singleton", "b");
    expect(() => c.resolve(T)).toThrow();
  });

  it("flag/profile conditions gate candidates", () => {
    const c = new Container();
    const T = token<string>("Cond");
    c.whenFlag(T, "debug", true, () => "dbg", "singleton", "dbg");
    c.whenProfile(T, "test", () => "test", "singleton", "test");
    c.register(T, () => "def", "singleton");

    // no flags/profile
    expect(c.resolve(T)).toBe("def");
    // set flag true
    c.setFlags({ debug: true });
    expect(c.resolve(T, "dbg")).toBe("dbg");
    // switch profile
    c.setProfile("test");
    expect(c.resolve(T, "test")).toBe("test");
  });
});

describe("Container - async and circular", () => {
  it("enforces resolveAsync for async bindings and caches singleton", async () => {
    const c = new Container();
    const T = token<{ t: number }>("AsyncSvc");
    let calls = 0;
    c.registerAsync(T, async () => ({ t: ++calls }), "singleton");
    expect(() => c.resolve(T)).toThrow();
    const a = await c.resolveAsync(T);
    const b = await c.resolveAsync(T);
    expect(a).toBe(b);
    expect(a.t).toBe(1);
  });

  it("detects simple circular dependency", () => {
    const c = new Container();
    const T = token<number>("Circ");
    c.register(T, (cc) => {
      // re-enter same token while constructing
      cc.resolve(T);
      return 1;
    }, "singleton");
    expect(() => c.resolve(T)).toThrow(/Circular dependency/);
  });

  it("detects mutual circular dependency", () => {
    const c = new Container();
    const A = token<string>("A");
    const B = token<string>("B");
    c.register(A, (cc) => cc.resolve(B), "singleton");
    c.register(B, (cc) => cc.resolve(A), "singleton");
    expect(() => c.resolve(A)).toThrow(/Circular dependency/);
  });
});

describe("Container - lazy resolution", () => {
  it("lazy caches singleton but not transient (sync)", () => {
    const c = new Container();
    const Ts = token<number>("LazyS");
    const Tt = token<number>("LazyT");
    let cs = 0, ct = 0;
    c.register(Ts, () => ++cs, "singleton");
    c.register(Tt, () => ++ct, "transient");

    const lazyS = c.resolveLazy(Ts);
    const lazyT = c.resolveLazy(Tt);
    expect(lazyS()).toBe(lazyS());
    const t1 = lazyT();
    const t2 = lazyT();
    expect(t1).not.toBe(t2);
  });

  it("lazy async caches for async singletons and not for async transient", async () => {
    const c = new Container();
    const Tsa = token<number>("LazySAsync");
    const Tta = token<number>("LazyTAsync");
    let cs = 0, ct = 0;
    c.registerAsync(Tsa, async () => ++cs, "singleton");
    c.registerAsync(Tta, async () => ++ct, "transient");

    const lazySa = c.resolveLazyAsync(Tsa);
    const lazyTa = c.resolveLazyAsync(Tta);
    expect(await lazySa()).toBe(await lazySa());
    const at1 = await lazyTa();
    const at2 = await lazyTa();
    expect(at1).not.toBe(at2);
  });

  it("injectLazy descriptor works for property definition", () => {
    const c = new Container();
    const T = token<number>("InjectLazyProp");
    let calls = 0;
    c.register(T, () => ++calls, "singleton");

    const obj: any = {};
    Object.defineProperty(obj, "dep", c.injectLazy(T));
    expect(obj.dep).toBe(obj.dep);
    expect(calls).toBe(1);
  });
});
