import { readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** New code assets need stable UUIDs checked into Git before Creator imports them. */
function visit(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) visit(path);
    else if (entry.name.endsWith('.ts') && !existsSync(path + '.meta')) {
      writeFileSync(path + '.meta', JSON.stringify({ ver: '4.0.24', importer: 'typescript', imported: true, uuid: randomUUID(), files: [], subMetas: {}, userData: {} }, null, 2) + '\n');
    }
  }
}
visit('assets/scripts');
