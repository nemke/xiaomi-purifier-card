import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const root = process.cwd();
createServer(async (request, response) => {
  try {
    const path = resolve(
      root,
      '.' + new URL(request.url, 'http://localhost').pathname,
    );
    if (!path.startsWith(root + '/')) throw new Error('Invalid path');
    const file = await readFile(path);
    response.writeHead(200, {
      'Content-Type':
        {
          '.html': 'text/html',
          '.js': 'text/javascript',
          '.json': 'application/json',
        }[extname(path)] ?? 'text/plain',
    });
    response.end(file);
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(5173, '127.0.0.1');
