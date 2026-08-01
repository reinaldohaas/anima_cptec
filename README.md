# 🛰️ Anima CPTEC - GOES Satellite Image Animator & Processor

Uma aplicação web interativa em Python (Flask) e JavaScript/Canvas para carregar, animar, acumular ("SOMA" / composição de frames), processar e gravar vídeos/GIFs de imagens de satélite do **CPTEC/INPE (GOES-16 e GOES-19)**.

![Anima CPTEC Preview](static/preview.png)

## 🎯 Funcionalidades

- **Seleção Iterativa & Flexível**:
  - **Satélites**: GOES-16, GOES-19.
  - **Setores / Regiões**: América do Sul (`ams`), Brasil (`br`), Sudeste (`se`), Sul (`s`), Nordeste (`ne`), Norte (`n`), Centro-Oeste (`co`).
  - **Canais ABI (01 ao 16)**: Visível, Vapor d'Água, Infravermelho, Cirrus, etc. + Composições RGB (Massa de Ar / Airmass, True Color, Nevoeiro).
  - **Data e Intervalo**: Escolha de datas históricas ou em tempo real com intervalo de 10 min, 30 min, 1h e controle de quantidade de quadros.
- **Player de Animação Avançado**:
  - Play / Pause / Passo a Passo (Avançar e Voltar).
  - Controle de Velocidade (1 a 30 FPS).
  - Timeline interativa com visualização do horário UTC.
  - Modos de Loop (Normal, Vaivém / Bounce).
  - Zoom e Pan interativo na imagem do satélite.
- **Processamento de Quadros & SOMA (Accumulation / Max Projection)**:
  - **Modo SOMA (SUM)**: Soma a intensidade dos pixels ao longo do tempo para evidenciar rastros de nuvens, tempestades e focos de calor.
  - **Modo Média & Projeção Máxima (MIP)**.
  - **Filtros em tempo real**: Brilho, Contraste, Inversão e Falsa Cor / Paletas Térmicas (Thermal, Rainbow, IR Enhanced).
- **Gravação & Exportação de Vídeos / GIFs**:
  - Gravador de Vídeo via navegador (MediaRecorder para formato WebM/MP4 em tempo real).
  - Exportação Server-side de vídeos MP4 de alta qualidade.
  - Exportação Server-side de GIFs animados.
  - Download da imagem composta ou do frame atual em PNG.
- **Proxy CORS Integrado**:
  - Servidor Flask integrado que realiza o proxy das imagens do CPTEC para evitar problemas de CORS no Canvas do navegador.

---

## 🚀 Como Executar

### Pré-requisitos
- Python 3.10 ou superior.

### Instalação

1. Clone este repositório:
```bash
git clone https://github.com/seu-usuario/anima_cptec.git
cd anima_cptec
```

2. Instale as dependências:
```bash
pip install -r requirements.txt
```

3. Execute o servidor:
```bash
python server.py
```

4. Abra no seu navegador:
```text
http://localhost:5000
```

---

## 📂 Estrutura do Projeto

```text
anima_cptec/
├── server.py              # Servidor Backend Flask, APIs e Proxy CORS
├── requirements.txt       # Dependências Python
├── README.md              # Documentação
├── .gitignore             # Arquivos ignorados pelo Git
└── static/
    ├── index.html         # Interface Web interativa
    ├── css/style.css      # Estilos modernos em Dark Mode / Glassmorphism
    └── js/app.js          # Lógica do Player, Canvas, Soma de imagens e Gravação
```

---

## 🛠️ Tecnologias Utilizadas

- **Backend**: Python 3, Flask, Requests, Pillow (PIL), ImageIO.
- **Frontend**: HTML5 Canvas, Vanilla CSS (Glassmorphism, Dark Theme), Modern JavaScript (ES6+).
- **Dados**: CPTEC / INPE (Divisão de Satélites e Sensores Ambientais).

---

## 📜 Licença

Este projeto é disponibilizado sob a licença MIT. Imagens e dados pertencem ao CPTEC/INPE.
