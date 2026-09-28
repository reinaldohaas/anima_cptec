import requests
import datetime

# Test known prefix S11219747 or find prefixes for GOES-12
base_url = "https://satelite.cptec.inpe.br/repositoriogoes/goes12/goes12_web/ams_infra_baixa/2005/01/"
headers = {'User-Agent': 'Mozilla/5.0'}

# Test times for 2005-01-31
valid_urls = []
for hh in range(24):
    for mm in [0, 9, 15, 30, 39, 45]:
        time_str = f"20050131{hh:02d}{mm:02d}"
        # Test common prefix S11219747 or S112
        url = f"{base_url}S11219747_{time_str}.jpg"
        r = requests.head(url, headers=headers, timeout=5)
        if r.status_code == 200:
            print(f"FOUND valid image: {url}")
            valid_urls.append(url)

print(f"\nTotal valid images found by timestamp probing for 2005-01-31: {len(valid_urls)}")
