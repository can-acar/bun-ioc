export type Token<T> = symbol & {
    __t?: T;
};
type Lifetime = "singleton" | "scoped" | "transient";
type Factory<T> = (c: Container) => T;
type AsyncFactory<T> = (c: Container) => Promise<T>;
interface Registration<T> {
    lifetime: Lifetime;
    factory?: Factory<T>;
    asyncFactory?: AsyncFactory<T>;
    instance?: T;
    resolving?: boolean;
    name?: string;
    when?: Condition;
}
type Condition = {
    type: "env";
    key: string;
    equals?: string;
    notEquals?: string;
    present?: boolean;
} | {
    type: "flag";
    key: string;
    value?: boolean;
} | {
    type: "profile";
    name: string;
} | {
    type: "fn";
    fn: (ctx: ResolutionContext) => boolean;
};
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
export declare class Container {
    private parent?;
    private map;
    private _policy;
    private ctx;
    constructor(parent?: Container);
    setFlags(flags: Partial<ResolutionContext["flags"]>): this;
    setProfile(profile?: string): this;
    setEnv(env: Record<string, string | undefined>): this;
    setResolutionPolicy(policy: ResolutionPolicy): this;
    getContext(): ResolutionContext;
    private mapKey;
    private listVariants;
    register<T>(token: Token<T>, factory: Factory<T>, lifetime?: Lifetime, name?: string, when?: Condition): this;
    registerAsync<T>(token: Token<T>, asyncFactory: AsyncFactory<T>, lifetime?: Lifetime, name?: string, when?: Condition): this;
    /** Conditional sugar: env/flag/profile/fn */
    whenEnv<T>(token: Token<T>, key: string, value: string, factory: Factory<T>, lifetime?: Lifetime, name?: string): this;
    whenFlag<T>(token: Token<T>, key: string, expected: boolean, factory: Factory<T>, lifetime?: Lifetime, name?: string): this;
    whenProfile<T>(token: Token<T>, profile: string, factory: Factory<T>, lifetime?: Lifetime, name?: string): this;
    when<T>(token: Token<T>, pred: (ctx: ResolutionContext) => boolean, factory: Factory<T>, lifetime?: Lifetime, name?: string): this;
    resolve<T>(token: Token<T>, name?: string): T;
    resolveAsync<T>(token: Token<T>, name?: string): Promise<T>;
    resolveAll<T>(token: Token<T>): T[];
    resolveAllAsync<T>(token: Token<T>): Promise<T[]>;
    resolveLazy<T>(token: Token<T>, name?: string): () => T;
    resolveLazyAsync<T>(token: Token<T>, name?: string): () => Promise<T>;
    injectLazy<T>(token: Token<T>, name?: string): {
        get: () => T;
        enumerable: boolean;
        configurable: boolean;
    };
    createScope(): Container;
    private pickRegistration;
}
export declare const token: <T>(desc: string) => Token<T>;
export {};
