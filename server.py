import os
import io
import re
import time
import datetime
import urllib.parse
import requests
from concurrent.futures import ThreadPoolExecutor
from flask import Flask, request, jsonify, send_from_directory, Response
from PIL import Image, ImageStat

app = Flask(__name__, static_folder='static')

CPTEC_URLS = {
    'goes16_form': 'https://satelite.cptec.inpe.br/acervowebv2/goes16.formulario.logic',
    'goes_legacy_form': 'https://satelite.cptec.inpe.br/acervowebv2/goes.formulario.logic',
    'meteosat_form': 'https://satelite.cptec.inpe.br/acervowebv2/meteosat.formulario.logic'
}

SATELLITE_CONFIG = {
    'goes19': {'form': 'goes16_form', 'indiceFonte': '1', 'name': 'GOES-19', 'defaultChannel': 'ch13_baixa', 'repoSat': 'goes19', 'prefixes': ['S11161213']},
    'goes16': {'form': 'goes16_form', 'indiceFonte': '0', 'name': 'GOES-16', 'defaultChannel': 'ch13_baixa', 'repoSat': 'goes16', 'prefixes': ['S11161213']},
    'goes13': {'form': 'goes_legacy_form', 'indiceFonte': '3', 'name': 'GOES-13 (Histórico)', 'defaultChannel': 'infra', 'repoSat': 'goes13', 'prefixes': ['S11232949', 'S1123', 'S112']},
    'goes12': {'form': 'goes_legacy_form', 'indiceFonte': '2', 'name': 'GOES-12 (Histórico)', 'defaultChannel': 'infra', 'repoSat': 'goes12', 'prefixes': ['S11219747', 'S1121', 'S112']},
    'goes10': {'form': 'goes_legacy_form', 'indiceFonte': '1', 'name': 'GOES-10 (Histórico)', 'defaultChannel': 'infra', 'repoSat': 'goes10', 'prefixes': ['S1120', 'S112']},
    'goes8':  {'form': 'goes_legacy_form', 'indiceFonte': '0', 'name': 'GOES-8 (Histórico)', 'defaultChannel': 'infra', 'repoSat': 'goes8', 'prefixes': ['S11201750', 'S1120', 'S112']},
    'meteosat9': {'form': 'meteosat_form', 'indiceFonte': '1', 'name': 'Meteosat-9', 'defaultChannel': 'ch09', 'repoSat': 'msg', 'prefixes': ['S10117900', 'S10117901']},
    'meteosat8': {'form': 'meteosat_form', 'indiceFonte': '0', 'name': 'Meteosat-8', 'defaultChannel': 'ch09', 'repoSat': 'msg', 'prefixes': ['S101']}
}

HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

CACHE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cache_images')
os.makedirs(CACHE_DIR, exist_ok=True)

def cleanup_cache(max_days=30):
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
        print("Cache cleanup error:", err)
    return deleted_count, freed_bytes

cleanup_cache(30)

def inspect_image_bytes(image_bytes):
    try:
        if len(image_bytes) < 40000:
            return False, f"Tamanho insuficiente ({len(image_bytes)} bytes < 40KB)"
        img = Image.open(io.BytesIO(image_bytes))
        img.verify()
        img = Image.open(io.BytesIO(image_bytes))
        w, h = img.size
        aspect_ratio = w / float(h) if h > 0 else 99
        if h < 350 or aspect_ratio > 2.2:
            return False, f"Imagem incompleta ({w}x{h})"
        gray = img.convert('L')
        stat = ImageStat.Stat(gray)
        avg_brightness = stat.mean[0]
        max_brightness = stat.extrema[0][1]
        if avg_brightness < 6.0 or max_brightness < 25:
            return False, f"Imagem escura ({avg_brightness:.1f})"
        bottom_crop = gray.crop((0, int(h * 0.80), w, h))
        bottom_stat = ImageStat.Stat(bottom_crop)
        bottom_avg = bottom_stat.mean[0]
        bottom_max = bottom_stat.extrema[0][1]
        if avg_brightness > 18.0 and bottom_avg < 2.0 and bottom_max < 15:
            return False, f"Imagem cortada no rodapé ({bottom_avg:.1f})"
        return True, "OK"
    except Exception as err:
        return False, f"Imagem corrompida: {str(err)}"

def get_channel_folder_name(sat, channel):
    if sat in ['goes19', 'goes16']:
        return f"ams_ret_{channel}"
    elif sat in ['goes13', 'goes12', 'goes10', 'goes8']:
        mapping = {
            'infra': 'ams_infra_baixa',
            'vis': 'ams_vis_baixa',
            'vapor': 'ams_vapor_baixa',
            'realce': 'ams_realce_baixa',
            'col': 'ams_col_baixa'
        }
        return mapping.get(channel, f"ams_{channel}_baixa")
    elif sat in ['meteosat9', 'meteosat8']:
        return channel
    return channel

def get_satellite_prefixes(satellite, channel):
    """
    Retorna os prefixos corretos para o satélite e canal selecionados.
    Para GOES-19/16, extrai o número do canal (ex: ch08 -> S11161208).
    """
    ch_match = re.search(r'ch(\d{2})', channel.lower())
    if ch_match:
        ch_num = ch_match.group(1)
        if satellite == 'goes19':
            return [f"S111612{ch_num}", f"S11612{ch_num}", f"S1116{ch_num}"]
        elif satellite == 'goes16':
            return [f"S111612{ch_num}", f"S116{ch_num}", f"S118{ch_num}"]

    sat_cfg = SATELLITE_CONFIG.get(satellite, SATELLITE_CONFIG['goes19'])
    return sat_cfg.get('prefixes', ['S11161213', 'S11219747'])

def probe_single_url(url):
    try:
        r = requests.head(url, headers=HEADERS, timeout=3)
        if r.status_code == 200:
            return url
    except Exception:
        pass
    return None

def fetch_probe_repo_images(satellite, channel, date_str):
    """
    Varredura paralela de alta velocidade nos arquivos estáticos do CPTEC.
    """
    dt = datetime.datetime.strptime(date_str, '%Y-%m-%d')
    yyyy = dt.strftime('%Y')
    mm = dt.strftime('%m')
    yyyymmdd = dt.strftime('%Y%m%d')

    sat_cfg = SATELLITE_CONFIG.get(satellite, SATELLITE_CONFIG['goes19'])
    repo_sat = sat_cfg['repoSat']
    folder = get_channel_folder_name(satellite, channel)
    prefixes = get_satellite_prefixes(satellite, channel)

    if satellite in ['meteosat9', 'meteosat8']:
        base_url = f"https://satelite.cptec.inpe.br/repositoriomsg/msg/met_web/{folder}/{yyyy}/{mm}/"
    else:
        base_url = f"https://satelite.cptec.inpe.br/repositoriogoes/{repo_sat}/{repo_sat}_web/{folder}/{yyyy}/{mm}/"

    urls_to_test = []
    # Intervalos de observação (00, 10, 20, 30, 40, 50 para GOES-R; 09, 39 para GOES legado)
    minute_slots = [0, 9, 10, 15, 20, 30, 39, 40, 45, 50]
    
    for prefix in prefixes:
        for hh in range(24):
            for m in minute_slots:
                fname = f"{prefix}_{yyyymmdd}{hh:02d}{m:02d}.jpg"
                urls_to_test.append(f"{base_url}{fname}")

    valid_urls = []
    with ThreadPoolExecutor(max_workers=30) as executor:
        results = executor.map(probe_single_url, urls_to_test)
        for r in results:
            if r:
                valid_urls.append(r)

    return valid_urls

@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/<path:path>')
def static_files(path):
    return send_from_directory('static', path)

@app.route('/api/fetch-images', methods=['GET', 'POST'])
def fetch_images():
    data = request.get_json(silent=True) or {}
    satellite = (request.args.get('satellite') or data.get('satellite') or 'goes19').lower()
    sector = 'ams'
    sat_cfg = SATELLITE_CONFIG.get(satellite, SATELLITE_CONFIG['goes19'])
    channel = request.args.get('channel') or data.get('channel') or sat_cfg['defaultChannel']
    
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

    form_url = CPTEC_URLS.get(sat_cfg.get('form'), CPTEC_URLS['goes16_form'])
    indice_fonte = sat_cfg.get('indiceFonte', '1')
    target_folder = get_channel_folder_name(satellite, channel)

    all_filtered = []
    seen_filenames = set()

    for d_str in date_list:
        date_urls = []

        # 1. Consulta ao formulário CPTEC
        form_data = {
            'dtConsulta': d_str,
            'idLogs': '', 'idSubproduto': '', 'tipoImg': '', 'comboBusca': '',
            'i': 'en', 'urlCurta': '', 'indiceFonte': indice_fonte,
            'indiceProjecao': '0', 'indiceSetor': '0'
        }
        try:
            resp = requests.post(form_url, data=form_data, headers={'User-Agent': HEADERS['User-Agent'], 'Referer': form_url}, timeout=8)
            if resp.status_code == 200:
                raw_urls = re.findall(r'https?://[^\'"\s>]+\.jpg', resp.text)
                for u in raw_urls:
                    if 'goes16' in sat_cfg.get('form', ''):
                        if target_folder in u or f"/{target_folder}/" in u:
                            date_urls.append(u)
                    else:
                        if (f"/{target_folder}/" in u or f"/{channel}/" in u or f"_{channel}_" in u or "infra" in u):
                            date_urls.append(u)
        except Exception:
            pass

        # 2. Varredura direta paralela caso o formulário não retorne
        if not date_urls:
            date_urls = fetch_probe_repo_images(satellite, channel, d_str)

        for u in date_urls:
            filename = os.path.basename(u)
            if filename in seen_filenames:
                continue
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

    all_filtered.sort(key=lambda x: x['sortKey'])

    return jsonify({
        'success': True,
        'count': len(all_filtered),
        'satellite': satellite,
        'satelliteName': sat_cfg['name'],
        'sector': sector,
        'channel': channel,
        'startDate': start_date_str,
        'endDate': end_date_str,
        'totalDays': len(date_list),
        'images': all_filtered
    })

@app.route('/api/proxy-image')
def proxy_image():
    img_url = request.args.get('url')
    if not img_url:
        return jsonify({'error': 'Missing url'}), 400
    filename = os.path.basename(img_url)
    cache_path = os.path.join(CACHE_DIR, filename)
    if os.path.exists(cache_path):
        try:
            with open(cache_path, 'rb') as f:
                content = f.read()
            response = Response(content, mimetype='image/jpeg')
            response.headers['Access-Control-Allow-Origin'] = '*'
            response.headers['X-Cache-Status'] = 'HIT'
            response.headers['Cache-Control'] = 'public, max-age=2592000'
            return response
        except Exception:
            pass
    try:
        r = requests.get(img_url, headers=HEADERS, timeout=15)
        if r.status_code != 200:
            return jsonify({'error': f'HTTP {r.status_code}'}), r.status_code
        content = r.content
        is_valid, reason = inspect_image_bytes(content)
        if not is_valid:
            return jsonify({'error': f'QA Protocol: {reason}'}), 422
        try:
            with open(cache_path, 'wb') as f:
                f.write(content)
        except Exception:
            pass
        response = Response(content, mimetype='image/jpeg')
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['X-Cache-Status'] = 'MISS'
        response.headers['Cache-Control'] = 'public, max-age=2592000'
        return response
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/cache-info', methods=['GET'])
def cache_info():
    count = 0
    total_bytes = 0
    if os.path.exists(CACHE_DIR):
        for fname in os.listdir(CACHE_DIR):
            fpath = os.path.join(CACHE_DIR, fname)
            if os.path.isfile(fpath):
                count += 1
                total_bytes += os.path.getsize(fpath)
    total_mb = round(total_bytes / (1024 * 1024), 2)
    return jsonify({'success': True, 'fileCount': count, 'sizeMB': total_mb})

@app.route('/api/clear-cache', methods=['POST'])
def clear_cache():
    data = request.get_json(silent=True) or {}
    days = data.get('days', 30)
    if days == 'all' or days == 0:
        days = 0
    deleted, freed_bytes = cleanup_cache(max_days=int(days))
    freed_mb = round(freed_bytes / (1024 * 1024), 2)
    return jsonify({'success': True, 'deletedCount': deleted, 'freedMB': freed_mb})

if __name__ == '__main__':
    print("Starting Anima CPTEC Server on http://localhost:5000")
    app.run(host='0.0.0.0', port=5000, debug=True)