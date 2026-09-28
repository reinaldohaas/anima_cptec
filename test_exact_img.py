import requests

img_url = "https://satelite.cptec.inpe.br/repositoriogoes/goes12/goes12_web/ams_infra_baixa/2005/01/S11219747_200501312039.jpg"
headers = {'User-Agent': 'Mozilla/5.0'}

r = requests.get(img_url, headers=headers, timeout=15)
print("Image Status Code:", r.status_code)
print("Content-Type:", r.headers.get('Content-Type'))
print("Content-Length:", len(r.content))
