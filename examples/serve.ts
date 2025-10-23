import { Service, Inject, globalContainer } from "bun-ioc/decorator";
import { token } from "bun-ioc/container";

// Simple greeting service
@Service({ lifetime: "singleton" })
class TimeService {
  nowISO() { return new Date().toISOString(); }
}

@Service({ lifetime: "singleton" })
class Greeter {
  @Inject(TimeService) private time!: TimeService;
  greet(name: string) { return `Hello ${name}! (at ${this.time.nowISO()})`; }
}

const greeterToken = token<Greeter>("Greeter");

const PORT = Number(process.env.PORT ?? "3000");
const server = Bun.serve({
  port: PORT,
  fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === "/hello") {
      const name = url.searchParams.get("name") ?? "World";
      const greeter = globalContainer.resolve(greeterToken);
      const msg = greeter.greet(name);
      return new Response(msg, { headers: { "content-type": "text/plain" } });
    }
    if (url.pathname === "/") {
      return new Response("Try GET /hello?name=YourName", { headers: { "content-type": "text/plain" } });
    }
    return new Response("Not Found", { status: 404 });
  }
});

console.log(`bun-ioc demo server running on http://localhost:${server.port}`);
