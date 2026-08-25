# 🗺️ CityMap Hub - Mapeador Urbano & CRM de Prospecção Georreferenciada

Sistema web moderno, interativo e 100% responsivo para mapeamento de pontos comerciais, gestão de visitas (CRM), controle de adquirentes/maquininhas de cartão, rastreamento GPS em tempo real e integração direta com **Google Maps** e **WhatsApp**.

---

## 🚀 Principais Funcionalidades

### 📋 Módulo CRM de Visitas
- **Fluxo de Visitas em 1 Clique**: Marque estabelecimentos como visitados instantaneamente pelo painel de detalhes.
- **Ocultação Automática no Mapa**: Por padrão, o mapa inicia no modo **"A Visitar"**, ocultando locais já visitados para manter sua rota limpa e focada em novos clientes.
- **Abas de Controle Segmentadas**:
  - 🔘 **A Visitar** *(padrão)*: Apenas estabelecimentos pendentes de visita com contador em tempo real.
  - 🟢 **Visitados**: Locais já visitados com checkmark visual nos pins do mapa.
  - 🌐 **Todos**: Visão global panorâmica de todos os leads cadastrados.
- **Anotações de Negociação (CRM)**: Salve observações da conversa (ex: nome do tomador de decisão, taxa atual praticada, data de retorno).

### 💳 Gestão e Filtro de Maquininhas de Cartão (Adquirentes)
- **Registro de Maquininha**: Controle de qual maquininha o cliente utiliza (**Stone, Cielo, Rede, PagBank/PagSeguro, Getnet, SafraPay, InfinitePay, Mercado Pago, Ton, C6 Bank, Outra ou Não Informado**).
- **Filtro Multi-Marcas**: Filtre no mapa e na lista apenas estabelecimentos que utilizam determinadas marcas para prospecção estratégica de taxas.
- **Edição Instantânea**: Troca rápida da maquininha diretamente no card do local.

### 📍 Geolocalização em Tempo Real (Live GPS Tracking)
- **Rastreamento Contínuo**: Acompanhe seu deslocamento em tempo real pelo mapa com suporte a `navigator.geolocation.watchPosition`.
- **Marcador com Radar Pulsante**: Ponto azul animado com círculo de precisão em metros e status ao vivo.
- **Recentralização Rápida**: Clique no botão de mira para recentralizar suavemente a visão na sua posição atual.

### ⚡ Rotas & Mapeamento Inteligente
- **Pins Interativos & Categorias**: Marcadores estilizados por cores e ícones específicos para Gastronomia, Comércio, Saúde, Lazer e Serviços.
- **Filtros Avançados & Subcategorias**: Filtre múltiplos segmentos simultaneamente com busca textual instantânea.
- **Planejador de Rotas com Otimizador**: Crie roteiros multi-paradas com algoritmo de rota mais rápida (**Nearest Neighbor**) e abra a rota completa diretamente no aplicativo do Google Maps.
- **WhatsApp Direto**: Botão de contato rápido com mensagem pré-formatada.
- **Importador Apify (XLSX / CSV)**: Importação de dados do Google Maps Places Crawler com anti-duplicação inteligente por coordenadas e nome.
- **100% Responsivo**: Otimizado para smartphones (bottom sheet e gavetas deslizantes).
- **Estilos de Mapa**: Alternância entre temas Escuro (*Dark*), Claro (*Voyager*) e Satélite (*Esri*).

---

## 🛠️ Tecnologias Utilizadas

- **HTML5 & CSS3** (Vanilla CSS com Design System moderno, Dark Theme e Glassmorphism)
- **JavaScript Moderno (ES6+)**
- **Leaflet.js & MarkerCluster** (Renderização e manipulação do mapa interativo com agrupamento)
- **CartoDB & OpenStreetMap & Esri** (Provedores de Tiles cartográficos em HTTPS)
- **SheetJS (xlsx.full.min.js)** (Processamento de planilhas Excel/CSV no navegador)
- **OSRM Routing Engine** (Cálculo de traçados viários e distâncias)

---

## 📦 Como Rodar Localmente

Basta clonar o repositório e abrir o arquivo `index.html` em qualquer navegador:

```bash
git clone https://github.com/FilipeBurini/sistema-leads-burini.git
cd sistema-leads-burini
```

Abra o arquivo `index.html` diretamente no navegador ou utilize a extensão *Live Server* do VS Code.

---

## 🌐 Deploy (Cloudflare Pages / GitHub Pages)

1. Conecte este repositório no [Cloudflare Pages](https://dash.cloudflare.com/) ou ative o [GitHub Pages](https://pages.github.com/).
2. Deixe o comando de build em branco (projeto 100% estático).
3. O deploy será realizado automaticamente com SSL gratuito e CDN global.

---

Desenvolvido para máxima eficiência em campo, prospecção e negociação comercial.
