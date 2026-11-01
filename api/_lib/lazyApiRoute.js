// Share initialization across concurrent requests, while keeping request data
// and the handler's own authorization checks outside the module cache.
export function lazyApiRoute(importModule, exportName = 'default') {
  let handlerPromise;
  return async function lazyHandler(req, res) {
    handlerPromise ??= importModule().then((module) => module[exportName]);
    const handler = await handlerPromise;
    return handler(req, res);
  };
}
