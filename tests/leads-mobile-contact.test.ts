import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const page = readFileSync(join(process.cwd(), 'app/(internal)/leads/page.tsx'), 'utf8');

describe('Leads mobile contact summary', () => {
  it('renders email and phone as separate visible lines when both exist', () => {
    expect(page).toContain('{lead.email && <span className="block break-all">{lead.email}</span>}');
    expect(page).toContain('{(lead.phone || lead.whatsapp) && <span className="block break-all">{lead.phone || lead.whatsapp}</span>}');
  });
});
