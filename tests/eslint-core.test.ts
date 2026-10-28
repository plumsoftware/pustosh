import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import { join } from 'node:path';
import { ROOT } from '../tools/readGameFiles';

describe('ESLint: правила src/core', () => {
  it('не пускает Phaser, браузер, системное время и Math.random в core', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const code =
      "import Phaser from 'phaser';\nexport const x = [Phaser, Date.now(), Math.random(), window];\n";
    const [res] = await eslint.lintText(code, { filePath: join(ROOT, 'src/core/util/__probe.ts') });
    const rules = res!.messages.map((m) => m.ruleId);
    expect(rules).toContain('no-restricted-imports');
    expect(rules.filter((r) => r === 'no-restricted-properties')).toHaveLength(2);
    expect(rules).toContain('no-restricted-globals');
  });

  it('в src/game Phaser разрешён', async () => {
    const eslint = new ESLint({ cwd: ROOT });
    const [res] = await eslint.lintText("import Phaser from 'phaser';\nexport const v = Phaser.VERSION;\n", {
      filePath: join(ROOT, 'src/game/__probe.ts'),
    });
    expect(res!.messages).toEqual([]);
  });
});
