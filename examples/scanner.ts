import "reflect-metadata";
import { Container, token } from "../src/container";
import { scanModules } from "../src/module-scanner";
import { Service, globalContainer } from "../src/decorator";

const container = globalContainer;

// A decorated service that scanner should leave as-is
@Service()
class Decorated {
  id = "decorated";
}

// An undecorated class; scanner can auto bind
function Meta(): ClassDecorator { return () => {}; }

@Meta()
class Greeter {
  constructor(public who: Decorated) {}
  say() { return `hi from ${this.who.id}`; }
}

// A module with configure hook
const WithConfigure = {
  configure(c: Container) {
    const T = token<string>("cfg");
    c.register(T, () => "configured", "singleton");
  }
};

async function main() {
  await scanModules(container, [WithConfigure, { Decorated, Greeter }], {
    autoBindUndecorated: true,
    fallbackLifetime: "transient",
  });

  const TGreeter = token<Greeter>("Greeter");
  const g1 = container.resolve(TGreeter);
  const g2 = container.resolve(TGreeter);
  console.log(g1.say());
  console.log("new instance each time?", g1 !== g2);
}

await main();
