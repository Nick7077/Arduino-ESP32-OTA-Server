const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();
const port = 3001;

app.use(cors());
app.use(express.json());

app.post('/api/upload', (req, res) => {
  const { code, ip, password, ssid, wifiPassword } = req.body;

  if (!code || !ip) {
    return res.status(400).json({ error: 'Code and IP address are required' });
  }

  if (!/^(\d{1,3}\.){3}\d{1,3}$/.test(ip)) {
    return res.status(400).json({ error: 'Invalid IP address format' });
  }

  // SSE setup
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendStatus = (type, message) => {
    res.write(`data: ${JSON.stringify({ type, message })}\n\n`);
  };

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'arduino-ota-'));
  const sketchDir = path.join(tmpDir, 'sketch');
  fs.mkdirSync(sketchDir);
  
  // Create user_code.h from the provided code
  const userCodePath = path.join(sketchDir, 'user_code.h');
  fs.writeFileSync(userCodePath, code);

  // Create the main sketch.ino that wraps the user code
  const inoPath = path.join(sketchDir, 'sketch.ino');
  const wrapperCode = `
#include <WiFi.h>
#include <ArduinoOTA.h>

// WiFi and OTA credentials injected from backend
const char* _ota_ssid = "${ssid || ''}";
const char* _ota_wifi_pass = "${wifiPassword || ''}";
const char* _ota_pass = "${password || ''}";

void _setupOTA() {
  if (WiFi.status() != WL_CONNECTED && strlen(_ota_ssid) > 0) {
    Serial.println("OTA: Connecting to WiFi...");
    WiFi.mode(WIFI_STA);
    WiFi.begin(_ota_ssid, _ota_wifi_pass);
    
    // We don't want to block the user's setup indefinitely, 
    // but OTA won't work without WiFi.
    // Try to connect for 10 seconds.
    int attempts = 0;
    while (WiFi.status() != WL_CONNECTED && attempts < 20) {
      delay(500);
      Serial.print(".");
      attempts++;
    }
    
    if (WiFi.status() == WL_CONNECTED) {
      Serial.println("\\nOTA: Connected! IP: " + WiFi.localIP().toString());
    } else {
      Serial.println("\\nOTA: WiFi Connection Failed. Skipping OTA setup.");
      return;
    }
  }

  ArduinoOTA.setHostname("esp32-ota-node");
  if (strlen(_ota_pass) > 0) {
    ArduinoOTA.setPassword(_ota_pass);
  }

  ArduinoOTA.onStart([]() {
    String type = (ArduinoOTA.getCommand() == U_FLASH) ? "sketch" : "filesystem";
    Serial.println("OTA: Start updating " + type);
  });
  
  ArduinoOTA.onEnd([]() { Serial.println("\\nOTA: End"); });
  ArduinoOTA.onProgress([](unsigned int progress, unsigned int total) {
    Serial.printf("OTA Progress: %u%%\\r", (progress * 100) / total);
  });
  
  ArduinoOTA.onError([](ota_error_t error) {
    Serial.printf("OTA Error[%u]: ", error);
  });

  ArduinoOTA.begin();
  Serial.println("OTA: Ready");
}

// Rename user's setup and loop so we can wrap them
#define setup user_setup
#define loop user_loop
#include "user_code.h"
#undef setup
#undef loop

void setup() {
  Serial.begin(115200);
  _setupOTA();
  
  // Call the user's setup function
  user_setup();
}

void loop() {
  ArduinoOTA.handle();
  
  // Call the user's loop function
  user_loop();
}
`;
  fs.writeFileSync(inoPath, wrapperCode);

  sendStatus('status', 'Starting compilation...');

  const outputDir = path.join(tmpDir, 'build');
  fs.mkdirSync(outputDir);

  const compile = spawn('arduino-cli', [
    'compile',
    '--fqbn', 'arduino:esp32:nano_nora',
    '--output-dir', outputDir,
    sketchDir
  ]);

  compile.stdout.on('data', (data) => sendStatus('log', data.toString()));
  compile.stderr.on('data', (data) => sendStatus('error', data.toString()));

  compile.on('error', (err) => {
    sendStatus('error', `Failed to start arduino-cli: ${err.message}`);
    sendStatus('status', 'Compilation failed');
    fs.rmSync(tmpDir, { recursive: true, force: true });
    res.end();
  });

  compile.on('close', (exitCode) => {
    if (exitCode !== 0) {
      sendStatus('status', 'Compilation failed');
      fs.rmSync(tmpDir, { recursive: true, force: true });
      res.end();
      return;
    }

    sendStatus('status', 'Compilation successful. Starting upload...');

    // Find the compiled .bin file
    const binFile = fs.readdirSync(outputDir)
      .find(f => f.endsWith('.ino.bin'));
    const buildDir = binFile ? path.join(outputDir, binFile) : null;

    if (!buildDir) {
      sendStatus('error', 'Could not find compiled .bin file');
      sendStatus('status', 'Upload failed');
      fs.rmSync(tmpDir, { recursive: true, force: true });
      res.end();
      return;
    }

    sendStatus('log', `Found binary: ${path.basename(buildDir)}`);

    // Find espota.py bundled with the ESP32 core
    const findEspota = spawn('arduino-cli', ['config', 'dump', '--format', 'json']);
    let configJson = '';
    findEspota.stdout.on('data', (data) => { configJson += data.toString(); });

    findEspota.on('close', () => {
      // Search for espota.py in the arduino-cli data directory
      let espotaPath = null;
      try {
        const config = JSON.parse(configJson);
        const dataDir = config.directories?.data || config.directories?.Data;
        if (dataDir) {
          const searchDir = path.join(dataDir, 'packages', 'arduino', 'hardware', 'esp32');
          if (fs.existsSync(searchDir)) {
            const findFile = (dir, filename) => {
              const entries = fs.readdirSync(dir, { withFileTypes: true });
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                  const found = findFile(fullPath, filename);
                  if (found) return found;
                } else if (entry.name === filename) {
                  return fullPath;
                }
              }
              return null;
            };
            espotaPath = findFile(searchDir, 'espota.py');
          }
        }
      } catch (e) {
        // Fall through to fallback
      }

      if (!espotaPath) {
        // Fallback: try arduino-cli upload anyway
        sendStatus('log', 'espota.py not found, falling back to arduino-cli upload...');
        const uploadArgs = [
          'upload',
          '-p', ip,
          '--protocol', 'network',
          '--fqbn', 'arduino:esp32:nano_nora',
          '--discovery-timeout', '30s',
          '--upload-field', `password=${password || ''}`,
          sketchDir
        ];
        const upload = spawn('arduino-cli', uploadArgs);
        upload.stdout.on('data', (data) => sendStatus('log', data.toString()));
        upload.stderr.on('data', (data) => sendStatus('error', data.toString()));
        upload.on('error', (err) => {
          sendStatus('error', `Failed to start arduino-cli: ${err.message}`);
          sendStatus('status', 'Upload failed');
          fs.rmSync(tmpDir, { recursive: true, force: true });
          res.end();
        });
        upload.on('close', (exitCode) => {
          sendStatus('status', exitCode === 0 ? 'Upload successful!' : 'Upload failed');
          res.end();
          fs.rmSync(tmpDir, { recursive: true, force: true });
        });
        return;
      }

      sendStatus('log', `Using espota.py for direct OTA upload to ${ip}...`);

      const espotaArgs = [
        espotaPath,
        '-i', ip,
        '-p', '3232',
        '-f', buildDir,
      ];
      if (password) {
        espotaArgs.push('-a', password);
      }

      const upload = spawn('python', espotaArgs);

      upload.stdout.on('data', (data) => sendStatus('log', data.toString()));
      upload.stderr.on('data', (data) => {
        const msg = data.toString();
        // espota.py prints progress to stderr, often with \r
        if (msg.includes('%')) {
          const lines = msg.split(/[\r\n]+/);
          const progressLine = lines.filter(l => l.includes('%')).pop();
          if (progressLine) {
            sendStatus('log', progressLine.trim());
          }
        } else {
          sendStatus('error', msg);
        }
      });

      upload.on('error', (err) => {
        sendStatus('error', `Failed to start espota.py: ${err.message}`);
        sendStatus('status', 'Upload failed');
        fs.rmSync(tmpDir, { recursive: true, force: true });
        res.end();
      });

      upload.on('close', (exitCode) => {
        if (exitCode === 0) {
          sendStatus('status', 'Upload successful!');
        } else {
          sendStatus('status', 'Upload failed');
        }
        res.end();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      });
    });
  });
});

app.listen(port, () => {
  console.log(`Backend listening at http://localhost:${port}`);
});
