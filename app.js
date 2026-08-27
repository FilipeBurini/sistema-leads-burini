/**
 * CityMap Hub - Interactive Map Logic
 * Built with Leaflet.js, OpenStreetMap Tiles, Nominatim API & LocalStorage
 */

// --- ESTADO GLOBAL DA APLICAÇÃO ---
const STORAGE_KEY = 'citymap_places_data';

const AppState = {
  places: [],
  filteredPlaces: [],
  selectedCategories: ['alimentacao', 'comercio', 'saude', 'lazer', 'servicos'],
  selectedSubCategories: [], // Vazio significa todas as disponíveis
  crmStageFilter: 'lead', // 'lead' (A Visitar / padrão), 'negotiating', 'follow_up', 'closed', 'all'
  radiusFilter: null, // null (todos) ou valor em km (ex: 0.5, 1, 2, 5, 10)
  radiusCircle: null,
  selectedCardMachines: [], // Vazio significa todas as disponíveis
  availableCardMachines: ['Stone', 'Cielo', 'Rede', 'PagBank', 'Getnet', 'SafraPay', 'InfinitePay', 'Mercado Pago', 'Ton', 'C6 Bank', 'Outra', 'Não Informado'],
  searchQuery: '',
  activePlaceId: null,
  currentTileLayer: 'voyager',
  userCoordinates: null,
  userAccuracy: null,
  userMarker: null,
  userAccuracyCircle: null,
  userLocationWatchId: null,
  isTrackingLive: false,
  map: null,
  markersGroup: null,
  tileLayers: {},
  categoryIcons: {
    alimentacao: 'ri-restaurant-2-fill',
    comercio: 'ri-shopping-bag-3-fill',
    saude: 'ri-heart-pulse-fill',
    lazer: 'ri-compass-3-fill',
    servicos: 'ri-briefcase-fill'
  },
  categoryNames: {
    alimentacao: 'Gastronomia',
    comercio: 'Comércio',
    saude: 'Saúde',
    lazer: 'Lazer',
    servicos: 'Serviços'
  },
  routeStops: [],
  routePolyline: null
};

// --- INICIALIZAÇÃO ---
document.addEventListener('DOMContentLoaded', async () => {
  initMap();
  await loadInitialPlaces();
  setupEventListeners();
  updateUI();

  // Atualização periódica do status de funcionamento a cada 60 segundos
  setInterval(() => {
    renderMapMarkers();
    renderPlacesList();
  }, 60000);
});

// --- INICIALIZAR MAPA COM TILES CUSTOMIZADOS ---
function initMap() {
  // Ponto central padrão inicial (Franca - SP / Brasil)
  const defaultCenter = [-20.5385, -47.4009];

  AppState.map = L.map('map', {
    zoomControl: false
  }).setView(defaultCenter, 14);

  // Mover controles de zoom para o canto inferior direito
  L.control.zoom({ position: 'bottomright' }).addTo(AppState.map);

  // Provedores de Tiles 100% Gratuitos e sem chave de API (OpenStreetMap e Esri)
  AppState.tileLayers = {
    dark: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      className: 'map-tiles-dark',
      maxZoom: 19
    }),
    voyager: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      maxZoom: 19
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community',
      maxZoom: 19
    })
  };

  // Modo Claro (OpenStreetMap) como padrão do sistema
  AppState.tileLayers.voyager.addTo(AppState.map);

  // Grupo de marcadores com Cluster
  AppState.markersGroup = L.markerClusterGroup({
    showCoverageOnHover: false,
    maxClusterRadius: 40,
    spiderfyOnMaxZoom: true
  });
  AppState.map.addLayer(AppState.markersGroup);

  // Clique com botão direito no mapa para adicionar novo local na coordenada clicada
  AppState.map.on('contextmenu', (e) => {
    openAddModal(null, e.latlng.lat, e.latlng.lng);
  });
}

// --- CARREGAMENTO DE DADOS (LOCALSTORAGE OU DEFAULT JSON) ---
async function loadInitialPlaces() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    try {
      AppState.places = JSON.parse(saved);
      return;
    } catch (err) {
      console.error('Erro ao ler LocalStorage:', err);
    }
  }

  // Se não existir, carrega do default-places.json
  try {
    const res = await fetch('data/default-places.json');
    if (res.ok) {
      AppState.places = await res.json();
      savePlaces();
    }
  } catch (e) {
    console.warn('Não foi possível carregar default-places.json, iniciando lista vazia.', e);
    AppState.places = [];
  }
}

function savePlaces() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(AppState.places));
}

// --- ATUALIZAÇÃO DA INTERFACE & MARCADORES NO MAPA ---
function updateUI() {
  extractSubCategories();
  filterPlaces();
  renderPlacesList();
  renderMapMarkers();
  updateCategoryCounts();
  renderSubCategoryOptions();
  renderCardMachineOptions();
}

function extractSubCategories() {
  const subSet = new Set();
  
  AppState.places.forEach(p => {
    if (!p.subCategory) {
      if (p.tags && p.tags.length > 0) {
        p.subCategory = p.tags[0];
      } else if (p.category === 'alimentacao') {
        p.subCategory = 'Adega / Gastronomia';
      } else {
        p.subCategory = AppState.categoryNames[p.category] || 'Geral';
      }
    }

    if (AppState.selectedCategories.includes(p.category)) {
      subSet.add(p.subCategory.trim());
    }
  });

  AppState.availableSubCategories = Array.from(subSet).sort((a, b) => a.localeCompare(b));
  
  const validSelected = AppState.selectedSubCategories.filter(s => AppState.availableSubCategories.includes(s));
  if (validSelected.length === 0 && AppState.availableSubCategories.length > 0) {
    AppState.selectedSubCategories = [...AppState.availableSubCategories];
  } else {
    AppState.selectedSubCategories = validSelected;
  }
}

function filterPlaces() {
  const query = AppState.searchQuery.toLowerCase().trim();
  const selectedCats = AppState.selectedCategories;
  const selectedSubs = AppState.selectedSubCategories;
  const stageFilter = AppState.crmStageFilter;
  const selectedMachines = AppState.selectedCardMachines;
  const radiusKm = AppState.radiusFilter;
  const userCoords = AppState.userCoordinates;

  AppState.filteredPlaces = AppState.places.filter(place => {
    // 1. Categoria Principal
    const matchCategory = selectedCats.includes(place.category);

    // 2. Subcategoria
    const matchSubCategory = selectedSubs.length === 0 || !place.subCategory || selectedSubs.includes(place.subCategory.trim());
    
    // 3. Status CRM (Funil de Vendas e Retornos)
    const stage = place.crmStage || (place.visited ? 'negotiating' : 'lead');
    let matchStage = true;
    if (stageFilter === 'lead') {
      matchStage = (stage === 'lead');
    } else if (stageFilter === 'negotiating') {
      matchStage = (stage === 'negotiating');
    } else if (stageFilter === 'follow_up') {
      matchStage = !!place.followUpDate;
    } else if (stageFilter === 'closed') {
      matchStage = (stage === 'closed');
    } else if (stageFilter === 'all') {
      matchStage = true;
    }

    // 4. Maquininha de Cartão
    let matchMachine = true;
    if (selectedMachines.length > 0) {
      const machine = place.cardMachine || 'Não Informado';
      matchMachine = selectedMachines.includes(machine);
    }

    // 5. Filtro de Raio de Distância (GPS)
    let matchRadius = true;
    if (userCoords) {
      const dist = calculateDistanceKm(userCoords[0], userCoords[1], place.lat, place.lng);
      place._distanceMeters = dist * 1000;
      if (radiusKm) {
        matchRadius = dist <= radiusKm;
      }
    } else {
      delete place._distanceMeters;
    }

    // 6. Pesquisa Textual
    const matchSearch = !query || 
      place.name.toLowerCase().includes(query) ||
      place.address.toLowerCase().includes(query) ||
      (place.cardMachine && place.cardMachine.toLowerCase().includes(query)) ||
      (place.crmNotes && place.crmNotes.toLowerCase().includes(query)) ||
      (place.followUpNotes && place.followUpNotes.toLowerCase().includes(query)) ||
      (place.subCategory && place.subCategory.toLowerCase().includes(query)) ||
      (place.description && place.description.toLowerCase().includes(query)) ||
      (place.tags && place.tags.some(tag => tag.toLowerCase().includes(query)));

    return matchCategory && matchSubCategory && matchStage && matchMachine && matchRadius && matchSearch;
  });

  // Ordenação
  const sortOption = document.getElementById('sortPlacesSelect').value;
  AppState.filteredPlaces.sort((a, b) => {
    if (sortOption === 'distance-asc') {
      const distA = a._distanceMeters !== undefined ? a._distanceMeters : Infinity;
      const distB = b._distanceMeters !== undefined ? b._distanceMeters : Infinity;
      return distA - distB;
    }
    if (sortOption === 'name-asc') return a.name.localeCompare(b.name);
    if (sortOption === 'name-desc') return b.name.localeCompare(a.name);
    if (sortOption === 'rating-desc') return (parseFloat(b.rating) || 0) - (parseFloat(a.rating) || 0);
    return 0;
  });
}

function updateCategoryCounts() {
  const counts = { alimentacao: 0, comercio: 0, saude: 0, lazer: 0, servicos: 0 };
  let leadCount = 0;
  let negotiatingCount = 0;
  let followUpCount = 0;
  let closedCount = 0;

  AppState.places.forEach(p => {
    if (counts[p.category] !== undefined) counts[p.category]++;
    const stage = p.crmStage || (p.visited ? 'negotiating' : 'lead');
    if (stage === 'lead') leadCount++;
    else if (stage === 'negotiating') negotiatingCount++;
    else if (stage === 'closed') closedCount++;

    if (p.followUpDate) followUpCount++;
  });

  // Atualizar badges CRM do funil
  const leadEl = document.getElementById('count-lead');
  if (leadEl) leadEl.textContent = leadCount;
  const negEl = document.getElementById('count-negotiating');
  if (negEl) negEl.textContent = negotiatingCount;
  const folEl = document.getElementById('count-follow_up');
  if (folEl) folEl.textContent = followUpCount;
  const cloEl = document.getElementById('count-closed');
  if (cloEl) cloEl.textContent = closedCount;
  const allEl = document.getElementById('count-all');
  if (allEl) allEl.textContent = AppState.places.length;

  Object.keys(counts).forEach(cat => {
    const el = document.getElementById(`count-${cat}`);
    if (el) el.textContent = counts[cat];
  });

  // Atualizar texto do dropdown de categorias
  const dropText = document.getElementById('selectedCategoriesText');
  if (dropText) {
    if (AppState.selectedCategories.length === 5) {
      dropText.textContent = 'Todas Categorias';
    } else if (AppState.selectedCategories.length === 0) {
      dropText.textContent = 'Nenhuma';
    } else {
      dropText.textContent = `${AppState.selectedCategories.length} Selecionadas`;
    }
  }

  // Verificar e atualizar o banner de retornos de hoje no mapa
  checkTodayFollowUpsBanner();

  // Atualizar texto do dropdown de subcategorias
  const subDropText = document.getElementById('selectedSubCategoriesText');
  if (subDropText) {
    if (AppState.selectedSubCategories.length === AppState.availableSubCategories.length) {
      subDropText.textContent = 'Todas Subcats';
    } else if (AppState.selectedSubCategories.length === 0) {
      subDropText.textContent = 'Nenhuma Subcat';
    } else if (AppState.selectedSubCategories.length === 1) {
      subDropText.textContent = AppState.selectedSubCategories[0];
    } else {
      subDropText.textContent = `${AppState.selectedSubCategories.length} subcats`;
    }
  }

  // Atualizar texto do dropdown de maquininhas
  const machineDropText = document.getElementById('selectedMachinesText');
  if (machineDropText) {
    if (AppState.selectedCardMachines.length === 0) {
      machineDropText.textContent = 'Todas as Maquininhas';
    } else if (AppState.selectedCardMachines.length === 1) {
      machineDropText.textContent = AppState.selectedCardMachines[0];
    } else {
      machineDropText.textContent = `${AppState.selectedCardMachines.length} Maquininhas`;
    }
  }

  document.getElementById('placesCountText').textContent = `${AppState.filteredPlaces.length} locais encontrados`;
  const mobileCount = document.getElementById('mobilePlacesCount');
  if (mobileCount) mobileCount.textContent = AppState.filteredPlaces.length;
}

function renderSubCategoryOptions() {
  const container = document.getElementById('subCategoryOptionsList');
  if (!container) return;

  if (AppState.availableSubCategories.length === 0) {
    container.innerHTML = `<div style="font-size:0.75rem; color:var(--text-muted); padding:0.4rem;">Nenhuma subcategoria identificada.</div>`;
    return;
  }

  const subCounts = {};
  AppState.places.forEach(p => {
    if (p.subCategory) {
      const s = p.subCategory.trim();
      subCounts[s] = (subCounts[s] || 0) + 1;
    }
  });

  const selectAllSubBtn = document.getElementById('selectAllSubCatsBtn');
  if (selectAllSubBtn) {
    const areAllSubsChecked = AppState.selectedSubCategories.length === AppState.availableSubCategories.length && AppState.availableSubCategories.length > 0;
    selectAllSubBtn.textContent = areAllSubsChecked ? 'Desmarcar Todas' : 'Marcar Todas';
  }

  container.innerHTML = AppState.availableSubCategories.map(sub => {
    const isChecked = AppState.selectedSubCategories.includes(sub) ? 'checked' : '';
    const count = subCounts[sub] || 0;

    return `
      <label class="multiselect-option">
        <input type="checkbox" value="${escapeHtml(sub)}" class="subcat-checkbox" ${isChecked}>
        <span class="cat-name">${escapeHtml(sub)}</span>
        <b class="badge">${count}</b>
      </label>
    `;
  }).join('');

  container.querySelectorAll('.subcat-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      AppState.selectedSubCategories = Array.from(container.querySelectorAll('.subcat-checkbox'))
        .filter(c => c.checked)
        .map(c => c.value);
      
      filterPlaces();
      renderPlacesList();
      renderMapMarkers();
      updateCategoryCounts();
    });
  });
}

function renderCardMachineOptions() {
  const container = document.getElementById('machineOptionsList');
  if (!container) return;

  const machineCounts = {};
  AppState.places.forEach(p => {
    const m = p.cardMachine || 'Não Informado';
    machineCounts[m] = (machineCounts[m] || 0) + 1;
  });

  const machines = [
    'Stone', 'Cielo', 'Rede', 'PagBank', 'Getnet',
    'SafraPay', 'InfinitePay', 'Mercado Pago', 'Ton',
    'C6 Bank', 'Outra', 'Não Informado'
  ];

  container.innerHTML = machines.map(m => {
    const isChecked = AppState.selectedCardMachines.length === 0 || AppState.selectedCardMachines.includes(m);
    const count = machineCounts[m] || 0;

    return `
      <label class="multiselect-option">
        <input type="checkbox" value="${escapeHtml(m)}" class="machine-checkbox" ${isChecked ? 'checked' : ''}>
        <span class="cat-name">${escapeHtml(m)}</span>
        <b class="badge">${count}</b>
      </label>
    `;
  }).join('');

  container.querySelectorAll('.machine-checkbox').forEach(cb => {
    cb.addEventListener('change', () => {
      const checkedBoxes = Array.from(container.querySelectorAll('.machine-checkbox:checked')).map(c => c.value);
      if (checkedBoxes.length === machines.length || checkedBoxes.length === 0) {
        AppState.selectedCardMachines = [];
      } else {
        AppState.selectedCardMachines = checkedBoxes;
      }

      filterPlaces();
      renderPlacesList();
      renderMapMarkers();
      updateCategoryCounts();
    });
  });
}

function renderPlacesList() {
  const container = document.getElementById('placesList');
  if (!container) return;

  if (AppState.filteredPlaces.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <i class="ri-map-pin-line"></i>
        <p>Nenhum local encontrado para os filtros aplicados.</p>
      </div>
    `;
    return;
  }

  const now = new Date();

  container.innerHTML = AppState.filteredPlaces.map(place => {
    const catName = AppState.categoryNames[place.category] || place.category;
    const isActive = place.id === AppState.activePlaceId ? 'active' : '';
    const stage = place.crmStage || (place.visited ? 'negotiating' : 'lead');
    const openStatus = getPlaceOpenStatus(place, now);
    const followUp = getFollowUpStatus(place);

    const machineBadge = place.cardMachine ? `<span class="mini-machine-badge" title="Maquininha: ${escapeHtml(place.cardMachine)}"><i class="ri-bank-card-line"></i> ${escapeHtml(place.cardMachine)}</span>` : '';
    
    // Badge de estágio no funil
    let stageDot = `<span class="crm-list-dot pending" title="A Visitar"><i class="ri-checkbox-blank-circle-line"></i></span>`;
    if (stage === 'negotiating') {
      stageDot = `<span class="crm-list-dot" style="color: #fbbf24;" title="Em Negociação"><i class="ri-time-fill"></i></span>`;
    } else if (stage === 'closed') {
      stageDot = `<span class="crm-list-dot visited" title="Cliente Fechado"><i class="ri-checkbox-circle-fill"></i></span>`;
    } else if (stage === 'rejected') {
      stageDot = `<span class="crm-list-dot" style="color: #f43f5e;" title="Sem Interesse"><i class="ri-close-circle-fill"></i></span>`;
    }

    const statusPill = place.hours ? `
      <span class="place-item-status-pill ${openStatus.isOpen ? 'open' : 'closed'}">
        <i class="${openStatus.isOpen ? 'ri-checkbox-circle-fill' : 'ri-time-line'}"></i>
        ${openStatus.isOpen ? 'Aberto' : 'Fechado'}
      </span>
    ` : '';

    const distanceBadge = place._distanceMeters !== undefined ? `
      <span class="place-distance-badge" title="Distância até você">
        <i class="ri-navigation-line"></i> ${formatDistance(place._distanceMeters)}
      </span>
    ` : '';

    const followUpTag = followUp.isScheduled ? `
      <span class="place-followup-tag ${followUp.isToday || followUp.isOverdue ? 'due-today' : 'due-upcoming'}" title="Retorno Agendado: ${place.followUpDate} ${place.followUpTime || ''}">
        <i class="ri-calendar-event-fill"></i> ${followUp.label}
      </span>
    ` : '';

    return `
      <div class="place-item ${isActive} ${stage === 'closed' ? 'place-visited' : ''} ${!openStatus.isOpen ? 'place-closed' : ''}" data-id="${place.id}" onclick="selectPlace('${place.id}', true)">
        <div class="place-item-left">
          ${stageDot}
          <span class="place-item-dot" style="background: ${!openStatus.isOpen ? '#64748b' : `var(--color-${place.category}, var(--color-primary))`}"></span>
          <div class="place-item-info">
            <span class="place-item-name" title="${escapeHtml(place.name)}">${escapeHtml(place.name)}</span>
            <div style="display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
              ${distanceBadge}
              ${machineBadge}
              ${followUpTag}
              ${statusPill}
            </div>
          </div>
        </div>
        <span class="place-item-badge" style="background: ${!openStatus.isOpen ? '#475569' : `var(--color-${place.category}, var(--color-primary))`}">
          ${catName}
        </span>
      </div>
    `;
  }).join('');
}

function renderMapMarkers() {
  AppState.markersGroup.clearLayers();

  const now = new Date();

  AppState.filteredPlaces.forEach(place => {
    const iconClass = AppState.categoryIcons[place.category] || 'ri-map-pin-fill';
    const stage = place.crmStage || (place.visited ? 'negotiating' : 'lead');
    const openStatus = getPlaceOpenStatus(place, now);
    const isClosed = !openStatus.isOpen;
    const followUp = getFollowUpStatus(place);
    
    // Indicador de estágio no pin
    let stageBadgeHtml = '';
    if (stage === 'negotiating') {
      stageBadgeHtml = '<span class="pin-stage-badge negotiating" title="Em Negociação"><i class="ri-time-fill"></i></span>';
    } else if (stage === 'closed') {
      stageBadgeHtml = '<span class="pin-stage-badge closed" title="Cliente Fechado"><i class="ri-checkbox-circle-fill"></i></span>';
    } else if (stage === 'rejected') {
      stageBadgeHtml = '<span class="pin-stage-badge rejected" title="Sem Interesse"><i class="ri-close-fill"></i></span>';
    }

    const followUpBadgeHtml = followUp.isScheduled ? `<span class="pin-followup-badge" title="Retorno Agendado: ${followUp.label}"><i class="ri-calendar-event-fill"></i></span>` : '';

    // Criação do Ícone Customizado HTML
    const customIcon = L.divIcon({
      className: `custom-map-pin pin-${place.category} stage-${stage} ${isClosed ? 'is-closed' : 'is-open'}`,
      html: `
        <div class="pin-icon-wrap" title="${escapeHtml(place.name)} - ${openStatus.statusText}">
          <i class="${iconClass}"></i>
          ${stageBadgeHtml}
          ${followUpBadgeHtml}
          ${isClosed ? '<span class="pin-closed-indicator" title="Fechado agora"><i class="ri-time-line"></i></span>' : ''}
        </div>
      `,
      iconSize: [38, 38],
      iconAnchor: [19, 38],
      popupAnchor: [0, -36]
    });

    const marker = L.marker([place.lat, place.lng], { icon: customIcon });

    // Ao clicar no pin, abre diretamente o painel completo de detalhes do local
    marker.on('click', () => {
      selectPlace(place.id, false);
    });

    AppState.markersGroup.addLayer(marker);
  });
}

// --- SELEÇÃO DE UM LOCAL & EXIBIÇÃO DO DRAWER DE DETALHES ---
window.selectPlace = function(placeId, zoomIn = false) {
  AppState.activePlaceId = placeId;
  const place = AppState.places.find(p => p.id === placeId);
  if (!place) return;

  // Atualizar visual da lista
  document.querySelectorAll('.place-item').forEach(card => {
    card.classList.toggle('active', card.dataset.id === placeId);
  });

  // Voar suavemente até o marcador no mapa
  if (zoomIn && AppState.map) {
    AppState.map.flyTo([place.lat, place.lng], 16, { duration: 1.2 });
  }

  // Avaliação do status de abertura e estágio CRM
  const openStatus = getPlaceOpenStatus(place, new Date());
  const stage = place.crmStage || (place.visited ? 'negotiating' : 'lead');
  const followUp = getFollowUpStatus(place);

  // Preencher e abrir o Drawer de Detalhes
  const drawer = document.getElementById('placeDetailDrawer');
  const drawerContent = document.getElementById('drawerContent');
  const photo = place.photo || 'https://images.unsplash.com/photo-1517248135467-4c7edcad34c4?w=800&auto=format&fit=crop&q=80';
  const catName = AppState.categoryNames[place.category] || place.category;
  
  const googleMapsRouteUrl = `https://www.google.com/maps/dir/?api=1&destination=${place.lat},${place.lng}`;
  const whatsappUrl = place.whatsapp ? `https://wa.me/${place.whatsapp.replace(/\D/g, '')}?text=Ol%C3%A1!%20Encontrei%20voc%C3%AAs%20no%20CityMap.` : null;

  const tagsHtml = (place.tags || []).map(t => `<span class="mini-tag">${escapeHtml(t)}</span>`).join('');

  drawerContent.innerHTML = `
    <div class="drawer-hero-img" style="background-image: url('${escapeHtml(photo)}')">
      <div class="drawer-hero-overlay"></div>
    </div>
    <div class="drawer-body">
      <div class="drawer-meta-top">
        <span class="drawer-cat-badge" style="background: ${!openStatus.isOpen ? '#475569' : `var(--color-${place.category}, var(--color-primary))`}">
          ${catName}
        </span>
        ${place.rating ? `<span class="drawer-rating"><i class="ri-star-fill"></i> ${place.rating}</span>` : ''}
      </div>

      <!-- BANNER DE STATUS ABERTO / FECHADO EM TEMPO REAL -->
      <div class="drawer-status-banner ${openStatus.isUnknown ? 'status-unknown' : (openStatus.isOpen ? 'status-open' : 'status-closed')}">
        <div class="status-banner-left">
          <span class="status-pulse-dot ${openStatus.isOpen ? 'dot-open' : 'dot-closed'}"></span>
          <span class="status-banner-label">${openStatus.isOpen ? 'Aberto Agora' : 'Fechado no Momento'}</span>
        </div>
        <span class="status-banner-detail">${escapeHtml(openStatus.statusText)}</span>
      </div>

      <h2 class="drawer-title">${escapeHtml(place.name)}</h2>

      ${place.description ? `<p class="drawer-description">${escapeHtml(place.description)}</p>` : ''}

      <div class="drawer-info-grid">
        <div class="info-item">
          <i class="ri-map-pin-2-fill"></i>
          <span>${escapeHtml(place.address)}</span>
        </div>
        ${place._distanceMeters !== undefined ? `
          <div class="info-item">
            <i class="ri-navigation-fill" style="color: #38bdf8;"></i>
            <span style="color: #38bdf8; font-weight: 600;">Distância de você: ${formatDistance(place._distanceMeters)}</span>
          </div>
        ` : ''}
        ${place.hours ? `
          <div class="info-item">
            <i class="ri-time-fill"></i>
            <div class="hours-info-wrap">
              <span class="hours-badge ${openStatus.isOpen ? 'badge-open' : 'badge-closed'}">
                ${openStatus.isOpen ? '🟢 Aberto Agora' : '🔴 Fechado no Momento'}
              </span>
              <span class="hours-text">${escapeHtml(place.hours)}</span>
            </div>
          </div>
        ` : ''}
        ${place.phone ? `
          <div class="info-item">
            <i class="ri-phone-fill"></i>
            <a href="tel:${place.phone.replace(/\s/g, '')}" style="color: inherit; text-decoration: none;">${escapeHtml(place.phone)}</a>
          </div>
        ` : ''}
      </div>

      ${tagsHtml ? `<div class="drawer-tags-wrap">${tagsHtml}</div>` : ''}

      <!-- BLOCO CRM: FUNIL DE VENDAS, RETORNO & MAQUININHA -->
      <div class="drawer-crm-card">
        <div class="crm-card-header">
          <span class="crm-badge stage-${stage}">
            <i class="${stage === 'closed' ? 'ri-checkbox-circle-fill' : stage === 'negotiating' ? 'ri-time-fill' : stage === 'rejected' ? 'ri-close-circle-fill' : 'ri-user-line'}"></i>
            ${stage === 'closed' ? 'Fechado / Ganho' : stage === 'negotiating' ? 'Em Negociação' : stage === 'rejected' ? 'Sem Interesse' : 'Lead (A Visitar)'}
          </span>
          ${place.visitedAt ? `<span class="crm-visit-date"><i class="ri-calendar-line"></i> ${new Date(place.visitedAt).toLocaleDateString('pt-BR')}</span>` : ''}
        </div>

        <!-- SELETOR RÁPIDO DE ETAPA DO FUNIL -->
        <div class="crm-stage-selector">
          <button type="button" class="crm-stage-btn ${stage === 'lead' ? 'active stage-lead' : ''}" onclick="setPlaceCrmStage('${place.id}', 'lead')">⚪ A Visitar</button>
          <button type="button" class="crm-stage-btn ${stage === 'negotiating' ? 'active stage-negotiating' : ''}" onclick="setPlaceCrmStage('${place.id}', 'negotiating')">🟡 Negociação</button>
          <button type="button" class="crm-stage-btn ${stage === 'closed' ? 'active stage-closed' : ''}" onclick="setPlaceCrmStage('${place.id}', 'closed')">🟢 Fechado</button>
          <button type="button" class="crm-stage-btn ${stage === 'rejected' ? 'active stage-rejected' : ''}" onclick="setPlaceCrmStage('${place.id}', 'rejected')">🔴 Recusado</button>
        </div>

        <!-- AGENDAMENTO DE RETORNO (FOLLOW-UP) -->
        <div class="crm-followup-box">
          <div class="followup-header">
            <div style="display:flex; align-items:center; gap: 4px;">
              <i class="ri-calendar-event-fill" style="color: #38bdf8;"></i>
              <span>Agendar Retorno:</span>
            </div>
            ${place.followUpDate ? `<button type="button" class="btn-clear-followup" onclick="clearPlaceFollowUp('${place.id}')"><i class="ri-delete-bin-line"></i> Cancelar</button>` : ''}
          </div>
          
          <div class="followup-inputs-row">
            <input type="date" id="drawerFollowUpDate" value="${place.followUpDate || ''}" onchange="savePlaceFollowUp('${place.id}')">
            <input type="time" id="drawerFollowUpTime" value="${place.followUpTime || ''}" onchange="savePlaceFollowUp('${place.id}')">
          </div>

          <div class="followup-quick-chips">
            <button type="button" class="quick-chip" onclick="setQuickFollowUp('${place.id}', 0, '14:00')">Hoje 14h</button>
            <button type="button" class="quick-chip" onclick="setQuickFollowUp('${place.id}', 1, '10:00')">Amanhã 10h</button>
            <button type="button" class="quick-chip" onclick="setQuickFollowUp('${place.id}', 3, '15:00')">Em 3 dias</button>
            <button type="button" class="quick-chip" onclick="setQuickFollowUp('${place.id}', 7, '10:00')">Próx. Semana</button>
          </div>

          <input type="text" class="crm-notes-input followup-note" placeholder="Motivo do retorno (ex: Falar com o sócio Carlos sobre taxas)..." value="${escapeHtml(place.followUpNotes || '')}" onblur="savePlaceFollowUpNotes('${place.id}', this.value)">
        </div>

        <!-- MAQUININHA DE CARTÃO -->
        <div class="crm-machine-box">
          <div class="machine-label">
            <i class="ri-bank-card-fill"></i>
            <span>Maquininha Utilizada:</span>
          </div>
          <select class="crm-machine-select" onchange="updatePlaceCardMachine('${place.id}', this.value)">
            <option value="" ${!place.cardMachine ? 'selected' : ''}>❓ Não Informado</option>
            <option value="Stone" ${place.cardMachine === 'Stone' ? 'selected' : ''}>🟢 Stone</option>
            <option value="Cielo" ${place.cardMachine === 'Cielo' ? 'selected' : ''}>🔵 Cielo</option>
            <option value="Rede" ${place.cardMachine === 'Rede' ? 'selected' : ''}>🟠 Rede</option>
            <option value="PagBank" ${place.cardMachine === 'PagBank' ? 'selected' : ''}>🟡 PagBank / PagSeguro</option>
            <option value="Getnet" ${place.cardMachine === 'Getnet' ? 'selected' : ''}>🔴 Getnet</option>
            <option value="SafraPay" ${place.cardMachine === 'SafraPay' ? 'selected' : ''}>🟣 SafraPay</option>
            <option value="InfinitePay" ${place.cardMachine === 'InfinitePay' ? 'selected' : ''}>⚡ InfinitePay</option>
            <option value="Mercado Pago" ${place.cardMachine === 'Mercado Pago' ? 'selected' : ''}>🔹 Mercado Pago</option>
            <option value="Ton" ${place.cardMachine === 'Ton' ? 'selected' : ''}>🟩 Ton</option>
            <option value="C6 Bank" ${place.cardMachine === 'C6 Bank' ? 'selected' : ''}>⬛ C6 Bank</option>
            <option value="Outra" ${place.cardMachine === 'Outra' ? 'selected' : ''}>⚪ Outra</option>
          </select>
        </div>

        <div class="crm-notes-box">
          <div class="notes-header">
            <i class="ri-file-edit-line"></i>
            <span>Anotações Gerais de Negociação:</span>
          </div>
          <textarea class="crm-notes-input" placeholder="Ex: Falei com o proprietário João, taxa atual 2.1%, proposta feita..." onblur="savePlaceCrmNotes('${place.id}', this.value)">${escapeHtml(place.crmNotes || '')}</textarea>
        </div>
      </div>

      <div class="drawer-actions-grid">
        <a href="${googleMapsRouteUrl}" target="_blank" class="btn btn-route">
          <i class="ri-navigation-fill"></i> Como Chegar
        </a>
        <button class="btn btn-route-planner" onclick="addPlaceDirectlyToRoute('${place.id}')">
          <i class="ri-route-line"></i> + Adicionar à Rota
        </button>
      </div>

      ${whatsappUrl ? `
        <div style="margin-top: 0.5rem;">
          <a href="${whatsappUrl}" target="_blank" class="btn btn-whatsapp" style="width: 100%;">
            <i class="ri-whatsapp-line"></i> Conversar no WhatsApp
          </a>
        </div>
      ` : ''}

      <div class="drawer-management-bar">
        <button class="btn btn-secondary btn-sm" onclick="openAddModal('${place.id}')">
          <i class="ri-edit-line"></i> Editar
        </button>
        <button class="btn btn-secondary btn-sm text-danger" onclick="deletePlace('${place.id}')">
          <i class="ri-delete-bin-line"></i> Excluir
        </button>
      </div>
    </div>
  `;

  drawer.classList.add('open');

  // Fechar sidebar no mobile para mostrar o local
  if (window.innerWidth <= 900) {
    document.getElementById('sidebar').classList.remove('mobile-open');
  }
};

window.copyCoordinates = function(lat, lng) {
  navigator.clipboard.writeText(`${lat}, ${lng}`);
  showToast('Coordenadas copiadas para a área de transferência!');
};

// --- CADASTRO E EDIÇÃO DE LOCAIS (MODAL) ---
function openAddModal(placeId = null, defaultLat = null, defaultLng = null) {
  const modal = document.getElementById('placeModal');
  const form = document.getElementById('placeForm');
  const title = document.getElementById('modalTitle');

  form.reset();
  document.getElementById('placeId').value = '';

  if (placeId) {
    title.textContent = 'Editar Local';
    const place = AppState.places.find(p => p.id === placeId);
    if (place) {
      document.getElementById('placeId').value = place.id;
      document.getElementById('placeName').value = place.name;
      document.getElementById('placeCategory').value = place.category;
      document.getElementById('placeAddress').value = place.address;
      document.getElementById('placeLat').value = place.lat;
      document.getElementById('placeLng').value = place.lng;
      document.getElementById('placePhone').value = place.phone || '';
      document.getElementById('placeWhatsapp').value = place.whatsapp || '';
      document.getElementById('placeHours').value = place.hours || '';
      document.getElementById('placeRating').value = place.rating || 5.0;
      document.getElementById('placePhoto').value = place.photo || '';
      document.getElementById('placeDescription').value = place.description || '';
      document.getElementById('placeCardMachine').value = place.cardMachine || '';
      document.getElementById('placeCrmStage').value = place.crmStage || (place.visited ? 'negotiating' : 'lead');
      document.getElementById('placeFollowUpDate').value = place.followUpDate || '';
      document.getElementById('placeFollowUpTime').value = place.followUpTime || '';
      document.getElementById('placeCrmNotes').value = place.crmNotes || '';
      document.getElementById('placeTags').value = (place.tags || []).join(', ');
    }
  } else {
    title.textContent = 'Cadastrar Novo Local';
    if (defaultLat && defaultLng) {
      document.getElementById('placeLat').value = defaultLat.toFixed(6);
      document.getElementById('placeLng').value = defaultLng.toFixed(6);
      reverseGeocode(defaultLat, defaultLng);
    } else {
      const center = AppState.map.getCenter();
      document.getElementById('placeLat').value = center.lat.toFixed(6);
      document.getElementById('placeLng').value = center.lng.toFixed(6);
    }
  }

  modal.classList.add('open');
}

function closePlaceModal() {
  document.getElementById('placeModal').classList.remove('open');
}

// --- GEOCODING (NOMINATIM OPENSTREETMAP) ---
async function geocodeAddress() {
  const address = document.getElementById('placeAddress').value.trim();
  if (!address) {
    showToast('Digite um endereço para buscar as coordenadas.');
    return;
  }

  const btn = document.getElementById('geocodeAddressBtn');
  const originalHtml = btn.innerHTML;
  btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> Buscando...`;
  btn.disabled = true;

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    const data = await res.json();

    if (data && data.length > 0) {
      document.getElementById('placeLat').value = parseFloat(data[0].lat).toFixed(6);
      document.getElementById('placeLng').value = parseFloat(data[0].lon).toFixed(6);
      showToast('Coordenadas encontradas com sucesso!');
    } else {
      showToast('Endereço não localizado com precisão. Insira as coordenadas manualmente.');
    }
  } catch (err) {
    console.error('Erro na geocodificação:', err);
    showToast('Erro ao consultar serviço de mapa.');
  } finally {
    btn.innerHTML = originalHtml;
    btn.disabled = false;
  }
}

async function reverseGeocode(lat, lng) {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`;
    const res = await fetch(url, { headers: { 'Accept-Language': 'pt-BR' } });
    const data = await res.json();
    if (data && data.display_name) {
      const addressInput = document.getElementById('placeAddress');
      if (!addressInput.value) {
        addressInput.value = data.display_name;
      }
    }
  } catch (e) {
    console.warn('Erro no reverse geocoding:', e);
  }
}

// --- EXCLUSÃO DE LOCAL ---
window.deletePlace = function(placeId) {
  if (confirm('Tem certeza que deseja excluir este local?')) {
    AppState.places = AppState.places.filter(p => p.id !== placeId);
    savePlaces();
    document.getElementById('placeDetailDrawer').classList.remove('open');
    updateUI();
    showToast('Local excluído com sucesso!');
  }
};

// --- PLANEJADOR DE ROTAS & EXPORTAÇÃO PARA O GOOGLE MAPS ---
function openRouteModal() {
  populateRoutePlaceSelector();
  renderRouteStopsList();
  document.getElementById('routeModal').classList.add('open');
}

function closeRouteModal() {
  document.getElementById('routeModal').classList.remove('open');
}

function populateRoutePlaceSelector() {
  const select = document.getElementById('routePlaceSelector');
  select.innerHTML = '<option value="">-- Escolha um local cadastrado para adicionar à rota --</option>';
  
  AppState.places.forEach(place => {
    const isAlreadyAdded = AppState.routeStops.some(s => s.id === place.id);
    const option = document.createElement('option');
    option.value = place.id;
    option.textContent = `${place.name} (${AppState.categoryNames[place.category] || place.category}) - ${place.address}`;
    if (isAlreadyAdded) option.disabled = true;
    select.appendChild(option);
  });
}

function addStopToRoute(placeId) {
  if (!placeId) return;
  const place = AppState.places.find(p => p.id === placeId);
  if (!place) return;

  if (AppState.routeStops.some(s => s.id === placeId)) {
    showToast('Este local já está na rota.');
    return;
  }

  AppState.routeStops.push(place);
  populateRoutePlaceSelector();
  renderRouteStopsList();
}

function removeStopFromRoute(index) {
  AppState.routeStops.splice(index, 1);
  populateRoutePlaceSelector();
  renderRouteStopsList();
}

function moveStop(index, direction) {
  const newIndex = index + direction;
  if (newIndex < 0 || newIndex >= AppState.routeStops.length) return;
  const temp = AppState.routeStops[index];
  AppState.routeStops[index] = AppState.routeStops[newIndex];
  AppState.routeStops[newIndex] = temp;
  renderRouteStopsList();
}

function renderRouteStopsList() {
  const list = document.getElementById('routeStopsList');
  const googleBtn = document.getElementById('openGoogleMapsRouteBtn');
  const drawBtn = document.getElementById('drawRouteOnMapBtn');
  const summary = document.getElementById('routeSummary');

  if (AppState.routeStops.length === 0) {
    list.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 1.5rem; font-size: 0.82rem;">
        <i class="ri-route-line" style="font-size: 1.8rem; display: block; margin-bottom: 0.3rem;"></i>
        Nenhuma parada adicionada ainda. Selecione locais acima para montar seu itinerário.
      </div>
    `;
    googleBtn.disabled = true;
    drawBtn.disabled = true;
    summary.style.display = 'none';
    return;
  }

  list.innerHTML = AppState.routeStops.map((stop, i) => `
    <div class="route-stop-item">
      <div class="route-stop-info">
        <span class="route-stop-num">${i + 1}</span>
        <span class="route-stop-name" title="${escapeHtml(stop.name)} - ${escapeHtml(stop.address)}">${escapeHtml(stop.name)}</span>
      </div>
      <div class="route-stop-actions">
        ${i > 0 ? `<button class="stop-btn" onclick="moveStop(${i}, -1)" title="Subir"><i class="ri-arrow-up-s-line"></i></button>` : ''}
        ${i < AppState.routeStops.length - 1 ? `<button class="stop-btn" onclick="moveStop(${i}, 1)" title="Descer"><i class="ri-arrow-down-s-line"></i></button>` : ''}
        <button class="stop-btn delete" onclick="removeStopFromRoute(${i})" title="Remover"><i class="ri-delete-bin-line"></i></button>
      </div>
    </div>
  `).join('');

  // Habilitar botões se tiver pelo menos 2 pontos (origem e destino)
  const canRoute = AppState.routeStops.length >= 2;
  googleBtn.disabled = !canRoute;
  drawBtn.disabled = !canRoute;

  // Calcular distância estimada em linha reta
  summary.style.display = 'flex';
  document.getElementById('routeStopsCount').textContent = `${AppState.routeStops.length} paradas na rota`;
  
  let totalKm = 0;
  for (let i = 0; i < AppState.routeStops.length - 1; i++) {
    totalKm += calculateDistanceKm(
      AppState.routeStops[i].lat, AppState.routeStops[i].lng,
      AppState.routeStops[i+1].lat, AppState.routeStops[i+1].lng
    );
  }
  document.getElementById('routeTotalDist').textContent = `Distância estimada: ~${totalKm.toFixed(1)} km`;
}

function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

// Abrir a rota completa com waypoints no Google Maps
function openGoogleMapsRoute() {
  if (AppState.routeStops.length < 2) {
    showToast('Adicione pelo menos 2 pontos para gerar a rota.');
    return;
  }

  const origin = `${AppState.routeStops[0].lat},${AppState.routeStops[0].lng}`;
  const destination = `${AppState.routeStops[AppState.routeStops.length - 1].lat},${AppState.routeStops[AppState.routeStops.length - 1].lng}`;
  
  let waypoints = '';
  if (AppState.routeStops.length > 2) {
    const middleStops = AppState.routeStops.slice(1, -1);
    waypoints = `&waypoints=${middleStops.map(s => `${s.lat},${s.lng}`).join('|')}`;
  }

  // URL universal da API de Rotas do Google Maps
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}${waypoints}&travelmode=driving`;
  
  window.open(googleMapsUrl, '_blank');
  showToast('Abrindo rota completa no Google Maps!');
}

// Traçar linha da rota visualmente no mapa do Leaflet
async function drawRouteOnMap() {
  if (AppState.routeStops.length < 2) return;

  if (AppState.routePolyline) {
    AppState.map.removeLayer(AppState.routePolyline);
    AppState.routePolyline = null;
  }

  // Tentar traçado de ruas via OSRM Routing API gratuito
  try {
    const coordsStr = AppState.routeStops.map(s => `${s.lng},${s.lat}`).join(';');
    const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${coordsStr}?overview=full&geometries=geojson`;
    
    const res = await fetch(osrmUrl);
    const data = await res.json();

    if (data && data.routes && data.routes.length > 0) {
      const geojsonRoute = data.routes[0].geometry;
      const latlngs = geojsonRoute.coordinates.map(c => [c[1], c[0]]);

      AppState.routePolyline = L.polyline(latlngs, {
        color: '#10b981',
        weight: 6,
        opacity: 0.9,
        dashArray: '1, 8',
        lineCap: 'round'
      }).addTo(AppState.map);

      AppState.map.fitBounds(AppState.routePolyline.getBounds(), { padding: [50, 50] });
    } else {
      fallbackStraightPolyline();
    }
  } catch (e) {
    console.warn('OSRM indisponível, usando linha direta:', e);
    fallbackStraightPolyline();
  }

  closeRouteModal();
  showToast('Rota traçada no mapa!');
}

// Otimização Automática do Trajeto (Algoritmo TSP Nearest Neighbor)
function optimizeRouteOrder() {
  if (AppState.routeStops.length <= 2) {
    showToast('A rota já está na ordem direta de início e fim.');
    return;
  }

  const optimized = [];
  const unvisited = [...AppState.routeStops];

  // Inicia com o primeiro ponto definido como origem
  let current = unvisited.shift();
  optimized.push(current);

  while (unvisited.length > 0) {
    let nearestIndex = 0;
    let shortestDist = Infinity;

    for (let i = 0; i < unvisited.length; i++) {
      const dist = calculateDistanceKm(current.lat, current.lng, unvisited[i].lat, unvisited[i].lng);
      if (dist < shortestDist) {
        shortestDist = dist;
        nearestIndex = i;
      }
    }

    current = unvisited.splice(nearestIndex, 1)[0];
    optimized.push(current);
  }

  AppState.routeStops = optimized;
  renderRouteStopsList();
  showToast('Trajeto otimizado com a rota mais fácil e rápida!');
}

window.addPlaceDirectlyToRoute = function(placeId) {
  addStopToRoute(placeId);
  showToast('Local adicionado à sua rota com sucesso!');
  openRouteModal();
};

function fallbackStraightPolyline() {
  const points = AppState.routeStops.map(s => [s.lat, s.lng]);
  AppState.routePolyline = L.polyline(points, {
    color: '#10b981',
    weight: 5,
    opacity: 0.85,
    dashArray: '8, 8'
  }).addTo(AppState.map);
  AppState.map.fitBounds(AppState.routePolyline.getBounds(), { padding: [50, 50] });
}

window.moveStop = moveStop;
window.removeStopFromRoute = removeStopFromRoute;

// --- EVENT LISTENERS GERAIS ---
function setupEventListeners() {
  // Toggle Sidebar Desktop
  document.getElementById('toggleSidebarBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.toggle('collapsed');
    setTimeout(() => AppState.map.invalidateSize(), 300);
  });

  // Toggle Sidebar Mobile (Abrir e Fechar)
  document.getElementById('mobileToggleSidebarBtn').addEventListener('click', () => {
    document.getElementById('sidebar').classList.add('mobile-open');
  });

  const closeMobileBtn = document.getElementById('closeSidebarMobileBtn');
  if (closeMobileBtn) {
    closeMobileBtn.addEventListener('click', () => {
      document.getElementById('sidebar').classList.remove('mobile-open');
    });
  }

  // Fechar Drawer
  document.getElementById('closeDrawerBtn').addEventListener('click', () => {
    document.getElementById('placeDetailDrawer').classList.remove('open');
  });

  // Abrir Modal de Adicionar
  document.getElementById('openAddModalBtn').addEventListener('click', () => openAddModal());
  document.getElementById('closePlaceModalBtn').addEventListener('click', closePlaceModal);
  document.getElementById('cancelPlaceBtn').addEventListener('click', closePlaceModal);

  // Planejador de Rotas
  document.getElementById('openRoutePlannerBtn').addEventListener('click', openRouteModal);
  document.getElementById('closeRouteModalBtn').addEventListener('click', closeRouteModal);
  document.getElementById('addStopBtn').addEventListener('click', () => {
    const sel = document.getElementById('routePlaceSelector');
    addStopToRoute(sel.value);
  });
  document.getElementById('openGoogleMapsRouteBtn').addEventListener('click', openGoogleMapsRoute);
  document.getElementById('drawRouteOnMapBtn').addEventListener('click', drawRouteOnMap);
  document.getElementById('clearRouteBtn').addEventListener('click', () => {
    AppState.routeStops = [];
    if (AppState.routePolyline) {
      AppState.map.removeLayer(AppState.routePolyline);
      AppState.routePolyline = null;
    }
    populateRoutePlaceSelector();
    renderRouteStopsList();
    showToast('Rota limpa com sucesso.');
  });

  // Botão Otimizar Rota
  document.getElementById('optimizeRouteBtn').addEventListener('click', optimizeRouteOrder);

  // Dropdown Multiselect de Categorias
  const catDropBtn = document.getElementById('categoryDropdownBtn');
  const catMenu = document.getElementById('categoryMultiselectMenu');

  catDropBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    catMenu.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!catMenu.contains(e.target) && !catDropBtn.contains(e.target)) {
      catMenu.classList.remove('show');
    }
  });

  // Botão Marcar/Desmarcar Todas Categorias Principais
  const selectAllCatsBtn = document.getElementById('selectAllCatsBtn');
  selectAllCatsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const allCategoriesList = ['alimentacao', 'comercio', 'saude', 'lazer', 'servicos'];
    const areAllChecked = AppState.selectedCategories.length === allCategoriesList.length;

    if (areAllChecked) {
      AppState.selectedCategories = [];
      catCheckboxes.forEach(cb => cb.checked = false);
      selectAllCatsBtn.textContent = 'Marcar Todas';
    } else {
      AppState.selectedCategories = [...allCategoriesList];
      catCheckboxes.forEach(cb => cb.checked = true);
      selectAllCatsBtn.textContent = 'Desmarcar Todas';
    }
    updateUI();
  });

  // Checkboxes de Categoria
  const catCheckboxes = document.querySelectorAll('.cat-checkbox');
  catCheckboxes.forEach(cb => {
    cb.addEventListener('change', () => {
      AppState.selectedCategories = Array.from(catCheckboxes)
        .filter(c => c.checked)
        .map(c => c.value);
      
      const allCategoriesList = ['alimentacao', 'comercio', 'saude', 'lazer', 'servicos'];
      selectAllCatsBtn.textContent = AppState.selectedCategories.length === allCategoriesList.length ? 'Desmarcar Todas' : 'Marcar Todas';
      updateUI();
    });
  });

  // Dropdown Multiselect de Subcategorias
  const subCatDropBtn = document.getElementById('subCategoryDropdownBtn');
  const subCatMenu = document.getElementById('subCategoryMultiselectMenu');

  subCatDropBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    catMenu.classList.remove('show');
    if (machineMenu) machineMenu.classList.remove('show');
    subCatMenu.classList.toggle('show');
  });

  document.addEventListener('click', (e) => {
    if (!subCatMenu.contains(e.target) && !subCatDropBtn.contains(e.target)) {
      subCatMenu.classList.remove('show');
    }
  });

  // Dropdown Multiselect de Maquininhas
  const machineDropBtn = document.getElementById('machineDropdownBtn');
  const machineMenu = document.getElementById('machineMultiselectMenu');

  if (machineDropBtn && machineMenu) {
    machineDropBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      catMenu.classList.remove('show');
      subCatMenu.classList.remove('show');
      machineMenu.classList.toggle('show');
    });

    document.addEventListener('click', (e) => {
      if (!machineMenu.contains(e.target) && !machineDropBtn.contains(e.target)) {
        machineMenu.classList.remove('show');
      }
    });

    document.getElementById('selectAllMachinesBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      AppState.selectedCardMachines = [];
      document.querySelectorAll('.machine-checkbox').forEach(cb => cb.checked = true);
      updateUI();
    });

    document.getElementById('clearAllMachinesBtn')?.addEventListener('click', (e) => {
      e.stopPropagation();
      AppState.selectedCardMachines = ['__NONE__'];
      document.querySelectorAll('.machine-checkbox').forEach(cb => cb.checked = false);
      updateUI();
    });
  }

  // Tabs de Controle CRM do Funil (A Visitar / Negociação / Retornos / Fechados / Todos)
  document.querySelectorAll('#crmStatusTabs .crm-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#crmStatusTabs .crm-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      AppState.crmStageFilter = tab.dataset.stage;
      updateUI();
    });
  });

  // Pills de Filtro por Raio de Distância (GPS)
  document.querySelectorAll('#radiusPills .radius-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      document.querySelectorAll('#radiusPills .radius-pill').forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      const rVal = pill.dataset.radius;
      setDistanceRadius(rVal === 'all' ? null : parseFloat(rVal));
    });
  });

  // Botão do banner de alerta de retornos
  document.getElementById('showTodayFollowUpsBtn')?.addEventListener('click', () => {
    showTodayFollowUps();
  });

  // Botão Marcar/Desmarcar Todas Subcategorias
  const selectAllSubBtn = document.getElementById('selectAllSubCatsBtn');
  selectAllSubBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const subCheckboxes = document.querySelectorAll('.subcat-checkbox');
    const areAllSubsChecked = AppState.selectedSubCategories.length === AppState.availableSubCategories.length && AppState.availableSubCategories.length > 0;

    if (areAllSubsChecked) {
      AppState.selectedSubCategories = [];
      subCheckboxes.forEach(c => c.checked = false);
      selectAllSubBtn.textContent = 'Marcar Todas';
    } else {
      AppState.selectedSubCategories = [...AppState.availableSubCategories];
      subCheckboxes.forEach(c => c.checked = true);
      selectAllSubBtn.textContent = 'Desmarcar Todas';
    }
    
    filterPlaces();
    renderPlacesList();
    renderMapMarkers();
    updateCategoryCounts();
  });

  // Ordenação
  document.getElementById('sortPlacesSelect').addEventListener('change', () => {
    updateUI();
  });

  // Geocodificação no formulário
  document.getElementById('geocodeAddressBtn').addEventListener('click', geocodeAddress);

  // Upload de Foto local -> Base64
  document.getElementById('photoFileInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        document.getElementById('placePhoto').value = event.target.result;
        showToast('Foto carregada com sucesso!');
      };
      reader.readAsDataURL(file);
    }
  });

  // Submissão do Formulário de Local
  document.getElementById('placeForm').addEventListener('submit', (e) => {
    e.preventDefault();

    const placeId = document.getElementById('placeId').value;
    const name = document.getElementById('placeName').value.trim();
    const category = document.getElementById('placeCategory').value;
    const address = document.getElementById('placeAddress').value.trim();
    const lat = parseFloat(document.getElementById('placeLat').value);
    const lng = parseFloat(document.getElementById('placeLng').value);
    const phone = document.getElementById('placePhone').value.trim();
    const whatsapp = document.getElementById('placeWhatsapp').value.trim();
    const hours = document.getElementById('placeHours').value.trim();
    const rating = document.getElementById('placeRating').value;
    const photo = document.getElementById('placePhoto').value.trim();
    const description = document.getElementById('placeDescription').value.trim();
    const cardMachine = document.getElementById('placeCardMachine').value;
    const crmStage = document.getElementById('placeCrmStage').value;
    const followUpDate = document.getElementById('placeFollowUpDate').value;
    const followUpTime = document.getElementById('placeFollowUpTime').value;
    const crmNotes = document.getElementById('placeCrmNotes').value.trim();
    const tagsInput = document.getElementById('placeTags').value.trim();
    const tags = tagsInput ? tagsInput.split(',').map(t => t.trim()).filter(Boolean) : [];

    const isVisited = (crmStage === 'closed' || crmStage === 'negotiating' || crmStage === 'rejected');

    if (placeId) {
      // Edição
      const index = AppState.places.findIndex(p => p.id === placeId);
      if (index !== -1) {
        AppState.places[index] = {
          ...AppState.places[index],
          name, category, address, lat, lng, phone, whatsapp, hours, rating, photo, description, tags,
          cardMachine, crmStage, followUpDate, followUpTime, crmNotes,
          visited: isVisited,
          visitedAt: isVisited ? (AppState.places[index].visitedAt || new Date().toISOString()) : undefined
        };
        showToast('Local atualizado com sucesso!');
      }
    } else {
      // Novo
      const newPlace = {
        id: 'place-' + Date.now(),
        name, category, address, lat, lng, phone, whatsapp, hours, rating, photo, description, tags,
        cardMachine, crmStage, followUpDate, followUpTime, crmNotes,
        visited: isVisited,
        visitedAt: isVisited ? new Date().toISOString() : undefined
      };
      AppState.places.unshift(newPlace);
      showToast('Novo local cadastrado com sucesso!');
    }

    savePlaces();
    closePlaceModal();
    updateUI();

    if (placeId) {
      selectPlace(placeId, false);
    } else if (AppState.places.length > 0) {
      selectPlace(AppState.places[0].id, true);
    }
  });

  // Localização do Usuário (Geolocalização em Tempo Real Contínua)
  const locateMeBtn = document.getElementById('locateMeBtn');
  if (locateMeBtn) {
    locateMeBtn.addEventListener('click', () => {
      toggleLiveLocationTracking();
    });
  }

  // Troca de Estilos do Mapa
  document.querySelectorAll('.map-theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const theme = btn.dataset.tiles;
      if (theme === AppState.currentTileLayer) return;

      document.querySelectorAll('.map-theme-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      AppState.map.removeLayer(AppState.tileLayers[AppState.currentTileLayer]);
      AppState.tileLayers[theme].addTo(AppState.map);
      AppState.currentTileLayer = theme;
    });
  });

  // Menu de Opções de Dados (Exportar / Importar / Reset)
  const optionsBtn = document.getElementById('dataOptionsBtn');
  const dropdownMenu = document.getElementById('dataDropdownMenu');

  optionsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdownMenu.classList.toggle('show');
  });

  document.addEventListener('click', () => dropdownMenu.classList.remove('show'));

  // Baixar arquivo pronto 'default-places.json' para commit no Git
  const exportDefaultBtn = document.getElementById('exportDefaultPlacesBtn');
  if (exportDefaultBtn) {
    exportDefaultBtn.addEventListener('click', () => {
      const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(AppState.places, null, 2));
      const dlAnchor = document.createElement('a');
      dlAnchor.setAttribute('href', dataStr);
      dlAnchor.setAttribute('download', 'default-places.json');
      dlAnchor.click();
      showToast('Arquivo default-places.json gerado! Salve na pasta data/ e faça git push.');
    });
  }

  // Exportar Backup com Data (JSON)
  document.getElementById('exportDataBtn').addEventListener('click', () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(AppState.places, null, 2));
    const dlAnchor = document.createElement('a');
    dlAnchor.setAttribute('href', dataStr);
    dlAnchor.setAttribute('download', `citymap-backup-${new Date().toISOString().slice(0,10)}.json`);
    dlAnchor.click();
    showToast('Backup exportado com sucesso!');
  });

  // Importar Dados JSON
  const fileInput = document.getElementById('importFileInput');
  document.getElementById('triggerImportBtn').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const imported = JSON.parse(event.target.result);
          if (Array.isArray(imported)) {
            AppState.places = imported;
            savePlaces();
            updateUI();
            showToast(`${imported.length} locais importados com sucesso!`);
          } else {
            showToast('Formato de JSON inválido.');
          }
        } catch (err) {
          showToast('Erro ao ler arquivo JSON.');
        }
      };
      reader.readAsText(file);
    }
  });

  // Importar Planilha do Apify (XLSX / XLS / CSV)
  const apifyFileInput = document.getElementById('importApifyFileInput');
  document.getElementById('triggerApifyImportBtn').addEventListener('click', () => apifyFileInput.click());

  apifyFileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target.result);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json(worksheet);

        if (!rows || rows.length === 0) {
          showToast('Nenhum dado encontrado na planilha.');
          return;
        }

        const newPlaces = parseApifyRows(rows);
        if (newPlaces.length === 0) {
          showToast('Não foi possível identificar locais com coordenadas válidas.');
          return;
        }

        // Opção: perguntar se deseja mesclar ou substituir
        const replaceAll = confirm(`Foram encontrados ${newPlaces.length} locais na planilha do Apify!\n\nClique em OK para MESCLAR com os locais existentes ou CANCELAR para SUBSTITUIR tudo.`);
        
        if (replaceAll) {
          // Anti-duplicação inteligente: verifica se já existe por nome similar ou mesma coordenada (lat/lng)
          let addedCount = 0;
          let updatedCount = 0;

          newPlaces.forEach(newP => {
            const normalizedNewName = newP.name.toLowerCase().trim().replace(/[^a-z0-9]/gi, '');
            
            const existingIndex = AppState.places.findIndex(existingP => {
              const normalizedExistingName = existingP.name.toLowerCase().trim().replace(/[^a-z0-9]/gi, '');
              const sameCoords = Math.abs(existingP.lat - newP.lat) < 0.0001 && Math.abs(existingP.lng - newP.lng) < 0.0001;
              return normalizedNewName === normalizedExistingName || sameCoords;
            });

            if (existingIndex === -1) {
              // Não existe: Adiciona
              AppState.places.push(newP);
              addedCount++;
            } else {
              // Já existe: Atualiza dados complementares (telefone, foto, horários) sem duplicar o pin!
              AppState.places[existingIndex] = {
                ...AppState.places[existingIndex],
                ...newP,
                id: AppState.places[existingIndex].id // Mantém o ID original
              };
              updatedCount++;
            }
          });

          showToast(`${addedCount} novos locais adicionados e ${updatedCount} atualizados sem duplicação!`);
        } else {
          AppState.places = newPlaces;
          showToast(`${newPlaces.length} locais importados com sucesso!`);
        }

        savePlaces();
        updateUI();

        // Baixar automaticamente o default-places.json atualizado
        setTimeout(() => {
          const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(AppState.places, null, 2));
          const dlAnchor = document.createElement('a');
          dlAnchor.setAttribute('href', dataStr);
          dlAnchor.setAttribute('download', 'default-places.json');
          dlAnchor.click();
          showToast('✅ default-places.json baixado automaticamente! Só dar git push.');
        }, 800);

        // Centralizar o mapa no primeiro local importado
        if (AppState.places.length > 0) {
          AppState.map.flyTo([AppState.places[0].lat, AppState.places[0].lng], 13);
        }
      } catch (err) {
        console.error('Erro ao processar planilha Apify:', err);
        showToast('Erro ao processar arquivo XLSX do Apify.');
      } finally {
        apifyFileInput.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  });

  // Restaurar Padrões
  document.getElementById('resetDataBtn').addEventListener('click', async () => {
    if (confirm('Deseja restaurar a lista padrão de locais? Seus cadastros manuais serão substituídos.')) {
      localStorage.removeItem(STORAGE_KEY);
      await loadInitialPlaces();
      updateUI();
      showToast('Dados restaurados com sucesso!');
    }
  });
}

// --- PARSER DE DADOS DO APIFY (GOOGLE PLACES) ---
function parseApifyRows(rows) {
  const places = [];

  rows.forEach((row, idx) => {
    // 1. Coordenadas
    let lat = parseFloat(row['location/lat'] || row['lat'] || row['latitude'] || row['location.lat']);
    let lng = parseFloat(row['location/lng'] || row['lng'] || row['longitude'] || row['location.lng']);

    if (isNaN(lat) || isNaN(lng)) return; // Pula registros sem coordenadas

    // 2. Nome
    const name = row['title'] || row['name'] || `Local #${idx + 1}`;

    // 3. Categoria mapeada inteligentemente
    const rawCategory = (row['categoryName'] || row['category'] || '').trim();
    let category = 'servicos';
    const subCategory = rawCategory || 'Geral';

    if (/restaurante|bar|adega|lanchonete|café|cafe|hamburg|pizz|padaria|comida|açougue|acougue|sorvete/i.test(rawCategory)) {
      category = 'alimentacao';
    } else if (/loja|mercado|supermercado|comércio|comercio|shopping|boutique|farmácia|otica|celular|moda|roupa/i.test(rawCategory)) {
      category = 'comercio';
    } else if (/hospital|clínica|clinica|médic|medic|saúde|saude|dentista|laborat|farmacia/i.test(rawCategory)) {
      category = 'saude';
    } else if (/parque|praça|praca|cinema|teatro|hotel|pousada|clube|turism|museu|lazer|academia/i.test(rawCategory)) {
      category = 'lazer';
    }

    // 4. Endereço
    const address = row['address'] || row['street'] || row['formatted_address'] || 'Endereço não informado';

    // 5. Telefone e WhatsApp
    const phone = row['phone'] || row['phoneUnformatted'] || '';
    let whatsapp = '';
    if (phone) {
      const cleanPhone = phone.replace(/\D/g, '');
      if (cleanPhone.length >= 10) {
        whatsapp = cleanPhone.startsWith('55') ? cleanPhone : '55' + cleanPhone;
      }
    }

    // 6. Horário
    const hours = row['openingHours/0/hours'] || row['openingHours'] || '';

    // 7. Avaliação e Fotos
    const rating = row['totalScore'] ? parseFloat(row['totalScore']).toFixed(1) : (row['rating'] || '5.0');
    const photo = row['imageUrl'] || row['image'] || row['thumbnail'] || '';

    // 8. Descrição e Tags
    const website = row['website'] ? `Website: ${row['website']}` : '';
    const reviews = row['reviewsCount'] ? `${row['reviewsCount']} avaliações no Google` : '';
    const description = [rawCategory, reviews, website].filter(Boolean).join(' • ');

    const tags = [];
    if (rawCategory) tags.push(rawCategory);
    if (row['city']) tags.push(row['city']);
    if (row['neighborhood']) tags.push(row['neighborhood']);

    const cardMachine = row['cardMachine'] || row['maquininha'] || row['pos'] || '';
    const visited = row['visited'] === true || row['visited'] === 'true' || row['visitado'] === 'sim' || row['visitado'] === true;
    const crmNotes = row['crmNotes'] || row['notas'] || row['observacoes'] || '';

    places.push({
      id: 'apify-' + (row['id'] || Date.now() + '-' + idx),
      name: String(name).trim(),
      category,
      subCategory,
      address: String(address).trim(),
      lat,
      lng,
      phone: String(phone).trim(),
      whatsapp,
      hours: typeof hours === 'string' ? hours : '',
      rating: String(rating),
      photo: String(photo).trim(),
      description,
      cardMachine,
      visited,
      crmNotes,
      tags
    });
  });

  return places;
}

// --- UTILITÁRIOS: TOAST E ESCAPE HTML ---
function showToast(message) {
  const toast = document.getElementById('toast');
  toast.querySelector('.toast-message').textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3500);
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// --- RASTREAMENTO EM TEMPO REAL CONTÍNUO (LIVE GEOLOCATION) ---
function toggleLiveLocationTracking() {
  if (!('geolocation' in navigator)) {
    showToast('Geolocalização não é suportada pelo seu navegador.');
    return;
  }

  if (AppState.isTrackingLive) {
    if (AppState.userCoordinates) {
      AppState.map.flyTo(AppState.userCoordinates, Math.max(AppState.map.getZoom(), 16), {
        animate: true,
        duration: 1
      });
      if (AppState.userMarker) {
        AppState.userMarker.openPopup();
      }
      showToast('Centralizado na sua localização em tempo real!');
    }
  } else {
    startLiveLocationTracking(true);
  }
}

function startLiveLocationTracking(autoCenter = true) {
  if (!('geolocation' in navigator)) return;

  const locateBtn = document.getElementById('locateMeBtn');
  if (locateBtn) {
    locateBtn.classList.add('tracking-active');
    locateBtn.setAttribute('title', 'Rastreamento em tempo real ATIVO (Clique para centralizar)');
  }

  AppState.isTrackingLive = true;
  showToast('Iniciando rastreamento em tempo real...');

  const geoOptions = {
    enableHighAccuracy: true,
    maximumAge: 3000,
    timeout: 25000
  };

  if (AppState.userLocationWatchId !== null) {
    navigator.geolocation.clearWatch(AppState.userLocationWatchId);
  }

  let isFirstFix = true;

  AppState.userLocationWatchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      const isFirst = !AppState.userCoordinates;
      AppState.userCoordinates = [latitude, longitude];
      AppState.userAccuracy = accuracy;

      updateUserLocationMarker(latitude, longitude, accuracy);

      if (AppState.radiusFilter) {
        updateRadiusCircleOnMap();
        filterPlaces();
        renderPlacesList();
      }

      if (isFirst || (isFirstFix && autoCenter)) {
        AppState.map.flyTo([latitude, longitude], 16, { animate: true, duration: 1.2 });
        isFirstFix = false;
        showToast('Localização em tempo real sincronizada!');
      }
    },
    (err) => {
      console.error('Erro na geolocalização:', err);
      let msg = 'Não foi possível obter sua localização.';
      if (err.code === 1) { // PERMISSION_DENIED
        msg = 'Permissão de localização negada pelo navegador.';
        stopLiveLocationTracking();
      } else if (err.code === 2) { // POSITION_UNAVAILABLE
        msg = 'Sinal de GPS fraco ou indisponível.';
      } else if (err.code === 3) { // TIMEOUT
        msg = 'Tempo limite esgotado ao buscar sinal GPS.';
      }
      showToast(msg);
    },
    geoOptions
  );
}

function stopLiveLocationTracking() {
  if (AppState.userLocationWatchId !== null) {
    navigator.geolocation.clearWatch(AppState.userLocationWatchId);
    AppState.userLocationWatchId = null;
  }
  AppState.isTrackingLive = false;

  const locateBtn = document.getElementById('locateMeBtn');
  if (locateBtn) {
    locateBtn.classList.remove('tracking-active');
    locateBtn.setAttribute('title', 'Minha Localização (Ativar tempo real)');
  }
}

function updateUserLocationMarker(lat, lng, accuracy) {
  const customIcon = L.divIcon({
    className: 'user-location-icon-wrapper',
    html: `
      <div class="user-live-location-pin">
        <div class="user-live-location-pulse"></div>
        <div class="user-live-location-core"></div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  });

  const nowTime = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const accText = accuracy ? `~${Math.round(accuracy)}m` : 'Precisão alta';

  const popupContent = `
    <div style="font-family: inherit; font-size: 0.85rem; line-height: 1.45; color: #0f172a; padding: 3px 2px;">
      <div style="display:flex; align-items:center; gap: 6px; font-weight: 700; color: #2563eb; margin-bottom: 4px;">
        <span style="display:inline-block; width:9px; height:9px; background:#10b981; border-radius:50%; box-shadow: 0 0 8px #10b981;"></span>
        Você está aqui
      </div>
      <div style="font-size: 0.74rem; color: #475569;">
        <strong>Status:</strong> Em tempo real 🟢<br>
        <strong>Precisão GPS:</strong> ${accText}<br>
        <strong>Última atualização:</strong> ${nowTime}
      </div>
    </div>
  `;

  if (!AppState.userMarker) {
    AppState.userMarker = L.marker([lat, lng], {
      icon: customIcon,
      zIndexOffset: 1000
    }).addTo(AppState.map);

    AppState.userMarker.bindPopup(popupContent);
  } else {
    AppState.userMarker.setLatLng([lat, lng]);
    AppState.userMarker.setIcon(customIcon);
    AppState.userMarker.setPopupContent(popupContent);
  }

  if (accuracy && accuracy > 0) {
    if (!AppState.userAccuracyCircle) {
      AppState.userAccuracyCircle = L.circle([lat, lng], {
        radius: accuracy,
        color: '#3b82f6',
        fillColor: '#3b82f6',
        fillOpacity: 0.1,
        weight: 1.5,
        interactive: false
      }).addTo(AppState.map);
    } else {
      AppState.userAccuracyCircle.setLatLng([lat, lng]);
      AppState.userAccuracyCircle.setRadius(accuracy);
    }
  }
}

// --- AÇÕES GLOBAIS CRM (FUNIL, RETORNOS, DISTÂNCIA & MAQUININHA) ---

// 1. Mudança de estágio no Funil
window.setPlaceCrmStage = function(placeId, stage) {
  const place = AppState.places.find(p => p.id === placeId);
  if (!place) return;

  place.crmStage = stage;
  place.visited = (stage === 'closed' || stage === 'negotiating' || stage === 'rejected');

  if (place.visited && !place.visitedAt) {
    place.visitedAt = new Date().toISOString();
  } else if (!place.visited) {
    delete place.visitedAt;
  }

  savePlaces();
  updateUI();

  const labels = {
    lead: 'Lead (A Visitar)',
    negotiating: 'Em Negociação',
    closed: 'Fechado / Ganho ✔',
    rejected: 'Sem Interesse'
  };

  showToast(`Estágio alterado para: ${labels[stage] || stage}`);

  // Se o filtro ativo for diferente do estágio novo, pode fechar ou atualizar o drawer
  if (AppState.crmStageFilter !== 'all' && AppState.crmStageFilter !== stage && !(AppState.crmStageFilter === 'follow_up' && place.followUpDate)) {
    document.getElementById('placeDetailDrawer').classList.remove('open');
    showToast(`Local movido para a aba "${labels[stage] || stage}".`);
  } else {
    selectPlace(placeId, false);
  }
};

// 2. Agendamento de Retorno (Follow-up)
window.savePlaceFollowUp = function(placeId) {
  const place = AppState.places.find(p => p.id === placeId);
  if (!place) return;

  const dateInput = document.getElementById('drawerFollowUpDate');
  const timeInput = document.getElementById('drawerFollowUpTime');

  if (dateInput) place.followUpDate = dateInput.value;
  if (timeInput) place.followUpTime = timeInput.value;

  savePlaces();
  updateUI();
  showToast(`Retorno agendado para ${place.followUpDate} ${place.followUpTime || ''}`);
};

window.setQuickFollowUp = function(placeId, addDays, defaultTime = '10:00') {
  const place = AppState.places.find(p => p.id === placeId);
  if (!place) return;

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + addDays);
  const yyyy = targetDate.getFullYear();
  const mm = String(targetDate.getMonth() + 1).padStart(2, '0');
  const dd = String(targetDate.getDate()).padStart(2, '0');
  
  place.followUpDate = `${yyyy}-${mm}-${dd}`;
  place.followUpTime = defaultTime;

  savePlaces();
  updateUI();
  selectPlace(placeId, false);
  showToast(`Retorno agendado para ${dd}/${mm} às ${defaultTime}!`);
};

window.clearPlaceFollowUp = function(placeId) {
  const place = AppState.places.find(p => p.id === placeId);
  if (!place) return;

  delete place.followUpDate;
  delete place.followUpTime;
  delete place.followUpNotes;

  savePlaces();
  updateUI();
  selectPlace(placeId, false);
  showToast('Agendamento de retorno cancelado.');
};

window.savePlaceFollowUpNotes = function(placeId, notes) {
  const place = AppState.places.find(p => p.id === placeId);
  if (!place) return;

  place.followUpNotes = notes;
  savePlaces();
};

window.updatePlaceCardMachine = function(placeId, machine) {
  const place = AppState.places.find(p => p.id === placeId);
  if (!place) return;

  place.cardMachine = machine;
  savePlaces();
  updateUI();
  showToast(`Maquininha atualizada para: ${machine || 'Não Informado'}`);
};

window.savePlaceCrmNotes = function(placeId, notes) {
  const place = AppState.places.find(p => p.id === placeId);
  if (!place) return;

  if (place.crmNotes !== notes) {
    place.crmNotes = notes;
    savePlaces();
    showToast('Anotações de negociação salvas!');
  }
};

// 3. Status de Retorno Helper
function getFollowUpStatus(place) {
  if (!place || !place.followUpDate) {
    return { isScheduled: false, isToday: false, isOverdue: false, isUpcoming: false, label: '' };
  }

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  
  const [y, m, d] = place.followUpDate.split('-').map(Number);
  const followUpDateObj = new Date(y, m - 1, d);
  const todayDateObj = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  const diffDays = Math.round((followUpDateObj - todayDateObj) / (1000 * 60 * 60 * 24));
  const timeText = place.followUpTime ? ` às ${place.followUpTime}` : '';

  if (diffDays === 0) {
    return { isScheduled: true, isToday: true, isOverdue: false, isUpcoming: false, label: `Retorno Hoje${timeText}` };
  } else if (diffDays === 1) {
    return { isScheduled: true, isToday: false, isOverdue: false, isUpcoming: true, label: `Retorno Amanhã${timeText}` };
  } else if (diffDays > 1) {
    return { isScheduled: true, isToday: false, isOverdue: false, isUpcoming: true, label: `Retorno em ${diffDays}d${timeText}` };
  } else {
    return { isScheduled: true, isToday: false, isOverdue: true, isUpcoming: false, label: `Retorno Atrasado (${Math.abs(diffDays)}d)` };
  }
}

// 4. Banner de Alerta de Retornos no Topo do Mapa
function checkTodayFollowUpsBanner() {
  const alertBanner = document.getElementById('mapFollowUpAlert');
  const alertText = document.getElementById('followUpAlertText');
  if (!alertBanner || !alertText) return;

  const duePlaces = AppState.places.filter(p => {
    const st = getFollowUpStatus(p);
    return st.isToday || st.isOverdue;
  });

  if (duePlaces.length > 0) {
    alertText.textContent = `🔔 Você tem ${duePlaces.length} ${duePlaces.length === 1 ? 'retorno agendado' : 'retornos agendados'} para hoje!`;
    alertBanner.style.display = 'flex';
  } else {
    alertBanner.style.display = 'none';
  }
}

window.showTodayFollowUps = function() {
  document.querySelectorAll('#crmStatusTabs .crm-tab').forEach(t => t.classList.remove('active'));
  const folTab = document.querySelector('#crmStatusTabs .crm-tab[data-stage="follow_up"]');
  if (folTab) folTab.classList.add('active');
  AppState.crmStageFilter = 'follow_up';
  updateUI();

  // Centralizar no primeiro retorno
  if (AppState.filteredPlaces.length > 0) {
    AppState.map.flyTo([AppState.filteredPlaces[0].lat, AppState.filteredPlaces[0].lng], 15);
    selectPlace(AppState.filteredPlaces[0].id, false);
  }
  showToast('Mostrando retornos agendados!');
};

// 5. Filtro de Raio de Distância (GPS)
window.setDistanceRadius = function(radiusKm) {
  AppState.radiusFilter = radiusKm;

  const labelEl = document.getElementById('radiusCurrentVal');
  if (labelEl) {
    if (!radiusKm) {
      labelEl.textContent = 'Sem limite';
    } else if (radiusKm < 1) {
      labelEl.textContent = `${radiusKm * 1000}m`;
    } else {
      labelEl.textContent = `${radiusKm} km`;
    }
  }

  // Se o usuário ainda não tiver localização obtida, tenta iniciar o rastreamento
  if (radiusKm && !AppState.userCoordinates) {
    showToast('Obtendo seu GPS para calcular raio de distância...');
    startLiveLocationTracking(false);
  }

  // Atualizar círculo no mapa sem resetar zoom do usuário
  updateRadiusCircleOnMap(false);

  updateUI();
};

function updateRadiusCircleOnMap(autoFit = false) {
  if (!AppState.map) return;

  if (!AppState.radiusFilter || !AppState.userCoordinates) {
    if (AppState.radiusCircle) {
      AppState.map.removeLayer(AppState.radiusCircle);
      AppState.radiusCircle = null;
    }
    return;
  }

  const radiusMeters = AppState.radiusFilter * 1000;

  if (!AppState.radiusCircle) {
    AppState.radiusCircle = L.circle(AppState.userCoordinates, {
      radius: radiusMeters,
      color: '#38bdf8',
      fillColor: '#38bdf8',
      fillOpacity: 0.08,
      weight: 2,
      dashArray: '5, 8',
      interactive: false
    }).addTo(AppState.map);
  } else {
    AppState.radiusCircle.setLatLng(AppState.userCoordinates);
    AppState.radiusCircle.setRadius(radiusMeters);
  }

  if (autoFit && AppState.radiusCircle) {
    AppState.map.fitBounds(AppState.radiusCircle.getBounds(), { padding: [40, 40], maxZoom: 16 });
  }
}

// 6. Cálculo de Distância Haversine (km)
function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  const R = 6371; // Raio da Terra em km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function formatDistance(meters) {
  if (meters === undefined || meters === null || isNaN(meters)) return '';
  if (meters < 1000) {
    return `${Math.round(meters)}m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

// --- VERIFICADOR DE STATUS DE FUNCIONAMENTO EM TEMPO REAL ---
function getPlaceOpenStatus(place, refDate = new Date()) {
  if (!place || !place.hours || typeof place.hours !== 'string' || !place.hours.trim()) {
    return {
      isOpen: true,
      isUnknown: true,
      statusText: 'Horário a consultar',
      hoursText: ''
    };
  }

  const raw = place.hours.trim();
  const lower = raw.toLowerCase();

  // 1. Casos 24 horas
  if (lower.includes('24h') || lower.includes('24 horas') || lower.includes('24 hours') || lower.includes('aberto 24')) {
    return {
      isOpen: true,
      isUnknown: false,
      statusText: 'Aberto 24 horas',
      hoursText: raw
    };
  }

  // 2. Fechado explícito
  if (lower === 'fechado' || lower === 'closed' || lower === 'fechado temporariamente') {
    return {
      isOpen: false,
      isUnknown: false,
      statusText: 'Fechado no momento',
      hoursText: raw
    };
  }

  // Obter hora e minuto atuais
  const currentMinutes = refDate.getHours() * 60 + refDate.getMinutes();
  const currentDayOfWeek = refDate.getDay(); // 0 = Dom, 1 = Seg, 2 = Ter, 3 = Qua, 4 = Qui, 5 = Sex, 6 = Sab

  const dayNamesPt = ['domingo', 'segunda', 'terça', 'terca', 'quarta', 'quinta', 'sexta', 'sábado', 'sabado'];
  const dayAbbrPt = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb', 'sab'];

  // Verificar se hoje está explicitamente marcado como fechado em textos com múltiplos dias
  if (lower.includes('seg') || lower.includes('dom') || lower.includes('sab') || lower.includes('segunda')) {
    const todayName = dayNamesPt[currentDayOfWeek === 0 ? 0 : currentDayOfWeek === 6 ? 7 : currentDayOfWeek];
    const todayAbbr = dayAbbrPt[currentDayOfWeek];
    
    const lines = raw.split(/[\n;|\/]/);
    for (const line of lines) {
      const lineLower = line.toLowerCase();
      if (lineLower.includes(todayName) || lineLower.includes(todayAbbr)) {
        if (lineLower.includes('fechado') || lineLower.includes('closed')) {
          return {
            isOpen: false,
            isUnknown: false,
            statusText: 'Fechado no momento (Fechado hoje)',
            hoursText: line.trim()
          };
        }
      }
    }
  }

  // Regex para intervalos de horários: "16:00 to 03:00", "08:00 às 18:00", "08h às 18h", "8:00 - 18:00", etc.
  const timeRangeRegex = /(\d{1,2})(?::(\d{2})|h(?:(\d{2}))?)?\s*(?:to|até|ate|as|às|-|–|a)\s*(\d{1,2})(?::(\d{2})|h(?:(\d{2}))?)?/gi;

  let matches = [];
  let m;

  while ((m = timeRangeRegex.exec(raw)) !== null) {
    const startH = parseInt(m[1], 10);
    const startM = parseInt(m[2] || m[3] || '0', 10);
    const endH = parseInt(m[4], 10);
    const endM = parseInt(m[5] || m[6] || '0', 10);

    const startTotalMin = startH * 60 + startM;
    const endTotalMin = endH * 60 + endM;

    matches.push({
      startTotalMin,
      endTotalMin,
      startFormatted: `${String(startH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`,
      endFormatted: `${String(endH).padStart(2, '0')}:${String(endM).padStart(2, '0')}`
    });
  }

  // Fallback caso não tenha separado por "to" ou "-", mas tenha horários soltos
  if (matches.length === 0) {
    const simpleTimes = [];
    const simpleTimeRegex = /\b(\d{1,2}):(\d{2})\b/g;
    let st;
    while ((st = simpleTimeRegex.exec(raw)) !== null) {
      const h = parseInt(st[1], 10);
      const min = parseInt(st[2], 10);
      simpleTimes.push(h * 60 + min);
    }
    if (simpleTimes.length >= 2) {
      for (let i = 0; i < simpleTimes.length - 1; i += 2) {
        matches.push({
          startTotalMin: simpleTimes[i],
          endTotalMin: simpleTimes[i + 1],
          startFormatted: `${String(Math.floor(simpleTimes[i] / 60)).padStart(2, '0')}:${String(simpleTimes[i] % 60).padStart(2, '0')}`,
          endFormatted: `${String(Math.floor(simpleTimes[i + 1] / 60)).padStart(2, '0')}:${String(simpleTimes[i + 1] % 60).padStart(2, '0')}`
        });
      }
    }
  }

  if (matches.length === 0) {
    return {
      isOpen: true,
      isUnknown: true,
      statusText: 'Horário a consultar',
      hoursText: raw
    };
  }

  // Avaliar se o horário atual está dentro de algum dos intervalos
  let isCurrentlyOpen = false;
  let matchingInterval = null;

  for (const interval of matches) {
    const { startTotalMin, endTotalMin } = interval;

    if (startTotalMin <= endTotalMin) {
      // Mesmo dia (ex: 08:00 às 18:00)
      if (currentMinutes >= startTotalMin && currentMinutes < endTotalMin) {
        isCurrentlyOpen = true;
        matchingInterval = interval;
        break;
      }
    } else {
      // Vira a noite (ex: 16:00 às 03:00)
      if (currentMinutes >= startTotalMin || currentMinutes < endTotalMin) {
        isCurrentlyOpen = true;
        matchingInterval = interval;
        break;
      }
    }
  }

  if (isCurrentlyOpen) {
    return {
      isOpen: true,
      isUnknown: false,
      statusText: `Aberto agora • Fecha às ${matchingInterval.endFormatted}`,
      hoursText: raw
    };
  } else {
    const nextStart = matches[0].startFormatted;
    return {
      isOpen: false,
      isUnknown: false,
      statusText: `Fechado no momento • Abre às ${nextStart}`,
      hoursText: raw
    };
  }
}
