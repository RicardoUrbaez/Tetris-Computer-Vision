/**
 * Optional YOLOv8 object detection in the browser (ONNX Runtime Web).
 * Loads /public/models/yolov8n.onnx, runs at ~5 FPS on webcam frames,
 * draws bounding boxes + labels on a canvas overlay. Off by default; does not break app if model is missing.
 */
(function() {
  "use strict";

  var MODEL_URL = "/models/yolov8n.onnx";
  var INPUT_SIZE = 320;
  var INFERENCE_FPS = 5;
  var CONFIDENCE_THRESHOLD = 0.4;
  var IOU_THRESHOLD = 0.45;

  var session = null;
  var video = null;
  var overlayCanvas = null;
  var enabled = false;
  var running = false;
  var lastInferenceTime = 0;
  var intervalId = null;

  var COCO_CLASSES = [
    "person","bicycle","car","motorcycle","airplane","bus","train","truck","boat",
    "traffic light","fire hydrant","stop sign","parking meter","bench","bird","cat","dog","horse",
    "sheep","cow","elephant","bear","zebra","giraffe","backpack","umbrella","handbag","tie",
    "suitcase","frisbee","skis","snowboard","sports ball","kite","baseball bat","baseball glove",
    "skateboard","surfboard","tennis racket","bottle","wine glass","cup","fork","knife","spoon",
    "bowl","banana","apple","sandwich","orange","broccoli","carrot","hot dog","pizza",
    "donut","cake","chair","couch","potted plant","bed","dining table","toilet","tv",
    "laptop","mouse","remote","keyboard","cell phone","microwave","oven","toaster","sink",
    "refrigerator","book","clock","vase","scissors","teddy bear","hair drier","toothbrush"
  ];

  function getOrt() {
    return typeof ort !== "undefined" ? ort : null;
  }

  // --- Preprocess: video frame -> CHW float32 tensor ---
  function preprocess(videoEl, width, height) {
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(videoEl, 0, 0, width, height);
    var imageData = ctx.getImageData(0, 0, width, height);
    var data = imageData.data;
    var numPixels = width * height;
    var r = new Float32Array(numPixels);
    var g = new Float32Array(numPixels);
    var b = new Float32Array(numPixels);
    for (var i = 0; i < numPixels; i++) {
      var j = i * 4;
      r[i] = data[j] / 255;
      g[i] = data[j + 1] / 255;
      b[i] = data[j + 2] / 255;
    }
    return new Float32Array([].concat(Array.from(r), Array.from(g), Array.from(b)));
  }

  function toInputTensor(floatData, height, width) {
    var ort = getOrt();
    if (!ort) return null;
    return new ort.Tensor("float32", floatData, [1, 3, height, width]);
  }

  // --- Model load ---
  function loadModel() {
    var ort = getOrt();
    if (!ort) {
      console.warn("[YOLO] ONNX Runtime not loaded.");
      return Promise.resolve(false);
    }
    if (session) return Promise.resolve(true);
    return ort.InferenceSession.create(MODEL_URL, {
      executionProviders: ["webgl"],
      graphOptimizationLevel: "all"
    }).then(function(s) {
      session = s;
      console.log("[YOLO] Model loaded.");
      return true;
    }).catch(function(err) {
      console.warn("[YOLO] Model load failed:", err);
      return false;
    });
  }

  // --- Inference ---
  function runInference() {
    if (!enabled || !video || !overlayCanvas || !session || video.readyState < 2) return;
    var now = Date.now();
    if (now - lastInferenceTime < 1000 / INFERENCE_FPS) return;
    lastInferenceTime = now;

    var w = video.videoWidth;
    var h = video.videoHeight;
    if (!w || !h) return;

    var inputData = preprocess(video, INPUT_SIZE, INPUT_SIZE);
    var tensor = toInputTensor(inputData, INPUT_SIZE, INPUT_SIZE);
    if (!tensor) return;

    var inputName = session.inputNames && session.inputNames[0] ? session.inputNames[0] : "images";
    var runInput = {};
    runInput[inputName] = tensor;

    session.run(runInput).then(function(outputs) {
      var out = outputs.output0 || outputs.output;
      if (!out && session.outputNames && session.outputNames[0]) out = outputs[session.outputNames[0]];
      if (!out) return;

      var numClasses = out.dims[1] === 84 ? 80 : (out.dims[1] - 4);
      var dets = postprocess(out, numClasses, CONFIDENCE_THRESHOLD);
      dets = nms(dets, IOU_THRESHOLD);

      var ctx = overlayCanvas.getContext("2d");
      overlayCanvas.width = overlayCanvas.offsetWidth;
      overlayCanvas.height = overlayCanvas.offsetHeight;
      ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      var scaleX = overlayCanvas.width / INPUT_SIZE;
      var scaleY = overlayCanvas.height / INPUT_SIZE;
      drawDetections(ctx, dets, scaleX, scaleY);
    }).catch(function(err) {
      console.warn("[YOLO] inference error:", err);
    });
  }

  // --- Postprocess: raw output -> list of detections ---
  function postprocess(output, numClasses, confThresh) {
    var detections = [];
    var dims = output.dims;
    var data = output.data;
    var numBoxes = dims[2];
    var rowSize = dims[1];
    var rowMajor = dims[1] < dims[2];

    for (var i = 0; i < numBoxes; i++) {
      var cx, cy, w, h, maxScore = 0, maxIdx = 0;
      if (rowMajor) {
        var base = i * rowSize;
        cx = data[base];
        cy = data[base + 1];
        w = data[base + 2];
        h = data[base + 3];
        for (var c = 4; c < rowSize; c++) {
          var score = data[base + c];
          if (score > maxScore) { maxScore = score; maxIdx = c - 4; }
        }
      } else {
        cx = data[0 * numBoxes + i];
        cy = data[1 * numBoxes + i];
        w = data[2 * numBoxes + i];
        h = data[3 * numBoxes + i];
        for (var c = 4; c < rowSize; c++) {
          var score = data[c * numBoxes + i];
          if (score > maxScore) { maxScore = score; maxIdx = c - 4; }
        }
      }
      if (maxScore < confThresh) continue;
      detections.push({
        x: cx - w / 2,
        y: cy - h / 2,
        width: w,
        height: h,
        class: maxIdx,
        label: COCO_CLASSES[maxIdx] || "?",
        confidence: maxScore
      });
    }
    return detections;
  }

  // --- NMS ---
  function nms(detections, iouThresh) {
    detections.sort(function(a, b) { return b.confidence - a.confidence; });
    var out = [];
    for (var i = 0; i < detections.length; i++) {
      var keep = true;
      for (var j = 0; j < out.length; j++) {
        var a = detections[i];
        var b = out[j];
        if (a.class !== b.class) continue;
        var xi = Math.max(a.x, b.x);
        var yi = Math.max(a.y, b.y);
        var xi2 = Math.min(a.x + a.width, b.x + b.width);
        var yi2 = Math.min(a.y + a.height, b.y + b.height);
        var inter = Math.max(0, xi2 - xi) * Math.max(0, yi2 - yi);
        var areaA = a.width * a.height;
        var areaB = b.width * b.height;
        var iou = inter / (areaA + areaB - inter);
        if (iou >= iouThresh) { keep = false; break; }
      }
      if (keep) out.push(detections[i]);
    }
    return out;
  }

  // --- Draw boxes + labels on overlay canvas ---
  function drawDetections(ctx, detections, scaleX, scaleY) {
    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 2;
    ctx.font = "10px monospace";
    ctx.fillStyle = "#00ff00";
    detections.forEach(function(d) {
      var x = d.x * scaleX;
      var y = d.y * scaleY;
      var w = d.width * scaleX;
      var h = d.height * scaleY;
      ctx.strokeRect(x, y, w, h);
      var label = (d.label || "?") + " " + (Math.round(d.confidence * 100) / 100).toFixed(2);
      ctx.fillText(label, x, Math.max(y - 4, 10));
    });
  }

  function findOverlayForVideo(videoEl) {
    if (!videoEl || !videoEl.parentElement) return null;
    var wrap = videoEl.parentElement;
    return wrap.querySelector ? wrap.querySelector("canvas.yolo-overlay") : null;
  }

  function startLoop() {
    if (running || !enabled || !video) return;
    running = true;
    function loop() {
      if (!running) return;
      runInference();
      intervalId = setTimeout(loop, 1000 / INFERENCE_FPS);
    }
    loop();
  }

  function stopLoop() {
    running = false;
    if (intervalId) {
      clearTimeout(intervalId);
      intervalId = null;
    }
    if (overlayCanvas) {
      var ctx = overlayCanvas.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
    }
  }

  function setVideo(videoEl) {
    if (video === videoEl) return;
    stopLoop();
    video = videoEl;
    overlayCanvas = videoEl ? findOverlayForVideo(videoEl) : null;
    if (enabled && video && overlayCanvas) startLoop();
  }

  function setEnabled(value) {
    enabled = !!value;
    if (enabled && video && overlayCanvas) startLoop();
    else stopLoop();
  }

  window.YoloDetector = {
    modelUrl: MODEL_URL,
    setVideo: setVideo,
    setEnabled: setEnabled,
    loadModel: loadModel,
    get enabled() { return enabled; }
  };
})();
