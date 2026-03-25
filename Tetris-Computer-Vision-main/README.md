# Tetris Hands

A multiplayer Tetris game with computer vision hand controls, built with Node.js, Socket.IO, Phaser 3, and Python (OpenCV + MediaPipe).

## Features

- **Single Player Mode**: Classic Tetris with keyboard or hand gesture controls
- **Multiplayer Mode**: 2-player Tetris with garbage line attacks
- **Computer Vision Controls**: Use hand gestures (swipe left/right, fist + tilt to rotate) via Python backend
- **Keyboard Fallback**: Always works with arrow keys, even if webcam is unavailable
- **Neon Retro UI**: Classic Tetris-style menu and game interface

## Prerequisites

- **Node.js** (v14 or higher)
- **Python** (3.8 or higher)
- **Webcam** (optional, for gesture controls)

## Installation

### 1. Install Node.js Dependencies

```bash
npm install
```

This installs:
- Express (web server)
- Socket.IO (real-time multiplayer)
- Phaser 3 (game rendering)
- MediaPipe Hands (browser CV, optional)

### 2. Install Python Dependencies

```bash
cd cv
pip install -r requirements.txt
```

This installs:
- `opencv-python` (camera capture)
- `mediapipe` (hand tracking)
- `python-socketio` (Socket.IO client)
- `numpy` (numerical operations)

### 3. Download MediaPipe Model (if needed)

The Python script will automatically download the MediaPipe HandLandmarker model on first run. If you need to download it manually:

1. Download `hand_landmarker.task` from [MediaPipe Models](https://developers.google.com/mediapipe/solutions/vision/hand_landmarker)
2. Place it in the `cv/` folder

## Running the Game

### Step 1: Start the Node.js Server

```bash
npm start
```

The server will start on `http://localhost:3000`

### Step 2: Start the Python CV Controller (Optional)

In a separate terminal:

```bash
python cv/gesture_controller.py
```

The Python script will:
- Connect to the Node.js server
- Open your webcam
- Detect hand gestures
- Send commands to the game

**Note**: You can play without the Python CV controller using keyboard controls.

### Step 3: Open in Browser

Open `http://localhost:3000` in your web browser.

## Controls

### Keyboard Controls (Always Available)

- **Arrow Left**: Move piece left
- **Arrow Right**: Move piece right
- **Arrow Down**: Soft drop (move down faster)
- **Arrow Up**: Rotate piece clockwise
- **Space**: Hard drop (instant drop)
- **C**: Hold piece
- **P / ESC**: Pause game

### Hand Gesture Controls (Requires Python CV)

- **Swipe Left**: Move piece left (one column per swipe)
- **Swipe Right**: Move piece right (one column per swipe)
- **Fist + Tilt Clockwise**: Rotate piece clockwise

## Game Modes

### Single Player

1. Click **NEW GAME** from the main menu
2. Play using keyboard or hand gestures
3. Press **P** to pause
4. Press **ESC** or click **EXIT TO MENU** to return to menu

### Multiplayer (2 Players Max)

1. Click **MULTIPLAYER** from the main menu
2. **Host**: Click **HOST GAME** to create a room (you'll get a 4-digit room code)
3. **Joiner**: Enter the room code and click **JOIN**
4. When 2 players are in the room, the host can click **START GAME**
5. Each player controls their own board
6. Clearing 2+ lines sends garbage lines to your opponent
7. Last player standing wins!

**Note**: Multiplayer works on the same Wi-Fi network. Share the room code with your opponent.

## Troubleshooting

### Buttons Don't Work / Menu Not Clickable

- Check browser console (F12) for errors
- Ensure no browser extensions are blocking JavaScript
- Try refreshing the page
- Check that `public/main.js` loaded correctly

### Python CV Not Working

- Make sure Node.js server is running first (`npm start`)
- Check that Python dependencies are installed (`pip install -r cv/requirements.txt`)
- Verify webcam is not being used by another application
- Check Python console for error messages
- Try restarting the Python script

### Webcam Permission Denied

- The game will still work with keyboard controls
- Check browser settings to allow camera access
- Try refreshing the page and allowing camera when prompted

### Multiplayer Connection Issues

- Ensure both players are on the same Wi-Fi network
- Check that port 3000 is not blocked by firewall
- Verify the room code is correct (4 digits)
- Try creating a new room if connection fails

## Project Structure

```
finger-gun-arena/
├── server.js              # Node.js/Express server + Socket.IO
├── package.json           # Node.js dependencies
├── public/
│   ├── index.html        # Main HTML page
│   ├── main.js           # Client-side game logic
│   └── styles.css        # UI styling
├── cv/
│   ├── gesture_controller.py  # Python CV backend
│   ├── requirements.txt      # Python dependencies
│   └── hand_landmarker.task  # MediaPipe model (auto-downloaded)
└── README.md             # This file
```

## Development

### Adding New Features

- **Game Logic**: Edit `public/main.js` (TetrisEngine class)
- **Server Logic**: Edit `server.js` (Socket.IO events)
- **CV Gestures**: Edit `cv/gesture_controller.py` (gesture detection)
- **UI**: Edit `public/index.html` and `public/styles.css`

### Testing

1. Test single player mode first
2. Test keyboard controls
3. Test Python CV (if available)
4. Test multiplayer with 2 browsers/tabs

## License

Free and open-source. Use as you like!

## Credits

- Built with Phaser 3, Socket.IO, MediaPipe, and OpenCV
- Tetris mechanics based on classic Tetris rules
- Gesture detection using MediaPipe Hands
