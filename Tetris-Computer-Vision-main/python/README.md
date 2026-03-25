# Python YOLO backend

Sends YOLOv8 detections from your webcam to the Node app over WebSocket. The browser draws boxes on the webcam preview when "Enable YOLO detection" is on.

## Setup

1. **Create a virtual environment** (recommended):

   ```bash
   cd python
   python -m venv venv
   ```

2. **Activate the venv**:

   - Windows: `venv\Scripts\activate`
   - macOS/Linux: `source venv/bin/activate`

3. **Install dependencies**:

   ```bash
   pip install -r requirements.txt
   ```

   This installs `inference[cli]` (Roboflow, model_id `yolov8n-640`), `opencv-python-headless`, and `websocket-client`.

4. **Start the Node app** (so the WebSocket server is listening):

   ```bash
   cd ..
   npm install
   npm start
   ```

   Leave this running (default http://localhost:3000, YOLO WebSocket on ws://127.0.0.1:3001).

5. **Run the YOLO server** (in a second terminal):

   ```bash
   cd python
   venv\Scripts\activate   # or source venv/bin/activate
   python yolo_server.py
   ```

   Options:

   - `--video 0` — webcam index (default 0)
   - `--ws ws://127.0.0.1:3001` — Node WebSocket URL
   - `--fps 5` — inference rate (default 5)
   - `--conf 0.4` — confidence threshold

6. **In the browser**: open http://localhost:3000 → Single Player → check **Enable YOLO detection**. Boxes appear when the Python server is running and sending detections.

Hand-tracking (MediaPipe) and game logic are unchanged; YOLO is optional and only draws boxes when the toggle is on.
