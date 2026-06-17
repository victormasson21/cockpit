// App.tsx — root component; currently a smoke test proving the Tauri IPC round-trip works.
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./App.css";

function App() {
  const [reply, setReply] = useState("");
  useEffect(() => {
    invoke<string>("ping").then(setReply);
  }, []);
  return <div>IPC says: {reply}</div>;
}

export default App;
