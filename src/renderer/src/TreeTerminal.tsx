import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

export function TreeTerminal({
  terminalId,
  cwd,
  ariaLabel,
  initialCommand,
}: {
  terminalId: string;
  cwd: string;
  ariaLabel: string;
  initialCommand?: string;
}): React.JSX.Element {
  const terminalElementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const terminalElement = terminalElementRef.current;

    if (!terminalElement) return;

    const terminal = new Terminal({
      cursorBlink: true,
      vtExtensions: {
        kittyKeyboard: true,
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      theme: {
        background: "#111111",
        foreground: "#f2f2f2",
      },
      linkHandler: {
        activate: (_event, text) => {
          const confirmed = window.confirm(
            `Do you want to navigate to ${text}?\n\nWARNING: This link could potentially be dangerous`,
          );

          if (confirmed) void window.api.external.open(text);
        },
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(terminalElement);
    terminal.attachCustomKeyEventHandler((event) => {
      // On macOS, Cmd shortcuts should stay in Electron/Chromium instead of
      // being encoded by xterm's kitty keyboard mode and sent to the PTY. In
      // particular, returning false for Cmd+V lets the native paste pipeline
      // fire xterm's paste event, matching Edit -> Paste behavior.
      if (
        navigator.platform.toLowerCase().includes("mac") &&
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        return false;
      }

      return true;
    });
    fitAddon.fit();

    const resizeShell = (): void => {
      fitAddon.fit();
      window.api.terminal.resize(terminalId, {
        cols: terminal.cols,
        rows: terminal.rows,
      });
    };

    const resizeObserver = new ResizeObserver(resizeShell);
    const removeDataListener = window.api.terminal.onData((event) => {
      if (event.terminalId === terminalId) terminal.write(event.data);
    });
    const removeExitListener = window.api.terminal.onExit(
      ({ terminalId: exitedTerminalId, exitCode }) => {
        if (exitedTerminalId === terminalId) {
          terminal.writeln(`\r\n[process exited with code ${exitCode}]`);
        }
      },
    );
    const inputDisposable = terminal.onData((data) =>
      window.api.terminal.write(terminalId, data),
    );

    resizeObserver.observe(terminalElement);

    window.api.terminal.start({
      terminalId,
      cols: terminal.cols,
      rows: terminal.rows,
      cwd,
      initialCommand,
    });

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();
      terminal.dispose();
    };
  }, [cwd, initialCommand, terminalId]);

  return (
    <section className="terminal-shell" aria-label={ariaLabel}>
      <div ref={terminalElementRef} className="terminal-container" />
    </section>
  );
}
