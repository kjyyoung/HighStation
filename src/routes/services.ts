import express from 'express';
import { query } from '../database/db';
import { isBlockedIP } from '../utils/validators';
import crypto from 'crypto';
import * as dns from 'dns/promises';
import { DomainVerificationService } from '../services/DomainVerificationService';
import * as net from 'net';
import { URL } from 'url';

import { OpenSealService } from '../services/OpenSealService';
const router = express.Router();

/**
 * POST /api/services
 * Create a new service (Authenticated Provider)
 * Bypasses RLS by using Backend Admin Client
 */
router.post('/', async (req, res) => {
    try {
        const userId = res.locals.user.id;
        const { name, slug, upstream_url, price_wei, access_requirements, openseal_repo_url, openseal_root_hash, category, tags, description, capabilities } = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Basic Validation
        if (!name || !slug || !upstream_url) {
            return res.status(400).json({ error: 'Missing required fields' });
        }

        // SECURITY: Enforce HTTPS in Production
        // In local development (NODE_ENV != 'production'), allow http/localhost
        const isProduction = process.env.NODE_ENV === 'production';
        if (isProduction && !upstream_url.startsWith('https://')) {
            return res.status(400).json({
                error: 'Security Policy Violation',
                message: 'Production services must use HTTPS. HTTP is only allowed in development.'
            });
        }

        // Slug Validation: Only allow a-z, 0-9, and hyphens
        if (!/^[a-z0-9-]+$/.test(slug)) {
            return res.status(400).json({
                error: 'Invalid Input',
                message: 'Slug must contain only lowercase letters, numbers, and hyphens (e.g., my-service-123).'
            });
        }

        try {
            const sql = `
                INSERT INTO services (
                    provider_id, name, slug, upstream_url, 
                    price_wei, access_requirements, min_grade, status,
                    openseal_repo_url, openseal_root_hash,
                    category, tags, description, capabilities
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                RETURNING *
            `;

            // Standard Hybrid Logic: Extract min_grade from JSON or default to 'F'
            const requirements = access_requirements || {};
            const minGrade = requirements.min_grade || 'F';

            const values = [
                userId, name, slug, upstream_url,
                price_wei || '0',
                requirements, // JSONB
                minGrade,     // Explicit Column
                'pending',
                openseal_repo_url || null, openseal_root_hash || null,
                category || 'General',
                tags || [],
                description || '',
                capabilities || {}
            ];

            const result = await query(sql, values);
            const data = result.rows[0];
            res.status(201).json(data);

        } catch (error: any) {
            console.error('[Services API] Insert error:', error);
            // Handle unique constraint violation (slug)
            if (error.code === '23505') {
                return res.status(409).json({ error: 'Service slug already exists' });
            }
            throw error;
        }

    } catch (error: any) {
        console.error('[Services API] Create Service error:', error);
        res.status(500).json({
            error: 'Failed to create service',
            details: error.message || error,
            code: error.code
        });
    }
});

/**
 * POST /api/services/utils/test-connection
 * Real-time probing of upstream URL with SSRF protection
 */
router.post('/utils/test-connection', async (req, res) => {
    try {
        const { url } = req.body;
        if (!url) return res.status(400).json({ error: 'URL required' });

        // 1. Syntax Check
        const { isSafeUrlSyntax, isBlockedIP } = require('../utils/validators');
        if (!isSafeUrlSyntax(url)) {
            return res.status(400).json({ error: 'Invalid or unsafe URL format' });
        }

        const urlObj = new URL(url);
        const hostname = urlObj.hostname;

        // 2. DNS Resolution & SSRF Check
        let resolvedIP: string;
        try {
            const addresses = await dns.resolve4(hostname);
            resolvedIP = addresses[0];
        } catch (e) {
            if (net.isIP(hostname)) {
                resolvedIP = hostname;
            } else {
                return res.status(400).json({ error: 'DNS resolution failed' });
            }
        }

        if (isBlockedIP(resolvedIP)) {
            return res.status(400).json({ error: 'Access to private network blocked' });
        }

        // 3. Real Probing (Latency measurement)
        const start = Date.now();
        try {
            const probeRes = await fetch(url, {
                method: 'GET',
                signal: AbortSignal.timeout(5000)
            });
            const latency = Date.now() - start;

            res.json({
                success: probeRes.ok,
                status: probeRes.status,
                latency,
                ip: resolvedIP
            });
        } catch (fetchErr: any) {
            res.status(400).json({
                success: false,
                error: 'Connection timeout or refused',
                details: fetchErr.message
            });
        }
    } catch (error: any) {
        res.status(500).json({ error: 'Probing failed' });
    }
});

/**
 * POST /api/services/utils/verify-repo
 * Real-time OpenSeal manifest fetching and hash extraction
 */
router.post('/utils/verify-repo', async (req, res) => {
    try {
        const { repo_url } = req.body;
        if (!repo_url) return res.status(400).json({ error: 'Repository URL required' });

        const { OpenSealService } = require('../services/OpenSealService');
        const manifestUrl = OpenSealService.resolveManifestUrl(repo_url);
        const manifest = await OpenSealService.fetchManifest(manifestUrl);

        let rootHashHex: string;
        const rawRootHash = manifest.identity.root_hash;
        if (Array.isArray(rawRootHash)) {
            rootHashHex = Buffer.from(rawRootHash).toString('hex');
        } else {
            rootHashHex = String(rawRootHash);
        }

        res.json({
            success: true,
            root_hash: rootHashHex,
            version: manifest.version,
            manifest_url: manifestUrl
        });
    } catch (error: any) {
        res.status(400).json({
            success: false,
            error: 'OpenSeal verification failed',
            details: error.message
        });
    }
});

/**
 * POST /api/services/:id/generate-token
 * Generate verification token for domain ownership
 */
router.post('/:id/generate-token', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = res.locals.user.id; // From Auth Middleware

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Generate random verification token
        const verificationToken = `x402-${crypto.randomBytes(16).toString('hex')}`;

        // Update service with token
        const sql = `
            UPDATE services 
            SET verification_token = $1, status = 'pending'
            WHERE id = $2 AND provider_id = $3
            RETURNING *
        `;
        const result = await query(sql, [verificationToken, id, userId]);
        const data = result.rows[0];

        if (!data) {
            return res.status(404).json({ error: 'Service not found or unauthorized' });
        }

        res.json({
            token: verificationToken,
            instructions: {
                http: {
                    step1: 'Create a file at your API:',
                    path: `${data.upstream_url}/.well-known/x402-verify.txt`,
                    content: verificationToken
                },
                dns: {
                    step1: 'Add a TXT record to your domain:',
                    host: '@',
                    value: `highstation-verification=${verificationToken}`
                },
                step2: 'Click "Verify HTTP" or "Verify DNS" button to confirm ownership'
            }
        });
    } catch (error: any) {
        console.error('[Services API] Error generating token:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/services/:id/verify
 * Verify domain ownership by checking .well-known file
 */
router.post('/:id/verify', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = res.locals.user.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        // Get service details
        const result = await query(
            'SELECT * FROM services WHERE id = $1 AND provider_id = $2 LIMIT 1',
            [id, userId]
        );
        const service = result.rows[0];

        if (!service) {
            return res.status(404).json({ error: 'Service not found' });
        }

        if (!service.verification_token) {
            return res.status(400).json({
                error: 'No verification token. Generate one first.'
            });
        }

        // Verify domain ownership
        // SSRF PROTECTION (V-03-FIXED): Prevent TOCTOU by pinning DNS resolution

        // 1. Parse URL
        let urlObj: URL;
        try {
            urlObj = new URL(service.upstream_url);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid URL format' });
        }

        const hostname = urlObj.hostname;

        // 2. Resolve DNS (IPv4 first) to get specific IP "Pin"
        let resolvedIP: string;
        try {
            const addresses = await dns.resolve4(hostname);
            if (!addresses || addresses.length === 0) {
                throw new Error('No DNS records found');
            }
            resolvedIP = addresses[0]; // Pick first IP
        } catch (dnsErr) {
            // If resolve4 fails, maybe it's an IP literal or IPv6?
            if (net.isIP(hostname)) {
                resolvedIP = hostname;
            } else {
                // Try IPv6? For now, fail safe.
                console.error('[Verification] DNS Resolution failed:', dnsErr);
                return res.status(400).json({ error: 'Verification failed', details: 'DNS resolution error' });
            }
        }

        // 3. Validate the Resolved IP (Not the hostname)
        // We need to import isBlockedIP from validators.ts
        if (isBlockedIP(resolvedIP)) {
            console.warn(`[Verification] Blocked unsafe IP: ${resolvedIP} (from ${hostname})`);
            return res.status(400).json({
                error: 'Invalid Upstream',
                message: 'The service resolves to a restricted network address.'
            });
        }

        // 4. Construct Safe URL using IP
        // http://1.2.3.4:80/.well-known/x402-verify.txt
        const verificationUrl = `${urlObj.protocol}//${resolvedIP}${urlObj.port ? ':' + urlObj.port : ''}/.well-known/x402-verify.txt`;

        try {
            const response = await fetch(verificationUrl, {
                method: 'GET',
                headers: {
                    'User-Agent': 'highstation-bot/1.0',
                    'Host': hostname // CRITICAL: Preserve original Host header for virtual hosts
                },
                // Add explicit timeout to prevent hanging
                signal: AbortSignal.timeout(5000)
            });

            if (!response.ok) {
                // SANITIZED ERROR: Do not return status text or details
                return res.status(400).json({
                    error: 'Verification file not found or inaccessible',
                    status: response.status
                });
            }

            const content = await response.text();
            const tokenFound = content.includes(service.verification_token);

            if (!tokenFound) {
                return res.status(400).json({
                    error: 'Verification failed',
                    details: 'Token not found in verification file'
                });
            }

            // Success! Update service status
            // Success! Update service status
            const updateSql = `
                UPDATE services 
                SET status = 'verified', verified_at = NOW()
                WHERE id = $1
                RETURNING *
            `;
            const updateRes = await query(updateSql, [id]);
            const updated = updateRes.rows[0];

            res.json({
                success: true,
                message: 'Domain ownership verified!',
                service: updated,
                verifiedAt: updated.verified_at
            });

        } catch (fetchError: any) {
            console.error('[Verification] Fetch error:', fetchError);
            // SANITIZED ERROR
            return res.status(400).json({
                error: 'Could not verify domain',
                message: 'Connection failed or timeout. Please check your firewall and URL.'
            });
        }
    } catch (error: any) {
        console.error('[Services API] Verification error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * POST /api/services/:id/verify-dns
 * Verify domain ownership by checking DNS TXT record
 */
router.post('/:id/verify-dns', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = res.locals.user.id;

        if (!userId) return res.status(401).json({ error: 'Unauthorized' });

        const result = await query(
            'SELECT * FROM services WHERE id = $1 AND provider_id = $2 LIMIT 1',
            [id, userId]
        );
        const service = result.rows[0];

        if (!service) return res.status(404).json({ error: 'Service not found' });
        if (!service.verification_token) return res.status(400).json({ error: 'No verification token' });

        let urlObj: URL;
        try {
            urlObj = new URL(service.upstream_url);
        } catch (e) {
            return res.status(400).json({ error: 'Invalid URL format' });
        }

        const hostname = urlObj.hostname;
        const isVerified = await DomainVerificationService.verifyViaDNS(hostname, service.verification_token);

        if (!isVerified) {
            return res.status(400).json({
                error: 'Verification failed',
                message: `Could not find TXT record for ${hostname} with required token.`
            });
        }

        await DomainVerificationService.updateVerificationStatus(id, true);

        res.json({
            success: true,
            message: 'Domain ownership verified via DNS!',
            verifiedAt: new Date().toISOString()
        });

    } catch (error: any) {
        console.error('[Services API] DNS Verification error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

/**
 * GET /api/services
 * List all services (filtered by verification status)
 */
router.get('/', async (req, res) => {
    try {
        const { status } = req.query;

        // SECURITY FIX (V-10): Remove provider_id from public response
        let sql = 'SELECT id, slug, name, price_wei, access_requirements, status, created_at FROM services';
        const params: any[] = [];

        if (status) {
            sql += ' WHERE status = $1';
            params.push(status);
        }

        sql += ' ORDER BY created_at DESC';

        const result = await query(sql, params);
        res.json({ services: result.rows || [] });

    } catch (error: any) {
        console.error('[Services API] Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

router.patch('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = res.locals.user.id;
        const updates = req.body;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        if (Object.keys(updates).length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }

        // SECURITY FIX (V-12): Strict key filtering for dynamic UPDATE
        const keys = Object.keys(updates);
        const allowedKeys = ['name', 'slug', 'upstream_url', 'price_wei', 'access_requirements', 'status', 'category', 'tags', 'description', 'capabilities', 'trust_seed_enabled', 'openseal_repo_url', 'openseal_root_hash'];
        const sanitizedUpdates: any = {};

        keys.forEach((k: string) => {
            if (allowedKeys.includes(k)) {
                sanitizedUpdates[k] = (updates as any)[k];
            }
        });

        if (Object.keys(sanitizedUpdates).length === 0) {
            return res.status(400).json({ error: 'No valid updates provided' });
        }

        // SECURITY FIX (V-13): Hardened OpenSeal Registration
        // If repo URL is updated, re-fetch and re-verify the root hash from source
        if (sanitizedUpdates.openseal_repo_url) {
            try {
                const osResult = await OpenSealService.registerIdentity(id, userId, sanitizedUpdates.openseal_repo_url);
                sanitizedUpdates.openseal_root_hash = osResult.service.openseal_root_hash;
                console.log(`[Services PATCH] OpenSeal Re-verified for ${id}: ${sanitizedUpdates.openseal_root_hash}`);
            } catch (osErr: any) {
                return res.status(400).json({ error: 'OpenSeal Verification Failed', message: osErr.message });
            }
        } else {
            // If only hash is sent without repo, ignore it to prevent spoofing
            delete sanitizedUpdates.openseal_root_hash;
        }

        const filteredKeys = Object.keys(sanitizedUpdates);

        // [STANDARD HYBRID SYNC] Update min_grade column if access_requirements changes
        if (sanitizedUpdates.access_requirements) {
            const reqs = sanitizedUpdates.access_requirements;
            if (reqs && typeof reqs.min_grade === 'string') {
                sanitizedUpdates.min_grade = reqs.min_grade;
            }
        }

        const finalKeys = Object.keys(sanitizedUpdates);
        if (finalKeys.length === 0) {
            return res.status(400).json({ error: 'No valid updates provided' });
        }

        const setClause = finalKeys.map((key, index) => `${key} = $${index + 3}`).join(', ');
        const sql = `
            UPDATE services 
            SET ${setClause}
            WHERE id = $1 AND provider_id = $2
            RETURNING *
        `;

        const values = [id, userId, ...Object.values(sanitizedUpdates)];

        try {
            const result = await query(sql, values);
            const data = result.rows[0];

            if (!data) return res.status(404).json({ error: 'Service not found or unauthorized' });

            res.json(data);
        } catch (dbErr: any) {
            console.error('[Services API] Update DB error:', dbErr);
            return res.status(500).json({ error: 'Database error during update' });
        }

    } catch (error: any) {
        console.error('[Services API] Update error:', error);
        res.status(500).json({ error: 'Failed to update service' });
    }
});

router.delete('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const userId = res.locals.user.id;

        if (!userId) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const result = await query(
            'DELETE FROM services WHERE id = $1 AND provider_id = $2',
            [id, userId]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Service not found or unauthorized' });
        }

        res.json({ success: true });
    } catch (error: any) {
        console.error('[Services API] Delete error:', error);
        res.status(500).json({ error: 'Failed to delete service' });
    }
});

/**
 * POST /api/services/:id/openseal
 * Register/Update OpenSeal Identity for a service
 */
router.post('/:id/openseal', async (req, res) => {
    try {
        const { id } = req.params;
        const { repo_url } = req.body;
        const userId = res.locals.user.id;

        if (!userId) return res.status(401).json({ error: 'Unauthorized' });
        if (!repo_url) return res.status(400).json({ error: 'Missing repo_url' });

        // Service Import (Late binding to avoid circular deps if any)
        const { OpenSealService } = require('../services/OpenSealService');

        const result = await OpenSealService.registerIdentity(id, userId, repo_url);

        res.json({
            success: true,
            message: 'OpenSeal Identity Registered Successfully',
            data: result
        });

    } catch (error: any) {
        console.error('[Services API] OpenSeal Registration Error:', error);
        res.status(500).json({
            error: 'OpenSeal Registration Failed',
            details: error.message
        });
    }
});

export default router;
