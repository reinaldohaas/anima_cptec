import requests
import datetime

def probe_goes12_date(d_str):
    dt = datetime.datetime.strptime(d_str, '%Y-%m-%d')
    yyyy = dt.strftime('%Y')
    mm = dt.strftime('%m')
    yyyymmdd = dt.strftime('%Y%m%d')
    
    base_url = f"https://satelite.cptec.inpe.br/repositoriogoes/goes12/goes12_web/ams_infra_baixa/{yyyy}/{mm}/"
    headers = {'User-Agent': 'Mozilla/5.0'}
    
    found = []
    for hh in range(24):
        for min_val in [0, 9, 15, 30, 39, 45]:
            time_str = f"{yyyymmdd}{hh:02d}{min_val:02d}"
            url = f"{base_url}S11219747_{time_str}.jpg"
            try:
                r = requests.head(url, headers=headers, timeout=2)
                if r.status_code == 200:
                    found.append(url)
            except Exception:
                pass
    return found

print("Probing GOES-12 for 2005-01-27 to 2005-01-31...")
for date_str in ['2005-01-27', '2005-01-28', '2005-01-29', '2005-01-30', '2005-01-31']:
    urls = probe_goes12_date(date_str)
    print(f"Date {date_str}: {len(urls)} images found")
