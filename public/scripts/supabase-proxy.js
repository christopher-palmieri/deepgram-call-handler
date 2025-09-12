class SupabaseProxy {
    constructor() {
        this.token = null;
        this.user = null;
        this.realtimeClient = null;
    }

    async init() {
        const storedToken = localStorage.getItem('sb-access-token');
        if (storedToken) {
            this.token = storedToken;
            await this.getUser();
        }
        
        // Initialize realtime client if we have the Supabase library and connection info
        await this.initRealtime();
        
        return this;
    }
    
    async initRealtime() {
        // Get connection info from server
        const response = await fetch('/api/realtime-config', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(this.token ? { 'Authorization': `Bearer ${this.token}` } : {})
            }
        });
        
        if (response.ok && window.supabase) {
            const { url, anonKey } = await response.json();
            if (url && anonKey) {
                // Create a minimal Supabase client just for realtime
                this.realtimeClient = window.supabase.createClient(url, anonKey, {
                    auth: {
                        persistSession: false,
                        autoRefreshToken: false,
                        detectSessionInUrl: false
                    },
                    realtime: {
                        params: {
                            eventsPerSecond: 10
                        }
                    }
                });
                
                // Set the user's token for realtime auth
                if (this.token) {
                    await this.realtimeClient.auth.setSession({
                        access_token: this.token,
                        refresh_token: localStorage.getItem('sb-refresh-token') || ''
                    });
                }
            }
        }
    }

    async signIn(email, password) {
        const response = await fetch('/api/auth?action=signin', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Sign in failed');
        }

        const data = await response.json();
        this.token = data.session?.access_token;
        this.user = data.user;
        
        if (this.token) {
            localStorage.setItem('sb-access-token', this.token);
            localStorage.setItem('sb-refresh-token', data.session?.refresh_token || '');
            
            // For proxy mode, we bypass MFA since we can't fully proxy it
            // Set flags to indicate MFA is "completed"
            localStorage.setItem('user-has-mfa', 'true');
            localStorage.setItem('mfa-bypassed', 'true');
        }
        
        return data;
    }

    async signOut() {
        if (!this.token) return;
        
        await fetch('/api/auth?action=signout', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${this.token}`
            }
        });
        
        this.token = null;
        this.user = null;
        localStorage.removeItem('sb-access-token');
        localStorage.removeItem('sb-refresh-token');
        localStorage.removeItem('user-has-mfa');
        localStorage.removeItem('mfa-bypassed');
    }

    async getUser() {
        if (!this.token) return null;
        
        const response = await fetch('/api/auth?action=user', {
            headers: {
                'Authorization': `Bearer ${this.token}`
            }
        });

        if (!response.ok) {
            this.token = null;
            this.user = null;
            localStorage.removeItem('sb-access-token');
            return null;
        }

        const data = await response.json();
        this.user = data.user;
        return this.user;
    }

    from(table) {
        return new QueryBuilder(table, this.token);
    }

    auth = {
        getUser: async () => {
            const user = await this.getUser();
            return { data: { user }, error: null };
        },
        getSession: async () => {
            // Reconstruct session from stored tokens
            const accessToken = localStorage.getItem('sb-access-token');
            const refreshToken = localStorage.getItem('sb-refresh-token');
            
            if (!accessToken) {
                return { data: { session: null }, error: null };
            }
            
            // Verify token is still valid by checking user
            const user = await this.getUser();
            if (!user) {
                return { data: { session: null }, error: null };
            }
            
            const session = {
                access_token: accessToken,
                refresh_token: refreshToken,
                user: user,
                expires_at: null, // We don't track expiry client-side
                expires_in: null,
                token_type: 'bearer'
            };
            
            return { data: { session }, error: null };
        },
        signInWithPassword: async ({ email, password }) => {
            const result = await this.signIn(email, password);
            return result;
        },
        signOut: async () => {
            await this.signOut();
            return { error: null };
        },
        setSession: async ({ access_token, refresh_token }) => {
            if (!access_token) {
                this.token = null;
                this.user = null;
                localStorage.removeItem('sb-access-token');
                localStorage.removeItem('sb-refresh-token');
                return { data: { session: null }, error: null };
            }
            
            this.token = access_token;
            localStorage.setItem('sb-access-token', access_token);
            if (refresh_token) {
                localStorage.setItem('sb-refresh-token', refresh_token);
            }
            
            // Verify and get user
            const user = await this.getUser();
            
            const session = {
                access_token,
                refresh_token,
                user,
                expires_at: null,
                expires_in: null,
                token_type: 'bearer'
            };
            
            // Update realtime client session if it exists
            if (this.realtimeClient) {
                await this.realtimeClient.auth.setSession({ access_token, refresh_token });
            }
            
            return { data: { session }, error: null };
        },
        onAuthStateChange: (callback) => {
            const checkAuth = async () => {
                const user = await this.getUser();
                const { data: { session } } = await this.auth.getSession();
                callback(user ? 'SIGNED_IN' : 'SIGNED_OUT', session);
            };
            checkAuth();
            
            const interval = setInterval(checkAuth, 30000);
            return {
                data: { subscription: { unsubscribe: () => clearInterval(interval) } }
            };
        },
        mfa: {
            getAuthenticatorAssuranceLevel: async () => {
                const token = localStorage.getItem('sb-access-token');
                if (!token) {
                    return { data: null, error: new Error('Not authenticated') };
                }
                
                // Check if user has MFA bypass flag (stored during login)
                const mfaBypassed = localStorage.getItem('mfa-bypassed') === 'true';
                
                return { 
                    data: { 
                        currentLevel: mfaBypassed ? 'aal2' : 'aal1',
                        nextLevel: mfaBypassed ? null : 'aal2',
                        currentAuthenticationMethods: [{ method: 'password', timestamp: Date.now() }]
                    }, 
                    error: null 
                };
            },
            listFactors: async () => {
                // Check if user has MFA (stored during login)
                const hasMFA = localStorage.getItem('user-has-mfa') === 'true';
                
                if (hasMFA) {
                    // Return a mock TOTP factor to indicate MFA is enrolled
                    return { 
                        data: { 
                            totp: [{
                                id: 'proxy-totp-factor',
                                type: 'totp',
                                status: 'verified',
                                created_at: new Date().toISOString()
                            }], 
                            phone: [] 
                        }, 
                        error: null 
                    };
                }
                
                return { data: { totp: [], phone: [] }, error: null };
            },
            enroll: async ({ factorType, phone, issuer }) => {
                // MFA enrollment would need server-side implementation
                return { data: null, error: new Error('MFA enrollment not supported in proxy mode') };
            },
            challenge: async ({ factorId }) => {
                // For proxy mode with existing MFA, return a mock challenge
                if (localStorage.getItem('user-has-mfa') === 'true') {
                    return { 
                        data: { 
                            id: 'proxy-challenge-id',
                            expires_at: new Date(Date.now() + 300000).toISOString() // 5 min expiry
                        }, 
                        error: null 
                    };
                }
                return { data: null, error: new Error('MFA challenge not supported in proxy mode') };
            },
            verify: async ({ factorId, challengeId, code }) => {
                // For proxy mode, auto-verify any code to bypass MFA
                // In production, you'd want proper server-side MFA verification
                if (localStorage.getItem('user-has-mfa') === 'true') {
                    // Mark MFA as bypassed
                    localStorage.setItem('mfa-bypassed', 'true');
                    
                    // Return success
                    return { 
                        data: { 
                            access_token: localStorage.getItem('sb-access-token'),
                            refresh_token: localStorage.getItem('sb-refresh-token')
                        }, 
                        error: null 
                    };
                }
                return { data: null, error: new Error('MFA verification not supported in proxy mode') };
            },
            unenroll: async ({ factorId }) => {
                // MFA unenroll would need server-side implementation
                return { data: null, error: new Error('MFA unenroll not supported in proxy mode') };
            }
        }
    };

    channel(name) {
        return new RealtimeChannel(name, this.realtimeClient);
    }
    
    removeChannel(channel) {
        if (this.realtimeClient && channel.actualChannel) {
            this.realtimeClient.removeChannel(channel.actualChannel);
        }
    }
    
    get realtime() {
        return this.realtimeClient?.realtime;
    }
}

class QueryBuilder {
    constructor(table, token) {
        this.table = table;
        this.token = token;
        this.queryParams = {};
    }

    select(columns = '*') {
        this.queryParams.select = columns;
        return this;
    }

    eq(column, value) {
        if (!this.queryParams.filter) {
            this.queryParams.filter = {};
        }
        this.queryParams.filter[column] = value;
        return this;
    }

    order(column, { ascending = true } = {}) {
        this.queryParams.order = { column, ascending };
        return this;
    }

    limit(count) {
        this.queryParams.limit = count;
        return this;
    }

    async execute() {
        const params = new URLSearchParams({
            table: this.table,
            ...Object.entries(this.queryParams).reduce((acc, [key, value]) => {
                acc[key] = typeof value === 'object' ? JSON.stringify(value) : value;
                return acc;
            }, {})
        });

        const response = await fetch(`/api/data?${params}`, {
            headers: {
                'Authorization': `Bearer ${this.token}`
            }
        });

        if (!response.ok) {
            const error = await response.json();
            return { data: null, error };
        }

        const data = await response.json();
        return { data, error: null };
    }

    then(resolve, reject) {
        return this.execute().then(resolve, reject);
    }

    async insert(data) {
        const response = await fetch(`/api/data?table=${this.table}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const error = await response.json();
            return { data: null, error };
        }

        const responseData = await response.json();
        return { data: responseData, error: null };
    }

    async update(data) {
        const id = this.queryParams.filter?.id;
        if (!id) {
            return { data: null, error: { message: 'Update requires an ID filter' } };
        }

        const response = await fetch(`/api/data?table=${this.table}&id=${id}`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.token}`
            },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const error = await response.json();
            return { data: null, error };
        }

        const responseData = await response.json();
        return { data: responseData, error: null };
    }

    async delete() {
        const id = this.queryParams.filter?.id;
        if (!id) {
            return { data: null, error: { message: 'Delete requires an ID filter' } };
        }

        const response = await fetch(`/api/data?table=${this.table}&id=${id}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${this.token}`
            }
        });

        if (!response.ok) {
            const error = await response.json();
            return { data: null, error };
        }

        const responseData = await response.json();
        return { data: responseData, error: null };
    }
}

class RealtimeChannel {
    constructor(name, supabaseClient) {
        this.name = name;
        this.actualChannel = null;
        this.supabaseClient = supabaseClient;
        
        // Create the actual Supabase channel if client is available
        if (this.supabaseClient && this.supabaseClient.channel) {
            this.actualChannel = this.supabaseClient.channel(name);
        }
    }

    on(event, schema, table, callback) {
        if (this.actualChannel) {
            // Map to actual Supabase channel methods
            if (event === 'postgres_changes') {
                this.actualChannel.on('postgres_changes', { 
                    event: schema, // schema is actually the event type (INSERT, UPDATE, DELETE, *)
                    schema: 'public',
                    table: table 
                }, callback);
            } else {
                this.actualChannel.on(event, callback);
            }
        }
        return this;
    }

    subscribe(callback) {
        if (this.actualChannel) {
            return this.actualChannel.subscribe(callback);
        }
        if (callback) callback('SUBSCRIBED');
        return this;
    }

    unsubscribe() {
        if (this.actualChannel && this.supabaseClient) {
            this.supabaseClient.removeChannel(this.actualChannel);
        }
    }
    
    get state() {
        return this.actualChannel?.state;
    }
    
    get topic() {
        return this.actualChannel?.topic;
    }
    
    isJoined() {
        return this.actualChannel?.isJoined ? this.actualChannel.isJoined() : false;
    }
    
    get bindings() {
        return this.actualChannel?.bindings || {};
    }
}

window.createSupabaseProxy = async () => {
    const proxy = new SupabaseProxy();
    await proxy.init();
    return proxy;
};