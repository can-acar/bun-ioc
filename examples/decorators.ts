import "reflect-metadata";
import { globalContainer, Service, Inject, InjectLazy, Named, InjectMethod, NamedParam } from "../src/decorator";
import { token } from "../src/container";

// Define tokens for primitives used by @InjectMethod reflections
const TString = token<string>("String");
const TNumber = token<number>("Number");

// Primitive providers
globalContainer.register(TString, () => "hello", "singleton");
globalContainer.register(TNumber, () => 7, "singleton");

// Named dependency class
class Driver { constructor(public kind: string) {} }
const TDriver = token<Driver>("Driver");
// named implementations
globalContainer.register(TDriver, () => new Driver("A"), "singleton", "A");
globalContainer.register(TDriver, () => new Driver("B"), "singleton", "B");

@Service()
class Repository {
  id = Math.random().toString(16).slice(2);
}

@Service()
class ServiceA {
  constructor(@Named("B") public driver: Driver, public repo: Repository) {}

  @InjectMethod()
  greet(who: string, count: number) {
    return `${who}#${count}@${this.driver.kind}`;
  }
}

// Async token example for @InjectLazy
const TRepoIdAsync = token<string>("RepoIdAsync");
globalContainer.registerAsync(TRepoIdAsync, async () => "async-repo-id", "singleton");

@Service()
class ServiceB {
  @Inject(Repository) repo!: Repository;
  @InjectLazy(TRepoIdAsync) lazyId!: Promise<string>;
}

const sa = globalContainer.resolve(token<ServiceA>("ServiceA"));
console.log("ServiceA.greet:", (sa as any).greet());

const sb = globalContainer.resolve(token<ServiceB>("ServiceB"));
console.log("ServiceB.repo:", sb.repo.id);
console.log("ServiceB.lazyId:", await sb.lazyId);
