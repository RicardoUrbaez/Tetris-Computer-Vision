# YOLO ONNX models (optional)

Place a small YOLO ONNX model here for in-browser object detection.

- **Expected file:** `yolov8n.onnx`
- **Download:** Export from [Ultralytics YOLOv8](https://github.com/ultralytics/ultralytics) with `model.export(format="onnx", imgsz=320)` or use a pre-exported YOLOv8n 320x320 ONNX.
- The app uses input size 320x320 and runs inference at ~6 FPS. YOLO is optional; the app works without any model file.
