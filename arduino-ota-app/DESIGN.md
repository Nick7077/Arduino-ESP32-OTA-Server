# Arduino Nano ESP32 OTA Upload App - Design Document

## Goal
To provide a web-based interface for wirelessly uploading code (OTA) to an Arduino Nano ESP32.

## Architecture

### 1. Frontend (React + Vite + TypeScript)
- **Code Editor:** A syntax-highlighted editor (e.g., Monaco Editor or simple textarea) for writing Arduino sketches.
- **Connection Panel:** Input fields for the target board's IP address and (optional) OTA password.
- **Upload Button:** Triggers the compilation and upload process.
- **Status Monitor:** A console-like display for real-time feedback from the `arduino-cli` (compilation logs, upload progress).
- **Styling:** Vanilla CSS for a modern, responsive, and "alive" feel.

### 2. Backend (Node.js + Express)
- **API Endpoint:** `/api/upload` (POST)
    - Receives code, IP address, SSID, WiFi Password, and OTA password.
    - **OTA Injection:** Automatically wraps the user's code with a mandatory OTA template.
    - Saves code to a temporary `.ino` file and `user_code.h`.
    - Spawns `arduino-cli` processes for compilation and upload.
    - Streams output back to the frontend using Server-Sent Events (SSE).
- **Tooling:**
    - Uses `arduino-cli` for the heavy lifting.
    - Requires `arduino:esp32` core installed.

### 3. Workflow
1. **User Input:** User writes code and enters the board's connection details (IP, SSID, Passwords).
2. **Injection:**
    - The backend renames the user's `setup()` and `loop()` functions using preprocessor macros (`#define setup user_setup`).
    - It wraps them in a main `sketch.ino` that calls `_setupOTA()` and `ArduinoOTA.handle()` before the user's logic.
    - This ensures that every uploaded sketch is automatically OTA-enabled.
3. **Compilation:**
    - `arduino-cli compile --fqbn arduino:esp32:nano_nora /tmp/sketch/`
4. **Upload:**
    - Uses `espota.py` (or `arduino-cli upload`) to flash the binary wirelessly.
5. **Feedback:** The backend captures stdout/stderr and sends it to the frontend via SSE.

## Prerequisites & Dependencies
- `node` & `npm`
- `arduino-cli`
- `arduino:esp32` core
- Python (for `espota.py`, usually bundled with the core)
- Arduino Nano ESP32 must have an initial OTA-enabled sketch (e.g., `BasicOTA`) uploaded via USB.

## Visual Design Ideas
- Dark mode by default.
- Glowing "Upload" button when code is ready.
- Animated progress bars for compilation and uploading.
- Minimalist sidebar for saved sketches.
