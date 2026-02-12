# Python CV Backend Setup

## Fixed MediaPipe 0.10+ Compatibility

The script has been updated to use MediaPipe 0.10+ **Tasks API** instead of the old `solutions` API.

## Installation

```bash
pip install -r requirements.txt
```

## Usage

1. **Start Node.js server first:**
   ```bash
   npm start
   ```

2. **Run Python CV backend:**
   ```bash
   python cv/gesture_controller.py
   ```

   Or on Windows:
   ```bash
   py cv\gesture_controller.py
   ```

## What Changed

- **Old API (0.9.x)**: `mp.solutions.hands`
- **New API (0.10+)**: `mp.tasks.python.vision.HandLandmarker`

The script now:
- Uses `HandLandmarker` from Tasks API
- Creates `BaseOptions` and `HandLandmarkerOptions`
- Uses `mp.Image` for frame processing
- Accesses results via `detection_result.hand_landmarks`

## Troubleshooting

If you see `AttributeError: module 'mediapipe' has no attribute 'solutions'`:
- ✅ **FIXED** - Script now uses Tasks API

If camera doesn't open:
- Check camera permissions
- Try disconnecting other apps using camera
- Script tries indexes 0, 1, 2 automatically

If Socket.IO connection fails:
- Make sure `npm start` is running on port 3000
- Check firewall settings

## Gestures

- **Swipe LEFT**: Move index finger left quickly
- **Swipe RIGHT**: Move index finger right quickly  
- **Fist + Tilt**: Make fist, tilt wrist clockwise to rotate

Press `q` in OpenCV window to quit.
