#!/usr/bin/env python3
"""
YOLOv8 detection from webcam via InferencePipeline; sends bbox/class/confidence over WebSocket to Node.
Run: python yolo_server.py
Connect to Node's YOLO WebSocket (default ws://127.0.0.1:3001).
"""
import json
import argparse

try:
    from inference import InferencePipeline
except ImportError:
    raise SystemExit("Install inference: pip install 'inference[cli]'")

try:
    import websocket
except ImportError:
    raise SystemExit("Install websocket-client: pip install websocket-client")


MODEL_ID = "yolov8n-640"
VIDEO_REFERENCE = 0
WS_URL_DEFAULT = "ws://127.0.0.1:3001"

# WebSocket connection (set by run())
_ws_url = None
_ws_conn = None


def _get_ws():
    global _ws_conn
    try:
        if _ws_conn is None:
            _ws_conn = websocket.create_connection(_ws_url, timeout=5)
        return _ws_conn
    except Exception as e:
        print(f"WebSocket connect: {e}")
        _ws_conn = None
        return None


def _extract_detections(predictions):
    """Build list of { bbox, class, confidence } from pipeline predictions."""
    out = []
    preds = getattr(predictions, "predictions", None)
    if preds is None and isinstance(predictions, dict):
        preds = predictions.get("predictions", [])
    if not preds and isinstance(predictions, (list, tuple)):
        preds = predictions
    for p in preds:
        try:
            if hasattr(p, "xyxy") and p.xyxy is not None:
                arr = p.xyxy
                if hasattr(arr, "__iter__") and len(arr) >= 4:
                    bbox = [float(arr[0]), float(arr[1]), float(arr[2]), float(arr[3])]
                else:
                    continue
            elif isinstance(p, dict):
                b = p.get("bbox") or p.get("xyxy")
                if b and len(b) >= 4:
                    bbox = [float(b[0]), float(b[1]), float(b[2]), float(b[3])]
                else:
                    continue
            else:
                continue
            class_name = getattr(p, "class_name", None) or getattr(p, "class", None) or p.get("class_name") or p.get("class", "?")
            conf = float(getattr(p, "confidence", 0) or p.get("confidence", 0) or 0)
            out.append({"bbox": bbox, "class": str(class_name), "confidence": conf})
        except (TypeError, IndexError, ValueError, AttributeError):
            continue
    return out


def _on_prediction(predictions, video_frame):
    """Callback: send detections to Node over WebSocket."""
    if video_frame is None:
        return
    frame_h, frame_w = video_frame.shape[:2]
    detections = _extract_detections(predictions)
    payload = {"frame_w": frame_w, "frame_h": frame_h, "detections": detections}
    ws = _get_ws()
    if ws:
        try:
            ws.send(json.dumps(payload))
        except Exception as e:
            print(f"WebSocket send: {e}")
            global _ws_conn
            _ws_conn = None
            try:
                ws.close()
            except Exception:
                pass


def run():
    global _ws_url, _ws_conn
    parser = argparse.ArgumentParser(description="YOLO webcam server → WebSocket (InferencePipeline)")
    parser.add_argument("--video", type=int, default=VIDEO_REFERENCE, help="Webcam index (default 0)")
    parser.add_argument("--ws", type=str, default=WS_URL_DEFAULT, help="WebSocket URL to send detections")
    args = parser.parse_args()
    _ws_url = args.ws

    print(f"Model: {MODEL_ID}, webcam: {args.video}, WebSocket: {args.ws}")
    print("Press Ctrl+C to stop.")

    pipeline = InferencePipeline.init(
        model_id=MODEL_ID,
        video_reference=args.video,
        on_prediction=_on_prediction,
    )
    try:
        pipeline.start()
        pipeline.join()
    except KeyboardInterrupt:
        pass
    finally:
        if _ws_conn:
            try:
                _ws_conn.close()
            except Exception:
                pass
        print("Stopped.")


if __name__ == "__main__":
    run()
