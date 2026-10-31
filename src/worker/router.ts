// A very small router: "METHOD /path/:param" -> handler.

export type Params = Record<string, string>;

export interface Route<Ctx> {
  method: string;
  regex: RegExp;
  keys: string[];
  handler: (ctx: Ctx, params: Params) => Promise<Response>;
}

export class Router<Ctx> {
  private routes: Route<Ctx>[] = [];

  add(method: string, pattern: string, handler: Route<Ctx>["handler"]): this {
    const keys: string[] = [];
    const source = pattern
      .split("/")
      .map((part) => {
        if (part.startsWith(":")) {
          keys.push(part.slice(1));
          return "([^/]+)";
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    this.routes.push({ method, regex: new RegExp(`^${source}/?$`), keys, handler });
    return this;
  }

  get = (pattern: string, h: Route<Ctx>["handler"]) => this.add("GET", pattern, h);
  post = (pattern: string, h: Route<Ctx>["handler"]) => this.add("POST", pattern, h);
  put = (pattern: string, h: Route<Ctx>["handler"]) => this.add("PUT", pattern, h);
  patch = (pattern: string, h: Route<Ctx>["handler"]) => this.add("PATCH", pattern, h);
  delete = (pattern: string, h: Route<Ctx>["handler"]) => this.add("DELETE", pattern, h);

  /** Returns the matching route, "method-not-allowed" if the path exists for other methods, or null. */
  match(method: string, pathname: string): { route: Route<Ctx>; params: Params } | "method-not-allowed" | null {
    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.regex.exec(pathname);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== method) continue;
      const params: Params = {};
      route.keys.forEach((k, i) => {
        params[k] = decodeURIComponent(m[i + 1] ?? "");
      });
      return { route, params };
    }
    return pathMatched ? "method-not-allowed" : null;
  }
}
