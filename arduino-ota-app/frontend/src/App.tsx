import React, { useState, useRef, useEffect } from 'react';
import { Upload, Terminal, Settings, Code, Wifi, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import './App.css';

function App() {
  const [code, setCode] = useState(`void setup() {
  // Your code here
}

void loop() {
  // Your code here
}`);
  const [ip, setIp] = useState('');
  const [password, setPassword] = useState('');
  const [ssid, setSsid] = useState('');
  const [wifiPassword, setWifiPassword] = useState('');
  const [logs, setLogs] = useState<{ type: string; message: string }[]>([]);
  const [status, setStatus] = useState('Idle');
  const [isUploading, setIsUploading] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [logs]);

  const handleUpload = async () => {
    if (!ip) {
      alert("Please enter the IP address of your Nano ESP32");
      return;
    }

    setIsUploading(true);
    setLogs([]);
    setStatus('Preparing...');

    try {
      const response = await fetch('http://localhost:3001/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, ip, password, ssid, wifiPassword }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        setLogs(prev => [...prev, { type: 'error', message: errorData.error || 'Upload request failed' }]);
        setStatus('Upload failed');
        setIsUploading(false);
        return;
      }

      if (!response.body) return;

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() || '';

        parts.forEach(part => {
          if (part.startsWith('data: ')) {
            try {
              const data = JSON.parse(part.slice(6));
              if (data.type === 'status') {
                setStatus(data.message);
                if (data.message.includes('successful') || data.message.includes('failed')) {
                  setIsUploading(false);
                }
              } else {
                setLogs(prev => {
                  const isProgress = data.message.includes('Uploading:');
                  if (isProgress && prev.length > 0 && prev[prev.length - 1].message.includes('Uploading:')) {
                    const newLogs = [...prev];
                    newLogs[newLogs.length - 1] = data;
                    return newLogs;
                  }
                  return [...prev, data];
                });
              }
            } catch (e) {
              console.error("Error parsing SSE data", e);
            }
          }
        });
      }
    } catch (error) {
      setLogs(prev => [...prev, { type: 'error', message: String(error) }]);
      setStatus('Upload failed');
      setIsUploading(false);
    }
  };

  return (
    <div className="container">
      <header>
        <h1><Upload size={32} /> Arduino ESP32 OTA</h1>
        <div className="connection-info">
          <div className="input-group">
            <Wifi size={18} />
            <input 
              type="text" 
              placeholder="SSID" 
              value={ssid}
              onChange={(e) => setSsid(e.target.value)}
            />
          </div>
          <div className="input-group">
            <Settings size={18} />
            <input 
              type="password" 
              placeholder="WiFi Password" 
              value={wifiPassword}
              onChange={(e) => setWifiPassword(e.target.value)}
            />
          </div>
          <div className="input-group">
            <Terminal size={18} />
            <input 
              type="text" 
              placeholder="Board IP" 
              value={ip}
              onChange={(e) => setIp(e.target.value)}
            />
          </div>
          <div className="input-group">
            <Settings size={18} />
            <input 
              type="password" 
              placeholder="OTA Password" 
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
        </div>
      </header>

      <main>
        <div className="editor-section">
          <div className="section-header">
            <Code size={20} />
            <span>Sketch Editor</span>
          </div>
          <textarea 
            className="code-editor"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            spellCheck="false"
          />
        </div>

        <div className="log-section">
          <div className="section-header">
            <Terminal size={20} />
            <span>Output Console</span>
            <span className={`status-badge ${status.toLowerCase().includes('fail') ? 'error' : status.toLowerCase().includes('success') ? 'success' : 'pending'}`}>
              {status}
            </span>
          </div>
          <div className="console">
            {logs.map((log, i) => (
              <div key={i} className={`log-line ${log.type}`}>
                {log.message}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </main>

      <button 
        className={`upload-btn ${isUploading ? 'loading' : ''}`} 
        onClick={handleUpload}
        disabled={isUploading}
      >
        {isUploading ? <Loader2 className="spin" /> : <Upload />}
        {isUploading ? 'Uploading...' : 'Flash Wirelessly'}
      </button>

      <footer>
        <p>Ensure your Nano ESP32 has an initial OTA-enabled sketch flashed via USB.</p>
      </footer>
    </div>
  );
}

export default App;
