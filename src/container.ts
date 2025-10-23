export type Token<T> = symbol & { __t?: T };

type Lifetime = "singleton" | "scoped" | "transient";
type Factory<T> = (c: Container) => T;
type AsyncFactory<T> = (c: Container) => Promise<T>;

interface Registration<T> {
  lifetime: Lifetime;
  factory?: Factory<T>;
  asyncFactory?: AsyncFactory<T>;
  instance?: T;
  resolving?: boolean;
  name?: string;             // named binding
  when?: Condition;          // conditional binding (opsiyonel)
}

type Condition =
  | { type: "env"; key: string; equals?: string; notEquals?: string; present?: boolean }
  | { type: "flag"; key: string; value?: boolean }
  | { type: "profile"; name: string }
  | { type: "fn"; fn: (ctx: ResolutionContext) => boolean };

export type ResolutionContext = {
  env: Record<string, string | undefined>;
  flags: Record<string, boolean | string | number | undefined>;
  profile?: string;
  now: () => number;
};

type ResolutionPolicy = (args: {
  token: symbol;
  candidates: Registration<any>[];
  requestedName?: string;
  ctx: ResolutionContext;
}) => Registration<any> | undefined;

/** 🔒 Thread-safe memoization lock (aynı) */
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
    const v = this.resolver(); if (v instanceof Promise) throw new Error("Attempted sync resolve of async dependency");
    this.value = v; this.resolved = true; return v;
  }
}

/** 🧠 Varsayılan policy: 
 * - requestedName verilmişse onu dener
 * - yoksa koşulu tutan kayıtlar arasından `__default__` isimli olanı tercih eder
 * - o da yoksa tek adaya düşmüşse onu seçer
 */
const defaultPolicy: ResolutionPolicy = ({ candidates, requestedName, ctx }) => {
  const filtered = candidates.filter(r => holds(r.when, ctx));
  if (requestedName) {
    const exact = filtered.find(r => r.name === requestedName);
    return exact ?? undefined;
  }
  // "__default__" isimli kayıt tercih
  const def = filtered.find(r => (r.name ?? "__default__") === "__default__");
  if (def) return def;
  if (filtered.length === 1) return filtered[0];
  return undefined; // belirsiz
};

function holds(cond: Condition | undefined, ctx: ResolutionContext): boolean {
  if (!cond) return true;
  switch (cond.type) {
    case "env": {
      const v = ctx.env[cond.key];
      if (cond.present) return v != null && v !== "";
      if (cond.equals != null) return v === cond.equals;
      if (cond.notEquals != null) return v !== cond.notEquals;
      return false;
    }
    case "flag": {
      const v = ctx.flags[cond.key];
      return cond.value == null ? Boolean(v) : v === cond.value;
    }
    case "profile": return ctx.profile === cond.name;
    case "fn": return !!cond.fn(ctx);
    default: return true;
  }
}

export class Container {
  private parent?: Container;
  private map = new Map<string, Registration<any>[]>();
  private _policy: ResolutionPolicy = defaultPolicy;

  // runtime context (env/flags/profile) — resolve kararları için
  private ctx: ResolutionContext = {
    env: (typeof process !== "undefined" && process.env) ? process.env as any : {},
    flags: {},
    profile: undefined,
    now: () => Date.now()
  };

  constructor(parent?: Container) { this.parent = parent; }

  // -------- Runtime context yönetimi --------
  setFlags(flags: Partial<ResolutionContext["flags"]>) { Object.assign(this.ctx.flags, flags); return this; }
  setProfile(profile?: string) { this.ctx.profile = profile; return this; }
  setEnv(env: Record<string, string | undefined>) { this.ctx.env = env; return this; }
  setResolutionPolicy(policy: ResolutionPolicy) { this._policy = policy; return this; }
  getContext(): ResolutionContext { return this.ctx; }

  // ------------- Named key yardımcıları -------------
  private mapKey(tok: symbol, name?: string) { return `${tok.toString()}::${name ?? "__default__"}`; }
  private listVariants(tok: symbol) {
    const prefix = `${tok.toString()}::`;
    return [...this.map.entries()]
      .filter(([k]) => k.startsWith(prefix))
      .flatMap(([, arr]) => arr);
  }

  // ---------------- Register APIs ----------------
  register<T>(token: Token<T>, factory: Factory<T>, lifetime: Lifetime = "transient", name?: string, when?: Condition): this {
    const key = this.mapKey(token, name);
    const arr = this.map.get(key) ?? [];
    arr.push({ lifetime, factory, name, when });
    this.map.set(key, arr);
    return this;
  }

  registerAsync<T>(token: Token<T>, asyncFactory: AsyncFactory<T>, lifetime: Lifetime = "transient", name?: string, when?: Condition): this {
    const key = this.mapKey(token, name);
    const arr = this.map.get(key) ?? [];
    arr.push({ lifetime, asyncFactory, name, when });
    this.map.set(key, arr);
    return this;
  }

  /** Conditional sugar: env/flag/profile/fn */
  whenEnv<T>(token: Token<T>, key: string, value: string, factory: Factory<T>, lifetime: Lifetime = "singleton", name?: string) {
    return this.register(token, factory, lifetime, name, { type: "env", key, equals: value });
  }
  whenFlag<T>(token: Token<T>, key: string, expected: boolean, factory: Factory<T>, lifetime: Lifetime = "singleton", name?: string) {
    return this.register(token, factory, lifetime, name, { type: "flag", key, value: expected });
  }
  whenProfile<T>(token: Token<T>, profile: string, factory: Factory<T>, lifetime: Lifetime = "singleton", name?: string) {
    return this.register(token, factory, lifetime, name, { type: "profile", name: profile });
  }
  when<T>(token: Token<T>, pred: (ctx: ResolutionContext) => boolean, factory: Factory<T>, lifetime: Lifetime = "singleton", name?: string) {
    return this.register(token, factory, lifetime, name, { type: "fn", fn: pred });
  }

  // ---------------- Resolve APIs ----------------
  resolve<T>(token: Token<T>, name?: string): T {
    const reg = this.pickRegistration<T>(token, name);
    if (!reg) throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    if (reg.asyncFactory) throw new Error(`DI: ${token.toString()} is async, use resolveAsync()`);
    if (reg.resolving) throw new Error(`Circular dependency detected for ${token.toString()} [${reg.name ?? "auto"}]`);

    try {
      reg.resolving = true;
      if (reg.lifetime !== "transient") {
        if (reg.instance === undefined) reg.instance = reg.factory!(this);
        return reg.instance;
      }
      return reg.factory!(this);
    } finally { reg.resolving = false; }
  }

  async resolveAsync<T>(token: Token<T>, name?: string): Promise<T> {
    const reg = this.pickRegistration<T>(token, name);
    if (!reg) throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    if (reg.resolving) throw new Error(`Circular dependency detected for ${token.toString()} [${reg.name ?? "auto"}]`);

    try {
      reg.resolving = true;
      if (reg.asyncFactory) {
        if (reg.lifetime !== "transient") {
          if (reg.instance === undefined) reg.instance = await reg.asyncFactory(this);
          return reg.instance;
        }
        return await reg.asyncFactory(this);
      }
      return this.resolve(token, name);
    } finally { reg.resolving = false; }
  }

  resolveAll<T>(token: Token<T>): T[] {
    const regs = this.listVariants(token).filter(r => holds(r.when, this.ctx));
    if (regs.length === 0 && this.parent) return this.parent.resolveAll(token);
    return regs.map(r => {
      if (r.asyncFactory) throw new Error(`resolveAll: async binding present, use resolveAllAsync`);
      if (r.lifetime !== "transient") { if (r.instance === undefined) r.instance = r.factory!(this); return r.instance as T; }
      return r.factory!(this);
    });
  }

  async resolveAllAsync<T>(token: Token<T>): Promise<T[]> {
    const regs = this.listVariants(token).filter(r => holds(r.when, this.ctx));
    if (regs.length === 0 && this.parent) return await this.parent.resolveAllAsync(token);
    const out: T[] = [];
    for (const r of regs) {
      if (r.asyncFactory) {
        if (r.lifetime !== "transient") { if (r.instance === undefined) r.instance = await r.asyncFactory(this); out.push(r.instance as T); }
        else out.push(await r.asyncFactory(this));
      } else {
        out.push(this.resolve(token, r.name));
      }
    }
    return out;
  }

  // --------------- Lazy (named-aware) ---------------
  resolveLazy<T>(token: Token<T>, name?: string): () => T {
    const lock = new LazyLock(() => this.resolve(token, name));
    // transient ise her çağrıda yeni üret
    const sample = this.pickRegistration<T>(token, name, true);
    if (!sample) throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    return () => sample.lifetime === "transient" ? this.resolve(token, name) : lock.getSync();
  }

  resolveLazyAsync<T>(token: Token<T>, name?: string): () => Promise<T> {
    const lock = new LazyLock(() => this.resolveAsync(token, name));
    const sample = this.pickRegistration<T>(token, name, true);
    if (!sample) throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    return async () => sample.lifetime === "transient" ? await this.resolveAsync(token, name) : await lock.get();
  }

  injectLazy<T>(token: Token<T>, name?: string) {
    const lock = new LazyLock(() => this.resolve(token, name));
    const sample = this.pickRegistration<T>(token, name, true);
    if (!sample) throw new Error(`DI: ambiguous or missing ${token.toString()} [${name ?? "auto"}]`);
    return {
      get: (): T => sample.lifetime === "transient" ? this.resolve(token, name) : lock.getSync(),
      enumerable: true, configurable: true
    };
  }

  createScope(): Container { 
    const child = new Container(this);
    child.setEnv(this.ctx.env);
    child.setFlags(this.ctx.flags);
    child.setProfile(this.ctx.profile);
    child.setResolutionPolicy(this._policy);
    return child;
  }

  // --------------- Internal helpers ---------------
  private pickRegistration<T>(token: Token<T>, requestedName?: string, searchParent = false): Registration<T> | undefined {
    const variants = this.listVariants(token);
    if (variants.length === 0 && this.parent && searchParent !== false) return this.parent.pickRegistration(token, requestedName, true);
    // policy selection
    return (this._policy)({ token, candidates: variants, requestedName, ctx: this.ctx });
  }
}

export const token = <T>(desc: string) => Symbol.for(desc) as Token<T>;
