# Changes Made — Arduino ESP32 Wireless Code Upload

## ESP_Recieve_Code/ESP_Recieve_Code.ino

### 1. Removed hardcoded WiFi credentials
- **Before:** SSID (`"SkiHouse"`) and password (`"ShredTheKnar!9"`) were hardcoded in plain text.
- **After:** Credentials are pulled from `arduino_secrets.h` via `SECRET_SSID` and `SECRET_WIFI_PASS` defines. This prevents accidental exposure in version control.

### 2. Enabled OTA password authentication
- **Before:** `ArduinoOTA.setPassword("admin")` was commented out, meaning any device on the network could push firmware to the board.
- **After:** `ArduinoOTA.setPassword(SECRET_OTA_PASS)` is active, using a password defined in `arduino_secrets.h`. The same password must be entered in the web app's "OTA Password" field when uploading.

### 3. Fixed divide-by-zero in progress callback
- **Before:** `(progress / (total / 100))` — integer division causes `total / 100` to evaluate to `0` when `total < 100`, crashing the board.
- **After:** `if (total > 0) Serial.printf("Progress: %u%%\r", (progress * 100) / total);` — safe formula with a guard.

## ESP_Recieve_Code/arduino_secrets.h (new file)

Created a secrets header file with placeholder values for `SECRET_SSID`, `SECRET_WIFI_PASS`, and `SECRET_OTA_PASS`. Users must fill in their real credentials before flashing. This file should not be committed to version control.

## arduino-ota-app/backend/index.js

### 4. Fixed temp directory leak on compilation failure
- **Before:** When compilation failed, `tmpDir` was never cleaned up — `fs.rmSync` only ran inside the upload's `close` handler.
- **After:** `fs.rmSync(tmpDir, { recursive: true, force: true })` is called in the compile failure branch before `res.end()`.

### 5. Added IP address validation
- **Before:** The `ip` field from the request body was used directly with no validation.
- **After:** A regex check (`/^(\d{1,3}\.){3}\d{1,3}$/`) rejects malformed IPs with a 400 error before any processing begins.

### 6. Added spawn error handlers
- **Before:** If `arduino-cli` was not installed or not on PATH, `spawn` would emit an unhandled `'error'` event, crashing the entire server.
- **After:** Both the `compile` and `upload` spawn calls have `.on('error', ...)` handlers that send an error message to the frontend, clean up the temp directory, and end the response gracefully.

### 7. Removed unused `express-sse` dependency
- **Before:** `express-sse` was listed in `package.json` but never imported — SSE was implemented manually.
- **After:** Removed from `dependencies` in `package.json`.

## arduino-ota-app/frontend/src/App.tsx

### 8. Fixed SSE chunk fragmentation
- **Before:** Each `reader.read()` chunk was split by `\n\n` and parsed independently. If an SSE event was split across two reads (e.g., `data: {"type":"st` then `atus",...}\n\n`), neither piece would parse and the status update was silently lost.
- **After:** A `buffer` string accumulates data across reads. Only complete `\n\n`-terminated events are processed; incomplete trailing data stays in the buffer for the next iteration.

### 9. Fixed fragile SSE prefix stripping
- **Before:** `line.replace('data: ', '')` — `String.replace()` searches the entire string, so a JSON payload containing the substring `"data: "` would be corrupted.
- **After:** `part.slice(6)` — always strips exactly the first 6 characters (`data: ` prefix), regardless of payload content.

### 10. Added HTTP error response handling
- **Before:** After `fetch()`, the code only checked `!response.body`. If the backend returned a 400 (e.g., invalid IP), the frontend tried to read the JSON error as an SSE stream and failed silently.
- **After:** A `!response.ok` check parses the error JSON, displays it in the log console, sets status to "Upload failed", and returns early.
