import requests
import re

url = "https://satelite.cptec.inpe.br/repositoriogoes/goes12/goes12_web/ams_infra_baixa/2005/01/"
headers = {'User-Agent': 'Mozilla/5.0'}

r = requests.get(url, headers=headers, timeout=15)
print("Status:", r.status_code)
print("HTML length:", len(r.text))

# Print first 500 chars of HTML
print("HTML sample:")
print(r.text[:500])

# Match all links or filenames ending with .jpg
files = re.findall(r'S112[0-9_]+\.jpg', r.text, re.IGNORECASE)
print(f"\nFound {len(files)} files matching S112...jpg")
for f in files[:10]:
    print("  -", f)

# Filter for date 2005-01-31 (20050131)
date_files = [f for f in files if '20050131' in f]
print(f"\nFound {len(date_files)} files for 20050131:")
for f in date_files:
    print("  *", f)
