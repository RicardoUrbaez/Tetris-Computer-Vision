# Tetris Hands - Python CV Backend

This Python script provides robust computer vision gesture detection for Tetris Hands using OpenCV and MediaPipe Hands.

## Installation

1. Install Python dependencies:
```bash
pip install -r requirements.txt
```

Or manually:
```bash
pip install opencv-python mediapipe python-socketio numpy
```

## Usage

1. Make sure the Node.js server is running on `http://localhost:3000`
2. Run the Python CV backend:
```bash
python cv/gesture_controller.py
```

Or on Windows:
```bash
py cv\gesture_controller.py
```

3. The script will:
   - Connect to the Node.js server via Socket.IO
   - Open your webcam (tries indexes 0, 1, 2)
   - Show a debug window with detected gestures
   - Send gesture actions to the server

## Gestures

- **Swipe LEFT**: Move index finger left quickly → moves piece left
- **Swipe RIGHT**: Move index finger right quickly → moves piece right  
- **Fist + Tilt**: Make a fist and tilt wrist clockwise → rotates piece

## Controls

- Press `q` in the OpenCV window to quit
- The script automatically handles camera fallback if index 0 fails

## Troubleshooting

- **Camera not opening**: Try disconnecting other apps using the camera
- **Connection failed**: Make sure `npm start` is running on port 3000
- **No gestures detected**: Ensure good lighting and hand is visible in frame
