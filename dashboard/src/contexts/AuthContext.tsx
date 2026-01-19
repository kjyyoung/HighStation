import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../utils/apiClient';
import type { Session, User } from '@supabase/supabase-js';

interface AuthContextType {
    session: Session | null;
    user: User | null;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [session, setSession] = useState<Session | null>(null);
    const [user, setUser] = useState<User | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // 1. Check active session
        const initSession = async () => {
            try {
                const { data: { session }, error } = await supabase.auth.getSession();
                if (error) {
                    console.error('[AuthContext] Error checking session:', error);
                }
                setSession(session);
                setUser(session?.user ?? null);
            } catch (err) {
                console.error('[AuthContext] Unexpected error during session init:', err);
            } finally {
                setLoading(false);
            }
        };

        initSession();

        // 2. Listen for changes
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            console.log(`[AuthContext] Auth State Change: ${_event}`, session?.user?.email);
            setSession(session);
            setUser(session?.user ?? null);
            setLoading(false);
        });

        return () => {
            subscription.unsubscribe();
        };
    }, []);

    const value = {
        session,
        user,
        loading
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
