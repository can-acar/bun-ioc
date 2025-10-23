import "reflect-metadata";
import { Container, token, type Token } from "./container";

export const globalContainer = new Container();

class LazyLock<T> {
  private value?: T; private resolved = false; private pending?: Promise<T>;
  constructor(private resolver: () => Promise<T> | T) {}
  async get(): Promise<T> {
    if (this.resolved) return this.value as T;
    if (this.pending) return this.pending;
    const p = Promise.resolve(this.resolver()).then(v => { this.value = v; this.resolved = true; this.pending = undefined; return v; });
    this.pending = p; return p;
  }
  getSync(): T {
    if (this.resolved) return this.value as T;
    const v = this.resolver(); if (v instanceof Promise) throw new Error("Sync path hit async factory");
    this.value = v; this.resolved = true; return v;
  }
}

type ServiceOptions = { lifetime?: "singleton"|"scoped"|"transient"; name?: string; tokenOverride?: Token<any> };

export function Service(opts: ServiceOptions = {}) {
  const { lifetime = "singleton", name, tokenOverride } = opts;
  return function <T extends { new(...args: any[]): any }>(target: T) {
    const t = tokenOverride ?? token<InstanceType<T>>(target.name);
    // constructor paramları için @Named okuruz (opsiyonel)
    globalContainer.register(t, (c) => {
      const paramTypes = Reflect.getMetadata("design:paramtypes", target) || [];
      const names: (string|undefined)[] = Reflect.getMetadata("di:paramNames", target) || [];
      const params = paramTypes.map((p: any, i: number) => {
        const pt = token<any>(p.name);
        const nm = names[i];
        return c.resolve(pt, nm);
      });
      return new target(...params);
    }, lifetime, name);
    Reflect.defineMetadata("di:token", t, target);
  };
}

// @Named: constructor param veya property için ad kwalifier
export function Named(name: string) {
  return function(target: any, propertyKey?: string | symbol, parameterIndex?: number) {
    if (typeof parameterIndex === "number") {
      const arr = Reflect.getOwnMetadata("di:paramNames", target) || [];
      arr[parameterIndex] = name;
      Reflect.defineMetadata("di:paramNames", arr, target);
    } else if (propertyKey) {
      Reflect.defineMetadata("di:propName", name, target, propertyKey);
    }
  };
}

export function Inject<T>(tokenOrClass?: Token<T> | Function, name?: string) {
  return function (target: any, propertyKey: string | symbol) {
    const injectToken = resolveToken(tokenOrClass, target, propertyKey);
    const propName = name ?? Reflect.getMetadata("di:propName", target, propertyKey);
    let lock: LazyLock<T>;
    Object.defineProperty(target, propertyKey, {
      get() {
        lock ??= new LazyLock(() => globalContainer.resolve(injectToken, propName));
        return lock.getSync();
      },
      enumerable: true, configurable: true
    });
  };
}

export function InjectLazy<T>(tokenOrClass?: Token<T> | Function, name?: string) {
  return function (target: any, propertyKey: string | symbol) {
    const injectToken = resolveToken(tokenOrClass, target, propertyKey);
    const propName = name ?? Reflect.getMetadata("di:propName", target, propertyKey);
    let lock: LazyLock<T>;
    Object.defineProperty(target, propertyKey, {
      get() {
        lock ??= new LazyLock(() => globalContainer.resolveAsync(injectToken, propName));
        return lock.get();
      },
      enumerable: true, configurable: true
    });
  };
}

export function InjectMethod() {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    descriptor.value = function (...args: any[]) {
      const types = Reflect.getMetadata("design:paramtypes", target, propertyKey) || [];
      const names: (string|undefined)[] = Reflect.getMetadata(`di:paramNames:${propertyKey}`, target) || [];
      const resolved = types.map((t: any, i: number) => args[i] ?? globalContainer.resolve(token<any>(t.name), names[i]));
      return original.apply(this, resolved);
    };
  };
}

// Method param-level @Named desteği
export function NamedParam(name: string) {
  return function (target: any, propertyKey: string, parameterIndex: number) {
    const arr = Reflect.getOwnMetadata(`di:paramNames:${propertyKey}`, target) || [];
    arr[parameterIndex] = name;
    Reflect.defineMetadata(`di:paramNames:${propertyKey}`, arr, target);
  };
}

function resolveToken(tokenOrClass: any, target: any, propertyKey: string | symbol) {
  if (typeof tokenOrClass === "symbol") return tokenOrClass;
  if (typeof tokenOrClass === "function") return tokenOrClass["di:token"] || token(tokenOrClass.name);
  const type = Reflect.getMetadata("design:type", target, propertyKey);
  return token<any>(type?.name ?? String(propertyKey));
}
