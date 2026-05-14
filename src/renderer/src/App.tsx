function App(): React.JSX.Element {
  const ipcHandle = (): void => window.electron.ipcRenderer.send("ping");

  return (
    <main>
      <h1>Hello world</h1>
      <button type="button" onClick={ipcHandle}>
        Ping
      </button>
    </main>
  );
}

export default App;
