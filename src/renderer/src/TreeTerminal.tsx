import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import "@xterm/xterm/css/xterm.css";

export function TreeTerminal({
  terminalId,
  cwd,
  ariaLabel,
}: {
  terminalId: string;
  cwd: string;
  ariaLabel: string;
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
    });

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();
      terminal.dispose();
    };
  }, [cwd, terminalId]);

  return (
    <section className="terminal-shell" aria-label={ariaLabel}>
      <div ref={terminalElementRef} className="terminal-container" />
    </section>
  );
}
