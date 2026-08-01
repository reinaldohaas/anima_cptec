import os
import io
import re
import datetime
import urllib.parse
import requests
from flask import Flask, request, jsonify, send_file, send_from_directory, Response
from PIL import Image
import imageio
import numpy as np

app = Flask(__name__, static_folder='static')

EXPORT_DIR = os.path.join(os.path.dirname(__file__), 'exports')
os.makedirs(EXPORT_DIR, exist_ok=True)

# CPTEC Base URL
CPTEC_FORM_URL = 'https://satelite.cptec.inpe.br/acervowebv2/goes16.formulario.logic'

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Referer': CPTEC_FORM_URL
}

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('static', path)

@app.route('/api/fetch-images', methods=['GET', 'POST'])
def fetch_images():
    """
    Fetches image metadata from CPTEC for chosen satellite, sector, channel, and date.
    """
    data = request.get_json(silent=True) or {}
    satellite = request.args.get('satellite') or data.get('satellite') or 'goes16'
    sector = request.args.get('sector') or data.get('sector') or 'ams'
    channel = request.args.get('channel') or data.get('channel') or 'ch07_baixa'
    date_str = request.args.get('date') or data.get('date')

    if not date_str:
        date_str = datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%d')

    # Mapping satellite fuente ID
    indice_fonte = '1' if satellite.lower() == 'goes19' else '0'

    # Target folder pattern, e.g. ams_ret_ch07_baixa
    target_folder = f"{sector}_ret_{channel}"

    form_data = {
        'dtConsulta': date_str,
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
        resp = requests.post(CPTEC_FORM_URL, data=form_data, headers=HEADERS, timeout=15)
        html = resp.text

        # Extract all jpg URLs
        raw_urls = re.findall(r'https?://[^\'"\s>]+\.jpg', html)

        # Filter by target folder (e.g. ams_ret_ch07_baixa or satellite folder)
        filtered = []
        seen_filenames = set()

        for u in raw_urls:
            filename = os.path.basename(u)
            if filename in seen_filenames:
                continue

            # Check folder match
            if target_folder in u or f"/{target_folder}/" in u:
                seen_filenames.add(filename)
                
                # Parse timestamp from filename: e.g. S11635376_202405070920.jpg
                time_match = re.search(r'_(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})\.jpg', filename)
                time_label = ""
                iso_time = ""
                sort_key = filename

                if time_match:
                    yyyy, mm, dd, hh, min_ = time_match.groups()
                    time_label = f"{yyyy}-{mm}-{dd} {hh}:{min_} UTC"
                    iso_time = f"{yyyy}-{mm}-{dd}T{hh}:{min_}:00Z"
                    sort_key = f"{yyyy}{mm}{dd}{hh}{min_}"

                filtered.append({
                    'rawUrl': u,
                    'proxyUrl': f"/api/proxy-image?url={urllib.parse.quote(u)}",
                    'filename': filename,
                    'timestamp': time_label,
                    'isoTime': iso_time,
                    'sortKey': sort_key
                })

        # Sort chronologically (oldest to newest for animation)
        filtered.sort(key=lambda x: x['sortKey'])

        return jsonify({
            'success': True,
            'count': len(filtered),
            'satellite': satellite,
            'sector': sector,
            'channel': channel,
            'date': date_str,
            'targetFolder': target_folder,
            'images': filtered
        })

    except Exception as e:
        return jsonify({'success': False, 'error': str(e)}), 500

@app.route('/api/proxy-image')
def proxy_image():
    """
    Proxies CPTEC image fetching to attach CORS headers (Access-Control-Allow-Origin: *).
    Prevents canvas tainting on HTML5 Canvas.
    """
    img_url = request.args.get('url')
    if not img_url:
        return jsonify({'error': 'Missing url parameter'}), 400

    try:
        r = requests.get(img_url, headers=HEADERS, timeout=15, stream=True)
        if r.status_code != 200:
            return jsonify({'error': f'Image server HTTP {r.status_code}'}), r.status_code

        response = Response(r.content, mimetype='image/jpeg')
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Cache-Control'] = 'public, max-age=86400'
        return response

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/export-video', methods=['POST'])
def export_video():
    """
    Generates MP4 video server-side from array of image URLs.
    """
    body = request.get_json() or {}
    urls = body.get('urls', [])
    fps = int(body.get('fps', 10))
    sum_mode = body.get('sumMode', False)

    if not urls:
        return jsonify({'error': 'No image URLs provided'}), 400

    try:
        frames = []
        accumulated_arr = None

        for idx, u in enumerate(urls):
            # Fetch image
            r = requests.get(u, headers=HEADERS, timeout=10)
            if r.status_code == 200:
                img = Image.open(io.BytesIO(r.content)).convert('RGB')
                arr = np.array(img, dtype=np.float32)

                if sum_mode:
                    if accumulated_arr is None:
                        accumulated_arr = arr.copy()
                    else:
                        accumulated_arr = np.maximum(accumulated_arr, arr) # Maximum intensity projection
                    
                    frame_img = Image.fromarray(np.clip(accumulated_arr, 0, 255).astype(np.uint8))
                else:
                    frame_img = img

                frames.append(np.array(frame_img))

        if not frames:
            return jsonify({'error': 'Failed to load any frames'}), 500

        timestamp_file = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        out_path = os.path.join(EXPORT_DIR, f"goes_animation_{timestamp_file}.mp4")

        imageio.mimwrite(out_path, frames, fps=fps, quality=8)

        return send_file(out_path, as_attachment=True, download_name=os.path.basename(out_path))

    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/export-gif', methods=['POST'])
def export_gif():
    """
    Generates animated GIF server-side from array of image URLs.
    """
    body = request.get_json() or {}
    urls = body.get('urls', [])
    fps = int(body.get('fps', 10))

    if not urls:
        return jsonify({'error': 'No image URLs provided'}), 400

    try:
        frames = []
        for u in urls[:50]: # Limit frames for GIF size
            r = requests.get(u, headers=HEADERS, timeout=10)
            if r.status_code == 200:
                img = Image.open(io.BytesIO(r.content)).convert('RGB')
                frames.append(img)

        if not frames:
            return jsonify({'error': 'Failed to load frames'}), 500

        out_io = io.BytesIO()
        duration_ms = int(1000 / fps)
        frames[0].save(
            out_io,
            format='GIF',
            save_all=True,
            append_images=frames[1:],
            duration=duration_ms,
            loop=0
        )
        out_io.seek(0)

        timestamp_file = datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
        return send_file(out_io, mimetype='image/gif', as_attachment=True, download_name=f"goes_animation_{timestamp_file}.gif")

    except Exception as e:
        return jsonify({'error': str(e)}), 500

if __name__ == '__main__':
    print("Starting Anima CPTEC Server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)
