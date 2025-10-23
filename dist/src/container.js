// @bun
// src/container.ts
class LazyLock {
  resolver;
  value;
  resolved = false;
  pending;
  constructor(resolver) {
    this.resolver = resolver;
  }
  async get() {
    if (this.resolved)
      return this.value;
    if (this.pending)
      return this.pending;
    const p = Promise.resolve(this.resolver()).then((v) => {
      this.value = v;
      this.resolved = true;
      this.pending = undefined;
      return v;
    });
    this.pending = p;
    return p;
  }
  getSync() {
    if (this.resolved)
      return this.value;
    const v = this.resolver();
    if (v instanceof Promise)
      throw new Error("Attempted sync resolve of async dependency");
    this.value = v;
    this.resolved = true;
    return v;
  }
}
var defaultPolicy = ({ candidates, requestedName, ctx }) => {
  const filtered = candidates.filter((r) => holds(r.when, ctx));
  if (requestedName) {
    const exact = filtered.find((r) => r.name === requestedName);
    return exact ?? undefined;
  }
  const def = filtered.find((r) => (r.name ?? "__default__") === "__default__");
  if (def)
    return def;
  if (filtered.length === 1)
    return filtered[0];
  return;
};
function holds(cond, ctx) {
  if (!cond)
    return true;
  switch (cond.type) {
    case "env": {
      const v = ctx.env[cond.key];
      if (cond.present)
        return v != null && v !== "";
      if (cond.equals != null)
        return v === cond.equals;
      if (cond.notEquals != null)
        return v !== cond.notEquals;
      return false;
    }
    case "flag": {
      const v = ctx.flags[cond.key];
      return cond.value == null ? Boolean(v) : v === cond.value;
    }
    case "profile":
      return ctx.profile === cond.name;
    case "fn":
      return !!cond.fn(ctx);
    default:
      return true;
  }
}

class Container {
  parent;
  map = new Map;
  _policy = defaultPolicy;
  ctx = {
    env: typeof process !== "undefined" && process.env ? process.env : {},
    flags: {},
    profile: undefined,
    now: () => Date.now()
  };
  constructor(parent) {
    this.parent = parent;
  }
  setFlags(flags) {
    Object.assign(this.ctx.flags, flags);
    return this;
  }
  setProfile(profile) {
    this.ctx.profile = profile;
    return this;
  }
  setEnv(env) {
    this.ctx.env = env;
    return this;
  }
  setResolutionPolicy(policy) {
    this._policy = policy;
    return this;
  }
  getContext() {
    return this.ctx;
  }
  mapKey(tok, name) {
    return `${tok.toString()}::${name ?? "__default__"}`;
  }
  listVariants(tok) {
    const prefix = `${tok.toString()}::`;
    return [...this.map.entries()].filter(([k]) => k.startsWith(prefix)).flatMap(([, arr]) => arr);
  }
  register(token, factory, lifetime = "transient", name, when) {
    const key = this.mapKey(token, name);
    const arr = this.map.get(key) ?? [];
    arr.push({ lifetime, factory, name, when });
    this.map.set(key, arr);
    return this;
  }
  registerAsync(token, asyncFactory, lifetime = "transient", name, when) {
    const key = this.mapKey(token, name);
    const arr = this.map.get(key) ?? [];
    arr.push({ lifetime, asyncFactory, name, when });
    this.map.set(key, arr);
    return this;
  }
  whenEnv(token, key, value, factory, lifetime = "singleton", name) {
    return this.register(token, factory, lifetime, name, { type: "env", key, equals: value });
  }
  whenFlag(token, key, expected, factory, lifetime = "singleton", name) {
    return this.register(token, factory, lifetime, name, { type: "flag", key, value: expected });
  }
  whenProfile(token, profile, factory, lifetime = "singleton", name) {
    return this.register(token, factory, lifetime, name, { type: "profile", name: profile });
  }
  when(token, pred, factory, lifetime = "singleton", name) {
    return this.register(token, factory, lifetime, name, { type: "fn", fn: pred });
  }
  resolve(token, name) {
    const reg = this.pickRegistration(token, name);
    if (!reg)
      throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    if (reg.asyncFactory)
      throw new Error(`DI: ${token.toString()} is async, use resolveAsync()`);
    if (reg.resolving)
      throw new Error(`Circular dependency detected for ${token.toString()} [${reg.name ?? "auto"}]`);
    try {
      reg.resolving = true;
      if (reg.lifetime !== "transient") {
        if (reg.instance === undefined)
          reg.instance = reg.factory(this);
        return reg.instance;
      }
      return reg.factory(this);
    } finally {
      reg.resolving = false;
    }
  }
  async resolveAsync(token, name) {
    const reg = this.pickRegistration(token, name);
    if (!reg)
      throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    if (reg.resolving)
      throw new Error(`Circular dependency detected for ${token.toString()} [${reg.name ?? "auto"}]`);
    try {
      reg.resolving = true;
      if (reg.asyncFactory) {
        if (reg.lifetime !== "transient") {
          if (reg.instance === undefined)
            reg.instance = await reg.asyncFactory(this);
          return reg.instance;
        }
        return await reg.asyncFactory(this);
      }
      return this.resolve(token, name);
    } finally {
      reg.resolving = false;
    }
  }
  resolveAll(token) {
    const regs = this.listVariants(token).filter((r) => holds(r.when, this.ctx));
    if (regs.length === 0 && this.parent)
      return this.parent.resolveAll(token);
    return regs.map((r) => {
      if (r.asyncFactory)
        throw new Error(`resolveAll: async binding present, use resolveAllAsync`);
      if (r.lifetime !== "transient") {
        if (r.instance === undefined)
          r.instance = r.factory(this);
        return r.instance;
      }
      return r.factory(this);
    });
  }
  async resolveAllAsync(token) {
    const regs = this.listVariants(token).filter((r) => holds(r.when, this.ctx));
    if (regs.length === 0 && this.parent)
      return await this.parent.resolveAllAsync(token);
    const out = [];
    for (const r of regs) {
      if (r.asyncFactory) {
        if (r.lifetime !== "transient") {
          if (r.instance === undefined)
            r.instance = await r.asyncFactory(this);
          out.push(r.instance);
        } else
          out.push(await r.asyncFactory(this));
      } else {
        out.push(this.resolve(token, r.name));
      }
    }
    return out;
  }
  resolveLazy(token, name) {
    const lock = new LazyLock(() => this.resolve(token, name));
    const sample = this.pickRegistration(token, name, true);
    if (!sample)
      throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    return () => sample.lifetime === "transient" ? this.resolve(token, name) : lock.getSync();
  }
  resolveLazyAsync(token, name) {
    const lock = new LazyLock(() => this.resolveAsync(token, name));
    const sample = this.pickRegistration(token, name, true);
    if (!sample)
      throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    return async () => sample.lifetime === "transient" ? await this.resolveAsync(token, name) : await lock.get();
  }
  injectLazy(token, name) {
    const lock = new LazyLock(() => this.resolve(token, name));
    const sample = this.pickRegistration(token, name, true);
    if (!sample)
      throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    return {
      get: () => sample.lifetime === "transient" ? this.resolve(token, name) : lock.getSync(),
      enumerable: true,
      configurable: true
    };
  }
  createScope() {
    const child = new Container(this);
    child.setEnv(this.ctx.env);
    child.setFlags(this.ctx.flags);
    child.setProfile(this.ctx.profile);
    child.setResolutionPolicy(this._policy);
    return child;
  }
  pickRegistration(token, requestedName, searchParent = false) {
    const variants = this.listVariants(token);
    if (variants.length === 0 && this.parent && searchParent !== false)
      return this.parent.pickRegistration(token, requestedName, true);
    return this._policy({ token, candidates: variants, requestedName, ctx: this.ctx });
  }
}
var token = (desc) => Symbol.for(desc);
export {
  token,
  Container
};
