import os
import io
import re
import time
import datetime
import urllib.parse
import requests
from flask import Flask, request, jsonify, send_from_directory, Response
from PIL import Image, ImageStat

app = Flask(__name__, static_folder='static')

# CPTEC Base URL
CPTEC_FORM_URL = 'https://satelite.cptec.inpe.br/acervowebv2/goes16.formulario.logic'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': CPTEC_FORM_URL
}

# Cache Directory Setup
CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache_images')
os.makedirs(CACHE_DIR, exist_ok=True)

def cleanup_cache(max_days=30):
    """
    Deletes cached image files older than max_days (default 30 days).
    Returns (deleted_count, freed_bytes).
    """
    now = time.time()
    cutoff_sec = max_days * 86400
    deleted_count = 0
    freed_bytes = 0

    try:
        for fname in os.listdir(CACHE_DIR):
            fpath = os.path.join(CACHE_DIR, fname)
            if os.path.isfile(fpath):
                file_age = now - os.path.getmtime(fpath)
                if file_age > cutoff_sec:
                    fsize = os.path.getsize(fpath)
                    os.remove(fpath)
                    deleted_count += 1
                    freed_bytes += fsize
    except Exception as err:
        print("Error during cache cleanup:", err)

    return deleted_count, freed_bytes

# Run automatic 30-day cache cleanup on server start
cleanup_cache(30)

def inspect_image_bytes(image_bytes):
    """
    Server-Side Quality Assurance Protocol:
    Detects:
    1. Header-only strip images (height < 350px or aspect ratio w/h > 2.2)
    2. Pitch-black or blank images (avg brightness < 6.0 or max pixel < 25)
    3. Cut-off / truncated bottom images (bottom 20% is solid black while top has content)
    Returns (is_valid: bool, reason: str).
    """
    try:
        if len(image_bytes) < 40000:
            return False, f"Tamanho insuficiente ({len(image_bytes)} bytes < 40KB)"

        img = Image.open(io.BytesIO(image_bytes))
        img.verify()

        img = Image.open(io.BytesIO(image_bytes))
        w, h = img.size

        # Rule 1: Header-Only / Strip Image Check
        aspect_ratio = w / float(h) if h > 0 else 99
        if h < 350 or aspect_ratio > 2.2:
            return False, f"Imagem incompleta (apenas cabeçalho/barra legenda: {w}x{h}, proporção {aspect_ratio:.2f})"

        # Convert to Grayscale L mode for pixel brightness analysis
        gray = img.convert('L')
        stat = ImageStat.Stat(gray)
        avg_brightness = stat.mean[0]
        max_brightness = stat.extrema[0][1]

        # Rule 2: Pitch Black / Dark Image
        if avg_brightness < 6.0 or max_brightness < 25:
            return False, f"Imagem totalmente preta/escura (brilho médio: {avg_brightness:.1f}, máx: {max_brightness})"

        # Rule 3: Cut-off / Truncated Bottom Image
        bottom_crop = gray.crop((0, int(h * 0.80), w, h))
        bottom_stat = ImageStat.Stat(bottom_crop)
        bottom_avg = bottom_stat.mean[0]
        bottom_max = bottom_stat.extrema[0][1]

        if avg_brightness > 18.0 and bottom_avg < 2.0 and bottom_max < 15:
            return False, f"Imagem cortada no rodapé (média rodapé: {bottom_avg:.1f})"

        return True, "OK"

    except Exception as err:
        return False, f"Imagem corrompida: {str(err)}"

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('static', path)

@app.route('/api/fetch-images', methods=['GET', 'POST'])
def fetch_images():
    """
    Fetches image metadata from CPTEC for chosen satellite, channel, and date range.
    """
    data = request.get_json(silent=True) or {}
    satellite = request.args.get('satellite') or data.get('satellite') or 'goes19'
    sector = 'ams' # Force comprehensive sector
    channel = request.args.get('channel') or data.get('channel') or 'ch13_baixa'
    
    start_date_str = request.args.get('startDate') or data.get('startDate') or request.args.get('date') or data.get('date')
    end_date_str = request.args.get('endDate') or data.get('endDate') or start_date_str

    if not start_date_str:
        start_date_str = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')
        end_date_str = start_date_str

    try:
        dt_start = datetime.datetime.strptime(start_date_str, '%Y-%m-%d')
        dt_end = datetime.datetime.strptime(end_date_str, '%Y-%m-%d')
    except Exception:
        dt_start = datetime.datetime.now(datetime.timezone.utc)
        dt_end = dt_start

    if dt_end < dt_start:
        dt_start, dt_end = dt_end, dt_start

    if (dt_end - dt_start).days > 14:
        dt_end = dt_start + datetime.timedelta(days=14)

    date_list = []
    curr = dt_start
    while curr <= dt_end:
        date_list.append(curr.strftime('%Y-%m-%d'))
        curr += datetime.timedelta(days=1)

    indice_fonte = '1' if satellite.lower() == 'goes19' else '0'
    target_folder = f"{sector}_ret_{channel}"

    all_filtered = []
    seen_filenames = set()

    for d_str in date_list:
        form_data = {
            'dtConsulta': d_str,
            'idLogs': '',
            'idSubproduto': '',
            'tipoImg': '',
            'comboBusca': '',
            'i': 'en',
            'urlCurta': '',
            'indiceFonte': indice_fonte,
            'indiceProjecao': '0',
            'indiceSetor': '0'
        }

        try:
            resp = requests.post(CPTEC_FORM_URL, data=form_data, headers=HEADERS, timeout=12)
            if resp.status_code != 200:
                continue
            html = resp.text

            raw_urls = re.findall(r'https?://[^\'"\s>]+\.jpg', html)

            for u in raw_urls:
                filename = os.path.basename(u)
                if filename in seen_filenames:
                    continue

                if target_folder in u or f"/{target_folder}/" in u:
                    seen_filenames.add(filename)
                    
                    time_match = re.search(r'_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\.jpg', filename)
                    time_label = ""
                    iso_time = ""
                    sort_key = filename

                    if time_match:
                        yyyy, mm, dd, hh, min_ = time_match.groups()
                        time_label = f"{yyyy}-{mm}-{dd} {hh}:{min_} UTC"
                        iso_time = f"{yyyy}-{mm}-{dd}T{hh}:{min_}:00Z"
                        sort_key = f"{yyyy}{mm}{dd}{hh}{min_}"

                    all_filtered.append({
                        'rawUrl': u,
                        'proxyUrl': f"/api/proxy-image?url={urllib.parse.quote(u)}",
                        'filename': filename,
                        'timestamp': time_label,
                        'isoTime': iso_time,
                        'sortKey': sort_key,
                        'date': d_str
                    })
        except Exception as err:
            print(f"Error fetching date {d_str}:", err)
            continue

    all_filtered.sort(key=lambda x: x['sortKey'])

    return jsonify({
        'success': True,
        'count': len(all_filtered),
        'satellite': satellite,
        'sector': sector,
        'channel': channel,
        'startDate': start_date_str,
        'endDate': end_date_str,
        'totalDays': len(date_list),
        'targetFolder': target_folder,
        'images': all_filtered
    })

@app.route('/api/proxy-image')
def proxy_image():
    """
    Proxies CPTEC image fetching with persistent disk caching and QA protocol.
    If image is in cache_images/, serves directly from disk!
    """
    img_url = request.args.get('url')
    if not img_url:
        return jsonify({'error': 'Missing url parameter'}), 400

    filename = os.path.basename(img_url)
    cache_path = os.path.join(CACHE_DIR, filename)

    # Check Disk Cache
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'rb') as f:
                content = f.read()
            response = Response(content, mimetype='image/jpeg')
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['X-Cache-Status'] = 'HIT'
            response.headers['Cache-Control'] = 'public, max-age=2592000' # 30 days
            return response
        except Exception:
            pass # Fall back to download if read fails

    # Download from CPTEC
    try:
        r = requests.get(img_url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return jsonify({'error': f'Image server HTTP {r.status_code}'}), r.status_code

        content = r.content

        # QA Protocol Inspection
        is_valid, reason = inspect_image_bytes(content)
        if not is_valid:
            print(f"[QA Protocol Backend] Rejeitada imagem {filename}: {reason}")
            return jsonify({'error': f'QA Protocol: {reason}'}), 422

        # Save to Disk Cache
        try:
            with open(cache_path, 'wb') as f:
                f.write(content)
        except Exception as e:
            print("Error writing cache file:", e)

        response = Response(content, mimetype='image/jpeg')
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['X-Cache-Status'] = 'MISS'
        response.headers['Cache-Control'] = 'public, max-age=2592000'
        return response

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/cache-info', methods=['GET'])
def cache_info():
    """
    Returns current cache status (file count and total MB).
    """
    count = 0
    total_bytes = 0

    if os.path.exists(CACHE_DIR):
        for fname in os.listdir(CACHE_DIR):
            fpath = os.path.join(CACHE_DIR, fname)
            if os.path.isfile(fpath):
                count += 1
                total_bytes += os.path.getsize(fpath)

    total_mb = round(total_bytes / (1024 * 1024), 2)
    return jsonify({
        'success': True,
        'fileCount': count,
        'sizeMB': total_mb
    })

@app.route('/api/clear-cache', methods=['POST'])
def clear_cache():
    """
    Clears cache files based on max_days retention (default 30 days, or 0 for all).
    """
    data = request.get_json(silent=True) or {}
    days = data.get('days', 30)

    if days == 'all' or days == 0:
        days = 0

    deleted, freed_bytes = cleanup_cache(max_days=int(days))
    freed_mb = round(freed_bytes / (1024 * 1024), 2)

    return jsonify({
        'success': True,
        'deletedCount': deleted,
        'freedMB': freed_mb,
        'retentionDays': days
    })

if __name__ == '__main__':
    print("Starting Anima CPTEC Server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)
