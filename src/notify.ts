/**
 * Desktop notifications.
 *
 * Sound only helps if you can hear it, and a terminal on another workspace is
 * exactly where a pomodoro goes to be forgotten. So the end of a phase also
 * gets handed to whatever this machine uses for notifications.
 *
 * Which one that is gets discovered the same way `Chime` finds an audio
 * player: try them in order and let a missing binary fail its own spawn. That
 * is cheaper than probing PATH and it doesn't lie about what will actually
 * work. Nothing here is load-bearing — if every notifier is missing we go
 * quiet and the timer carries on.
 */

import { spawn } from 'node:child_process';

type Notifier = {
  command: string;
  args: (title: string, body: string) => string[];
};

/** An AppleScript string literal. Same escapes as JSON, near enough. */
function osaString(text: string): string {
  return JSON.stringify(text);
}

/** A PowerShell single-quoted string, where the only escape is doubling. */
function psString(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

const NOTIFIERS: readonly Notifier[] =
  process.platform === 'darwin'
    ? [
        {
          command: 'osascript',
          args: (title, body) => [
            '-e',
            `display notification ${osaString(body)} with title ${osaString(title)}`,
          ],
        },
      ]
    : process.platform === 'win32'
      ? [
          {
            command: 'powershell',
            args: (title, body) => [
              '-NoProfile',
              '-Command',
              // A balloon tip, because it needs no modules installed.
              [
                "Add-Type -AssemblyName System.Windows.Forms;",
                "$n = New-Object System.Windows.Forms.NotifyIcon;",
                "$n.Icon = [System.Drawing.SystemIcons]::Information;",
                "$n.Visible = $true;",
                `$n.ShowBalloonTip(5000, ${psString(title)}, ${psString(body)}, 'Info');`,
                'Start-Sleep -Seconds 5;',
                '$n.Dispose()',
              ].join(' '),
            ],
          },
        ]
      : [
          { command: 'notify-send', args: (title, body) => ['-a', 'pomo', title, body] },
          {
            command: 'kdialog',
            args: (title, body) => ['--title', title, '--passivepopup', body, '5'],
          },
        ];

/**
 * Sends notifications, once it has found something that can. Stops trying
 * altogether after the last candidate fails, so a machine with no notifier
 * spawns two doomed processes and then never again.
 */
export class Notifications {
  #notifier: Notifier | null = null;
  #exhausted = false;

  send(title: string, body: string): void {
    if (this.#exhausted) return;
    this.#spawn(title, body, this.#notifier ? NOTIFIERS.indexOf(this.#notifier) : 0);
  }

  #spawn(title: string, body: string, index: number): void {
    const notifier = NOTIFIERS[index];
    if (!notifier) {
      this.#exhausted = true;
      return;
    }

    let child;
    try {
      child = spawn(notifier.command, notifier.args(title, body), {
        stdio: 'ignore',
        detached: true,
      });
    } catch {
      this.#spawn(title, body, index + 1);
      return;
    }

    // ENOENT arrives here rather than as a throw, same as with the players.
    child.on('error', () => {
      if (this.#notifier === notifier) this.#notifier = null;
      this.#spawn(title, body, index + 1);
    });
    child.on('spawn', () => {
      this.#notifier = notifier;
    });
    child.unref();
  }
}
