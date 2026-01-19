import { Pool } from 'pg';
import { getAddress, isAddress } from 'viem';
import { FEE_CONFIG } from '../config/reputation';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

// Global pool instance
let pool: Pool | null = null;

// SECURITY BYPASS (Development Only): Allow self-signed certificates for Supabase Transaction Pooler
// This is necessary in some local network environments where the certificate chain cannot be verified.
if (process.env.NODE_ENV !== 'production') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
}

export async function initDB() {
    if (pool) return pool;

    const connectionString = process.env.DATABASE_URL;

    // [ADVANCED AUTH] 개별 변수 방식 지원 (특수문자 포함 비밀번호 안전 처리)
    const dbConfig: any = {
        connectionTimeoutMillis: 10000,
        idleTimeoutMillis: 30000,
        max: 10
    };

    if (process.env.DB_SSL !== 'false') {
        dbConfig.ssl = {
            rejectUnauthorized: false
        };
    }

    if (process.env.DB_HOST) {
        // 개별 변수가 설정되어 있으면 최우선 사용
        dbConfig.host = process.env.DB_HOST;
        dbConfig.port = parseInt(process.env.DB_PORT || '5432');
        dbConfig.user = process.env.DB_USER;
        dbConfig.password = process.env.DB_PASSWORD;
        dbConfig.database = process.env.DB_NAME || 'postgres';

        console.log(`[DB DEBUG] Host: '${dbConfig.host}'`);
        console.log(`[DB DEBUG] User: '${dbConfig.user}'`); // Check for whitespace or missing project ID
        console.log(`[DB DEBUG] Port: ${dbConfig.port}`);
    } else if (connectionString) {
        dbConfig.connectionString = connectionString;
        console.log(`[DB] Using Connection String Mode`);
    } else {
        console.error('[DB] FATAL: No database configuration found (DATABASE_URL or DB_HOST)!');
        throw new Error('Database config missing');
    }

    try {
        pool = new Pool(dbConfig);

        // Test connection immediately
        const client = await pool.connect();
        console.log('[DB] Test connection successful');
        client.release();

        console.log(`[DB] Using Native Postgres Pooler (SSL Enforced)`);
        return pool;
    } catch (error: any) {
        console.error('[DB] Initialization failed:', error.message);
        throw error;
    }
}

/**
 * Execute a query with auto-init
 */
export async function query(text: string, params: any[] = []) {
    if (!pool) await initDB();
    return pool!.query(text, params);
}

export async function logRequest(data: {
    agentId?: string,
    serviceSlug?: string,
    status: number,
    amount?: string,
    txHash?: string,
    endpoint: string,
    error?: string,
    creditGrade?: string,
    latencyMs?: number,
    responseSizeBytes?: number,
    gasUsed?: string,
    contentType?: string,
    integrityCheck?: boolean,
    trustSignal?: any
}) {
    if (process.env.NODE_ENV === 'test') return;

    try {
        let normalizedAgentId = data.agentId || null;
        if (normalizedAgentId && isAddress(normalizedAgentId)) {
            normalizedAgentId = getAddress(normalizedAgentId);
        }

        const sql = `
            INSERT INTO requests (
                agent_id, service_slug, status, amount, tx_hash, endpoint, error, 
                latency_ms, response_size_bytes, gas_used, 
                content_type, integrity_check, trust_signal, timestamp
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
            ON CONFLICT (tx_hash) DO UPDATE SET
                status = EXCLUDED.status,
                error = EXCLUDED.error,
                latency_ms = EXCLUDED.latency_ms,
                trust_signal = EXCLUDED.trust_signal
        `;

        const values = [
            normalizedAgentId, data.serviceSlug || null, data.status, data.amount || '0', data.txHash || null,
            data.endpoint?.substring(0, 255), data.error?.substring(0, 1000),
            data.latencyMs || 0, data.responseSizeBytes || 0,
            data.gasUsed, data.contentType?.substring(0, 100),
            data.integrityCheck || false, data.trustSignal || null
        ];

        await query(sql, values);
    } catch (error) {
        console.error('[DB ERROR] Failed to log request:', error);
    }
}

export async function getStats() {
    try {
        // 1. Recent requests
        const recentRes = await query(`
            SELECT id, agent_id as "agentId", timestamp, status, amount,
            tx_hash as "txHash", endpoint, error, credit_grade as "creditGrade",
            latency_ms as "latency", trust_signal as "trustSignal",
            service_slug as "serviceSlug"
            FROM requests 
            ORDER BY id DESC LIMIT 100
            `);

        // 2. Aggregates (Native SQL replacement for RPC)
        const statsRes = await query(`
        SELECT
        count(*) as total_calls,
            sum(amount:: numeric) as total_revenue_wei
            FROM requests
            `);

        const stats = statsRes.rows[0];
        const totalRevenueWei = BigInt(stats.total_revenue_wei || 0);

        const feeRateBasisPoints = BigInt(Math.floor(FEE_CONFIG.PLATFORM_FEE_RATE * 100));
        const protocolFeeWei = (totalRevenueWei * feeRateBasisPoints) / BigInt(100);

        return {
            recent: recentRes.rows,
            totalRequests: parseInt(stats.total_calls),
            totalRevenueWei: totalRevenueWei.toString(),
            adminBalanceWei: protocolFeeWei.toString()
        };
    } catch (error) {
        console.error('[DB] Stats fetch failed:', error);
        return { recent: [], totalRequests: 0, totalRevenueWei: '0', adminBalanceWei: '0' };
    }
}

export async function getServiceStats(slug: string) {
    try {
        const statsRes = await query(`
        SELECT
            count(*) as total_calls,
            count(DISTINCT agent_id) as unique_agents,
            sum(amount:: numeric) as total_revenue_wei,
            avg(latency_ms) as avg_latency
            FROM requests
            WHERE service_slug = $1
            `, [slug]);

        const stats = statsRes.rows[0];
        return {
            totalRequests: parseInt(stats.total_calls || '0'),
            uniqueAgents: parseInt(stats.unique_agents || '0'),
            totalRevenueWei: (stats.total_revenue_wei || '0').toString(),
            avgLatency: Math.round(parseFloat(stats.avg_latency || '0'))
        };
    } catch (error) {
        console.error(`[DB] Stats fetch failed for ${slug}: `, error);
        return { totalRequests: 0, totalRevenueWei: '0', avgLatency: 0 };
    }
}

export async function isTxHashUsed(txHash: string): Promise<boolean> {
    const res = await query('SELECT id FROM requests WHERE tx_hash = $1 AND status = 200 LIMIT 1', [txHash]);
    return res.rows.length > 0;
}

export async function isNonceUsed(nonce: string): Promise<boolean> {
    const res = await query('SELECT nonce FROM used_nonces WHERE nonce = $1 LIMIT 1', [nonce]);
    return res.rows.length > 0;
}

export async function recordNonce(nonce: string, agentId: string): Promise<void> {
    try {
        await query('INSERT INTO used_nonces (nonce, agent_id, created_at) VALUES ($1, $2, NOW())', [nonce, agentId]);
    } catch (error: any) {
        if (error.code === '23505') throw new Error('Nonce already used');
        throw error;
    }
}

export async function cleanupExpiredNonces(): Promise<void> {
    const res = await query("DELETE FROM used_nonces WHERE created_at < NOW() - INTERVAL '5 minutes'");
    console.log(`[Nonce] Cleaned up ${res.rowCount || 0} expired nonces`);
}

// Export a generic db object with a 'from' proxy to minimize breakage if possible, 
// though direct refactor is better. For now, we prefer direct usage of functions above.
export const db = {
    from: (table: string) => ({
        select: (cols: string) => ({
            eq: (col: string, val: any) => ({
                order: (col: string, opt: any) => ({
                    limit: (n: number) => query(`SELECT ${cols} FROM ${table} WHERE ${col} = $1 ORDER BY ${col} ${opt.ascending ? 'ASC' : 'DESC'} LIMIT $2`, [val, n])
                }),
                single: () => query(`SELECT ${cols} FROM ${table} WHERE ${col} = $1 LIMIT 1`, [val]).then(r => ({ data: r.rows[0], error: null })),
                maybeSingle: () => query(`SELECT ${cols} FROM ${table} WHERE ${col} = $1 LIMIT 1`, [val]).then(r => ({ data: r.rows[0], error: null }))
            }),
            update: (data: any) => ({
                eq: (col: string, val: any) => query(`UPDATE ${table} SET ${Object.keys(data).map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE ${col} = $1`, [val, ...Object.values(data)])
            })
        }),
        insert: (data: any) => query(`INSERT INTO ${table} (${Object.keys(data).join(', ')}) VALUES(${Object.keys(data).map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(data)),
        upsert: (data: any, opts: any) => {
            const keys = Object.keys(data);
            const vals = Object.values(data);
            const conflictCol = opts.onConflict || 'id';
            const updates = keys.map((k, i) => `${k} = EXCLUDED.${k} `).join(', ');
            return query(`
                INSERT INTO ${table} (${keys.join(', ')}) VALUES(${keys.map((_, i) => `$${i + 1}`).join(', ')})
                ON CONFLICT(${conflictCol}) DO UPDATE SET ${updates}
        `, vals).then(() => ({ error: null }));
        }
    }),
    rpc: (fn: string, params: any) => {
        if (fn === 'calculate_global_stats') return getStats().then(s => ({ data: [{ total_calls: s.totalRequests, total_revenue_wei: s.totalRevenueWei }], error: null }));
        return query(`SELECT * FROM ${fn} (${Object.keys(params).map((_, i) => `$${i + 1}`).join(', ')})`, Object.values(params)).then(r => ({ data: r.rows, error: null }));
    }
} as any;
