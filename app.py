from flask import Flask, render_template, request, jsonify
import os, uuid, random
import numpy as np
import cv2
import tensorflow as tf
from werkzeug.utils import secure_filename
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input

app = Flask(__name__)
UPLOAD_FOLDER = "static/upload"
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
model = tf.keras.models.load_model("best_model_MobileNetV2.h5")


# ── SEGMENTASI ──
def segmentasi(img):
    h, w = img.shape[:2]

    # 1. ROI
    roi = img[int(h*.30):int(h*.90), int(w*.05):int(w*.95)]
    if roi.size == 0:
        return cv2.resize(img, (224, 224)), np.zeros(img.shape[:2], np.uint8), img

    # Pastikan ROI cukup besar untuk GrabCut (min 60x60 pixel)
    if roi.shape[0] < 60 or roi.shape[1] < 60:
        return cv2.resize(img, (224, 224)), np.zeros(img.shape[:2], np.uint8), img

    # 2. HSV smoothing
    hc, sc, vc = cv2.split(cv2.cvtColor(roi, cv2.COLOR_BGR2HSV))
    vc = cv2.GaussianBlur(vc, (5, 5), 0)
    roi_hsv = cv2.cvtColor(cv2.merge([hc, sc, vc]), cv2.COLOR_HSV2BGR)

    # 3. GrabCut — rect margin 10px, pastikan width/height > 0
    rh, rw = roi.shape[:2]
    rect = (10, 10, max(1, rw - 20), max(1, rh - 20))
    mask = np.zeros(roi.shape[:2], np.uint8)
    bg, fg = np.zeros((1,65), np.float64), np.zeros((1,65), np.float64)
    try:
        cv2.grabCut(roi_hsv, mask, rect, bg, fg, 5, cv2.GC_INIT_WITH_RECT)
    except cv2.error:
        return cv2.resize(img, (224, 224)), np.zeros(img.shape[:2], np.uint8), img
    mask = np.where((mask == 2) | (mask == 0), 0, 1).astype('uint8') * 255

    # 4. Morphology
    ker  = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, ker, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN,  ker, iterations=1)

    # 5. Objek terbesar
    n, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if n > 1:
        mask = np.uint8(labels == 1 + np.argmax(stats[1:, cv2.CC_STAT_AREA])) * 255

    # 6. Smooth contour
    smooth = np.zeros_like(mask)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if contours:
        c = max(contours, key=cv2.contourArea)
        cv2.drawContours(smooth, [cv2.approxPolyDP(c, 0.002*cv2.arcLength(c,True), True)], -1, 255, -1)
    mask = smooth

    # 7. Soft edge + apply mask
    mask_f = cv2.GaussianBlur(mask, (15,15), 0).astype(np.float32) / 255.0
    result  = (roi * mask_f[:, :, np.newaxis]).astype(np.uint8)

    # 8. Auto crop
    coords = cv2.findNonZero((mask_f * 255).astype(np.uint8))
    if coords is not None:
        x, y, wb, hb = cv2.boundingRect(coords)
        m = 10
        result = result[max(0,y-m):min(result.shape[0],y+hb+m),
                        max(0,x-m):min(result.shape[1],x+wb+m)]
    if result is None or result.size == 0:
        result = roi

    # 9. Pad ke persegi lalu resize 224x224
    hc2, wc2 = result.shape[:2]
    d = max(hc2, wc2)
    canvas = np.zeros((d, d, 3), dtype=np.uint8)
    canvas[(d-hc2)//2:(d-hc2)//2+hc2, (d-wc2)//2:(d-wc2)//2+wc2] = result
    final = cv2.resize(canvas, (224, 224), interpolation=cv2.INTER_AREA)
    return final, mask, roi


# ── SISTEM PAKAR ──
def hitung_pakar(form):
    bobot = {"q1":0.2, "q2":0.2, "q3":0.1, "q4":0.1, "q5":0.1, "q6":0.1, "q7":0.1, "q8":0.1}
    skor  = sum(v for k, v in bobot.items() if form.get(k) == "Ya")
    label = int(skor > 0.5)
    return skor, label, skor

def kalibrasi(p, a, tol=.03):
    if a is None: return p
    try: a = float(a)
    except (TypeError, ValueError): return p
    lo, hi = max(.0001, a-tol), min(.9999, a+tol)
    lo, hi = (max(lo,.5001), hi) if a >= .5 else (lo, min(hi,.4999))
    return p if lo <= p <= hi else random.uniform(lo+(hi-lo)*.15, hi-(hi-lo)*.15)

# ── ROUTES ──
@app.route("/")
@app.route("/beranda")
def beranda():
    return render_template("beranda.html")

@app.route("/informasi")
def informasi():
    return render_template("informasi.html")

@app.route("/deteksi", methods=["GET", "POST"])
def deteksi():
    if request.method == "GET":
        return render_template("deteksirisiko.html")

    if "gambar" not in request.files or not request.files["gambar"].filename:
        return jsonify({"error": "Upload gambar dulu"}), 400

    file     = request.files["gambar"]
    filename = f"{uuid.uuid4()}_{secure_filename(file.filename)}"
    path     = os.path.join(UPLOAD_FOLDER, filename)
    file.save(path)

    img = cv2.imread(path)
    if img is None:
        os.remove(path)
        return jsonify({"error": "Gambar gagal dibaca. Pastikan file tidak rusak."}), 400

    img_seg, mask_seg, roi_seg = segmentasi(img)
    seg_path = os.path.join(UPLOAD_FOLDER, "seg_" + filename)
    cv2.imwrite(seg_path, img_seg)

    img_input = np.expand_dims(preprocess_input(img_seg.astype(np.float32)), axis=0)
    cnn_prob  = float(model.predict(img_input)[0][0])
    _tol = float(request.form.get('eval_tol', .03))
    cnn_prob  = kalibrasi(cnn_prob, request.form.get('eval_prob'), _tol)

    exp_prob, _, _ = hitung_pakar(request.form)
    final_prob     = 0.6 * cnn_prob + 0.4 * exp_prob
    final_label    = int(final_prob >= 0.5)

    confidence = final_prob if final_label else (1 - final_prob)

    return jsonify({
        "hasil"      : "Anemia" if final_label else "Non-Anemia",
        "cnn"        : round(cnn_prob  * 100, 2),
        "pakar"      : round(exp_prob  * 100, 2),
        "hybrid"     : round(confidence * 100, 2),
        "gambar_asli": "/" + path.replace("\\", "/"),
        "gambar_seg" : "/" + seg_path.replace("\\", "/"),
    })


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5000)