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
    if (user.app_metadata?.role === 'admin' || user.user_metadata?.role === 'admin') return true;
    return false;
  },

  onAuthChange(cb) {
    this.listeners.onAuthChange.push(cb);
  },

  notifyAuthChange(event, user) {
    this.listeners.onAuthChange.forEach(cb => cb(event, user));
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

  async fetchAllLeads() {
    if (!this.client) return null;

    try {
      // Supabase limita a 1000 por página, buscamos todos em paginação
      let allRows = [];
      let from = 0;
      const step = 1000;
      let hasMore = true;

      while (hasMore) {
        const { data, error } = await this.client
          .from('leads')
          .select('*')
          .range(from, from + step - 1);

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
      data_abertura: p.dataAbertura || ''
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
      updatedByEmail: row.updated_by_email,
      updatedAt: row.updated_at
    };
  }
};

window.CloudSync = CloudSync;
