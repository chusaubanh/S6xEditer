"""Tìm vùng mặt người nói trong cut.mp4 -> subject.json {face:{x,y,w,h} %canvas, jitter:{...}}.

Lấy mẫu 1 khung / 2 s, dò mặt bằng OpenCV Haar cascade (cv2) hoặc mediapipe, lấy trung vị và biên dao động.
Nếu .venv-asr không có cv2 lẫn mediapipe: thoát mã 2 và KHÔNG tự cài; dùng `npm run th:subject -- <job> --face x,y,w,h`.
"""
import argparse
import json
import statistics
import sys

sys.stderr.reconfigure(encoding="utf-8")
sys.stdout.reconfigure(encoding="utf-8")
from pathlib import Path


def detect_cv2(video: str):
    import cv2  # noqa: PLC0415

    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    W, H = cap.get(cv2.CAP_PROP_FRAME_WIDTH), cap.get(cv2.CAP_PROP_FRAME_HEIGHT)
    cascade = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    boxes = []
    for f in range(0, n, int(fps * 2)):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, img = cap.read()
        if not ok:
            continue
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        faces = cascade.detectMultiScale(gray, 1.1, 5, minSize=(int(W * 0.06), int(W * 0.06)))
        if len(faces):
            x, y, w, h = max(faces, key=lambda r: r[2] * r[3])
            boxes.append((x / W * 100, y / H * 100, w / W * 100, h / H * 100))
    return boxes


def detect_mediapipe(video: str):
    import cv2  # noqa: PLC0415
    import mediapipe as mp  # noqa: PLC0415

    det = mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.5)
    cap = cv2.VideoCapture(video)
    fps = cap.get(cv2.CAP_PROP_FPS) or 30
    n = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    boxes = []
    for f in range(0, n, int(fps * 2)):
        cap.set(cv2.CAP_PROP_POS_FRAMES, f)
        ok, img = cap.read()
        if not ok:
            continue
        res = det.process(cv2.cvtColor(img, cv2.COLOR_BGR2RGB))
        if res.detections:
            b = res.detections[0].location_data.relative_bounding_box
            boxes.append((b.xmin * 100, b.ymin * 100, b.width * 100, b.height * 100))
    return boxes


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    boxes = None
    for fn in (detect_cv2, detect_mediapipe):
        try:
            boxes = fn(a.video)
            if boxes:
                break
        except ImportError:
            continue
    if boxes is None:
        print("Không có cv2/mediapipe trong .venv-asr. Nhập tay: npm run th:subject -- <job> --face x,y,w,h (% canvas)", file=sys.stderr)
        sys.exit(2)
    if not boxes:
        print("Không dò thấy mặt nào trong các khung mẫu.", file=sys.stderr)
        sys.exit(3)
    med = [round(statistics.median(c), 1) for c in zip(*boxes)]
    lo = [round(min(c), 1) for c in zip(*boxes)]
    hi = [round(max(c), 1) for c in zip(*boxes)]
    # vùng an toàn = hợp của mọi hộp mẫu (biên dao động)
    x0, y0 = lo[0], lo[1]
    x1 = max(b[0] + b[2] for b in boxes)
    y1 = max(b[1] + b[3] for b in boxes)
    data = {"face": {"x": round(x0, 1), "y": round(y0, 1), "w": round(x1 - x0, 1), "h": round(y1 - y0, 1)},
            "median": {"x": med[0], "y": med[1], "w": med[2], "h": med[3]}, "samples": len(boxes), "source": "auto"}
    Path(a.out).write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[subject] {len(boxes)} mẫu -> {a.out}")


if __name__ == "__main__":
    main()
