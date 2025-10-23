import "reflect-metadata";
import type { Container, ResolutionContext } from "./container";
import { token } from "./container";

type ScanOptions = {
  autoBindUndecorated?: boolean;
  fallbackLifetime?: "singleton"|"scoped"|"transient";
};

export async function scanModules(container: Container, modules: Record<string, any>[], opts: ScanOptions = {}) {
  const { autoBindUndecorated = false, fallbackLifetime = "singleton" } = opts;
  const ctx: ResolutionContext = container.getContext();

  for (const mod of modules) {
    // 1) configure hook: async veya sync olabilir
    if (typeof (mod as any).configure === "function") {
      const ret = (mod as any).configure(container, ctx);
      if (ret instanceof Promise) await ret;
    }

    // 2) export edilen class'ları decorator metasıyla tara
    for (const [exportName, exp] of Object.entries(mod)) {
      if (typeof exp !== "function") continue;
      if (!isClass(exp)) continue;

      const hasToken = Reflect.hasMetadata("di:token", exp);
      if (hasToken) continue; // @Service zaten register etti

      if (autoBindUndecorated) {
        const t = token<any>(exp.name || exportName);
        container.register(t, (c) => {
          const paramTypes = Reflect.getMetadata("design:paramtypes", exp) || [];
          const params = paramTypes.map((p: any) => c.resolve(token<any>(p.name)));
          return new (exp as any)(...params);
        }, fallbackLifetime);
        Reflect.defineMetadata("di:token", t, exp);
      }
    }
  }
}

function isClass(fn: any) {
  return typeof fn === "function" && /^class\s/.test(Function.prototype.toString.call(fn));
}
