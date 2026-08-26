# 🗺️ CityMap Hub - Mapeador Urbano & CRM de Prospecção Georreferenciada

Sistema web moderno, interativo e 100% responsivo para mapeamento de pontos comerciais, gestão de funil de vendas (CRM de campo), agendamento de retornos (follow-up), controle de maquininhas de cartão, filtro de proximidade por raio GPS e integração direta com **Google Maps** e **WhatsApp**.

---

## 🚀 Principais Funcionalidades

### 🏆 1. Funil de Vendas Visual (CRM de Campo)
- **4 Estágios Comerciais**:
  - ⚪ **A Visitar / Lead**: Estabelecimento pendente de contato inicial.
  - 🟡 **Em Negociação**: Proposta apresentada, aguardando decisão.
  - 🟢 **Fechado / Credenciado**: Cliente ganho e fidelizado.
  - 🔴 **Sem Interesse**: Estabelecimento que recusou proposta.
- **Seletor Rápido no Painel**: Alterne o estágio comercial do cliente com 1 toque no card de detalhes.
- **Pins Inteligentes no Mapa**: Ícones e cores dinâmicas no mapa representando o estágio exato do lead.
- **Abas de Controle Segmentadas**: Filtre o mapa e a lista por *A Visitar*, *Em Negociação*, *Retornos*, *Fechados* ou *Todos*.

### ⏰ 2. Agendamento de Retorno com Lembretes (Follow-up)
- **Agendamento com 1 Toque**: Defina data e horário do retorno diretamente no card do local com atalhos rápidos (*Hoje 14h*, *Amanhã 10h*, *Em 3 dias*, *Próxima Semana*).
- **Banner de Alerta Inteligente**: Aviso no topo do mapa indicando quantos retornos você tem para hoje, com botão de 1 clique para focar no mapa e criar a rota.
- **Aba Dedicada de Retornos**: Visualize rapidamente todos os clientes com retorno pendente ou atrasado.

### 🎯 3. Filtro por Raio de Distância GPS (*"Clientes a X km de mim"*)
- **Filtro de Proximidade**: Isole estabelecimentos em um raio específico em torno da sua localização atual (**500m, 1 km, 2 km, 5 km ou 10 km**).
- **Círculo Cartográfico Dinâmico**: Visualização suave do perímetro de alcance no mapa Leaflet.
- **Ordenação por Distância**: Opção *"Mais Próximos de Mim (GPS)"* com exibição da distância em tempo real em cada card (ex: `📍 320m`, `📍 1.5 km`).

### 🕒 4. Horários de Abertura em Tempo Real
- **Identificação Automática**: Compara o horário atual do relógio com os horários de cada estabelecimento.
- **Pins em Cinza**: Locais fechados no momento ficam automaticamente com pin em cinza ardósia no mapa.
- **Banners de Status no Card**: Indicação clara de *🟢 Aberto Agora (Fecha às XX:XX)* ou *🔴 Fechado no Momento (Abre às XX:XX)*.

### 💳 5. Gestão e Filtro de Maquininhas de Cartão (Adquirentes)
- **Registro de Maquininha**: Controle de qual adquirente o cliente utiliza (**Stone, Cielo, Rede, PagBank/PagSeguro, Getnet, SafraPay, InfinitePay, Mercado Pago, Ton, C6 Bank, Outra ou Não Informado**).
- **Filtro Multi-Marcas**: Filtre no mapa e na lista apenas estabelecimentos que utilizam determinadas marcas para prospecção de taxas.

### 📍 6. Geolocalização em Tempo Real (Live GPS Tracking)
- **Rastreamento Contínuo**: Acompanhe seu deslocamento em tempo real pelo mapa com suporte a `navigator.geolocation.watchPosition`.
- **Marcador com Radar Pulsante**: Ponto azul animado com círculo de precisão em metros e status ao vivo.

### ⚡ 7. Rotas Otimizadas & Importador Apify
- **Planejador com Otimizador de Rota**: Algoritmo de menor trajeto (**Nearest Neighbor**) com exportação direta para navegação no aplicativo do Google Maps.
- **Importador Apify (XLSX / CSV)**: Importação de dados do Google Maps Places Crawler com anti-duplicação inteligente por coordenadas e nome.
- **WhatsApp Direto**: Botão de contato com mensagem pré-formatada.
- **100% Responsivo**: Layout otimizado para celulares (gaveta deslizante off-canvas e painel bottom-sheet).

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

Desenvolvido para máxima eficiência comercial em prospecção de campo.
