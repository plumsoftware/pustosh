import type Phaser from 'phaser';
import { t } from '../../core/i18n/i18n';

/**
 * Диалоги поверх игры на DOM: нативное поле ввода (на телефоне — системная клавиатура).
 * Пока диалог открыт, клавиатура Phaser выключена — иначе WASD и стрелки перехватываются игрой.
 */
function open(
  game: Phaser.Game,
  build: (box: HTMLDivElement, close: () => void) => void,
  onCancel: () => void,
): void {
  const kb = game.input.keyboard;
  const wasEnabled = kb?.enabled ?? false;
  // Выключенный менеджер не перехватывает клавиши (и не вызывает preventDefault).
  if (kb) kb.enabled = false;
  const back = document.createElement('div');
  back.className = 'pustosh-dialog-back';
  const box = document.createElement('div');
  box.className = 'pustosh-dialog';
  back.appendChild(box);
  const close = () => {
    back.remove();
    if (kb) kb.enabled = wasEnabled;
  };
  back.addEventListener('pointerdown', (e) => {
    if (e.target === back) {
      close();
      onCancel();
    }
  });
  build(box, close);
  document.body.appendChild(back);
}

function button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}

/**
 * Ввод текста. validate возвращает текст ошибки (диалог остаётся открытым) или null.
 * Результат — введённая строка или null при отмене.
 */
export function promptText(
  game: Phaser.Game,
  opts: { title: string; value: string; maxLength: number; validate: (v: string) => Promise<string | null> },
): Promise<string | null> {
  return new Promise((resolve) => {
    open(
      game,
      (box, close) => {
        const h = document.createElement('h2');
        h.textContent = opts.title;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = opts.value;
        input.maxLength = opts.maxLength;
        input.enterKeyHint = 'done';
        input.autocomplete = 'off';
        const err = document.createElement('div');
        err.className = 'error';
        let busy = false;
        const submit = async () => {
          if (busy) return;
          busy = true;
          const msg = await opts.validate(input.value);
          busy = false;
          if (msg) {
            err.textContent = msg;
            input.focus();
            return;
          }
          close();
          resolve(input.value);
        };
        const cancel = () => {
          close();
          resolve(null);
        };
        input.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') void submit();
          if (e.key === 'Escape') cancel();
          e.stopPropagation();
        });
        input.addEventListener('input', () => (err.textContent = ''));
        const row = document.createElement('div');
        row.className = 'buttons';
        row.append(
          button(t('ui.cancel'), '', cancel),
          button(t('ui.ok'), 'primary', () => void submit()),
        );
        box.append(h, input, err, row);
        setTimeout(() => {
          input.focus();
          input.select();
        }, 30);
      },
      () => resolve(null),
    );
  });
}

/** Подтверждение (удаление и т.п.). */
export function confirmDialog(
  game: Phaser.Game,
  opts: { text: string; okLabel: string; danger?: boolean },
): Promise<boolean> {
  return new Promise((resolve) => {
    open(
      game,
      (box, close) => {
        const p = document.createElement('div');
        p.textContent = opts.text;
        const row = document.createElement('div');
        row.className = 'buttons';
        row.append(
          button(t('ui.cancel'), '', () => {
            close();
            resolve(false);
          }),
          button(opts.okLabel, opts.danger ? 'danger' : 'primary', () => {
            close();
            resolve(true);
          }),
        );
        box.append(p, row);
      },
      () => resolve(false),
    );
  });
}
