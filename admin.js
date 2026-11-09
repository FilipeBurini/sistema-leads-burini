/**
 * ADMIN DASHBOARD MASTER - LOGIC & ANALYTICS
 * CityMap Hub - Mapeador Urbano & CRM
 */

const AdminApp = {
  places: [],
  interactions: [],
  currentUser: null,

  async init() {
    // 1. Inicializar Supabase
    CloudSync.init();

    // 2. Auth Guard: Verificar se é Administrador Master
    await this.verifyAdminAccess();

    // 3. Carregar dados de Leads
    await this.loadData();

    // 4. Calcular e Renderizar Métricas
    this.renderKPIs();
    this.renderMarketShare();
    this.renderCommercialSegments();
    this.renderRecentLeadsTable();
    this.renderLeadDistributionKPIs();

    // 5. Carregar Gestão de Usuários e Feed de Auditoria
    await this.loadSystemUsers();
    await this.loadAuditFeed();

    // 6. Carregar Base de CNPJs Oficiais (Receita Federal / Fichário)
    await this.loadCnpjLeads();
    this.setupCnpjFilters();

    // 7. Configurar Event Listeners das Ferramentas Master
    this.setupEventListeners();
    this.setupRealtimeSync();
  },

  async verifyAdminAccess() {
    if (!CloudSync.client) {
      // Se nem o cliente foi inicializado, redireciona para login
      window.location.href = 'login.html';
      return;
    }

    try {
      const { data } = await CloudSync.client.auth.getSession();
      const user = data?.session?.user;

      if (!user) {
        alert('Acesso restrito. Faça login como administrador para acessar este painel.');
        window.location.href = 'login.html';
        return;
      }

      this.currentUser = user;

      // Verificar se é Admin
      const isAdmin = CloudSync.isAdmin ? CloudSync.isAdmin(user) : false;
      if (!isAdmin) {
        alert('Acesso negado: Este painel é exclusivo para o Administrador Master.');
        window.location.href = 'index.html';
        return;
      }

      // Atualizar tag de usuário na navbar
      const userEmailEl = document.getElementById('navUserEmail');
      if (userEmailEl) userEmailEl.textContent = user.email || 'Admin Master';

    } catch (e) {
      console.error('Erro na verificação de acesso:', e);
      window.location.href = 'login.html';
    }
  },

  async loadData() {
    const statusText = document.getElementById('cloudSyncStatusText');
    if (statusText) statusText.textContent = 'Carregando dados...';

    // 1. Tentar buscar da nuvem (Supabase) - Master sempre puxa todos os registros
    if (CloudSync.isConfigured && this.currentUser) {
      try {
        const cloudLeads = await CloudSync.fetchAllLeads(true);
        if (cloudLeads && cloudLeads.length > 0) {
          this.places = cloudLeads;
          if (statusText) statusText.textContent = `Nuvem Ativa (${cloudLeads.length} leads sincronizados)`;
          return;
        }
      } catch (err) {
        console.warn('Erro ao carregar dados do Supabase:', err);
      }
    }

    // 2. Fallback: LocalStorage
    const saved = localStorage.getItem('citymap_places_data_v3');
    if (saved) {
      try {
        this.places = JSON.parse(saved);
        if (statusText) statusText.textContent = `Base Local (${this.places.length} leads)`;
        return;
      } catch (e) {
        console.warn('Erro ao ler localStorage:', e);
      }
    }

    // 3. Fallback: window.DEFAULT_PLACES_DATA
    if (window.DEFAULT_PLACES_DATA && Array.isArray(window.DEFAULT_PLACES_DATA)) {
      this.places = window.DEFAULT_PLACES_DATA;
      if (statusText) statusText.textContent = `Base Padrão (${this.places.length} leads)`;
    }
  },

  renderKPIs() {
    const total = this.places.length;
    let leadsCount = 0;
    let negotiatingCount = 0;
    let closedCount = 0;
    let followUpDueCount = 0;

    const todayStr = new Date().toISOString().split('T')[0];

    this.places.forEach(p => {
      const stage = p.crmStage || (p.visited ? 'negotiating' : 'lead');
      if (stage === 'lead') leadsCount++;
      else if (stage === 'negotiating') negotiatingCount++;
      else if (stage === 'closed') closedCount++;

      if (p.followUpDate) {
        if (p.followUpDate <= todayStr) {
          followUpDueCount++;
        }
      }
    });

    const conversionRate = total > 0 ? ((closedCount / (total - leadsCount || 1)) * 100).toFixed(1) : 0;

    // Atualizar elementos no DOM
    this.animateCounter('kpiTotalLeads', total);
    this.animateCounter('kpiPendingLeads', leadsCount);
    this.animateCounter('kpiNegotiatingLeads', negotiatingCount);
    this.animateCounter('kpiClosedLeads', closedCount);
    this.animateCounter('kpiFollowUpsDue', followUpDueCount);

    const conversionEl = document.getElementById('kpiConversionRate');
    if (conversionEl) conversionEl.textContent = `${conversionRate}% de conversão`;

    const subTotalEl = document.getElementById('kpiSubTotalText');
    if (subTotalEl) subTotalEl.textContent = `${total.toLocaleString('pt-BR')} empresas mapeadas`;
  },

  renderMarketShare() {
    const container = document.getElementById('marketShareList');
    if (!container) return;

    const counts = {};
    const machinesList = ['Stone', 'Cielo', 'Rede', 'PagBank', 'InfinitePay', 'Ton', 'Mercado Pago', 'Getnet', 'SafraPay', 'C6 Bank', 'Outra', 'Não Informado'];
    
    machinesList.forEach(m => counts[m] = 0);

    let informedTotal = 0;

    this.places.forEach(p => {
      const machine = p.cardMachine && p.cardMachine.trim() ? p.cardMachine.trim() : 'Não Informado';
      counts[machine] = (counts[machine] || 0) + 1;
      if (machine !== 'Não Informado') informedTotal++;
    });

    // Ordena do mais comum para o menos comum
    const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    const colors = {
      'Stone': '#10b981',
      'Cielo': '#0284c7',
      'Rede': '#ea580c',
      'PagBank': '#eab308',
      'InfinitePay': '#6366f1',
      'Ton': '#22c55e',
      'Mercado Pago': '#06b6d4',
      'Getnet': '#e11d48',
      'SafraPay': '#d97706',
      'C6 Bank': '#475569',
      'Outra': '#8b5cf6',
      'Não Informado': '#64748b'
    };

    container.innerHTML = sorted.map(([name, count]) => {
      const percent = this.places.length > 0 ? ((count / this.places.length) * 100).toFixed(1) : 0;
      const barColor = colors[name] || '#f59e0b';

      return `
        <div class="market-item">
          <div class="market-item-top">
            <span class="market-item-name">
              <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${barColor};"></span>
              ${name}
            </span>
            <span class="market-item-stats"><strong>${count}</strong> (${percent}%)</span>
          </div>
          <div class="market-progress-track">
            <div class="market-progress-fill" style="width: ${percent}%; background: ${barColor};"></div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderCommercialSegments() {
    const container = document.getElementById('commercialSegmentsList');
    if (!container) return;

    const segments = {
      novo_cnpj: { name: 'Novos CNPJs Abertos', count: 0, color: '#38bdf8' },
      adega: { name: 'Adegas & Depósitos', count: 0, color: '#9333ea' },
      bar: { name: 'Bares & Choperias', count: 0, color: '#f59e0b' },
      restaurante: { name: 'Restaurantes & Lanches', count: 0, color: '#ef4444' },
      padaria: { name: 'Padarias & Confeitarias', count: 0, color: '#eab308' },
      mercado_bairro: { name: 'Mercados de Bairro', count: 0, color: '#10b981' },
      outro: { name: 'Outros Estabelecimentos', count: 0, color: '#64748b' }
    };

    this.places.forEach(p => {
      const seg = p.commercialSegment || 'outro';
      if (segments[seg]) segments[seg].count++;
      else segments.outro.count++;
    });

    const sorted = Object.values(segments).sort((a, b) => b.count - a.count);

    container.innerHTML = sorted.map(s => {
      const percent = this.places.length > 0 ? ((s.count / this.places.length) * 100).toFixed(1) : 0;
      return `
        <div class="market-item">
          <div class="market-item-top">
            <span class="market-item-name">
              <span style="display:inline-block; width:10px; height:10px; border-radius:50%; background:${s.color};"></span>
              ${s.name}
            </span>
            <span class="market-item-stats"><strong>${s.count}</strong> (${percent}%)</span>
          </div>
          <div class="market-progress-track">
            <div class="market-progress-fill" style="width: ${percent}%; background: ${s.color};"></div>
          </div>
        </div>
      `;
    }).join('');
  },

  renderRecentLeadsTable(filterText = '') {
    const tbody = document.getElementById('recentLeadsTableBody');
    if (!tbody) return;

    let list = this.places;
    if (filterText.trim()) {
      const q = filterText.toLowerCase();
      list = list.filter(p => 
        (p.name && p.name.toLowerCase().includes(q)) ||
        (p.address && p.address.toLowerCase().includes(q)) ||
        (p.cnpj && p.cnpj.includes(q))
      );
    }

    // Limita aos primeiros 15 resultados
    const slice = list.slice(0, 15);

    if (slice.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:2rem;">Nenhum lead encontrado com esse termo.</td></tr>`;
      return;
    }

    const stageLabels = {
      lead: '<span style="color:#94a3b8;">A Visitar</span>',
      negotiating: '<span style="color:#f59e0b; font-weight:700;">Em Negociação</span>',
      closed: '<span style="color:#10b981; font-weight:700;">Fechado ✔</span>',
      rejected: '<span style="color:#f43f5e;">Sem Interesse</span>'
    };

    tbody.innerHTML = slice.map(p => `
      <tr>
        <td class="lead-name-cell">${p.name || 'Sem nome'}</td>
        <td><span class="lead-cnpj-badge">${p.cnpj || 'N/D'}</span></td>
        <td>${p.commercialSegment || 'Outro'}</td>
        <td>${p.cardMachine || '<span style="color:#64748b;">Não Informado</span>'}</td>
        <td>${stageLabels[p.crmStage] || stageLabels.lead}</td>
        <td>${p.phone || p.whatsapp || '<span style="color:#64748b;">—</span>'}</td>
      </tr>
    `).join('');
  },

  // --- GESTÃO DE USUÁRIOS E APROVAÇÕES ---

  async loadSystemUsers() {
    const tbody = document.getElementById('systemUsersTableBody');
    if (!tbody) return;

    if (!CloudSync.isConfigured || !CloudSync.client) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:1.5rem;">Nuvem não conectada. Conecte ao Supabase para gerenciar aprovações de equipe.</td></tr>`;
      return;
    }

    try {
      this.systemUsers = await CloudSync.fetchSystemUsers();
      this.renderSystemUsersTable();
    } catch (e) {
      console.warn('Erro ao carregar usuários:', e);
    }
  },

  renderSystemUsersTable() {
    const tbody = document.getElementById('systemUsersTableBody');
    if (!tbody) return;

    let pendingCount = 0;
    let approvedCount = 0;

    (this.systemUsers || []).forEach(u => {
      if (u.status === 'pending') pendingCount++;
      else if (u.status === 'approved') approvedCount++;
    });

    const pendingBadge = document.getElementById('badgePendingUsersCount');
    if (pendingBadge) {
      pendingBadge.textContent = `⏳ ${pendingCount} ${pendingCount === 1 ? 'Pendente' : 'Pendentes'}`;
      if (pendingCount > 0) {
        pendingBadge.classList.add('has-pending');
      } else {
        pendingBadge.classList.remove('has-pending');
      }
    }

    const approvedBadge = document.getElementById('badgeApprovedUsersCount');
    if (approvedBadge) {
      approvedBadge.textContent = `✅ ${approvedCount} ${approvedCount === 1 ? 'Aprovado' : 'Aprovados'}`;
    }

    if (!this.systemUsers || this.systemUsers.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; color:#94a3b8; padding:1.5rem;">Nenhum usuário registrado além do Administrador Master. Novos cadastros aparecerão aqui automaticamente!</td></tr>`;
      return;
    }

    // Lista de Supervisores para alimentar o select dos agentes
    const supervisors = this.systemUsers.filter(u => u.role === 'supervisor' && u.status === 'approved');

    tbody.innerHTML = this.systemUsers.map(u => {
      const isMasterAdmin = (window.SUPABASE_CONFIG?.adminEmails || []).includes(u.email) || u.role === 'master' || u.role === 'admin';
      const createdDate = u.created_at ? new Date(u.created_at).toLocaleDateString('pt-BR') : '—';
      const name = u.full_name || 'Sem nome informado';

      let currentRole = u.role || 'agent';
      if (currentRole === 'seller') currentRole = 'agent';
      if (currentRole === 'admin') currentRole = 'master';

      let roleSelector = '';
      let supervisorSelector = '';
      let statusBadge = '';
      let actionButtons = '';

      if (isMasterAdmin) {
        roleSelector = `<span style="font-size:0.75rem; color:#fbbf24; font-weight:700;">👑 Master</span>`;
        supervisorSelector = `<span style="color:#64748b; font-size:0.75rem;">— (Direção Geral)</span>`;
        statusBadge = `<span class="status-pill status-approved">👑 Ativo</span>`;
        actionButtons = `<span style="font-size:0.75rem; color:#fbbf24; font-weight:700;">Conta Master</span>`;
      } else {
        // Seletor de Cargo Dinâmico
        roleSelector = `
          <select onchange="AdminApp.handleRoleChange('${u.id}', this.value)" style="background:#0b1120; border:1px solid var(--border-color); color:#fff; border-radius:4px; padding:3px 6px; font-size:0.75rem; cursor:pointer;">
            <option value="agent" ${currentRole === 'agent' ? 'selected' : ''}>👤 Agente Comercial</option>
            <option value="supervisor" ${currentRole === 'supervisor' ? 'selected' : ''}>👔 Supervisor de Vendas</option>
            <option value="master" ${currentRole === 'master' ? 'selected' : ''}>👑 Administrador Master</option>
          </select>
        `;

        // Seletor de Supervisor Designado
        if (currentRole === 'agent') {
          supervisorSelector = `
            <select onchange="AdminApp.handleSupervisorChange('${u.id}', this.value)" style="background:#0b1120; border:1px solid var(--border-color); color:#38bdf8; border-radius:4px; padding:3px 6px; font-size:0.75rem; cursor:pointer; max-width:180px;">
              <option value="">— Sem Supervisor (Master) —</option>
              ${supervisors.map(s => `
                <option value="${s.id}" ${u.supervisor_id === s.id ? 'selected' : ''}>👔 ${s.full_name || s.email.split('@')[0]}</option>
              `).join('')}
            </select>
          `;
        } else {
          supervisorSelector = `<span style="color:#64748b; font-size:0.75rem;">— (Gestão Direta)</span>`;
        }

        if (u.status === 'pending') {
          statusBadge = `<span class="status-pill status-pending">⏳ Aguardando</span>`;
          actionButtons = `
            <button type="button" class="btn-action-user btn-approve" onclick="AdminApp.handleUpdateUserStatus('${u.id}', 'approved', '${u.email}')">
              <i class="ri-check-line"></i> Aprovar
            </button>
            <button type="button" class="btn-action-user btn-reject" onclick="AdminApp.handleUpdateUserStatus('${u.id}', 'rejected', '${u.email}')">
              <i class="ri-close-line"></i> Recusar
            </button>
          `;
        } else if (u.status === 'approved') {
          statusBadge = `<span class="status-pill status-approved">✅ Liberado</span>`;
          actionButtons = `
            <button type="button" class="btn-action-user btn-reject" onclick="AdminApp.handleUpdateUserStatus('${u.id}', 'rejected', '${u.email}')" title="Bloquear acesso deste usuário">
              <i class="ri-forbid-2-line"></i> Bloquear
            </button>
          `;
        } else if (u.status === 'rejected') {
          statusBadge = `<span class="status-pill status-rejected">🚫 Recusado</span>`;
          actionButtons = `
            <button type="button" class="btn-action-user btn-approve" onclick="AdminApp.handleUpdateUserStatus('${u.id}', 'approved', '${u.email}')" title="Reativar acesso">
              <i class="ri-restart-line"></i> Liberar
            </button>
          `;
        }
      }

      return `
        <tr>
          <td><strong>${name}</strong></td>
          <td>${u.email}</td>
          <td>${roleSelector}</td>
          <td>${supervisorSelector}</td>
          <td>${statusBadge}</td>
          <td style="text-align: right;">${actionButtons}</td>
        </tr>
      `;
    }).join('');

    // Atualizar dropdown de distribuição de carteiras
    this.populateAgentDropdown();
  },

  async handleRoleChange(userId, newRole) {
    try {
      await CloudSync.updateUserRoleAndSupervisor(userId, newRole, null);
      const target = (this.systemUsers || []).find(u => u.id === userId);
      if (target) {
        target.role = newRole;
        if (newRole !== 'agent') target.supervisor_id = null;
      }
      this.renderSystemUsersTable();
      await CloudSync.recordInteraction('SISTEMA', 'role_change', `Cargo de usuário alterado para: ${newRole}`);
    } catch (e) {
      alert('Erro ao alterar cargo: ' + (e.message || e));
    }
  },

  async handleSupervisorChange(userId, supervisorId) {
    try {
      await CloudSync.updateUserRoleAndSupervisor(userId, 'agent', supervisorId || null);
      const target = (this.systemUsers || []).find(u => u.id === userId);
      if (target) {
        target.supervisor_id = supervisorId || null;
      }
      this.renderSystemUsersTable();
      await CloudSync.recordInteraction('SISTEMA', 'supervisor_assignment', `Agente vinculado a supervisor: ${supervisorId || 'Master'}`);
    } catch (e) {
      alert('Erro ao vincular supervisor: ' + (e.message || e));
    }
  },

  // --- DISTRIBUIÇÃO DE LEADS & GESTÃO DE CARTEIRAS ---

  renderLeadDistributionKPIs() {
    let unassigned = 0;
    let supervised = 0;
    let assignedAgent = 0;

    (this.places || []).forEach(p => {
      if (p.assignedTo) {
        assignedAgent++;
      } else if (p.assignedSupervisorId) {
        supervised++;
      } else {
        unassigned++;
      }
    });

    this.animateCounter('kpiUnassignedLeads', unassigned);
    this.animateCounter('kpiSupervisedLeads', supervised);
    this.animateCounter('kpiAssignedAgentLeads', assignedAgent);

    const poolBadge = document.getElementById('leadsPoolBadge');
    if (poolBadge) {
      poolBadge.textContent = `🌐 ${unassigned} no Pool Geral`;
    }
  },

  populateAgentDropdown() {
    const select = document.getElementById('distSelectAgent');
    if (!select) return;

    const agents = (this.systemUsers || []).filter(u => (u.role === 'agent' || u.role === 'seller') && u.status === 'approved');
    const supervisorsMap = new Map((this.systemUsers || []).map(u => [u.id, u.full_name || u.email.split('@')[0]]));

    if (agents.length === 0) {
      select.innerHTML = '<option value="">Nenhum Agente Comercial aprovado</option>';
      return;
    }

    select.innerHTML = '<option value="">Selecione um Agente...</option>' + agents.map(a => {
      const supName = a.supervisor_id ? supervisorsMap.get(a.supervisor_id) || 'Supervisor' : 'Master Direto';
      return `<option value="${a.id}">👤 ${a.full_name || a.email} (Sup: ${supName})</option>`;
    }).join('');
  },

  async handleBatchAssign() {
    const selectAgent = document.getElementById('distSelectAgent');
    const selectSegment = document.getElementById('distFilterSegment');
    const selectLimit = document.getElementById('distFilterLimit');
    const feedback = document.getElementById('distFeedbackMessage');

    const agentId = selectAgent ? selectAgent.value : '';
    if (!agentId) {
      alert('Por favor, selecione qual Agente Comercial receberá a carteira de leads.');
      return;
    }

    const targetAgent = (this.systemUsers || []).find(u => u.id === agentId);
    const supervisorId = targetAgent?.supervisor_id || null;

    const segment = selectSegment ? selectSegment.value : 'all';
    const limit = selectLimit ? selectLimit.value : '50';

    // Filtrar leads candidatos
    let candidates = (this.places || []).filter(p => {
      // Priorizar os não atribuídos se o filtro pedir ou se estiver livre
      if (segment === 'unassigned') {
        return !p.assignedTo;
      }
      if (segment === 'high_ticket') {
        return !!p.isHighTicket;
      }
      if (segment === 'giro_rapido') {
        return !!p.isHighTurnover;
      }
      if (segment !== 'all') {
        return (p.commercialSegment || '') === segment;
      }
      return true;
    });

    if (candidates.length === 0) {
      alert('Nenhum lead encontrado com os filtros selecionados.');
      return;
    }

    const numToAssign = limit === 'all' ? candidates.length : Math.min(parseInt(limit, 10), candidates.length);
    const selectedBatch = candidates.slice(0, numToAssign);
    const selectedIds = selectedBatch.map(p => p.id);

    const agentName = targetAgent?.full_name || targetAgent?.email;
    if (!confirm(`Deseja realmente atribuir ${selectedIds.length} estabelecimentos para o Agente "${agentName}"?`)) {
      return;
    }

    const btn = document.getElementById('btnExecuteBatchAssign');
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = '<i class="ri-loader-4-line spinner"></i> Atribuindo...';
    }

    try {
      await CloudSync.bulkAssignLeads(selectedIds, agentId, supervisorId, this.currentUser?.email || 'Master');

      // Atualizar localmente
      selectedBatch.forEach(p => {
        p.assignedTo = agentId;
        p.assignedSupervisorId = supervisorId;
        p.assignedBy = this.currentUser?.email || 'Master';
        p.assignedAt = new Date().toISOString();
      });

      this.renderLeadDistributionKPIs();
      await this.loadAuditFeed();

      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.color = '#34d399';
        feedback.innerHTML = `✔ <strong>Sucesso!</strong> ${selectedIds.length} leads foram atribuídos à carteira de <strong>${agentName}</strong>!`;
        setTimeout(() => { feedback.style.display = 'none'; }, 6000);
      }

      alert(`✔ ${selectedIds.length} leads foram distribuídos com sucesso para ${agentName}!`);
    } catch (err) {
      alert('Erro ao atribuir carteira: ' + (err.message || err));
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '<i class="ri-send-plane-fill"></i> Atribuir Carteira';
      }
    }
  },

  async handleUpdateUserStatus(userId, newStatus, userEmail) {
    const actionLabel = newStatus === 'approved' ? 'liberar' : 'bloquear / recusar';
    if (!confirm(`Deseja realmente ${actionLabel} o acesso de ${userEmail}?`)) {
      return;
    }

    try {
      await CloudSync.updateUserStatus(userId, newStatus, this.currentUser?.email);
      await CloudSync.recordInteraction('SISTEMA', 'user_status_change', `${this.currentUser?.email} alterou status de ${userEmail} para: ${newStatus}`);

      const target = (this.systemUsers || []).find(u => u.id === userId);
      if (target) {
        target.status = newStatus;
      }
      this.renderSystemUsersTable();
      await this.loadAuditFeed();
      alert(`✔ Status de ${userEmail} atualizado para: ${newStatus === 'approved' ? 'Aprovado' : 'Bloqueado'}!`);
    } catch (err) {
      alert('Erro ao atualizar usuário: ' + (err.message || err));
    }
  },

  setupRealtimeSync() {
    if (!CloudSync.client) return;
    try {
      CloudSync.client
        .channel('admin:realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'system_users' }, (payload) => {
          this.loadSystemUsers();
        })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'lead_interactions' }, (payload) => {
          this.loadAuditFeed();
        })
        .on('postgres_changes', { event: '*', schema: 'public', table: 'cnpj_leads' }, (payload) => {
          this.loadCnpjLeads();
        })
        .subscribe();
    } catch (e) {
      console.warn('Realtime subscription error:', e);
    }
  },

  async loadAuditFeed() {
    const feedContainer = document.getElementById('auditFeedList');
    if (!feedContainer) return;

    if (!CloudSync.client || !CloudSync.isConfigured) {
      feedContainer.innerHTML = `<div style="color:#94a3b8; font-size:0.8rem; padding:1rem;">Nuvem não configurada. Conecte ao Supabase para ver o histórico em tempo real.</div>`;
      return;
    }

    try {
      const { data, error } = await CloudSync.client
        .from('lead_interactions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);

      if (error || !data || data.length === 0) {
        feedContainer.innerHTML = `<div style="color:#94a3b8; font-size:0.8rem; padding:1rem;">Nenhuma alteração registrada ainda. As atividades da equipe aparecerão aqui em tempo real!</div>`;
        return;
      }

      feedContainer.innerHTML = data.map(item => {
        const timeAgo = this.formatTimeAgo(new Date(item.created_at));
        const userShort = (item.user_email || 'Usuário').split('@')[0];

        return `
          <div class="audit-feed-item">
            <span class="audit-item-dot" style="background: #38bdf8;"></span>
            <div class="audit-item-content">
              <span class="audit-item-action">
                <strong class="audit-item-user">${userShort}</strong> ${item.action_type || 'atualizou um lead'}: <em>${item.details || ''}</em>
              </span>
              <span class="audit-item-time"><i class="ri-time-line"></i> ${timeAgo}</span>
            </div>
          </div>
        `;
      }).join('');

    } catch (e) {
      console.warn('Erro ao carregar auditoria:', e);
    }
  },

  setupEventListeners() {
    // Botão de Atribuição em Lote de Carteiras
    const batchAssignBtn = document.getElementById('btnExecuteBatchAssign');
    if (batchAssignBtn) {
      batchAssignBtn.addEventListener('click', () => {
        this.handleBatchAssign();
      });
    }

    // Busca na tabela de leads
    const searchInput = document.getElementById('adminLeadSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.renderRecentLeadsTable(e.target.value);
      });
    }

    // Botão: Sincronizar Tudo na Nuvem (Bulk Upload)
    const syncAllBtn = document.getElementById('btnAdminSyncAll');
    if (syncAllBtn) {
      syncAllBtn.addEventListener('click', async () => {
        if (!confirm(`Deseja sincronizar todos os ${this.places.length} leads com o banco de dados na nuvem (Supabase)?`)) {
          return;
        }

        syncAllBtn.disabled = true;
        syncAllBtn.innerHTML = '<i class="ri-loader-4-line spinner"></i> Sincronizando...';

        try {
          await CloudSync.bulkUploadPlaces(this.places, (done, total) => {
            syncAllBtn.innerHTML = `<i class="ri-loader-4-line spinner"></i> ${done}/${total}...`;
          });
          alert(`✔ Sucesso! Todos os ${this.places.length} leads foram sincronizados na nuvem!`);
          this.loadAuditFeed();
        } catch (err) {
          alert('Erro na sincronização: ' + (err.message || err));
        } finally {
          syncAllBtn.disabled = false;
          syncAllBtn.innerHTML = '<i class="ri-cloud-upload-line"></i> Subir Base para Nuvem';
        }
      });
    }

    // Botão: Exportar Backup JSON
    const exportJsonBtn = document.getElementById('btnAdminExportJson');
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => {
        const jsonStr = JSON.stringify(this.places, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup_leads_franca_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // Botão: Exportar Relatório CSV (Excel)
    const exportCsvBtn = document.getElementById('btnAdminExportCsv');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => {
        this.exportToCSV();
      });
    }

    // Botão: Logout Admin
    const logoutBtn = document.getElementById('adminLogoutBtn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        await CloudSync.logout();
        window.location.href = 'login.html';
      });
    }
  },

  exportToCSV() {
    const headers = ['ID', 'Nome', 'CNPJ', 'CNAE', 'Segmento Comercial', 'Maquininha Atual', 'Estágio Funil', 'Telefone', 'WhatsApp', 'Endereço', 'Data de Abertura', 'Retorno Agendado', 'Visitado'];
    
    const rows = this.places.map(p => [
      `"${p.id || ''}"`,
      `"${(p.name || '').replace(/"/g, '""')}"`,
      `"${p.cnpj || ''}"`,
      `"${(p.cnae || '').replace(/"/g, '""')}"`,
      `"${p.commercialSegment || ''}"`,
      `"${p.cardMachine || 'Não Informado'}"`,
      `"${p.crmStage || 'lead'}"`,
      `"${p.phone || ''}"`,
      `"${p.whatsapp || ''}"`,
      `"${(p.address || '').replace(/"/g, '""')}"`,
      `"${p.dataAbertura || ''}"`,
      `"${p.followUpDate ? p.followUpDate + ' ' + (p.followUpTime || '') : ''}"`,
      `"${p.visited ? 'Sim' : 'Não'}"`
    ]);

    const csvContent = '\uFEFF' + [headers.join(';'), ...rows.map(r => r.join(';'))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `relatorio_leads_comerciais_franca_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },

  // --- GESTÃO DA BASE DEDICADA DE CNPJS (RECEITA FEDERAL & FICHÁRIO) ---
  cnpjLeads: [],
  cnpjFilter: 'all',
  cnpjSearchTerm: '',

  async loadCnpjLeads() {
    const tbody = document.getElementById('cnpjLeadsTableBody');
    if (!tbody) return;

    try {
      this.cnpjLeads = await CloudSync.fetchCnpjLeads();
      this.updateCnpjMetrics();
      this.renderCnpjTable();
    } catch (e) {
      console.warn('Erro ao carregar base de CNPJs:', e);
      if (tbody) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:#94a3b8; padding:2rem;">Nenhum CNPJ carregado no momento.</td></tr>`;
      }
    }
  },

  updateCnpjMetrics() {
    const list = this.cnpjLeads || [];
    const total = list.length;
    const matched = list.filter(c => !!c.matched_lead_id).length;
    const novos = total - matched;
    const ghosts = list.filter(c => !!c.is_ghost_suspect).length;

    this.animateCounter('metricTotalCnpjs', total);
    this.animateCounter('metricMatchedCnpjs', matched);
    this.animateCounter('metricNewCnpjs', novos);
    this.animateCounter('metricGhostCnpjs', ghosts);
  },

  renderCnpjTable() {
    const tbody = document.getElementById('cnpjLeadsTableBody');
    if (!tbody) return;

    let items = (this.cnpjLeads || []).slice();

    // 1. Filtro por status/categoria
    if (this.cnpjFilter === 'matched') {
      items = items.filter(c => !!c.matched_lead_id);
    } else if (this.cnpjFilter === 'new') {
      items = items.filter(c => !c.matched_lead_id);
    } else if (this.cnpjFilter === 'ghost') {
      items = items.filter(c => !!c.is_ghost_suspect);
    }

    // 2. Filtro por termo de busca
    if (this.cnpjSearchTerm) {
      const q = this.cnpjSearchTerm.toLowerCase().trim();
      items = items.filter(c => {
        const cnpjFmt = (c.cnpj_formatted || c.cnpj || '').toLowerCase();
        const razao = (c.razao_social || '').toLowerCase();
        const fantasia = (c.nome_fantasia || '').toLowerCase();
        const end = (c.endereco_completo || c.logradouro || '').toLowerCase();
        const sociosStr = (Array.isArray(c.socios) ? c.socios.map(s => s.nome).join(' ') : '').toLowerCase();
        return cnpjFmt.includes(q) || razao.includes(q) || fantasia.includes(q) || end.includes(q) || sociosStr.includes(q);
      });
    }

    if (items.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" style="text-align: center; color: #94a3b8; padding: 2.5rem;">
            <i class="ri-search-line" style="font-size: 1.5rem; display: block; margin-bottom: 0.5rem;"></i>
            Nenhum CNPJ encontrado para os filtros selecionados.
          </td>
        </tr>`;
      return;
    }

    tbody.innerHTML = items.map(c => {
      const formattedCnpj = c.cnpj_formatted || (c.cnpj ? c.cnpj.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5') : '—');
      const porte = c.porte || 'Demais';
      const porteColor = porte === 'ME' ? '#38bdf8' : (porte === 'EPP' ? '#a855f7' : '#94a3b8');
      
      // Sócios
      let sociosHtml = '<span style="color:#64748b; font-size:0.75rem;">Sem sócios listados</span>';
      if (Array.isArray(c.socios) && c.socios.length > 0) {
        sociosHtml = c.socios.slice(0, 2).map(s => `
          <div style="font-size: 0.73rem; color: #e2e8f0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 170px;">
            <i class="ri-user-line" style="color: #60a5fa;"></i> ${s.nome}
            <span style="color: #64748b; font-size: 0.68rem;">(${s.qualificacao || 'Sócio'})</span>
          </div>
        `).join('');
        if (c.socios.length > 2) {
          sociosHtml += `<span style="font-size:0.68rem; color:#94a3b8;">+ ${c.socios.length - 2} outros</span>`;
        }
      }

      // Faturamento Estimado
      const fatValor = Number(c.faturamento_estimado_central || 0);
      const fatFormatado = fatValor > 0 ? `R$ ${fatValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}/ano` : (c.faixa_receita_estimada || 'Não informada');
      const capitalValor = Number(c.capital_social || 0);

      // Vínculo
      let matchBadge = `
        <span style="display: inline-flex; align-items: center; gap: 0.3rem; background: rgba(56, 189, 248, 0.12); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.25); padding: 0.25rem 0.55rem; border-radius: 6px; font-size: 0.72rem; font-weight: 600;">
          <i class="ri-sparkling-line"></i> Novo Prospect
        </span>`;
      if (c.matched_lead_id) {
        matchBadge = `
          <span style="display: inline-flex; align-items: center; gap: 0.3rem; background: rgba(16, 185, 129, 0.12); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.25); padding: 0.25rem 0.55rem; border-radius: 6px; font-size: 0.72rem; font-weight: 600;">
            <i class="ri-check-line"></i> Vinculado a Lead
          </span>`;
      }

      // Endereço e Alerta Fantasma
      let addressHtml = `<div style="font-size: 0.75rem; color: #cbd5e1; max-width: 220px; line-height: 1.3;">${c.endereco_completo || (c.logradouro + ', ' + c.numero + ' - ' + c.bairro)}</div>`;
      if (c.is_ghost_suspect) {
        addressHtml = `
          <div style="margin-bottom: 0.25rem;">
            <span style="display: inline-flex; align-items: center; gap: 0.3rem; background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.35); padding: 0.2rem 0.5rem; border-radius: 5px; font-size: 0.7rem; font-weight: 700;" title="${c.ghost_reason || ''}">
              <i class="ri-alert-fill"></i> ${c.ghost_count_at_address} no mesmo local (Suspeita)
            </span>
          </div>
          <div style="font-size: 0.72rem; color: #94a3b8; max-width: 220px;">${c.endereco_completo || (c.logradouro + ', ' + c.numero)}</div>`;
      }

      return `
        <tr>
          <td>
            <div style="font-weight: 600; color: #f8fafc; font-family: monospace; font-size: 0.8rem;">
              ${formattedCnpj}
            </div>
            <div style="margin-top: 0.2rem;">
              <span style="background: rgba(255,255,255,0.06); color: ${porteColor}; border: 1px solid ${porteColor}40; padding: 0.15rem 0.4rem; border-radius: 4px; font-size: 0.68rem; font-weight: 600;">
                ${porte}
              </span>
              ${c.simples_nacional ? '<span style="background:rgba(16,185,129,0.1); color:#34d399; font-size:0.65rem; padding:0.15rem 0.35rem; border-radius:4px; margin-left:3px;">Simples</span>' : ''}
            </div>
          </td>
          <td>
            <div style="font-weight: 600; color: #fff; font-size: 0.82rem; max-width: 200px;">
              ${c.nome_fantasia || c.razao_social}
            </div>
            ${c.nome_fantasia ? `<div style="font-size: 0.7rem; color: #94a3b8; max-width: 200px; overflow: hidden; text-overflow: ellipsis;">${c.razao_social}</div>` : ''}
            ${c.telefone ? `<div style="font-size: 0.7rem; color: #38bdf8; margin-top: 2px;"><i class="ri-phone-line"></i> ${c.telefone}</div>` : ''}
          </td>
          <td>
            <div style="font-weight: 600; color: #cbd5e1; font-size: 0.75rem; font-family: monospace;">
              ${c.cnae_principal || '—'}
            </div>
            <div style="font-size: 0.7rem; color: #94a3b8; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
              ${c.cnae_descricao || ''}
            </div>
          </td>
          <td>
            ${sociosHtml}
          </td>
          <td>
            <div style="font-size: 0.75rem; color: #34d399; font-weight: 600;">
              ${fatFormatado}
            </div>
            <div style="font-size: 0.68rem; color: #64748b;">
              Capital: R$ ${capitalValor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}
            </div>
          </td>
          <td>
            ${matchBadge}
          </td>
          <td>
            ${addressHtml}
          </td>
        </tr>`;
    }).join('');
  },

  setupCnpjFilters() {
    // Busca instantânea de CNPJ
    const searchInput = document.getElementById('adminCnpjSearch');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.cnpjSearchTerm = e.target.value;
        this.renderCnpjTable();
      });
    }

    // Botão de Refresh
    const refreshBtn = document.getElementById('refreshCnpjBtn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i>';
        await this.loadCnpjLeads();
        refreshBtn.innerHTML = '<i class="ri-refresh-line"></i>';
      });
    }

    // Botões de filtro
    const filterBtns = document.querySelectorAll('.cnpj-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        filterBtns.forEach(b => {
          b.classList.remove('active');
          b.style.background = 'rgba(255,255,255,0.03)';
          b.style.color = '#94a3b8';
        });
        btn.classList.add('active');
        btn.style.background = 'rgba(99, 102, 241, 0.2)';
        btn.style.color = '#fff';

        this.cnpjFilter = btn.dataset.filter;
        this.renderCnpjTable();
      });
    });
  },

  animateCounter(id, target) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = Number(target).toLocaleString('pt-BR');
  },

  formatTimeAgo(date) {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60) return 'Agora mesmo';
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `Há ${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `Há ${hours}h`;
    const days = Math.floor(hours / 24);
    return `Há ${days}d`;
  }
};

document.addEventListener('DOMContentLoaded', () => {
  AdminApp.init();
});
