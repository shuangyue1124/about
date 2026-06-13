export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return env.ASSETS.fetch(request);
    }

    const url = new URL(request.url);
    const paths = assetCandidates(url.pathname);

    for (const path of paths) {
      const assetUrl = new URL(request.url);
      assetUrl.pathname = path;
      const response = await env.ASSETS.fetch(new Request(assetUrl, request));
      if (response.status !== 404) return response;
    }

    return env.ASSETS.fetch(request);
  },
};

function assetCandidates(pathname) {
  const paths = [pathname];

  if (pathname === "/") {
    paths.push("/index.html");
  } else if (pathname.endsWith("/")) {
    paths.push(`${pathname}index.html`);
  } else if (pathname.endsWith(".html")) {
    paths.push(pathname.slice(0, -5));
  } else if (!pathname.split("/").pop().includes(".")) {
    paths.push(`${pathname}.html`, `${pathname}/index.html`);
  }

  return [...new Set(paths)];
}
