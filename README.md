# 🗺️ CityMap Hub - Mapeador Urbano & Gestão de Leads Georreferenciados

Sistema web moderno, interativo e 100% responsivo para mapeamento de pontos comerciais, gestão de leads, visualização de rotas com waypoints e integração direta com o **Google Maps** e **WhatsApp**.

---

## 🚀 Principais Funcionalidades

- 📍 **Pins Interativos & Categorias**: Marcadores animados por cores e ícones específicos para cada segmento (Gastronomia, Comércio, Saúde, Lazer e Serviços).
- 🏷️ **Filtros Avançados & Subcategorias**: Filtre múltiplos segmentos simultaneamente (ex: apenas *Adegas*, *Restaurantes*, *Farmácias*, etc.) com seleção múltipla e busca em tempo real.
- ⚡ **Planejador de Rotas Inteligente**: Selecione múltiplos locais na cidade e use o botão **"Otimizar Trajeto Mais Fácil"** para reorganizar os pontos na rota mais curta e rápida.
- 🗺️ **Integração Google Maps**: Exporte rotas multi-paradas com 1 clique para navegar direto no app do Google Maps pelo celular ou GPS do carro.
- 💬 **WhatsApp Direto**: Botão de contato direto via WhatsApp já com o número do local formatado.
- 📊 **Importador Apify (XLSX / CSV)**: Suporte nativo para carregar planilhas exportadas do *Google Maps Places Crawler (Apify)*, com detecção anti-duplicação inteligente por nome e coordenadas.
- 📱 **100% Otimizado para Mobile**: Layout responsivo com gavetas deslizantes (off-canvas) e painel *bottom-sheet* para celular.
- 🌓 **Estilos de Mapa**: Alternância instantânea entre modo Escuro (*Dark*), Claro (*Voyager*) e Satélite (*Esri*).

---

## 🛠️ Tecnologias Utilizadas

- **HTML5 & CSS3** (Vanilla CSS com Design System moderno e Glassmorphism)
- **JavaScript Moderno (ES6+)**
- **Leaflet.js** (Renderização e manipulação do mapa interativo)
- **CartoDB & OpenStreetMap & Esri** (Provedores de Tiles cartográficos gratuitos em HTTPS)
- **SheetJS (xlsx.full.min.js)** (Processamento de planilhas Excel/CSV no navegador)
- **OSRM Routing Engine** (Cálculo de traçados viários e distâncias)

---

## 📦 Como Rodar Localmente

Basta clonar o repositório e abrir o arquivo `index.html` em qualquer navegador:

```bash
git clone https://github.com/FilipeBurini/sistema-leads-burini.git
cd sistema-leads-burini
```

Abra o arquivo `index.html` com o duplo clique ou via extensão *Live Server* no VS Code.

---

## 🌐 Deploy (Cloudflare Pages / GitHub Pages)

1. Conecte este repositório no [Cloudflare Pages](https://dash.cloudflare.com/) ou ative o [GitHub Pages](https://pages.github.com/).
2. Deixe o comando de build em branco (projeto 100% estático).
3. O deploy será realizado automaticamente com SSL gratuito e CDN de alta performance.

---

Desenvolvido com foco em performance, usabilidade e alta conversão de prospecção.
