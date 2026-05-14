import { FitAddon } from "@xterm/addon-fit";
import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import "xterm/css/xterm.css";

function App(): React.JSX.Element {
  const terminalElementRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const terminalElement = terminalElementRef.current;

    if (!terminalElement) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      theme: {
        background: "#111111",
        foreground: "#f2f2f2",
      },
    });
    const fitAddon = new FitAddon();

    terminal.loadAddon(fitAddon);
    terminal.open(terminalElement);
    fitAddon.fit();

    const resizeShell = (): void => {
      fitAddon.fit();
      window.api.terminal.resize({ cols: terminal.cols, rows: terminal.rows });
    };

    const resizeObserver = new ResizeObserver(resizeShell);
    const removeDataListener = window.api.terminal.onData((data) =>
      terminal.write(data),
    );
    const removeExitListener = window.api.terminal.onExit(({ exitCode }) => {
      terminal.writeln(`\r\n[process exited with code ${exitCode}]`);
    });
    const inputDisposable = terminal.onData((data) =>
      window.api.terminal.write(data),
    );

    resizeObserver.observe(terminalElement);

    window.api.terminal.start({ cols: terminal.cols, rows: terminal.rows });

    return () => {
      resizeObserver.disconnect();
      inputDisposable.dispose();
      removeDataListener();
      removeExitListener();
      window.api.terminal.dispose();
      terminal.dispose();
    };
  }, []);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-title">Canopy</div>
      </header>
      <section className="terminal-shell" aria-label="Terminal">
        <div ref={terminalElementRef} className="terminal-container" />
      </section>
    </main>
  );
}

export default App;
