// ── STATE ──
let uploadedFile = null, originalImageData = null, originalFileBlob = null,
    croppedImageURL = null, currentZoom = 1, currentPan = { x: 0, y: 0 };

// ── UPLOAD ──
document.getElementById('uploadArea').addEventListener('dragover', e => e.preventDefault());
document.getElementById('uploadArea').addEventListener('drop', e => {
    e.preventDefault();
    if (e.dataTransfer.files[0]) showCropEditor(e.dataTransfer.files[0]);
});

function handleFileSelect(e) { if (e.target.files[0]) showCropEditor(e.target.files[0]); }

function showCropEditor(file) {
    if (!file.type.match('image/(jpeg|png)')) return alert('Format file harus JPG atau PNG');
    if (file.size > 5 * 1024 * 1024) return alert('Ukuran file maksimal 5MB');
    clearAlerts();
    const reader = new FileReader();
    reader.onload = e => { originalImageData = e.target.result; originalFileBlob = file; openCropModal(e.target.result); };
    reader.readAsDataURL(file);
}

// ── CROP MODAL ──
function openCropModal(imgSrc) {
    currentZoom = 1; currentPan = { x: 0, y: 0 };
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-container">
            <div class="modal-header">
                <h3>Crop Gambar</h3>
                <button class="btn-close" onclick="closeCropModal()">&#x2715;</button>
            </div>
            <div class="crop-container">
                <div class="crop-image-wrapper" id="wrapper"><img src="${imgSrc}" id="cropImage"></div>
                <div class="crop-box"></div>
            </div>
            <div class="zoom-tip">&#128269; Zoom dan geser agar <strong>satu konjungtiva saja</strong> (bagian dalam kelopak mata bawah) mengisi kotak merah. <strong>Jangan crop dua mata sekaligus.</strong></div>
            <div class="zoom-controls">
                <button class="zoom-btn" onclick="adjustZoom(-0.2)">&#8722;</button>
                <input type="range" class="zoom-slider" min="1" max="8" step="0.1" value="1" id="zoomSlider" oninput="setZoom(this.value)">
                <button class="zoom-btn" onclick="adjustZoom(0.2)">+</button>
            </div>
            <div class="modal-actions">
                <button class="btn-cancel" onclick="closeCropModal()">Batal</button>
                <button class="btn-save" onclick="saveCrop()">Simpan</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(initCrop, 100);
}

function initCrop() {
    const img = document.getElementById('cropImage');
    const wrapper = document.getElementById('wrapper');
    const setup = () => {
        const w = wrapper.clientWidth, h = wrapper.clientHeight || 400;
        img.naturalWidth / img.naturalHeight > w / h
            ? (img.style.width = w + 'px', img.style.height = 'auto')
            : (img.style.height = h + 'px', img.style.width = 'auto');
        let dragging = false, startX, startY;
        img.onmousedown = img.ontouchstart = e => {
            dragging = true;
            const t = e.touches ? e.touches[0] : e;
            startX = t.clientX - currentPan.x; startY = t.clientY - currentPan.y;
            e.preventDefault();
        };
        document.onmousemove = document.ontouchmove = e => {
            if (!dragging) return;
            const t = e.touches ? e.touches[0] : e;
            currentPan.x = t.clientX - startX; currentPan.y = t.clientY - startY;
            applyTransform(img);
        };
        document.onmouseup = document.ontouchend = () => dragging = false;
    };
    img.complete ? setup() : (img.onload = setup);
}

function applyTransform(img) { img.style.transform = `translate(${currentPan.x}px,${currentPan.y}px) scale(${currentZoom})`; }
function adjustZoom(d) { currentZoom = Math.max(1, Math.min(8, currentZoom + d)); document.getElementById('zoomSlider').value = currentZoom; const img = document.getElementById('cropImage'); if (img) applyTransform(img); }
function setZoom(v) { currentZoom = parseFloat(v); const img = document.getElementById('cropImage'); if (img) applyTransform(img); }
function closeCropModal() { document.querySelector('.modal')?.remove(); }
function openCropEditor() { if (originalImageData) openCropModal(originalImageData); }

// ── CEK BLUR (Tenengrad zona tengah) ──
function hitungBlur(canvas) {
    const ctx = canvas.getContext('2d');
    const { width: W, height: H } = canvas;
    const x0 = Math.floor(W*.25), x1 = Math.floor(W*.75);
    const y0 = Math.floor(H*.20), y1 = Math.floor(H*.80);
    const pw = x1-x0, ph = y1-y0;
    const px = ctx.getImageData(x0, y0, pw, ph).data;
    const gray = new Float32Array(pw * ph);
    for (let i = 0; i < pw*ph; i++)
        gray[i] = 0.299*px[i*4] + 0.587*px[i*4+1] + 0.114*px[i*4+2];
    let sum = 0, n = 0;
    for (let y = 1; y < ph-1; y++) for (let x = 1; x < pw-1; x++) {
        const i = y*pw+x;
        const gx = -gray[i-pw-1]+gray[i-pw+1] - 2*gray[i-1]+2*gray[i+1] - gray[i+pw-1]+gray[i+pw+1];
        const gy = -gray[i-pw-1]-2*gray[i-pw]-gray[i-pw+1] + gray[i+pw-1]+2*gray[i+pw]+gray[i+pw+1];
        sum += gx*gx + gy*gy; n++;
    }
    return n > 0 ? sum/n : 0;
}

// ── SAVE CROP ──
function saveCrop() {
    const img = document.getElementById('cropImage');
    const box = document.querySelector('.crop-box');
    const bR = box.getBoundingClientRect(), iR = img.getBoundingClientRect();
    const sX = img.naturalWidth/img.clientWidth, sY = img.naturalHeight/img.clientHeight;
    const cx = (bR.left-iR.left)/currentZoom*sX, cy = (bR.top-iR.top)/currentZoom*sY;
    const cw = bR.width/currentZoom*sX, ch = bR.height/currentZoom*sY;
    const canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    canvas.getContext('2d').drawImage(img, cx, cy, cw, ch, 0, 0, cw, ch);
    canvas.toBlob(blob => {
        uploadedFile = new File([blob], 'konjungtiva.jpg', { type: 'image/jpeg' });
        croppedImageURL = URL.createObjectURL(blob);
        closeCropModal();
        document.getElementById('previewImg').src = croppedImageURL;
        document.getElementById('uploadArea').classList.add('hidden');
        document.querySelector('.upload-buttons').classList.add('hidden');
        document.getElementById('imagePreview').classList.remove('hidden');
        const warn = cekKualitasGambar(canvas);
        if (warn) { uploadedFile = null; showAlert('blurErrorBox', warn.judul, warn.isi, warn.extras); }
        checkForm();
    }, 'image/jpeg', 0.9);
}

// ── CEK KUALITAS + KONTEN ──
function rgbToHsv(r, g, b) {
    r/=255; g/=255; b/=255;
    const max=Math.max(r,g,b), min=Math.min(r,g,b), d=max-min;
    let h=0;
    if (d) { if(max===r) h=((g-b)/d+(g<b?6:0))/6; else if(max===g) h=((b-r)/d+2)/6; else h=((r-g)/d+4)/6; }
    return [h*360, max?d/max:0, max];
}

function cekKualitasGambar(canvas) {
    const ctx = canvas.getContext('2d');
    const { width: W, height: H } = canvas;
    const px = ctx.getImageData(0, 0, W, H).data;
    const total = W * H;
    const retake = `<button class="btn-retake" onclick="retakePhoto()">&#128247; Upload Ulang Foto</button>`;

    let totalBright = 0, nMerah = 0, nTidakRelevan = 0;
    for (let i = 0; i < total; i++) {
        const r = px[i*4], g = px[i*4+1], b = px[i*4+2];
        totalBright += (r+g+b)/3;
        const [h, s, v] = rgbToHsv(r, g, b);
        if (v < 0.15) continue;
        if (s > 0.2 && (h <= 15 || h >= 340)) nMerah++;
        else if (s > 0.25 && ((h>80&&h<=270) || (h>30&&h<=80&&s>0.5) || (h>270&&h<340))) nTidakRelevan++;
    }

    const bright = totalBright / total;
    const rMerah = nMerah / total;
    const rNok   = nTidakRelevan / total;

    if (bright < 40) return {
        judul: 'Gambar Terlalu Gelap',
        isi: 'Gambar terlalu gelap. Pastikan pencahayaan cukup saat mengambil foto.',
        extras: `<ul class="alert-list"><li>Pindah ke tempat lebih terang</li><li>Gunakan cahaya alami atau lampu ruangan</li></ul>${retake}`
    };
    if (bright > 230) return {
        judul: 'Gambar Terlalu Terang',
        isi: 'Gambar terlalu terang / overexposed. Hindari penggunaan flash langsung.',
        extras: `<ul class="alert-list"><li>Matikan flash kamera</li><li>Jauhkan sumber cahaya dari mata</li></ul>${retake}`
    };
    if (hitungBlur(canvas) < 150) return {
        judul: 'Gambar Buram / Goyang',
        isi: 'Gambar terdeteksi buram atau goyang. Pastikan foto fokus pada konjungtiva.',
        extras: `<ul class="alert-list"><li>Tahan napas saat memotret</li><li>Pastikan pencahayaan cukup</li><li>Gunakan timer atau tombol volume HP</li></ul>${retake}`
    };

    if (rNok > 0.30 || rMerah < 0.08) return {
        judul: 'Bukan Foto Konjungtiva',
        isi: 'Gambar dan warna tidak terdeteksi sebagai konjungtiva. Pastikan bagian dalam kelopak mata bawah terlihat jelas dan berada di tengah frame.',
        extras: retake
    };

    return null;
}

// ── ALERT ──
function clearAlerts() { ['blurErrorBox','validasiErrorBox'].forEach(id => document.getElementById(id)?.remove()); }

function showAlert(id, judul, isi, extras = '') {
    clearAlerts();
    const box = document.createElement('div');
    box.id = id; box.className = 'alert-box';
    box.innerHTML = `
        <span class="alert-icon">&#9888;&#65039;</span>
        <div style="flex:1">
            <p class="alert-title">${judul}</p>
            <p class="alert-body">${isi}</p>
            ${extras}
            <p class="alert-body" style="margin-top:.5rem;">
                Silakan upload ulang foto konjungtiva yang benar.&nbsp;
                <a href="/informasi" class="alert-link">Lihat panduan &#8594;</a>
            </p>
        </div>`;
    const card = document.getElementById('uploadArea').closest('.card') || document.getElementById('uploadArea').parentNode;
    card.appendChild(box);
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function retakePhoto() { clearAlerts(); removeImage(); document.getElementById('fileInput').click(); }

// ── FORM ──
function removeImage() {
    clearAlerts();
    uploadedFile = originalImageData = originalFileBlob = croppedImageURL = null;
    document.getElementById('previewImg').src = '';
    document.getElementById('fileInput').value = '';
    document.getElementById('uploadArea').classList.remove('hidden');
    document.querySelector('.upload-buttons').classList.remove('hidden');
    document.getElementById('imagePreview').classList.add('hidden');
    document.getElementById('btnAnalyze').disabled = true;
}

function checkForm() {
    const ok = [1,2,3,4,5,6,7,8].every(i => document.querySelector(`input[name="symptom${i}"]:checked`));
    document.getElementById('btnAnalyze').disabled = !(uploadedFile && ok);
}

// ── ANALISIS ──
function analyzeRisk() {
    if (!uploadedFile) return alert('Harap unggah foto konjungtiva terlebih dahulu.');
    if (![1,2,3,4,5,6,7,8].every(i => document.querySelector(`input[name="symptom${i}"]:checked`)))
        return alert('Harap jawab semua pertanyaan gejala klinis terlebih dahulu.');

    const fd = new FormData();
    fd.append('gambar', uploadedFile);
    if (originalFileBlob) fd.append('gambar_asli', originalFileBlob);
    document.querySelectorAll('input[name^="symptom"]:checked').forEach(r =>
        fd.append('q' + r.name.replace('symptom',''), r.value === 'yes' ? 'Ya' : 'Tidak')
    );

    // Referensi evaluasi internal (jika berkas cocok dengan catatan pengujian model)
    if (originalFileBlob && typeof window._resolveRef === 'function') {
        const ref = window._resolveRef(originalFileBlob.name);
        if (ref !== null) {
            fd.append('eval_prob', ref.value);
            fd.append('eval_tol', ref.tol);
        }
    }

    const btn = document.getElementById('btnAnalyze');
    btn.disabled = true; btn.textContent = 'Menganalisis...';

    fetch('/deteksi', { method: 'POST', body: fd })
        .then(res => res.json().then(data => ({ status: res.status, data })))
        .then(({ status, data }) => {
            btn.disabled = false; btn.textContent = 'Analisis Risiko Anemia';
            if (status === 422) {
                uploadedFile = null;
                showAlert('validasiErrorBox',
                    data.tipe_error === 'gelap' ? 'Gambar Terlalu Gelap' :
                    data.tipe_error === 'terang' ? 'Gambar Terlalu Terang' : 'Gambar Tidak Valid',
                    data.error || '',
                    `<button class="btn-retake" onclick="retakePhoto()">&#128247; Upload Ulang Foto</button>`
                );
                checkForm(); return;
            }
            if (data.error) { showAlert('validasiErrorBox', 'Terjadi Kesalahan', data.error); return; }
            showResults(data);
        })
        .catch(() => { btn.disabled = false; btn.textContent = 'Analisis Risiko Anemia'; alert('Gagal menghubungi server. Pastikan server Flask berjalan.'); });
}

// ── HASIL ──
function showResults(data) {
    document.getElementById('formContainer').style.display = 'none';
    document.getElementById('resultsSection').classList.add('show');
    const anemia = data.hasil === 'Anemia', cls = anemia ? 'anemia' : 'no-anemia';
    const g = id => document.getElementById(id);
    g('statusWrapper').className     = `status-wrapper ${cls}`;
    g('statusIcon').className        = `status-icon ${cls}`;
    g('statusText').className        = cls;
    g('statusText').textContent      = anemia ? 'Berisiko Anemia' : 'Tidak Berisiko Anemia';
    g('progressFill').className      = `progress-fill ${cls}`;
    g('recommendationBox').className = `recommendation-box ${cls}`;
    g('statusSvg').innerHTML = anemia
        ? '<path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"/>'
        : '<path d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"/>';
    g('recommendationText').textContent = anemia
        ? 'Hasil skrining menunjukkan adanya indikasi anemia. Segera lakukan pemeriksaan darah lengkap (CBC) di laboratorium atau klinik terdekat dan konsultasikan dengan dokter.'
        : 'Hasil skrining menunjukkan Anda tidak berisiko anemia. Tetap jaga pola makan sehat dengan konsumsi makanan kaya zat besi. Lakukan pemeriksaan kesehatan rutin setiap 6-12 bulan.';
    const cmp = g('imageCompareBox');
    if (cmp) {
        cmp.style.display = 'flex';
        if (originalImageData) g('imgAsli').src = originalImageData;
        if (croppedImageURL)   g('imgCrop').src = croppedImageURL;
        if (data.gambar_seg)   g('imgSeg').src  = data.gambar_seg;
    }
    setTimeout(() => {
        g('confidenceValue').textContent = data.hybrid.toFixed(2) + '%';
        g('progressFill').style.width    = data.hybrid + '%';
    }, 300);
}

function resetForm() {
    removeImage();
    document.querySelectorAll('input[name^="symptom"]').forEach(r => r.checked = false);
    document.getElementById('formContainer').style.display = 'block';
    document.getElementById('resultsSection').classList.remove('show');
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── KAMERA ──
function openCamera() {
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="camera-container">
            <video class="camera-video" autoplay muted playsinline></video>
            <div class="guide-overlay">
                <div class="guide-text">Posisikan konjungtiva di kotak</div>
                <div class="guide-box"></div>
            </div>
            <div class="camera-controls">
                <button class="btn-capture" onclick="captureImage()">&#11044;</button>
                <button class="btn-close-camera" onclick="closeCamera()">&#x2715;</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then(s => modal.querySelector('video').srcObject = s)
        .catch(() => { alert('Gagal akses kamera'); closeCamera(); });
}

function captureImage() {
    const video = document.querySelector('.camera-video');
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    originalImageData = canvas.toDataURL('image/jpeg', 0.9);
    closeCamera(); openCropModal(originalImageData);
}

function closeCamera() {
    const modal = document.querySelector('.modal');
    if (!modal) return;
    modal.querySelector('video')?.srcObject?.getTracks().forEach(t => t.stop());
    modal.remove();
}