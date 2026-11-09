/**
 * CLIENTE SUPABASE & SINCRONIZAÇÃO EM NUVEM EM TEMPO REAL (WEBSOCKETS)
 * CityMap Hub - Mapeador Urbano & CRM
 */

const CloudSync = {
  client: null,
  currentUser: null,
  isConfigured: false,
  realtimeChannel: null,
  listeners: {
    onLeadChange: [],
    onAuthChange: []
  },

  init() {
    const config = window.SUPABASE_CONFIG || {};
    const url = config.url || localStorage.getItem('citymap_supabase_url');
    const key = config.anonKey || localStorage.getItem('citymap_supabase_key');

    if (url && key && window.supabase) {
      try {
        this.client = window.supabase.createClient(url, key, {
          auth: {
            persistSession: true,
            autoRefreshToken: true
          }
        });
        this.isConfigured = true;

        // Ouvir mudanças de autenticação
        this.client.auth.onAuthStateChange((event, session) => {
          this.currentUser = session?.user || null;
          this.notifyAuthChange(event, this.currentUser);
          if (this.currentUser) {
            this.setupRealtime();
          }
        });

        // Verificar sessão existente
        this.client.auth.getSession().then(({ data }) => {
          this.currentUser = data?.session?.user || null;
          this.notifyAuthChange('INITIAL_SESSION', this.currentUser);
          if (this.currentUser) {
            this.setupRealtime();
          }
        });

      } catch (err) {
        console.error('Falha ao inicializar Supabase:', err);
        this.isConfigured = false;
      }
    } else {
      this.isConfigured = false;
    }

    return this.isConfigured;
  },

  // --- AUTENTICAÇÃO ---

  async login(email, password) {
    if (!this.client) throw new Error('Supabase não configurado.');
    const { data, error } = await this.client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    this.currentUser = data.user;
    return data;
  },

  async register(email, password) {
    if (!this.client) throw new Error('Supabase não configurado.');
    const { data, error } = await this.client.auth.signUp({ email, password });
    if (error) throw error;
    this.currentUser = data.user;
    return data;
  },

  async logout() {
    if (!this.client) return;
    if (this.realtimeChannel) {
      this.client.removeChannel(this.realtimeChannel);
      this.realtimeChannel = null;
    }
    const { error } = await this.client.auth.signOut();
    this.currentUser = null;
    if (error) throw error;
  },

  isAdmin(user = this.currentUser) {
    if (!user) return false;
    const email = (user.email || '').toLowerCase().trim();
    const configAdmins = (window.SUPABASE_CONFIG?.adminEmails || []).map(e => e.toLowerCase().trim());
    if (configAdmins.includes(email)) return true;
    if (user.role === 'master' || user.role === 'admin') return true;
    if (user.app_metadata?.role === 'admin' || user.user_metadata?.role === 'admin') return true;
    if (user.app_metadata?.role === 'master' || user.user_metadata?.role === 'master') return true;
    return false;
  },

  isSupervisor(user = this.currentUser) {
    if (!user) return false;
    return user.role === 'supervisor';
  },

  isAgent(user = this.currentUser) {
    if (!user) return false;
    return user.role === 'agent' || user.role === 'seller';
  },

  onAuthChange(cb) {
    this.listeners.onAuthChange.push(cb);
  },

  notifyAuthChange(event, user) {
    this.listeners.onAuthChange.forEach(cb => cb(event, user));
  },

  // --- GESTÃO DE USUÁRIOS E APROVAÇÃO PRÉVIA ---

  async registerUserInSystem(user, fullName = '', defaultRole = 'agent') {
    if (!this.client || !user) return null;
    const isMaster = this.isAdmin(user);
    const initialStatus = isMaster ? 'approved' : 'pending';
    const role = isMaster ? 'master' : defaultRole;

    try {
      const { data, error } = await this.client
        .from('system_users')
        .upsert({
          id: user.id,
          email: user.email,
          full_name: fullName || user.user_metadata?.full_name || '',
          status: initialStatus,
          role: role,
          created_at: user.created_at || new Date().toISOString()
        }, { onConflict: 'id' })
        .select()
        .single();

      if (error) {
        console.warn('Erro ao salvar em system_users:', error);
      }
      return data;
    } catch (e) {
      console.warn('Falha em registerUserInSystem:', e);
      return null;
    }
  },

  async checkUserApproval(user) {
    if (!user) return { status: 'none', isApproved: false, role: 'agent' };
    if (this.isAdmin(user)) {
      if (this.client) {
        this.client.from('system_users').upsert({
          id: user.id,
          email: user.email,
          full_name: user.user_metadata?.full_name || 'Filipe (Master)',
          status: 'approved',
          role: 'master'
        }, { onConflict: 'id' }).then(() => {}).catch(() => {});
      }
      return { status: 'approved', isApproved: true, role: 'master' };
    }

    if (!this.client) return { status: 'approved', isApproved: true, role: 'agent' };

    try {
      const { data, error } = await this.client
        .from('system_users')
        .select('id, status, role, full_name, supervisor_id')
        .eq('id', user.id)
        .maybeSingle();

      if (error) {
        console.warn('Erro ao checar status em system_users:', error);
        return { status: 'approved', isApproved: true, role: 'agent' };
      }

      if (!data) {
        await this.registerUserInSystem(user);
        return { status: 'pending', isApproved: false, role: 'agent' };
      }

      let role = data.role || 'agent';
      if (role === 'admin') role = 'master';
      if (role === 'seller') role = 'agent';

      user.role = role;
      user.supervisorId = data.supervisor_id;
      user.fullName = data.full_name;

      return {
        status: data.status,
        isApproved: data.status === 'approved',
        role: role,
        supervisorId: data.supervisor_id,
        fullName: data.full_name
      };
    } catch (e) {
      console.warn('Falha ao consultar aprovação:', e);
      return { status: 'approved', isApproved: true, role: 'agent' };
    }
  },

  async fetchSystemUsers() {
    if (!this.client) return [];
    try {
      const { data, error } = await this.client
        .from('system_users')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Erro ao buscar system_users:', error);
        return [];
      }
      return data || [];
    } catch (e) {
      console.error('Erro ao buscar usuários do sistema:', e);
      return [];
    }
  },

  async updateUserStatus(userId, newStatus, adminEmail = '') {
    if (!this.client || !userId) return false;
    try {
      const updatePayload = {
        status: newStatus,
        approved_by: adminEmail || this.currentUser?.email || 'master'
      };
      if (newStatus === 'approved') {
        updatePayload.approved_at = new Date().toISOString();
      }

      const { error } = await this.client
        .from('system_users')
        .update(updatePayload)
        .eq('id', userId);

      if (error) throw error;
      return true;
    } catch (e) {
      console.error('Erro ao atualizar status do usuário:', e);
      throw e;
    }
  },

  async updateUserRoleAndSupervisor(userId, role, supervisorId = null) {
    if (!this.client || !userId) return false;
    try {
      const updatePayload = {
        role: role,
        supervisor_id: (role === 'agent' && supervisorId) ? supervisorId : null
      };

      const { error } = await this.client
        .from('system_users')
        .update(updatePayload)
        .eq('id', userId);

      if (error) throw error;
      return true;
    } catch (e) {
      console.error('Erro ao atualizar cargo/supervisor do usuário:', e);
      throw e;
    }
  },

  async fetchSupervisors() {
    if (!this.client) return [];
    try {
      const { data, error } = await this.client
        .from('system_users')
        .select('id, email, full_name')
        .eq('status', 'approved')
        .eq('role', 'supervisor');

      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('Erro ao buscar supervisores:', e);
      return [];
    }
  },

  // --- BASE DEDICADA DE CNPJS (RECEITA FEDERAL / FICHÁRIO) ---

  async fetchCnpjLeads() {
    if (!this.client) {
      try {
        const res = await fetch('data/cnpj-leads.json?v=' + Date.now());
        if (res.ok) return await res.json();
      } catch (e) {}
      return [];
    }

    try {
      const { data, error } = await this.client
        .from('cnpj_leads')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        // Fallback local se a tabela ainda não tiver sido criada no Supabase
        console.warn('Tabela cnpj_leads não encontrada no Supabase, usando cache local:', error.message);
        try {
          const res = await fetch('data/cnpj-leads.json?v=' + Date.now());
          if (res.ok) return await res.json();
        } catch (e) {}
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('Erro ao buscar cnpj_leads:', e);
      try {
        const res = await fetch('data/cnpj-leads.json?v=' + Date.now());
        if (res.ok) return await res.json();
      } catch (err) {}
      return [];
    }
  },

  async fetchAgents(supervisorId = null) {
    if (!this.client) return [];
    try {
      let query = this.client
        .from('system_users')
        .select('id, email, full_name, supervisor_id')
        .eq('status', 'approved')
        .in('role', ['agent', 'seller']);

      if (supervisorId) {
        query = query.eq('supervisor_id', supervisorId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data || [];
    } catch (e) {
      console.warn('Erro ao buscar agentes:', e);
      return [];
    }
  },

  // --- SINCRONIZAÇÃO EM TEMPO REAL (WEBSOCKETS) ---

  setupRealtime() {
    if (!this.client || this.realtimeChannel) return;

    try {
      this.realtimeChannel = this.client
        .channel('public:leads')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, (payload) => {
          console.log('⚡ Atualização em tempo real recebida da nuvem:', payload);
          if (payload.new && payload.new.id) {
            const mapped = this.mapFromDb(payload.new);
            this.listeners.onLeadChange.forEach(cb => cb(mapped, payload.eventType));
          }
        })
        .subscribe((status) => {
          console.log('📡 Status da conexão em tempo real (Supabase):', status);
        });
    } catch (e) {
      console.warn('Não foi possível estabelecer canal Realtime:', e);
    }
  },

  onLeadUpdate(cb) {
    this.listeners.onLeadChange.push(cb);
  },

  // --- OPERAÇÕES NO BANCO DE DADOS (LEADS) ---

  async fetchAllLeads(forceAll = false) {
    if (!this.client) return null;

    try {
      let isMaster = forceAll;
      let role = 'agent';
      let userId = this.currentUser?.id;

      if (!forceAll && this.currentUser) {
        isMaster = this.isAdmin(this.currentUser);
        if (!isMaster) {
          const approval = await this.checkUserApproval(this.currentUser);
          role = approval.role;
        } else {
          role = 'master';
        }
      }

      // Supabase limita a 1000 por página, buscamos todos em paginação
      let allRows = [];
      let from = 0;
      const step = 1000;
      let hasMore = true;

      // Se for Supervisor, buscar os agentes subordinados
      let supervisedAgentIds = [];
      if (role === 'supervisor' && userId) {
        const { data: team } = await this.client
          .from('system_users')
          .select('id')
          .eq('supervisor_id', userId);
        supervisedAgentIds = (team || []).map(t => t.id);
      }

      while (hasMore) {
        let query = this.client
          .from('leads')
          .select('*')
          .range(from, from + step - 1);

        // Aplicação de filtros por hierarquia RBAC
        if (!isMaster && userId) {
          if (role === 'supervisor') {
            // Vê leads atribuídos ao supervisor OU à sua equipe de agentes
            if (supervisedAgentIds.length > 0) {
              const idsList = [userId, ...supervisedAgentIds].join(',');
              query = query.or(`assigned_supervisor_id.eq.${userId},assigned_to.in.(${idsList})`);
            } else {
              query = query.or(`assigned_supervisor_id.eq.${userId},assigned_to.eq.${userId}`);
            }
          } else if (role === 'agent' || role === 'seller') {
            // Agente vê apenas leads atribuídos a ele
            query = query.eq('assigned_to', userId);
          }
        }

        const { data, error } = await query;

        if (error) {
          console.error('Erro ao buscar leads do Supabase:', error);
          return null;
        }

        if (data && data.length > 0) {
          allRows = allRows.concat(data);
          from += step;
          hasMore = data.length === step;
        } else {
          hasMore = false;
        }
      }

      return allRows.map(this.mapFromDb);
    } catch (err) {
      console.error('Falha de conexão com a nuvem:', err);
      return null;
    }
  },

  async updateLead(place) {
    if (!this.client || !place || !place.id) return false;

    const row = this.mapToDb(place);
    if (this.currentUser) {
      row.updated_by_email = this.currentUser.email;
      row.user_id = this.currentUser.id;
    }

    try {
      const { error } = await this.client
        .from('leads')
        .upsert(row, { onConflict: 'id' });

      if (error) {
        console.error('Erro ao atualizar lead no Supabase:', error);
        return false;
      }

      // Gravar histórico de auditoria
      if (this.currentUser) {
        await this.recordInteraction(place.id, 'lead_update', `Status: ${place.crmStage || 'lead'}, Maquininha: ${place.cardMachine || 'N/A'}`);
      }

      return true;
    } catch (e) {
      console.error('Erro na requisição ao Supabase:', e);
      return false;
    }
  },

  async assignLead(leadId, assignedToUserId, assignedSupervisorId = null, assignedByName = '') {
    if (!this.client || !leadId) return false;
    try {
      const payload = {
        assigned_to: assignedToUserId || null,
        assigned_supervisor_id: assignedSupervisorId || null,
        assigned_by: assignedByName || this.currentUser?.email || 'Master',
        assigned_at: new Date().toISOString()
      };

      const { error } = await this.client
        .from('leads')
        .update(payload)
        .eq('id', leadId);

      if (error) throw error;

      await this.recordInteraction(
        leadId, 
        'assignment', 
        `Lead atribuído para: ${assignedToUserId || 'Pool Geral'} por ${assignedByName || this.currentUser?.email}`
      );

      return true;
    } catch (e) {
      console.error('Erro ao atribuir lead:', e);
      throw e;
    }
  },

  async bulkAssignLeads(leadIds, assignedToUserId, assignedSupervisorId = null, assignedByName = '') {
    if (!this.client || !leadIds || leadIds.length === 0) return false;
    try {
      const payload = {
        assigned_to: assignedToUserId || null,
        assigned_supervisor_id: assignedSupervisorId || null,
        assigned_by: assignedByName || this.currentUser?.email || 'Master',
        assigned_at: new Date().toISOString()
      };

      const batchSize = 100;
      for (let i = 0; i < leadIds.length; i += batchSize) {
        const chunk = leadIds.slice(i, i + batchSize);
        const { error } = await this.client
          .from('leads')
          .update(payload)
          .in('id', chunk);

        if (error) throw error;
      }

      await this.recordInteraction(
        'SISTEMA',
        'bulk_assignment',
        `Lote de ${leadIds.length} leads atribuído para usuário ${assignedToUserId || 'Pool Geral'}`
      );

      return true;
    } catch (e) {
      console.error('Erro ao atribuir lote de leads:', e);
      throw e;
    }
  },

  async recordInteraction(leadId, actionType, details = '') {
    if (!this.client || !this.currentUser) return;
    try {
      await this.client.from('lead_interactions').insert({
        lead_id: leadId,
        user_id: this.currentUser.id,
        user_email: this.currentUser.email,
        action_type: actionType,
        details: details
      });
    } catch (e) {
      console.warn('Erro ao salvar histórico:', e);
    }
  },

  async bulkUploadPlaces(placesList, progressCb) {
    if (!this.client || !placesList || placesList.length === 0) return false;

    const batchSize = 100;
    let uploaded = 0;

    for (let i = 0; i < placesList.length; i += batchSize) {
      const chunk = placesList.slice(i, i + batchSize).map(p => this.mapToDb(p));
      const { error } = await this.client.from('leads').upsert(chunk, { onConflict: 'id' });
      
      if (error) {
        console.error('Erro ao subir lote para a nuvem:', error);
        throw error;
      }

      uploaded += chunk.length;
      if (progressCb) progressCb(uploaded, placesList.length);
    }

    return true;
  },

  // --- MAPEADORES OBJETO <-> BANCO DE DADOS ---

  mapToDb(p) {
    return {
      id: p.id,
      name: p.name || 'Sem nome',
      category: p.category || 'comercio',
      sub_category: p.subCategory || '',
      commercial_segment: p.commercialSegment || 'outro',
      is_high_turnover: !!p.isHighTurnover,
      is_chain: !!p.isChain,
      address: p.address || '',
      lat: p.lat || 0,
      lng: p.lng || 0,
      phone: p.phone || '',
      whatsapp: p.whatsapp || '',
      hours: p.hours || '',
      rating: String(p.rating || ''),
      photo: p.photo || '',
      description: p.description || '',
      card_machine: p.cardMachine || '',
      crm_stage: p.crmStage || (p.visited ? 'negotiating' : 'lead'),
      crm_notes: p.crmNotes || '',
      follow_up_date: p.followUpDate || null,
      follow_up_time: p.followUpTime || null,
      follow_up_notes: p.followUpNotes || '',
      visited: !!p.visited,
      visited_at: p.visitedAt || null,
      tags: p.tags || [],
      cnpj: p.cnpj || '',
      cnae: p.cnae || '',
      data_abertura: p.dataAbertura || '',
      assigned_to: p.assignedTo || null,
      assigned_supervisor_id: p.assignedSupervisorId || null,
      assigned_by: p.assignedBy || '',
      assigned_at: p.assignedAt || null
    };
  },

  mapFromDb(row) {
    return {
      id: row.id,
      name: row.name,
      category: row.category,
      subCategory: row.sub_category,
      commercialSegment: row.commercial_segment,
      isHighTurnover: row.is_high_turnover,
      isChain: row.is_chain,
      address: row.address,
      lat: row.lat,
      lng: row.lng,
      phone: row.phone,
      whatsapp: row.whatsapp,
      hours: row.hours,
      rating: row.rating,
      photo: row.photo,
      description: row.description,
      cardMachine: row.card_machine,
      crmStage: row.crm_stage,
      crmNotes: row.crm_notes,
      followUpDate: row.follow_up_date,
      followUpTime: row.follow_up_time,
      followUpNotes: row.follow_up_notes,
      visited: row.visited,
      visitedAt: row.visited_at,
      tags: row.tags || [],
      cnpj: row.cnpj,
      cnae: row.cnae,
      dataAbertura: row.data_abertura,
      assignedTo: row.assigned_to || null,
      assignedSupervisorId: row.assigned_supervisor_id || null,
      assignedBy: row.assigned_by || '',
      assignedAt: row.assigned_at || null,
      updatedByEmail: row.updated_by_email,
      updatedAt: row.updated_at
    };
  }
};

window.CloudSync = CloudSync;
