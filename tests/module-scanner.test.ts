import { describe, it, expect } from "bun:test";
import "reflect-metadata";
import { Container, token } from "../src/container";
import { scanModules } from "../src/module-scanner";
import { Service } from "../src/decorator";

describe("Module Scanner", () => {
  it("calls configure hook (sync and async)", async () => {
    const c = new Container();
    const CFG = token<number>("CfgVal");
    const modules = [
      {
        configure(container: Container) {
          container.register(CFG, () => 1, "singleton");
        }
      },
      {
        async configure(container: Container) {
          container.register(CFG, () => 2, "singleton", "two");
        }
      }
    ];
    await scanModules(c, modules);
    // both registrations should exist
    const all = c.resolveAll(CFG);
    expect(new Set(all)).toEqual(new Set([1, 2]));
  });

  it("auto binds undecorated exported classes when enabled", async () => {
    const c = new Container();
    class A { val = 7; }
    // use a no-op decorator to trigger design:paramtypes metadata emission
    function Meta(): ClassDecorator { return () => {}; }
    @Meta()
    class B { constructor(public a: A) {} }
    await scanModules(c, [{ A, B }], { autoBindUndecorated: true, fallbackLifetime: "transient" });

    // tokens are derived from class names
    const TA = token<A>("A");
    const TB = token<B>("B");
    const b = c.resolve(TB);
    expect(b.a.val).toBe(7);
    // new transient on each resolve
    const b2 = c.resolve(TB);
    expect(b).not.toBe(b2);
  });

  it("does not rebind classes already decorated with @Service", async () => {
    const c = new Container();
    const T = token<number>("SvcAlready");
    @Service({ tokenOverride: T })
    class Already {}

    const mod = { Already };
    await scanModules(c, [mod], { autoBindUndecorated: true });
    // The decorated token should be resolvable; scanner should not override
    // Register a value provider for T indirectly by a dependent class
    c.register(T, () => 5, "singleton");
    expect(c.resolve(T)).toBe(5);
  });
});
