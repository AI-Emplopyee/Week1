import { fileURLToPath } from 'node:url';
import './runtime-env.mjs';

const [command, ...args] = process.argv.slice(2);
if (!['dev', 'build'].includes(command)) throw new Error('Expected dev or build.');

// Keep the CLI in this process so termination reaches the actual server.
const cli = new URL('../node_modules/vinext/dist/cli.js', import.meta.url);
process.argv = [process.execPath, fileURLToPath(cli), command, ...(command === 'dev' ? ['--port', '5173'] : []), ...args];
await import(cli.href);
